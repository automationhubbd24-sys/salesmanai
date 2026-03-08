const pgClient = require('../services/pgClient');

exports.list = async (req, res) => {
    try {
        const result = await pgClient.query(
            'SELECT id, provider, api, status FROM api_list ORDER BY id DESC'
        );
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('apiList list error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const provider = String(req.body.provider || '').trim();
        const api = String(req.body.api || '').trim();

        if (!provider || !api) {
            return res.status(400).json({ success: false, error: 'provider and api are required' });
        }

        const result = await pgClient.query(
            'INSERT INTO api_list (provider, api, status) VALUES ($1, $2, $3) RETURNING *',
            [provider, api, 'active']
        );

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

        res.json({ success: true, config: result.rows[0] });
    } catch (error) {
        console.error('saveGlobalConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getEmbeddingConfig = async (req, res) => {
    try {
        const result = await pgClient.query('SELECT * FROM embedding_model_config WHERE config_type = $1 LIMIT 1', ['global']);
        res.json({ success: true, config: result.rows[0] || null });
    } catch (error) {
        console.error('getEmbeddingConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.saveEmbeddingConfig = async (req, res) => {
    try {
        const { provider, base_url, api_key, model_name } = req.body;
        
        const result = await pgClient.query(
            `INSERT INTO embedding_model_config (config_type, provider, base_url, api_key, model_name, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (config_type) 
             DO UPDATE SET 
                provider = EXCLUDED.provider,
                base_url = EXCLUDED.base_url,
                api_key = EXCLUDED.api_key,
                model_name = EXCLUDED.model_name,
                updated_at = NOW()
             RETURNING *`,
            ['global', provider, base_url, api_key, model_name]
        );

        res.json({ success: true, config: result.rows[0] });
    } catch (error) {
        console.error('saveEmbeddingConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

