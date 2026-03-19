const pgClient = require('../services/pgClient');
const keyService = require('../services/keyService');
const aiService = require('../services/aiService');

exports.list = async (req, res) => {
    try {
        const { provider, page, limit, q } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        
        const poolData = keyService.getActiveRotationPool(provider, pageNum, limitNum, q);
        
        res.json({ success: true, ...poolData });
    } catch (error) {
        console.error('apiList list error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getRotationLogs = async (req, res) => {
    try {
        const logs = keyService.getRotationLogs();
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const provider = String(req.body.provider || '').trim();
        const api = String(req.body.api || '').trim();
        const model = String(req.body.model || 'default').trim();
        const email = String(req.body.email || '').trim() || null;

        if (!provider || !api) {
            return res.status(400).json({ success: false, error: 'provider and api are required' });
        }

        const result = await pgClient.query(
            'INSERT INTO api_list (provider, api, model, status, email) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [provider, api, model, 'active', email]
        );

        await keyService.updateKeyCache(true);

        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('apiList create error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.remove = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id || Number.isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }

        await pgClient.query('DELETE FROM api_list WHERE id = $1', [id]);
        
        await keyService.updateKeyCache(true);

        res.json({ success: true });
    } catch (error) {
        console.error('apiList remove error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getGlobalConfigs = async (req, res) => {
    try {
        const result = await pgClient.query('SELECT * FROM api_engine_configs ORDER BY provider ASC');
        res.json({ success: true, configs: result.rows });
    } catch (error) {
        console.error('getGlobalConfigs error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.saveGlobalConfig = async (req, res) => {
    try {
        const { 
            provider, text_model, vision_model, voice_model,
            text_provider_override, vision_provider_override, voice_provider_override,
            text_rpm, text_rpd, text_rph, vision_rpm, vision_rpd, vision_rph, voice_rpm, voice_rpd, voice_rph
        } = req.body;
        
        if (!provider) {
            return res.status(400).json({ success: false, error: 'Provider is required' });
        }

        const result = await pgClient.query(
            `INSERT INTO api_engine_configs (
                provider, text_model, vision_model, voice_model,
                text_provider_override, vision_provider_override, voice_provider_override,
                text_rpm, text_rpd, text_rph, vision_rpm, vision_rpd, vision_rph, voice_rpm, voice_rpd, voice_rph,
                updated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
             ON CONFLICT (provider) 
             DO UPDATE SET 
                text_model = EXCLUDED.text_model,
                vision_model = EXCLUDED.vision_model,
                voice_model = EXCLUDED.voice_model,
                text_provider_override = EXCLUDED.text_provider_override,
                vision_provider_override = EXCLUDED.vision_provider_override,
                voice_provider_override = EXCLUDED.voice_provider_override,
                text_rpm = EXCLUDED.text_rpm,
                text_rpd = EXCLUDED.text_rpd,
                text_rph = EXCLUDED.text_rph,
                vision_rpm = EXCLUDED.vision_rpm,
                vision_rpd = EXCLUDED.vision_rpd,
                vision_rph = EXCLUDED.vision_rph,
                voice_rpm = EXCLUDED.voice_rpm,
                voice_rpd = EXCLUDED.voice_rpd,
                voice_rph = EXCLUDED.voice_rph,
                updated_at = NOW()
             RETURNING *`,
            [
                provider, text_model, vision_model, voice_model,
                text_provider_override, vision_provider_override, voice_provider_override,
                text_rpm || 0, text_rpd || 0, text_rph || 0,
                vision_rpm || 0, vision_rpd || 0, vision_rph || 0,
                voice_rpm || 0, voice_rpd || 0, voice_rph || 0
            ]
        );

        if (result.rowCount > 0) {
            aiService.clearGlobalConfigCache(provider);
        }

        res.json({ success: true, config: result.rows[0] });
    } catch (error) {
        console.error('saveGlobalConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.testKeyRotation = async (req, res) => {
    try {
        const { provider, model, message, manualKey } = req.body;
        
        if (!provider || !message) {
            return res.status(400).json({ success: false, error: 'Provider and message are required' });
        }

        let keyToUse;
        let proxyToUse;
        let proxyInfo = "Direct (No Proxy)";
        let modelToUse = model || 'default';

        // ROTATION ENGINE SIMULATION
        if (manualKey) {
            // Use manually provided key
            keyToUse = manualKey;
            
            // SIMULATE ENGINE PROXY ROTATION
            // Our engine uses proxies for branded models or specific providers
            const isBranded = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'].includes(modelToUse);
            if (isBranded || provider === 'google' || provider === 'gemini' || provider === 'groq') {
                const proxyUrl = aiService.getProxyUrl(modelToUse);
                if (proxyUrl) {
                    proxyToUse = proxyUrl;
                    const session = proxyUrl.includes('-session-') ? proxyUrl.split('-session-')[1]?.split(':')[0] : 'rotator';
                    proxyInfo = `Rotating Proxy (Session: ${session})`;
                }
            }
            
            console.log(`[AdminTester] 🧪 Testing MANUAL ${provider} key: ${keyToUse.substring(0,8)}... | Proxy: ${proxyInfo}`);
        } else {
            // Use getSmartKey to handle rotation from pool
            const keyInfo = await keyService.getSmartKey(provider, modelToUse);
            
            if (!keyInfo || !keyInfo.key) {
                return res.status(500).json({ success: false, error: 'No active keys found for this provider/model in pool' });
            }
            keyToUse = keyInfo.key;
            modelToUse = keyInfo.model || modelToUse;

            // Resolve Proxy for Pool Key (Same logic as main engine)
            const proxyUrl = aiService.getProxyUrl(modelToUse);
            if (proxyUrl) {
                proxyToUse = proxyUrl;
                const session = proxyUrl.includes('-session-') ? proxyUrl.split('-session-')[1]?.split(':')[0] : 'rotator';
                proxyInfo = `Rotating Proxy (Session: ${session})`;
            }

            console.log(`[AdminTester] 🧪 Testing POOL ${provider} with key: ${keyToUse.substring(0,8)}... | Proxy: ${proxyInfo}`);
        }

        // Execute using the actual generateResponse engine
        const result = await aiService.generateResponse({
            pageId: 'ExternalAPI',
            userId: 'AdminTester',
            userMessage: message,
            history: [],
            imageUrls: [],
            audioUrls: [],
            config: {
                ai: provider,
                chat_model: modelToUse,
                api_key: keyToUse,
                cheap_engine: false, // Force bypass system key rotation
                is_our_own_provider: true, // Force using the provided key only
                is_external_api: true,
                user_id: '45b7647f-8ee0-44c6-a230-ae82943ab6a6', // Valid UUID
                page_id: 'ExternalAPI'
            },
            platform: 'external_api'
        });

        res.json({ 
            success: true, 
            response: result.reply,
            debug: {
                key: keyToUse,
                model: modelToUse,
                proxy: proxyInfo,
                usage: result.token_usage
            }
        });

    } catch (error) {
        console.error('testKeyRotation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

