const whatsappCloudService = require('../services/whatsappCloudService');
const pgClient = require('../services/pgClient');
const { getOfficialWebhookSubscriptionOptions } = require('../utils/officialWebhookConfig');

/**
 * Handle Embedded Signup Completion
 */
const completeEmbeddedSignup = async (req, res) => {
    try {
        const { code, wabaId, phoneNumberId, redirectUri } = req.body;
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
        const accessToken = await whatsappCloudService.getAccessTokenFromCode(code, appId, appSecret, redirectUri);

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

        // 3. Check if this exact WABA + Phone number combination already exists
        // Only reuse if it's the EXACT same business account + phone number
        let existingConnection = null;
        if (resolvedWabaId || resolvedPhoneNumberId) {
            const whereClauses = [];
            const params = [];
            let paramIndex = 1;
            
            if (resolvedWabaId) {
                whereClauses.push(`waba_id = $${paramIndex}`);
                params.push(resolvedWabaId);
                paramIndex++;
            }
            
            if (resolvedPhoneNumberId) {
                whereClauses.push(`phone_number_id = $${paramIndex}`);
                params.push(resolvedPhoneNumberId);
                paramIndex++;
            }
            
            if (whereClauses.length > 0) {
                const existingQuery = `
                    SELECT id, session_name
                    FROM whatsapp_message_database
                    WHERE provider_type = 'official'
                    AND (${whereClauses.join(' AND ')})
                    LIMIT 1
                `;
                const existingConnectionResult = await pgClient.query(existingQuery, params);
                existingConnection = existingConnectionResult.rows[0];
            }
        }

        // Generate a unique session name for this specific number
        // If existing connection exists, reuse its session name; otherwise create new unique one
        let sessionName = existingConnection?.session_name;
        if (!sessionName) {
            // Create unique session name using waba_id and phone_number_id
            const baseName = `official_${resolvedWabaId || 'waba'}_${resolvedPhoneNumberId || 'phone'}`;
            sessionName = baseName;
            
            // Check if session name already exists and append counter if needed
            let counter = 1;
            while (true) {
                const checkResult = await pgClient.query(
                    `SELECT id FROM whatsapp_message_database WHERE session_name = $1`,
                    [sessionName]
                );
                if (checkResult.rows.length === 0) break;
                sessionName = `${baseName}_${counter}`;
                counter++;
            }
        }
        const query = `
            INSERT INTO whatsapp_message_database 
            (user_id, email, phone_number_id, waba_id, cloud_access_token, provider_type, status, active, session_name)
            VALUES ($1, $2, $3, $4, $5, 'official', 'WORKING', true, $6)
            ON CONFLICT (session_name) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            email = EXCLUDED.email,
            phone_number_id = EXCLUDED.phone_number_id,
            waba_id = EXCLUDED.waba_id,
            cloud_access_token = EXCLUDED.cloud_access_token,
            provider_type = 'official',
            status = 'WORKING',
            active = true
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
            await whatsappCloudService.subscribeAppToWaba(
                resolvedWabaId,
                accessToken,
                getOfficialWebhookSubscriptionOptions()
            );
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
