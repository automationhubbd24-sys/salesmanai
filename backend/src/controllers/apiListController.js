const pgClient = require('../services/pgClient');

exports.list = async (req, res) => {
    try {
        const result = await pgClient.query(
            'SELECT id, provider, api, status, text_model, vision_model, voice_model FROM api_list ORDER BY id DESC'
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
        const text_model = String(req.body.text_model || 'gemini-2.0-flash').trim();
        const vision_model = String(req.body.vision_model || 'gemini-2.0-flash').trim();
        const voice_model = String(req.body.voice_model || 'gemini-2.0-flash-lite').trim();

        if (!provider || !api) {
            return res.status(400).json({ success: false, error: 'provider and api are required' });
        }

        const result = await pgClient.query(
            'INSERT INTO api_list (provider, api, status, text_model, vision_model, voice_model) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [provider, api, 'active', text_model, vision_model, voice_model]
        );

        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('apiList create error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { text_model, vision_model, voice_model, status } = req.body;

        if (!id || Number.isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }

        const result = await pgClient.query(
            `UPDATE api_list 
             SET text_model = COALESCE($1, text_model), 
                 vision_model = COALESCE($2, vision_model), 
                 voice_model = COALESCE($3, voice_model),
                 status = COALESCE($4, status)
             WHERE id = $5 RETURNING *`,
            [text_model, vision_model, voice_model, status, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'API key not found' });
        }

        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('apiList update error:', error);
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

