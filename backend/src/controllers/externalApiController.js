const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const liteEngineService = require('../services/liteEngineService');
const openrouterEngineService = require('../services/openrouterEngineService');
const keyService = require('../services/keyService');
const axios = require('axios');
const crypto = require('crypto');

const pgClient = require('../services/pgClient');

// Helper to validate API Key and return user config
const validateApiKey = async (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn(`[ExternalAPI] Missing or invalid Authorization header: ${authHeader ? 'Exists but no Bearer' : 'Missing'}`);
        return { error: { status: 401, message: 'Missing or invalid Authorization header', type: 'invalid_request_error', code: 'unauthorized' } };
    }

    const apiKey = authHeader.replace('Bearer ', '').trim();

    // Check if key is actually provided after 'Bearer '
    if (!apiKey) {
        return { error: { status: 401, message: 'Invalid API Key format', type: 'invalid_request_error', code: 'invalid_api_key' } };
    }

    let userConfig = null;

    try {
        const result = await pgClient.query(
            'SELECT user_id, balance, service_api_key, api_key FROM user_configs WHERE service_api_key = $1 LIMIT 1',
            [apiKey]
        );

        if (result.rows.length > 0) {
            userConfig = result.rows[0];
        }
    } catch (error) {
        console.error(`[ExternalAPI] Database Error for Key: ${apiKey.substring(0, 8)}...`, error);
        return { error: { status: 500, message: 'Internal Database Error', type: 'api_error' } };
    }

    if (!userConfig) {
        console.warn(`[ExternalAPI] Auth Failed - Key not found in DB: ${apiKey.substring(0, 8)}...`);
        return { error: { status: 401, message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } };
    }

    return { userConfig };
};

// Helper to clean AI response text (removes JSON structures if they appear)
const cleanAiText = (text) => {
    if (!text) return "";
    
    // 1. Try to parse as direct JSON
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed.reply || parsed.text || parsed.message || text;
        }
    } catch (e) {
        // Not direct JSON, continue
    }

    // 2. Look for JSON-like structure with "reply": "..."
    const replyMatch = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (replyMatch && replyMatch[1]) {
        // Unescape the captured string
        try {
            return JSON.parse(`"${replyMatch[1]}"`);
        } catch (e) {
            return replyMatch[1];
        }
    }

    // 3. Remove markdown code blocks if they wrap the whole thing
    let cleaned = text.trim();
    if (cleaned.startsWith("```") && cleaned.endsWith("```")) {
        cleaned = cleaned.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "").trim();
        // Recurse once if we found a code block
        return cleanAiText(cleaned);
    }

    return text;
};

const getUpstreamTargetUrl = (provider) => {
    if (provider === 'openai') return 'https://api.openai.com/v1/chat/completions';
    if (provider === 'groq') return 'https://api.groq.com/openai/v1/chat/completions';
    if (provider === 'mistral') return 'https://api.mistral.ai/v1/chat/completions';
    if (provider === 'anthropic') return 'https://api.anthropic.com/v1/messages';
    if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
    return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
};

const buildUpstreamHeaders = (provider, apiKey) => {
    // USE THE ADVANCED STEALTH HEADERS FROM AISERVICE
    return aiService.getStealthHeaders(apiKey, provider);
};

