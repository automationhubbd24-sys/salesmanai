const express = require('express');
const router = express.Router();
const keyService = require('../src/services/keyService');
const dbService = require('../src/services/dbService');
const pgClient = require('../src/services/pgClient');
const adminAuthMiddleware = require('../src/middleware/adminAuthMiddleware');
const authMiddleware = require('../src/middleware/authMiddleware');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const aiService = require('../src/services/aiService');

// --- Proxy Helper ---
function getProxyUrl(modelName = 'default') {
    const proxyUrl = process.env.BRIGHT_DATA_PROXY_URL;
    const user = process.env.BRIGHT_DATA_USER;
    const pass = process.env.BRIGHT_DATA_PASS;
    if (!proxyUrl || !user || !pass) return null;
    
    // Use a large random session ID to ensure a NEW IP for EVERY request
    // This addresses the user requirement: "prottek new request e new ip"
    const session = Math.floor(Math.random() * 10000000);
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
            `SELECT uc.user_id, uc.balance, uc.service_api_key, u.developer_status 
             FROM user_configs uc
             JOIN users u ON uc.user_id = u.id
             WHERE uc.service_api_key = $1 LIMIT 1`,
            [apiKey]
        );

        if (result.rows.length === 0) return { error: { status: 401, message: 'Invalid API Key' } };
        
        const userConfig = result.rows[0];
        if (userConfig.developer_status !== 'approved') {
            return { error: { status: 403, message: 'Developer access not approved. Please register and pay the 5,000 BDT fee.' } };
        }

        return { userConfig };
    } catch (error) {
        console.error('[Auth Error]', error.message);
        return { error: { status: 500, message: 'Database Error' } };
    }
};

// --- GLOBAL AUTH MIDDLEWARE (STRICT) ---
router.use(async (req, res, next) => {
    if (req.path === '/health' || req.path === '/status' || req.path === '/') return next();

    // Skip strict check for key management if it's an internal dashboard request (JWT)
    // The individual routes will handle specific JWT or Admin auth
    if (req.path.startsWith('/keys') || req.path.startsWith('/config') || req.path.startsWith('/stats')) {
        return next();
    }

    const { userConfig, error } = await validateUserApiKey(req);
    if (error) {
        console.warn(`[API Engine Auth] Denied ${req.method} ${req.originalUrl} - ${error.message}`);
        
        // Special case: If user gives wrong key but accesses root/base URLs, show friendly error instead of breaking connection tests completely if we want to guide them
        const isRootPath = req.path === '/v1' || req.path === '/v1/' || req.path === '/api/v1/dev/chat';
        
        return res.status(error.status).json({ 
            error: {
                message: isRootPath ? "Unauthorized API Key. Please get a valid key from salesmanchatbot.online/dashboard/api" : error.message,
                type: 'invalid_request_error',
                code: error.status === 401 ? 'invalid_api_key' : 'forbidden'
            }
        });
    }
    
    req.userConfig = userConfig;
    next();
});

// --- OpenAI Compatibility Routes ---
const MODELS_LIST = {
    object: "list",
    data: [
        { id: "salesmanchatbot-pro", object: "model", created: 1677610602, owned_by: "salesman" },
        { id: "salesmanchatbot-flash", object: "model", created: 1709251200, owned_by: "salesman" },
        { id: "salesmanchatbot-lite", object: "model", created: 1709251200, owned_by: "salesman" },
        { id: "salesmanchatbot-brain", object: "model", created: 1709251200, owned_by: "salesman" }
    ]
};

router.get('/', (req, res) => res.json({ status: "online", authenticated: true, user_id: req.userConfig.user_id }));
router.get('/v1', (req, res) => res.json({ status: "online", version: "v1", authenticated: true }));
router.get('/models', (req, res) => res.json(MODELS_LIST));
router.get('/v1/models', (req, res) => res.json(MODELS_LIST));

