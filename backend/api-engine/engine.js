const express = require('express');
const router = express.Router();
const keyService = require('../src/services/keyService');
const dbService = require('../src/services/dbService');
const pgClient = require('../src/services/pgClient');
const adminAuthMiddleware = require('../src/middleware/adminAuthMiddleware');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- PRICING ---
const PRICING = {
    PRO: 150,
    FLASH: 100,
    LITE: 80
};

const getCostPerRequest = (modelName) => {
    let rate = PRICING.PRO;
    if (modelName.includes('flash')) rate = PRICING.FLASH;
    else if (modelName.includes('lite')) rate = PRICING.LITE;
    return rate / 1000;
};

// --- Proxy Helper ---
function getProxyUrl(modelName = 'default') {
    const proxyUrl = process.env.BRIGHT_DATA_PROXY_URL;
    const user = process.env.BRIGHT_DATA_USER;
    const pass = process.env.BRIGHT_DATA_PASS;
    if (!proxyUrl || !user || !pass) return null;
    
    // Some BrightData zones prefer simple alphanumeric session IDs to avoid 407 errors
    const cleanModelName = modelName.replace(/[^a-zA-Z0-9]/g, '');
    const session = `${cleanModelName}${Math.floor(Math.random() * 9999)}`;
    const url = `http://${user}-session-${session}:${pass}@${proxyUrl}`;

    console.log(`[API Engine Proxy] Using Session: ${session} for model: ${modelName}`);

    return url;
}

function parseStreamError(chunk) {
    if (!chunk) return null;
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
    const cleaned = text.startsWith('data: ') ? text.slice(6) : text;
    try {
        const payload = JSON.parse(cleaned);
        if (payload && payload.error) {
            return payload.error.message || payload.error || 'stream_error';
        }
    } catch (e) {
        if (text.toLowerCase().includes('"error"')) return 'stream_error';
    }
    return null;
}

function readFirstChunk(stream, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const onData = (chunk) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(chunk);
        };
        const onError = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        }, timeoutMs);
        const cleanup = () => {
            clearTimeout(timer);
            stream.off('data', onData);
            stream.off('error', onError);
        };
        stream.on('data', onData);
        stream.on('error', onError);
    });
}

// --- 1. AUTH HELPER ---
const validateUserApiKey = async (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { error: { status: 401, message: 'Missing or invalid Authorization header' } };
    }

    const apiKey = authHeader.replace('Bearer ', '').trim();
    if (!apiKey) return { error: { status: 401, message: 'Invalid API Key' } };

    try {
        const result = await pgClient.query(
            'SELECT user_id, balance, service_api_key FROM user_configs WHERE service_api_key = $1 LIMIT 1',
            [apiKey]
        );

        if (result.rows.length === 0) return { error: { status: 401, message: 'Invalid API Key' } };
        return { userConfig: result.rows[0] };
    } catch (error) {
        return { error: { status: 500, message: 'Database Error' } };
    }
};

