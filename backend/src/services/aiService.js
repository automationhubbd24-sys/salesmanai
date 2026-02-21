const keyService = require('./keyService');
const dbService = require('./dbService'); // Added for Product Search Tool
const commandApiService = require('./commandApiService'); // Command API Table Strategy
const axios = require('axios');
const OpenAI = require('openai');
const FormData = require('form-data');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- DYNAMIC FREE MODEL OPTIMIZER (OpenRouter) ---
// User Request: Dynamically fetch best free models using Gemini (Cheap Engine) to analyze the list.
let bestFreeModels = {
    text: 'meta-llama/llama-3.1-8b-instruct:free', // Default fallback
    vision: 'qwen/qwen-2.5-vl-7b-instruct:free', 
    voice: 'meta-llama/llama-3.1-8b-instruct:free' 
};

async function updateBestFreeModels() {
    try {
        console.log('[AI Optimizer] Fetching latest free models from OpenRouter...');
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        const models = response.data.data;
        
        if (!models || !Array.isArray(models)) throw new Error("Invalid response format");

        // Filter for Strictly Free Models (Prompt & Completion = 0)
        // User Update: EXCLUDE Gemini 2.0 models from Cheap Engine
        const freeModels = models.filter(m => 
            m.pricing && 
            (m.pricing.prompt === "0" || m.pricing.prompt === 0) && 
            (m.pricing.completion === "0" || m.pricing.completion === 0) &&
            !m.id.includes('gemini-2.0') 
        );

        if (freeModels.length === 0) {
            console.warn('[AI Optimizer] No free models found. Keeping defaults.');
            return;
        }

        // Limit to Top 50 to capture new high-potential models like stepfun/upstage
        freeModels.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
        // User Update: Analyze ALL free models, not just top 50.
        const candidates = freeModels.map(m => ({
            id: m.id,
            name: m.name,
            context: m.context_length,
            modality: m.architecture?.modality || 'text',
            description: m.description // Help AI understand model capabilities
        }));

        // --- GEMINI SELECTION LOGIC (Cheap Engine) ---
        // We use Gemini 2.0 Flash to pick the best models from the list
        try {
            console.log(`[AI Optimizer] Asking Gemini to select best models from ${candidates.length} candidates...`);
            const keyData = await keyService.getSmartKey('google', 'gemini-2.5-flash');
            
            if (keyData && keyData.key) {
                const prompt = `
You are an expert AI Engineer. Analyze this COMPLETE list of FREE OpenRouter models and pick the ABSOLUTE BEST ones for a production chatbot.

Candidates: ${JSON.stringify(candidates)}

Requirements:
1. TEXT: Select the BEST General Chat Model. 
   - Look for high intelligence, reasoning, and instruction following.
   - Do NOT just pick 'Google' or 'Meta' brands. Look for 'Pro', 'Max', 'Ultra' or 'Reasoning' variants even from lesser known providers like 'Upstage', 'Stepfun', 'Mistral', 'Qwen' etc.
   - High context is good, but smartness is priority.
2. VISION: Best Multimodal Model. Must support images (Gemini, Qwen VL, Llama 3.2 Vision).
3. VOICE: Fastest model for text generation (Flash/Lite/Instant variants).

Return ONLY valid JSON:
{
  "text": "model_id",
  "vision": "model_id",
  "voice": "model_id"
}`;
                const openai = new OpenAI({ 
                    apiKey: keyData.key, 
                    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' 
                });

                const completion = await openai.chat.completions.create({
                    // Use Gemini 2.0 Flash for the request
                    model: 'gemini-2.0-flash', 
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: "json_object" }
                });

                const result = JSON.parse(completion.choices[0].message.content);
                
                if (result.text && result.vision && result.voice) {
                    bestFreeModels = result;
                    console.log('[AI Optimizer] Gemini Selected Models:', bestFreeModels);
                } else {
                    throw new Error("Invalid JSON structure from Gemini");
                }
            } else {
                throw new Error("No Gemini keys available for optimizer.");
            }
        } catch (geminiError) {
            console.warn('[AI Optimizer] Gemini Selection Failed:', geminiError.message);
            console.log('[AI Optimizer] Falling back to rule-based selection.');
            
            // Fallback: Rule-based (Previous Logic)
             const reliableProviders = /gemini|llama-3|mistral|qwen/i;
             let bestText = freeModels.find(m => reliableProviders.test(m.id) && !m.id.includes('vision')) || freeModels[0];
             // Prioritize Gemini 2.5 equivalent for Vision
             let bestVision = freeModels.find(m => m.id.includes('gemini-2.0') || m.id.includes('gemini-2.5') || m.id.includes('qwen-2.5')) || freeModels[0];
             let bestVoice = freeModels.find(m => m.id.includes('flash') && m.id.includes('gemini')) || bestText;

             bestFreeModels = { text: bestText.id, vision: bestVision.id, voice: bestVoice.id };
             console.log('[AI Optimizer] Rule-based Selected Models:', bestFreeModels);
        }

    } catch (e) {
        console.warn('[AI Optimizer] Failed to update free models:', e.message);
    }
}

// Schedule: Run every 2 hours
setInterval(updateBestFreeModels, 2 * 60 * 60 * 1000);
// Run immediately on startup
updateBestFreeModels();
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
        ownerName, // Pass ownerName
        null, // senderGender (optional)
        imageUrls,
        audioUrls,
        extraTokenUsage // Pass initial usage (e.g. from Vision API in Controller)
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

    // Remove the IMAGE lines from the text
    cleanText = text.replace(imgRegex, '').trim();

    return {
        text: cleanText,
        images: images
    };
}

