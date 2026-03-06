const keyService = require('./keyService');
const dbService = require('./dbService'); // Added for Product Search Tool
const commandApiService = require('./commandApiService'); // Command API Table Strategy
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const OpenAI = require('openai');
const { GoogleGenerativeAI, GoogleAICacheManager } = require("@google/generative-ai");
const FormData = require('form-data');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
let ffmpegPath = null;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (e) {
    ffmpegPath = null;
}

function getProxyUrl() {
    const proxyUrl = process.env.BRIGHT_DATA_PROXY_URL;
    const user = process.env.BRIGHT_DATA_USER;
    const pass = process.env.BRIGHT_DATA_PASS;
    if (!proxyUrl || !user || !pass) return null;
    
    // Rotation using random session ID for better stability
    const session = `sess_${Math.floor(Math.random() * 99999)}`;
    const url = `http://${user}-session-${session}:${pass}@${proxyUrl}`;
    
    // Validate proxy format (basic check)
    if (!url.startsWith('http://')) {
        console.warn("[Proxy] Invalid Proxy URL format constructed.");
        return null;
    }
    return url;
}

function getGeminiProxyAgent(baseURL, useProxy = true) {
    if (!useProxy) return null;
    const proxy = getProxyUrl();
    if (!proxy) return null;
    try {
        // HttpsProxyAgent automatically handles http/https protocols
        return new HttpsProxyAgent(proxy);
    } catch (e) {
        console.warn(`[Proxy] Failed to create Gemini Proxy Agent: ${e.message}`);
        return null;
    }
}

function getGroqProxyAgent(useProxy = true) {
    if (!useProxy) return null;
    const proxy = getProxyUrl();
    if (!proxy) return null;
    try {
        return new HttpsProxyAgent(proxy);
    } catch (e) {
        console.warn(`[Proxy] Failed to create Groq Proxy Agent: ${e.message}`);
        return null;
    }
}

async function convertOggToMp3(inputBuffer) {
    if (!ffmpegPath) return null;
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wa-audio-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.ogg`);
    const outputPath = path.join(tmpDir, `output-${Date.now()}.mp3`);
    try {
        await fs.promises.writeFile(inputPath, inputBuffer);
        await new Promise((resolve, reject) => {
            const args = ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-vn', '-acodec', 'libmp3lame', outputPath];
            const proc = spawn(ffmpegPath, args, { windowsHide: true });
            proc.on('error', reject);
            proc.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg_exit_${code}`));
            });
        });
        const outputBuffer = await fs.promises.readFile(outputPath);
        return outputBuffer;
    } catch (err) {
        console.warn(`[Audio] OGG to MP3 conversion failed: ${err.message}`);
        return null;
    } finally {
        try {
            await fs.promises.rm(tmpDir, { recursive: true, force: true });
        } catch {}
    }
}

// --- CPU CONCURRENCY CONTROL ---
// Limits simultaneous AI calls to prevent CPU spikes during bursts
let activeAiCalls = 0;
const MAX_CONCURRENT_AI_CALLS = process.env.MAX_CONCURRENT_AI_CALLS ? parseInt(process.env.MAX_CONCURRENT_AI_CALLS) : 8;
const AI_QUEUE_TIMEOUT = 15000; // 15 seconds wait time

