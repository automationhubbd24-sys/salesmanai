const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const liteEngineService = require('../services/liteEngineService');
const openrouterEngineService = require('../services/openrouterEngineService');
const crypto = require('crypto');

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

    const pgClient = require('../services/pgClient');

    let userConfig = null;

    try {
        const result = await pgClient.query(
            'SELECT user_id, balance, service_api_key FROM user_configs WHERE service_api_key = $1 LIMIT 1',
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

exports.handleChatCompletion = async (req, res) => {
    try {
        // 1. Validate API Key & Fetch User Config
        const { userConfig, error: authError } = await validateApiKey(req);
        if (authError) {
            return res.status(authError.status).json({ error: { message: authError.message, type: authError.type, code: authError.code } });
        }

        // 2. Free Tier Logic (Lifetime 20 requests if balance is low)
        let freeTierActive = false;
        try {
            const pgClient = require('../services/pgClient');
            const countResult = await pgClient.query(
                'SELECT COUNT(*)::int AS cnt FROM api_usage_stats WHERE user_id = $1::uuid',
                [userConfig.user_id]
            );
            const totalCount = countResult.rows.length > 0 ? countResult.rows[0].cnt : 0;
            if (Number(userConfig.balance) < 0.01 && totalCount < 20) {
                freeTierActive = true;
            }
        } catch (e) {
        }

        // 3. Check Balance (skip if free tier active)
        if (!freeTierActive) {
            if (userConfig.balance < 0.01) {
                return res.status(402).json({ error: { message: `Insufficient balance. Minimum 0.01 BDT required.`, type: 'insufficient_quota', code: 'insufficient_balance' } });
            }
        }

        // 4. Process Request (OpenAI Format)
        const { messages, model, stream, user: externalUser } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: { message: 'messages array is required', type: 'invalid_request_error' } });
        }

        let systemPrompt = null;
        let history = [];
        let userMessage = "";
        let imageUrls = [];
        let audioUrls = [];

        // Parse messages
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            let contentText = "";

            // Handle Multimodal Content (Array of objects)
            if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        contentText += part.text || "";
                    } else if (part.type === 'image_url') {
                        const url = part.image_url?.url || part.image_url;
                        if (url) {
                            // If it's the active user message, add to imageUrls for processing
                            if (i === messages.length - 1 && msg.role === 'user') {
                                imageUrls.push(url);
                            } else {
                                contentText += ` [Image] `; 
                            }
                        }
                    } else if (part.type === 'audio_url') {
                        // Custom support for Audio (e.g. { type: "audio_url", audio_url: { url: "..." } })
                        const url = part.audio_url?.url || part.audio_url;
                        if (url) {
                            if (i === messages.length - 1 && msg.role === 'user') {
                                audioUrls.push(url);
                            } else {
                                contentText += ` [Audio] `;
                            }
                        }
                    }
                }
            } else {
                // Standard String Content
                contentText = msg.content || "";
            }

            if (msg.role === 'system') {
                systemPrompt = contentText;
            } else {
                // If it's the last message and it's user, it's the current prompt
                if (i === messages.length - 1 && msg.role === 'user') {
                    userMessage = contentText;
                } else {
                    history.push({ role: msg.role, content: contentText });
                }
            }
        }

        if (!userMessage) {
             return res.status(400).json({ error: { message: 'Last message must be from user', type: 'invalid_request_error' } });
        }

        // 4. ROUTING LOGIC based on Model Name
        let aiText = "";
        let totalTokens = 0;
        const requestedModel = model || 'salesmanchatbot-pro';
        let responseModelName = requestedModel; 
        let billingLabel = "Cheap Engine API Call";

        // --- UNIFIED ENGINE CALL (Using Rotation Pool) ---
        // Ensure Vision requests use a capable model (Gemini 2.0 Flash or 1.5 Flash)
        let modelToUse = requestedModel;
        if (imageUrls.length > 0 || audioUrls.length > 0) {
            // For External API multi-modal requests, force use of a stable vision model
            // but keep the branding in the final response.
            modelToUse = 'salesmanchatbot-pro'; 
        }

        const prompts = systemPrompt ? { text_prompt: systemPrompt } : {};
        
        const aiResponseObj = await aiService.generateReply(
            userMessage,
            { 
                user_id: userConfig.user_id,
                page_id: externalUser || 'ExternalAPI',
                ai_provider: 'salesmanchatbot',
                chat_model: modelToUse, 
                is_external_api: true,
                display_model: requestedModel,
                billing_mode: 'request',
                cheap_engine: false,
                platform: 'external_api'
            }, 
            prompts, 
            history,
            'API_User', 
            'API_Owner', 
            null, 
            imageUrls, 
            audioUrls, 
            0 
        );

        if (typeof aiResponseObj === 'object' && aiResponseObj !== null) {
            aiText = aiResponseObj.reply || aiResponseObj.text || JSON.stringify(aiResponseObj);
            totalTokens = aiResponseObj.token_usage || 0;
            // ALWAYS return the branded name the user requested
            responseModelName = requestedModel; 
        } else {
            aiText = String(aiResponseObj);
        }

        // Clean AI Text from any JSON artifacts
        aiText = cleanAiText(aiText);

        // Fallback Token Calculation if engine returned 0
        if (totalTokens === 0) {
            const historyChars = history.reduce((acc, m) => acc + (m.content?.length || 0), 0);
            const systemChars = systemPrompt ? systemPrompt.length : 0;
            const inputChars = userMessage.length + historyChars + systemChars;
            const outputChars = aiText.length;
            totalTokens = Math.ceil((inputChars + outputChars) / 4);
        }

        // Determine Billing Label based on Model
        if (model === 'salesmanchatbot-flash') billingLabel = "Flash Engine API Call";
        else if (model === 'salesmanchatbot-lite') billingLabel = "Lite Engine API Call";
        else billingLabel = "Pro Engine API Call";

        // 5. Calculate Cost & Deduct Balance
        // Cost calculation moved to centralized dbService
        const finalCost = getCostPerRequest(model || 'salesmanchatbot-pro');

        if (!freeTierActive) {
            await dbService.deductUserBalance(userConfig.user_id, finalCost, `${billingLabel} (${totalTokens} tokens)`);
        }

        // Usage is now logged inside aiService.js to unify all consumption tracking.

        // --- SAFETY FILTER: Remove Internal Tags like [SAVE_ORDER] ---
        if (aiText && typeof aiText === 'string') {
            aiText = aiText.replace(/\[SAVE_ORDER:[\s\S]*?\]/g, '').trim();
        }

        // 6. Return Response
        const responseId = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        return res.json({
            id: responseId,
            object: 'chat.completion',
            created: created,
            model: responseModelName, // Dynamic based on engine
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: aiText
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: 0, 
                completion_tokens: 0,
                total_tokens: totalTokens
            }
        });

    } catch (error) {
        console.error('[ExternalAPI] Error:', error);
        const brandedError = aiService.formatBrandedError(error);
        return res.status(brandedError.code).json({
            error: {
                message: brandedError.message,
                type: brandedError.type,
                code: brandedError.code
            }
        });
    }
};

