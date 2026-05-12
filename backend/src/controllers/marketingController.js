const marketingService = require('../services/marketingService');
const dbService = require('../services/dbService');

async function startCampaign(req, res) {
    try {
        const { page_id, platform, message, image_url, exclude_buyers } = req.body;
        const userId = req.user?.sub || req.user?.id;

        if (!page_id || !platform || !message) {
            return res.status(400).json({ error: 'page_id, platform, and message are required' });
        }

        const result = await marketingService.startCampaign({
            userId,
            pageId: page_id,
            platform,
            message,
            imageUrl: image_url,
            excludeBuyers: exclude_buyers,
            range: 'today' // Hardcoded to today as per user request
        });

        res.json(result);
    } catch (error) {
        console.error('[Marketing Controller] Error starting campaign:', error);
        res.status(500).json({ error: error.message });
    }
}

async function getCampaignStatus(req, res) {
    try {
        const { id } = req.params;
        const status = await marketingService.getCampaignStatus(id);
        if (!status) return res.status(404).json({ error: 'Campaign not found' });
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function listCampaigns(req, res) {
    try {
        const { page_id } = req.query;
        const pgClient = require('../services/pgClient');
        const result = await pgClient.query(
            `SELECT * FROM bulk_campaigns WHERE page_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [page_id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    startCampaign,
    getCampaignStatus,
    listCampaigns
};