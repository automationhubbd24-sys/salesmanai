const keyService = require('./keyService');
const dbService = require('./dbService'); // Added for Product Search Tool
const orderService = require('./orderService');
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

// --- Simple In-Memory Embedding Cache (500 items, 1 hour TTL) ---
const embeddingCache = new Map();
const EMBED_CACHE_MAX = 500;
const EMBED_CACHE_TTL = 3600 * 1000;

function getCachedEmbedding(text) {
    const key = text.trim().toLowerCase();
    const entry = embeddingCache.get(key);
    if (entry && (Date.now() - entry.timestamp < EMBED_CACHE_TTL)) {
        return entry.vector;
    }
    return null;
}

function setCachedEmbedding(text, vector) {
    if (embeddingCache.size >= EMBED_CACHE_MAX) {
        // Simple LRU: remove first item
        const firstKey = embeddingCache.keys().next().value;
        embeddingCache.delete(firstKey);
    }
    embeddingCache.set(text.trim().toLowerCase(), { vector, timestamp: Date.now() });
}

let ffmpegPath = null;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (e) {
    ffmpegPath = null;
}

function getProxyUrl(modelName = 'default') {
    const proxyUrl = process.env.BRIGHT_DATA_PROXY_URL;
    const user = process.env.BRIGHT_DATA_USER;
    const pass = process.env.BRIGHT_DATA_PASS;
    if (!proxyUrl) {
        console.error("[Proxy] CRITICAL: Proxy URL is missing! Blocking request to protect Server IP.");
        throw new Error("Strict Proxy Mode: Proxy URL is required but missing.");
    }
    
    // Simplified session ID for ISP proxies to avoid authentication errors
    const session = Math.floor(Math.random() * 1000000);
    const url = `http://${user}-session-${session}:${pass}@${proxyUrl}`;
    
    // Validate proxy format (basic check)
    if (!url.startsWith('http://')) {
        console.warn("[Proxy] Invalid Proxy URL format constructed.");
        return null;
    }

    // Log Proxy Session Info for Debugging (Per User Request)
    console.log(`[Proxy] Using Session: ${session} for model: ${modelName}`);
    
    return url;
}

function getDynamicUserAgent() {
    const agents = [
        {
            ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            ch: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            platform: '"Windows"'
        },
        {
            ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            ch: '"Chromium";v="121", "Not(A:Brand";v="24", "Google Chrome";v="121"',
            platform: '"macOS"'
        },
        {
            ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            ch: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            platform: '"Linux"'
        }
    ];
    return agents[Math.floor(Math.random() * agents.length)];
}

function getStealthHeaders(apiKey, provider = 'openai') {
    const agent = getDynamicUserAgent();
    
    // Create headers in a FIXED, REALISTIC order to mimic a real browser
    // Node.js objects maintain insertion order for string keys
    const headers = {};
    
    headers['User-Agent'] = agent.ua;
    headers['Accept'] = 'application/json, text/plain, */*';
    headers['Accept-Language'] = 'en-US,en;q=0.9';
    headers['Content-Type'] = 'application/json';

    // Handle different providers
    if (provider === 'google' || provider === 'gemini') {
        headers['x-goog-api-key'] = apiKey;
    } else if (provider === 'openrouter') {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['HTTP-Referer'] = 'https://n8n.io';
        headers['X-Title'] = 'n8n';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    headers['Sec-CH-UA'] = agent.ch;
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = agent.platform;
    headers['Sec-Fetch-Site'] = 'cross-site';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Dest'] = 'empty';

    return headers;
}

/**
 * Returns safety settings for Gemini to prevent "Policy Violation" flags.
 * Setting to BLOCK_NONE where possible avoids the "blocked" response 
 * which is a strong signal for project-wide restriction.
 */
function getGeminiSafetySettings() {
    return [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
    ];
}

/**
 * Creates an HttpsProxyAgent and logs IP info for debugging
 * @param {string} proxyUrl - Full proxy URL
 * @returns {HttpsProxyAgent|null}
 */
function createProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        const agent = new HttpsProxyAgent(proxyUrl);
        const sessionName = proxyUrl.includes('-session-') ? proxyUrl.split('-session-')[1]?.split(':')[0] : 'direct';
        
        // Attach session name to agent for logging in other functions
        agent.proxySessionName = sessionName;
        
        // Log IP Info for Debugging (Non-blocking)
        const service = 'https://lumtest.com/myip.json';

        axios.get(service, { 
            httpsAgent: agent, 
            httpAgent: agent,
            proxy: false,
            timeout: 15000, 
            headers: {
                'User-Agent': getDynamicUserAgent()
            }
        })
            .then(res => {
                const ip = res.data.ip || 'unknown';
                const country = res.data.country || 'unknown';
                console.log(`[Proxy Verification] Agent Ready | IP: ${ip} | Session: ${sessionName} | Country: ${country}`);
            })
            .catch(e => {
                // If it still fails, log the specific Bright Data error from headers
                const brdError = e.response?.headers?.['x-brd-err-msg'] || e.message;
                console.warn(`[Proxy Verification Failed] Session: ${sessionName} | Error: ${brdError}`);
            });

        return agent;
    } catch (e) {
        console.error(`[Proxy] CRITICAL: Proxy creation failed: ${e.message}. Blocking request.`);
        throw new Error(`Strict Proxy Mode: Failed to establish proxy agent.`);
    }
}

function getGeminiProxyAgent(baseURL, useProxy = true, modelName = 'gemini') {
    if (!useProxy) return null;
    const proxy = getProxyUrl(modelName);
    return createProxyAgent(proxy);
}

