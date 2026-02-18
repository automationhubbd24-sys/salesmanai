const axios = require('axios');
const dbService = require('./dbService');
const keyService = require('./keyService'); // Added for AI Judge
const OpenAI = require('openai');

// --- CONSTANTS ---
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 Hours
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

// MODELS TO EXCLUDE (Low Rate Limits or Poor Quality)
const EXCLUDED_MODELS = [
    'qwen/qwen3-next-80b-a3b-instruct', // Known 2 RPM limit
    'nousresearch/hermes-3-llama-3.1-405b:free', // User verified: Strict limits / Unstable
    // Add more here...
];

class OpenRouterEngineService {
    constructor() {
        this.configCache = null; // { text, voice, image, keys: [] }
        this.lastUpdate = 0;
        
        // Start Auto-Updater
        this.initAutoUpdate();
    }

    async initAutoUpdate() {
        console.log('[OpenRouterEngine] Starting Auto-Update Service...');
        
        // Load initial config from DB (Fast Start)
        await this.loadConfigFromDB();

        // If no config found, run first cycle
        if (!this.configCache) {
            await this.performUpdateCycle();
        }
        
        setInterval(() => {
            this.performUpdateCycle();
        }, UPDATE_INTERVAL_MS);
    }

    /**
     * Load Config from DB
     */
    async loadConfigFromDB() {
        try {
            const pgClient = require('./pgClient');

            const result = await pgClient.query(
                'SELECT * FROM openrouter_engine_config WHERE config_type = $1 LIMIT 1',
                ['best_models']
            );

            const data = result.rows[0];
            
            if (data) {
                // Fetch Keys too
                const validKeys = await this.updateKeyStatus();
                
                this.configCache = {
                    text: data.text_model,
                    voice: data.voice_model,
                    image: data.image_model,
                    keys: validKeys
                };
                
                // Update KeyService Limits if present
                if (data.text_model_details && keyService.setManualLimit) {
                    keyService.setManualLimit(data.text_model, data.text_model_details);
                }
                
                console.log('[OpenRouterEngine] 📂 Loaded Config from DB:', this.configCache);
            }
        } catch (error) {
            console.warn('[OpenRouterEngine] Could not load config from DB:', error.message);
        }
    }

    /**
     * CORE: 24-Hour Update Cycle
     * 1. Fetch Free Models
     * 2. Select Best 3 (Text, Voice, Image)
     * 3. Check Key Limits
     * 4. Save to DB & Cache
     */
    async performUpdateCycle() {
        try {
            console.log('[OpenRouterEngine] 🔄 Running Daily Update Cycle...');
            
            // CHECK LOCK: If config is manually locked, skip auto-selection
            const pgClient = require('./pgClient');
            const currentRes = await pgClient.query(
                'SELECT text_model_details FROM openrouter_engine_config WHERE config_type = $1 LIMIT 1',
                ['best_models']
            );
            const currentConfig = currentRes.rows[0] || null;
                
            if (currentConfig && currentConfig.text_model_details && currentConfig.text_model_details.lock_auto_update) {
                 console.log('[OpenRouterEngine] 🔒 Auto-Update Skipped (Locked by Admin)');
                 // Refresh keys only
                 await this.updateKeyStatus();
                 return;
            }

            // Step 1: Fetch Models
            const allModels = await this.fetchOpenRouterModels();
            const freeModels = allModels.filter(m => 
                m.pricing && 
                (m.pricing.prompt === "0" || m.pricing.prompt === 0) && 
                (m.pricing.completion === "0" || m.pricing.completion === 0) &&
                // Check against EXCLUDED_MODELS
                !EXCLUDED_MODELS.some(ex => m.id.includes(ex))
            );

            // Step 2: Select Best Models (Async AI Judge)
            const bestModels = await this.selectBestModels(freeModels);
            console.log('[OpenRouterEngine] ✅ Selected Models:', bestModels);

            // Step 3: Check Keys & Update Limits
            const validKeys = await this.updateKeyStatus();

            // Step 4: Save Config to DB
            await this.saveConfigToDB(bestModels);

            // Step 5: Update Cache
            this.configCache = {
                ...bestModels,
                keys: validKeys
            };
            this.lastUpdate = Date.now();

        } catch (error) {
            console.error('[OpenRouterEngine] ❌ Update Cycle Failed:', error.message);
        }
    }

    /**
     * Fetch all models from OpenRouter
     */
    async fetchOpenRouterModels() {
        try {
            const response = await axios.get(`${OPENROUTER_API_BASE}/models`);
            return response.data.data;
        } catch (e) {
            console.error('[OpenRouterEngine] Model Fetch Error:', e.message);
            return [];
        }
    }

