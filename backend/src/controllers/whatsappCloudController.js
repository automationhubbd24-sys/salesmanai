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

        await pgClient.query(`
            ALTER TABLE whatsapp_message_database
            ADD COLUMN IF NOT EXISTS provider_type text,
            ADD COLUMN IF NOT EXISTS waba_id text,
            ADD COLUMN IF NOT EXISTS phone_number_id text,
            ADD COLUMN IF NOT EXISTS cloud_access_token text
        `);
        
        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;
        if (!appId || !appSecret) {
            return res.status(500).json({ error: 'Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET' });
        }

        // 1. Exchange code for Long-lived Access Token
        const accessToken = await whatsappCloudService.getAccessTokenFromCode(code, appId, appSecret);

        // 2. Resolve final signup metadata. The SDK code and postMessage payload can arrive out of order.
        const resolvedDetails = await whatsappCloudService.getEmbeddedSignupDetails({
            accessToken,
            appId,
            appSecret,
            wabaId,
            phoneNumberId
        });

        const resolvedWabaId = resolvedDetails.wabaId || wabaId || null;
        const resolvedPhoneNumberId = resolvedDetails.phoneNumberId || phoneNumberId || null;

        if (!resolvedWabaId && !resolvedPhoneNumberId) {
            return res.status(422).json({
                error: 'Embedded signup finished, but no WhatsApp asset IDs were returned. Please retry the connection flow.'
            });
        }

        // 3. Reuse an existing official row for this business/user when possible.
        const existingConnectionResult = await pgClient.query(
            `SELECT id, session_name
             FROM whatsapp_message_database
             WHERE provider_type = 'official'
               AND (
                    waba_id = $1
                    OR phone_number_id = $2
                    OR (user_id = $3 AND email = $4)
               )
             ORDER BY
                CASE
                    WHEN waba_id = $1 THEN 0
                    WHEN phone_number_id = $2 THEN 1
                    WHEN user_id = $3 AND email = $4 THEN 2
                    ELSE 3
                END
             LIMIT 1`,
            [resolvedWabaId, resolvedPhoneNumberId, userId, userEmail]
        );

        const existingConnection = existingConnectionResult.rows[0];
        const sessionName = existingConnection?.session_name || `official_${resolvedWabaId || resolvedPhoneNumberId || userId || 'wa'}`;
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
        
        const insertResult = await pgClient.query(query, [
            userId,
            userEmail,
            resolvedPhoneNumberId,
            resolvedWabaId,
            accessToken,
            sessionName
        ]);
        const savedConnection = insertResult.rows[0] || {};

        // 4. Subscribe the App to WABA (to receive webhooks)
        if (resolvedWabaId) {
            await whatsappCloudService.subscribeAppToWaba(resolvedWabaId, accessToken);
        }

        res.status(200).json({ 
            success: true, 
            message: 'WhatsApp Official account connected successfully',
            data: {
                id: savedConnection.id,
                sessionName: savedConnection.session_name || sessionName,
                wabaId: savedConnection.waba_id || resolvedWabaId,
                phoneNumberId: savedConnection.phone_number_id || resolvedPhoneNumberId,
                displayPhoneNumber: resolvedDetails.displayPhoneNumber,
                verifiedName: resolvedDetails.verifiedName
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