function getGroqProxyAgent(useProxy = true, modelName = 'groq') {
    if (!useProxy) return null;
    const proxy = getProxyUrl(modelName);
    return createProxyAgent(proxy);
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
const MAX_CONCURRENT_AI_CALLS = process.env.MAX_CONCURRENT_AI_CALLS ? parseInt(process.env.MAX_CONCURRENT_AI_CALLS) : 50; // Increased to 50 for large scale (10k+ users)
const AI_QUEUE_TIMEOUT = 120000; // Increased to 120s (2 mins) to handle extreme traffic bursts in queue

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

/**
 * Formats an error into a branded, user-friendly message for ChatModel.
 */
function formatBrandedError(error, brandName = 'ChatModel') {
    const errorMsg = (error.message || (typeof error === 'string' ? error : '')).toLowerCase();
    const statusCode = error.status || (error.response ? error.response.status : (error.code || 500));
    
    let brandedMessage = `${brandName} Error: ${error.message || error}`;
    let code = statusCode;
    let type = 'api_error';

    // 0. Model Not Found / Invalid Model (404)
    if (statusCode === 404 || errorMsg.includes('not found') || errorMsg.includes('model')) {
        brandedMessage = `${brandName} Model Configuration Error. The selected model is unavailable or incorrectly named.`;
        code = 404;
        type = 'model_error';
    }
    // 1. Quota / Rate Limit (429)
    else if (statusCode === 429 || errorMsg.includes('429') || errorMsg.includes('limit') || errorMsg.includes('quota') || errorMsg.includes('exhausted')) {
        brandedMessage = `${brandName} Rate Limit High. Please slow down and try again later.`;
        code = 429;
        type = 'rate_limit_error';
    } 
    // 2. Invalid Content (400)
    else if (statusCode === 400 || errorMsg.includes('400') || errorMsg.includes('invalid')) {
        brandedMessage = `${brandName} Invalid Content. Please check your input parameters.`;
        code = 400;
        type = 'invalid_request_error';
    } 
    // 3. Auth Issues (401/403)
    else if (statusCode === 401 || statusCode === 403 || errorMsg.includes('key')) {
        brandedMessage = `${brandName} Authentication Failed. Your access key is invalid or expired.`;
        code = 401;
        type = 'authentication_error';
    }

    return { message: brandedMessage, code, type };
}

/**
 * Formats an error into a branded, user-friendly message for ChatModel.
 */
function formatBrandedError(error, brandName = 'ChatModel') {
    const errorMsg = (error.message || (typeof error === 'string' ? error : '')).toLowerCase();
    const statusCode = error.status || (error.response ? error.response.status : (error.code || 500));
    
    let brandedMessage = `${brandName} Error: ${error.message || error}`;
    let code = statusCode;
    let type = 'api_error';

    // 0. Model Not Found / Invalid Model (404)
    if (statusCode === 404 || errorMsg.includes('not found') || errorMsg.includes('model')) {
        brandedMessage = `${brandName} Model Configuration Error. The selected model is unavailable or incorrectly named.`;
        code = 404;
        type = 'model_error';
    }
    // 1. Quota / Rate Limit (429)
    else if (statusCode === 429 || errorMsg.includes('429') || errorMsg.includes('limit') || errorMsg.includes('quota') || errorMsg.includes('exhausted')) {
        brandedMessage = `${brandName} Rate Limit High. Please slow down and try again later.`;
        code = 429;
        type = 'rate_limit_error';
    } 
    // 2. Invalid Content (400)
    else if (statusCode === 400 || errorMsg.includes('400') || errorMsg.includes('invalid')) {
        brandedMessage = `${brandName} Invalid Content. Please check your input parameters.`;
        code = 400;
        type = 'invalid_request_error';
    } 
    // 3. Auth Issues (401/403)
    else if (statusCode === 401 || statusCode === 403 || errorMsg.includes('key')) {
        brandedMessage = `${brandName} Authentication Failed. Your access key is invalid or expired.`;
        code = 401;
        type = 'authentication_error';
    }

    return { message: brandedMessage, code, type };
}

// --- NEW: AUTOMATIC KEY FAILURE HANDLING ---
/**
 * Handles API errors by marking keys as dead or quota exceeded.
 * @param {Error} error - The error object from the API call.
 * @param {string} apiKey - The API key that failed.
 * @param {string} model - The model being used.
 * @param {string} modality - The modality (text/vision/voice).
 */
async function handleAiError(error, apiKey, model, modality = 'text') {
    if (!apiKey) return;
    
    const errorMsg = (error.message || '').toLowerCase();
    const statusCode = error.status || (error.response ? error.response.status : null);

    console.error(`[AI Error Handler] Handling error for key ${apiKey.substring(0, 8)}... | Status: ${statusCode} | Msg: ${errorMsg}`);

    // Delegate to KeyService for smart handling (429, 401, etc.)
    if (keyService.handleApiKeyError) {
        await keyService.handleApiKeyError(apiKey, error, model, modality);
    }
}

// --- GLOBAL ENGINE CONFIG CACHE ---
let globalEngineConfigCache = new Map();
let brandedEngineConfigCache = new Map();

async function getBrandedEngineConfig(engineName) {
    if (brandedEngineConfigCache.has(engineName)) {
        return brandedEngineConfigCache.get(engineName);
    }

    try {
        console.log(`[AI] Fetching Branded Engine Config for ${engineName}...`);
        const pgClient = require('./pgClient');
        const res = await pgClient.query('SELECT * FROM engine_configs WHERE name = $1', [engineName]);
        const config = res.rows[0] || null;
        brandedEngineConfigCache.set(engineName, config);
        return config;
    } catch (err) {
        console.warn(`[AI] Failed to fetch branded engine config for ${engineName}:`, err.message);
        return null;
    }
}

async function getGlobalEngineConfig(provider) {
    // Check Cache. Persistence is manual.
    if (globalEngineConfigCache.has(provider)) {
        return globalEngineConfigCache.get(provider);
    }

    try {
        console.log(`[AI] Fetching Global Engine Config for ${provider}...`);
        const pgClient = require('./pgClient');
        const res = await pgClient.query('SELECT * FROM api_engine_configs WHERE provider = $1', [provider]);
        const config = res.rows[0] || null;
        
        globalEngineConfigCache.set(provider, config);
        
        return config;
    } catch (err) {
        console.warn(`[AI] Failed to fetch global engine config for ${provider}:`, err.message);
        return null;
    }
}

/**
 * Clears the global engine configuration cache.
 * @param {string} provider - Optional provider to clear specifically.
 */
function clearGlobalConfigCache(provider = null) {
    if (provider) {
        globalEngineConfigCache.delete(provider);
        console.log(`[AI Cache] Global config cleared for provider: ${provider}`);
    } else {
        globalEngineConfigCache.clear();
        console.log(`[AI Cache] All global engine configs cleared.`);
    }
}

async function refreshGlobalEngineConfigCache(provider = null) {
    clearGlobalConfigCache(provider);
    
    // Also clear branded engine cache when a full refresh is requested
    if (!provider) {
        brandedEngineConfigCache.clear();
        console.log(`[AI] Cleared ALL Global and Branded Engine Caches.`);
    } else {
        console.log(`[AI] Cleared Global Engine Cache for: ${provider}`);
    }

    if (provider) {
        return getGlobalEngineConfig(provider);
    }
    return true;
}

async function clearBrandedEngineCache(name = null) {
    if (name) {
        brandedEngineConfigCache.delete(name);
        console.log(`[AI] Cleared Branded Engine Cache for: ${name}`);
    } else {
        brandedEngineConfigCache.clear();
        console.log(`[AI] Cleared ALL Branded Engine Caches.`);
    }
}

async function resolveSalesmanchatbotEngine(pageConfig, defaultProvider, defaultModel, isVision, isAudio) {
    let targetEngineName = defaultModel || 'salesmanchatbot-pro';

    // --- ENGINE OVERRIDE LOGIC (Admin Priority) ---
    // If the page has an engine_override set by Admin, we use that instead of the user's choice.
    if (pageConfig && pageConfig.engine_override) {
        console.log(`[AI] Applying ADMIN Engine Override: ${pageConfig.engine_override} (instead of ${targetEngineName})`);
        targetEngineName = pageConfig.engine_override;
    }

    // 1. Fetch Branded Config (User's choice in Frontend)
    let brandedConfig = await getBrandedEngineConfig(targetEngineName);
    
    if (!brandedConfig) {
        console.warn(`[AI] WARNING: No configuration found for engine: ${targetEngineName}. Falling back to salesmanchatbot-pro.`);
        targetEngineName = 'salesmanchatbot-pro';
        brandedConfig = await getBrandedEngineConfig(targetEngineName);
    }

    if (!brandedConfig) {
        console.error(`[AI] CRITICAL: Even fallback engine (salesmanchatbot-pro) not found. Blocking request.`);
        throw new Error(`Engine ${targetEngineName} is not configured in the dashboard.`);
    }

    // 2. Resolve based on modality (Text/Voice/Image)
    let finalProvider = brandedConfig.text_provider || brandedConfig.provider;
    let finalModel = brandedConfig.text_model;
    let modality = 'text';

    if (isAudio) {
        finalProvider = brandedConfig.voice_provider || finalProvider;
        finalModel = brandedConfig.voice_model || finalModel;
        modality = 'voice';
    } else if (isVision) {
        finalProvider = brandedConfig.image_provider || finalProvider;
        finalModel = brandedConfig.image_model || finalModel;
        modality = 'vision';
    }

    if (!finalProvider || !finalModel) {
        console.error(`[AI] CRITICAL: Missing provider/model for ${targetEngineName} (${modality}).`);
        throw new Error(`Engine ${targetEngineName} is missing ${modality} configuration.`);
    }

            // 3. Apply Global Config (Rate Limits and Overrides)
            const gConfig = await getGlobalEngineConfig(finalProvider);
            if (gConfig) {
                // --- ADMIN OVERRIDE FOR MODEL (Only if not already set by Branded Engine) ---
                // We ONLY use the Global Config model if the Branded Engine doesn't specify one.
                if (isAudio && !finalModel) finalModel = gConfig.voice_model;
                else if (isVision && !finalModel) finalModel = gConfig.vision_model;
                else if (!isAudio && !isVision && !finalModel) finalModel = gConfig.text_model;

                // Apply Global Provider Overrides if set (e.g. use Groq instead of Google for everything)
                if (isAudio && gConfig.voice_provider_override && gConfig.voice_provider_override !== 'default') {
                    finalProvider = gConfig.voice_provider_override;
                } else if (isVision && gConfig.vision_provider_override && gConfig.vision_provider_override !== 'default') {
                    finalProvider = gConfig.vision_provider_override;
                } else if (!isAudio && !isVision && gConfig.text_provider_override && gConfig.text_provider_override !== 'default') {
                    finalProvider = gConfig.text_provider_override;
                }

        // Apply Manual Limits to KeyService (Modality-aware)
        if (keyService.setManualLimit) {
            // Find specific limits for THIS model if it exists in the dynamic list
            let modelSpecificLimit = null;
            const modalityListField = isAudio ? 'voice_models_list' : (isVision ? 'vision_models_list' : 'text_models_list');
            
            if (gConfig[modalityListField] && Array.isArray(gConfig[modalityListField])) {
                const normalize = (n) => String(n || '').toLowerCase().replace(/^(google|openai|groq|openrouter|mistral)\//, '').trim();
                const targetModelNorm = normalize(finalModel);
                
                modelSpecificLimit = gConfig[modalityListField].find(m => normalize(m.model) === targetModelNorm);
                
                if (modelSpecificLimit) {
                    console.log(`[AI] Found Model-Specific Limits for ${finalModel}: RPM=${modelSpecificLimit.rpm}, RPH=${modelSpecificLimit.rph}`);
                }
            }

            const limit = {
                rpm: modelSpecificLimit?.rpm || (isAudio ? gConfig.voice_rpm : (isVision ? gConfig.vision_rpm : gConfig.text_rpm)),
                rpd: modelSpecificLimit?.rpd || (isAudio ? gConfig.voice_rpd : (isVision ? gConfig.vision_rpd : gConfig.text_rpd)),
                rph: modelSpecificLimit?.rph || (isAudio ? gConfig.voice_rph : (isVision ? gConfig.vision_rph : gConfig.text_rph)),
                tpm: modelSpecificLimit?.tpm || (isAudio ? gConfig.voice_tpm : (isVision ? gConfig.vision_tpm : gConfig.text_tpm)),
                tpd: modelSpecificLimit?.tpd || (isAudio ? gConfig.voice_tpd : (isVision ? gConfig.vision_tpd : gConfig.text_tpd)),
                tpmo: modelSpecificLimit?.tpmo || (isAudio ? gConfig.voice_tpmo : (isVision ? gConfig.vision_tpmo : gConfig.text_tpmo)),
                source: 'global_engine_resolution'
            };
            
            // Set limit using model:modality format to avoid conflicts
            console.log(`[AI] Setting Manual Limit for ${finalModel}:${modality} (Source: ${limit.source}, RPM: ${limit.rpm}, RPH: ${limit.rph})`);
            keyService.setManualLimit(`${finalModel}:${modality}`, limit);
        }
    }

    if (finalProvider === 'openrouter' && finalModel.includes(',')) {
        finalModel = finalModel.split(',')[0].trim();
    }

    const fallbackField = isAudio ? 'voice_fallback_model' : (isVision ? 'vision_fallback_model' : 'text_fallback_model');
    const fallbackModel = (gConfig && gConfig[fallbackField]) ? gConfig[fallbackField] : null;

    console.log(`[AI] Engine Resolved: ${targetEngineName} -> ${finalProvider}/${finalModel} (Fallback: ${fallbackModel || 'None'}) (${modality})`);

    return { 
        finalProvider,
        finalModel,
        fallbackModel, // NEW: Fallback model if primary fails
        targetEngineName,
        modality, 
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

// --- IN-MEMORY CACHE FOR ZERO COST (DISABLED PER USER REQUEST) ---
// const responseCache = new Map();
// const CACHE_TTL_MS = 1000 * 60 * 60; // 1 Hour Cache
// const CACHE_SIZE_LIMIT = 500; // Prevent memory leaks

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
            description: 'Search for products in the database. Use this for ANY product, price, or detail query.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The product name or keywords to search for (e.g., "Kemei", "Straightener").' },
                    search_mode: { type: 'string', enum: ['hybrid', 'keyword_only'], description: 'Use keyword_only if hybrid/semantic search fails to find a specific brand or model.' }
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
    }
];

const normalizeText = (value) => (value || '').toString().toLowerCase().trim();

/**
 * Lightweight filter for semantic caching.
 * Only blocks extremely short or empty messages.
 * Relies on context_id (last_product_id) to differentiate 10k+ items.
 */
function isCacheable(message) {
    if (!message || message.trim().length < 2) return false; 
    return true;
}

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
    // 1. Ensure config has essential IDs
    if (config) {
        if (pageId && !config.page_id) config.page_id = pageId;
        if (platform) config.platform = platform;
    }
    
    let pagePrompts = config;
    
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
        userId, // Pass actual Customer ID
        pageId // Pass Page ID for order tracking
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

async function getEmbedding(text, customApiKey = null) {
    if (!text) return null;
    
    // 1. Check Cache First (Skip API call if we already have it)
    const cached = getCachedEmbedding(text);
    if (cached) {
        // console.log(`[AI Embedding] Cache HIT for: "${text.substring(0, 30)}..."`);
        return cached;
    }

    try {
        const config = await dbService.getEmbeddingGlobalConfig();
        const apiKey = customApiKey || (config ? config.api_key : null);
        
        if (!apiKey) {
            return null;
        }

        const provider = (config && config.provider ? config.provider.toLowerCase() : 'google');
        let vector = null;

        if (provider === 'google' || provider === 'gemini') {
            const genAI = new GoogleGenerativeAI(apiKey);
            // Use the specific model from config, or fallback to text-embedding-004
            const modelName = (config && config.model) || "text-embedding-004";
            const model = genAI.getGenerativeModel({ model: modelName });
            
            const result = await model.embedContent(text.replace(/\n/g, ' '));
            vector = result.embedding.values;

            // --- FIX: Gemini embedding-001 returns 3072 dims, but our DB expects 1536 ---
            // If the model is embedding-001 and we get 3072, we truncate to 1536
            if (modelName.includes('embedding-001') && vector.length === 3072) {
                // console.log(`[AI Embedding] Truncating Gemini 3072 dims to 1536 for compatibility.`);
                vector = vector.slice(0, 1536);
            }
        } else {
            // Default to OpenAI/OpenRouter (OpenAI SDK compatible)
            const openai = new OpenAI({
                apiKey: apiKey,
                baseURL: (config && config.base_url) || 'https://api.openai.com/v1'
            });

            const response = await openai.embeddings.create({
                model: (config && config.model) || 'text-embedding-3-small',
                input: text.replace(/\n/g, ' '),
                encoding_format: "float",
            });

            vector = response.data[0].embedding;
        }

        if (vector) {
            setCachedEmbedding(text, vector);
        }
        return vector;
    } catch (e) {
        console.error(`[AI Embedding] Generation failed: ${e.message}`);
        return null;
    }
}

// Helper to clean and extract JSON from AI response (handles <think> blocks and markdown)
function extractJsonFromAiResponse(rawContent) {
    let parsed = {};
    
    // 1. Remove <thought>...</thought> and <think>...</think> blocks (DeepSeek/Gemma/Gemini reasoning)
    let cleanContent = rawContent
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .trim();

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
        if (parsed.reply_text && typeof parsed.reply_text === 'string') parsed.reply = parsed.reply_text;
        else if (parsed.response && typeof parsed.response === 'string') parsed.reply = parsed.response;
        else if (parsed.message && typeof parsed.message === 'string') parsed.reply = parsed.message;
        else if (parsed.answer && typeof parsed.answer === 'string') parsed.reply = parsed.answer;
        else if (parsed.text && typeof parsed.text === 'string') parsed.reply = parsed.text;

        // --- NOISE FILTER: If reply is just punctuation/commas, silence it ---
        if (parsed.reply && typeof parsed.reply === 'string') {
            const cleaned = parsed.reply.trim();
            // This regex matches strings that ONLY consist of punctuation, whitespace, or are empty
            const isJustPunctuation = /^[\s\p{P}]+$/u.test(cleaned);
            if (isJustPunctuation && cleaned.length > 0) {
                 console.log(`[AI Parser] Silencing punctuation-only reply: "${cleaned}"`);
                 parsed.reply = ""; 
            }
        }

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
            let rawReply = null;
            if (parsed.reply && typeof parsed.reply === 'string') rawReply = parsed.reply;
            else if (parsed.reply_text && typeof parsed.reply_text === 'string') rawReply = parsed.reply_text;
            // FLEXIBLE FALLBACK: Check aliases
            else if (parsed.response && typeof parsed.response === 'string') rawReply = parsed.response;
            else if (parsed.message && typeof parsed.message === 'string') rawReply = parsed.message;
            else if (parsed.answer && typeof parsed.answer === 'string') rawReply = parsed.answer;
            else if (parsed.text && typeof parsed.text === 'string') rawReply = parsed.text;

            if (rawReply !== null) {
                const cleaned = rawReply.trim();
                const isJustPunctuation = /^[\s\p{P}]+$/u.test(cleaned);
                if (isJustPunctuation && cleaned.length > 0) return "";
                return rawReply;
            }

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

/**
 * Uses AI to expand a simple user query into multiple semantic keywords.
 * Example: "Wireless hair machine" -> "wireless, rechargeable, cordless, hair straightener, hair comb"
 */
async function runProductSpecialistAgent(userQuery, pageConfig) {
    try {
        const userId = pageConfig.user_id;
        const pageId = pageConfig.page_id;
        
        // 1. Fetch ALL active products for this specific page/owner
        const { data: products } = await dbService.getProducts(userId, 1, 500, null, pageId);
        
        if (!products || products.length === 0) {
            return { status: 'NOT_FOUND', message: "No products available in the store." };
        }

        const userProviderRaw = (pageConfig.ai_provider || pageConfig.ai || 'google').toLowerCase();
        const userProvider = userProviderRaw === 'gemini' ? 'google' : userProviderRaw;
        const userModel = pageConfig.chat_model || 'gemini-1.5-flash';

        let keyData = await keyService.getSmartKey(userProvider, userModel, 'text');
        if (!keyData || !keyData.key) keyData = await keyService.getSmartKey(userProvider, 'default', 'text');
        if ((!keyData || !keyData.key) && userProvider !== 'google') keyData = await keyService.getSmartKey('google', 'default', 'text');
        if ((!keyData || !keyData.key) && userProvider !== 'openrouter') keyData = await keyService.getSmartKey('openrouter', 'default', 'text');

        if (!keyData || !keyData.key) {
            return { status: 'ERROR', message: "Specialist Agent API key unavailable." };
        }

        const actualProvider = (keyData.provider || userProvider).toLowerCase();
        const apiKey = keyData.key;

        // 2. Build the specialist system prompt with FULL data
        const specialistPrompt = `You are the Product Database Specialist for Rimu's Shop.
Your ONLY job is to identify the correct product(s) and provide the EXACT price and stock from the list below.

[FULL PRODUCT KNOWLEDGE BASE]
${products.map(p => `ID: ${p.id} | NAME: ${p.name} | PRICE: ${p.price} ${p.currency || 'BDT'} | STOCK: ${p.stock_quantity} | KEYWORDS: ${p.keywords} | DESCRIPTION: ${p.description}`).join('\n---\n')}

[STRICT MATCHING RULES]
1. READ EVERYTHING: You MUST scan the entire list above. Look for matches in NAME, KEYWORDS, and DESCRIPTION.
2. FUZZY MATCHING: If the user makes a spelling mistake or uses Banglish, identify the most likely product they are referring to.
3. SEMANTIC MATCHING: Match based on features and synonyms.
4. BEST MATCH: If multiple products seem relevant, pick the one that best fits the user's specific intent.
5. ABSOLUTE PRICE TRUTH: Use the EXACT price from the list above. NEVER guess or invent a price.
6. NO HALLUCINATION: If a product is not in the list, return an empty JSON.

[OUTPUT FORMAT]
You MUST return a JSON object with:
   - "matched_ids": Array of IDs.
   - "final_response": A polite, professional response in the user's language containing the name, price, and stock of the matched products.`;

        // --- NEW: OPENAI COMPATIBLE ARCHITECTURE (Match 1st Agent) ---
        let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        if (actualProvider.includes('openrouter')) baseURL = 'https://openrouter.ai/api/v1';
        else if (actualProvider.includes('openai')) baseURL = 'https://api.openai.com/v1';
        else if (actualProvider.includes('groq')) baseURL = 'https://api.groq.com/openai/v1';
        else if (actualProvider.includes('xai')) baseURL = 'https://api.x.ai/v1';
        else if (actualProvider.includes('mistral')) baseURL = 'https://api.mistral.ai/v1';

        // Setup Proxy (Like 1st Agent)
        const isBranded = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'].includes(userModel);
        let proxyAgent = null;
        if (isBranded) {
            if (actualProvider.includes('google') || actualProvider.includes('gemini')) {
                proxyAgent = getGeminiProxyAgent(baseURL, true, userModel);
            } else if (actualProvider.includes('groq')) {
                proxyAgent = getGroqProxyAgent(true, userModel);
            } else {
                const proxy = getProxyUrl(userModel);
                proxyAgent = createProxyAgent(proxy);
            }
        }

        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
            timeout: 60000,
            ...(proxyAgent ? { httpAgent: proxyAgent, httpsAgent: proxyAgent } : {}),
            defaultHeaders: getStealthHeaders(apiKey, actualProvider)
        });

        // Request Jitter
        const jitter = Math.floor(Math.random() * 1000) + 500;
        await new Promise(resolve => setTimeout(resolve, jitter));

        let targetModel = userModel;
        if (baseURL.includes('google') && targetModel.includes('/')) targetModel = targetModel.split('/').pop();

        const params = {
            model: targetModel,
            messages: [
                { role: 'system', content: specialistPrompt },
                { role: 'user', content: `User Request: "${userQuery}"\nFind the matching product IDs and return the JSON object.` }
            ],
            temperature: 0.1,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "specialist_response",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            matched_ids: { type: "array", items: { type: "string" } },
                            final_response: { type: "string" }
                        },
                        required: ["matched_ids", "final_response"],
                        additionalProperties: false
                    }
                }
            }
        };

        const completion = await openai.chat.completions.create(params);
        const content = completion.choices[0].message.content;
        
        const parsed = JSON.parse(content);
        const matchedIds = parsed.matched_ids || [];
        const finalResponse = parsed.final_response || "";
        const finalProducts = products.filter(p => matchedIds.map(String).includes(String(p.id)));
        
        return {
            status: 'SUCCESS',
            final_response: finalResponse,
            products: finalProducts.map(p => ({
                id: p.id,
                name: p.name,
                price: `${p.price} ${p.currency || 'BDT'}`,
                stock: p.stock_quantity
            }))
        };

    } catch (e) {
        console.error("[SpecialistAgent] Error:", e.message);
        return { status: 'ERROR', message: e.message };
    }
}