router.post('/chat/completions', async (req, res) => {
    req.url = '/v1/chat/completions';
    return router.handle(req, res);
});

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
        const { 
            name, 
            provider, 
            text_provider, text_model, 
            voice_provider, voice_model, 
            image_provider, image_model,
            embed_provider, embed_model
        } = req.body || {};

        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }

        // Build dynamic update query to only update provided fields
        const fields = [];
        const values = [name];
        let paramIdx = 2;

        const updateFields = {
            provider,
            text_provider, text_model, text_fallback_model: req.body.text_fallback_model,
            voice_provider, voice_model, voice_fallback_model: req.body.voice_fallback_model,
            image_provider, image_model, image_fallback_model: req.body.image_fallback_model,
            embed_provider, embed_model
        };

        for (const [key, val] of Object.entries(updateFields)) {
            if (val !== undefined) {
                fields.push(`${key} = $${paramIdx++}`);
                values.push(val);
            }
        }

        if (fields.length === 0) {
            return res.json({ success: true, message: 'No fields to update' });
        }

        const simpleUpdateQuery = `
            UPDATE engine_configs 
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE name = $1
        `;
        
        await pgClient.query(simpleUpdateQuery, values);
        
        // Clear AI service cache so new configs take effect immediately
        try {
            const aiService = require('../src/services/aiService');
            if (aiService.clearBrandedConfigCache) {
                aiService.clearBrandedConfigCache(name);
            } else if (aiService.clearBrandedEngineCache) {
                await aiService.clearBrandedEngineCache(name);
            }
        } catch (e) {
            console.warn('[API Engine] Failed to clear AI cache:', e.message);
        }

        res.json({ success: true, message: `Configuration updated for ${name}` });
    } catch (err) {
        console.error('[API Engine] Config Update Error:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

// --- UNIFIED DEV API (Text, Image, Voice) ---
router.post('/v1/dev/chat', async (req, res) => {
    try {
        const userConfig = req.userConfig;
        const { messages, model, stream } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array is required' });
        }

        // Determine request type based on content
        let type = 'text';
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.content) {
            if (Array.isArray(lastMessage.content)) {
                if (lastMessage.content.some(c => c.type === 'image_url')) type = 'vision';
            }
        }
        
        // Logic for 50/50 and rotation
        const selectedKey = await keyService.getUnifiedKey(userConfig.user_id, type, model);
        if (!selectedKey) return res.status(503).json({ error: 'No active keys available for your request' });

        // Forward to Provider (Gemini/OpenAI etc)
        // For simplicity, let's assume Gemini for now as per user request
        const providerUrl = selectedKey.provider === 'google' 
            ? `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${selectedKey.api}`
            : null;

        if (!providerUrl) return res.status(400).json({ error: 'Unsupported provider for unified API' });

        // Handle request forwarding...
        // (This would normally be a long implementation, I'll keep it concise for now)
        const response = await axios.post(providerUrl, {
            contents: messages.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
            }))
        });

        // Track usage for payment/50-50
        await keyService.trackUnifiedUsage(selectedKey, userConfig.user_id);

        res.json(response.data);
    } catch (err) {
        console.error('[Unified API Error]', err.message);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

// --- 2. KEY MANAGEMENT (CRUD) ---
// This route is shared between Admin Panel and Developer Page
router.post('/keys', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    
    // Try Admin Secret first
    const adminSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || process.env.ADMIN_PASSWORD;
    try {
        const payload = jwt.verify(token, adminSecret);
        if (payload && payload.role === 'admin') {
            req.isAdmin = true;
            req.admin = payload;
            return next();
        }
    } catch (e) {
        // Not an admin token or invalid secret
    }

    // Try Regular User Auth
    authMiddleware(req, res, next);
}, async (req, res) => {
    try {
        const { api, provider, model, email, gmail, mode, owner_id } = req.body;
        if (!api || !provider) return res.status(400).json({ error: "API Key and Provider required" });
        
        const trimmedApi = api.trim();
        
        // 1. Determine and Sanitize owner_id
        let finalOwnerId = (req.user && req.user.id) ? req.user.id : owner_id;
        
        // Validation: Ensure it looks like a UUID if it's not null
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof finalOwnerId === 'string' && !uuidRegex.test(finalOwnerId)) {
            finalOwnerId = null; // Fallback to null if not a valid UUID
        } else if (!finalOwnerId || finalOwnerId === 'undefined' || finalOwnerId === 'null') {
            finalOwnerId = null;
        }

        const finalMode = (req.admin && req.admin.role === 'admin') ? (mode || 'admin') : 'dev';

        // 2. Add or Update API Key (UPSERT logic in dbService)
        await dbService.addApiKey({ 
            api: trimmedApi, 
            provider: provider.trim(), 
            model: model || 'default', 
            email: email || null,
            gmail: gmail || null,
            mode: finalMode,
            owner_id: finalOwnerId
        });
        await keyService.updateKeyCache(true); // Force Refresh
        res.json({ success: true, message: "Key saved successfully" });
    } catch (error) {
        console.error('[API Engine] Error adding key:', error);
        res.status(500).json({ 
            error: error.message, 
            details: 'Failed to add key to database. Please ensure all required fields are correct.' 
        });
    }
});

