const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const liteEngineService = require('../services/liteEngineService');
const openrouterEngineService = require('../services/openrouterEngineService');
const crypto = require('crypto');

// Pricing per 1 Million Tokens (in BDT)
const PRICING = {
    PRO: 250,
    FLASH: 100,
    LITE: 40
};

// Helper to get cost per single token
const getCostPerToken = (modelName) => {
    let rate = PRICING.PRO; // Default
    if (modelName.includes('flash')) rate = PRICING.FLASH;
    else if (modelName.includes('lite')) rate = PRICING.LITE;
    
    return rate / 1000000;
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
                'SELECT COUNT(*)::int AS cnt FROM api_usage_stats WHERE user_id = $1',
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
        const { messages, model, stream } = req.body;

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
        let responseModelName = "salesmanchatbot-pro"; // Default to Pro
        let billingLabel = "Cheap Engine API Call";

        if (model === 'salesmanchatbot-flash' || model === 'salesmanchatbot-2.0-lite') {
            // --- FLASH ENGINE (Groq) ---
            responseModelName = "salesmanchatbot-flash";
            billingLabel = "Flash Engine API Call";
            
            const result = await liteEngineService.processRequest({
                message: userMessage,
                history: history,
                images: imageUrls,
                audioUrl: audioUrls.length > 0 ? audioUrls[0] : null,
                systemPrompt: systemPrompt || "You are a helpful assistant.",
                stream: stream === true || stream === 'true'
            });

            // Handle Streaming Response
            if (stream === true || stream === 'true') {
                const responseId = `chatcmpl-${Date.now()}`;
                const created = Math.floor(Date.now() / 1000);

                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                let fullText = "";
                try {
                    for await (const chunk of result) {
                        const content = chunk.choices?.[0]?.delta?.content || "";
                        fullText += content;
                        
                        const data = {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: created,
                            model: responseModelName,
                            choices: [
                                {
                                    index: 0,
                                    delta: { content: content },
                                    finish_reason: chunk.choices?.[0]?.finish_reason || null
                                }
                            ]
                        };
                        res.write(`data: ${JSON.stringify(data)}\n\n`);
                    }
                    
                    // Final log and deduction after stream finishes
                    const cleanFullText = cleanAiText(fullText);
                    const promptTokens = Math.ceil((userMessage.length + (systemPrompt?.length || 0)) / 3.5);
                    const completionTokens = Math.ceil(cleanFullText.length / 3.5);
                    totalTokens = promptTokens + completionTokens;

                    const costPerToken = getCostPerToken(responseModelName);
                    const finalCost = Math.max(totalTokens * costPerToken, 0.00001);

                    if (!freeTierActive) {
                        await dbService.deductUserBalance(userConfig.user_id, finalCost, `${billingLabel} (Stream: ${totalTokens} tokens)`);
                    }
                    await dbService.logApiUsage(userConfig.user_id, responseModelName, totalTokens, freeTierActive ? 0 : finalCost);

                    res.write('data: [DONE]\n\n');
                    return res.end();
                } catch (streamError) {
                    console.error('[ExternalAPI] Stream Error:', streamError);
                    return res.end();
                }
            }

            aiText = cleanAiText(result);
            const promptTokens = Math.ceil((userMessage.length + (systemPrompt?.length || 0)) / 3.5);
            const completionTokens = Math.ceil(aiText.length / 3.5);
            totalTokens = promptTokens + completionTokens;

        } else if (model === 'salesmanchatbot-lite' || model === 'salesmanchatbot-2.0-pro') {
            // --- LITE ENGINE (OpenRouter) ---
            // Note: User renamed OpenRouter engine to 'salesmanchatbot-lite'
            responseModelName = "salesmanchatbot-lite";
            billingLabel = "Lite Engine API Call";

            const result = await openrouterEngineService.processRequest({
                message: userMessage,
                history: history,
                images: imageUrls,
                systemPrompt: systemPrompt || ""
            });
            aiText = cleanAiText(result);

             const promptTokens = Math.ceil((userMessage.length + (systemPrompt?.length || 0)) / 3.5);
             const completionTokens = Math.ceil(aiText.length / 3.5);
             totalTokens = promptTokens + completionTokens;

        } else {
            // --- PRO ENGINE (Gemini / RAG / Default) ---
            // User requested 'salesmanchatbot' to be named 'salesmanchatbot-pro'
            responseModelName = "salesmanchatbot-pro";
            billingLabel = "Pro Engine API Call";

            const prompts = systemPrompt ? { text_prompt: systemPrompt } : {};

            const aiResponseObj = await aiService.generateReply(
                userMessage,
                { ai_provider: 'system', chat_model: model || 'default', is_external_api: true }, 
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
            } else {
                aiText = String(aiResponseObj);
            }

            // Clean AI Text from any JSON artifacts
            aiText = cleanAiText(aiText);

            // Fallback Token Calculation for Default Engine
            // If the underlying provider did not return usage,
            // approximate total tokens including system prompt, history and reply.
            if (totalTokens === 0) {
                const historyChars = history.reduce((acc, m) => acc + (m.content?.length || 0), 0);
                const systemChars = systemPrompt ? systemPrompt.length : 0;
                const inputChars = userMessage.length + historyChars + systemChars;
                const outputChars = aiText.length;
                totalTokens = Math.ceil((inputChars + outputChars) / 4);
            }
        }

        // 5. Calculate Cost & Deduct Balance
        const costPerToken = getCostPerToken(responseModelName);
        const cost = totalTokens * costPerToken;
        const finalCost = Math.max(cost, 0.00001); 

        if (!freeTierActive) {
            await dbService.deductUserBalance(userConfig.user_id, finalCost, `${billingLabel} (${totalTokens} tokens)`);
        }

        // 5.5 Log API Usage
        await dbService.logApiUsage(userConfig.user_id, responseModelName, totalTokens, freeTierActive ? 0 : finalCost);

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
        return res.status(500).json({ error: { message: 'Internal Server Error', type: 'api_error' } });
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
        console.error('[ExternalAPI] Models Error:', error);
        return res.status(500).json({ error: { message: 'Internal Server Error', type: 'api_error' } });
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
        const cost = 0.005;

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
        // We log "1" as token count for audio request tracking
        await dbService.logApiUsage(userConfig.user_id, 'whisper-large-v3', 1, cost);

        res.json({ text: transcription });

    } catch (error) {
        console.error('[ExternalAPI] Audio Error:', error);
        res.status(500).json({ error: { message: 'Internal Server Error' } });
    }
};

