const express = require('express');
const router = express.Router();
const pgClient = require('../services/pgClient');

router.get('/total-sessions', async (req, res) => {
    try {
        // Count Messenger Pages
        const messengerResult = await pgClient.query(
            `SELECT COUNT(*)::int AS count FROM page_access_token_message 
             WHERE subscription_status IN ('active', 'trial', 'active_trial', 'active_paid')`
        );
        const messengerCount = messengerResult.rows[0].count || 0;

        // Count official WhatsApp connections
        const whatsappResult = await pgClient.query(
            `SELECT COUNT(*)::int AS count FROM whatsapp_message_database
             WHERE provider_type = 'official'`
        );
        const whatsappCount = whatsappResult.rows[0].count || 0;

        res.json({ count: messengerCount + whatsappCount });
    } catch (error) {
        console.error("Error fetching total sessions:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
