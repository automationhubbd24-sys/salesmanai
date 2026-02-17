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
            const { data } = await dbService.supabase
                .from('openrouter_engine_config')
                .select('*')
                .eq('config_type', 'best_models')
                .single();
            
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
            const { data: currentConfig } = await dbService.supabase
                .from('openrouter_engine_config')
                .select('text_model_details')
                .eq('config_type', 'best_models')
                .single();
                
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
        const { data: keys } = await dbService.supabase
            .from('openrouter_engine_keys')
            .select('*');

        if (!keys) return [];

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

                // Update DB
                await dbService.supabase
                    .from('openrouter_engine_keys')
                    .update({
                        usage_limit: limit,
                        usage_used: usage,
                        is_active: true,
                        last_checked_at: new Date()
                    })
                    .eq('id', key.id);

                validKeys.push(key.api_key);

            } catch (e) {
                console.warn(`[OpenRouterEngine] Invalid Key (${key.label}):`, e.message);
                // Mark inactive
                await dbService.supabase
                    .from('openrouter_engine_keys')
                    .update({ is_active: false })
                    .eq('id', key.id);
            }
        }
        return validKeys;
    }

    async saveConfigToDB(config) {
        if (!config) return;
        
        // Upsert Config
        await dbService.supabase
            .from('openrouter_engine_config')
            .upsert({
                config_type: 'best_models',
                text_model: config.text,
                voice_model: config.voice,
                image_model: config.image,
                updated_at: new Date()
            }, { onConflict: 'config_type' });
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

        const msgs = [
            { role: 'system', content: systemPrompt },
            ...history
        ];

        const userContent = [{ type: 'text', text: message }];
        images.forEach(img => {
            userContent.push({ type: 'image_url', image_url: { url: img } });
        });
        msgs.push({ role: 'user', content: userContent });

        if (images.length > 0 && image) {
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
                    console.warn(`[OpenRouterEngine] Invalid API Key detected. Marking as inactive.`);
                    await dbService.supabase
                        .from('openrouter_engine_keys')
                        .update({ is_active: false })
                        .eq('api_key', apiKey);
                }

                if (error.status === 429 && image) {
                    console.warn(`[OpenRouterEngine] Rate Limit Hit for ${image}. Reporting...`);
                    keyService.report429(image);
                }

                console.error("[OpenRouterEngine] Request Failed:", error.message);
                throw error;
            }
        }

        const candidateModels = [];
        if (text) candidateModels.push(text);
        if (voice && !candidateModels.includes(voice)) candidateModels.push(voice);

        if (candidateModels.length === 0) {
            throw new Error("No candidate models configured for OpenRouter engine.");
        }

        const responses = [];
        let lastError = null;

        for (const modelId of candidateModels) {
            try {
                const completion = await client.chat.completions.create({
                    model: modelId,
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

                responses.push({ model: modelId, content });
            } catch (error) {
                lastError = error;

                if (error.status === 401 || error.message.includes('API key')) {
                    console.warn(`[OpenRouterEngine] Invalid API Key detected. Marking as inactive.`);
                    await dbService.supabase
                        .from('openrouter_engine_keys')
                        .update({ is_active: false })
                        .eq('api_key', apiKey);
                }

                if (error.status === 429) {
                    console.warn(`[OpenRouterEngine] Rate Limit Hit for ${modelId}. Reporting...`);
                    keyService.report429(modelId);
                }
            }
        }

        if (responses.length === 0) {
            if (lastError) {
                console.error("[OpenRouterEngine] All candidate models failed:", lastError.message);
                throw lastError;
            }
            throw new Error("No response from any OpenRouter model.");
        }

        let bestContent = null;

        if (responses.length === 1) {
            bestContent = responses[0].content;
        } else {
            const sortedByLength = [...responses].sort((a, b) => b.content.length - a.content.length);
            bestContent = sortedByLength[0].content;
        }

        if (!bestContent || bestContent.trim().length === 0) {
            const fallback = responses[0].content || "";
            return fallback;
        }

        try {
            const refineModel = text || responses[0].model;

            const refinePrompt = [
                `System Rules:\n${systemPrompt || "Follow all given instructions strictly."}`,
                `\nUser Message:\n${message}`,
                `\nDraft Answer:\n${bestContent}`,
                `\nTask: Improve this draft answer so that it is more accurate, helpful and natural in Bengali for a sales/support chat. Fix any mistakes, make structure clear, and keep the tone polite and concise. Reply with the improved answer only.`
            ].join("\n");

            const refineMessages = [
                { role: "system", content: "You improve and correct draft answers for Bengali customer conversations." },
                { role: "user", content: refinePrompt }
            ];

            const refineCompletion = await client.chat.completions.create({
                model: refineModel,
                messages: refineMessages
            });

            const refinedContent = refineCompletion.choices[0].message.content || "";

            if (refinedContent && refinedContent.trim().length > 0) {
                return refinedContent;
            }
        } catch (e) {
            console.warn("[OpenRouterEngine] Refinement step failed, using base answer:", e.message);
        }

        return bestContent;
    }
}

module.exports = new OpenRouterEngineService();