// GET /keys - List keys owned by the user (or all if admin)
router.get('/keys', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    
    // Try Admin Secret first
    const adminSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || process.env.ADMIN_PASSWORD;
    try {
        const payload = jwt.verify(token, adminSecret);
        if (payload && payload.role === 'admin') {
            req.isAdmin = true;
            req.admin = payload;
            return next();
        }
    } catch (e) {
        // Not an admin token or invalid secret
    }

    // Try Regular User Auth
    authMiddleware(req, res, next);
}, async (req, res) => {
    try {
        let queryStr = 'SELECT id, provider, api, model, status, usage_today, created_at, gmail FROM api_list';
        let params = [];

        if (!req.isAdmin) {
            queryStr += ' WHERE owner_id = $1::uuid';
            params = [req.user.id];
        }
        
        queryStr += ' ORDER BY created_at DESC';
        
        const { rows } = await pgClient.query(queryStr, params);
        
        // Mask API keys for safety if not admin
        const maskedRows = rows.map(row => ({
            ...row,
            api: req.isAdmin ? row.api : (row.api ? `${row.api.substring(0, 8)}...${row.api.substring(row.api.length - 4)}` : null)
        }));

        res.json({ success: true, keys: maskedRows });
    } catch (error) {
        console.error('[API Engine] Error listing keys:', error);
        res.status(500).json({ 
            error: error.message,
            details: 'Failed to fetch keys from database.'
        });
    }
});