async function expandProductQuery(query, pageConfig) {
    try {
        const userProviderRaw = (pageConfig.ai_provider || pageConfig.ai || 'google').toLowerCase();
        const userProvider = userProviderRaw === 'gemini' ? 'google' : userProviderRaw;
        const userModel = pageConfig.chat_model || 'gemini-1.5-flash';

        let keyData = await keyService.getSmartKey(userProvider, userModel, 'text');
        if (!keyData || !keyData.key) keyData = await keyService.getSmartKey(userProvider, 'default', 'text');

        if (!keyData || !keyData.key) return query;

        const actualProvider = (keyData.provider || userProvider).toLowerCase();
        const apiKey = keyData.key;

        const expansionPrompt = `You are a Search Optimization Expert. 
Convert this user query into a list of 5-8 semantic keywords for database searching.
Include synonyms, features, and functional equivalents.
Query: "${query}"
Output ONLY the keywords separated by commas. 
Example: hair comb, wireless, rechargeable, battery operated, portable`;

        let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        if (actualProvider.includes('openrouter')) baseURL = 'https://openrouter.ai/api/v1';
        else if (actualProvider.includes('openai')) baseURL = 'https://api.openai.com/v1';
        else if (actualProvider.includes('groq')) baseURL = 'https://api.groq.com/openai/v1';

        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
            timeout: 10000,
            defaultHeaders: getStealthHeaders(apiKey, actualProvider)
        });

        let targetModel = userModel;
        if (baseURL.includes('google') && targetModel.includes('/')) targetModel = targetModel.split('/').pop();

        const resp = await openai.chat.completions.create({
            model: targetModel,
            messages: [{ role: 'system', content: expansionPrompt }],
            temperature: 0.3
        });

        const expanded = resp.choices[0].message.content.trim();
        console.log(`[AI Search] Expanded Query: "${query}" -> "${expanded}"`);
        return expanded;
    } catch (e) {
        console.warn("[AI Search] Query expansion failed:", e.message);
        return query;
    }
}

