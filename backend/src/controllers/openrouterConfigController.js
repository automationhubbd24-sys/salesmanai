const dbService = require('../services/dbService');
const openrouterEngineService = require('../services/openrouterEngineService');
const keyService = require('../services/keyService');
const axios = require('axios');
const OpenAI = require('openai');

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

exports.getConfig = async (req, res) => {
    try {
        const pgClient = require('../services/pgClient');
        const result = await pgClient.query(
            'SELECT * FROM openrouter_engine_config WHERE config_type = $1 LIMIT 1',
            ['best_models']
        );

        const row = result.rows[0] || null;

        res.json({ success: true, config: row });
    } catch (error) {
        console.error('Error fetching config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.saveConfig = async (req, res) => {
    try {
        const { text_model, voice_model, image_model, text_model_details, voice_model_details, image_model_details } = req.body;

        const pgClient = require('../services/pgClient');

        const result = await pgClient.query(
            `INSERT INTO openrouter_engine_config 
                (config_type, text_model, voice_model, image_model, text_model_details, voice_model_details, image_model_details, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (config_type)
             DO UPDATE SET
                text_model = EXCLUDED.text_model,
                voice_model = EXCLUDED.voice_model,
                image_model = EXCLUDED.image_model,
                text_model_details = EXCLUDED.text_model_details,
                voice_model_details = EXCLUDED.voice_model_details,
                image_model_details = EXCLUDED.image_model_details,
                updated_at = EXCLUDED.updated_at
             RETURNING *`,
            [
                'best_models',
                text_model,
                voice_model,
                image_model,
                text_model_details,
                voice_model_details,
                image_model_details,
                new Date().toISOString()
            ]
        );

        const data = result.rows[0] || null;

        // Update KeyService Limits immediately
        if (text_model && text_model_details) {
            updateKeyServiceLimits(text_model, text_model_details);
        }
        if (voice_model && voice_model_details) {
            updateKeyServiceLimits(voice_model, voice_model_details);
        }
        if (image_model && image_model_details) {
            updateKeyServiceLimits(image_model, image_model_details);
        }

        // Trigger Engine Update (reload config)
        await openrouterEngineService.loadConfigFromDB();

        res.json({ success: true, config: data });
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

function updateKeyServiceLimits(modelId, details) {
    if (!details || !details.rpm || !details.rpd) return;
    if (keyService.setManualLimit) {
        keyService.setManualLimit(modelId, { rpm: parseInt(details.rpm), rpd: parseInt(details.rpd) });
    }
}

exports.testModel = async (req, res) => {
    const { model, type, input, apiKey } = req.body; 

    if (!apiKey) {
        return res.status(400).json({ success: false, error: "API Key is required for testing." });
    }

    try {
        let responseData = {};
        let headers = {};
        const start = Date.now();

        if (type === 'text') {
            const result = await axios.post(
                `${OPENROUTER_API_BASE}/chat/completions`,
                {
                    model: model,
                    messages: [{ role: 'user', content: input || "Hello, are you working?" }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://n8n.io',
                        'X-Title': 'n8n'
                    }
                }
            );
            responseData = result.data;
            headers = result.headers;
        } 
        else if (type === 'image') {
             const result = await axios.post(
                `${OPENROUTER_API_BASE}/chat/completions`,
                {
                    model: model,
                    messages: [
                        { 
                            role: 'user', 
                            content: [
                                { type: 'text', text: "What is in this image?" },
                                { type: 'image_url', image_url: { url: input } }
                            ] 
                        }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://n8n.io',
                        'X-Title': 'n8n'
                    }
                }
            );
            responseData = result.data;
            headers = result.headers;
        }
        else if (type === 'voice') {
            if (model.includes('whisper')) {
                return res.status(400).json({ success: false, error: "Whisper testing not yet supported via URL." });
            }
            
             const result = await axios.post(
                `${OPENROUTER_API_BASE}/chat/completions`,
                {
                    model: model,
                    messages: [{ role: 'user', content: input || "Hello" }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://n8n.io',
                        'X-Title': 'n8n'
                    }
                }
            );
            responseData = result.data;
            headers = result.headers;
        }

        const duration = Date.now() - start;

        const rateLimits = {
            limit: headers['x-ratelimit-limit-requests'] || headers['x-ratelimit-limit'],
            remaining: headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining'],
            reset: headers['x-ratelimit-reset-requests'] || headers['x-ratelimit-reset']
        };

        res.json({ 
            success: true, 
            data: responseData, 
            headers: rateLimits,
            latency: duration 
        });

    } catch (error) {
        res.status(error.response ? error.response.status : 500).json({ 
            success: false, 
            error: error.response ? error.response.data : error.message,
            headers: error.response ? error.response.headers : {}
        });
    }
};

exports.testGeminiPool = async (req, res) => {
    const { model, message } = req.body || {};
    const testModel = model || 'gemini-2.5-flash';
    const testMessage = message || 'hi from SalesmanChatbot key test';

    try {
        const pgClient = require('../services/pgClient');
        const result = await pgClient.query(
            'SELECT * FROM api_list WHERE provider = ANY($1::text[])',
            [['google', 'gemini']]
        );

        const keys = Array.isArray(result.rows) ? result.rows : [];

        if (keys.length === 0) {
            return res.json({ success: false, error: 'No Gemini keys found in api_list', results: [] });
        }

        const results = [];

        for (const k of keys) {
            const client = new OpenAI({
                apiKey: k.api,
                baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
            });

            const item = {
                id: k.id,
                provider: k.provider,
                model: testModel,
                original_model: k.model || null,
                success: false,
                error: null
            };

            try {
                const completion = await client.chat.completions.create({
                    model: testModel,
                    messages: [{ role: 'user', content: testMessage }],
                    max_tokens: 8
                });
                if (completion && completion.choices && completion.choices.length > 0) {
                    item.success = true;
                } else {
                    item.success = false;
                    item.error = 'Empty response';
                }
            } catch (e) {
                item.success = false;
                item.error = e.message || 'Request failed';
            }

            results.push(item);
        }

        const failed = results.filter(r => !r.success).length;

        res.json({
            success: true,
            total: results.length,
            failed,
            results
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.testApiPool = async (req, res) => {
    const { model, message, provider, mark_failed } = req.body || {};
    const testMessage = message || 'hi from SalesmanChatbot key test';
    const providerFilter = provider && provider !== 'all' ? [provider] : null;

    const providerDefaults = {
        google: 'gemini-2.5-flash',
        gemini: 'gemini-2.5-flash',
        openrouter: 'google/gemini-2.5-flash',
        groq: 'llama-3.3-70b-versatile',
        openai: 'gpt-4o-mini',
        mistral: 'mistral-small-latest'
    };

    try {
        const pgClient = require('../services/pgClient');
        const dbService = require('../services/dbService');
        const result = providerFilter
            ? await pgClient.query('SELECT * FROM api_list WHERE provider = ANY($1::text[])', [providerFilter])
            : await pgClient.query('SELECT * FROM api_list');

        const keys = Array.isArray(result.rows) ? result.rows : [];

        if (keys.length === 0) {
            return res.json({ success: false, error: 'No keys found in api_list', results: [] });
        }

        const results = [];
        const failedIds = [];

        for (const k of keys) {
            const providerKey = (k.provider || '').toLowerCase();
            let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            let defaultModel = providerDefaults[providerKey] || 'gemini-2.5-flash';

            if (providerKey === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';
            else if (providerKey === 'groq') baseURL = 'https://api.groq.com/openai/v1';
            else if (providerKey === 'openai') baseURL = 'https://api.openai.com/v1';
            else if (providerKey === 'mistral') baseURL = 'https://api.mistral.ai/v1';

            const client = new OpenAI({
                apiKey: k.api,
                baseURL: baseURL,
                defaultHeaders: providerKey === 'openrouter'
                    ? { 'HTTP-Referer': 'https://n8n.io', 'X-Title': 'n8n' }
                    : undefined
            });

            const testModel = model || k.model || defaultModel;

            const item = {
                id: k.id,
                provider: k.provider,
                model: testModel,
                original_model: k.model || null,
                success: false,
                error: null
            };

            try {
                const completion = await client.chat.completions.create({
                    model: testModel,
                    messages: [{ role: 'user', content: testMessage }],
                    max_tokens: 8
                });
                if (completion && completion.choices && completion.choices.length > 0) {
                    item.success = true;
                } else {
                    item.success = false;
                    item.error = 'Empty response';
                }
            } catch (e) {
                item.success = false;
                item.error = e.message || 'Request failed';
            }

            if (!item.success) {
                failedIds.push(k.id);
            }

            results.push(item);
        }

        if (mark_failed && failedIds.length > 0) {
                for (const id of failedIds) {
                    await dbService.updateApiKeyStatus(id, 'disabled');
                }
                if (keyService.forceUpdateKeyCache) {
                    await keyService.forceUpdateKeyCache();
                } else if (keyService.updateKeyCache) {
                    await keyService.updateKeyCache(true);
                }
            }

        const failed = results.filter(r => !r.success).length;

        res.json({
            success: true,
            total: results.length,
            failed,
            results
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.deleteApiKeys = async (req, res) => {
    try {
        const { ids } = req.body || {};

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'No ids provided' });
        }

        const numericIds = ids
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0);

        if (numericIds.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid id list' });
        }

        const pgClient = require('../services/pgClient');

        const result = await pgClient.query(
            'DELETE FROM api_list WHERE id = ANY($1::bigint[])',
            [numericIds]
        );

        const deleted = result.rowCount || 0;

        res.json({ success: true, deleted });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.deleteGeminiKeys = async (req, res) => {
    try {
        const { ids } = req.body || {};

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'No ids provided' });
        }

        const numericIds = ids
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0);

        if (numericIds.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid id list' });
        }

        const pgClient = require('../services/pgClient');

        const result = await pgClient.query(
            'DELETE FROM api_list WHERE id = ANY($1::bigint[])',
            [numericIds]
        );

        const deleted = result.rowCount || 0;

        res.json({ success: true, deleted });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