// Helper to normalize payload for upstream providers (especially Google OpenAI Compatibility)
const normalizeUpstreamPayload = (provider, model, body) => {
    let normalizedModel = model;
    
    // 1. Clean Model Name for Google/Gemini
    if (provider === 'google' || provider === 'gemini') {
        // Remove 'google/' or 'gemini/' prefix if present
        normalizedModel = normalizedModel.replace(/^(google|gemini)\//, '');
    }

    // 2. Normalize Messages (Keep only role and content to prevent 400 errors)
    const messages = (body.messages || []).map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    return {
        ...body,
        model: normalizedModel,
        messages: messages
    };
};

const isRetryableUpstreamStatus = (status) => {
    return status === 401 || status === 403 || status === 429 || status >= 500;
};

const getFailureDetails = (failure) => {
    if (!failure) return 'unknown_error';
    if (failure.response?.data?.error?.message) return failure.response.data.error.message;
    if (failure.response?.data?.error) return failure.response.data.error;
    if (failure.data?.error?.message) return failure.data.error.message;
    if (failure.data?.error) return failure.data.error;
    if (failure.message) return failure.message;
    if (failure.status) return `Upstream status ${failure.status}`;
    return String(failure);
};

exports.handleChatCompletion = async (req, res) => {
    try {
        // 1. Validate API Key & Fetch User Config
        const { userConfig, error: authError } = await validateApiKey(req);
        if (authError) {
            return res.status(authError.status).json({ error: { message: authError.message, type: authError.type, code: authError.code } });
        }

        // 2. Parse Request (OpenAI Format) - MOVED UP for access to 'stream' and 'model'
        const { messages, model, stream, user: externalUser } = req.body;
        const requestedModel = model || 'salesmanchatbot-pro';
        const isBranded = requestedModel.startsWith('salesmanchatbot-');

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: { message: 'messages array is required', type: 'invalid_request_error' } });
        }

        let systemPrompt = null;
        let history = [];
        let userMessage = "";
        let imageUrls = [];
        let audioUrls = [];

        // Parse messages to get image/audio URLs for resolution
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            let contentText = "";
            if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') contentText += part.text || "";
                    else if (part.type === 'image_url') {
                        const url = part.image_url?.url || part.image_url;
                        if (url && i === messages.length - 1 && msg.role === 'user') imageUrls.push(url);
                    } else if (part.type === 'audio_url') {
                        const url = part.audio_url?.url || part.audio_url;
                        if (url && i === messages.length - 1 && msg.role === 'user') audioUrls.push(url);
                    }
                }
            } else {
                contentText = msg.content || "";
            }
            if (msg.role === 'system') systemPrompt = contentText;
            else if (i === messages.length - 1 && msg.role === 'user') userMessage = contentText;
            else history.push({ role: msg.role, content: contentText });
        }

        // 3. Free Tier Logic (Lifetime 20 requests if balance is low)
        let freeTierActive = false;
        try {
            const pgClient = require('../services/pgClient');
            const countResult = await pgClient.query(
                'SELECT COUNT(*)::int AS cnt FROM api_usage_stats WHERE user_id = $1::uuid',
                [userConfig.user_id]
            );
            const totalCount = countResult.rows.length > 0 ? (countResult.rows[0].cnt || 0) : 0;
            if (Number(userConfig.balance) < 0.01 && totalCount < 20) {
                freeTierActive = true;
            }
        } catch (e) {
            console.error("[ExternalAPI] Free tier check error:", e.message);
        }

        // 4. Resolve Provider & Model
        let provider = 'google';
        let modelToUse = requestedModel;
        let fallbackModel = null;
        const modality = audioUrls.length > 0 ? 'voice' : (imageUrls.length > 0 ? 'vision' : 'text');

        if (isBranded) {
            try {
                // Developer API reuses the same branded resolution logic as the internal engine,
                // but still stays isolated to user-owned keys only.
                const resolved = await aiService.resolveSalesmanchatbotEngine({ chat_model: requestedModel }, 'salesmanchatbot', requestedModel, imageUrls.length > 0, audioUrls.length > 0);
                provider = resolved.finalProvider;
                modelToUse = resolved.finalModel;
                fallbackModel = resolved.fallbackModel || null;
                console.log(`[ExternalAPI] Resolved ${requestedModel} -> ${provider}/${modelToUse}${fallbackModel ? ` (fallback: ${fallbackModel})` : ''}`);
            } catch (e) {
                console.error(`[ExternalAPI] Resolution failed for ${requestedModel}:`, e.message);
                return res.status(500).json({
                    error: {
                        message: `Developer API model resolution failed for ${requestedModel}`,
                        type: 'api_error',
                        code: 'engine_resolution_failed',
                        details: e.message
                    }
                });
            }
        } else {
            // Non-branded models (Fallback or direct)
            if (requestedModel.includes('gpt')) provider = 'openai';
            else if (requestedModel.includes('mistral')) provider = 'mistral';
            else if (requestedModel.includes('llama') || requestedModel.includes('mixtral')) provider = 'groq';
            else if (requestedModel.includes('claude')) provider = 'anthropic';
            else if (requestedModel.includes('gemini') || requestedModel.includes('google')) provider = 'google';
        }

        const modelsToTry = [modelToUse];
        if (fallbackModel && fallbackModel !== modelToUse) {
            modelsToTry.push(fallbackModel);
        }

        // 5. Check Balance (Optional: if you still want to charge for using the system logic/platform)
        if (!freeTierActive) {
            if (userConfig.balance < 0.01) {
                return res.status(402).json({ error: { message: `Insufficient balance. Minimum 0.01 BDT required.`, type: 'insufficient_quota', code: 'insufficient_balance' } });
            }
        }

        // 6. Check for API Keys (Personal Pool or Single Key) - MANDATORY for Developer API
        let hasUserPoolKeys = false;
        try {
            const pgClient = require('../services/pgClient');
            const poolCheck = await pgClient.query(
                "SELECT COUNT(*)::int as count FROM api_list WHERE owner_id = $1::uuid AND status = 'active'",
                [userConfig.user_id]
            );
            hasUserPoolKeys = poolCheck.rows[0].count > 0;
        } catch (e) {
            console.error("[ExternalAPI] Pool check error:", e.message);
        }

        const hasSingleKey = userConfig.api_key && userConfig.api_key.trim() !== '';

        if (!hasUserPoolKeys && !hasSingleKey) {
            return res.status(200).json({ 
                id: `err-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: requestedModel,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: "no api key founds"
                        },
                        finish_reason: "stop"
                    }
                ],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            });
        }

        // --- COMMON LOGIC: Fetch Key & Prepare Request ---
        const maxAttemptsPerModel = 3;
        let lastError = null;
        const targetUrl = getUpstreamTargetUrl(provider);

        // --- STREAMING PATH ---
        if (stream === true || req.headers.accept === 'text/event-stream') {
            console.log(`[ExternalAPI] Streaming request for model: ${requestedModel}`);

            for (const currentModel of modelsToTry) {
                for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
                    let keyData = await keyService.getSmartKey(provider, currentModel, modality, true, userConfig.user_id);
                    if (!keyData && hasSingleKey) keyData = { key: userConfig.api_key, provider, model: currentModel };

                    if (!keyData || !keyData.key) {
                        lastError = { message: `No active ${provider} keys found for ${currentModel}.` };
                        break;
                    }

                    await aiService.acquireAiSlot(); // --- CONCURRENCY CONTROL ---
                    try {
                        // --- STEALTH: REQUEST JITTER ---
                        const jitter = Math.floor(Math.random() * 1500) + 500;
                        await new Promise(resolve => setTimeout(resolve, jitter));

                        const proxyUrl = aiService.getProxyUrl(currentModel);
                        const agent = aiService.createProxyAgent(proxyUrl);

                        const upstreamPayload = normalizeUpstreamPayload(provider, currentModel, req.body);
                        const response = await axios.post(targetUrl, upstreamPayload, {
                            headers: buildUpstreamHeaders(provider, keyData.key),
                            timeout: 120000,
                            responseType: 'stream',
                            validateStatus: () => true,
                            ...(agent ? { httpAgent: agent, httpsAgent: agent } : {})
                        });

                        if (response.status >= 400) {
                            console.error(`[ExternalAPI] Stream Upstream Error (${response.status}) for ${currentModel}`);
                            aiService.releaseAiSlot();
                            lastError = { status: response.status, data: "Stream Error", model: currentModel };
                            await keyService.handleApiKeyError(keyData.key, `status code ${response.status}`, currentModel, modality);
                            if (isRetryableUpstreamStatus(response.status)) continue;
                            break;
                        }

                        res.setHeader('Content-Type', response.headers['content-type'] || 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');
                        
                        // Handle stream errors to prevent hanging
                        response.data.on('error', (err) => {
                            console.error(`[ExternalAPI] Stream error for ${currentModel}:`, err.message);
                            aiService.releaseAiSlot();
                            if (!res.headersSent) res.status(500).end();
                            else res.end();
                        });

                        response.data.on('end', () => aiService.releaseAiSlot());

                        response.data.pipe(res);

                        if (!freeTierActive) {
                            const cost = await dbService.getCostForModel(requestedModel);
                            dbService.deductUserBalance(userConfig.user_id, cost, `Stream: ${requestedModel}`).catch(() => {});
                            dbService.logApiUsage(userConfig.user_id, requestedModel, 0, cost, 'external_api');
                        }
                        return;
                    } catch (err) {
                        aiService.releaseAiSlot();
                        console.error(`[ExternalAPI] Stream Attempt ${attempt + 1} failed for ${currentModel}:`, err.message);
                        lastError = err;
                        await keyService.handleApiKeyError(keyData.key, err, currentModel, modality);
                        if (isRetryableUpstreamStatus(err.response?.status)) continue;
                        break;
                    }
                }
            }
            return res.status(502).json({ error: { message: "Stream failed or no keys available", details: getFailureDetails(lastError) } });
        }

        // --- NON-STREAMING RAW API PATH ---
        console.log(`[ExternalAPI] Non-streaming request for model: ${requestedModel} (User Pool Keys: ${hasUserPoolKeys})`);

        for (const currentModel of modelsToTry) {
            console.log(`[ExternalAPI] Non-streaming try for resolved model: ${currentModel}`);
            for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
                let keyData = await keyService.getSmartKey(provider, currentModel, modality, false, userConfig.user_id);

                if (!keyData && hasSingleKey) {
                    keyData = { key: userConfig.api_key, provider, model: currentModel };
                }

                if (!keyData || !keyData.key) {
                    lastError = { message: `No active ${provider} keys found for ${currentModel}.` };
                    break;
                }

                await aiService.acquireAiSlot(); // --- CONCURRENCY CONTROL ---
                try {
                    // --- STEALTH: REQUEST JITTER ---
                    const jitter = Math.floor(Math.random() * 1500) + 500;
                    await new Promise(resolve => setTimeout(resolve, jitter));

                    const proxyUrl = aiService.getProxyUrl(currentModel);
                    const agent = aiService.createProxyAgent(proxyUrl);

                    const upstreamPayload = normalizeUpstreamPayload(provider, currentModel, req.body);
                    const response = await axios.post(targetUrl, upstreamPayload, {
                        headers: buildUpstreamHeaders(provider, keyData.key),
                        timeout: 120000,
                        validateStatus: () => true,
                        ...(agent ? { httpAgent: agent, httpsAgent: agent } : {})
                    });

                    aiService.releaseAiSlot();

                    if (response.status >= 400) {
                        console.error(`[ExternalAPI] Upstream Error (${response.status}) for ${currentModel}:`, JSON.stringify(response.data));
                        lastError = { status: response.status, data: response.data, model: currentModel };
                        await keyService.handleApiKeyError(keyData.key, `status code ${response.status}`, currentModel, modality);
                        if (isRetryableUpstreamStatus(response.status)) continue;
                        break;
                    }

                    const data = response.data;
                    if (data.model) data.model = requestedModel;

                    const tokens = data.usage?.total_tokens || 0;
                    if (keyData.key && tokens > 0) {
                        await keyService.recordKeyUsage(keyData.key, tokens);
                    }

                    if (!freeTierActive) {
                        const cost = await dbService.getCostForModel(requestedModel);
                        await dbService.deductUserBalance(userConfig.user_id, cost, `API: ${requestedModel} (${tokens} tokens)`);
                        await dbService.logApiUsage(userConfig.user_id, requestedModel, tokens, cost, 'external_api');
                    }

                    return res.json(data);
                } catch (err) {
                    console.error(`[ExternalAPI] Attempt ${attempt + 1} failed for ${currentModel}:`, err.message);
                    lastError = err;
                    await keyService.handleApiKeyError(keyData.key, err, currentModel, modality);
                    if (isRetryableUpstreamStatus(err.response?.status)) continue;
                    break;
                }
            }
        }

        return res.status(502).json({ error: { message: "API request failed or no keys available", details: getFailureDetails(lastError) } });

    } catch (error) {
        console.error('[ExternalAPI] Error:', error);
        const branded = aiService.formatBrandedError(error);
        return res.status(branded.code).json({ 
            error: { 
                message: branded.message, 
                type: branded.type, 
                code: branded.code 
            } 
        });
    }
};

exports.listModels = async (req, res) => {
    try {
        // Optional: Validate API Key for discovery if we want to restrict connection to valid users only.
        // n8n will call this to verify the connection.
        const { userConfig, error } = await validateApiKey(req);
        if (error) {
            // Some tools might try to list models without a key first.
            // But for OpenAI compatibility, a key is usually required.
            return res.status(error.status).json({ error: { message: error.message, type: error.type, code: error.code } });
        }

        return res.json({
            object: "list",
            data: [
                { id: "salesmanchatbot-pro", object: "model", created: 1677610602, owned_by: "salesman", permission: [] },
                { id: "salesmanchatbot-flash", object: "model", created: 1709251200, owned_by: "salesman", permission: [] },
                { id: "salesmanchatbot-lite", object: "model", created: 1709251200, owned_by: "salesman", permission: [] }
            ]
        });
    } catch (error) {
        console.error('[ExternalAPI] Error:', error);
        const branded = aiService.formatBrandedError(error);
        return res.status(branded.code).json({ 
            error: { 
                message: branded.message, 
                type: branded.type, 
                code: branded.code 
            } 
        });
    }
};

exports.transcribeAudio = async (req, res) => {
    try {
        const { userConfig, error } = await validateApiKey(req);
        if (error) return res.status(error.status).json({ error });

        // Check Balance (Minimal)
        if (userConfig.balance < 0.001) {
            return res.status(402).json({ error: { message: `Insufficient balance. Minimum 0.001 BDT required.`, type: 'insufficient_quota', code: 'insufficient_balance' } });
        }

        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: { message: 'Missing audio URL', type: 'invalid_request_error' } });
        }

        console.log(`[ExternalAPI] Transcribing Audio for User ${userConfig.user_id}...`);
        
        // Use LiteEngine (Groq Whisper)
        const cost = await dbService.getCostForModel('salesmanchatbot-lite');

        let transcription = "";
        try {
            transcription = await liteEngineService.transcribeAudio(url);
        } catch (e) {
            console.error('[ExternalAPI] Transcription Failed:', e.message);
            return res.status(500).json({ error: { message: 'Transcription Failed', details: e.message } });
        }

        // Deduct Balance
        await dbService.deductUserBalance(userConfig.user_id, cost, `Audio Transcription`);
        
        // Log Usage
        await dbService.logApiUsage(userConfig.user_id, 'salesmanchatbot-lite', 1, cost, 'external_api');

        res.json({ text: transcription });

    } catch (error) {
        console.error('[ExternalAPI] Audio Error:', error);
        const branded = aiService.formatBrandedError(error);
        return res.status(branded.code).json({ 
            error: { 
                message: branded.message, 
                type: branded.type, 
                code: branded.code 
            } 
        });
    }
};

exports.getApiKey = async (req, res) => {
    try {
        const userId = req.user?.id; 
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        
        const pgClient = require('../services/pgClient');
        
        // Check if table user_configs exists
        const tableCheck = await pgClient.query(
            "SELECT tablename FROM pg_catalog.pg_tables WHERE tablename = 'user_configs'"
        );
        if (tableCheck.rows.length === 0) {
            console.warn("[FetchKey] Table user_configs does not exist yet");
            return res.json({ api_key: null });
        }

        // Check if service_api_key column exists
        const columnCheck = await pgClient.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='user_configs' AND column_name='service_api_key'"
        );
        if (columnCheck.rows.length === 0) {
            console.warn("[FetchKey] service_api_key column missing in user_configs");
            return res.json({ api_key: null });
        }

        const result = await pgClient.query(
            'SELECT user_id, balance, service_api_key FROM user_configs WHERE user_id = $1::uuid LIMIT 1',
            [userId]
        );
        
        // If no config exists, we should probably return null instead of 404
        if (result.rows.length === 0) {
            return res.json({ api_key: null });
        }

        const row = result.rows[0];
        res.json({ api_key: row.service_api_key || null });
    } catch (error) {
        console.error("Fetch Key Exception:", error);
        res.status(500).json({ error: "Failed to fetch API key", details: error.message });
    }
};

exports.regenerateApiKey = async (req, res) => {
    try {
        const userId = req.user?.id;
        console.log(`[KeyGen] Request received for user: ${userId}`);

        if (!userId) {
            console.warn(`[KeyGen] Unauthorized access attempt`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const newKey = 'salesmanchatbot-' + crypto.randomBytes(24).toString('hex');
        console.log(`[KeyGen] Generating new key for user: ${userId}`);

        const pgClient = require('../services/pgClient');

        // Check if config exists
        const checkRes = await pgClient.query(
            'SELECT id FROM user_configs WHERE user_id = $1::uuid LIMIT 1',
            [userId]
        );

        if (checkRes.rows.length === 0) {
            // Create new config
            // Use req.user.email if available, or fetch from users table
            let email = req.user?.email;
            if (!email) {
                const userRes = await pgClient.query('SELECT email FROM users WHERE id = $1::uuid', [userId]);
                email = userRes.rows[0]?.email || 'dev@salesmanchatbot.online';
            }

            await pgClient.query(
                'INSERT INTO user_configs (user_id, email, service_api_key, balance) VALUES ($1::uuid, $2, $3, 0)',
                [userId, email, newKey]
            );
        } else {
            // Update existing
            await pgClient.query(
                'UPDATE user_configs SET service_api_key = $1 WHERE user_id = $2::uuid',
                [newKey, userId]
            );
        }

        res.json({ success: true, api_key: newKey });
    } catch (error) {
        console.error("[KeyGen] Error:", error);
        res.status(500).json({ error: "Failed to generate key", details: error.message });
    }
};

exports.updateUserConfig = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { ai_provider, api_key, model_name } = req.body;
        const pgClient = require('../services/pgClient');

        // Upsert user config
        const query = `
            INSERT INTO user_configs (user_id, email, ai_provider, api_key, model_name)
            VALUES ($1::uuid, $2, $3, $4, $5)
            ON CONFLICT (user_id)
            DO UPDATE SET
                ai_provider = COALESCE(EXCLUDED.ai_provider, user_configs.ai_provider),
                api_key = COALESCE(EXCLUDED.api_key, user_configs.api_key),
                model_name = COALESCE(EXCLUDED.model_name, user_configs.model_name),
                email = COALESCE(EXCLUDED.email, user_configs.email),
                updated_at = NOW()
            RETURNING *
        `;

        const values = [userId, req.user.email, ai_provider, api_key, model_name];
        const result = await pgClient.query(query, values);

        res.json({ success: true, config: result.rows[0] });
    } catch (error) {
        console.error("Update User Config Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getUserConfig = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const pgClient = require('../services/pgClient');
        const result = await pgClient.query(
            'SELECT ai_provider, api_key, model_name FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.json({});
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Get User Config Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getUsageStats = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { startDate, endDate } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const pgClient = require('../services/pgClient');

        // Robust check if table exists
        const tableCheck = await pgClient.query(
            "SELECT tablename FROM pg_catalog.pg_tables WHERE tablename = 'api_usage_stats'"
        );

        if (tableCheck.rows.length === 0) {
            console.warn("[UsageStats] Table api_usage_stats does not exist yet");
            return res.json({ 
                stats: [],
                pagination: { total_records: 0, total_pages: 1, current_page: page, limit: limit },
                summary: { total_cost: 0, total_tokens: 0, total_requests: 0, today_cost: 0, today_tokens: 0, today_requests: 0, yesterday_cost: 0, yesterday_tokens: 0, yesterday_requests: 0, range_cost: 0, range_tokens: 0, range_requests: 0 }
            });
        }

        // Check for specific columns (cost, tokens) to avoid 500 if migration failed
        const columnCheck = await pgClient.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='api_usage_stats' AND column_name IN ('cost', 'tokens')"
        );
        const hasCost = columnCheck.rows.some(r => r.column_name === 'cost');
        const hasTokens = columnCheck.rows.some(r => r.column_name === 'tokens');

        const selectCols = `id, user_id, model, ${hasTokens ? 'tokens' : '0 as tokens'}, ${hasCost ? 'cost' : '0 as cost'}, created_at`;

        // 1. Fetch Paginated Stats
        const recentResult = await pgClient.query(
            `SELECT ${selectCols}
             FROM api_usage_stats
             WHERE user_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        const stats = recentResult.rows || [];

        // 1.5 Fetch Total Count for Pagination
        const countResult = await pgClient.query(
            'SELECT COUNT(*)::int as total FROM api_usage_stats WHERE user_id = $1::uuid',
            [userId]
        );
        const totalCount = countResult.rows[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        // 2. Calculate Totals
        const totalResult = await pgClient.query(
            `SELECT ${hasCost ? 'cost' : '0 as cost'}, ${hasTokens ? 'tokens' : '0 as tokens'} 
             FROM api_usage_stats WHERE user_id = $1::uuid`,
            [userId]
        );
        const totalRows = totalResult.rows || [];

        const totalCost = totalRows.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
        const totalTokens = totalRows.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
        const totalRequests = totalRows.length;

        // Today's stats
        const today = new Date().toISOString().split('T')[0];
        const todayResult = await pgClient.query(
            `SELECT ${hasCost ? 'cost' : '0 as cost'}, ${hasTokens ? 'tokens' : '0 as tokens'}
             FROM api_usage_stats
             WHERE user_id = $1::uuid
               AND created_at >= $2::timestamptz`,
            [userId, `${today}T00:00:00Z`]
        );
        const todayRows = todayResult.rows || [];
        const todayCost = todayRows.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
        const todayTokens = todayRows.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
        const todayRequests = todayRows.length;

        // Yesterday stats
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yesterday = y.toISOString().split('T')[0];
        const yesterdayResult = await pgClient.query(
            `SELECT ${hasCost ? 'cost' : '0 as cost'}, ${hasTokens ? 'tokens' : '0 as tokens'}
             FROM api_usage_stats
             WHERE user_id = $1::uuid
               AND created_at >= $2::timestamptz
               AND created_at <= $3::timestamptz`,
            [userId, `${yesterday}T00:00:00Z`, `${yesterday}T23:59:59Z`]
        );
        const yesterdayRows = yesterdayResult.rows || [];
        const yesterdayCost = yesterdayRows.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
        const yesterdayTokens = yesterdayRows.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
        const yesterdayRequests = yesterdayRows.length;

        // Range stats
        let rangeCost = 0, rangeTokens = 0, rangeRequests = 0;
        if (startDate && endDate) {
            const rangeResult = await pgClient.query(
                `SELECT ${hasCost ? 'cost' : '0 as cost'}, ${hasTokens ? 'tokens' : '0 as tokens'}
                 FROM api_usage_stats
                 WHERE user_id = $1::uuid
                   AND created_at >= $2::timestamptz
                   AND created_at <= $3::timestamptz`,
                [userId, `${startDate}T00:00:00Z`, `${endDate}T23:59:59Z`]
            );
            const rangeRows = rangeResult.rows || [];
            rangeCost = rangeRows.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
            rangeTokens = rangeRows.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
            rangeRequests = rangeRows.length;
        }

        res.json({ 
            stats,
            pagination: { total_records: totalCount, total_pages: totalPages, current_page: page, limit },
            summary: { total_cost: totalCost, total_tokens: totalTokens, total_requests: totalRequests, today_cost: todayCost, today_tokens: todayTokens, today_requests: todayRequests, yesterday_cost: yesterdayCost, yesterday_tokens: yesterdayTokens, yesterday_requests: yesterdayRequests, range_cost: rangeCost, range_tokens: rangeTokens, range_requests: rangeRequests }
        });
    } catch (error) {
        console.error("[UsageStats] Error:", error);
        res.status(500).json({ error: "Failed to fetch usage statistics", details: error.message });
    }
};