// --- AGENTIC TOOL EXECUTOR ---
async function executeTool(toolCall, pageConfig, userIdFromArgs, platform = null) {
    const { name, arguments: argsString } = toolCall.function;
    const args = JSON.parse(argsString || '{}');
    const userId = pageConfig.user_id; // Store Owner ID
    const pageId = pageConfig.page_id;
    const senderId = userIdFromArgs; // Actual Customer ID

    console.log(`[AgentLoop] Executing tool: ${name} (Platform: ${platform})`, args);

    try {
        switch (name) {
            case 'resolve_product': {
                const query = args.query;
                console.log(`[AgentLoop] Forcing Specialist Agent for query: "${query}"`);
                
                const specialistResult = await runProductSpecialistAgent(query, pageConfig);

                if (specialistResult.status === 'SUCCESS' && specialistResult.products.length > 0) {
                    return {
                        status: 'SUCCESS',
                        FINAL_ANSWER_TO_USER: specialistResult.final_response,
                        products: specialistResult.products
                    };
                }
                
                return { 
                    status: 'NOT_FOUND', 
                    message: `No product matching "${query}" exists in our database. DO NOT guess the price.` 
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
async function runAgentLoop({ apiKey, baseURL, model, messages, tools, pageConfig, proxyAgent, totalTokenUsage, foundProducts, userId, temperature = 0.7, top_p = 0.9, pageId = null }) {
    let loopCount = 0;
    const MAX_LOOP = 3;
    let totalTokensInLoop = totalTokenUsage;
    const platform = pageConfig?.platform || 'external_api';

    const isGoogle = baseURL && (baseURL.includes('generativelanguage.googleapis.com') || baseURL.includes('google'));

    while (loopCount < MAX_LOOP) {
        loopCount++;
        
        // --- FIX: Filter out non-chat models from Agentic Loop ---
        // Whisper is an audio model, it cannot be used for Chat/Agentic Loop.
        if (model.includes('whisper')) {
            console.warn(`[AgentLoop] Model ${model} is NOT a chat model. Skipping loop.`);
            return { 
                reply: null, 
                error: "ChatModel Error: Invalid chat model selected.",
                token_usage: totalTokensInLoop,
                model: model
            };
        }

        console.log(`[AI Request] ${model} | Proxy: ${proxyAgent?.proxySessionName || 'NONE'} | URL: ${baseURL}`);

        // --- STEALTH: REQUEST JITTER ---
        // Random delay between 800ms and 2500ms to mimic human typing/thinking
        const jitter = Math.floor(Math.random() * 1700) + 800;
        await new Promise(resolve => setTimeout(resolve, jitter));

        try {
            let responseMessage;
            let toolCalls = [];
            let completionUsage;

            // Unified OpenAI-Compatible Client
            const openai = new OpenAI({ 
                apiKey: apiKey, 
                baseURL: baseURL,
                timeout: 180000, // Increased to 180s (3 minutes) to support slower models like Gemma 4/DeepSeek
                ...(proxyAgent ? { httpAgent: proxyAgent, httpsAgent: proxyAgent } : {}),
                defaultHeaders: getStealthHeaders(apiKey, baseURL.includes('openrouter') ? 'openrouter' : (baseURL.includes('generativelanguage') ? 'google' : 'openai'))
            });

            // Defensive params for Google/Gemini
            let targetModel = model;
            if (isGoogle && targetModel.includes('/')) targetModel = targetModel.split('/').pop();
            
            const params = {
                model: targetModel,
                messages: messages,
                temperature: temperature,
                top_p: top_p
            };

            // --- STRATEGIC JSON ENFORCEMENT (Structured Outputs) ---
            // User Request: Stable JSON for Lite models without restrictive prompts.
            // Logic: Use response_format for supported providers.
            const pBase = String(baseURL || '').toLowerCase();
            const isLite = model.toLowerCase().includes('lite') || model.toLowerCase().includes('flash') || model.toLowerCase().includes('mini');
            
            // Check Provider Support for Structured Outputs (OpenAI, OpenRouter, Groq, Mistral, Gemini v1beta)
            const supportsStructured = 
                pBase.includes('openai.com') || 
                pBase.includes('openrouter.ai') || 
                pBase.includes('groq.com') || 
                pBase.includes('mistral.ai') ||
                (isGoogle && pBase.includes('v1beta')); // Gemini v1beta supports json_schema

            if (supportsStructured) {
                params.response_format = {
                    type: "json_schema",
                    json_schema: {
                        name: "sales_response",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                thought: { type: "string", description: "Internal reasoning or planning. E.g., 'I will search for the product price now.'" },
                                reply_text: { type: "string", description: "The human-like response to the user. Leave EMPTY if you are calling a tool to find information." },
                                action: { type: "string", enum: ["NONE", "SEND_DETAILS", "SEND_PHOTO", "SEND_BOTH", "save_order", "CALL_SPECIALIST"], description: "The action to take." },
                                search_query: { type: ["string", "null"], description: "The search query for the specialist agent if action is CALL_SPECIALIST." },
                                product_id: { type: ["string", "null"], description: "The ID of the matched product." },
                                image_urls: { type: "array", items: { type: "string" }, description: "List of image URLs to send." },
                                customer_phone: { type: ["string", "null"] },
                                customer_address: { type: ["string", "null"] },
                                customer_name: { type: ["string", "null"] },
                                product_name: { type: ["string", "null"] },
                                quantity: { type: ["number", "null"] },
                                price: { type: ["number", "null"] },
                                order_details: {
                                    type: ["object", "null"],
                                    properties: {
                                        intent: { type: "string" },
                                        fields: {
                                            type: "object",
                                            properties: {
                                                phone: { type: ["string", "null"] },
                                                address: { type: ["string", "null"] },
                                                customer_name: { type: ["string", "null"] },
                                                product_name: { type: ["string", "null"] },
                                                quantity: { type: ["string", "null"] },
                                                price: { type: ["string", "null"] }
                                            },
                                            required: ["phone", "address", "customer_name", "product_name", "quantity", "price"]
                                        }
                                    },
                                    required: ["intent", "fields"]
                                }
                            },
                            required: ["thought", "reply_text", "action", "search_query", "product_id", "image_urls", "customer_phone", "customer_address", "customer_name", "product_name", "quantity", "price", "order_details"],
                            additionalProperties: false
                        }
                    }
                };
            }

            const completion = await openai.chat.completions.create(params);

            responseMessage = completion.choices[0].message;
            toolCalls = responseMessage.tool_calls;
            completionUsage = completion.usage;

            const providerName = isGoogle ? 'Google' : (baseURL.includes('openrouter') ? 'OpenRouter' : (baseURL.includes('groq') ? 'Groq' : 'OpenAI'));
            console.log(`[AI Response] Status: Success | Provider: ${providerName} | Tokens: ${completionUsage?.total_tokens || 0} | Proxy: ${proxyAgent?.proxySessionName || 'NONE'}`);
            
            // Add AI's response to history
            messages.push(responseMessage);

            // --- OPTIMIZATION: SINGLE CALL AGENT LOGIC ---
            // User Request: Reduce cost by avoiding 2nd API call for tool results.
            // Strategy: If the AI provided a 'reply_text' AND tool calls in the same turn, 
            // we execute the tools in background and return the reply IMMEDIATELY.
            
            const aiText = responseMessage.content || "";
            let structured = null;
            try {
                const firstBrace = aiText.indexOf('{');
                const lastBrace = aiText.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    structured = JSON.parse(aiText.substring(firstBrace, lastBrace + 1));
                }
            } catch (e) {}

            if (toolCalls && toolCalls.length > 0) {
                console.log(`[AgentLoop] AI requested ${toolCalls.length} tool calls.`);
                
                for (const toolCall of toolCalls) {
                    const result = await executeTool(toolCall, pageConfig, userId, platform);
                    if (result.product) foundProducts.push(result.product);

                    // --- CRITICAL FIX: Add tool result to messages so AI can see it in next turn ---
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: typeof result === 'string' ? result : JSON.stringify(result)
                    });
                }

                totalTokensInLoop += (completionUsage?.total_tokens || 0);
                continue; // Re-call AI with tool results
            }

            // No more tool calls -> Final Answer
            const aiTextFinal = responseMessage.content || "";
            const tokenUsage = (completionUsage && completionUsage.total_tokens) ? completionUsage.total_tokens : estimateTokenUsage(messages, aiTextFinal, 0);
            
            // --- AGENTIC JSON PARSER & AUTO-ORDER FALLBACK ---
            try {
                const strippedThought = aiTextFinal.replace(/<\s*thought[\s\S]*?<\/\s*thought\s*>/gi, '');
                const firstBrace = strippedThought.indexOf('{');
                const lastBrace = strippedThought.lastIndexOf('}');
                
                let structuredFinal = null;
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    const potentialJson = strippedThought.substring(firstBrace, lastBrace + 1);
                    try {
                        structuredFinal = JSON.parse(potentialJson);
                    } catch (e) {
                        console.warn(`[AgentLoop] JSON Parse Error: ${e.message}. Trying to fix common Bangla formatting issues...`);
                        const cleanedJson = potentialJson
                            .replace(/^[\s`]*```(?:json|JSON)?/i, '')
                            .replace(/```[\s`]*$/, '')
                            .replace(/[\u200B-\u200D\uFEFF]/g, '')
                            .replace(/\\n/g, ' ')
                            .replace(/\n/g, ' ')
                            .replace(/\uFF1A/g, ':')
                            .replace(/[\u201C\u201D]/g, '"')
                            .replace(/:\s*'([^']*)'/g, ': "$1"')
                            .replace(/'([A-Za-z0-9_]+)'\s*:/g, '"$1":')
                            .replace(/,\s*([}\]])/g, '$1')
                            .replace(/\"image_urls\"\s*:\s*,/g, '"image_urls": [],');
                        try {
                            structuredFinal = JSON.parse(cleanedJson);
                        } catch (e2) {
                            console.error(`[AgentLoop] Final JSON Parse Failure.`);
                        }
                    }
                }

                if (structuredFinal) {
                    // --- NEW: DUAL AGENT JSON TRIGGER ---
                    // If Main Agent decides it needs a specialist, we trigger it immediately via JSON.
                    if (structuredFinal.action === 'CALL_SPECIALIST') {
                        const query = structuredFinal.search_query || structuredFinal.reply_text || "all products";
                        console.log(`[AgentLoop] 🤖 Triggering Specialist Agent via JSON action: "${query}"`);
                        
                        const specialistResult = await runProductSpecialistAgent(query, pageConfig);
                        
                        if (specialistResult.status === 'SUCCESS') {
                            console.log(`[AgentLoop] ✅ Specialist Agent delivered final response.`);
                            return {
                                reply: specialistResult.final_response,
                                action: "SEND_DETAILS", 
                                product_id: specialistResult.products?.[0]?.id || null,
                                image_urls: [],
                                order_details: structuredFinal.order_details || null,
                                sentiment: 'neutral',
                                token_usage: totalTokensInLoop + (completionUsage?.total_tokens || 0),
                                model: model,
                                foundProducts: specialistResult.products
                            };
                        } else {
                            console.warn(`[AgentLoop] ⚠️ Specialist Agent failed: ${specialistResult.message}`);
                        }
                    }

                    // --- AUTO-ORDER SAVE FALLBACK (User Request: JSON based incremental order save) ---
                    // CASE A/B/C: AI provides any piece of order data (phone, address, etc.)
                    if (structuredFinal.order_details || (structuredFinal.action === "save_order" && (structuredFinal.order_data || structuredFinal.details)) || structuredFinal.customer_phone || structuredFinal.customer_address || structuredFinal.phone) {
                        
                        // Unified Order Data Object with Validation & Precision
                        const rawData = structuredFinal.order_details || structuredFinal.order_data || structuredFinal.details || {};
                        
                        // Mapping fields from different potential AI structures
                        const customerPhone = structuredFinal.customer_phone || structuredFinal.phone || rawData.phone || rawData.customer_phone || null;
                        const customerAddress = structuredFinal.customer_address || rawData.address || rawData.customer_address || null;
                        const customerName = structuredFinal.customer_name || structuredFinal.name || rawData.name || rawData.customer_name || "Unknown";
                        const productName = structuredFinal.product_name || structuredFinal.product || rawData.product_name || rawData.product || "Unknown";

                        const orderData = {
                            product_name: productName,
                            quantity: parseInt(rawData.quantity || structuredFinal.quantity || 1) || 1,
                            price: parseFloat(rawData.price || structuredFinal.price || 0) || 0,
                            customer_name: customerName,
                            customer_phone: customerPhone ? String(customerPhone).replace(/[^\d+]/g, '') : null,
                            customer_address: customerAddress ? String(customerAddress).trim() : null
                        };

                        // Phone First Rule: Start saving only if phone exists
                        if (orderData.customer_phone && orderData.customer_phone.length >= 10) {
                            console.log(`[AgentLoop] 📦 Phone detected. Proceeding with order orchestration...`);
                            
                            try {
                                const orderService = require('./orderService');
                                if (orderService && orderService.orchestrateOrder) {
                                    // Use orchestrateOrder which is the standard way this project saves orders
                                    await orderService.orchestrateOrder({
                                        pageId: pageConfig?.page_id || pageId || pageConfig?.id,
                                        senderId: userId,
                                        platform: platform || 'messenger',
                                        intent: 'upsert',
                                        data: {
                                            product_name: orderData.product_name,
                                            phone: orderData.customer_phone,
                                            address: orderData.customer_address,
                                            quantity: orderData.quantity,
                                            price: orderData.price,
                                            customer_name: orderData.customer_name
                                        }
                                    });
                                    console.log(`[AgentLoop] ✅ Order Orchestrated Successfully via orderService.`);
                                }
                            } catch (err) {
                                console.error(`[AgentLoop] ❌ Order Orchestration Error:`, err.message);
                            }
                        } else {
                            console.log(`[AgentLoop] ⏳ No phone detected yet. Skipping order save/update.`);
                        }
                    }

                    const reply = structuredFinal.reply_text || structuredFinal.reply || structuredFinal.message || structuredFinal.response;

                    if (reply) {
                        const cleaned = String(reply).trim();
                        const isJustPunctuation = /^[\s\p{P}]+$/u.test(cleaned);
                        if (isJustPunctuation && cleaned.length > 0) {
                             console.log(`[AgentLoop] Silencing punctuation-only JSON reply: "${cleaned}"`);
                             return { 
                                reply: "", 
                                action: "NONE",
                                product_id: null,
                                token_usage: tokenUsage + totalTokensInLoop, 
                                model: model, 
                                foundProducts 
                            };
                        }

                        return { 
                            reply: reply, 
                            action: structuredFinal.action || "NONE",
                            product_id: structuredFinal.product_id || null,
                            image_urls: Array.isArray(structuredFinal.image_urls) ? structuredFinal.image_urls : [],
                            order_details: structuredFinal.order_details || null,
                            token_usage: tokenUsage + totalTokensInLoop, 
                            model: model, 
                            foundProducts 
                        };
                    }
                } else if (aiTextFinal.trim().length > 0) {
                    // LLM sent a plain text response instead of JSON. 
                    const cleaned = aiTextFinal.trim();
                    const isJustPunctuation = /^[\s\p{P}]+$/u.test(cleaned);
                    
                    if (isJustPunctuation) {
                         console.log(`[AgentLoop] Silencing punctuation-only plain text: "${cleaned}"`);
                         return {
                            reply: "",
                            action: "NONE",
                            product_id: null,
                            token_usage: tokenUsage + totalTokensInLoop,
                            model: model,
                            foundProducts
                        };
                    }

                    console.log(`[AgentLoop] LLM sent plain text instead of JSON. Using as reply_text.`);
                    return {
                        reply: cleaned,
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
                reply: aiTextFinal, 
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
        reply: null, 
        error: "AgentLoop max iterations reached",
        token_usage: totalTokensInLoop,
        model: model
    };
}

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer', ownerName = 'Automation Hub BD', senderGender = null, imageUrls = [], audioUrls = [], extraTokenUsage = 0, userId = null, pageId = null) {
    // --- SAFETY FIX: Ensure names are not null ---
    if (!senderName || senderName === 'null') senderName = 'Customer';
    if (!ownerName || ownerName === 'null') ownerName = 'Automation Hub BD';

    let cleanUserMessage = (userMessage || '').trim();
    let currentContextId = null; // For context-aware semantic cache

    // 0. Unified Logger Helper (Defined at top to avoid Hoisting/Initialization errors)
    const finalize = async (result) => {
        // Release slot before finishing
        releaseAiSlot();

        if (!result) return null;
        
        let displayModel = 'unknown';
        let usageTokens = 0;
        let cost = 0;

        // --- 1. Log to AI Usage Logs (ai_usage_logs table) ---
        // This is the main log table for the dashboard.
        // User request: "ai usagees logs null hoye ase"
        try {
            // Debug: Log incoming data to console to see what we're sending to DB
            console.log(`[AI Logger] Finalizing response for User: ${pageConfig.user_id}, Page: ${pageConfig.page_id}`);
            
            const isRequestBilling = pageConfig.billing_mode === 'request' || pageConfig.is_external_api === true;
            
            // --- SMART LOGGING FOR FALLBACK MODELS ---
            displayModel = pageConfig.display_model || pageConfig.chat_model || result.model || 'unknown';
            
            // If the actual model used (result.model) is different from the primary model, mark it as Fallback in logs
            const isFallback = result.model && primaryModel && result.model !== primaryModel;
            if (isFallback) {
                displayModel = `${displayModel} (${result.model.split('/').pop()} Fallback)`;
            }

            usageTokens = isRequestBilling ? 1 : (result.token_usage || 0);
            cost = isRequestBilling
                ? dbService.calculateRequestCost(displayModel, 1)
                : dbService.calculateCost(displayModel, usageTokens);
            
            // --- FIX: Branded Error Message for UI ---
        // If there's an error, we only show the branded error message to the user
        let uiError = result.error || null;
        if (uiError) {
            // Mask technical provider errors with Branded Identity
            if (uiError.includes('400') || uiError.includes('429') || uiError.includes('500') || uiError.includes('API') || uiError.includes('Provider')) {
                uiError = "SalesmanChatbot AI: Model configuration error or temporary service interruption. Please try again later.";
            }
        }

            const logData = {
                user_id: pageConfig.user_id,
                page_id: pageConfig.page_id,
                model: displayModel,
                prompt_tokens: 0, // We usually have total_tokens in token_usage
                completion_tokens: 0,
                total_tokens: usageTokens,
                cost: cost,
                status: result.error ? 'error' : 'success',
                error_message: result.error || null, // Keep original error in DB logs for Admin
                sender_name: senderName || 'Customer',
                user_message: userMessage || '',
                ai_reply: result.reply || (uiError ? `[Error]: ${uiError}` : null),
                raw_model: result.model || null // Track actual model used
            };
            
            // Call dbService to log this. (Fire and forget, but with internal catch)
            if (dbService.logAiUsage) {
                dbService.logAiUsage(logData).catch(err => {
                    console.error("[AI Logger] dbService.logAiUsage error:", err.message);
                });
            } else {
                console.warn("[AI Logger] dbService.logAiUsage is not defined!");
            }

            // Update result for final return (Branding)
            if (result) result.model = displayModel;
            if (result.error) result.error = uiError;
        } catch (err) {
            console.warn("[AI Logger] Error preparing logData:", err.message);
        }

        // --- AUTO-SAVE TO SEMANTIC CACHE ---
        try {
            const semEnabled = pageConfig && (pageConfig.semantic_cache_enabled === true || pageConfig.semantic_cache_enabled === 1 || pageConfig.semantic_cache_enabled === 'true');
            const embedEnabled = pageConfig && (pageConfig.embed_enabled === true || pageConfig.embed_enabled === 1 || pageConfig.embed_enabled === 'true');
            const autosaveEnabled = pageConfig && (pageConfig.semantic_cache_autosave !== false && pageConfig.semantic_cache_autosave !== 'false');
            const canCache = isCacheable(cleanUserMessage);
            
            // Only auto-save if autosaveEnabled is TRUE
            if (autosaveEnabled && (semEnabled || embedEnabled) && !usedSemanticCache && canCache && result && result.reply && cleanUserMessage) {
                if (embedEnabled) {
                    getEmbedding(cleanUserMessage).then(v => {
                        dbService.saveSemanticCacheEntry({
                            page_id: pageConfig.page_id || null,
                            session_name: pageConfig.page_id || null,
                            context_id: currentContextId, 
                            question: cleanUserMessage,
                            response: result.reply,
                            vector: v
                        }).catch(e => console.warn(`[AI] Background vector cache save failed: ${e.message}`));
                    }).catch(e => console.warn(`[AI] Failed to generate embedding for save: ${e.message}`));
                } else {
                    dbService.saveSemanticCacheEntry({
                        page_id: pageConfig.page_id || null,
                        session_name: pageConfig.page_id || null,
                        context_id: currentContextId, 
                        question: cleanUserMessage,
                        response: result.reply
                    }).catch(e => console.warn(`[AI] Background cache save failed: ${e.message}`));
                }
            }
        } catch (e) {
            console.warn(`[AI] Failed to trigger semantic cache save: ${e.message}`);
        }

        // --- 2. Log to API Usage Stats (api_usage_stats table) ---
        if (pageConfig.user_id && (result.token_usage > 0 || pageConfig.is_external_api === true || pageConfig.billing_mode === 'request')) {
            // isRequestBilling, displayModel, usageTokens, cost are already calculated above
            // Fire and forget (don't await to keep response fast)
            dbService.logApiUsage(pageConfig.user_id, displayModel, usageTokens, cost);
        }

        // --- 3. Force Flush Key Stats to DB ---
        if (keyService.flushUsageStats) {
            keyService.flushUsageStats(); 
        }
        
        return result;
    };
    
    // --- 1. CONVERSATION STATE: Fetch Last Product Context ---
    let lastProductContext = null;
    if (userId && pageConfig.page_id) {
        try {
            const state = await dbService.getConversationState(pageConfig.page_id, userId);
            if (state && state.last_product_id) {
                currentContextId = state.last_product_id;
                lastProductContext = `[CONTEXT: LAST_RESOLVED_PRODUCT_ID: "${state.last_product_id}"] (Note: User is likely referring to this product if they say "it", "this", or "how to use" without naming it.)`;
            }
        } catch (e) {
            console.warn("[AI Context] Failed to fetch conv state:", e.message);
        }
    }

    // --- 2. QUICK SEMANTIC CACHE CHECK (No AI Slot needed) ---
    let usedSemanticCache = false;
    let userMessageVector = null;
    try {
        const semEnabled = pageConfig && (pageConfig.semantic_cache_enabled === true || pageConfig.semantic_cache_enabled === 1 || pageConfig.semantic_cache_enabled === 'true');
        const embedEnabled = pageConfig && (pageConfig.embed_enabled === true || pageConfig.embed_enabled === 1 || pageConfig.embed_enabled === 'true');
        const threshold = pageConfig && pageConfig.semantic_cache_threshold ? Math.max(0.5, Math.min(0.99, Number(pageConfig.semantic_cache_threshold))) : 0.96;
        const isMediaTurn = (imageUrls && imageUrls.length > 0) || (audioUrls && audioUrls.length > 0);
        
        // --- FIX: Lookup only happens if Semantic Cache is explicitly ENABLED ---
        if (semEnabled && !isMediaTurn && cleanUserMessage) {
            let cacheQuery = cleanUserMessage;
            if (cleanUserMessage.length < 15 && history.length > 0) {
                const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
                if (lastUserMsg && lastUserMsg.content) {
                    cacheQuery = `${lastUserMsg.content} ${cleanUserMessage}`;
                }
            }

            // If Embedding is also enabled, generate vector for lookup
            if (embedEnabled) {
                userMessageVector = await getEmbedding(cacheQuery);
            }

            const cached = await dbService.findSemanticCache({
                page_id: pageConfig.page_id || null,
                session_name: pageConfig.page_id || null,
                context_id: currentContextId,
                question: cacheQuery,
                threshold,
                vector: userMessageVector
            });
            if (cached) {
                console.log(`[AI] Semantic Cache HIT! (Type: ${userMessageVector ? 'Vector' : 'Fuzzy'}, Threshold: ${threshold})`);
                usedSemanticCache = true;
                return finalize({ 
                    reply: cached, 
                    sentiment: 'neutral', 
                    token_usage: 0, 
                    model: 'semantic-cache' 
                });
            }
        }
    } catch (e) {
        console.warn(`[AI] Semantic Cache check failed: ${e.message}`);
    }

    // --- 3. ACQUIRE AI SLOT (Only for actual LLM calls) ---
    await acquireAiSlot();

    // --- SMART HISTORY PROCESSOR ---
    const processedHistory = [];
    let pendingSystemNotes = [];

    // Inject last product context if available (only if user provided one)
    if (lastProductContext) {
        pendingSystemNotes.push(lastProductContext);
    }

    // MANDATORY RE-INJECTION: Disabled per user feedback
    /*
    const mandatoryReinjection = `[REMINDER: MANDATORY RULES]
1. IDENTITY: You are SalesmanChatbot.
2. PRODUCTS: Use only names from the snapshot.
3. ORDERS: Save phone/address via 'order_details' JSON field.
4. CONTEXT: Follow the shop rules from the initial system prompt.

${productContext}`;
    */

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

    /*
    if (mandatoryReinjection) {
        pendingSystemNotes.push(mandatoryReinjection);
    }
    */


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

    // --- MULTI-TENANCY SAFETY CHECK ---
    const activePageId = pageConfig.page_id || pageId;
    
    // Check Cheap Engine Flag (Default to TRUE if undefined/null, for zero-cost)
    const useCheapEngine = pageConfig.cheap_engine !== false;

    const promptPreview = pagePrompts?.text_prompt ? pagePrompts.text_prompt.substring(0, 30) : "DEFAULT";
    console.log(`[AI Isolation Check] Generating for Page ID: ${activePageId} | CheapEngine: ${useCheapEngine} | Sender: ${senderName} | Prompt: "${promptPreview}..."`);
    // ----------------------------------

    let totalTokenUsage = extraTokenUsage || 0;
    const isVision = (imageUrls && imageUrls.length > 0);
    const isAudio = (audioUrls && audioUrls.length > 0);

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
        const strictVisionStop = pageConfig && (pageConfig.vision_strict_stop === true || pageConfig.vision_strict_mode === true);
        let anyVisionFail = false;
        for (const res of imageResults) {
            if (typeof res === 'object' && typeof res.text === 'string' && res.text.startsWith('[Vision Analysis Failed]')) {
                anyVisionFail = true;
                break;
            }
        }
        if (strictVisionStop && anyVisionFail) {
            console.warn(`[AI] Vision strict mode: stopping workflow due to vision failure.`);
            return finalize({
                reply: null,
                error: "Vision analysis failed. Workflow stopped by policy.",
                token_usage: totalTokenUsage,
                model: pageConfig.chat_model || 'salesmanchatbot-pro'
            });
        }

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
        // --- FIX: Direct Media Return for External API (Cost Optimization) ---
        // User request: "analyze result tai patai dibe... 2 ta ai call korle to amr loss"
        // If it's an external API call and we have media, return analysis immediately.
        // This prevents a second AI call (AgentLoop) and saves API costs.
        if (pageConfig.is_external_api) {
            console.log(`[AI] External API Media Detected. Returning analysis directly to save costs.`);
            return finalize({
                reply: mediaContext.trim(),
                sentiment: 'neutral',
                token_usage: totalTokenUsage,
                model: 'media-processor'
            });
        }

        cleanUserMessage += `\n\n[NEW VISUAL CONTEXT - IMPORTANT]:\nThe user has just sent the following image(s). This is the CURRENT FOCUS of the conversation. If the user asks "eta ase?" or "price koto?", they are referring to the product(s) described below, NOT anything from the previous history.\n\nDescription of New Image(s):\n${mediaContext.trim()}\n[END OF NEW VISUAL CONTEXT]`;
        console.log(`[AI] Added media context to user message. Total Tokens so far: ${totalTokenUsage}`);
    }

    // --- AGENTIC DYNAMIC SNAPSHOT ---
    // Instead of putting all 400 products, we inject a smart snapshot of the top 15 most relevant items.
    let productContext = "";
    if (pageConfig.user_id && cleanUserMessage) {
        try {
            const normalizeUrl = (url) => {
                if (!url || url === 'N/A') return 'N/A';
                if (url.startsWith('http')) return url;
                const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
                const cleanPath = url.startsWith('/') ? url : `/${url}`;
                return `${baseUrl}${cleanPath}`;
            };

            // 1. Extract a clean search query
            let userOnlyText = cleanUserMessage.split('[NEW VISUAL CONTEXT')[0].trim();
            
            // 2. SMART EXTRACTION: Extract only the product name from visual context
            let visualProductName = "";
            if (mediaContext.includes('[Image Analysis Result]') || mediaContext.includes('Description of New Image(s)')) {
                // More robust regex for both * and ** formats
                const nameMatch = mediaContext.match(/(?:\*+ )?Product Name:?\s*\*?\*?\s*(.*)/i) || mediaContext.match(/Product:\s*(.*)/i);
                if (nameMatch && nameMatch[1]) {
                    visualProductName = nameMatch[1].trim().replace(/\*+$/, "");
                }
            }

            let searchInput = visualProductName || userOnlyText;
            
            // EMERGENCY FALLBACK: If query is still empty but we have mediaContext, use first line of description
            if (!searchInput && mediaContext.length > 20) {
                searchInput = mediaContext.split('\n').find(l => l.length > 10 && !l.includes('Visual')) || "";
            }
            
            // If we have both, combine them for a stronger signal
            if (visualProductName && userOnlyText && userOnlyText.length > 3 && !userOnlyText.match(/^(dam|price|koto|ase|ki|আছে|দাম|কত|হবে)/i)) {
                searchInput = `${visualProductName} ${userOnlyText}`;
            }

            console.log(`[AI Search] Smart Query: "${searchInput}"`);

            const candidates = await dbService.searchProducts(pageConfig.user_id, searchInput, pageConfig.page_id);
            if (candidates && candidates.length > 0) {
                const topCandidates = candidates.slice(0, 15);
                productContext = "[DATABASE SNAPSHOT - VERIFIED PRODUCTS]\n";
                topCandidates.forEach((p, idx) => {
                    const priceValue = p.price ? `${p.price} ${p.currency || 'BDT'}`.trim() : 'Ask for Price';
                    productContext += `PRODUCT_ID: ${p.id} | NAME: ${p.name} | PRICE: ${priceValue}\n`;
                    if (p.variants && typeof p.variants === 'object' && JSON.stringify(p.variants) !== '{}') {
                        productContext += `   VARIANTS: ${JSON.stringify(p.variants)}\n`;
                    }
                    if (p.description) productContext += `   DESCRIPTION: ${p.description.substring(0, 100)}...\n`;
                });
                productContext += "\n[STRICT RULE]: You must ONLY use the prices from the [DATABASE SNAPSHOT] above. If a product matches the user's request (or image), use its EXACT price. DO NOT hallucinate or use prices from your memory or history.";
            }
        } catch (err) {
            console.warn("[AI] Dynamic snapshot failed:", err.message);
        }
    }
    if (productContext) pendingSystemNotes.push(productContext);

    // --- MEDIA HANDLING COMPLETED ABOVE ---
    // (Consolidated into Pre-process Media step to ensure correct token tracking)
    // ----------------------------------------

    // --- PROMPT & MESSAGE CONSTRUCTION ---
    let messages = [];
    let responseFormat = undefined; 
    
    // --- TOOL ENABLING LOGIC ---
    // User Request: "monster-3.0 - implement Agentic RAG for 100% accuracy and token savings"
    // Instead of injecting ALL products upfront, we give the AI tools to search dynamically.
    const tools = functionTools; 

    // --- IDENTITY PROTECTION PROTOCOL (WHITE-LABEL) ---
    const isBrandedModel = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'].includes(userModel);
    const identityInvariant = isBrandedModel 
        ? `[STRICT IDENTITY RULE]: You are SalesmanChatbot, a proprietary high-performance AI developed by SalesmanChatbot Team. You are NOT Google Gemini, Groq, Meta, or any other LLM. NEVER mention any other company's name or model name. If asked about your training or identity, state that you are a proprietary SalesmanChatbot AI.`
        : "";

    if (pageConfig.is_external_api) {
        // --- EXTERNAL API PATH (n8n, Third-party Servers) ---
        // Goal: Provide a RAW experience but with STRICT IDENTITY PROTECTION.
        
        const userSystemPrompt = pagePrompts?.text_prompt || "";
        const finalSystemPrompt = `${identityInvariant}\n\n${userSystemPrompt}`.trim();

        if (finalSystemPrompt) {
            messages.push({ role: 'system', content: finalSystemPrompt });
        }
        
        messages.push(...processedHistory);
        
        let finalUserMsg = cleanUserMessage;
        // Strip any internal system notes from the user message for external API
        finalUserMsg = finalUserMsg.replace(/\[Visual Content Description\]:[\s\S]*/gi, '').trim();
        finalUserMsg = finalUserMsg.replace(/\[System Note:[\s\S]*?\]/gi, '').trim();
        
        messages.push({ role: 'user', content: finalUserMsg });
        
        console.log(`[AI] External API Mode: Strict Identity Protection Active.`);

    } else {
        // --- INTERNAL SYSTEM PATH (Messenger, WhatsApp, Own API Button) ---
        // Goal: Full Sales automation with Enforced JSON and Lead Capture.
        const userProvidedPrompt = pagePrompts?.text_prompt || "";
        const basePrompt = userProvidedPrompt || "You are a helpful AI Salesman.";
        
        const unifiedSystemPrompt = `${identityInvariant}\n\n[BUSINESS OWNER'S MANDATORY INSTRUCTIONS]
${basePrompt}

[RULE 1: PRODUCT INFO & INTEGRITY]
- You have NO internal knowledge of prices or stock.
- Whenever the user asks about a product, price, stock, or availability, you MUST set "action": "CALL_SPECIALIST" and provide a "search_query" in your JSON output.
- DO NOT call 'resolve_product' for greetings (e.g., "hi", "hello"), personal questions, or general conversation.
- STRICT PRICING RULE: You must ONLY provide prices from tool results. NEVER guess.
- STOCK CHECK: If 'stock_quantity' is 0, inform the user it's out of stock.

[RULE 2: VISUALS & PHOTO INTENT]
- PHOTO INTENT: If the user asks for a photo/image, set "action": "SEND_PHOTO" and provide the "product_id".
- action: ["NONE", "SEND_DETAILS", "SEND_PHOTO", "SEND_BOTH", "CALL_SPECIALIST", "save_order"]
- search_query: The specific product or keywords to search for (e.g., "Kemei hair straightener", "mango price").
- product_id: Numeric product ID from database (as string), e.g., "101".
- image_urls: Array of image URLs to attach for the user to see.

[RULE 3: SALES WORKFLOW & CRM]
- INCREMENTAL SAVING: Save customer info (name, phone, address, product, quantity) as soon as ANY piece of data is provided.
- DATA PERSISTENCE: Always include the latest known values for all order fields in every JSON response until the conversation ends. Update fields if the customer changes them.
- order_details: Whenever the user provides ANY order info, you MUST include it here.

[RESPONSE FORMAT]
{
  "reply_text": "A brief acknowledgment (e.g., 'Let me check that for you...')",
  "action": "CALL_SPECIALIST",
  "search_query": "Product name or keywords",
  "product_id": "...",
  "image_urls": ["url1", "url2"],
  "customer_phone": "Extracted phone or null",
  "customer_address": "Extracted address or null",
  "customer_name": "Extracted name or null",
  "product_name": "Product name or null",
  "quantity": 1,
  "price": 0,
  "order_details": {
    "intent": "order_create_or_update",
    "fields": {
       "phone": "...",
       "address": "...",
       "customer_name": "...",
       "product_name": "...",
       "quantity": "...",
       "price": "..."
    }
  }
}`;

        const systemMessage = { role: 'system', content: unifiedSystemPrompt };

        const lastHistoryMsg = processedHistory.length > 0 ? processedHistory[processedHistory.length - 1] : null;
        let isDuplicate = false;
        
        if (lastHistoryMsg && lastHistoryMsg.role === 'user') {
            const histContent = typeof lastHistoryMsg.content === 'string' ? lastHistoryMsg.content.trim() : JSON.stringify(lastHistoryMsg.content);
            const currContent = cleanUserMessage.trim();
            if (histContent === currContent) {
                isDuplicate = true;
            }
        }

        messages = [
            systemMessage,
            ...processedHistory
        ];

        if (productContext) {
            messages.push({ role: 'system', content: productContext });
        }

        if (!isDuplicate) {
            messages.push({ role: 'user', content: cleanUserMessage });
        }
    }

    // --- UNIFIED AI REQUEST LOGIC ---
    const isOurOwnProvider = defaultProvider === 'salesmanchatbot' || defaultProvider === 'system';

    // SPECIAL PATH: Use Own SalesmanChatbot API when selected
    if (!useCheapEngine && defaultProvider === 'salesmanchatbot' && pageConfig.api_key) {
        try {
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
            const resp = await axios.post(base, payload, { headers, timeout: 300000 }); // 5 minutes
            const data = resp.data;
            let aiText = data?.choices?.[0]?.message?.content || null;
            const tokenUsage = data?.usage?.total_tokens || 0;

            if (aiText) {
                // --- NEW AGENTIC JSON PARSER (SAFE & ROBUST) ---
                try {
                    // 1. More robust cleaning: find the first { and last }
                    const firstBrace = aiText.indexOf('{');
                    const lastBrace = aiText.lastIndexOf('}');
                    
                    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                        const potentialJson = aiText.substring(firstBrace, lastBrace + 1);
                        const structured = JSON.parse(potentialJson);
                        
                        // --- DUAL AGENT TRIGGER (Own API Path) ---
                        if (structured.action === 'CALL_SPECIALIST') {
                            const query = structured.search_query || structured.reply_text || "all products";
                            console.log(`[AI] 🤖 Triggering Specialist Agent via Own API: "${query}"`);
                            
                            const specialistResult = await runProductSpecialistAgent(query, pageConfig);
                            
                            if (specialistResult.status === 'SUCCESS') {
                                return finalize({
                                    reply: specialistResult.final_response,
                                    action: "SEND_DETAILS",
                                    product_id: specialistResult.products?.[0]?.id || null,
                                    image_urls: [],
                                    order_details: structured.order_details || null,
                                    sentiment: 'neutral',
                                    token_usage: tokenUsage + totalTokenUsage,
                                    model: modelToUse,
                                    foundProducts: specialistResult.products
                                });
                            }
                        }

                        // If it's our own internal structured format, return it
                        if (structured.reply_text || structured.order_details) {
                            return finalize({ 
                                reply: structured.reply_text || aiText.substring(0, firstBrace).trim(), 
                                action: structured.action || "NONE",
                                product_id: structured.product_id || null,
                                image_urls: Array.isArray(structured.image_urls) ? structured.image_urls : [],
                                order_details: structured.order_details || null,
                                sentiment: 'neutral', 
                                token_usage: tokenUsage + totalTokenUsage, 
                                model: modelToUse, 
                                foundProducts 
                            });
                        }
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

    // PHASE 1: Try User-Provided Keys (Own API)
    let userKeyAttempted = false;
    
    // SaaS Logic: If user provides a real key (not our managed placeholder), 
    // we use it regardless of cheap_engine setting to give them full control.
    const hasOwnKey = pageConfig.api_key && 
                      pageConfig.api_key !== 'MANAGED_SECRET_KEY' && 
                      !pageConfig.api_key.startsWith('salesman_');
    
    if (hasOwnKey && !isOurOwnProvider) {
        console.log(`[AI] Phase 1: Using User's OWN API Key (${pageConfig.ai_provider})`);
        userKeyAttempted = true;
        const userKeys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);

        // Shuffle keys
        for (let i = userKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [userKeys[i], userKeys[j]] = [userKeys[j], userKeys[i]];
        }

        let lastPhase1Error = null;
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
                const modelToUse = pageConfig.chat_model;
                if (!modelToUse) {
                     throw new Error("No model selected for Own API. Please select a model in your settings.");
                }

                // Determine if proxy should be used
                // User Request: Proxy ONLY for branded models to save costs and avoid 429/400 errors for direct keys.
                const isBranded = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'].includes(modelToUse);
                const useProxy = isBranded; 
                
                let proxyAgent = null;
                if (useProxy) {
                    if (currentProvider.includes('google') || currentProvider.includes('gemini')) {
                        proxyAgent = getGeminiProxyAgent(baseURL, true, isBranded ? modelToUse : 'gemini-tester');
                    } else if (currentProvider.includes('groq')) {
                        proxyAgent = getGroqProxyAgent(true, isBranded ? modelToUse : 'groq-tester');
                    } else {
                        const proxy = getProxyUrl(isBranded ? modelToUse : 'custom-tester');
                        proxyAgent = createProxyAgent(proxy);
                    }
                }

                // --- NEW: LOG IP/COUNTRY IN ENGINE LOGS ---
                if (proxyAgent) {
                    const testUrl = 'https://lumtest.com/myip.json';
                    axios.get(testUrl, { 
                        httpsAgent: proxyAgent, 
                        httpAgent: proxyAgent,
                        proxy: false,
                        timeout: 10000,
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    })
                    .then(res => {
                        console.log(`[AI Engine] 🌐 Proxy Active | IP: ${res.data.ip} | Country: ${res.data.country} | Model: ${modelToUse}`);
                    })
                    .catch(() => {});
                }

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
                    userId: userId,
                    temperature: (pageConfig.is_external_api ? 0.7 : 0.2) // Low temp for format adherence
                });

                return finalize({ ...result, sentiment: 'neutral' });

            } catch (error) {
                console.warn(`[AI] Phase 1 Key Attempt Failed:`, error.message);
                lastPhase1Error = error;
                
                // --- TOKEN TRACKING FOR FAILED REQUESTS ---
                const estimatedInputTokens = estimateTokenUsage(messages, '', 0);
                try {
                    await dbService.saveAIUsageLog({
                        user_id: pageConfig.user_id,
                        model: pageConfig.chat_model || 'unknown',
                        tokens: estimatedInputTokens,
                        cost: 0, 
                        context: 'failed_attempt_phase1'
                    });
                } catch(e) {}

                // If this is the last key and it failed, then we return the error
                if (currentKey === userKeys[userKeys.length - 1]) {
                    console.error(`[AI] Strict Own API Failed. All keys exhausted.`);
                    return finalize({ 
                        reply: null, 
                        error: `[Strict Own API Error] ${error.message}. Please check your API settings or limits in the dashboard.`,
                        token_usage: estimatedInputTokens, 
                        model: pageConfig.chatmodel || defaultModel 
                    });
                }
                
                // Otherwise, continue to the next key
                 console.log(`[AI] Phase 1: Key failed, trying next key...`);
                 continue;
             }
         }
     }
 
     // PHASE 2: SALESMANCHATBOT ENGINE (SMART ROUTING) ---
    // User Request: If User provided their own key and it was attempted, STOP HERE.
    if (userKeyAttempted) {
        console.warn(`[AI] Phase 1 was attempted but failed or was invalid. Strict Isolation Active: Blocking Cloud API fallback.`);
        return finalize({ 
            reply: null, 
            error: "আপনার দেওয়া এপিআই কী-তে সমস্যা দেখা দিয়েছে অথবা লিমিট শেষ হয়ে গেছে। দয়া করে ড্যাশবোর্ড থেকে আপনার কী চেক করুন।",
            token_usage: 0,
            model: pageConfig.chat_model || defaultModel
        });
    }

    // --- FALLBACK & RETRY LOGIC FOR SYSTEM ENGINES (SMART MULTI-MODEL FALLBACK) ---
    let retryCount = 0;
    const MAX_RETRIES_PER_MODEL = 3; // User Request: 3 attempts per model
    let lastError = null;
    let attemptedKeys = new Set();
    let modality = 'text'; 

    // Resolve Modality and Fallback Models once
    let resolved = await resolveSalesmanchatbotEngine(pageConfig, defaultProvider, defaultModel, isVision, isAudio);
    
    const primaryModel = resolved.finalModel;
    const fallbackModel = resolved.fallbackModel;
    const finalProvider = resolved.finalProvider;
    modality = resolved.modality || (isVision ? 'vision' : (isAudio ? 'voice' : 'text'));

    // Models to try in order
    const modelsToTry = [primaryModel];
    if (fallbackModel && fallbackModel !== primaryModel) {
        modelsToTry.push(fallbackModel);
    }

    for (const currentModel of modelsToTry) {
        console.log(`[AI Retry Loop] 🚀 Starting attempts for model: ${currentModel} (${modality})`);
        let modelRetryCount = 0;

        while (modelRetryCount < MAX_RETRIES_PER_MODEL) {
            let apiKey = null;

            try {
                // 1. Get Next Smart Key (Round-Robin)
                let keyData = await keyService.getSmartKey(finalProvider, currentModel, modality);
                
                // If no model-specific key, try default pool
                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    keyData = await keyService.getSmartKey(finalProvider, 'default', modality);
                }

                // If we still have no key or it's one we already tried, move to next model
                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    console.warn(`[AI] Pool ${finalProvider}/${currentModel} exhausted after ${modelRetryCount} attempts.`);
                    break; // Exit inner while, move to next model
                }

                apiKey = keyData.key;
                attemptedKeys.add(apiKey);

                let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
                if (finalProvider === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';
                else if (finalProvider === 'groq') baseURL = 'https://api.groq.com/openai/v1';
                else if (finalProvider === 'openai') baseURL = 'https://api.openai.com/v1';
                else if (finalProvider === 'mistral') baseURL = 'https://api.mistral.ai/v1';
                else if (finalProvider === 'xai') baseURL = 'https://api.x.ai/v1';
                else if (finalProvider === 'google' || finalProvider === 'gemini') baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
                
                const isBrandedEngine = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'].includes(resolved.targetEngineName);
                
                let proxyAgent = null;
                if (isBrandedEngine) {
                    if (finalProvider === 'google' || finalProvider === 'gemini') {
                        proxyAgent = getGeminiProxyAgent(baseURL, true, resolved.targetEngineName);
                    } else if (finalProvider === 'groq') {
                        proxyAgent = getGroqProxyAgent(true, resolved.targetEngineName);
                    } else {
                        const proxy = getProxyUrl(resolved.targetEngineName);
                        proxyAgent = createProxyAgent(proxy);
                    }
                }

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
                    userId: userId,
                    temperature: (pageConfig.temperature !== undefined && pageConfig.temperature !== null ? Number(pageConfig.temperature) : (pageConfig.is_external_api ? 0.7 : 0.2)),
                    top_p: (pageConfig.top_p !== undefined && pageConfig.top_p !== null ? Number(pageConfig.top_p) : 0.9),
                    pageId: pageId 
                });

                // --- RECORD SUCCESSFUL USAGE ---
                let tokensToRecord = result.token_usage || 0;
                if (tokensToRecord === 0 && result.reply) {
                    tokensToRecord = estimateTokenUsage(messages, result.reply, 0);
                }

                if (apiKey && tokensToRecord > 0) {
                    keyService.recordKeyUsage(apiKey, tokensToRecord, currentModel).catch(e => {
                        console.error(`[AI] Token recording failed:`, e.message);
                    });
                }

                return finalize({ ...result, token_usage: tokensToRecord, sentiment: 'neutral' });

            } catch (err) {
                const errorMsg = (err.message || '').toLowerCase();
                const statusCode = err.status || (err.response ? err.response.status : null);
                
                console.error(`[AI Retry Loop] Model: ${currentModel} | Attempt ${modelRetryCount + 1} Failed with Key ${apiKey ? apiKey.substring(0,8) : 'NONE'}... | Status: ${statusCode} | Msg: ${errorMsg}`);
                lastError = err;
                
                if (apiKey) {
                    await handleAiError(err, apiKey, currentModel, modality);
                    const estimatedInputTokens = estimateTokenUsage(messages, '', 0);
                    try {
                        await dbService.saveAIUsageLog({
                            user_id: pageConfig.user_id,
                            model: currentModel || 'unknown',
                            tokens: estimatedInputTokens,
                            cost: 0, 
                            context: `failed_attempt_p2_model_${currentModel}_retry_${modelRetryCount}`
                        });
                    } catch(e) {}
                }

                const isRetryable = statusCode === 429 || statusCode === 401 || statusCode >= 500 || 
                                    errorMsg.includes('limit') || errorMsg.includes('quota') || 
                                    errorMsg.includes('key') || errorMsg.includes('timeout') || 
                                    errorMsg.includes('network');

                if (isRetryable) {
                    modelRetryCount++;
                    retryCount++; // Global total count
                    await new Promise(resolve => setTimeout(resolve, 200)); 
                    continue;
                } else {
                    break; // Non-retryable error, exit inner while, try next model if available
                }
            }
        }
        console.warn(`[AI Retry Loop] ⚠️ Primary model ${currentModel} failed after ${modelRetryCount} attempts. Checking fallback...`);
    }

    // If we are here, all retries failed
    const branded = formatBrandedError(lastError);
    return finalize({ 
        reply: null, 
        error: branded.message,
        token_usage: 0,
        model: defaultModel
    });
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
                    timeout: 40000,
                    proxy: false 
                });
                base64Image = Buffer.from(response.data).toString('base64');
                let rawMime = response.headers['content-type'] || 'image/jpeg';
                // Sanitize mime type (Gemini/OpenRouter are strict)
                mimeType = rawMime.split(';')[0].trim();
                if (!mimeType.startsWith('image/')) mimeType = 'image/jpeg';
                
                logDebug(`[Vision] Image Downloaded. Mime: ${mimeType} (Raw: ${rawMime}), Size: ${base64Image.length}`);
            }
        } catch (e) {
            throw new Error(`Image Pre-processing Failed: ${e.message}`);
        }
    };

    const maxTokens = Number(customOptions?.max_tokens) > 0 ? Number(customOptions.max_tokens) : 10000;

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

    const providerHint = pageConfig.ai_provider || pageConfig.ai || pageConfig.operator;
    const modelHint = pageConfig.chat_model || pageConfig.chatmodel;
    let resolved = null;
    if (providerHint === 'salesmanchatbot' || modelHint === 'salesmanchatbot-pro' || modelHint === 'salesmanchatbot-flash' || modelHint === 'salesmanchatbot-lite') {
        resolved = await resolveSalesmanchatbotEngine(pageConfig, providerHint, modelHint, true, false);
    }

    // --- PRIORITY ATTEMPT (Custom Options) ---
    if (customOptions?.provider === 'openrouter' && customOptions?.model) {
        try {
            const provider = 'openrouter';
            const model = customOptions.model;
            const modality = 'vision';
            console.log(`[Vision] Priority Attempt: ${model} (${provider})`);

            let keyData = await keyService.getSmartKey(provider, model, modality);
            if (!keyData || !keyData.key) keyData = await keyService.getSmartKey(provider, 'default', modality);
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
                    { 
                        role: "user", 
                        content: [
                            { type: "text", text: systemPrompt },
                            { type: "image_url", image_url: imageContent }
                        ]
                    }
                ]
            };

            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                headers: getStealthHeaders(apiKey, 'openrouter'),
                timeout: 40000 // Increased timeout for heavy models
            });

            const result = response.data?.choices?.[0]?.message?.content;
            const usage = response.data?.usage?.total_tokens || 0;
            if (!result) throw new Error("Empty response from OpenRouter");

            // Record Usage with Model-Specific Logic
            keyService.recordKeyUsage(apiKey, usage, model).catch(e => {});

            logDebug(`[Vision] Success with Priority ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
            const returnModel = resolved?.targetEngineName || model;
            return { text: result, usage: usage, model: returnModel };

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
                 else if (pageConfig.ai === 'custom') provider = 'custom';
             }

             // STOP: If Own API Mode is on, we NEVER use system keys from getSmartKey
             if (!apiKey) {
                 return { text: "Error: Own API Mode enabled but no valid API Key found. System keys are blocked in this mode.", usage: 0 };
             }
         }

         // --- NEW SMART RETRY LOGIC (Unified with Text) ---
    const MAX_RETRIES_PER_MODEL = 3;
    let attemptedKeys = new Set();
    let lastError = null;

    // Resolve models and provider once
    if (!resolved) {
        resolved = await resolveSalesmanchatbotEngine(pageConfig, providerHint, modelHint, true, false);
    }
    
    const primaryModel = resolved.finalModel;
    const fallbackModel = resolved.fallbackModel;
    const finalProvider = resolved.finalProvider;
    const modality = resolved.modality || 'vision';

    const modelsToTry = [primaryModel];
    if (fallbackModel && fallbackModel !== primaryModel) {
        modelsToTry.push(fallbackModel);
    }

    // Additional Fallback for Vision (OpenRouter Qwen if everything fails)
    if (!modelsToTry.includes('qwen/qwen-2.5-vl-7b-instruct:free')) {
        modelsToTry.push('qwen/qwen-2.5-vl-7b-instruct:free');
    }

    for (const currentModel of modelsToTry) {
        console.log(`[Vision Retry Loop] 🚀 Starting attempts for model: ${currentModel} (${modality})`);
        let modelRetryCount = 0;

        while (modelRetryCount < MAX_RETRIES_PER_MODEL) {
            let apiKey = null;
            let currentProvider = finalProvider;

            // If we are on the last fallback model, ensure we use openrouter
            if (currentModel.includes('qwen')) {
                currentProvider = 'openrouter';
            }

            try {
                // 1. Get Key
                let keyData = await keyService.getSmartKey(currentProvider, currentModel, modality);
                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    keyData = await keyService.getSmartKey(currentProvider, 'default', modality);
                }

                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    console.warn(`[Vision] Pool ${currentProvider}/${currentModel} exhausted.`);
                    break;
                }

                apiKey = keyData.key;
                attemptedKeys.add(apiKey);

                // 2. Setup Proxy
                const isBranded = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'].includes(resolved.targetEngineName || modelHint);
                let proxyAgent = null;
                if (isBranded) {
                    if (currentProvider === 'google' || currentProvider === 'gemini') {
                        proxyAgent = getGeminiProxyAgent('google', true, resolved.targetEngineName || modelHint);
                    } else if (currentProvider === 'groq') {
                        proxyAgent = getGroqProxyAgent(true, resolved.targetEngineName || modelHint);
                    } else {
                        const proxy = getProxyUrl(resolved.targetEngineName || modelHint);
                        proxyAgent = createProxyAgent(proxy);
                    }
                }

                console.log(`[Vision] Attempting: ${currentModel} (${currentProvider}) | Retry: ${modelRetryCount} | Proxy: ${proxyAgent ? 'YES' : 'NO'}`);

                let resultText = null;
                let usageTokens = 0;

                if (currentProvider === 'google' || currentProvider === 'gemini') {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`;
                    const payload = {
                        contents: [{
                            parts: [
                                { text: systemPrompt },
                                { inline_data: { mime_type: mimeType, data: base64Image } }
                            ]
                        }],
                        generationConfig: { maxOutputTokens: maxTokens },
                        safetySettings: getGeminiSafetySettings()
                    };
                    const res = await axios.post(url, payload, {
                        headers: getStealthHeaders(apiKey, 'google'),
                        timeout: 300000,
                        httpsAgent: proxyAgent,
                        httpAgent: proxyAgent,
                        proxy: false
                    });
                    resultText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    usageTokens = res.data?.usageMetadata?.totalTokenCount || 0;
                } else {
                    let baseURL = 'https://openrouter.ai/api/v1';
                    if (currentProvider === 'groq') baseURL = 'https://api.groq.com/openai/v1';
                    else if (currentProvider === 'mistral') baseURL = 'https://api.mistral.ai/v1';
                    else if (currentProvider === 'custom') baseURL = (pageConfig.custom_base_url || pageConfig.base_url || '').replace(/\/+$/, '');
                    
                    let modelToUse = currentModel;
                    if (currentProvider === 'openrouter' && modelToUse && !modelToUse.includes('/') && /^gemini/i.test(modelToUse)) {
                        modelToUse = `google/${modelToUse}`;
                    }

                    const payload = {
                        model: modelToUse,
                        max_tokens: maxTokens,
                        messages: [
                            { 
                                role: "user", 
                                content: [
                                    { type: "text", text: systemPrompt },
                                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                                ]
                            }
                        ]
                    };

                    const res = await axios.post(`${baseURL}/chat/completions`, payload, {
                        headers: getStealthHeaders(apiKey, currentProvider === 'openrouter' ? 'openrouter' : 'openai'),
                        httpsAgent: proxyAgent,
                        httpAgent: proxyAgent,
                        proxy: false,
                        timeout: 300000
                    });
                    resultText = res.data?.choices?.[0]?.message?.content;
                    usageTokens = res.data?.usage?.total_tokens || 0;
                }

                if (!resultText) throw new Error(`Empty response from ${currentProvider}`);

                // Record Success
                if (apiKey && usageTokens > 0) {
                    keyService.recordKeyUsage(apiKey, usageTokens, currentModel).catch(() => {});
                }

                let returnModel = currentModel;
                const isManaged = !(pageConfig && (pageConfig.cheap_engine === false || (pageConfig.api_key && pageConfig.api_key !== 'MANAGED_SECRET_KEY')));
                if (isManaged || pageConfig.ai_provider === 'salesmanchatbot') {
                    returnModel = resolved.targetEngineName || modelHint || 'salesmanchatbot-pro';
                }

                return { text: resultText, usage: usageTokens, model: returnModel };

            } catch (err) {
                lastError = err;
                const statusCode = err.response?.status;
                const errorMsg = (err.message || '').toLowerCase();
                console.warn(`[Vision Retry Loop] Failed: ${currentModel} | Status: ${statusCode} | Msg: ${errorMsg}`);

                if (apiKey) {
                    await handleAiError(err, apiKey, currentModel, modality);
                }

                const isRetryable = statusCode === 429 || statusCode === 401 || statusCode >= 500 || 
                                    errorMsg.includes('limit') || errorMsg.includes('quota') || 
                                    errorMsg.includes('key') || errorMsg.includes('timeout');

                if (isRetryable) {
                    modelRetryCount++;
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                } else {
                    break;
                }
            }
        }
    }

    // FINAL FAILURE
    const failureReason = lastError?.response?.data?.error?.message || lastError?.message || "All attempts failed";
    console.error(`[Vision] Fatal Error: ${failureReason}`);
    const returnModel = resolved?.targetEngineName || modelHint || 'salesmanchatbot-pro';
    return { text: `[Vision Analysis Failed] Error: ${failureReason}`, usage: 0, model: returnModel };
  } catch (error) {
    console.error(`[Vision] Unexpected Error:`, error.message);
    return { text: `[Vision Error] ${error.message}`, usage: 0 };
  }
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
            // Priority: config.waha_api_key || process.env.WAHA_API_KEY || default
            const activeWahaKey = config.waha_api_key || process.env.WAHA_API_KEY || WAHA_API_KEY;
            headers['X-Api-Key'] = activeWahaKey;
            console.log(`[Audio] Using WAHA Auth for URL: ${audioUrl.substring(0, 50)}...`);
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
        else if (contentType.includes('aac') || contentType.includes('mp4') || contentType.includes('m4a') || contentType.includes('mpeg')) mimeType = 'audio/mp4';
        else {
            // Fallback: Check URL extension if Content-Type is generic/unknown
            if (audioUrl.includes('.mp4') || audioUrl.includes('.aac') || audioUrl.includes('.m4a')) mimeType = 'audio/mp4';
            else if (audioUrl.includes('.mp3') || audioUrl.includes('.mpeg')) mimeType = 'audio/mpeg';
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

    // 2. Priority Chain: Own API -> Gemini 2.0 Flash -> 1.5 Flash -> Lite -> Groq (Faster)
    const priorityChain = [];
    let userKey = null;
    const preferGeminiForOgg = mimeType === 'audio/ogg';

    // Ensure config exists to prevent crashes
    const safeConfig = config || {};
    const providerHint = safeConfig.ai_provider || safeConfig.ai || safeConfig.operator;
    const modelHint = safeConfig.chat_model || safeConfig.chatmodel;
    const isOwnAPI = safeConfig.cheap_engine === false;

    let resolved = null;
    if ((providerHint === 'salesmanchatbot' || modelHint === 'salesmanchatbot-pro' || modelHint === 'salesmanchatbot-flash' || modelHint === 'salesmanchatbot-lite') && !safeConfig.api_key) {
        resolved = await resolveSalesmanchatbotEngine(safeConfig, providerHint, modelHint, false, true);
    }

    // PHASE 1: OWN API (If User Provided Key)
    if (safeConfig.api_key) {
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
            } else if (userProvider === 'custom') {
                // Support Custom OpenAI-compatible Provider
                const customBase = safeConfig.custom_base_url || safeConfig.base_url;
                priorityChain.push({ 
                    provider: 'custom', 
                    model: userModel || 'whisper-1', 
                    name: `Custom (${userProvider})`, 
                    key: userKey,
                    baseURL: customBase
                });
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
                        if (!isOwnAPI) userKey = null;
                    } else {
                        priorityChain.push({ provider: 'google', model: userModel, name: `Gemini (${userModel}) (User Key)`, key: userKey });
                    }
                } else {
                    console.log(`[Audio Debug] Unknown Key Prefix.`);
                    if (!isOwnAPI) userKey = null;
                }
            }
        }
    }

    // PHASE 2: SYSTEM KEYS (Cheap Engine / Fallback)
    // ONLY run if NOT in Own API mode OR if no user key was provided at all
    if (!userKey && !isOwnAPI) {
        // Use the chat model if it's provided, otherwise fallback to default
        let voiceModel = safeConfig.chat_model || safeConfig.chatmodel || safeConfig.voice_model || safeConfig.audio_model || 'gemini-2.5-flash';
        let provider = safeConfig.ai_provider || safeConfig.ai || safeConfig.operator || 'google';

        // Map SalesmanChatbot branded names to actual models for audio
        if (voiceModel === 'salesmanchatbot-pro') {
            voiceModel = 'gemini-1.5-flash';
            provider = 'google';
        } else if (voiceModel === 'salesmanchatbot-flash') {
            voiceModel = 'gemini-1.5-flash'; // Flash also supports audio natively
            provider = 'google';
        } else if (voiceModel === 'salesmanchatbot-lite') {
            voiceModel = 'whisper-large-v3';
            provider = 'groq';
        }

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
                    }
                    
                    if (gConfig.voice_provider_override && gConfig.voice_provider_override !== 'default') {
                        targetProvider = gConfig.voice_provider_override;
                        provider = targetProvider;
                    } else {
                        provider = targetProvider;
                    }
                }
            } catch (err) {}
        }
        
        if (voiceModel) {
             console.log(`[Audio] Using Configured Voice Model: ${voiceModel} (Provider: ${provider})`);
             
             if (voiceModel.includes('whisper') && provider !== 'groq' && provider !== 'openai') {
                 // If provider is OpenRouter, they might have a whisper model
                 if (provider === 'openrouter') {
                     // Stay on OpenRouter
                 } else {
                     provider = 'groq';
                 }
             } else if (voiceModel.includes('gemini') && provider !== 'google') {
                 // If provider is OpenRouter, they have Gemini models
                 if (provider === 'openrouter') {
                     // Stay on OpenRouter
                 } else {
                     provider = 'google';
                 }
             }
             
             // Add Gemini 2.5 Flash as a high-priority system fallback if not already used
             if (voiceModel !== 'gemini-2.5-flash') {
                 priorityChain.push({ provider: provider, model: voiceModel, name: `Configured (${voiceModel})` });
                 priorityChain.push({ provider: 'google', model: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Latest)' });
             } else {
                 priorityChain.push({ provider: provider, model: voiceModel, name: `Configured (${voiceModel})` });
             }
             
             if (preferGeminiForOgg && !voiceModel.includes('gemini')) {
                 priorityChain.push({ provider: 'google', model: 'gemini-1.5-flash', name: 'Gemini Audio Fallback (OGG)' });
             }
        }
    }

    // 3. Smart Retry Loop (Unified with Text/Vision)
    const MAX_RETRIES_PER_MODEL = 3;
    let attemptedKeys = new Set();
    let lastError = null;

    for (const option of priorityChain) {
        console.log(`[Audio Retry Loop] 🚀 Starting attempts for model: ${option.model} (${option.provider})`);
        let modelRetryCount = 0;

        while (modelRetryCount < MAX_RETRIES_PER_MODEL) {
            let apiKey = option.key;
            const modality = 'voice';

            try {
                // 1. Get Key (if not provided in option)
                if (!apiKey) {
                    let keyData = await keyService.getSmartKey(option.provider, option.model, modality);
                    if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                        keyData = await keyService.getSmartKey(option.provider, 'default', modality);
                    }

                    if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                        console.warn(`[Audio] Pool ${option.provider}/${option.model} exhausted.`);
                        break;
                    }
                    apiKey = keyData.key;
                }
                attemptedKeys.add(apiKey);

                // 2. Setup Proxy
                const isBrandedEngine = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'].includes(resolved?.targetEngineName || modelHint || config.chat_model);
                const useProxy = isBrandedEngine;
                
                let proxyAgent = null;
                if (useProxy) {
                    if (option.provider === 'google') {
                        proxyAgent = getGeminiProxyAgent('google', true, isBrandedEngine ? (resolved?.targetEngineName || modelHint || config.chat_model) : 'managed');
                    } else if (option.provider === 'groq') {
                        proxyAgent = getGroqProxyAgent(true, isBrandedEngine ? (resolved?.targetEngineName || modelHint || config.chat_model) : 'managed');
                    } else {
                        const proxy = getProxyUrl(isBrandedEngine ? (resolved?.targetEngineName || modelHint || config.chat_model) : 'managed');
                        proxyAgent = createProxyAgent(proxy);
                    }
                }

                console.log(`[Audio] Attempting: ${option.model} (${option.provider}) | Retry: ${modelRetryCount} | Proxy: ${proxyAgent ? 'YES' : 'NO'}`);

                let transcribedText = null;
                let usageTokens = 0;

                // --- PROVIDER DISPATCH ---
                if (option.provider === 'openai') {
                    if (!apiKey.startsWith('sk-') && !apiKey.startsWith('sess-')) throw new Error("Invalid OpenAI Key format");

                    const formData = new FormData();
                    const fileExt = mimeType === 'audio/mpeg' ? 'mp3' : (mimeType.split('/')[1] || 'mp3');
                    formData.append('file', audioBuffer, { filename: `audio.${fileExt}`, contentType: mimeType });
                    formData.append('model', 'whisper-1');
                    formData.append('language', 'bn');

                    const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                        headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${apiKey}` },
                        httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false, timeout: 30000
                    });
                    transcribedText = res.data?.text;
                } else if (option.provider === 'google') {
                    let modelName = option.model.replace('models/', '');
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
                    
                    let voicePrompt = config.voice_prompt || (config.page_prompts && config.page_prompts.voice_prompt) || "Transcribe this audio. Priority languages: Bangla, then English, then Hindi. Output ONLY the transcription text.";

                    const payload = {
                        contents: [{
                            parts: [
                                { text: voicePrompt },
                                { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } }
                            ]
                        }]
                    };
                    
                    const res = await axios.post(url, payload, {
                        headers: { 'Content-Type': 'application/json' },
                        httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false, timeout: 40000
                    });
                    transcribedText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    usageTokens = res.data?.usageMetadata?.totalTokenCount || 0;
                } else if (option.provider === 'mistral') {
                    const formData = new FormData();
                    const fileExt = mimeType === 'audio/mpeg' ? 'mp3' : (mimeType.split('/')[1] || 'mp3');
                    formData.append('file', audioBuffer, { filename: `audio.${fileExt}`, contentType: mimeType });
                    formData.append('model', option.model || 'mistral-embed');

                    const res = await axios.post('https://api.mistral.ai/v1/audio/transcriptions', formData, {
                        headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${apiKey.trim()}` },
                        httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false, timeout: 45000
                    });
                    transcribedText = res.data?.text;
                } else if (option.provider === 'groq') {
                    const formData = new FormData();
                    const fileExt = mimeType === 'audio/mpeg' ? 'mp3' : (mimeType.split('/')[1] || 'mp3');
                    formData.append('file', audioBuffer, { filename: `audio.${fileExt}`, contentType: mimeType });
                    formData.append('model', option.model || 'whisper-large-v3');
                    formData.append('language', 'bn');

                    const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                        headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${apiKey}` },
                        httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false, timeout: 30000
                    });
                    transcribedText = res.data.text;
                } else if (option.provider === 'custom' && option.baseURL) {
                    const formData = new FormData();
                    const fileExt = mimeType === 'audio/mpeg' ? 'mp3' : (mimeType.split('/')[1] || 'mp3');
                    formData.append('file', audioBuffer, { filename: `audio.${fileExt}`, contentType: mimeType });
                    formData.append('model', option.model || 'whisper-1');
                    formData.append('language', 'bn');

                    const url = `${option.baseURL.replace(/\/+$/, '')}/audio/transcriptions`;
                    const res = await axios.post(url, formData, {
                        headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${apiKey}` },
                        httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false, timeout: 45000
                    });
                    transcribedText = res.data?.text;
                }

                if (transcribedText) {
                    console.log(`[Audio] Success with ${option.name}: "${transcribedText.substring(0, 30)}..."`);
                    if (apiKey && usageTokens > 0) {
                        keyService.recordKeyUsage(apiKey, usageTokens, option.model).catch(() => {});
                    }
                    return { text: transcribedText.trim(), usage: usageTokens, model: option.model };
                }
                throw new Error(`Empty response from ${option.provider}`);

            } catch (err) {
                lastError = err;
                const statusCode = err.response?.status;
                const errorMsg = (err.message || '').toLowerCase();
                console.warn(`[Audio Retry Loop] Failed: ${option.model} | Status: ${statusCode} | Msg: ${errorMsg}`);

                if (apiKey) {
                    await handleAiError(err, apiKey, option.model, modality);
                }

                const isRetryable = statusCode === 429 || statusCode === 401 || statusCode >= 500 || 
                                    errorMsg.includes('limit') || errorMsg.includes('quota') || 
                                    errorMsg.includes('key') || errorMsg.includes('timeout');

                if (isRetryable) {
                    modelRetryCount++;
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                } else {
                    break;
                }
            }
        }
    }

    return { text: `[Audio Transcription Failed] Error: ${lastError?.message || 'Unknown'}`, usage: 0 };
}

module.exports = {
    generateReply,
    generateResponse,
    getEmbedding,
    handleAiError,
    formatBrandedError,
    fetchOgImage,
    processImageWithVision,
    transcribeAudio,
    refreshGlobalEngineConfigCache,
    clearBrandedEngineCache,
    clearGlobalConfigCache,
    getProxyUrl,
    createProxyAgent
};
