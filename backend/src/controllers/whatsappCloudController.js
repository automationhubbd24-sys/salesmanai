const whatsappCloudService = require('../services/whatsappCloudService');
const pgClient = require('../services/pgClient');

/**
 * Handle Embedded Signup Completion
 */
const completeEmbeddedSignup = async (req, res) => {
    try {
        const { code, wabaId, phoneNumberId } = req.body;
        const userId = req.user?.id; // From authMiddleware
        const userEmail = req.user?.email;
        
        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;

        // 1. Exchange code for Long-lived Access Token
        const accessToken = await whatsappCloudService.getAccessTokenFromCode(code, appId, appSecret);

        // 2. Save to Database
        // Note: Using a query to update or insert the official connection
        // We link it to the user who performed the signup
        const sessionName = `official_${wabaId || phoneNumberId || userId || 'wa'}`;
        const query = `
            INSERT INTO whatsapp_message_database 
            (user_id, email, phone_number_id, waba_id, cloud_access_token, provider_type, status, session_name)
            VALUES ($1, $2, $3, $4, $5, 'official', 'active', $6)
            ON CONFLICT (session_name) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            email = EXCLUDED.email,
            phone_number_id = EXCLUDED.phone_number_id,
            waba_id = EXCLUDED.waba_id,
            cloud_access_token = EXCLUDED.cloud_access_token,
            provider_type = 'official',
            status = 'active'
            RETURNING id, session_name, waba_id, phone_number_id
        `;
        
        const insertResult = await pgClient.query(query, [userId, userEmail, phoneNumberId, wabaId, accessToken, sessionName]);
        const savedConnection = insertResult.rows[0] || {};

        // 3. Subscribe the App to WABA (to receive webhooks)
        if (wabaId) {
            await whatsappCloudService.subscribeAppToWaba(wabaId, accessToken);
        }

        res.status(200).json({ 
            success: true, 
            message: 'WhatsApp Official account connected successfully',
            data: {
                id: savedConnection.id,
                sessionName: savedConnection.session_name || sessionName,
                wabaId: savedConnection.waba_id || wabaId,
                phoneNumberId: savedConnection.phone_number_id || phoneNumberId
            }
        });

    } catch (error) {
        console.error('[WhatsApp Cloud Controller] Signup Error:', error);
        res.status(500).json({ error: 'Failed to complete signup', details: error.message });
    }
};

module.exports = {
    completeEmbeddedSignup
};