// DELETE /keys/:id - Delete a key owned by the user (or any if admin)
router.delete('/keys/:id', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    
    // Try Admin Secret first
    const adminSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || process.env.ADMIN_PASSWORD;
    try {
        const payload = jwt.verify(token, adminSecret);
        if (payload && payload.role === 'admin') {
            req.isAdmin = true;
            req.admin = payload;
            return next();
        }
    } catch (e) {
        // Not an admin token or invalid secret
    }

    // Try Regular User Auth
    authMiddleware(req, res, next);
}, async (req, res) => {
    try {
        const id = req.params.id;
        let queryStr = 'DELETE FROM api_list WHERE id = $1';
        let params = [id];

        if (!req.isAdmin) {
            queryStr += ' AND owner_id = $2::uuid';
            params.push(req.user.id);
        }

        const result = await pgClient.query(queryStr, params);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Key not found or unauthorized" });
        }

        await keyService.updateKeyCache(true);
        res.json({ success: true, message: "Key deleted successfully" });
    } catch (error) {
        console.error('[API Engine] Error deleting key:', error);
        res.status(500).json({ 
            error: error.message,
            details: 'Failed to delete key from database.'
        });
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

router.delete('/keys/bulk', adminAuthMiddleware, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid ids' });
        }
        await dbService.deleteApiKeys(ids);
        await keyService.updateKeyCache(true);
        res.json({ success: true, message: `${ids.length} keys removed` });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
router.post('/v1/chat/completions', async (req, res) => {
    const userConfig = req.userConfig;

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
    const isBranded = model.startsWith('salesmanchatbot-');
    const isVision = imageUrls.length > 0;
    const isAudio = audioUrls.length > 0;

    // Determine if proxy should be used (Only for branded models)
    const useProxyForThisRequest = isBranded || req.body.is_system_engine === true;

    if (isBranded) {
        try {
            // Branded models resolution logic
            const mockConfig = { chat_model: model, cheap_engine: true };
            const resolved = await aiService.resolveSalesmanchatbotEngine(mockConfig, 'salesmanchatbot', model, isVision, isAudio);
            
            // Special Logic for salesmanchatbot-brain: Force Google Gemini if specified as "brain"
            if (model === 'salesmanchatbot-brain') {
                provider = 'google'; 
                modelToUse = resolved.finalModel; // Take model name from resolved config (Frontend managed)
                console.log(`[API Engine] 🧠 Brain Engine -> Forcing Google/Gemini Provider (Model: ${modelToUse})`);
            } else {
                provider = resolved.finalProvider;
                modelToUse = resolved.finalModel;
            }
            
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

    // --- NEW: Add Safety Settings for Gemini (Google) ---
    if (provider === 'google' || provider === 'gemini') {
        req.body.safetySettings = [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
        ];
    }

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
                // Smart Routing from Key Pool
                const modality = 'text'; // API Engine is mostly text-based chat
                const keyData = await keyService.getSmartKey(provider, modelToUse, modality);
                if (!keyData) break;

                // Proxy only for branded engines to save costs and avoid 429/400 errors for direct keys
                let agent = undefined;
                if (useProxyForThisRequest) {
                    const proxyUrl = getProxyUrl(model);
                    if (!proxyUrl) throw new Error("STRICT PROXY: Branded Engine requires proxy.");
                    agent = new HttpsProxyAgent(proxyUrl);
                    if (agent) {
                        console.log(`[API Engine] 🌐 Using Bright Data Proxy for Branded Engine: ${model}`);
                        // ... log IP ...
                    }
                }

                const headers = {
                    'Content-Type': 'application/json'
                };
                if (provider === 'google' || provider === 'gemini') {
                    headers['x-goog-api-key'] = keyData.key;
                } else {
                    headers['Authorization'] = `Bearer ${keyData.key}`;
                }

                const response = await axios.post(targetUrl, req.body, {
                    headers: headers,
                    httpsAgent: agent,
                    httpAgent: agent,
                    proxy: false, // Important for HttpsProxyAgent
                    responseType: 'stream',
                    timeout: 60000,
                    validateStatus: () => true
                });

                // Measure Bandwidth
                const reqKB = Buffer.byteLength(JSON.stringify(req.body || {})) / 1024;
                let resKB = 0;
                console.log(`[Bandwidth Tracker] Request: ${reqKB.toFixed(2)}KB | Session: ${model}`);

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
                if (firstChunk) {
                    res.write(firstChunk);
                    resKB += Buffer.byteLength(firstChunk) / 1024;
                }
                
                response.data.on('data', (chunk) => {
                    resKB += Buffer.byteLength(chunk) / 1024;
                });

                response.data.on('end', () => {
                    console.log(`[Bandwidth Tracker] Response: ${resKB.toFixed(2)}KB | Total: ${(reqKB + resKB).toFixed(2)}KB | Session: ${model}`);
                });

                response.data.pipe(res);

                // Deduct balance for streaming (Flat rate)
                const cost = await dbService.getCostForModel(model);
                dbService.deductUserBalance(userConfig.user_id, cost, `API Engine Stream: ${model}`).catch(() => {});
                dbService.logApiUsage(userConfig.user_id, model, 0, cost, 'api_engine');

                return;
            }

            const status = 502;
            return res.status(status).json({ error: lastError || 'stream_failed' });
        }

        // Smart Routing from Key Pool
        const modality = 'text'; // API Engine is mostly text-based chat
        const keyData = await keyService.getSmartKey(provider, modelToUse, modality);
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

    // Proxy ONLY for branded engines to save costs and avoid 429/400 errors for direct keys
    let agent = undefined;
    if (useProxyForThisRequest) {
        const proxyUrl = getProxyUrl(model); 
        if (!proxyUrl) throw new Error("STRICT PROXY: Branded Engine requires proxy.");
        agent = new HttpsProxyAgent(proxyUrl);
        if (agent) {
            console.log(`[API Engine] 🌐 Using Bright Data Proxy for Branded Engine: ${model}`);
            // ... log IP ...
        }
    }

        const headers = {
            'Content-Type': 'application/json'
        };
        if (provider === 'google' || provider === 'gemini') {
            headers['x-goog-api-key'] = keyData.key;
        } else {
            headers['Authorization'] = `Bearer ${keyData.key}`;
        }

        const response = await axios.post(targetUrl, req.body, {
            headers: headers,
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false, // Important for HttpsProxyAgent
            responseType: 'json',
            timeout: 60000
        });

        if (response.data?.usage) {
            keyService.recordKeyUsage(keyData.key, response.data.usage.total_tokens);
            
            // Deduct User Balance
            const cost = await dbService.getCostForModel(model);
            dbService.deductUserBalance(userConfig.user_id, cost, `API Engine Call: ${model}`)
                .catch(err => console.error(`[API Engine] Balance deduction failed:`, err.message));
            dbService.logApiUsage(userConfig.user_id, model, response.data.usage.total_tokens, cost, 'api_engine');
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
                    const modality = 'text'; // API Engine is mostly text-based chat
                    await keyService.handleApiKeyError(token, error.response?.data?.error?.message || error.message, requestedModel, modality);
                }
            }
        }

        res.status(status).json(error.response?.data || { error: error.message });
    }
});