exports.listModels = async (req, res) => {
    try {
        const { error: authError } = await validateApiKey(req);
        if (authError) {
            return res.status(authError.status).json({ error: { message: authError.message, type: authError.type, code: authError.code } });
        }

        return res.json({
            object: "list",
            data: [
                { id: "salesmanchatbot-pro", object: "model", created: 1677610602, owned_by: "salesman" },
                { id: "salesmanchatbot-flash", object: "model", created: 1709251200, owned_by: "salesman" },
                { id: "salesmanchatbot-lite", object: "model", created: 1709251200, owned_by: "salesman" }
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
        // Since Groq Whisper is very cheap/free currently, we charge minimal or 0.
        // Let's charge 0.01 BDT per minute? Or fixed per request?
        // Let's charge 0.005 BDT per request for now.
        const cost = getCostPerRequest('salesmanchatbot-lite');

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
        const result = await pgClient.query(
            'SELECT service_api_key FROM user_configs WHERE user_id = $1::uuid LIMIT 1',
            [userId]
        );
        const row = result.rows[0] || null;
        
        res.json({ api_key: row?.service_api_key || null });
    } catch (error) {
        console.error("Fetch Key Exception:", error);
        res.status(500).json({ error: error.message });
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
            await pgClient.query(
                'INSERT INTO user_configs (user_id, email, service_api_key) VALUES ($1::uuid, $2, $3)',
                [userId, req.user.email, newKey]
            );
        } else {
            // Update existing
            await pgClient.query(
                'UPDATE user_configs SET service_api_key = $1 WHERE user_id = $2::uuid',
                [newKey, userId]
            );
        }
        
        res.json({ api_key: newKey });

    } catch (error) {
        console.error("Key Gen Exception:", error);
        res.status(500).json({ error: error.message });
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

        // 1. Fetch Paginated Stats
        const recentResult = await pgClient.query(
            `SELECT *
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

        // 2. Calculate Totals (Same as before)

        const totalResult = await pgClient.query(
            'SELECT cost, tokens FROM api_usage_stats WHERE user_id = $1::uuid',
            [userId]
        );
        const totalRows = totalResult.rows || [];

        const totalCost = totalRows.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
        const totalTokens = totalRows.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
        const totalRequests = totalRows.length;

        // Today's Cost/Tokens/Requests
        const today = new Date().toISOString().split('T')[0];
        const todayResult = await pgClient.query(
            `SELECT cost, tokens
             FROM api_usage_stats
             WHERE user_id = $1::uuid
               AND created_at >= $2::timestamptz`,
            [userId, `${today}T00:00:00Z`]
        );
        const todayRows = todayResult.rows || [];

        const todayCost = todayRows.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
        const todayTokens = todayRows.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
        const todayRequests = todayRows.length;

        // Yesterday Cost/Tokens/Requests
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yesterday = y.toISOString().split('T')[0];
        const yesterdayResult = await pgClient.query(
            `SELECT cost, tokens
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

        // Custom Range Cost
        let rangeCost = 0;
        let rangeTokens = 0;
        let rangeRequests = 0;
        if (startDate && endDate) {
            const rangeResult = await pgClient.query(
                `SELECT cost, tokens
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
            stats: stats,
            pagination: {
                total_records: totalCount,
                total_pages: totalPages,
                current_page: page,
                limit: limit
            },
            summary: {
                total_cost: totalCost,
                total_tokens: totalTokens,
                total_requests: totalRequests,
                today_cost: todayCost,
                today_tokens: todayTokens,
                today_requests: todayRequests,
                yesterday_cost: yesterdayCost,
                yesterday_tokens: yesterdayTokens,
                yesterday_requests: yesterdayRequests,
                range_cost: rangeCost,
                range_tokens: rangeTokens,
                range_requests: rangeRequests,
                start_date: startDate,
                end_date: endDate
            }
        });
    } catch (error) {
        console.error("[UsageStats] Error:", error);
        res.status(500).json({ error: error.message });
    }
};
