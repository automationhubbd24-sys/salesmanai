const pgClient = require('../services/pgClient');

exports.list = async (req, res) => {
    try {
        const result = await pgClient.query(
            'SELECT id, provider, model, api, status FROM api_list ORDER BY id DESC'
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
        const model = String(req.body.model || '').trim();
        const api = String(req.body.api || '').trim();

        if (!provider || !model || !api) {
            return res.status(400).json({ success: false, error: 'provider, model and api are required' });
        }

        const result = await pgClient.query(
            'INSERT INTO api_list (provider, model, api, status) VALUES ($1, $2, $3, $4) RETURNING id, provider, model, api, status',
            [provider, model, api, 'active']
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