async function acquireAiSlot() {
    const start = Date.now();
    while (activeAiCalls >= MAX_CONCURRENT_AI_CALLS) {
        if (Date.now() - start > AI_QUEUE_TIMEOUT) {
            throw new Error("AI Server is too busy. Please try again in a few seconds.");
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
    }
    activeAiCalls++;
}

function releaseAiSlot() {
    activeAiCalls = Math.max(0, activeAiCalls - 1);
}
// -------------------------------

// --- NEW: AUTOMATIC KEY FAILURE HANDLING ---
/**
 * Handles API errors by marking keys as dead or quota exceeded.
 * @param {Error} error - The error object from the API call.
 * @param {string} apiKey - The API key that failed.
 * @param {string} model - The model being used.
 */
function handleAiError(error, apiKey, model) {
    if (!apiKey) return;
    
    const errorMsg = (error.message || '').toLowerCase();
    const responseError = error.response?.data?.error || {};
    const errorCode = `${responseError.code || responseError.type || responseError.status || ''}`.toLowerCase();
    const statusCode = error.status || (error.response ? error.response.status : null);

    console.error(`[AI Error Handler] Handling error for key ${apiKey.substring(0, 8)}... | Status: ${statusCode} | Msg: ${errorMsg}`);

    // 1. Quota / Rate Limit (429)
    if (statusCode === 429 || errorMsg.includes('429') || errorMsg.includes('limit') || errorMsg.includes('quota') || errorMsg.includes('exhausted')) {
        console.warn(`[AI] ⛔ Quota Exceeded for key ${apiKey.substring(0, 8)}... marking as EXCEEDED.`);
        if (keyService.markKeyAsQuotaExceeded) {
            keyService.markKeyAsQuotaExceeded(apiKey);
        }
        return;
    }

    // 2. Invalid Key / Auth (401 / 403)
    if (statusCode === 401 || statusCode === 403 || errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('invalid') || errorMsg.includes('key') || errorMsg.includes('authentication')) {
        if (errorCode.includes('consumer_suspended')) {
            if (keyService.markKeyAsSuspended) {
                keyService.markKeyAsSuspended(apiKey, 'consumer_suspended');
            }
            return;
        }
        console.error(`[AI] 💀 Invalid Key detected: ${apiKey.substring(0, 8)}... marking as DEAD (30 days).`);
        if (keyService.markKeyAsDead) {
            keyService.markKeyAsDead(apiKey, 30 * 24 * 60 * 60 * 1000, 'invalid_key'); // 30 days cooldown
        }
        return;
    }

    // 3. General API Error (Network, Timeout, 500, etc.)
    console.warn(`[AI] ⚠️ General API Error for key ${apiKey.substring(0, 8)}... cooldown for 10 minutes.`);
    if (keyService.markKeyAsDead) {
        keyService.markKeyAsDead(apiKey, 10 * 60 * 1000, 'api_error'); // 10 minutes cooldown
    }
}

// --- GLOBAL ENGINE CONFIG CACHE ---
let globalEngineConfigCache = new Map();
let lastConfigFetch = new Map(); // Store fetch time per provider
const CONFIG_CACHE_TTL = 60 * 60 * 1000; // 1 Hour TTL

async function getGlobalEngineConfig(provider) {
    const now = Date.now();
    const lastFetch = lastConfigFetch.get(provider) || 0;

    // Check Cache
    if (globalEngineConfigCache.has(provider) && (now - lastFetch < CONFIG_CACHE_TTL)) {
        return globalEngineConfigCache.get(provider);
    }

    try {
        console.log(`[AI] Refreshing Global Engine Config for ${provider}...`);
        const pgClient = require('./pgClient');
        const res = await pgClient.query('SELECT * FROM api_engine_configs WHERE provider = $1', [provider]);
        const config = res.rows[0] || null;
        
        globalEngineConfigCache.set(provider, config);
        lastConfigFetch.set(provider, now);
        
        return config;
    } catch (err) {
        console.warn(`[AI] Failed to fetch global engine config for ${provider}:`, err.message);
        return globalEngineConfigCache.get(provider) || null; // Fallback to stale cache
    }
}

async function refreshGlobalEngineConfigCache(provider = null) {
    if (provider) {
        globalEngineConfigCache.delete(provider);
        lastConfigFetch.delete(provider);
        return getGlobalEngineConfig(provider);
    }

    globalEngineConfigCache.clear();
    lastConfigFetch.clear();
    return true;
}

async function resolveSalesmanchatbotEngine(pageConfig, defaultProvider, defaultModel, isVision, isAudio) {
    let targetProvider = defaultProvider || 'salesmanchatbot';
    let targetEngineName = defaultModel || 'salesmanchatbot-pro';

    if (targetEngineName === 'salesmanchatbot-pro') {
        targetProvider = 'google';
    } else if (targetEngineName === 'salesmanchatbot-flash') {
        targetProvider = 'openrouter';
    } else if (targetEngineName === 'salesmanchatbot-lite') {
        targetProvider = 'groq';
    }

    if (targetProvider === 'salesmanchatbot' || targetProvider === 'gemini') {
        const hasCustomConfig = await getGlobalEngineConfig(targetProvider);
        if (!hasCustomConfig) {
            targetProvider = 'google';
        }
    }

    const gConfig = await getGlobalEngineConfig(targetProvider);

    let engineTextModel = targetEngineName;
    let engineVisionModel = targetEngineName;
    let engineVoiceModel = targetEngineName;

    let textProvider = targetProvider;
    let visionProvider = targetProvider;
    let voiceProvider = targetProvider;

    if (gConfig) {
        engineTextModel = gConfig.text_model || engineTextModel;
        engineVisionModel = gConfig.vision_model || engineVisionModel;
        engineVoiceModel = gConfig.voice_model || engineVoiceModel;

        if (gConfig.text_provider_override && gConfig.text_provider_override !== 'default') 
            textProvider = gConfig.text_provider_override;
        
        if (gConfig.vision_provider_override && gConfig.vision_provider_override !== 'default') 
            visionProvider = gConfig.vision_provider_override;
        
        if (gConfig.voice_provider_override && gConfig.voice_provider_override !== 'default') 
            voiceProvider = gConfig.voice_provider_override;

        if (keyService.setManualLimit) {
            if (gConfig.text_rpm || gConfig.text_rpd || gConfig.text_rph) 
                keyService.setManualLimit(engineTextModel, { rpm: gConfig.text_rpm, rpd: gConfig.text_rpd, rph: gConfig.text_rph });
            if (gConfig.vision_rpm || gConfig.vision_rpd || gConfig.vision_rph) 
                keyService.setManualLimit(engineVisionModel, { rpm: gConfig.vision_rpm, rpd: gConfig.vision_rpd, rph: gConfig.vision_rph });
            if (gConfig.voice_rpm || gConfig.voice_rpd || gConfig.voice_rph) 
                keyService.setManualLimit(engineVoiceModel, { rpm: gConfig.voice_rpm, rpd: gConfig.voice_rpd, rph: gConfig.voice_rph });
        }
    }

    let finalModel = engineTextModel;
    let finalProvider = textProvider;

    if (isAudio) {
        finalModel = engineVoiceModel;
        finalProvider = voiceProvider;
        console.log(`[AI] Smart Routing (Voice): Using ${finalProvider}/${finalModel}`);
    } else if (isVision) {
        finalModel = engineVisionModel;
        finalProvider = visionProvider;
        console.log(`[AI] Smart Routing (Vision): Using ${finalProvider}/${finalModel}`);
    } else {
        console.log(`[AI] Smart Routing (Text): Using ${finalProvider}/${finalModel}`);
    }

    if (finalProvider === 'openrouter' && finalModel.includes(',')) {
        finalModel = finalModel.split(',')[0].trim();
    }

    if (isAudio && voiceProvider === 'groq') {
        finalProvider = 'groq';
    }

    console.log(`[AI] Engine Resolved: ${finalProvider}/${finalModel} (Audio: ${isAudio}, Vision: ${isVision})`);

    return { 
        finalProvider,
        finalModel,
        targetProvider,
        targetEngineName,
        engineTextModel,
        engineVisionModel,
        engineVoiceModel,
        textProvider,
        visionProvider,
        voiceProvider,
        gConfig
    };
}

// --- DYNAMIC FREE MODEL OPTIMIZER (OpenRouter) ---
// User Request: "automatic na ami fronted e set korbo segulai pradanno pabe tumi nijer teke backend e kono model takbe na"
// Solution: Removed ALL backend default/verified model lists. 
// The system will now ONLY use what is passed from the frontend/user config.
let bestFreeModels = {
    text: null,
    vision: null,
    voice: null
};

// Removed VERIFIED_MODELS constant to enforce user choice.

async function updateBestFreeModels() {
    // Disabled automatic optimizer. 
    // We rely entirely on user configuration from DB/Frontend.
    console.log('[AI Optimizer] Automatic optimization disabled by user preference.');
}

// Schedule: Run every 2 hours
// setInterval(updateBestFreeModels, 2 * 60 * 60 * 1000);
// Run immediately on startup
// updateBestFreeModels();
// -----------------------------------------------------

function logDebug(msg) {
    try {
        const logDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        fs.appendFileSync(path.join(logDir, 'ai.log'), new Date().toISOString() + ' ' + msg + '\n');
    } catch (e) {
        console.error("Failed to write debug log:", e);
    }
}

// --- IN-MEMORY CACHE FOR ZERO COST ---
// Map<hash, { reply: string, timestamp: number }>
const responseCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 Hour Cache
const CACHE_SIZE_LIMIT = 500; // Prevent memory leaks

function getCacheKey(pageId, message, senderName) {
    // Normalize message: lowercase, remove special chars
    const normalized = message.toLowerCase().replace(/[^\w\s\u0980-\u09FF]/g, '').trim();
    // LEAK FIX: Include senderName in cache key to prevent cross-user data leaks
    return `${pageId}:${senderName}:${normalized}`;
}

const functionTools = [
    {
        type: 'function',
        function: {
            name: 'resolve_product',
            description: 'Resolve the most likely product from user query. Returns EXACT/AMBIGUOUS/NOT_FOUND.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The product name or keywords to search for' },
                    candidates_scope: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: restrict resolution to a previous candidate product_id list'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_product',
            description: 'Fetch exact product details by product_id.',
            parameters: {
                type: 'object',
                properties: {
                    product_id: { type: 'string' },
                    fields: { type: 'array', items: { type: 'string' } }
                },
                required: ['product_id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'compute_price',
            description: 'Compute final price for single/variant/combo items. Truth source for price.',
            parameters: {
                type: 'object',
                properties: {
                    line_items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                product_id: { type: 'string' },
                                qty: { type: 'number' },
                                variant_key: { type: 'string' }
                            },
                            required: ['product_id', 'qty']
                        }
                    }
                },
                required: ['line_items']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'check_stock',
            description: 'Return stock availability truth for a product_id.',
            parameters: {
                type: 'object',
                properties: {
                    product_id: { type: 'string' }
                },
                required: ['product_id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_order',
            description: 'Create order details when user confirms an order',
            parameters: {
                type: 'object',
                properties: {
                    product_name: { type: 'string' },
                    phone: { type: 'string' },
                    address: { type: 'string' },
                    quantity: { type: 'string' },
                    price: { type: 'string' }
                },
                required: ['product_name', 'phone', 'address']
            }
        }
    }
];

const normalizeText = (value) => (value || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');

const computeCandidateScore = (query, product) => {
    const q = normalizeText(query);
    const name = normalizeText(product.name);
    const keywords = normalizeText(product.keywords || '');
    const visual = normalizeText(product.visual_tags || '');
    const desc = normalizeText(product.description || '');
    const comboItems = Array.isArray(product.combo_items) ? normalizeText(product.combo_items.join(' ')) : '';
    
    if (!q) return 0;
    
    // 1. Exact or very close matches
    if (name === q) return 100;
    if (keywords === q) return 98;
    
    // Partial Match logic (e.g. "Rice Cream" matches "Rice Combo")
    if (name.includes(q) || q.includes(name)) return 95;

    let score = 0;
    const qTokens = q.split(/\s+/).filter(Boolean);
    const nameTokens = name.split(/\s+/).filter(Boolean);
    const comboTokens = comboItems.split(/\s+/).filter(Boolean);
    const nameTokenSet = new Set(nameTokens);
    const qTokenSet = new Set(qTokens);

    // 2. Token Matching with high weight for partial matches
    let matchedTokens = 0;
    qTokens.forEach((t, i) => {
        if (name.includes(t)) {
            score += 45; // High weight for shared tokens
            matchedTokens++;
            if (nameTokens[0] === t) score += 10; 
        } else if (keywords.includes(t)) {
            score += 40;
            matchedTokens++;
        } else if (comboItems.includes(t)) {
            score += 12;
            matchedTokens++;
        }
    });

    // 3. Score boost for multiple token matches
    if (matchedTokens >= 2) score += 20;

    // 4. Penalty for length mismatch (reduced to allow partials like "Rice Cream" -> "Rice Combo")
    const lenDiff = Math.abs(name.length - q.length);
    score -= Math.min(lenDiff, 10);

    const coverage = qTokens.length > 0 ? matchedTokens / qTokens.length : 0;
    const extraNameTokens = nameTokens.filter(t => !qTokenSet.has(t)).length;
    const extraComboTokens = comboTokens.filter(t => !qTokenSet.has(t)).length;

    if (coverage < 0.5) score -= 15;
    if (coverage >= 0.8) score += 10;
    if (product.is_combo && (extraNameTokens > 1 || extraComboTokens > 0) && coverage < 0.9) score -= 20;
    if (!product.is_combo && coverage >= 0.7 && extraNameTokens <= 1) score += 8;

    return Math.min(Math.max(score, 0), 100);
};

const normalizeVariantPrice = (variant) => {
    if (!variant) return null;
    if (typeof variant.price === 'number') return variant.price;
    if (typeof variant.price === 'string') {
        const n = parseFloat(variant.price.replace(/[^\d.]/g, ''));
        return Number.isFinite(n) ? n : null;
    }
    return null;
};

// --- GEMINI CONTEXT CACHING MANAGER ---
const geminiCacheMap = new Map(); // Key: Hash, Value: { name: string, expirationTime: string }

function computeHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Creates or retrieves a Gemini Context Cache.
 * Returns the cache resource name (e.g., 'cachedContents/...') or null if failed.
 */
async function getOrCreateGeminiCache(apiKey, modelName, systemInstructionContent) {
    // Only cache if content is substantial (e.g., > 100 chars) to avoid overhead for tiny prompts
    if (!systemInstructionContent || systemInstructionContent.length < 100) return null;

    // Ensure model name has 'models/' prefix for SDK
    const sdkModelName = modelName.includes('/') ? modelName : `models/${modelName}`;

    try {
        const cacheManager = new GoogleAICacheManager(apiKey);
        // Include model in hash because cache is bound to model
        const hash = computeHash(systemInstructionContent + sdkModelName);
        
        // 1. Check Local Map
        if (geminiCacheMap.has(hash)) {
            const cached = geminiCacheMap.get(hash);
            // Check if expired (give 5 min buffer)
            if (new Date(cached.expirationTime).getTime() > Date.now() + 5 * 60 * 1000) {
                console.log(`[Gemini Cache] Using local cache: ${cached.name}`);
                return cached.name;
            } else {
                geminiCacheMap.delete(hash);
            }
        }

        // 2. Create New Cache
        console.log(`[Gemini Cache] Creating new cache for ${sdkModelName} (Length: ${systemInstructionContent.length})...`);
        
        const cacheResult = await cacheManager.create({
            model: sdkModelName,
            // We pass the system prompt as the systemInstruction of the CACHE.
            // This means any model using this cache automatically has this system prompt.
            systemInstruction: systemInstructionContent,
            contents: [], // No additional history in cache for now, just system prompt
            ttlSeconds: 60 * 60, // 1 Hour TTL
        });

        console.log(`[Gemini Cache] Created: ${cacheResult.name} | Expires: ${cacheResult.expirationTime}`);
        
        geminiCacheMap.set(hash, {
            name: cacheResult.name,
            expirationTime: cacheResult.expirationTime
        });

        return cacheResult.name;
    } catch (e) {
        console.warn(`[Gemini Cache] Failed to create cache: ${e.message}`);
        return null;
    }
}
// ------------------------------
// -------------------------------------

// --- HELPER: Fetch OG Image from Link ---
async function fetchOgImage(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                // Add Security Headers to mimic browser
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 3000 // 3s Timeout to avoid blocking response
        });

        const html = response.data;
        if (typeof html !== 'string') return null;

        // Priority 1: og:image
        let match = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i);
        if (match) return match[1];

        // Priority 2: twitter:image
        match = html.match(/<meta name=["']twitter:image["'] content=["']([^"']+)["']/i);
        if (match) return match[1];
        
        // Priority 3: link rel="image_src"
        match = html.match(/<link rel=["']image_src["'] href=["']([^"']+)["']/i);
        if (match) return match[1];

        return null;
    } catch (error) {
        // Silent fail is fine, we just won't have an image
        return null;
    }
}

// Wrapper for Controller Consistency
async function generateResponse({ pageId, userId, userMessage, history, imageUrls, audioUrls, config, platform, extraTokenUsage = 0, senderName: explicitSenderName = null, ownerName = null }) {
    // 1. Fetch Prompts if needed
    let pagePrompts = config;
    if (config && platform) {
        config.platform = platform;
    }
    
    // For Messenger, config might not have prompts if passed from minimal object
    // But for WhatsApp, we usually pass full config.
    // Let's ensure we have prompts.
    if (platform === 'messenger' || !pagePrompts.text_prompt) {
         const dbService = require('./dbService');
         try {
            pagePrompts = await dbService.getPagePrompts(pageId);
         } catch (e) {
            console.warn(`[AI] Failed to fetch prompts for ${pageId}:`, e.message);
         }
    }

    // 2. Resolve Sender Name (WhatsApp Specific)
    let senderName = explicitSenderName || userId;
    // Only fetch from DB if explicitSenderName is missing or 'Unknown'
    if (!explicitSenderName || explicitSenderName === 'Unknown') {
        try {
            const pgClient = require('./pgClient');
            if (platform === 'whatsapp') {
                const result = await pgClient.query(
                    'SELECT name FROM whatsapp_contacts WHERE phone_number = $1 AND session_name = $2 LIMIT 1',
                    [userId, pageId]
                );
                if (result.rows.length > 0 && result.rows[0].name && result.rows[0].name !== 'Unknown') {
                    senderName = result.rows[0].name;
                }
            }
        } catch (e) {
        }
    }

    // 3. Call Core Logic
    return generateReply(
        userMessage,
        config,
        pagePrompts,
        history,
        senderName,
        ownerName || config.name || 'Automation Hub BD', // Pass ownerName with fallback
        null, // senderGender (optional)
        imageUrls,
        audioUrls,
        extraTokenUsage, // Pass initial usage (e.g. from Vision API in Controller)
        userId // Pass actual Customer ID
    );
}

function estimateTokenUsage(messages, replyText, baseUsage) {
    if (baseUsage && baseUsage > 0) return baseUsage;
    const inputChars = (messages || []).reduce((acc, m) => acc + (m.content ? m.content.length : 0), 0);
    const outputChars = replyText ? replyText.length : 0;
    return Math.ceil((inputChars + outputChars) / 4);
}

// Helper to extract images from text response (IMAGE: Title | URL)
function extractImagesFromText(text) {
    const images = [];
    if (!text) return { text: "", images: [] };
    
    // Regex to find "IMAGE: Title | URL"
    // Supports multiline, case insensitive "IMAGE:"
    const imgRegex = /IMAGE:\s*(.+?)\s*\|\s*(http[s]?:\/\/[^\s]+)/gi;
    
    let match;
    let cleanText = text;
    
    // We use a loop to find all matches and build the images array
    while ((match = imgRegex.exec(text)) !== null) {
        if (match[1] && match[2]) {
            images.push({
                title: match[1].trim(),
                url: match[2].trim()
            });
        }
    }

    // Do NOT remove the IMAGE lines from the text, just return the text as is.
    // The controllers will handle professional formatting/cleaning.
    cleanText = text;

    return {
        text: cleanText,
        images: images
    };
}

    // Helper to clean and extract JSON from AI response (handles <think> blocks and markdown)
function extractJsonFromAiResponse(rawContent) {
    let parsed = {};
    
    // 1. Remove <think>...</think> blocks (DeepSeek/Gemini reasoning)
    let cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // 2. Remove markdown code blocks (```json ... ```)
    cleanContent = cleanContent.replace(/```json/gi, '').replace(/```/g, '').trim();

    try {
        // 3. Find the first '{' and last '}' to isolate JSON object
        const firstOpen = cleanContent.indexOf('{');
        const lastClose = cleanContent.lastIndexOf('}');

        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
            cleanContent = cleanContent.substring(firstOpen, lastClose + 1);
            parsed = JSON.parse(cleanContent);
        } else {
            // No JSON structure found -> Treat as Plain Text
            // This is NORMAL for Function Calling mode when model replies naturally.
            parsed = { reply: rawContent };
        }
    } catch (e) {
        // JSON Extraction Failed -> Treat as Plain Text
        // console.warn("[AI] JSON Parse Failed, treating as text:", e.message);
        parsed = { reply: rawContent };
    }

    if (!parsed || typeof parsed !== 'object') {
        parsed = { reply: rawContent };
    }

    // NORMALIZE REPLY FIELD
    if (!parsed.reply) {
        // Check aliases
        if (parsed.response && typeof parsed.response === 'string') parsed.reply = parsed.response;
        else if (parsed.message && typeof parsed.message === 'string') parsed.reply = parsed.message;
        else if (parsed.answer && typeof parsed.answer === 'string') parsed.reply = parsed.answer;
        else if (parsed.text && typeof parsed.text === 'string') parsed.reply = parsed.text;

        // Check for Tool Call (Native or Legacy)
        const isTool = (parsed.tool && typeof parsed.tool === 'string') ||
                       (parsed.tools && Array.isArray(parsed.tools)) ||
                       (parsed.function && typeof parsed.function === 'string') ||
                       (parsed.query && typeof parsed.query === 'string'); // Legacy search

        if (!parsed.reply && !isTool) {
            // If it's just a raw string that failed parsing, assign it to reply
            if (typeof parsed === 'string') {
                parsed = { reply: parsed };
            } else {
                 // Fallback: If object but no known fields, assume it's valid data (or empty)
                 // Don't fail, just return what we have.
            }
        }
    }
    
    return parsed;
}


function extractReplyFromText(text) {
    if (!text) return "";
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            // STRICT MODE: Only accept 'reply'
            if (parsed.reply && typeof parsed.reply === 'string') {
                return parsed.reply;
            }
            // FLEXIBLE FALLBACK: Check aliases
            if (parsed.response && typeof parsed.response === 'string') return parsed.response;
            if (parsed.message && typeof parsed.message === 'string') return parsed.message;
            if (parsed.answer && typeof parsed.answer === 'string') return parsed.answer;
            if (parsed.text && typeof parsed.text === 'string') return parsed.text;

            // If reply is explicitly null, return empty string (don't return raw JSON)
            if (('reply' in parsed && parsed.reply === null) || 
                ('response' in parsed && parsed.response === null)) {
                return "";
            }

            // Detect Tool Calls and block them from being shown as text
            const keys = Object.keys(parsed);
            const hasToolShape =
                (parsed.tool && typeof parsed.tool === 'string') ||
                (parsed.tools && Array.isArray(parsed.tools)) ||
                (parsed.function && typeof parsed.function === 'string') ||
                keys.includes('query');

            if (hasToolShape) {
                // It's a tool call, return null so it doesn't get sent as text
                return null; 
            }
        }
    } catch (e) {}

    const match = text.match(/"(?:reply|response|message|answer)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match && match[1]) {
        try {
            return JSON.parse(`"${match[1]}"`);
        } catch (e) {
            return match[1];
        }
    }

    // Fallback: If it's just plain text (not JSON), return it?
    // User wants STRICT JSON. If it's not JSON, it might be a hallucination or raw text.
    // However, sometimes AI just sends text.
    // Let's allow plain text but log it.
    return text;
}

// --- AGENTIC TOOL EXECUTOR ---
async function executeTool(toolCall, pageConfig, userIdFromArgs) {
    const { name, arguments: argsString } = toolCall.function;
    const args = JSON.parse(argsString || '{}');
    const userId = pageConfig.user_id; // Store Owner ID
    const pageId = pageConfig.page_id;
    const senderId = userIdFromArgs; // Actual Customer ID

    console.log(`[AgentLoop] Executing tool: ${name}`, args);

    try {
        switch (name) {
            case 'resolve_product': {
                const query = args.query;
                const scope = args.candidates_scope;
                
                let products = await dbService.searchProducts(userId, query, pageId);
                
                // If scope provided, filter products
                if (Array.isArray(scope) && scope.length > 0) {
                    products = products.filter(p => scope.includes(String(p.id)));
                }

                if (!products || products.length === 0) {
                    return { status: 'NOT_FOUND', message: `No products found for "${query}"` };
                }

                const candidates = products.map(p => {
                    const score = computeCandidateScore(query, p);
                    
                    const normalizeUrl = (url) => {
                        if (!url || url === 'N/A') return 'N/A';
                        if (url.startsWith('http')) return url;
                        const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
                        const cleanPath = url.startsWith('/') ? url : `/${url}`;
                        return `${baseUrl.replace(/\/$/, '')}${cleanPath}`;
                    };

                    return {
                        product_id: String(p.id),
                        name: p.name,
                        price: p.price,
                        description: p.description,
                        stock: p.stock_quantity,
                        image_url: normalizeUrl(p.image_url),
                        additional_images: Array.isArray(p.additional_images) ? p.additional_images.map(normalizeUrl) : [],
                        match_score: score
                    };
                });

                // Sort by score
                candidates.sort((a, b) => b.match_score - a.match_score);

                if (candidates.length > 0) {
                    // Limit to top 3 candidates to optimize token usage
                    const formattedCandidates = candidates.slice(0, 3).map(c => 
                        `PRODUCT_DATA:
                         ID: ${c.product_id}
                         Name: ${c.name}
                         Price: ${c.price}
                         Description: ${c.description}
                         Stock: ${c.stock}
                         Image_URL: ${c.image_url}
                         Additional_Images: ${c.additional_images.join(', ')}`
                    ).join('\n---\n');

                    return { 
                        status: 'SUCCESS', 
                        found_count: candidates.length,
                        data_injection: formattedCandidates,
                        message: "I have fetched the following product data from the database. READ THIS DATA CAREFULLY. If any of these products match the user's intent (even partially, like 'Rice Cream' matching 'Rice Combo'), use the ID of the best match and provide its details."
                    };
                }

                return { 
                    status: 'NOT_FOUND', 
                    message: "No matching products found in the database. Tell the user we don't have this item."
                };
            }

            case 'get_product': {
                const productId = args.product_id;
                const product = await dbService.getProductById(productId);
                
                if (!product || String(product.user_id) !== String(userId)) {
                    return { status: 'ERROR', message: "Product not found or access denied." };
                }

                // --- PERSISTENCE: Save to Conversation State ---
                if (senderId) {
                    await dbService.setConversationState(pageId, senderId, {
                        last_product_id: productId,
                        last_intent: 'product_fetched'
                    });
                }

                return { status: 'SUCCESS', product };
            }

            case 'compute_price': {
                const lineItems = args.line_items || [];
                let total = 0;
                const breakdown = [];

                for (const item of lineItems) {
                    const product = await dbService.getProductById(item.product_id);
                    if (!product) continue;

                    let price = parsePrice(product.price);
                    // Variant logic could go here if needed
                    
                    const subtotal = price * item.qty;
                    total += subtotal;
                    breakdown.push({ name: product.name, qty: item.qty, unit_price: price, subtotal });
                }

                return { status: 'SUCCESS', total_price: total, currency: 'BDT', breakdown };
            }

            case 'check_stock': {
                const productId = args.product_id;
                const product = await dbService.getProductById(productId);
                
                if (!product) return { status: 'ERROR', message: "Product not found." };
                
                const stock = product.stock_quantity !== undefined ? product.stock_quantity : 'Unknown';
                const inStock = stock === 'Unknown' || stock > 0;

                return { status: 'SUCCESS', product_id: productId, in_stock: inStock, stock_count: stock };
            }

            case 'create_order': {
                // Just return success for AI to confirm
                return { status: 'SUCCESS', message: "Order details captured. The system will process it after confirmation." };
            }

            default:
                return { status: 'ERROR', message: `Unknown tool: ${name}` };
        }
    } catch (err) {
        console.error(`[AgentLoop] Tool execution error (${name}):`, err);
        return { status: 'ERROR', message: err.message };
    }
}

function parsePrice(value) {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    const cleanValue = String(value).replace(/[^\d.]/g, '');
    const num = parseFloat(cleanValue);
    return isFinite(num) ? num : 0;
}

// --- AGENTIC LOOP EXECUTION ---
async function runAgentLoop({ apiKey, baseURL, model, messages, tools, pageConfig, proxyAgent, totalTokenUsage, foundProducts, userId }) {
    let loopCount = 0;
    const MAX_LOOP = 3;
    let totalTokensInLoop = totalTokenUsage;

    while (loopCount < MAX_LOOP) {
        loopCount++;
        console.log(`[AgentLoop] Starting iteration ${loopCount} with ${model}...`);

        try {
            const openai = new OpenAI({ 
                apiKey: apiKey, 
                baseURL: baseURL,
                timeout: 30000,
                ...(proxyAgent ? { httpAgent: proxyAgent, httpsAgent: proxyAgent } : {})
            });

            const completion = await openai.chat.completions.create({
                model: model,
                messages: messages,
                tools: tools,
                tool_choice: "auto"
            });

            const responseMessage = completion.choices[0].message;
            const toolCalls = responseMessage.tool_calls;
            
            // Add AI's response to history
            messages.push(responseMessage);

            if (toolCalls && toolCalls.length > 0) {
                console.log(`[AgentLoop] AI requested ${toolCalls.length} tool calls.`);
                
                for (const toolCall of toolCalls) {
                    const result = await executeTool(toolCall, pageConfig, userId);
                    
                    // Push tool result back to context
                    messages.push({
                        tool_call_id: toolCall.id,
                        role: 'tool',
                        name: toolCall.function.name,
                        content: JSON.stringify(result)
                    });

                    // Keep track of found products for finalize()
                    if (result.product) {
                        foundProducts.push(result.product);
                        // Store last resolved ID in context if not already there
                        const pid = result.product.id || result.product_id;
                        if (pid) {
                            messages.push({ role: 'system', content: `[CONTEXT: LAST_RESOLVED_PRODUCT_ID: "${pid}"]` });
                        }
                    }
                }
                
                // Track tokens
                totalTokensInLoop += completion.usage ? completion.usage.total_tokens : estimateTokenUsage(messages, responseMessage.content, 0);
                
                // Continue loop to let AI process tool results
                continue;
            }

            // --- MULTI-LANGUAGE INTENT DETECTION (FOR BACKEND) ---
            // We ask the AI to summarize if the user explicitly asked for an image in this turn.
            // This is a "hidden" check that doesn't change the AI's final response content.
            const intentCheck = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: 'Output JSON only: {"wants_photo": true/false}. Based on the last user message, did they explicitly ask to see a photo, image, or link for a product?' },
                    { role: 'user', content: messages[messages.length - 2].content || "" } // The actual user message
                ],
                response_format: { type: 'json_object' }
            });
            const intentJson = JSON.parse(intentCheck.choices[0].message.content || '{"wants_photo":false}');
            if (intentJson.wants_photo) {
                messages.push({ role: 'system', content: '[INTENT_DETECTED: USER_REQUESTED_PHOTO]' });
            }

            // No more tool calls -> Final Answer
            const aiText = responseMessage.content || "";
            const tokenUsage = completion.usage ? completion.usage.total_tokens : estimateTokenUsage(messages, aiText, 0);
            
            // --- AGENTIC JSON PARSER ---
            try {
                // More robust cleaning: find the first { and last }
                const firstBrace = aiText.indexOf('{');
                const lastBrace = aiText.lastIndexOf('}');
                
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    const potentialJson = aiText.substring(firstBrace, lastBrace + 1);
                    const structured = JSON.parse(potentialJson);
                    
                    if (structured.reply_text) {
                        return { 
                            reply: structured.reply_text, 
                            action: structured.action || "NONE",
                            product_id: structured.product_id || null,
                            image_urls: Array.isArray(structured.image_urls) ? structured.image_urls : [],
                            token_usage: tokenUsage + totalTokensInLoop, 
                            model: model, 
                            foundProducts 
                        };
                    }
                } else if (aiText.trim().length > 0) {
                    // LLM sent a plain text response instead of JSON. 
                    // This happens if it forgets the JSON rule or thinks a direct answer is better.
                    // We treat it as a valid reply but with action NONE.
                    console.log(`[AgentLoop] LLM sent plain text instead of JSON. Using as reply_text.`);
                    return {
                        reply: aiText.trim(),
                        action: "NONE",
                        product_id: null,
                        token_usage: tokenUsage + totalTokensInLoop,
                        model: model,
                        foundProducts
                    };
                }
            } catch (parseErr) {
                // Not JSON or missing reply_text, fallback to raw text
                console.warn(`[AgentLoop] Response parsing failed. Fallback to raw text.`);
            }

            return { 
                reply: aiText, 
                token_usage: tokenUsage + totalTokensInLoop, 
                model: model, 
                foundProducts 
            };

        } catch (loopError) {
            console.error(`[AgentLoop] Error in iteration ${loopCount}:`, loopError.message);
            if (loopCount === 1) throw loopError; 
            break; 
        }
    }

    return { 
        reply: "দুঃখিত, আমি আপনার অনুরোধটি প্রসেস করতে পারছি না। দয়া করে আবার চেষ্টা করুন বা সরাসরি আমাদের মেসেজ দিন।", 
        error: "AgentLoop max iterations reached",
        token_usage: totalTokensInLoop,
        model: model
    };
}

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer', ownerName = 'Automation Hub BD', senderGender = null, imageUrls = [], audioUrls = [], extraTokenUsage = 0, userId = null) {
    // Acquire Slot to prevent CPU Spikes
    await acquireAiSlot();

    // --- SAFETY FIX: Ensure names are not null ---
    if (!senderName || senderName === 'null') senderName = 'Customer';
    if (!ownerName || ownerName === 'null') ownerName = 'Automation Hub BD';

    // --- CONVERSATION STATE: Fetch Last Product Context ---
    let lastProductContext = null;
    if (userId && pageConfig.page_id) {
        try {
            const state = await dbService.getConversationState(pageConfig.page_id, userId);
            if (state && state.last_product_id) {
                lastProductContext = `[CONTEXT: LAST_RESOLVED_PRODUCT_ID: "${state.last_product_id}"] (Note: User is likely referring to this product if they say "it", "this", or "how to use" without naming it.)`;
            }
        } catch (e) {
            console.warn("[AI Context] Failed to fetch conv state:", e.message);
        }
    }

    // --- SMART HISTORY PROCESSOR ---
    // User Requirement: "system memory ta read korte partese na"
    // Solution: Many providers (Gemini) ignore 'system' roles in middle of history.
    // We merge 'system' notes into the NEXT message to ensure LLM sees them.
    const processedHistory = [];
    let pendingSystemNotes = [];

    // Inject last product context if available
    if (lastProductContext) {
        pendingSystemNotes.push(lastProductContext);
    }

    for (const msg of (history || [])) {
        if (msg.role === 'system') {
            pendingSystemNotes.push(msg.content);
        } else if (pendingSystemNotes.length > 0) {
            // Merge pending notes into this message (User or Assistant)
            processedHistory.push({
                ...msg,
                content: `${pendingSystemNotes.join('\n')}\n${msg.content}`
            });
            pendingSystemNotes = [];
        } else {
            processedHistory.push(msg);
        }
    }

    // 0. Unified Logger Helper (Defined at top to avoid Hoisting/Initialization errors)
    const finalize = async (result) => {
        // Release slot before finishing
        releaseAiSlot();

        if (!result) return null;
        
        // --- 1. Log to AI Usage Logs (ai_usage_logs table) ---
        // This is the main log table for the dashboard.
        // User request: "ai usagees logs null hoye ase"
        try {
            // Debug: Log incoming data to console to see what we're sending to DB
            console.log(`[AI Logger] Finalizing response for User: ${pageConfig.user_id}, Page: ${pageConfig.page_id}`);
            
            const isRequestBilling = pageConfig.billing_mode === 'request' || pageConfig.is_external_api === true;
            const displayModel = pageConfig.display_model || pageConfig.chat_model || result.model || finalModel || 'unknown';
            const usageTokens = isRequestBilling ? 1 : (result.token_usage || 0);
            const cost = isRequestBilling
                ? dbService.calculateRequestCost(displayModel, 1)
                : dbService.calculateCost(displayModel, usageTokens);
            
            const logData = {
                user_id: pageConfig.user_id,
                page_id: pageConfig.page_id,
                model: displayModel,
                prompt_tokens: 0, // We usually have total_tokens in token_usage
                completion_tokens: 0,
                total_tokens: usageTokens,
                cost: cost,
                status: result.error ? 'error' : 'success',
                error_message: result.error || null,
                sender_name: senderName || 'Customer',
                user_message: userMessage || '',
                ai_reply: result.reply || (result.error ? `Error: ${result.error}` : null)
            };
            
            // Call dbService to log this. (Fire and forget, but with internal catch)
            if (dbService.logAiUsage) {
                dbService.logAiUsage(logData).catch(err => {
                    console.error("[AI Logger] dbService.logAiUsage error:", err.message);
                });
            } else {
                console.warn("[AI Logger] dbService.logAiUsage is not defined!");
            }
        } catch (err) {
            console.warn("[AI Logger] Error preparing logData:", err.message);
        }

        // --- 2. Log to API Usage Stats (api_usage_stats table) ---
        if (pageConfig.user_id && (result.token_usage > 0 || pageConfig.is_external_api === true || pageConfig.billing_mode === 'request')) {
            const isRequestBilling = pageConfig.billing_mode === 'request' || pageConfig.is_external_api === true;
            const displayModel = pageConfig.display_model || pageConfig.chat_model || result.model || finalModel || 'unknown';
            const usageTokens = isRequestBilling ? 1 : (result.token_usage || 0);
            const cost = isRequestBilling
                ? dbService.calculateRequestCost(displayModel, 1)
                : dbService.calculateCost(displayModel, usageTokens);
            // Fire and forget (don't await to keep response fast)
            dbService.logApiUsage(pageConfig.user_id, displayModel, usageTokens, cost);
        }

        // --- 3. Force Flush Key Stats to DB ---
        if (keyService.flushUsageStats) {
            keyService.flushUsageStats(); 
        }
        
        return result;
    };

    // --- MULTI-TENANCY SAFETY CHECK ---
    const pageId = pageConfig.page_id;
    
    // Check Cheap Engine Flag (Default to TRUE if undefined/null, for zero-cost)
    const useCheapEngine = pageConfig.cheap_engine !== false;

    const promptPreview = pagePrompts?.text_prompt ? pagePrompts.text_prompt.substring(0, 30) : "DEFAULT";
    console.log(`[AI Isolation Check] Generating for Page ID: ${pageId} | CheapEngine: ${useCheapEngine} | Sender: ${senderName} | Prompt: "${promptPreview}..."`);
    // ----------------------------------

    let totalTokenUsage = extraTokenUsage || 0;
    let cleanUserMessage = userMessage;

    // 0. Pre-process Media (Images/Audio) -> Text
    
    // Extract images from User Message if any
    const imageMatch = userMessage.match(/\[User sent images: (.*?)\]/);
    if (imageMatch && imageMatch[1]) {
         const extracted = imageMatch[1].split(',').map(url => url.trim());
         imageUrls = [...imageUrls, ...extracted];
         cleanUserMessage = userMessage.replace(imageMatch[0], '').trim(); 
    }

    let mediaContext = "";
    
    if (imageUrls && imageUrls.length > 0) {
        console.log(`[AI] Processing ${imageUrls.length} images...`);
        // Use per-page vision prompt if available (no backend default)
        const visionPrompt = pagePrompts && (pagePrompts.image_prompt || pagePrompts.vision_prompt)
            ? (pagePrompts.image_prompt || pagePrompts.vision_prompt)
            : "";
        const imageResults = await Promise.all(
            imageUrls.map(url => processImageWithVision(url, pageConfig, { prompt: visionPrompt }))
        );
        
        // Extract text and usage
        const imageDescriptions = imageResults.map(res => {
            if (typeof res === 'object') {
                totalTokenUsage += (res.usage || 0);
                return res.text;
            }
            return res; // Fallback string
        });

        mediaContext += "\n[Image Analysis Result]\n" + imageDescriptions.map((desc, i) => `Image ${i+1}: ${desc}`).join("\n");
    }

    if (audioUrls && audioUrls.length > 0) {
        console.log(`[AI] Processing ${audioUrls.length} audio files...`);
        const audioResults = await Promise.all(audioUrls.map(async url => {
            // User Request: "automatic na ami ovveride korle work korbe"
            // Solution: REMOVED automatic Groq override.
            // It will now strictly follow what is in pageConfig (which comes from frontend).
            // If frontend says 'openrouter', it will try openrouter. If frontend says 'groq', it will use groq.
            
            const res = await transcribeAudio(url, pageConfig);
            if (typeof res === 'object') {
                totalTokenUsage += (res.usage || 0);
                return res.text;
            }
            return res;
        }));
        mediaContext += "\n[System Note: User sent audio messages:]\n" + audioResults.join("\n");
    }

    if (mediaContext) {
        cleanUserMessage += "\n" + mediaContext;
        console.log(`[AI] Added media context to user message. Total Tokens so far: ${totalTokenUsage}`);
    }

    // --- PRODUCT SNAPSHOT INJECTION (Prompt-Only Mode) ---
    let productContext = "";
    let foundProducts = [];

    if (pageConfig.user_id && cleanUserMessage) {
        try {
            const normalizeUrl = (url) => {
                if (!url || url === 'N/A') return 'N/A';
                if (url.startsWith('http')) return url;
                const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
                const cleanPath = url.startsWith('/') ? url : `/${url}`;
                return `${baseUrl}${cleanPath}`;
            };

            const candidates = await dbService.searchProducts(pageConfig.user_id, cleanUserMessage, pageConfig.page_id);
            if (candidates && candidates.length > 0) {
                const topCandidates = candidates.slice(0, 5);
                productContext = "[PRODUCT LIST SNAPSHOT - FROM PRODUCT ENTRY]\n";
                topCandidates.forEach((p, idx) => {
                    const priceValue = p.price ? `${p.price} ${p.currency || ''}`.trim() : 'Ask for Price';
                    productContext += `${idx + 1}) ${p.name}\n`;
                    productContext += `   ID: ${p.id}\n`;
                    productContext += `   Price: ${priceValue}\n`;
                    if (p.description) productContext += `   Description: ${p.description}\n`;
                    if (p.image_url) productContext += `   Image: ${normalizeUrl(p.image_url)}\n`;
                    if (Array.isArray(p.additional_images) && p.additional_images.length > 0) {
                        productContext += `   More Images: ${p.additional_images.map(normalizeUrl).join(', ')}\n`;
                    }
                });
                productContext += "\n";
                console.log(`[AI] Injected ${topCandidates.length} product snapshot items for query.`);
            }
        } catch (err) {
            console.warn("[AI] Product snapshot injection failed:", err.message);
        }
    }
    // ----------------------------------------------------

    // 1. Prepare Configuration
    // User Request: "vaii tumi defult keno add dicco ? ami fronted e save kore dibo best model ta amr motabek kono engine e nijer teke defult e work korbe na"
    // Solution: REMOVE ALL FALLBACKS.
    // If frontend config is missing, THROW ERROR.

    const userProvider = pageConfig.ai || pageConfig.operator || pageConfig.ai_provider; 
    let userModel = (pageConfig.chat_model && pageConfig.chat_model !== 'default') ? pageConfig.chat_model.trim() : null;

    if (!userProvider) {
         console.error("[AI] Fatal: No AI Provider selected in pageConfig.");
         throw new Error("AI Provider not configured. Please select a provider in settings.");
    }

    if (!userModel) {
         console.error("[AI] Fatal: No Chat Model selected in pageConfig.");
         throw new Error("Chat Model not configured. Please select a model in settings.");
    }

    let defaultProvider = userProvider;
    let defaultModel = userModel;

    console.log(`[AI] Engine Config (Strict): Provider=${defaultProvider}, Model=${defaultModel}`);

    // --- MODEL NAME NORMALIZATION & ALIASES ---
    // User Request: REMOVED ALL HARDCODED MAPPINGS.
    // Use exactly what is provided by the configuration.
    
    // --- DYNAMIC BEST MODEL LOGIC REMOVED ---
    // User Request: "salesmanchatbot flash and lite eo same" (No fallbacks)
    
    // -------------------------------------------------
    
    // --- MEDIA HANDLING COMPLETED ABOVE ---
    // (Consolidated into Pre-process Media step to ensure correct token tracking)
    // ----------------------------------------

    // --- PROMPT & MESSAGE CONSTRUCTION ---
    let messages = [];
    // User Update: Default to JSON Object for reliability
    // UPDATE: For Function Calling, we MUST NOT force JSON object unless we explicitly want a JSON response body.
    // If we force JSON, the model might try to output JSON even when it should be calling a tool or talking normally.
    // We let the model decide (auto) or default to text.
    let responseFormat = undefined; 
    
    // --- TOOL ENABLING LOGIC ---
    // We always provide tools to the AI (unless external API). 
    // The AI will decide whether to call them based on the Business Owner's instructions.
    const toolsEnabled = !pageConfig.is_external_api;
    const tools = toolsEnabled ? functionTools : undefined;

    if (pageConfig.is_external_api) {
        // --- EXTERNAL API MODE (Minimal & White Label) ---
        // Strictly white-labeling instructions per user request.
        const whiteLabelInstruction = "You are SalesmanChatbot, a high-performance AI developed by SalesmanChatbot team. You are NOT Google Gemini, OpenAI, Meta, or any other company's model. If asked about your identity, maintain that you are a proprietary SalesmanChatbot AI.";
        
        const userSystemPrompt = pagePrompts?.text_prompt || "";
        const finalSystemPrompt = `${whiteLabelInstruction}\n\n${userSystemPrompt}\n\n${productContext || ""}`.trim();

        let finalUserMsg = cleanUserMessage;
        if (pendingSystemNotes.length > 0) {
            finalUserMsg = `${pendingSystemNotes.join('\n')}\n${finalUserMsg}`;
        }

        messages = [
            { role: 'system', content: finalSystemPrompt },
            ...processedHistory,
            { role: 'user', content: finalUserMsg }
        ];
        
        // Disable strict JSON enforcement for external API (allow natural text)
        responseFormat = undefined; 
        console.log(`[AI] External API Mode: Skipping n8n System Prompt.`);

    } else {
        let basePrompt = pagePrompts?.text_prompt || "";

        if (!basePrompt || !basePrompt.trim()) {
            basePrompt = "";
        }

    const n8nSystemPrompt = `[CORE SYSTEM RULES]
    - You are an AI Salesman for "${ownerName}".
    - Output MUST be a valid JSON object only. No plain text.
    - reply_text: Human-like response. (Professional, NO raw URLs, NO "click here" phrases)
    - action: ["NONE", "SEND_DETAILS", "SEND_PHOTO", "SEND_BOTH"]
    - product_id: UUID of the matched product.
    - image_urls: Array of image URLs to attach.
    
    [WORKFLOW & DIRECTNESS]
    1. Call 'resolve_product' for any item mentioned.
    2. Read the returned data. Pick the best match (e.g., 'Rice Cream' matches 'Rice Combo').
    3. If user sends an image, analyze the '[Image Analysis Result]' provided in the context.
    4. If the image analysis describes a product (e.g. "Rice Water Bright Cleanser"), immediately call 'resolve_product' for that item to get its real data (price, stock, etc.).
    5. BE DECISIVE: If a user asks for a photo or sends an image, provide relevant product details immediately.
    6. CRITICAL: 'reply_text' MUST be pure human-like text.
    7. NO technical symbols ([, ], {, }, \\) or URLs are allowed in 'reply_text'. 
    8. Any message with URLs or technical tags will be AUTOMATICALLY BLOCKED by the system and never sent to the customer.
    9. All image delivery is handled by the backend using your 'image_urls' array.

    [RESPONSE FORMAT]
    {
      "reply_text": "...",
      "action": "...",
      "product_id": "...",
      "image_urls": ["url1", "url2"],
      "intent": "..."
    }`;

        const systemMessage = { role: 'system', content: n8nSystemPrompt };
        const ownerInstructionText = `${basePrompt}\n\n${productContext || ""}`.trim();
        const ownerInstructionMessage = { 
            role: 'system', 
            content: `[BUSINESS OWNER'S SPECIFIC INSTRUCTIONS - MANDATORY]
            ${ownerInstructionText}
            
            [FINAL DIRECTIVE]
            1. You MUST follow the tone, language, and behavior defined above. 
            2. Output ONLY the raw JSON object. Do not wrap it in markdown code blocks. No other text.` 
        };
    
        // Deduplicate: If the last message in history is identical to the current user message, don't add it again.
        const lastHistoryMsg = processedHistory.length > 0 ? processedHistory[processedHistory.length - 1] : null;
        let isDuplicate = false;
        
        if (lastHistoryMsg && lastHistoryMsg.role === 'user') {
            const histContent = typeof lastHistoryMsg.content === 'string' ? lastHistoryMsg.content.trim() : JSON.stringify(lastHistoryMsg.content);
            const currContent = cleanUserMessage.trim();
            if (histContent === currContent) {
                isDuplicate = true;
            }
        }

        // Merge remaining notes into current user message
        if (pendingSystemNotes.length > 0) {
            cleanUserMessage = `${pendingSystemNotes.join('\n')}\n${cleanUserMessage}`;
        }

        messages = [
            systemMessage,
            ...processedHistory
        ];

        if (!isDuplicate) {
            messages.push({ role: 'user', content: cleanUserMessage });
        }

        // Final enforcement message at the VERY END of the array to ensure highest priority
        messages.push(ownerInstructionMessage);
    }

    // --- UNIFIED AI REQUEST LOGIC ---
    const isOurOwnProvider = defaultProvider === 'salesmanchatbot' || defaultProvider === 'system';

    // SPECIAL PATH: Use Own SalesmanChatbot API when selected
    if (!useCheapEngine && defaultProvider === 'salesmanchatbot' && pageConfig.api_key) {
        try {
            const axios = require('axios');
            // FIX: Use absolute URL for Production to avoid 'localhost' issues in external API calls
            // Standardizing URL to match n8n and external integration expectations
            const base = process.env.PUBLIC_BASE_URL 
                ? `${process.env.PUBLIC_BASE_URL}/api/external/v1/chat/completions`
                : (process.env.SALESMANCHATBOT_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}/api/external/v1/chat/completions`);
            
            const modelToUse = (pageConfig.chat_model || 'salesmanchatbot-pro');
            const payload = {
                model: modelToUse,
                messages: messages,
            };
            const headers = {
                'Authorization': `Bearer ${pageConfig.api_key}`,
                'Content-Type': 'application/json'
            };
            
            console.log(`[AI] SalesmanChatbot Own API: Calling ${base} with model=${modelToUse}`);
            const resp = await axios.post(base, payload, { headers, timeout: 25000 });
            const data = resp.data;
            let aiText = data?.choices?.[0]?.message?.content || null;
            const tokenUsage = data?.usage?.total_tokens || 0;

            if (aiText) {
                // --- NEW AGENTIC JSON PARSER ---
                try {
                    // Strip potential Markdown blocks if AI ignored instructions
                    const cleanJson = aiText.replace(/```json|```/g, '').trim();
                    const structured = JSON.parse(cleanJson);
                    
                    if (structured.reply_text) {
                        return finalize({ 
                            reply: structured.reply_text, 
                            action: structured.action || "NONE",
                            product_id: structured.product_id || null,
                            image_urls: Array.isArray(structured.image_urls) ? structured.image_urls : [],
                            sentiment: 'neutral', 
                            token_usage: tokenUsage + totalTokenUsage, 
                            model: modelToUse, 
                            foundProducts 
                        });
                    }
                } catch (parseErr) {
                    console.warn(`[AI Agent] Failed to parse JSON response. Falling back to raw text.`, parseErr.message);
                }
                
                return finalize({ reply: aiText, sentiment: 'neutral', token_usage: tokenUsage + totalTokenUsage, model: modelToUse, foundProducts });
            }
        } catch (error) {
            const statusCode = error.response ? error.response.status : 'N/A';
            const errorMsg = error.response?.data?.error?.message || error.message;
            console.warn(`[AI] SalesmanChatbot Own API Error (${statusCode}):`, errorMsg);
            
            return finalize({ 
                reply: null, 
                error: `[AI Error - Silent] Strict Domain Control (Null Reply) | AI Provider Error: ${statusCode} ${errorMsg}`,
                token_usage: 0,
                model: pageConfig.chat_model || 'salesmanchatbot-pro'
            });
        }
    }

    // PHASE 1: Try User-Provided Keys
    let userKeyAttempted = false;
    if (!useCheapEngine && !isOurOwnProvider && pageConfig.api_key && pageConfig.api_key !== 'MANAGED_SECRET_KEY') {
        userKeyAttempted = true;
        const userKeys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
        // Shuffle keys
        for (let i = userKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [userKeys[i], userKeys[j]] = [userKeys[j], userKeys[i]];
        }

        for (const currentKey of userKeys) {
            let currentProvider = defaultProvider;
            
            // Priority: If user explicitly selected 'custom' provider in UI, force it regardless of key format
            if (defaultProvider === 'custom') {
                currentProvider = 'custom';
            } else {
                // Auto-detect based on key format only if not custom
                if (currentKey.startsWith('sk-or-v1')) currentProvider = 'openrouter';
                else if (currentKey.startsWith('AIzaSy')) currentProvider = 'google';
                else if (currentKey.startsWith('gsk_')) currentProvider = 'groq';
                else if (currentKey.startsWith('xai-')) currentProvider = 'xai';
            }

            let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            if (currentProvider.includes('openrouter')) baseURL = 'https://openrouter.ai/api/v1';
            else if (currentProvider.includes('openai')) baseURL = 'https://api.openai.com/v1';
            else if (currentProvider.includes('groq')) baseURL = 'https://api.groq.com/openai/v1';
            else if (currentProvider.includes('xai')) baseURL = 'https://api.x.ai/v1';
            else if (currentProvider.includes('mistral')) baseURL = 'https://api.mistral.ai/v1';
            else if (currentProvider === 'custom' && pageConfig.custom_base_url) {
                 baseURL = pageConfig.custom_base_url;
                 console.log(`[AI] Using Custom Base URL: ${baseURL}`);
            }

            try {
                const useProxy = (currentProvider.includes('google') || currentProvider.includes('gemini') || currentProvider.includes('groq')) && !currentKey;
                const proxyAgent = getGeminiProxyAgent(baseURL, useProxy);
                
                let modelToUse = pageConfig.chat_model;
                if (!modelToUse) {
                     throw new Error("No model selected for Own API. Please select a model in your settings.");
                }

                console.log(`[AI] Phase 1: Calling User Key AgentLoop (${currentProvider}/${modelToUse})...`);

                const result = await runAgentLoop({
                    apiKey: currentKey,
                    baseURL: baseURL,
                    model: modelToUse,
                    messages: messages,
                    tools: tools,
                    pageConfig: pageConfig,
                    proxyAgent: proxyAgent,
                    totalTokenUsage: totalTokenUsage,
                    foundProducts: [],
                    userId: userId
                });

                return finalize({ ...result, sentiment: 'neutral' });

            } catch (error) {
                console.warn(`[AI] Phase 1 Key Failed:`, error.message);
                
                // --- TOKEN TRACKING FOR FAILED REQUESTS ---
                // Even if it failed, we likely consumed input tokens or at least attempted a request.
                // We should log this as a "failed" attempt but count it towards usage if possible.
                // Since we don't have exact usage from error, we estimate based on input messages.
                const estimatedInputTokens = estimateTokenUsage(messages, '', 0);
                try {
                    // Record usage with 0 output tokens. Status will be handled by caller if needed.
                    // We use a special flag or just log it.
                    // For now, let's just log it to DB so it appears in dashboard.
                    await dbService.saveAIUsageLog({
                        user_id: pageConfig.user_id,
                        model: modelToUse || 'unknown',
                        tokens: estimatedInputTokens,
                        cost: 0, // Maybe charge for input? For now 0 to be safe.
                        context: 'failed_attempt'
                    });
                } catch(e) {}

                // STRICT OWN API LOCK: If we are here, it means the User provided their own API key.
                // If it fails (invalid key, quota exceeded, etc.), we MUST NOT fallback to our Cloud API.
                console.error(`[AI] Strict Own API Failed. Blocking Cloud API fallback for security & isolation.`);
                return finalize({ 
                    reply: null, // Returning null ensures the controller knows the request failed strictly.
                    // User Request: Show EXACT reason why failed.
                    error: `[Strict Own API Error] ${error.message}. Please check your API settings or limits in the dashboard.`,
                    token_usage: estimatedInputTokens, // Return estimated usage
                    model: pageConfig.chatmodel || defaultModel 
                });
            }
        }
    }

    // HELPER: Error Handler for Rate Limits
    const handleAiError = (error, apiKey, modelName) => {
        const status = error.status || (error.response ? error.response.status : null);
        const responseError = error.response?.data?.error || {};
        const responseMessage = `${responseError.message || ''} ${responseError.status || ''}`.toLowerCase();
        const rawMessage = `${error.message || ''}`.toLowerCase();
        const errorCode = `${responseError.code || responseError.type || responseError.status || ''}`.toLowerCase();
        const isSuspended = errorCode.includes('consumer_suspended') || responseMessage.includes('consumer_suspended') || rawMessage.includes('consumer_suspended');
        if (status === 429 || rawMessage.includes('429') || rawMessage.includes('quota') || rawMessage.includes('too many requests')) {
            if (rawMessage.includes('quota')) {
                keyService.markKeyAsQuotaExceeded(apiKey);
            } else {
                keyService.markKeyAsDead(apiKey, 60 * 1000, `rate_limit_${modelName}`);
            }
        } else if (status === 401 || status === 403) {
            if (isSuspended) {
                keyService.markKeyAsSuspended(apiKey, 'consumer_suspended');
            } else {
                keyService.markKeyAsDead(apiKey, 24 * 60 * 60 * 1000, 'auth_error');
            }
        } else if (status >= 500) {
            keyService.markKeyAsDead(apiKey, 60 * 1000, 'server_error');
        }
    };

    // PHASE 2: SALESMANCHATBOT ENGINE (SMART ROUTING) ---
    // User Request: If User provided their own key and it was attempted, STOP HERE.
    if (userKeyAttempted) {
        console.warn(`[AI] Phase 1 was attempted but failed or was invalid. Strict Isolation Active: Blocking Cloud API fallback.`);
        // Revert to Strict Error Mode as requested by user.
        // User wants to see the EXACT reason why their key failed, not a silent fallback.
        return finalize({ 
            reply: null, 
            error: "আপনার দেওয়া এপিআই কী-তে সমস্যা দেখা দিয়েছে অথবা লিমিট শেষ হয়ে গেছে। দয়া করে ড্যাশবোর্ড থেকে আপনার কী চেক করুন।",
            token_usage: 0,
            model: pageConfig.chat_model || defaultModel
        });
    }

    console.log(`[AI] Phase 2: SalesmanChatbot Engine Smart Routing...`);

    // 1. Resolve Modality
    let isVision = false;
    let isAudio = false;
    if (imageUrls && imageUrls.length > 0) isVision = true;
    if (audioUrls && audioUrls.length > 0) isAudio = true;

    const resolved = await resolveSalesmanchatbotEngine(pageConfig, defaultProvider, defaultModel, isVision, isAudio);
    let finalProvider = resolved.finalProvider;
    let finalModel = resolved.finalModel;

    const currentModel = finalModel;
    
    let keyData = null;
    try {
        // Special Handling for Provider Overrides:
        // If finalProvider changed (e.g. OpenRouter -> Groq for Voice), we must query keys for THAT provider.
        keyData = await keyService.getSmartKey(finalProvider, currentModel);
        
        // Fallback: If specific model key not found, try default key for that provider
        if (!keyData || !keyData.key) {
             keyData = await keyService.getSmartKey(finalProvider, 'default');
        }

        if (!keyData || !keyData.key) {
            console.warn(`[AI] No valid keys for ${finalProvider}/${currentModel}.`);
            return finalize({ 
                reply: "দুঃখিত, বর্তমানে এই সার্ভিসে কোনো অ্যাক্টিভ কী নেই। দয়া করে এডমিন প্যানেল থেকে এপিআই কী চেক করুন।", 
                error: `No active keys for ${finalProvider}`,
                token_usage: 0,
                model: currentModel
            });
        }

        const apiKey = keyData.key;
        let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        
        // DYNAMIC BASE URL MAPPING
        if (finalProvider === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';
        else if (finalProvider === 'groq') baseURL = 'https://api.groq.com/openai/v1';
        else if (finalProvider === 'openai') baseURL = 'https://api.openai.com/v1';
        else if (finalProvider === 'mistral') baseURL = 'https://api.mistral.ai/v1';
        else if (finalProvider === 'google' || finalProvider === 'gemini') baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        
        let rawContent = '';
        let tokenUsage = 0;
        let usedCache = false;
        const isFreeModel = typeof currentModel === 'string' && currentModel.includes(':free');

        // --- GEMINI CACHING PATH ---
        // User Requirement: "suno amader gemini engine e eta disable tak but use own api e enable tak"
        // Meaning: Only enable caching if the user provided their own API key (Phase 1 or Own API Mode).
        // If we are using System Keys (Phase 2), caching MUST be disabled to avoid hitting limits on free tier keys.
        
        const isUserKey = pageConfig.api_key && pageConfig.api_key !== 'MANAGED_SECRET_KEY' && apiKey === pageConfig.api_key;
        const shouldUseCache = isUserKey && (finalProvider === 'google' || finalProvider === 'gemini');

        if (shouldUseCache && messages.length > 0 && messages[0].role === 'system') {
            const systemContent = messages[0].content;
            // Only use cache if system prompt is large enough (>2000 chars) to matter
            // Raised limit to 2000 chars to ensure it's worth the cache creation cost
            if (systemContent.length > 2000) {
                const cacheName = await getOrCreateGeminiCache(apiKey, currentModel, systemContent);
                if (cacheName) {
                    try {
                        console.log(`[AI] Using Gemini Cache (User Key): ${cacheName}`);
                        const genAI = new GoogleGenerativeAI(apiKey);
                        const model = genAI.getGenerativeModelFromCachedContent(cacheName);
                        
                        const geminiHistory = messages.slice(1).map(m => ({
                            role: m.role === 'assistant' ? 'model' : 'user',
                            parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
                        }));

                        const result = await model.generateContent({
                            contents: geminiHistory,
                            generationConfig: { responseMimeType: "application/json" }
                        });

                        rawContent = result.response.text();
                        tokenUsage = result.response.usageMetadata ? result.response.usageMetadata.totalTokenCount : 0;
                        usedCache = true;
                        console.log(`[AI] Gemini Cache Hit! Tokens: ${tokenUsage}`);

                        // --- AGENTIC JSON PARSER (FOR CACHE) ---
                        try {
                            const cleanJson = rawContent.replace(/```json|```/g, '').trim();
                            const structured = JSON.parse(cleanJson);
                            
                            if (structured.reply_text) {
                                return finalize({ 
                                    reply: structured.reply_text, 
                                    action: structured.action || "NONE",
                                    product_id: structured.product_id || null,
                                    image_urls: Array.isArray(structured.image_urls) ? structured.image_urls : [],
                                    sentiment: 'neutral', 
                                    token_usage: tokenUsage + totalTokenUsage, 
                                    model: currentModel, 
                                    foundProducts 
                                });
                            }
                        } catch (parseErr) {
                            console.warn(`[AI Cache] Cache response not in expected JSON format. Content: ${rawContent.substring(0, 50)}...`);
                        }

                        return finalize({ 
                            reply: rawContent, 
                            sentiment: 'neutral', 
                            token_usage: tokenUsage + totalTokenUsage, 
                            model: currentModel, 
                            foundProducts 
                        });
                    } catch (cacheError) {
                        console.warn(`[AI] Gemini Cache Execution Failed: ${cacheError.message}. Falling back.`);
                    }
                }
            }
        }

        console.log(`[AI] Phase 2: Calling SalesmanChatbot AgentLoop (${finalProvider}/${currentModel})...`);

        const result = await runAgentLoop({
            apiKey: apiKey,
            baseURL: baseURL,
            model: currentModel,
            messages: messages,
            tools: tools,
            pageConfig: pageConfig,
            proxyAgent: proxyAgent,
            totalTokenUsage: totalTokenUsage,
            foundProducts: [],
            userId: userId
        });

        return finalize({ ...result, sentiment: 'neutral' });

    } catch (err) {
        console.error(`[AI] Phase 2 Logic Failed:`, err);
        return finalize({ 
            reply: "দুঃখিত, বর্তমানে আমাদের সার্ভারে কিছু টেকনিক্যাল সমস্যা হচ্ছে। দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন।", 
            error: err.message,
            token_usage: 0,
            model: currentModel
        });
    }
}

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'e9457ca133cc4d73854ee0d43cee3bc5';

// --- HELPER: Process Image (Vision) with Smart Fallback ---
async function processImageWithVision(imageUrl, pageConfig = {}, customOptions = null) {
    let base64Image = null;
    let mimeType = null;
    let errors = [];

    // Helper to ensure we have Base64 data (Lazy Loading)
    const ensureBase64 = async () => {
        if (base64Image) return; // Already loaded

        try {
            if (imageUrl.startsWith('data:')) {
                console.log(`[Vision] Processing Base64 Data URI...`);
                const parts = imageUrl.split(',');
                if (parts.length >= 2) {
                    const mimeMatch = parts[0].match(/:(.*?);/);
                    mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                    base64Image = parts.slice(1).join('').replace(/\s/g, '');
                } else {
                    throw new Error("Invalid Data URI format");
                }
            } else {
                console.log(`[Vision] Downloading image from URL for Base64 fallback: ${imageUrl.substring(0, 50)}...`);
                const headers = { 'User-Agent': 'Mozilla/5.0' };
                if (imageUrl.includes(WAHA_BASE_URL) || imageUrl.includes('wahubbd.salesmanchatbot.online')) {
                    headers['X-Api-Key'] = WAHA_API_KEY;
                } else if (imageUrl.includes('graph.facebook.com') && pageConfig.page_access_token) {
                    headers['Authorization'] = `Bearer ${pageConfig.page_access_token}`;
                }

                const response = await axios.get(imageUrl, { 
                    responseType: 'arraybuffer',
                    headers: headers,
                    timeout: 10000 
                });
                base64Image = Buffer.from(response.data).toString('base64');
                mimeType = response.headers['content-type'] || 'image/jpeg';
                logDebug(`[Vision] Image Downloaded. Mime: ${mimeType}, Size: ${base64Image.length}`);
            }
        } catch (e) {
            throw new Error(`Image Pre-processing Failed: ${e.message}`);
        }
    };

    const maxTokens = Number(customOptions?.max_tokens) > 0 ? Number(customOptions.max_tokens) : 120;

    // Determine System Prompt
    let systemPrompt = typeof customOptions?.prompt === 'string' && customOptions.prompt.trim() !== "" 
        ? customOptions.prompt 
        : `Extract the exact product name from this image.
Rules:
- Output must start with: Product:
- Include brand + full product name.
- Include size if visible.
- Ignore price, offer, discount text.
- Do not explain anything.
- Do not add extra words.
- Single line output only.`;

    let resolved = null;
    const providerHint = pageConfig.ai_provider || pageConfig.ai || pageConfig.operator;
    const modelHint = pageConfig.chat_model || pageConfig.chatmodel;
    if (providerHint === 'salesmanchatbot' || modelHint === 'salesmanchatbot-pro' || modelHint === 'salesmanchatbot-flash' || modelHint === 'salesmanchatbot-lite') {
        resolved = await resolveSalesmanchatbotEngine(pageConfig, providerHint, modelHint, true, false);
    }

    // --- PRIORITY ATTEMPT (Custom Options) ---
    if (customOptions?.provider === 'openrouter' && customOptions?.model) {
        try {
            const provider = 'openrouter';
            const model = customOptions.model;
            console.log(`[Vision] Priority Attempt: ${model} (${provider})`);

            let keyData = await keyService.getSmartKey(provider, model);
            if (!keyData || !keyData.key) keyData = await keyService.getSmartKey(provider, 'default');
            if (!keyData || !keyData.key) throw new Error("No Key found for OpenRouter");

            const apiKey = keyData.key;
            
            // USE URL DIRECTLY IF POSSIBLE (User Preference)
            // But if it's a private URL (like FB/WAHA), we MUST use Base64.
            // If we already downloaded it (base64Image exists), use Base64 to be safe.
            let imageContent;
            if (base64Image) {
                 imageContent = { url: `data:${mimeType};base64,${base64Image}` };
            } else {
                 imageContent = { url: imageUrl };
            }

            const payload = {
                model: model,
                max_tokens: maxTokens,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [{ type: "image_url", image_url: imageContent }]
                    }
                ]
            };

            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://orderly-conversations.com', 
                    'X-Title': 'Orderly Conversations'
                },
                timeout: 40000 // Increased timeout for heavy models
            });

            const result = response.data?.choices?.[0]?.message?.content;
            const usage = response.data?.usage?.total_tokens || 0;
            if (!result) throw new Error("Empty response from OpenRouter");

            logDebug(`[Vision] Success with Priority ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
            return { text: result, usage: usage };

        } catch (error) {
            const errMsg = error.response?.data?.error?.message || error.message;
            console.warn(`[Vision] Priority Attempt (${customOptions.model}) Failed: ${errMsg}`);
            errors.push(`Priority OpenRouter: ${errMsg}`);
            // Continue to fallbacks...
        }
    }

    // --- FALLBACK STRATEGY ---
    
    // ATTEMPT 1: User Model / Gemini 2.0 Flash (Requires Base64)
    try {
        await ensureBase64(); // Load Base64 for Google/OpenRouter

        let provider = 'google';
        let model;
        let apiKey;

        if (pageConfig.cheap_engine === false) {
             // Paid User: STRICTLY use configured model.
             // User Request: Use specific models for specific tasks if available.
             const userModel = pageConfig.vision_model || pageConfig.chat_model || pageConfig.chatmodel;
             
             if (userModel) {
                 model = userModel;
             } else {
                 return { text: "Error: No Vision/Chat Model selected in configuration for Own API.", usage: 0 };
             }

            if (pageConfig.api_key) {
                const userKeys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
                if (userKeys.length > 0) apiKey = userKeys[0];
            }

            if (providerHint === 'salesmanchatbot') {
                apiKey = null;
            }
            
            if (apiKey && apiKey.startsWith('salesmanchatbot-')) {
                apiKey = null;
            }

             // Detect Provider from Key or Config
             if (apiKey) {
                 if (apiKey.startsWith('sk-or-v1')) provider = 'openrouter';
                 else if (apiKey.startsWith('AIza')) provider = 'google';
                 else if (apiKey.startsWith('gsk_')) provider = 'groq';
             }

            if (!apiKey && resolved) {
                 provider = resolved.finalProvider;
                 model = resolved.finalModel;
                 let keyData = await keyService.getSmartKey(provider, model);
                 if (!keyData || !keyData.key) keyData = await keyService.getSmartKey(provider, 'default');
                 if (keyData && keyData.key) apiKey = keyData.key;
             }

             if (!apiKey) {
                 return { text: "Error: Own API Mode enabled but no valid API Key found.", usage: 0 };
             }

        } else {
             // Free User: Default to configured Vision Model or Chat Model
             const userModel = pageConfig.vision_model || pageConfig.chat_model || pageConfig.chatmodel;
             // Fix: Use stable model names for Google Vision
             if (resolved) {
                 provider = resolved.finalProvider;
                 model = resolved.finalModel;
             } else {
                 model = (userModel && userModel.includes('gemini')) ? userModel : 'gemini-1.5-flash-latest';
             }
             
             // Use System Key for Provider
             let keyData = await keyService.getSmartKey(provider, model);
             if (!keyData || !keyData.key) keyData = await keyService.getSmartKey(provider, 'default');
             if (keyData && keyData.key) apiKey = keyData.key;
        }

        console.log(`[Vision] Attempt 1: ${model} (${provider})`);

        let result = null;
        let usage = 0;

        if (provider === 'openrouter') {
            // OpenRouter Vision Call
            // Use Base64 Data URI to avoid access issues with external URLs (like FB private URLs)
            const imageContent = { url: `data:${mimeType};base64,${base64Image}` };

            const payload = {
                model: model,
                max_tokens: maxTokens,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [{ type: "image_url", image_url: imageContent }]
                    }
                ]
            };

            console.log(`[Vision] Calling OpenRouter with Key: ${apiKey.substring(0, 15)}...`);

            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                headers: { 
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://orderly-conversations.com', 
                    'X-Title': 'Orderly Conversations'
                },
                timeout: 30000
            });

            result = response.data?.choices?.[0]?.message?.content;
            usage = response.data?.usage?.total_tokens || 0;

        } else if (provider === 'google') {
            // Google Vision Call
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const payload = {
                contents: [{
                    parts: [
                        { text: systemPrompt },
                        { inline_data: { mime_type: mimeType, data: base64Image } }
                    ]
                }],
                generationConfig: { maxOutputTokens: maxTokens }
            };
            const useProxy = (provider === 'google' || provider === 'gemini');
            const geminiProxyAgent = getGeminiProxyAgent(url, useProxy);
            const visionResponse = await axios.post(url, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 20000,
                    ...(geminiProxyAgent ? { 
                        httpsAgent: geminiProxyAgent, 
                        httpAgent: geminiProxyAgent, 
                        proxy: false 
                    } : {})
                });

            result = visionResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            usage = visionResponse.data?.usageMetadata?.totalTokenCount || 0;
        } else {
             throw new Error(`Provider ${provider} not supported for Vision yet.`);
        }

        if (!result) throw new Error(`Empty response from ${provider}`);
        
        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.warn(`[Vision] Attempt 1 Failed: ${errMsg}`);
        errors.push(`${pageConfig.cheap_engine === false ? 'Own API' : 'Gemini Attempt 1'}: ${errMsg}`);
        
        // STOP if Own API (Paid User) - Return Error Text instead of Throwing so AI knows
        if (pageConfig && pageConfig.cheap_engine === false) {
             return { text: `[Vision Analysis Failed] Error: ${errMsg}`, usage: 0 };
        }
    }

    // ATTEMPT 3: OpenRouter Vision (Dynamically from Config)
    try {
        const provider = 'openrouter';
        // User Update: Use the vision model from pageConfig (set via Admin API Engine)
        const model = pageConfig.vision_model || pageConfig.chat_model || 'qwen/qwen-2.5-vl-7b-instruct:free';
        
        console.log(`[Vision] Attempt 3: ${model} (${provider})`);

        let keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) keyData = await keyService.getSmartKey(provider, 'default');
        if (!keyData || !keyData.key) throw new Error("No Key found for OpenRouter");

        const apiKey = keyData.key;
        
        // USE URL DIRECTLY IF POSSIBLE (User Preference)
        // But if it's a private URL (like FB/WAHA), we MUST use Base64.
        // If we already downloaded it (base64Image exists), use Base64 to be safe.
        let imageContent;
        if (base64Image) {
             imageContent = { url: `data:${mimeType};base64,${base64Image}` };
        } else {
             imageContent = { url: imageUrl };
        }

        const payload = {
            model: model,
            max_tokens: maxTokens,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [{ type: "image_url", image_url: imageContent }]
                }
            ]
        };

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://orderly-conversations.com', 
                'X-Title': 'Orderly Conversations'
            },
            timeout: 40000 // Increased timeout for heavy models
        });

        const result = response.data?.choices?.[0]?.message?.content;
        const usage = response.data?.usage?.total_tokens || 0;
        if (!result) throw new Error("Empty response from OpenRouter");

        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.warn(`[Vision] Attempt 3 Failed: ${errMsg}`);
        errors.push(`OpenRouter Vision: ${errMsg}`);
    }

    // FINAL FAILURE LOGGING
    const failureReason = `Image Analysis Failed. Reasons: ${errors.join(' | ')}`;
    console.error(`[Vision] All attempts failed. Logs: ${failureReason}`);
    logDebug(`[Vision] FATAL: ${failureReason}`);
    
    return { text: "Image found but analysis unavailable due to technical errors.", usage: 0 };
}

