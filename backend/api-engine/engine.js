const express = require('express');
const router = express.Router();
const keyService = require('../src/services/keyService');
const dbService = require('../src/services/dbService');
const pgClient = require('../src/services/pgClient');
const adminAuthMiddleware = require('../src/middleware/adminAuthMiddleware');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { logDebug } = require('../src/services/aiService');

// --- Proxy Helper ---
function getProxyUrl() {
    // 1. Fetch credentials with multiple fallback names for Coolify/Docker environment
    const user = (process.env.BRIGHT_DATA_USER || process.env.BRIGHTDATA_PROXY_USER || 'brd-customer-hl_69ebe07e-zone-data_center').replace(/['"]/g, '').trim();
    const pass = (process.env.BRIGHT_DATA_PASS || process.env.BRIGHTDATA_PROXY_PASS || 'zgs4711vyxnp').replace(/['"]/g, '').trim();
    const proxyUrl = (process.env.BRIGHT_DATA_PROXY_URL || process.env.BRIGHTDATA_PROXY_HOST || 'brd.superproxy.io:33335').replace(/['"]/g, '').trim();
    
    if (!user || !pass) {
        return null;
    }

    // 2. Standardize Host (Remove http/https and trailing slashes)
    let host = proxyUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    // 3. Construct the proxy URL with random session for IP rotation
    // Bright Data Session format: user-session-xxx
    const session = `sess_${Math.floor(Math.random() * 9999999)}`;
    
    // Standard Bright Data Format: http://user-session-xxx:pass@host
    const url = `http://${user}-session-${session}:${pass}@${host}`;
    console.log(`[Proxy] Generated URL for Session: ${session} (Host: ${host})`);
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

// --- 1. ENGINE STATS & DASHBOARD ---
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
                mistral: allKeys.filter(k => k.provider === 'mistral').length,
                deepseek: allKeys.filter(k => k.provider === 'deepseek').length
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
        const { 
            name, 
            provider, 
            text_model, 
            voice_model, 
            image_model, 
            voice_provider_override, 
            image_provider_override,
            use_proxy 
        } = req.body || {};
        
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }

        await pgClient.query(
            `
            INSERT INTO engine_configs 
                (name, provider, text_model, voice_model, image_model, voice_provider_override, image_provider_override, use_proxy, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (name)
            DO UPDATE SET
                provider = COALESCE(EXCLUDED.provider, engine_configs.provider),
                text_model = COALESCE(EXCLUDED.text_model, engine_configs.text_model),
                voice_model = COALESCE(EXCLUDED.voice_model, engine_configs.voice_model),
                image_model = COALESCE(EXCLUDED.image_model, engine_configs.image_model),
                voice_provider_override = EXCLUDED.voice_provider_override,
                image_provider_override = EXCLUDED.image_provider_override,
                use_proxy = EXCLUDED.use_proxy,
                updated_at = NOW()
            `,
            [
                String(name),
                provider !== undefined ? provider : null,
                text_model !== undefined ? text_model : null,
                voice_model !== undefined ? voice_model : null,
                image_model !== undefined ? image_model : null,
                voice_provider_override !== undefined ? voice_provider_override : null,
                image_provider_override !== undefined ? image_provider_override : null,
                use_proxy !== undefined ? use_proxy : false
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
        const { rph_limit } = req.body || {};
        const updated = await dbService.updateApiKeyRphLimit(id, rph_limit);
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
router.post('/v1/chat/completions', async (req, res) => {
    const { model, messages, stream, provider: bodyProvider } = req.body;
    
    // Auto-Detect Provider if not specified via header (Internal Logic)
    let provider = bodyProvider;
    if (!provider) {
        provider = 'google';
        if (model.includes('gpt')) provider = 'openai';
        else if (model.includes('mistral')) provider = 'mistral';
        else if (model.includes('deepseek')) provider = 'deepseek';
        else if (model.includes('llama') || model.includes('mixtral')) provider = 'groq';
        else if (model.includes('/') || model.includes(':free')) provider = 'openrouter';
    }

    console.log(`[API Engine] Processing Request: ${provider} / ${model}`);
     logDebug(`[API Engine] Processing Request: ${provider} / ${model}`);
  
     // --- BRANDED MODEL MAPPING ---
    // Google/Gemini doesn't recognize branded model names. Map them to real models.
    let upstreamModel = model;
    if (provider === 'google' || provider === 'gemini') {
        if (model === 'salesmanchatbot-pro') upstreamModel = 'gemini-2.5-flash';
        else if (model === 'salesmanchatbot-flash') upstreamModel = 'gemini-2.5-flash-lite';
        else if (model === 'salesmanchatbot-lite') upstreamModel = 'gemini-2.5-flash-lite';
    } else if (provider === 'groq' && model === 'salesmanchatbot-lite') {
        upstreamModel = 'llama-3.3-70b-versatile';
    }
    // Update req.body for upstream request
    req.body.model = upstreamModel;

    // Determine Upstream Target
    let targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    if (provider === 'openai') targetUrl = 'https://api.openai.com/v1/chat/completions';
    else if (provider === 'groq') targetUrl = 'https://api.groq.com/openai/v1/chat/completions';
    else if (provider === 'openrouter') targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
    else if (provider === 'mistral') targetUrl = 'https://api.mistral.ai/v1/chat/completions';
    else if (provider === 'deepseek') targetUrl = 'https://api.deepseek.com/chat/completions';
    else if (provider === 'google' || provider === 'gemini') {
        targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    }

    console.log(`[API Engine] Target URL: ${targetUrl}`);
    logDebug(`[API Engine] Target URL: ${targetUrl}`);

    try {
        const isSystemEngine = req.body.is_system_engine !== false;
        // --- NEW: FETCH PROXY CONFIG FROM DB ---
        let shouldForceProxy = false;
        try {
            const configResult = await pgClient.query('SELECT use_proxy FROM engine_configs WHERE name = $1 LIMIT 1', [model]);
            if (configResult.rows.length > 0) {
                shouldForceProxy = configResult.rows[0].use_proxy === true;
            }
        } catch (e) {
            console.warn(`[API Engine] Failed to fetch proxy config for ${model}: ${e.message}`);
        }

        if (stream) {
            const maxAttempts = 5;
            let lastError = null;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const keyData = await keyService.getSmartKey(provider, upstreamModel);
                if (!keyData) break;

                // Proxy Logic: Use if forced by DB config OR if it's a system engine request
                let agent = undefined;
                if (shouldForceProxy || req.body.is_system_engine !== false) {
                    const proxyUrl = getProxyUrl();
                    if (proxyUrl) {
                        agent = new HttpsProxyAgent(proxyUrl);
                        const proxyLog = `[API Engine] 🌐 Using Bright Data Proxy for Model: ${upstreamModel} (Forced: ${shouldForceProxy})`;
                        console.log(proxyLog);
                        logDebug(proxyLog);
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
                    if ([429, 401, 403].includes(response.status)) {
                        keyService.markKeyAsDead(keyData.key, 60000, `upstream_${response.status}`);
                    }
                    lastError = response.data;
                    if (response.data && response.data.destroy) response.data.destroy();
                    continue;
                }

                const firstChunk = await readFirstChunk(response.data);
                if (provider === 'google' || provider === 'gemini') {
                    const streamError = parseStreamError(firstChunk);
                    if (streamError) {
                        keyService.markKeyAsDead(keyData.key, 60000, 'stream_error');
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

        const keyData = await keyService.getSmartKey(provider, upstreamModel);
        if (!keyData) {
            console.warn(`[API Engine] ⚠️ No keys available for ${provider}/${upstreamModel}`);
            return res.status(429).json({ 
                error: { 
                    message: "Engine Overload: All API keys are currently rate limited or exhausted.",
                    type: "insufficient_quota",
                    code: 429 
                } 
            });
        }

        // Proxy Logic: Use if forced by DB config OR if it's a system engine request
        let agent = undefined;
        if (shouldForceProxy || req.body.is_system_engine !== false) {
            const proxyUrl = getProxyUrl();
            if (proxyUrl) {
                agent = new HttpsProxyAgent(proxyUrl);
                const proxyLogStr = `[API Engine] 🌐 Using Bright Data Proxy for Model: ${upstreamModel} (Forced: ${shouldForceProxy})`;
                console.log(proxyLogStr);
                logDebug(proxyLogStr);
            }
        }

        const response = await axios.post(targetUrl, req.body, {
            headers: {
                'Authorization': `Bearer ${keyData.key}`,
                'Content-Type': 'application/json'
            },
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false,
            timeout: 60000,
            validateStatus: () => true
        });

        if (response.data?.usage) {
            keyService.recordKeyUsage(keyData.key, response.data.usage.total_tokens);
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
                    console.warn(`[API Engine] Blocking Key ${token.substring(0,8)}...`);
                    keyService.markKeyAsDead(token, 60000, `upstream_${status}`);
                }
            }
        }

        res.status(status).json(error.response?.data || { error: error.message });
    }
});

module.exports = router;