    async selectBestModels(freeModels) {
        if (!freeModels || freeModels.length === 0) return null;
        
        // Algorithmic Sort: Sort by Context Length as a proxy for "Power",
        // but prioritize General Purpose over Coder
        const sorted = [...freeModels].sort((a, b) => {
            const contextA = a.context_length || 0;
            const contextB = b.context_length || 0;
            return contextB - contextA;
        });

        // Smart Text Selection: Prefer 'instruct'/'chat' and exclude 'coder' if possible
        const textCandidates = sorted.filter(m => !m.id.includes('vision') && !m.id.includes('coder'));
        
        // Prioritize Llama 3 / Mistral, and specifically prefer larger models (70b, 80b, etc.)
        const bestText = textCandidates.find(m => 
            (m.id.includes('llama-3') || m.id.includes('mistral')) && 
            (m.id.includes('70b') || m.id.includes('large'))
        ) || textCandidates.find(m => m.id.includes('llama-3') || m.id.includes('mistral')) || textCandidates[0] || sorted[0];

        const bestVoice = sorted.find(m => m.id.includes('flash') || m.id.includes('instant')) || sorted[0]; // Heuristic for speed
        const bestImage = sorted.find(m => m.architecture?.modality?.includes('image') || m.id.includes('vision')) || sorted[0];

        return {
            text: bestText.id,
            voice: bestVoice.id,
            image: bestImage.id
        };
    }

    /**
     * Validate Keys & Check Limits via OpenRouter API
     */
    async updateKeyStatus() {
        // Fetch keys from DB
        const pgClient = require('./pgClient');
        const keyRes = await pgClient.query(
            'SELECT * FROM openrouter_engine_keys',
            []
        );

        const keys = keyRes.rows || [];

        if (!keys || keys.length === 0) return [];

        const validKeys = [];

        for (const key of keys) {
            try {
                // Check Key Limits
                const response = await axios.get(`${OPENROUTER_API_BASE}/auth/key`, {
                    headers: { 'Authorization': `Bearer ${key.api_key}` }
                });
                
                const data = response.data.data;
                const limit = data.limit || 0; // null means unlimited usually, but for free keys it might be strictly 0 credit
                const usage = data.usage || 0;

                await pgClient.query(
                    `UPDATE openrouter_engine_keys
                     SET usage_limit = $1,
                         usage_used = $2,
                         is_active = true,
                         last_checked_at = $3
                     WHERE id = $4`,
                    [limit, usage, new Date(), key.id]
                );

                validKeys.push(key.api_key);

            } catch (e) {
                console.warn(`[OpenRouterEngine] Invalid Key (${key.label}):`, e.message);
                await pgClient.query(
                    `UPDATE openrouter_engine_keys
                     SET is_active = false
                     WHERE id = $1`,
                    [key.id]
                );
            }
        }
        return validKeys;
    }

    async saveConfigToDB(config) {
        if (!config) return;
        
        const pgClient = require('./pgClient');

        await pgClient.query(
            `INSERT INTO openrouter_engine_config
                (config_type, text_model, voice_model, image_model, updated_at)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (config_type)
             DO UPDATE SET
                text_model = EXCLUDED.text_model,
                voice_model = EXCLUDED.voice_model,
                image_model = EXCLUDED.image_model,
                updated_at = EXCLUDED.updated_at`,
            ['best_models', config.text, config.voice, config.image, new Date()]
        );
    }

    async processRequest({ message, history, images = [], systemPrompt = '' }) {
        if (!this.configCache) {
            await this.performUpdateCycle();
        }

        const { text, voice, image, keys } = this.configCache;

        if (!keys || keys.length === 0) {
            throw new Error("No Active OpenRouter Keys Available.");
        }

        const apiKey = keys[Math.floor(Math.random() * keys.length)];

        const client = new OpenAI({
            apiKey: apiKey,
            baseURL: OPENROUTER_API_BASE,
            defaultHeaders: {
                "HTTP-Referer": "https://salesmanchatbot.online",
                "X-Title": "SalesmanChatbot"
            }
        });

        let plannerModel = null;
        let generatorModel = null;
        let refinerModel = null;

        if (text && typeof text === "string" && text.includes(",")) {
            const parts = text.split(",").map(m => m.trim()).filter(Boolean);

            if (parts.length > 0) plannerModel = parts[0];
            if (parts.length > 1) generatorModel = parts[1];
            if (parts.length > 2) refinerModel = parts[2];

            if (!generatorModel) generatorModel = plannerModel;
            if (!refinerModel) refinerModel = generatorModel || plannerModel;
        } else {
            plannerModel = voice || text;
            generatorModel = text || voice;
            refinerModel = voice || text;
        }

        if (!generatorModel) {
            throw new Error("No generator model configured for OpenRouter engine.");
        }

        if (images.length > 0 && image) {
            const msgs = [
                { role: 'system', content: systemPrompt },
                ...history
            ];

            const userContent = [{ type: 'text', text: message }];
            images.forEach(img => {
                userContent.push({ type: 'image_url', image_url: { url: img } });
            });
            msgs.push({ role: 'user', content: userContent });

            try {
                const completion = await client.chat.completions.create({
                    model: image,
                    messages: msgs
                });

                let content = completion.choices[0].message.content || "";

                if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
                    try {
                        const parsed = JSON.parse(content);
                        if (parsed.message) content = parsed.message;
                        else if (parsed.content) content = parsed.content;
                        else if (parsed.response) content = parsed.response;
                    } catch (e) {
                    }
                }

                return content;
            } catch (error) {
                if (error.status === 401 || error.message.includes('API key')) {
                    const pgClient = require('./pgClient');
                    await pgClient.query(
                        'UPDATE openrouter_engine_keys SET is_active = false WHERE api_key = $1',
                        [apiKey]
                    );
                }

                if (error.status === 429 && image) {
                    keyService.report429(image);
                }

                throw error;
            }
        }