// --- HELPER: Transcribe Audio (Multi-Engine Priority) ---
async function transcribeAudio(audioUrl, config) {
    console.log(`[Audio] Processing: ${audioUrl.substring(0, 50)}...`);
    let audioBuffer, mimeType;

    // 1. Download Audio
    try {
        const headers = { 'User-Agent': 'Mozilla/5.0' };
        const isWahaUrl = audioUrl.includes(WAHA_BASE_URL) || 
                          audioUrl.includes('wahubbd.salesmanchatbot.online') ||
                          audioUrl.includes('/api/files/');
        
        if (isWahaUrl) {
            headers['X-Api-Key'] = WAHA_API_KEY;
        } else if (audioUrl.includes('graph.facebook.com') && config.page_access_token) {
            headers['Authorization'] = `Bearer ${config.page_access_token}`;
        }

        const response = await axios.get(audioUrl, { responseType: 'arraybuffer', headers, validateStatus: s => s === 200 });
        audioBuffer = Buffer.from(response.data);

        const contentType = response.headers['content-type'] || 'audio/ogg';
        
        // Map to Gemini-supported MIME types
        if (contentType.includes('opus') || contentType.includes('ogg')) mimeType = 'audio/ogg';
        else if (contentType.includes('mp3') || contentType.includes('mpeg')) mimeType = 'audio/mpeg';
        else if (contentType.includes('wav')) mimeType = 'audio/wav';
        else if (contentType.includes('aac') || contentType.includes('mp4') || contentType.includes('m4a')) mimeType = 'audio/mp4';
        else {
            // Fallback: Check URL extension if Content-Type is generic/unknown
            if (audioUrl.includes('.mp4') || audioUrl.includes('.aac') || audioUrl.includes('.m4a')) mimeType = 'audio/mp4';
            else if (audioUrl.includes('.mp3')) mimeType = 'audio/mpeg';
            else if (audioUrl.includes('.wav')) mimeType = 'audio/wav';
            else mimeType = 'audio/ogg'; // Default safe assumption
        }
        
        logDebug(`[Audio] Downloaded. Size: ${audioBuffer.length}, Content-Type: ${contentType}, Mapped Type: ${mimeType}`);

        // Check size limit (Gemini Inline Data limit is ~20MB)
        if (audioBuffer.length > 15 * 1024 * 1024) {
             console.warn(`[Audio] File too large (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB). Skipping transcription.`);
             return "[System: Audio file too large to transcribe]";
        }

        if (mimeType === 'audio/ogg') {
            const converted = await convertOggToMp3(audioBuffer);
            if (converted && converted.length > 0) {
                audioBuffer = converted;
                mimeType = 'audio/mpeg';
            }
        }
    } catch (e) {
        console.error(`[Audio] Download Failed for ${audioUrl}:`, e.message);
        if (e.response) {
             console.error(`[Audio] Download Error Data:`, e.response.status, e.response.data?.toString()?.substring(0, 100));
        }
        return `[Audio Download Failed: ${e.message}]`;
    }

    // 2. Priority Chain: Own API -> Gemini 2.5 Flash -> Lite -> Groq (Faster)
    const priorityChain = [];
    let userKey = null;
    const preferGeminiForOgg = mimeType === 'audio/ogg';

    // Ensure config exists to prevent crashes
    const safeConfig = config || {};
    const providerHint = safeConfig.ai_provider || safeConfig.ai || safeConfig.operator;
    const modelHint = safeConfig.chat_model || safeConfig.chatmodel;
    let resolved = null;
    if ((providerHint === 'salesmanchatbot' || modelHint === 'salesmanchatbot-pro' || modelHint === 'salesmanchatbot-flash' || modelHint === 'salesmanchatbot-lite') && !safeConfig.api_key) {
        resolved = await resolveSalesmanchatbotEngine(safeConfig, providerHint, modelHint, false, true);
    }

    // PHASE 1: OWN API (If User Provided Key)
    if (safeConfig.api_key && safeConfig.cheap_engine === false) {
        console.log(`[Audio Debug] Checking User Key logic. Config Provider: ${safeConfig.ai || safeConfig.operator}`);
        
        const userKeys = safeConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
        userKey = userKeys[0]; // Use first key for simplicity in audio
        
        // Strict Model Selection
        const userModel = safeConfig.chat_model || safeConfig.chatmodel;

        if (userKey) {
            // FIX: Check if this is a SALESMANCHATBOT KEY or a REAL USER KEY
            const userProvider = safeConfig.ai || safeConfig.operator || safeConfig.ai_provider;
            console.log(`[Audio Debug] User Key Found: ${userKey.substring(0, 8)}... Provider: ${userProvider}`);
            
            if (userProvider === 'salesmanchatbot') {
                console.log(`[Audio] User Key is a SalesmanChatbot Key. Skipping User Key logic to use System Routing.`);
                userKey = null; // Force Phase 2 (System Keys / Smart Routing)
            } else {
                if (userKey.startsWith('sk-') && !userKey.startsWith('sk-or')) {
                    // OpenAI Key -> Use Whisper (Standard for OpenAI Audio)
                    priorityChain.push({ provider: 'openai', model: 'whisper-1', name: 'OpenAI Whisper (User Key)', key: userKey });
                } else if (userKey.startsWith('gsk_')) {
                    // Groq Key -> Use Groq Whisper
                    priorityChain.push({ provider: 'groq', model: 'whisper-large-v3', name: 'Groq Whisper (User Key)', key: userKey });
                } else if (userKey.startsWith('AIza')) {
                    // Gemini Key -> STRICTLY Use User's Selected Model
                    if (!userModel) {
                        console.log(`[Audio Debug] Missing user model for Gemini key. Skipping user key for audio.`);
                        userKey = null;
                    } else {
                        priorityChain.push({ provider: 'google', model: userModel, name: `Gemini (${userModel}) (User Key)`, key: userKey });
                    }
                } else {
                    console.log(`[Audio Debug] Unknown Key Prefix. Defaulting to System Routing.`);
                    userKey = null;
                }
            }
        }
    }

    // PHASE 2: SYSTEM KEYS (Cheap Engine / Fallback)
    // ONLY add system keys if NO User Key was provided.
    // User Requirement: "own api er modde defualt chatmodel defualt api asob kisui use kora jabe na"
    if (!userKey) {
        // User Update: Use configured voice model if available
        let voiceModel = safeConfig.voice_model || safeConfig.audio_model || safeConfig.chat_model;
        let provider = safeConfig.ai_provider || safeConfig.ai || safeConfig.operator || 'google';

        if (resolved) {
            voiceModel = resolved.finalModel;
            provider = resolved.finalProvider;
        } else {
            let targetProvider = provider;
            
            if (targetProvider === 'salesmanchatbot' || targetProvider === 'gemini') {
                targetProvider = 'google';
            }

            try {
                const gConfig = await getGlobalEngineConfig(targetProvider);
                if (gConfig) {
                    if (gConfig.voice_model) {
                        voiceModel = gConfig.voice_model;
                        console.log(`[Audio] Loaded Global Voice Model for ${targetProvider}: ${voiceModel}`);
                    }
                    
                    if (gConfig.voice_provider_override && gConfig.voice_provider_override !== 'default') {
                        targetProvider = gConfig.voice_provider_override;
                        provider = targetProvider;
                    } else {
                        provider = targetProvider;
                    }
                }
            } catch (err) {
                console.error(`[Audio] Global Config Lookup Failed: ${err.message}. Proceeding with defaults.`);
            }
        }
        
        if (voiceModel) {
             console.log(`[Audio] Using Configured Voice Model: ${voiceModel} (Provider: ${provider})`);
             
             if (voiceModel.includes('whisper') && provider !== 'groq' && provider !== 'openai') {
                 provider = 'groq';
             } else if (voiceModel.includes('gemini') && provider !== 'google') {
                 provider = 'google';
             }
             
             if (preferGeminiForOgg && voiceModel.includes('whisper')) {
                 priorityChain.push({ provider: 'google', model: 'gemini-1.5-flash', name: 'Gemini Audio (OGG)' });
                 priorityChain.push({ provider: provider, model: voiceModel, name: `Configured (${voiceModel})` });
             } else {
                 priorityChain.push({ provider: provider, model: voiceModel, name: `Configured (${voiceModel})` });
             }
        }
    }

    for (const option of priorityChain) {
        try {
            console.log(`[Audio] Attempting Transcription with ${option.name}...`);
            
            let apiKey = option.key;
            if (!apiKey) {
                const keyData = await keyService.getSmartKey(option.provider, option.model);
                if (!keyData || !keyData.key) {
                     console.warn(`[Audio] No system key found for ${option.name}`);
                     continue;
                }
                apiKey = keyData.key;
            }
            
            // OPENAI WHISPER API (User Key)
            if (option.provider === 'openai') {
                // Fix: Verify Key format for OpenAI. SalesmanChatbot keys should NOT be sent to OpenAI.
                if (!apiKey.startsWith('sk-') && !apiKey.startsWith('sess-')) {
                     console.warn(`[Audio] Skipping OpenAI attempt: Invalid Key format for OpenAI (Key: ${apiKey.substring(0,5)}...)`);
                     continue;
                }

                const formData = new FormData();
                const fileExt = mimeType === 'audio/mpeg' ? 'mp3' : (mimeType.split('/')[1] || 'mp3');
                formData.append('file', audioBuffer, { 
                    filename: `audio.${fileExt}`, 
                    contentType: mimeType 
                });
                formData.append('model', 'whisper-1');
                // User Request: "transcription banglai hobe"
                formData.append('language', 'bn');

                const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${apiKey}`
                    },
                    timeout: 30000
                });

                const text = res.data?.text;
                if (text) {
                    console.log(`[Audio] Success with ${option.name}: "${text.substring(0, 30)}..."`);
                    return { text: text.trim(), usage: 0 }; // Usage tracking for audio is complex, skipping for now
                }
            }

            // GEMINI DIRECT API
            if (option.provider === 'google') {
                const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
                // User Question: "tahhole ekon doro amr api ami kothao use kortesi ekon foro ami flash select korlam tahole sekane voice image text sob process korte parbe ?"
                // Answer: YES. Gemini 1.5 Flash / 2.0 Flash is MULTIMODAL.
                // It can handle Text, Image, and Audio in the SAME model.
                // So if you select 'gemini-2.0-flash', it will work for everything.
                
                // Fix: Google API needs 'models/' prefix sometimes, but v1beta/models/{model} usually works.
                // However, the model name from config might not have 'models/'.
                // Let's ensure clean URL.
                let modelName = option.model;
                if (modelName.startsWith('models/')) modelName = modelName.replace('models/', '');
                
                const url = `${baseUrl}/${modelName}:generateContent?key=${apiKey}`;
                
                // Determine Voice Prompt
                let voicePrompt = "Transcribe this audio. Priority languages: Bangla, then English, then Hindi. Output ONLY the transcription text.";
                if (config.voice_prompt) voicePrompt = config.voice_prompt;
                else if (config.page_prompts && config.page_prompts.voice_prompt) voicePrompt = config.page_prompts.voice_prompt;

                const payload = {
                    contents: [{
                        parts: [
                            { text: voicePrompt },
                            { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } }
                        ]
                    }]
                };
                
                const geminiProxyAgent = getGeminiProxyAgent(url, !option.key);
                
                const res = await axios.post(url, payload, {
                    ...(geminiProxyAgent ? { 
                        httpsAgent: geminiProxyAgent, 
                        httpAgent: geminiProxyAgent, 
                        proxy: false 
                    } : {})
                });

                const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                // Gemini audio tokens are roughly 1 per second? Let's trust usageMetadata
                const usage = res.data?.usageMetadata?.totalTokenCount || 0;
                
                if (text) {
                    console.log(`[Audio] Success with ${option.name}: "${text.substring(0, 30)}..." Usage: ${usage}`);
                    return { text: text.trim(), usage: usage };
                }
            }
            
            // GROQ WHISPER API (Fastest)
            if (option.provider === 'groq') {
                const formData = new FormData();
                const fileExt = mimeType === 'audio/mpeg' ? 'mp3' : (mimeType.split('/')[1] || 'mp3');
                
                // Using Buffer directly is more robust than PassThrough in some axios versions
                formData.append('file', audioBuffer, { 
                    filename: `audio.${fileExt}`, 
                    contentType: mimeType 
                });
                formData.append('model', option.model || 'whisper-large-v3');
                // User Request: "transcription banglai hobe"
                // Adding language='bn' hint for Bengali transcription
                formData.append('language', 'bn');

                // NEW: Groq Proxy Support (Similar to Gemini Proxy)
                // Use proxy if it's a system key (no user key provided in option)
                const useProxy = !option.key;
                const groqProxyAgent = getGroqProxyAgent(useProxy);
                
                // Force proxy for system keys as requested
                // "groq er test file banao then ... salesmanchatbot er groq diye test deo"
                // This implies system keys must work behind proxy.
                
                const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${apiKey}`
                    },
                    timeout: 30000, // 30s timeout for audio
                    ...(groqProxyAgent ? { 
                        httpsAgent: groqProxyAgent, 
                        httpAgent: groqProxyAgent, 
                        proxy: false 
                    } : {})
                });

                const text = res.data.text;
                if (text) {
                    console.log(`[Audio] Success with ${option.name}: "${text.substring(0, 30)}..."`);
                    return { text: text.trim(), usage: 0 };
                }
            }
            
        } catch (e) {
             const status = e?.response?.status;
             const data = e?.response?.data;
             if (status || data) {
                 console.warn(`[Audio] ${option.name} Failed:`, status, data);
             } else {
                 console.warn(`[Audio] ${option.name} Failed:`, e.message);
             }
        }
    }

    return { text: "[Audio Transcription Failed]", usage: 0 };
}

module.exports = {
    generateReply,
    generateResponse,
    fetchOgImage,
    processImageWithVision,
    transcribeAudio,
    refreshGlobalEngineConfigCache
};