// --- 2. ENGINE STATS & DASHBOARD ---
router.get('/stats', adminAuthMiddleware, async (req, res) => {
    try {
        const { provider, page, limit, q } = req.query; // Get filter and pagination
        
        const allKeys = await dbService.getAllKeys();
        const active = allKeys.filter(k => k.status === 'active').length;
        const dead = allKeys.filter(k => k.status === 'disabled').length;
        
        // Use smart rotation pool logic for the displayed keys with pagination
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const poolData = keyService.getActiveRotationPool(provider, pageNum, limitNum, q);
        
        res.json({
            engine_status: 'online',
            total_keys: allKeys.length,
            active_keys: active,
            dead_keys: dead,
            providers: {
                google: allKeys.filter(k => k.provider === 'google' || k.provider === 'gemini').length,
                openai: allKeys.filter(k => k.provider === 'openai').length,
                groq: allKeys.filter(k => k.provider === 'groq').length,
                openrouter: allKeys.filter(k => k.provider === 'openrouter').length,
                mistral: allKeys.filter(k => k.provider === 'mistral').length
            },
            ...poolData // total, page, limit, keys
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/config', adminAuthMiddleware, async (req, res) => {
    try {
        const result = await pgClient.query(`SELECT * FROM engine_configs ORDER BY name ASC`);
        res.json(result.rows || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/config', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, provider, text_model, voice_model, image_model, voice_provider_override, image_provider_override } = req.body || {};
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }

        await pgClient.query(
            `
            INSERT INTO engine_configs 
                (name, provider, text_model, voice_model, image_model, voice_provider_override, image_provider_override, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (name)
            DO UPDATE SET
                provider = COALESCE(EXCLUDED.provider, engine_configs.provider),
                text_model = COALESCE(EXCLUDED.text_model, engine_configs.text_model),
                voice_model = COALESCE(EXCLUDED.voice_model, engine_configs.voice_model),
                image_model = COALESCE(EXCLUDED.image_model, engine_configs.image_model),
                voice_provider_override = EXCLUDED.voice_provider_override,
                image_provider_override = EXCLUDED.image_provider_override,
                updated_at = NOW()
            `,
            [
                String(name),
                provider !== undefined ? provider : null,
                text_model !== undefined ? text_model : null,
                voice_model !== undefined ? voice_model : null,
                image_model !== undefined ? image_model : null,
                voice_provider_override !== undefined ? voice_provider_override : null,
                image_provider_override !== undefined ? image_provider_override : null
            ]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- 2. KEY MANAGEMENT (CRUD) ---
router.post('/keys', async (req, res) => {
    try {
        const { api, provider, model } = req.body;
        if (!api || !provider) return res.status(400).json({ error: "API Key and Provider required" });
        
        await dbService.addApiKey({ api, provider, model: model || 'default' });
        await keyService.updateKeyCache(true); // Force Refresh
        res.json({ success: true, message: "Key added to rotation pool" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/keys/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id || Number.isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }

        const keyData = await dbService.getApiKeyById(id);
        if (!keyData) {
            return res.status(404).json({ success: false, error: 'Key not found' });
        }

        res.json({ success: true, api: keyData.api });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.patch('/keys/:id/limits', adminAuthMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id || Number.isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }
        const { rph_limit, rpm_limit, rpd_limit, model } = req.body || {};
        const updated = await dbService.updateApiKeyLimits(id, { rph_limit, rpm_limit, rpd_limit, model });
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Key not found' });
        }
        await keyService.updateKeyCache(true);
        res.json({ success: true, key: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/keys/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await dbService.deleteApiKey(id);
        await keyService.updateKeyCache(true);
        res.json({ success: true, message: "Key removed" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 3. THE CORE PROXY ENGINE (Compatible with OpenAI Client) ---
// Endpoint: /v1/chat/completions
router.get('/v1', async (req, res) => {
    res.json({ status: "online", message: "SalesmanChatbot API Engine v1 is running." });
});

router.get('/v1/models', async (req, res) => {
    const { error } = await validateUserApiKey(req);
    if (error) return res.status(error.status).json({ error: error.message });

    return res.json({
        object: "list",
        data: [
            { id: "salesmanchatbot-pro", object: "model", created: 1677610602, owned_by: "salesman" },
            { id: "salesmanchatbot-flash", object: "model", created: 1709251200, owned_by: "salesman" },
            { id: "salesmanchatbot-lite", object: "model", created: 1709251200, owned_by: "salesman" }
        ]
    });
});

router.post('/v1/chat/completions', async (req, res) => {
    const { userConfig, error: authError } = await validateUserApiKey(req);
    if (authError) return res.status(authError.status).json({ error: authError.message });

    // Check Balance
    if (userConfig.balance < 0.01) {
        return res.status(402).json({ error: "Insufficient balance. Minimum 0.01 BDT required." });
    }

    const { model, messages, stream } = req.body;

    // --- MULTI-MODAL EXTRACTION (User Requirement: Unified Endpoint) ---
    let imageUrls = [];
    let audioUrls = [];
    let lastUserMessage = "";

    if (messages && Array.isArray(messages)) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
            if (Array.isArray(lastMsg.content)) {
                lastMsg.content.forEach(part => {
                    if (part.type === 'text') lastUserMessage += part.text + " ";
                    else if (part.type === 'image_url') imageUrls.push(part.image_url?.url || part.image_url);
                    else if (part.type === 'audio_url') audioUrls.push(part.audio_url?.url || part.audio_url);
                });
            } else {
                lastUserMessage = lastMsg.content;
            }
        }
    }

    // Auto-Detect Provider if not specified via header (Internal Logic)
    let provider = 'google';
    let modelToUse = model;

    // --- DYNAMIC ENGINE RESOLUTION ---
    const isBranded = model === 'salesmanchatbot-pro' || model === 'salesmanchatbot-flash' || model === 'salesmanchatbot-lite';
    const isVision = imageUrls.length > 0;
    const isAudio = audioUrls.length > 0;

    if (isBranded) {
        try {
            const mockConfig = { chat_model: model, cheap_engine: true };
            const resolved = await aiService.resolveSalesmanchatbotEngine(mockConfig, 'salesmanchatbot', model, isVision, isAudio);
            provider = resolved.finalProvider;
            modelToUse = resolved.finalModel;
            console.log(`[API Engine] Dynamically Resolved ${model} -> ${provider}/${modelToUse} (Vision: ${isVision}, Audio: ${isAudio})`);
        } catch (e) {
            console.warn(`[API Engine] Dynamic resolution failed for ${model}. Error: ${e.message}`);
            // No hardcoded fallbacks here as per user requirement to manage from frontend
        }
    } else if (model.includes('gpt')) {
        provider = 'openai';
    } else if (model.includes('mistral')) {
        provider = 'mistral';
    } else if (model.includes('llama') || model.includes('mixtral')) {
        provider = 'groq';
    } else if (model.includes('/') || model.includes(':free')) {
        provider = 'openrouter';
    }

    console.log(`[API Engine] Processing Request: ${provider} / ${model} (Resolved: ${modelToUse})`);

    // Determine Upstream Target
    let targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    if (provider === 'openai') targetUrl = 'https://api.openai.com/v1/chat/completions';
    else if (provider === 'groq') targetUrl = 'https://api.groq.com/openai/v1/chat/completions';
    else if (provider === 'openrouter') targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
    else if (provider === 'mistral') targetUrl = 'https://api.mistral.ai/v1/chat/completions';
    else if (provider === 'google' || provider === 'gemini') targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

    // Update body with resolved model
    req.body.model = modelToUse;

    // Determined Key logic
    const isSystemEngine = req.body.is_system_engine !== false; 

    // --- MULTI-MODAL PRE-PROCESSING ---
    let preProcessedContext = "";
    if (imageUrls.length > 0 || audioUrls.length > 0) {
        try {
            console.log(`[API Engine] Pre-processing media: Images=${imageUrls.length}, Audio=${audioUrls.length}`);
            const mediaResult = await aiService.generateReply(
                lastUserMessage || "Analyze this media",
                { cheap_engine: true, is_external_api: true, platform: 'api_engine' },
                {}, [], "User", "Owner", null, imageUrls, audioUrls
            );
            
            if (mediaResult && mediaResult.reply) {
                preProcessedContext = mediaResult.reply;
                console.log(`[API Engine] Media processed successfully.`);
            }
        } catch (mediaErr) {
            console.warn(`[API Engine] Media pre-processing failed:`, mediaErr.message);
        }
    }

    // If we have media context, we inject it into the LAST user message
    if (preProcessedContext && messages.length > 0) {
        const lastIndex = messages.length - 1;
        if (typeof messages[lastIndex].content === 'string') {
            messages[lastIndex].content += `\n\n[Media Analysis Context]: ${preProcessedContext}`;
        } else if (Array.isArray(messages[lastIndex].content)) {
            messages[lastIndex].content.push({ type: 'text', text: `\n\n[Media Analysis Context]: ${preProcessedContext}` });
        }
    }

    try {
        if (stream) {
            const maxAttempts = 5;
            let lastError = null;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const keyData = await keyService.getSmartKey(provider, modelToUse);
                if (!keyData) break;

                // Proxy only for system keys to save costs
                let agent = undefined;
                if (isSystemEngine) {
                    const proxyUrl = getProxyUrl(model);
                    agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
                    if (agent) {
                        console.log(`[API Engine] 🌐 Using Bright Data Proxy for SalesmanChatbot Engine (Model: ${model})`);
                        // Optional: Log IP for debugging
                        axios.get('https://api.ip.sb/geoip', { httpsAgent: agent, timeout: 5000 })
                            .then(res => console.log(`[API Engine IP] IP: ${res.data.ip} | Country: ${res.data.country}`))
                            .catch(() => {});
                    }
                }

                const response = await axios.post(targetUrl, req.body, {
                    headers: {
                        'Authorization': `Bearer ${keyData.key}`,
                        'Content-Type': 'application/json'
                    },
                    httpsAgent: agent,
                    httpAgent: agent,
                    proxy: false, // Important for HttpsProxyAgent
                    responseType: 'stream',
                    timeout: 60000,
                    validateStatus: () => true
                });

                if (response.status >= 400) {
                    if ([429].includes(response.status)) {
                        // Rate Limit hit: Lock for 2 minutes only
                        const twoMinutes = 2 * 60 * 1000;
                        keyService.markKeyAsDead(keyData.key, twoMinutes, `upstream_429_2m`);
                    } else if ([401, 403].includes(response.status)) {
                        // Auth error: Lock for 24h as key might be dead
                        const twentyFourHours = 24 * 60 * 60 * 1000;
                        keyService.markKeyAsDead(keyData.key, twentyFourHours, `upstream_${response.status}_24h`);
                    }
                    lastError = response.data;
                    if (response.data && response.data.destroy) response.data.destroy();
                    continue;
                }

                const firstChunk = await readFirstChunk(response.data);
                if (provider === 'google' || provider === 'gemini') {
                    const streamError = parseStreamError(firstChunk);
                    if (streamError) {
                        // Rate Limit in stream: Lock for 2 minutes
                        const twoMinutes = 2 * 60 * 1000;
                        keyService.markKeyAsDead(keyData.key, twoMinutes, 'stream_429_2m');
                        if (response.data && response.data.destroy) response.data.destroy();
                        lastError = { error: streamError };
                        continue;
                    }
                }

                if (response.headers && response.headers['content-type']) {
                    res.setHeader('Content-Type', response.headers['content-type']);
                }
                if (firstChunk) res.write(firstChunk);
                response.data.pipe(res);
                return;
            }

            const status = 502;
            return res.status(status).json({ error: lastError || 'stream_failed' });
        }

        const keyData = await keyService.getSmartKey(provider, modelToUse);
        if (!keyData) {
            console.warn(`[API Engine] ⚠️ No keys available for ${provider}/${modelToUse}`);
            return res.status(429).json({ 
                error: { 
                    message: "Engine Overload: All API keys are currently rate limited or exhausted.",
                    type: "insufficient_quota",
                    code: 429 
                } 
            });
        }

    // Proxy ONLY if it's a branded engine (User requirement: affordable costs)
    let agent = undefined;
    if (isBranded) {
        const proxyUrl = getProxyUrl(model); // Use original model name for session pinning
        agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
        if (agent) {
            console.log(`[API Engine] 🌐 Using Bright Data Proxy for Branded Engine: ${model}`);
            // Optional: Log IP for debugging
            axios.get('https://api.ip.sb/geoip', { httpsAgent: agent, timeout: 5000 })
                .then(res => console.log(`[API Engine IP] IP: ${res.data.ip} | Country: ${res.data.country}`))
                .catch(() => {});
        }
    }

        const response = await axios.post(targetUrl, req.body, {
            headers: {
                'Authorization': `Bearer ${keyData.key}`,
                'Content-Type': 'application/json'
            },
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false, // Important for HttpsProxyAgent
            responseType: 'json',
            timeout: 60000
        });

        if (response.data?.usage) {
            keyService.recordKeyUsage(keyData.key, response.data.usage.total_tokens);
            
            // Deduct User Balance
            const cost = getCostPerRequest(model);
            dbService.deductUserBalance(userConfig.user_id, cost, `API Engine Call: ${model}`)
                .catch(err => console.error(`[API Engine] Balance deduction failed:`, err.message));
        }

        res.json(response.data);

    } catch (error) {
        // Handle Upstream Errors (Block Bad Keys)
        const status = error.response?.status || 500;
        console.warn(`[API Engine] Upstream Error (${status}): ${error.message}`);

        if (status === 429 || status === 401 || status === 403) {
            if (error.config?.headers?.Authorization) {
                const authHeader = error.config.headers.Authorization;
                const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
                if (token) {
                    // Use the smart error handler
                    const requestedModel = req.body.model || req.query.model;
                    await keyService.handleApiKeyError(token, error.response?.data?.error?.message || error.message, requestedModel);
                }
            }
        }

        res.status(status).json(error.response?.data || { error: error.message });
    }
});

module.exports = router;