// Helper to clean and extract JSON from AI response (handles <think> blocks and markdown)
function extractJsonFromAiResponse(rawContent) {
    let parsed = {};
    try {
        // 1. Remove <think>...</think> blocks (DeepSeek/Gemini reasoning)
        let cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // 2. Remove markdown code blocks (```json ... ```)
        cleanContent = cleanContent.replace(/```json/gi, '').replace(/```/g, '').trim();

        // 3. Find the first '{' and last '}' to isolate JSON object
        const firstOpen = cleanContent.indexOf('{');
        const lastClose = cleanContent.lastIndexOf('}');

        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
            cleanContent = cleanContent.substring(firstOpen, lastClose + 1);
        }

        parsed = JSON.parse(cleanContent);
    } catch (e) {
        console.warn("[AI] JSON Extraction Failed, attempting raw parse...");
        try {
            parsed = JSON.parse(rawContent); // Fallback to original
        } catch (e2) {
            console.warn("[AI] Raw JSON Parse Failed. Returning as reply text.");
            parsed = { reply: rawContent };
        }
    }

    if (!parsed || typeof parsed !== 'object') {
        // ERROR: Return null so the controller handles it silently (logs error to DB but sends nothing to user)
        console.warn("[AI] Failed to parse JSON response. Returning NULL to prevent bad UX.");
        return null;
    }

    // NORMALIZE REPLY FIELD - STRICT MODE
    // User Request: Strict JSON Enforcement. No field guessing.
    // If 'reply' is missing, check if it is a tool call.
    // If not a tool call and not a reply, it is an INVALID response.
    if (!parsed.reply) {
        // Check for Tool Call
        const isTool = (parsed.tool && typeof parsed.tool === 'string') ||
                       (parsed.tools && Array.isArray(parsed.tools)) ||
                       (parsed.function && typeof parsed.function === 'string');

        if (!isTool) {
            console.warn("[AI] Strict Parse Warning: 'reply' field missing and NOT a tool call.", JSON.stringify(parsed));
            // FAIL SAFE: Return null to prevent sending garbage to user.
            // The user said: "user er kase kono ans jabe na but fb cahts e error show hobe"
            return null;
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

    const match = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
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

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer', ownerName = 'Automation Hub BD', senderGender = null, imageUrls = [], audioUrls = [], extraTokenUsage = 0) {
    
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

        mediaContext += "\n[System Note: User sent images. Analysis below:]\n" + imageDescriptions.map((desc, i) => `Image ${i+1}: ${desc}`).join("\n");
    }

    if (audioUrls && audioUrls.length > 0) {
        console.log(`[AI] Processing ${audioUrls.length} audio files...`);
        const audioResults = await Promise.all(audioUrls.map(async url => {
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

    // --- PRODUCT SEARCH INTEGRATION (Context Injection) ---
    // MOVED: Now runs AFTER media processing so we can search for products based on image/audio content!
    let productContext = "";
    let foundProducts = [];
    if (pageConfig.user_id) {
        try {
            // Search for relevant products based on user message (which now includes image descriptions)
            const products = await dbService.searchProducts(pageConfig.user_id, cleanUserMessage, pageConfig.page_id);
            
            if (products && products.length > 0) {
                 foundProducts = products; // Store for return
                 productContext = "\n[Available Products in Store]\n";
                 products.forEach((p, i) => {
                     // Format variants cleanly
                     let variantInfo = "";
                     if (Array.isArray(p.variants) && p.variants.length > 0) {
                        variantInfo = " | Variants: " + p.variants.map(v => 
                            `${v.name} (${v.price} ${v.currency || 'BDT'})`
                        ).join(', ');
                     }
                     
                     // Row Format (Compact for AI)
                     // User Request: Remove Price, Use ##product "name" format
                     const stockDisplay = p.stock !== undefined ? p.stock : 'N/A';
                     const descDisplay = p.description ? p.description.replace(/\n/g, ' ').substring(0, 200) : 'N/A';
                     
                     let imgDisplay = 'N/A';
                     if (p.image_url) {
                        if (p.image_url.startsWith('http')) {
                            imgDisplay = p.image_url;
                        } else {
                            // Convert relative path to absolute URL
                            const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
                            const cleanPath = p.image_url.startsWith('/') ? p.image_url : `/${p.image_url}`;
                            imgDisplay = `${baseUrl}${cleanPath}`;
                        }
                     }

                     const keywordsDisplay = p.keywords ? p.keywords.replace(/\n/g, ' ').substring(0, 200) : 'N/A';
                     
                     // Format: ##product "name" | Stock: ... | Image: ...
                     productContext += `##product "${p.name}" | Stock: ${stockDisplay} | Image: ${imgDisplay} | Desc: ${descDisplay} | Keywords: ${keywordsDisplay}${variantInfo}\n`;
                 });
                 productContext += "[End of Products]\n";
                 console.log(`[AI] Injected ${products.length} products into context.`);
             }
        } catch (err) {
            console.warn("[AI] Product search failed:", err.message);
        }
    }
    // ----------------------------------------------------

    // 1. Prepare Configuration
    let dynamicProvider = 'openrouter'; 
    let dynamicModel = 'arcee-ai/trinity-large-preview'; // Verified Free Model
    let fallbackModel = 'meta-llama/llama-3.1-8b-instruct:free';

    if (useCheapEngine) {
        try {
            const commandConfig = await commandApiService.getCommandConfig();
            if (commandConfig) {
                dynamicProvider = commandConfig.provider || dynamicProvider;
                dynamicModel = commandConfig.chatmodel || dynamicModel;
                fallbackModel = commandConfig.fallback_chatmodel || fallbackModel;
            }
        } catch (err) {
            console.warn("[AI] Failed to fetch Command API config, using strong defaults:", err.message);
        }
    }

    // PRIORITIZE PAGE CONFIG (User's specific choice overrides everything)
    let userModel = (pageConfig.chat_model && pageConfig.chat_model !== 'default') ? pageConfig.chat_model.trim() : null;
    
    // AUTO MODEL SELECTION (User Request: "openrouter/auto")
    if (userModel === 'openrouter/auto') {
        console.log(`[AI] Auto-Model Selected. Using best free model: ${bestFreeModels.text}`);
        userModel = bestFreeModels.text;
    }

    const userProvider = pageConfig.ai || pageConfig.operator; 

    let defaultProvider = userProvider || (useCheapEngine ? dynamicProvider : 'gemini');
    let defaultModel = userModel;

    // IF User did NOT specify a model (null), pick a smart default based on the Provider
    if (!defaultModel) {
        if (defaultProvider === 'gemini') {
            defaultModel = 'gemini-2.0-flash'; // Safer default (User Request: Avoid 1.5 Flash)
        } else if (defaultProvider === 'openrouter') {
            defaultModel = useCheapEngine ? dynamicModel : 'arcee-ai/trinity-large-preview';
        } else if (defaultProvider === 'groq') {
            defaultModel = 'llama-3.3-70b-versatile';
        } else if (defaultProvider === 'salesmanchatbot') {
            defaultModel = 'salesmanchatbot-pro';
        } else {
            defaultModel = useCheapEngine ? dynamicModel : 'gemini-2.0-flash'; 
        }
    }

    // Force free model for OpenRouter if using default
    if (!userModel && defaultProvider === 'openrouter' && defaultModel.includes('gemini') && !defaultModel.includes(':free')) {
        defaultModel = 'arcee-ai/trinity-large-preview';
    }

    console.log(`[AI] Final Engine Config: ${defaultProvider} / ${defaultModel}`);

    // --- MODEL NAME NORMALIZATION & ALIASES ---
    // User Request: REMOVED to respect exact model selection.
    // "user jeta select korbe sei model found hole setai work korbe kono defult deoya jabe na"
    /*
    const MODEL_ALIASES = {
        'gemini-2.0-flash': 'gemini-2.0-flash',
        'gemini-pro': 'gemini-1.5-pro',
        'gemini2.5-flash': 'gemini-2.0-flash',
        'groq-fast': 'llama-3.3-70b-versatile', 
        'groq-speed': 'llama-3.1-8b-instant', 
        'grok-4.1-fast': 'llama-3.3-70b-versatile',
        'salesmanchatbot-pro': 'gemini-2.0-flash',
        'salesmanchatbot-flash': 'gemini-2.0-flash',
        'salesmanchatbot-lite': 'gemini-2.0-flash-lite',
    };

    if (MODEL_ALIASES[defaultModel]) {
        defaultModel = MODEL_ALIASES[defaultModel];
    }
    */

    // Dynamic Best Model Logic (Cache every 2 hours)
    // User Request: gemini 2.5 flash > 2.5 flash lite > openrouter free
    if (!userModel) {
        // If user didn't specify, we use our smart defaults
        // 1. Try Gemini 2.0 Flash (aka 2.5 Flash alias)
        // 2. Try Gemini 2.0 Flash Lite
        // 3. Fallback to OpenRouter Free
        
        // This is handled in Phase 2 loop below if we set the sequence right.
        // We set 'defaultModel' to the Primary Choice.
        defaultModel = 'gemini-2.0-flash';
        dynamicModel = 'gemini-2.0-flash-lite';
        fallbackModel = bestFreeModels.text || 'meta-llama/llama-3.1-8b-instruct:free'; // Dynamic Fallback
    }
    // -------------------------------------------------
    
    // --- MEDIA HANDLING COMPLETED ABOVE ---
    // (Consolidated into Pre-process Media step to ensure correct token tracking)
    // ----------------------------------------

    // --- PROMPT & MESSAGE CONSTRUCTION ---
    let messages = [];
    // User Update: Default to JSON Object for reliability
    let responseFormat = { type: "json_object" }; 

    if (pageConfig.is_external_api) {
        // --- EXTERNAL API MODE (Minimal & White Label) ---
        const whiteLabelInstruction = "You are SalesmanChatbot, a helpful AI assistant. You are NOT Google Gemini, OpenAI, or any other provider. You are a proprietary AI.";
        
        const userSystemPrompt = pagePrompts?.text_prompt || "";
        const finalSystemPrompt = `${whiteLabelInstruction}\n\n${userSystemPrompt}`.trim();

        messages = [
            { role: 'system', content: finalSystemPrompt },
            ...history,
            { role: 'user', content: cleanUserMessage }
        ];
        
        // Disable strict JSON enforcement for external API (allow natural text)
        responseFormat = undefined; 
        console.log(`[AI] External API Mode: Skipping n8n System Prompt.`);

    } else {
        let basePrompt = pagePrompts?.text_prompt || "";

        const systemPromptProductNames = [];

        // --- CLEANUP & EXTRACT SHORTCUT PRODUCTS ---
        // User Request: Extract product from ##product tag, clean it from text, but fetch details.
        // Manual typing of product name (without tag) should NOT trigger fetch.
        if (basePrompt) {
             // Regex handles:
            // 1. ##PRODUCT "**Name**" 100 BDT (Frontend Shortcut)
            // 2. ##product "Name" (Standard)
            // Captures the Name (Group 1) and replaces the whole tag with just "Name".
            const shortcutRegex = /##PRODUCT\s*["'](?:\*\*)?(.+?)(?:\*\*)?["'](?:\s+\d+\s*\w+)?/gi;

            basePrompt = basePrompt.replace(shortcutRegex, (match, name) => {
                if (name) {
                    const cleanName = name.trim();
                    systemPromptProductNames.push(cleanName);
                    // Ensure format is ##product "cleanName"
                    return `##product "${cleanName}"`; 
                }
                return match;
            });
        }

        // --- DYNAMIC PRODUCT INJECTION FROM SYSTEM PROMPT ---
        try {

            if (systemPromptProductNames.length > 0) {
                console.log(`[AI] Found product references in System Prompt: ${systemPromptProductNames.join(', ')}`);
                const systemProducts = await dbService.getProductsByNames(pageConfig.user_id, systemPromptProductNames);
                
                if (systemProducts && systemProducts.length > 0) {
                     // Add to productContext if not already present
                     if (!productContext) productContext = "\n[Available Products in Store]\n";
                     
                     systemProducts.forEach((p) => {
                         // Check if already added by search
                         if (!foundProducts.some(fp => fp.id === p.id)) {
                             // Add it
                             foundProducts.push(p);
                             
                             // User Request: Optimized Context Injection (Token Saving)
                             // Only inject name, stock, and image. Truncate description. REMOVED PRICE.
                             let shortDesc = p.description ? p.description.substring(0, 100) + '...' : '';
                             
                             productContext += `Product: "${p.name}"\n`;
                             // Price removed per user request
                             if (p.stock_quantity) productContext += `Stock: ${p.stock_quantity}\n`;
                             if (shortDesc) productContext += `Desc: ${shortDesc}\n`;
                             if (p.image_url) productContext += `Image: ${p.image_url}\n`;
                             productContext += `\n`;
                        }
                    });
               }
           }
       } catch (err) {
           console.warn("[AI] Failed to inject system prompt products:", err.message);
       }
       // ----------------------------------------------------

       if (!basePrompt || !basePrompt.trim()) {
           basePrompt = "You are a helpful Bangla chatbot for this business. Answer politely and clearly about their products and services using the given context.";
       }

       const n8nSystemPrompt = `System: ${basePrompt}

[Available Products]
${productContext}

[System Rules]
1. SEARCH: If user asks about a product not in [Available Products], use tool: { "tool": "search_products", "query": "name" }
2. IMAGES: Use ONLY provided image URLs.
3. SILENCE: If your instructions say "no reply" or to be silent, return { "reply": null }
4. LABELS:
   - Support: Append "[ADD_LABEL: adminhandle]" to reply.
   - Order: Append "[ADD_LABEL: ordertrack]" to reply.
   - Save Order: Append "[SAVE_ORDER: {...}]" to reply.

[Response Format]
You must output valid JSON only.
- Reply: { "reply": "text" }
- Silence: { "reply": null }
- Search: { "tool": "search_products", "query": "..." }`;

        const systemMessage = { role: 'system', content: n8nSystemPrompt };
    
        messages = [
            systemMessage,
            ...history,
            { role: 'user', content: cleanUserMessage }
        ];
    }

    // --- UNIFIED AI REQUEST LOGIC ---
    const isOurOwnProvider = defaultProvider === 'salesmanchatbot' || defaultProvider === 'system';

    // SPECIAL PATH: Use Own SalesmanChatbot API when selected
    if (!useCheapEngine && defaultProvider === 'salesmanchatbot' && pageConfig.api_key) {
        try {
            const axios = require('axios');
            const base = process.env.SALESMANCHATBOT_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}/api/external/v1`;
            const modelToUse = (pageConfig.chatmodel || 'salesmanchatbot-pro');
            const payload = {
                model: modelToUse,
                messages: messages,
            };
            const headers = {
                'Authorization': `Bearer ${pageConfig.api_key}`,
                'Content-Type': 'application/json'
            };
            console.log(`[AI] SalesmanChatbot Own API: Calling ${base}/chat/completions with model=${modelToUse}`);
            const resp = await axios.post(`${base}/chat/completions`, payload, { headers, timeout: 25000 });
            const data = resp.data;
            const aiText = data?.choices?.[0]?.message?.content || null;
            const tokenUsage = data?.usage?.total_tokens || 0;
            if (aiText) {
                return { reply: aiText, sentiment: 'neutral', token_usage: tokenUsage + totalTokenUsage, model: modelToUse, foundProducts };
            }
        } catch (error) {
            console.warn(`[AI] SalesmanChatbot Own API Error:`, error.message);
            return { 
                reply: null, 
                error: `SalesmanChatbot API Error: ${error.message}. Check your API key/model.`,
                token_usage: 0,
                model: pageConfig.chatmodel || 'salesmanchatbot-pro'
            };
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
            if (currentKey.startsWith('sk-or-v1')) currentProvider = 'openrouter';
            else if (currentKey.startsWith('AIzaSy')) currentProvider = 'google';
            else if (currentKey.startsWith('gsk_')) currentProvider = 'groq';
            else if (currentKey.startsWith('xai-')) currentProvider = 'xai';

            let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            if (currentProvider.includes('openrouter')) baseURL = 'https://openrouter.ai/api/v1';
            else if (currentProvider.includes('openai')) baseURL = 'https://api.openai.com/v1';
            else if (currentProvider.includes('groq')) baseURL = 'https://api.groq.com/openai/v1';
            else if (currentProvider.includes('xai')) baseURL = 'https://api.x.ai/v1';

            try {
                const openai = new OpenAI({ 
                    apiKey: currentKey, 
                    baseURL: baseURL,
                    timeout: 25000 // 25s Timeout for User Keys
                });
                // Normalize Model Name for User Keys
                // User Requirement: Use EXACTLY what user typed. No mapping.
                let modelToUse = pageConfig.chatmodel || defaultModel;

                console.log(`[AI] Phase 1: Calling User Key (${currentProvider}/${modelToUse})...`);

                const completion = await openai.chat.completions.create({
                    model: modelToUse,
                    messages: messages,
                    response_format: responseFormat
                });

                if (completion.choices && completion.choices.length > 0) {
                    const rawContent = completion.choices[0].message.content || '';
                    let tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                    tokenUsage = estimateTokenUsage(messages, rawContent, tokenUsage);
                    try {
                        keyService.recordKeyUsage(currentKey, tokenUsage);
                    } catch (e) {}
                    
                    try {
                        const parsed = extractJsonFromAiResponse(rawContent);
                        
                        // --- TOOL HANDLING (Product Search) ---
                        if (parsed.tool === 'search_products' && parsed.query) {
                            console.log(`[AI] Tool Call (Phase 1): Searching products for "${parsed.query}"...`);
                            
                            let products = [];
                            try {
                                // Fix: Pass pageId to ensure visibility rules are respected
                                products = await dbService.searchProducts(pageConfig.user_id, parsed.query, pageConfig.page_id);
                            } catch (dbError) {
                                console.error(`[AI] Phase 1 DB Search Failed: ${dbError.message}`);
                                // Proceed with empty products to allow AI to handle it gracefully
                            }
                            
                            // Add context and retry
                            messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
                            
                            const toolOutputContext = `[System] Search Results for "${parsed.query}": ${JSON.stringify(products)}. 
INSTRUCTIONS:
1. Use the search results above to answer the user's question in Bengali.
2. If the product has an 'image_url', you MUST include it in the 'images' array of your JSON response.
3. If no products were found, apologize and say you couldn't find it.
4. Return ONLY a JSON object with 'reply' (string) and 'images' (array of strings).
   Example: { "reply": "Here is the product...", "images": ["http://..."] }`;

                            messages.push({ role: 'system', content: toolOutputContext });
                            
                            console.log(`[AI] Tool Result found. Re-generating answer with User Key...`);
                            
                            try {
                                const completion2 = await openai.chat.completions.create({
                                    model: modelToUse,
                                    messages: messages,
                                    // Remove strict JSON enforcement to avoid errors if model is chatty
                                    // response_format: { type: "json_object" } 
                                });
                                
                                const rawContent2 = completion2.choices[0].message.content || '';
                                console.log(`[AI] Phase 1 Tool Re-generation Raw Output: ${rawContent2.substring(0, 100)}...`);

                                let tokenUsage2 = completion2.usage ? completion2.usage.total_tokens : 0;
                                tokenUsage2 = estimateTokenUsage(messages, rawContent2, tokenUsage2);
                                try { keyService.recordKeyUsage(currentKey, tokenUsage2); } catch(e){}
                                
                                const parsed2 = extractJsonFromAiResponse(rawContent2);
                                
                                // STRICT MODE: Do not fallback to 'response' or 'text'
                                // if (!parsed2.reply) parsed2.reply = parsed2.response || parsed2.text;
                                
                                // FALLBACK FOR EMPTY REPLY
                                if (!parsed2.reply && products.length > 0) {
                                     parsed2.reply = "আমি আপনার খোঁজা পণ্যগুলো পেয়েছি। নিচে দেখুন:"; 
                                } else if (!parsed2.reply) {
                                     parsed2.reply = "দুঃখিত, আমি এই মুহূর্তে উত্তরটি প্রসেস করতে পারছি না।";
                                }

                                // IMAGE INJECTION LOGIC
                                if (parsed2.images && Array.isArray(parsed2.images)) {
                                    // Validate images
                                     const validImages = parsed2.images.filter(img => 
                                        products.some(p => p.image_url === img)
                                    );
                                    parsed2.images = validImages;
                                } else {
                                    // Auto-inject if missing
                                    const productImages = products
                                        .filter(p => p.image_url)
                                        .map(p => p.image_url);
                                    if (productImages.length > 0) {
                                        parsed2.images = productImages;
                                    }
                                }
                                
                                return { ...parsed2, token_usage: tokenUsage + tokenUsage2 + totalTokenUsage, model: modelToUse, foundProducts: products };
                            } catch (aiError) {
                                console.error(`[AI] Phase 1 Tool Re-generation Failed: ${aiError.message}`);
                                throw aiError;
                            }
                        }
                        // -------------------------------------

                        if (!parsed.reply) parsed.reply = parsed.response || parsed.text;
                        return { ...parsed, token_usage: tokenUsage + totalTokenUsage, model: modelToUse, foundProducts };
                    } catch (e) {
                        console.error('[AI] Phase 1 Logic Failed:', e);
                        let cleanText = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                        
                        // Attempt to extract images from text response
                        const extracted = extractImagesFromText(cleanText);
                        cleanText = extracted.text;
                        const extractedImages = extracted.images;

                        cleanText = extractReplyFromText(cleanText);
                        
                        // If reply is empty but we have images, provide a fallback text
                        if (!cleanText && extractedImages.length > 0) {
                            cleanText = "Here are the images you requested:";
                        }

                        return { 
                            reply: cleanText, 
                            sentiment: 'neutral', 
                            model: modelToUse, 
                            token_usage: tokenUsage + totalTokenUsage, 
                            foundProducts,
                            images: extractedImages 
                        };
                    }
                }
            } catch (error) {
                console.warn(`[AI] Phase 1 Key Failed:`, error.message);
                
                // STRICT OWN API LOCK: If we are here, it means the User provided their own API key.
                // If it fails (invalid key, quota exceeded, etc.), we MUST NOT fallback to our Cloud API.
                console.error(`[AI] Strict Own API Failed. Blocking Cloud API fallback for security & isolation.`);
                return { 
                    reply: null, // Returning null ensures the controller knows the request failed strictly.
                    error: `AI Provider Error: ${error.message}. Please check your API settings in the dashboard.`,
                    token_usage: 0,
                    model: pageConfig.chatmodel || defaultModel // FIX: Use pageConfig value directly if modelToUse is not in scope or undefined
                };
            }
        }
    }

    // HELPER: Error Handler for Rate Limits
    const handleAiError = (error, apiKey, modelName) => {
        const status = error.status || (error.response ? error.response.status : null);
        if (status === 429 || error.message.includes('429') || error.message.includes('quota') || error.message.includes('Too Many Requests')) {
            if (error.message.toLowerCase().includes('quota')) {
                keyService.markKeyAsQuotaExceeded(apiKey);
            } else {
                keyService.markKeyAsDead(apiKey, 60 * 1000, `rate_limit_${modelName}`);
            }
        } else if (status === 401 || status === 403) {
            keyService.markKeyAsDead(apiKey, 24 * 60 * 60 * 1000, 'auth_error');
        } else if (status >= 500) {
            keyService.markKeyAsDead(apiKey, 60 * 1000, 'server_error');
        }
    };

    // Phase 2: Key-Centric Swarm (Google Flash Only)
    if (userKeyAttempted) {
        console.warn(`[AI] Phase 1 was attempted but failed or was invalid. Strict Isolation Active: Blocking Cloud API fallback.`);
        return { 
            reply: null, 
            error: "Your API Provider settings are incorrect or the key has expired. Please check your dashboard.",
            token_usage: 0,
            model: defaultModel
        };
    }

    console.log(`[AI] Phase 2: Key-Centric Swarm (Cheap/System Keys)...`);

    // Determine Model: Use dashboard setting if it's a Gemini model, otherwise default to Flash
    let swarmModel = (pageConfig.chatmodel && pageConfig.chatmodel.includes('gemini')) ? pageConfig.chatmodel : 'gemini-2.0-flash';
    let swarmProvider = 'google';

    // Check if User wants OpenRouter in Phase 2 (Explicit Override via Dashboard)
    if (pageConfig.chatmodel && (pageConfig.chatmodel.includes('/') || pageConfig.provider === 'openrouter')) {
        swarmModel = pageConfig.chatmodel;
        swarmProvider = 'openrouter';
        console.log(`[AI] Phase 2: User requested OpenRouter model: ${swarmModel}`);
    }

    // --- STRATEGY A: OpenRouter (Single Attempt) ---
    if (swarmProvider === 'openrouter') {
        try {
            const keyData = await keyService.getSmartKey('openrouter', swarmModel);
            if (keyData && keyData.key) {
                const apiKey = keyData.key;
                const baseURL = 'https://openrouter.ai/api/v1';
                
                const openai = new OpenAI({ 
                    apiKey: apiKey, 
                    baseURL: baseURL,
                    timeout: 25000
                });

                console.log(`[AI] OpenRouter (Phase 2): Testing ${swarmModel}...`);
                const completion = await openai.chat.completions.create({
                    model: swarmModel,
                    messages: messages,
                    response_format: { type: "json_object" } // Try JSON mode
                });
                
                const rawContent = completion.choices[0].message.content || '';
                let tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                keyService.recordKeyUsage(apiKey, tokenUsage);
                
                const parsed = extractJsonFromAiResponse(rawContent);
                if (parsed.tool === 'search_products' && parsed.query) {
                        console.log(`[AI] Tool Call: Searching products for "${parsed.query}"...`);
                        const products = await dbService.searchProducts(pageConfig.user_id, parsed.query, pageConfig.page_id);
                        
                            // Phase 2: Re-generate answer using the SAME model
                            messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
                            
                            const toolOutputContext = `[System] Search Results for "${parsed.query}": ${JSON.stringify(products)}. 
INSTRUCTIONS:
1. Use the search results above to answer the user's question in Bengali.
2. If the product has an 'image_url', you MUST include it in the 'images' array of your JSON response.
3. If no products were found, apologize and say you couldn't find it.
4. Return ONLY a JSON object with 'reply' (string) and 'images' (array of strings).`;

                            messages.push({ role: 'system', content: toolOutputContext });
                            
                            const completion2 = await openai.chat.completions.create({
                                model: swarmModel,
                                messages: messages,
                                response_format: { type: "json_object" }
                            });
                            
                            const rawContent2 = completion2.choices[0].message.content || '';
                            let tokenUsage2 = completion2.usage ? completion2.usage.total_tokens : 0;
                            keyService.recordKeyUsage(apiKey, tokenUsage2);
                            
                            const parsed2 = extractJsonFromAiResponse(rawContent2);
                            if (!parsed2.reply) parsed2.reply = parsed2.response || parsed2.text;

                            // FALLBACK FOR EMPTY REPLY
                            if (!parsed2.reply && products.length > 0) {
                                 parsed2.reply = "আমি আপনার খোঁজা পণ্যগুলো পেয়েছি। নিচে দেখুন:"; 
                            }

                            // Ensure images are passed through if AI found them
                            if (parsed2.images && Array.isArray(parsed2.images)) {
                                // Validate images are from search results (anti-hallucination)
                                const validImages = parsed2.images.filter(img => 
                                    products.some(p => p.image_url === img)
                                );
                                parsed2.images = validImages;
                            } else {
                                // Auto-inject images if AI forgot but we have them
                                const productImages = products
                                    .filter(p => p.image_url)
                                    .map(p => p.image_url);
                                if (productImages.length > 0) {
                                    parsed2.images = productImages;
                                }
                            }
                            
                            return { ...parsed2, token_usage: tokenUsage + tokenUsage2 + totalTokenUsage, model: swarmModel, foundProducts: products };
                        }

                if (!parsed.reply) parsed.reply = parsed.response || parsed.text;
                return { ...parsed, model: swarmModel, token_usage: tokenUsage + totalTokenUsage, foundProducts };

            } else {
                console.warn(`[AI] No OpenRouter keys found for ${swarmModel}. Falling back to Google Swarm.`);
            }
        } catch (e) {
            console.warn(`[AI] OpenRouter Phase 2 Failed: ${e.message}. Falling back to Google Swarm.`);
        }
    }

    // --- STRATEGY B: Google Swarm (Fallback / Default) ---
    // If we fell back, reset model to User's Choice or Gemini 2.0 Flash (Safer Default)
    // FIX: Respect user's chatmodel if it is a Google model, otherwise default to 2.0 Flash
    swarmModel = (pageConfig.chatmodel && pageConfig.chatmodel.includes('gemini')) ? pageConfig.chatmodel : 'gemini-2.0-flash';
    console.log(`[AI] Phase 2: Google Swarm (Model: ${swarmModel})...`);

    // 1. GOOGLE SWARM LOOP (Try up to 3 different keys)
    for (let i = 0; i < 3; i++) {
        let keyData = null;
        try {
            keyData = await keyService.getSmartKey('google', swarmModel);
            if (!keyData || !keyData.key) {
                console.warn(`[AI] No valid ${swarmModel} keys available for Swarm Attempt ${i+1}. Skipping.`);
                break;
            }

            const apiKey = keyData.key;
            const baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            
            const openai = new OpenAI({ 
                apiKey: apiKey, 
                baseURL: baseURL,
                timeout: 20000
            });

            try {
                console.log(`[AI] Google Swarm (Key ${i+1}): Testing ${swarmModel} on key ${apiKey.substring(0,6)}...`);
                const completion = await openai.chat.completions.create({
                    model: swarmModel,
                    messages: messages,
                    response_format: responseFormat
                });
                
                const rawContent = completion.choices[0].message.content || '';
                let tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                tokenUsage = estimateTokenUsage(messages, rawContent, tokenUsage);
                keyService.recordKeyUsage(apiKey, tokenUsage);
                
                try {
                    const parsed = extractJsonFromAiResponse(rawContent);
                    
                    if (parsed.tool === 'search_products' && parsed.query) {
                        console.log(`[AI] Tool Call: Searching products for "${parsed.query}"...`);
                        const products = await dbService.searchProducts(pageConfig.user_id, parsed.query, pageConfig.page_id);
                        
                        // Phase 2: Re-generate answer using the SAME model
                        // Format the tool output as a system message to guide the AI
                        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
                        
                        const toolOutputContext = `[System] Search Results for "${parsed.query}": ${JSON.stringify(products)}. 
INSTRUCTIONS:
1. Use the search results above to answer the user's question in Bengali.
2. If the product has an 'image_url', you MUST include it in the 'images' array of your JSON response.
3. If no products were found, apologize and say you couldn't find it.
4. Return ONLY a JSON object with 'reply' (string) and 'images' (array of strings).`;

                        messages.push({ role: 'system', content: toolOutputContext });
                        
                        console.log(`[AI] Tool Result found (Phase 2). Re-generating answer...`);
                        const completion2 = await openai.chat.completions.create({
                            model: swarmModel,
                            messages: messages,
                            response_format: { type: "json_object" }
                        });
                        
                        const rawContent2 = completion2.choices[0].message.content || '';
                        let tokenUsage2 = completion2.usage ? completion2.usage.total_tokens : 0;
                        tokenUsage2 = estimateTokenUsage(messages, rawContent2, tokenUsage2);
                        keyService.recordKeyUsage(apiKey, tokenUsage2);
                        
                        const parsed2 = extractJsonFromAiResponse(rawContent2);
                            if (!parsed2.reply) parsed2.reply = parsed2.response || parsed2.text;

                            // FALLBACK FOR EMPTY REPLY
                            if (!parsed2.reply && products.length > 0) {
                                 parsed2.reply = "আমি আপনার খোঁজা পণ্যগুলো পেয়েছি। নিচে দেখুন:"; 
                            }

                            // Ensure images are passed through if AI found them
                        if (parsed2.images && Array.isArray(parsed2.images)) {
                            // Validate images are from search results (anti-hallucination)
                            const validImages = parsed2.images.filter(img => 
                                products.some(p => p.image_url === img)
                            );
                            parsed2.images = validImages;
                        } else {
                            // Auto-inject images if AI forgot but we have them
                            const productImages = products
                                .filter(p => p.image_url)
                                .map(p => p.image_url);
                            if (productImages.length > 0) {
                                parsed2.images = productImages;
                            }
                        }

                        return { ...parsed2, token_usage: tokenUsage + tokenUsage2 + totalTokenUsage, model: swarmModel, foundProducts: products };
                    }

                    if (!parsed.reply) parsed.reply = parsed.response || parsed.text;
                    return { ...parsed, model: swarmModel, token_usage: tokenUsage + totalTokenUsage, foundProducts };
                } catch (e) {
                     console.error('[AI] Phase 2 Logic/Tool Failed:', e);
                     let cleanText = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                     
                     // Attempt to extract images from text response
                     const extracted = extractImagesFromText(cleanText);
                     cleanText = extracted.text;
                     const extractedImages = extracted.images;

                     cleanText = extractReplyFromText(cleanText);

                     // If reply is empty but we have images, provide a fallback text
                     if (!cleanText && extractedImages.length > 0) {
                         cleanText = "Here are the images you requested:";
                     }

                     return { 
                         reply: cleanText, 
                         sentiment: 'neutral', 
                         model: swarmModel, 
                         token_usage: tokenUsage + totalTokenUsage, 
                         foundProducts,
                         images: extractedImages 
                     };
                }

            } catch (flashError) {
                console.warn(`[AI] ${swarmModel} Failed on Key ${i+1} (${flashError.message}).`);
                
                const status = flashError.status || (flashError.response ? flashError.response.status : null);
                handleAiError(flashError, apiKey, swarmModel);
                
                if (status === 401 || status === 403) {
                    continue;
                }
            }

        } catch (setupError) {
            console.warn(`[AI] Swarm Setup Error:`, setupError.message);
        }
    }
    
    console.error(`[AI] All Phase 2 attempts failed (No valid ${swarmModel} keys).`);
    return null;
}

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'e9457ca133cc4d73854ee0d43cee3bc5';

// --- HELPER: Process Image (Vision) with Smart Fallback ---
async function processImageWithVision(imageUrl, pageConfig = {}, customOptions = null) {
    let base64Image;
    let mimeType;
    let errors = [];

    // 0. Pre-process Image (Download/Decode)
    try {
        if (imageUrl.startsWith('data:')) {
            console.log(`[Vision] Processing Base64 Data URI...`);
            // Safer parsing than strict regex
            const parts = imageUrl.split(',');
            if (parts.length >= 2) {
                // Extract mime type from first part (data:image/jpeg;base64)
                const mimeMatch = parts[0].match(/:(.*?);/);
                mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                // Join rest as data (in case of extra commas, though unlikely in base64)
                base64Image = parts.slice(1).join(',');
                // Clean whitespace just in case
                base64Image = base64Image.replace(/\s/g, '');
            } else {
                throw new Error("Invalid Data URI format (missing comma)");
            }
        } else {
            console.log(`[Vision] Downloading image from URL: ${imageUrl.substring(0, 50)}...`);
            
            // WAHA Authentication Check
            const headers = { 'User-Agent': 'Mozilla/5.0' };
            if (imageUrl.includes(WAHA_BASE_URL) || imageUrl.includes('wahubbd.salesmanchatbot.online')) {
                console.log('[Vision] Detected WAHA URL. Injecting X-Api-Key.');
                headers['X-Api-Key'] = WAHA_API_KEY;
            } else if (imageUrl.includes('graph.facebook.com') && pageConfig.page_access_token) {
                console.log('[Vision] Detected Facebook Graph URL. Injecting Access Token.');
                headers['Authorization'] = `Bearer ${pageConfig.page_access_token}`;
            }

            const response = await axios.get(imageUrl, { 
                responseType: 'arraybuffer',
                headers: headers,
                timeout: 10000 // 10s timeout
            });
            base64Image = Buffer.from(response.data).toString('base64');
            mimeType = response.headers['content-type'] || 'image/jpeg';
            logDebug(`[Vision] Image Downloaded. Mime: ${mimeType}, Size: ${base64Image.length}`);
        }
    } catch (e) {
        const errorMsg = `[Vision] Pre-processing Failed: ${e.message}`;
        console.error(errorMsg);
        logDebug(errorMsg);
        return `Image found but failed to download/decode. Reason: ${e.message}`;
    }

    // Determine System Prompt
    // Use only user-provided prompt; no backend default
    const systemPrompt = typeof customOptions?.prompt === 'string' ? customOptions.prompt : "";

    // --- PRIORITY ATTEMPT (Custom Options) ---
    if (customOptions?.provider === 'openrouter' && customOptions?.model) {
        try {
            const provider = 'openrouter';
            const model = customOptions.model;
            console.log(`[Vision] Priority Attempt: ${model} (${provider})`);

            let keyData = await keyService.getSmartKey(provider, model);
            if (!keyData || !keyData.key) {
                 keyData = await keyService.getSmartKey(provider, 'default');
            }
            
            if (!keyData || !keyData.key) throw new Error("No Key found for OpenRouter");
            const apiKey = keyData.key;
            const url = 'https://openrouter.ai/api/v1/chat/completions';
            
            const payload = {
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                        ]
                    }
                ]
            };

            const response = await axios.post(url, payload, {
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://orderly-conversations.com', 
                    'X-Title': 'Orderly Conversations'
                },
                timeout: 20000 // 20s Timeout
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
            logDebug(`[Vision] Priority Error: ${errMsg}`);
            // Continue to fallbacks...
        }
    }

    // --- FALLBACK STRATEGY ---
    // Priority 1: User Selected Model (if Gemini) or Gemini 2.0 Flash
    // Priority 2: Gemini 2.0 Flash (Retry/Fallback)
    // Priority 3: OpenRouter Best Free Vision (Qwen 2.5 VL)
    
    // ATTEMPT 1: User Model / Gemini 2.0 Flash
    try {
        const provider = 'google';
        // Respect User's Chat Model if it's a Gemini model
        let model = (pageConfig.chatmodel && pageConfig.chatmodel.includes('gemini')) 
            ? pageConfig.chatmodel 
            : 'gemini-2.0-flash';

        console.log(`[Vision] Attempt 1: ${model} (${provider})`);
        
        const keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) throw new Error(`No Key found for ${model}`);

        const apiKey = keyData.key;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        // Gemini doesn't strictly separate system prompt in generateContent
        const textPrompt = systemPrompt;

        const payload = {
            contents: [{
                parts: [
                    { text: textPrompt },
                    { inline_data: { mime_type: mimeType, data: base64Image } }
                ]
            }]
        };

        const visionResponse = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 20000 // 20s Timeout
        });

        const result = visionResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const usage = visionResponse.data?.usageMetadata?.totalTokenCount || 0;

        if (!result) throw new Error("Empty response from Gemini");
        
        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.warn(`[Vision] Attempt 1 Failed: ${errMsg}`);
        errors.push(`Gemini Attempt 1: ${errMsg}`);
        logDebug(`[Vision] Error 1: ${errMsg}`);

        // STRICT OWN API LOCK (Vision)
        if (pageConfig && pageConfig.api_key && pageConfig.cheap_engine === false) {
             console.error(`[Vision] Strict Own API Failed. Blocking System Fallback.`);
             throw new Error(`Vision Analysis Failed with your API Key: ${errMsg}`);
        }
    }

    // ATTEMPT 2: Gemini 2.0 Flash (Explicit Fallback)
    try {
        const provider = 'google';
        const model = 'gemini-2.0-flash';
        
        // Skip if we just tried 2.0 Flash in Attempt 1
        const attemptedModel = (pageConfig.chatmodel && pageConfig.chatmodel.includes('gemini')) ? pageConfig.chatmodel : 'gemini-2.0-flash';
        if (attemptedModel === model) {
             throw new Error("Already attempted in Step 1");
        }

        console.log(`[Vision] Attempt 2: ${model} (${provider})`);
        
        const keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) throw new Error("No Key found for Gemini 2.0 Flash");

        const apiKey = keyData.key;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const textPrompt = systemPrompt; // Reuse prompt
        const payload = {
            contents: [{
                parts: [
                    { text: textPrompt },
                    { inline_data: { mime_type: mimeType, data: base64Image } }
                ]
            }]
        };

        const visionResponse = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        const result = visionResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const usage = visionResponse.data?.usageMetadata?.totalTokenCount || 0;

        if (!result) throw new Error("Empty response from Gemini Flash");

        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        if (errMsg !== "Already attempted in Step 1") {
            console.warn(`[Vision] Attempt 2 (${'gemini-2.0-flash'}) Failed: ${errMsg}`);
            errors.push(`Gemini 2.0 Flash: ${errMsg}`);
            logDebug(`[Vision] Error 2: ${errMsg}`);
        }
    }

    // ATTEMPT 3: OpenRouter (Qwen 2.5 VL - Free)
    try {
        const provider = 'openrouter';
        const model = 'qwen/qwen-2.5-vl-7b-instruct:free';
        console.log(`[Vision] Attempt 3: ${model} (${provider})`);

        let keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) {
             // Try generic default
             keyData = await keyService.getSmartKey(provider, 'default');
        }
        
        if (!keyData || !keyData.key) throw new Error("No Key found for OpenRouter");

        const apiKey = keyData.key;
        const url = 'https://openrouter.ai/api/v1/chat/completions';
        
        const payload = {
            model: model,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: [
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                    ]
                }
            ]
        };

        const response = await axios.post(url, payload, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://orderly-conversations.com', 
                'X-Title': 'Orderly Conversations'
            }
        });

        const result = response.data?.choices?.[0]?.message?.content;
        const usage = response.data?.usage?.total_tokens || 0;

        if (!result) throw new Error("Empty response from OpenRouter");

        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.warn(`[Vision] Attempt 3 (${'qwen/qwen-2.5-vl-7b-instruct:free'}) Failed: ${errMsg}`);
        errors.push(`OpenRouter Qwen: ${errMsg}`);
        logDebug(`[Vision] Error 3: ${errMsg}`);
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
        if (audioUrl.includes(WAHA_BASE_URL)) headers['X-Api-Key'] = WAHA_API_KEY;
        else if (audioUrl.includes('graph.facebook.com') && config.page_access_token) headers['Authorization'] = `Bearer ${config.page_access_token}`;

        const response = await axios.get(audioUrl, { responseType: 'arraybuffer', headers, validateStatus: s => s === 200 });
        audioBuffer = Buffer.from(response.data);

        const contentType = response.headers['content-type'] || 'audio/ogg';
        
        // Map to Gemini-supported MIME types
        if (contentType.includes('opus') || contentType.includes('ogg')) mimeType = 'audio/ogg';
        else if (contentType.includes('mp3') || contentType.includes('mpeg')) mimeType = 'audio/mp3';
        else if (contentType.includes('wav')) mimeType = 'audio/wav';
        else if (contentType.includes('aac') || contentType.includes('mp4') || contentType.includes('m4a')) mimeType = 'audio/mp4';
        else {
            // Fallback: Check URL extension if Content-Type is generic/unknown
            if (audioUrl.includes('.mp4') || audioUrl.includes('.aac') || audioUrl.includes('.m4a')) mimeType = 'audio/mp4';
            else if (audioUrl.includes('.mp3')) mimeType = 'audio/mp3';
            else if (audioUrl.includes('.wav')) mimeType = 'audio/wav';
            else mimeType = 'audio/ogg'; // Default safe assumption
        }
        
        logDebug(`[Audio] Downloaded. Size: ${audioBuffer.length}, Content-Type: ${contentType}, Mapped Type: ${mimeType}`);

        // Check size limit (Gemini Inline Data limit is ~20MB)
        if (audioBuffer.length > 15 * 1024 * 1024) {
             console.warn(`[Audio] File too large (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB). Skipping transcription.`);
             return "[System: Audio file too large to transcribe]";
        }

    } catch (e) {
        console.error(`[Audio] Download Failed:`, e.message);
        return "[Audio Download Failed]";
    }

    // 2. Priority Chain: Own API -> Gemini 2.5 Flash -> Lite -> Groq (Faster)
    const priorityChain = [];
    let userKey = null;

    // PHASE 1: OWN API (If User Provided Key)
    if (config && config.api_key && config.cheap_engine === false) {
        const userKeys = config.api_key.split(',').map(k => k.trim()).filter(k => k);
        userKey = userKeys[0]; // Use first key for simplicity in audio

        if (userKey && userKey.startsWith('sk-') && !userKey.startsWith('sk-or')) {
            // OpenAI Key -> Use Whisper
            priorityChain.push({ provider: 'openai', model: 'whisper-1', name: 'OpenAI Whisper (User Key)', key: userKey });
        } else if (userKey.startsWith('gsk_')) {
            // Groq Key -> Use Groq
            priorityChain.push({ provider: 'groq', model: 'whisper-large-v3', name: 'Groq Whisper (User Key)', key: userKey });
        } else if (userKey.startsWith('AIza')) {
            // Gemini Key -> Use Gemini (Try User's Model first, else 2.0 Flash)
            const userModel = (config.model && config.model.startsWith('gemini')) ? config.model : 'gemini-2.0-flash';
            priorityChain.push({ provider: 'google', model: userModel, name: `Gemini (${userModel}) (User Key)`, key: userKey });
            
            // If User's model is NOT 2.0 Flash, add 2.0 Flash as backup with User Key (it's reliable for audio)
            if (userModel !== 'gemini-2.0-flash') {
                 priorityChain.push({ provider: 'google', model: 'gemini-2.0-flash', name: 'Gemini (2.0 Flash) (User Key)', key: userKey });
            }
        }
    }

    // PHASE 2: SYSTEM KEYS (Cheap Engine / Fallback)
    // ONLY add system keys if NO User Key was provided.
    // User Requirement: "own api er modde defualt chatmodel defualt api asob kisui use kora jabe na"
    if (!userKey) {
        priorityChain.push(
            { provider: 'google', model: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }, // 2.0 is reliable for Audio
            { provider: 'groq', model: 'whisper-large-v3', name: 'Groq Whisper V3' }
        );
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
                const formData = new FormData();
                formData.append('file', audioBuffer, { filename: `audio.${mimeType.split('/')[1]}`, contentType: mimeType });
                formData.append('model', 'whisper-1');

                const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${apiKey}`
                    }
                });

                const text = res.data?.text;
                if (text) {
                    console.log(`[Audio] Success with ${option.name}: "${text.substring(0, 30)}..."`);
                    return { text: text.trim(), usage: 0 }; // Usage tracking for audio is complex, skipping for now
                }
            }

            // GEMINI DIRECT API
            if (option.provider === 'google') {
                const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
                const url = `${baseUrl}/models/${option.model}:generateContent?key=${apiKey}`;
                
                const payload = {
                    contents: [{
                        parts: [
                            { text: "Transcribe this audio. Priority languages: Bangla, then English, then Hindi. Output ONLY the transcription text." },
                            { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } }
                        ]
                    }]
                };
                
                const res = await axios.post(url, payload);
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
                formData.append('file', audioBuffer, { filename: `audio.${mimeType.split('/')[1]}`, contentType: mimeType });
                formData.append('model', 'whisper-large-v3');
                // formData.append('language', 'bn'); // Let it auto-detect for Banglish support
                formData.append('temperature', '0');

                const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${apiKey}`
                    }
                });

                const text = res.data?.text;
                if (text) {
                    console.log(`[Audio] Success with ${option.name}: "${text.substring(0, 30)}..."`);
                    return { text: text.trim(), usage: 0 }; // Whisper is cheap/free on Groq usually
                }
            }
            
        } catch (e) {
             console.warn(`[Audio] ${option.name} Failed:`, e.message);
        }
    }

    return { text: "[Audio Transcription Failed]", usage: 0 };
}

module.exports = {
    generateReply,
    generateResponse,
    fetchOgImage,
    processImageWithVision,
    transcribeAudio
};