exports.getApiKey = async (req, res) => {
    try {
        const userId = req.user?.id; 
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        
        const pgClient = require('../services/pgClient');
        const result = await pgClient.query(
            'SELECT service_api_key FROM user_configs WHERE user_id = $1 LIMIT 1',
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

        const newKey = 'sk-' + crypto.randomBytes(24).toString('hex');
        console.log(`[KeyGen] Generating new key for user: ${userId}`);

        const pgClient = require('../services/pgClient');

        // Check if config exists
        const checkRes = await pgClient.query(
            'SELECT id FROM user_configs WHERE user_id = $1 LIMIT 1',
            [userId]
        );

        if (checkRes.rows.length === 0) {
            // Create new config
            await pgClient.query(
                'INSERT INTO user_configs (user_id, email, service_api_key) VALUES ($1, $2, $3)',
                [userId, req.user.email, newKey]
            );
        } else {
            // Update existing
            await pgClient.query(
                'UPDATE user_configs SET service_api_key = $1 WHERE user_id = $2',
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
            VALUES ($1, $2, $3, $4, $5)
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
            'SELECT ai_provider, api_key, model_name FROM user_configs WHERE user_id = $1',
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

        const pgClient = require('../services/pgClient');

        const recentResult = await pgClient.query(
            `SELECT *
             FROM api_usage_stats
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 100`,
            [userId]
        );
        const stats = recentResult.rows || [];

        // 2. Calculate Totals
        // Total Cost & Tokens & Requests

        const totalResult = await pgClient.query(
            'SELECT cost, tokens FROM api_usage_stats WHERE user_id = $1',
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
             WHERE user_id = $1
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
             WHERE user_id = $1
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
                 WHERE user_id = $1
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