// --- NEW: EMBEDDINGS SUPPORT (For Vector DB) ---
router.post('/v1/embeddings', async (req, res) => {
    try {
        const userConfig = req.userConfig;

        const { model, input } = req.body;
        if (!model || !input) return res.status(400).json({ error: "Missing model or input" });

        let provider = 'google';
        let modelToUse = model;

        if (model.includes('/')) provider = 'openrouter';

        const isBranded = model.startsWith('salesmanchatbot-');
        const useProxyForThisRequest = isBranded;

        if (isBranded) {
             try {
                 // Branded models resolution logic
                 const mockConfig = { chat_model: model, cheap_engine: true };
                 // Dynamic require as aiService is not defined at the top level
                 const aiService = require('../src/services/aiService');
                 const resolved = await aiService.resolveSalesmanchatbotEngine(mockConfig, 'salesmanchatbot', model, false, false, true);
                 
                 // For 'brain', we prefer Gemini's embedding model if it's forced to google
                 if (model === 'salesmanchatbot-brain') {
                     provider = 'google';
                     modelToUse = resolved.finalModel || 'text-embedding-004'; 
                 } else {
                     provider = resolved.finalProvider || 'google';
                     modelToUse = resolved.finalModel || 'text-embedding-004';
                 }
             } catch (e) {
                 provider = 'google';
                 modelToUse = 'text-embedding-004';
             }
         }

        // Smart Routing from Key Pool
        const keyData = await keyService.getSmartKey(provider, modelToUse, 'text');
        if (!keyData) return res.status(429).json({ error: "No active embedding keys available." });

        let targetUrl = '';
        let headers = { 'Content-Type': 'application/json' };
        let payload = {};

        if (provider === 'google' || provider === 'gemini') {
            // Check if model name already includes the prefix, if not add it
            const fullModelName = modelToUse.startsWith('models/') ? modelToUse : `models/${modelToUse}`;
            targetUrl = `https://generativelanguage.googleapis.com/v1beta/${fullModelName}:embedContent?key=${keyData.key}`;
            headers['x-goog-api-key'] = keyData.key;
            payload = { content: { parts: [{ text: typeof input === 'string' ? input : input[0] }] } };
        } else if (provider === 'openrouter') {
            targetUrl = 'https://openrouter.ai/api/v1/embeddings';
            headers['Authorization'] = `Bearer ${keyData.key}`;
            payload = { model: modelToUse, input: input };
        } else {
            targetUrl = 'https://api.openai.com/v1/embeddings';
            headers['Authorization'] = `Bearer ${keyData.key}`;
            payload = { model: modelToUse, input: input };
        }

        let agent = undefined;
        if (useProxyForThisRequest) {
            const proxyUrl = getProxyUrl(model);
            if (proxyUrl) agent = new HttpsProxyAgent(proxyUrl);
        }

        const response = await axios.post(targetUrl, payload, {
            headers,
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false,
            timeout: 30000
        });

        // Map Gemini response to OpenAI format if needed
        if (provider === 'google' || provider === 'gemini') {
            const embedding = response.data.embedding.values;
            res.json({
                object: "list",
                data: [{ object: "embedding", embedding: embedding, index: 0 }],
                model: modelToUse,
                usage: { prompt_tokens: 0, total_tokens: 0 }
            });
        } else {
            res.json(response.data);
        }

        // Record usage (minimal for embeddings)
        keyService.recordKeyUsage(keyData.key, 1);

    } catch (error) {
        console.error(`[API Engine] Embedding Error:`, error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
});

module.exports = router;
