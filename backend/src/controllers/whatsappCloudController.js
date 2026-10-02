const whatsappCloudService = require('../services/whatsappCloudService');
const pgClient = require('../services/pgClient');
const { getOfficialWebhookSubscriptionOptions } = require('../utils/officialWebhookConfig');

function buildOfficialSessionName(wabaId, phoneNumberId) {
    return `official_${wabaId || 'waba'}_${phoneNumberId || 'pending'}`;
}

async function ensureUniqueSessionName(baseSessionName, phoneNumberId) {
    let sessionName = baseSessionName;
    let counter = 1;

    while (true) {
        const checkResult = await pgClient.query(
            `SELECT id
             FROM whatsapp_message_database
             WHERE session_name = $1
               AND COALESCE(phone_number_id, '') <> COALESCE($2, '')
             LIMIT 1`,
            [sessionName, phoneNumberId || null]
        );

        if (checkResult.rowCount === 0) {
            return sessionName;
        }

        sessionName = `${baseSessionName}_${counter}`;
        counter++;
    }
}

function normalizePhoneNumbers(phoneNumbers = []) {
    if (!Array.isArray(phoneNumbers)) {
        return [];
    }

    return phoneNumbers
        .map((item) => ({
            id: String(item?.id || '').trim(),
            displayPhoneNumber: item?.displayPhoneNumber || item?.display_phone_number || null,
            verifiedName: item?.verifiedName || item?.verified_name || null
        }))
        .filter((item) => item.id);
}

async function syncOfficialConnections({
    userId,
    userEmail,
    accessToken,
    wabaId,
    phoneNumberId,
    phoneNumbers = []
}) {
    let normalizedPhoneNumbers = normalizePhoneNumbers(phoneNumbers);
    const explicitPhoneId = String(phoneNumberId || '').trim() || null;

    if (normalizedPhoneNumbers.length === 0 && wabaId && accessToken) {
        normalizedPhoneNumbers = normalizePhoneNumbers(
            await whatsappCloudService.getPhoneNumbersForWaba(wabaId, accessToken)
        );
    }

    let targetPhoneNumbers = normalizedPhoneNumbers;
    if (explicitPhoneId) {
        const matchedPhone = normalizedPhoneNumbers.find((item) => item.id === explicitPhoneId);
        targetPhoneNumbers = matchedPhone
            ? [matchedPhone]
            : [{ id: explicitPhoneId, displayPhoneNumber: null, verifiedName: null }];
    } else if (targetPhoneNumbers.length === 0) {
        targetPhoneNumbers = [{ id: null, displayPhoneNumber: null, verifiedName: null }];
    }

    const whereClauses = [`provider_type = 'official'`];
    const params = [];
    let paramIndex = 1;

    if (wabaId) {
        whereClauses.push(`waba_id = $${paramIndex}`);
        params.push(wabaId);
        paramIndex++;
    }

    const targetPhoneIds = Array.from(new Set(targetPhoneNumbers.map((item) => item.id).filter(Boolean)));
    if (targetPhoneIds.length > 0) {
        whereClauses.push(`phone_number_id = ANY($${paramIndex}::text[])`);
        params.push(targetPhoneIds);
        paramIndex++;
    }

    const existingRowsResult = await pgClient.query(
        `SELECT id, session_name, waba_id, phone_number_id
         FROM whatsapp_message_database
         WHERE ${whereClauses[0]} AND (${whereClauses.slice(1).join(' OR ') || 'TRUE'})`,
        params
    );

    const existingRows = existingRowsResult.rows || [];
    const existingByPhoneId = new Map(
        existingRows
            .filter((row) => row.phone_number_id)
            .map((row) => [String(row.phone_number_id), row])
    );

    const pendingRow = existingRows.find((row) => !row.phone_number_id && row.waba_id && row.waba_id === wabaId) || null;
    const syncedConnections = [];
    const newlyCreatedConnections = [];

    for (const phone of targetPhoneNumbers) {
        const currentPhoneId = phone.id || null;
        const existingConnection = currentPhoneId ? existingByPhoneId.get(String(currentPhoneId)) : pendingRow;
        let sessionName = existingConnection?.session_name || buildOfficialSessionName(wabaId, currentPhoneId);

        if (!existingConnection) {
            sessionName = await ensureUniqueSessionName(sessionName, currentPhoneId);
        }

        const insertResult = await pgClient.query(
            `INSERT INTO whatsapp_message_database
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
             RETURNING id, session_name, waba_id, phone_number_id`,
            [
                userId,
                userEmail,
                currentPhoneId,
                wabaId,
                accessToken,
                sessionName
            ]
        );

        const savedConnection = insertResult.rows[0];
        const syncRecord = { ...savedConnection, displayPhoneNumber: phone.displayPhoneNumber, verifiedName: phone.verifiedName };
        syncedConnections.push(syncRecord);

        if (!existingConnection) {
            newlyCreatedConnections.push(syncRecord);
        }
    }

    let selectedConnection = null;
    if (explicitPhoneId) {
        selectedConnection = syncedConnections.find((row) => String(row.phone_number_id || '') === explicitPhoneId) || null;
    }
    if (!selectedConnection && newlyCreatedConnections.length === 1) {
        selectedConnection = newlyCreatedConnections[0];
    }
    if (!selectedConnection) {
        selectedConnection = syncedConnections[0] || null;
    }

    return {
        syncedConnections,
        selectedConnection
    };
}

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

        const syncResult = await syncOfficialConnections({
            userId,
            userEmail,
            accessToken,
            wabaId: resolvedWabaId,
            phoneNumberId: resolvedPhoneNumberId,
            phoneNumbers: resolvedDetails.phoneNumbers
        });
        const savedConnection = syncResult.selectedConnection || {};

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
                sessionName: savedConnection.session_name || buildOfficialSessionName(resolvedWabaId, resolvedPhoneNumberId),
                wabaId: savedConnection.waba_id || resolvedWabaId,
                phoneNumberId: savedConnection.phone_number_id || resolvedPhoneNumberId,
                displayPhoneNumber: savedConnection.displayPhoneNumber || resolvedDetails.displayPhoneNumber,
                verifiedName: savedConnection.verifiedName || resolvedDetails.verifiedName,
                syncedPhoneCount: syncResult.syncedConnections.length
            }
        });

    } catch (error) {
        console.error('[WhatsApp Cloud Controller] Signup Error:', error);
        res.status(500).json({ error: 'Failed to complete signup', details: error.message });
    }
};

module.exports = {
    completeEmbeddedSignup,
    syncOfficialConnections
};