        let plan = null;

        if (plannerModel) {
            try {
                const plannerMessages = [
                    {
                        role: "system",
                        content: "You analyze Bengali customer messages and create a JSON plan for the reply."
                    },
                    {
                        role: "user",
                        content: [
                            "User Message:",
                            message,
                            "",
                            "Chat History (may be empty):",
                            JSON.stringify(history || []),
                            "",
                            "Return ONLY valid JSON with fields:",
                            "{",
                            '  "intent": "...",',
                            '  "category": "...",',
                            '  "tone": "...",',
                            '  "sections": ["..."]',
                            "}"
                        ].join("\n")
                    }
                ];

                const plannerCompletion = await client.chat.completions.create({
                    model: plannerModel,
                    messages: plannerMessages
                });

                const plannerContent = plannerCompletion.choices[0].message.content || "";

                if (plannerContent.trim().startsWith("{")) {
                    try {
                        plan = JSON.parse(plannerContent);
                    } catch (e) {
                        plan = null;
                    }
                }
            } catch (e) {
            }
        }

        let generatorSystem = systemPrompt || "";

        if (plan) {
            const parts = [];
            if (plan.intent) parts.push(`Intent: ${plan.intent}`);
            if (plan.category) parts.push(`Category: ${plan.category}`);
            if (plan.tone) parts.push(`Tone: ${plan.tone}`);
            if (plan.sections && Array.isArray(plan.sections) && plan.sections.length > 0) {
                parts.push(`Sections: ${plan.sections.join(" -> ")}`);
            }

            const plannerInfo = parts.join("\n");

            generatorSystem = [
                generatorSystem || "",
                plannerInfo ? "\nReply Plan:\n" + plannerInfo : ""
            ].join("");
        }

        const generatorMessages = [
            { role: 'system', content: generatorSystem || "You are a Bengali sales and support assistant." },
            ...history,
            { role: 'user', content: message }
        ];

        let draftContent = null;

        try {
            const generatorCompletion = await client.chat.completions.create({
                model: generatorModel,
                messages: generatorMessages
            });

            draftContent = generatorCompletion.choices[0].message.content || "";
        } catch (error) {
            if (error.status === 401 || error.message.includes('API key')) {
                const pgClient = require('./pgClient');
                await pgClient.query(
                    'UPDATE openrouter_engine_keys SET is_active = false WHERE api_key = $1',
                    [apiKey]
                );
            }

            if (error.status === 429) {
                keyService.report429(generatorModel);
            }

            throw error;
        }

        if (!draftContent || draftContent.trim().length === 0) {
            return "";
        }

        if (!refinerModel) {
            return draftContent;
        }

        try {
            const refinePrompt = [
                `System Rules:\n${systemPrompt || "Follow all given instructions strictly."}`,
                `\nUser Message:\n${message}`,
                `\nDraft Answer:\n${draftContent}`,
                `\nTask: Improve this draft answer so that it is accurate, helpful and natural in Bengali for sales/support chat. Fix mistakes, keep it concise and polite. Reply with the improved answer only.`
            ].join("\n");

            const refineMessages = [
                { role: "system", content: "You refine and correct Bengali customer chat replies." },
                { role: "user", content: refinePrompt }
            ];

            const refineCompletion = await client.chat.completions.create({
                model: refinerModel,
                messages: refineMessages
            });

            const refinedContent = refineCompletion.choices[0].message.content || "";

            if (refinedContent && refinedContent.trim().length > 0) {
                return refinedContent;
            }
        } catch (error) {
            if (error.status === 429) {
                keyService.report429(refinerModel);
            }
        }

        return draftContent;
    }
}

module.exports = new OpenRouterEngineService();
