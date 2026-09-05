const express = require('express');
const router = express.Router();
const multer = require('multer');
const whatsappCloudController = require('../controllers/whatsappCloudController');
const webhookController = require('../controllers/webhookController');
const pgClient = require('../services/pgClient');
const dbService = require('../services/dbService');
const orderService = require('../services/orderService');
const whatsappCloudService = require('../services/whatsappCloudService');
const imageService = require('../services/imageService');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');
const { resolveAuthorizedTeamResource } = require('../services/teamAuthorizationService');
const { getOfficialWebhookSubscriptionOptions } = require('../utils/officialWebhookConfig');
const { getSmartInboxConversations, upsertSmartInboxLabel } = require('../utils/smartInbox');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// #region debug-point whatsapp-cross-routing
function reportWhatsAppRoutingDebug(hypothesisId, location, msg, data = {}) {
    try {
        const envContent = fs.readFileSync(path.resolve(__dirname, '../../../.dbg/whatsapp-cross-routing.env'), 'utf8');
        const debugUrl = envContent.match(/^DEBUG_SERVER_URL=(.+)$/m)?.[1]?.trim();
        const sessionId = envContent.match(/^DEBUG_SESSION_ID=(.+)$/m)?.[1]?.trim();
        if (!debugUrl || !sessionId) return;
        fetch(debugUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, runId: 'pre-fix', hypothesisId, location, msg, data, ts: Date.now() })
        }).catch(() => {});
    } catch (_) {}
}

function hashRoutingId(value) {
    return value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12) : null;
}
// #endregion
const smartInboxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are supported.'));
        cb(null, true);
    }
});

async function ensureOfficialWhatsAppColumns() {
    await pgClient.query(`
        ALTER TABLE whatsapp_message_database
        ADD COLUMN IF NOT EXISTS provider_type text,
        ADD COLUMN IF NOT EXISTS waba_id text,
        ADD COLUMN IF NOT EXISTS phone_number_id text,
        ADD COLUMN IF NOT EXISTS cloud_access_token text
    `);
}

const officialWebhookRepairCache = new Map();
const OFFICIAL_WEBHOOK_REPAIR_TTL_MS = 10 * 60 * 1000;

async function ensureOfficialWebhookSubscription(row, reason = 'runtime') {
    if (!row?.waba_id || !row?.cloud_access_token) {
        return { skipped: true, reason: 'missing_credentials' };
    }

    const cacheKey = String(row.session_name || row.waba_id || row.phone_number_id || '');
    const lastRepairAt = officialWebhookRepairCache.get(cacheKey) || 0;
    if (Date.now() - lastRepairAt < OFFICIAL_WEBHOOK_REPAIR_TTL_MS) {
        return { skipped: true, reason: 'throttled' };
    }

    const subscriptionOptions = getOfficialWebhookSubscriptionOptions();

    try {
        const result = await whatsappCloudService.subscribeAppToWaba(
            row.waba_id,
            row.cloud_access_token,
            subscriptionOptions
        );
        officialWebhookRepairCache.set(cacheKey, Date.now());
        console.log(
            `[WhatsApp Official] Webhook subscription ensured for ${row.session_name || row.waba_id} (${reason})`
        );
        return { success: true, result };
    } catch (error) {
        console.warn(
            `[WhatsApp Official] Failed to ensure webhook subscription for ${row.session_name || row.waba_id} (${reason}):`,
            error.response?.data || error.message
        );
        return { success: false, error };
    }
}

async function authorizeWhatsAppResource(req, sessionName, module, action) {
    return resolveAuthorizedTeamResource({
        pgClient,
        actorEmail: req.user?.email,
        resourceType: 'wa_sessions',
        resourceId: String(sessionName || '').trim(),
        module,
        action
    });
}

async function requireWhatsAppResource(req, res, sessionName, module, action) {
    const authorization = await authorizeWhatsAppResource(req, sessionName, module, action);
    if (!authorization?.authorized) {
        res.status(403).json({ error: 'Forbidden' });
        return null;
    }
    return authorization;
}

async function hasSessionAccess(sessionName, userId, userEmail) {
    await ensureOfficialWhatsAppColumns();

    const configResult = await pgClient.query(
        `SELECT user_id, email, session_name, waba_id, phone_number_id
         FROM whatsapp_message_database
         WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1
         LIMIT 1`,
        [sessionName]
    );

    if (configResult.rowCount === 0) {
        return false;
    }

    const row = configResult.rows[0];
    if (row.user_id === userId || row.email === userEmail) {
        return true;
    }

    if (!userEmail) {
        return false;
    }

    const teamResult = await pgClient.query(
        'SELECT permissions FROM team_members WHERE member_email = $1 AND status = $2',
        [userEmail, 'active']
    );

    for (const t of teamResult.rows) {
        const sessions = t.permissions && Array.isArray(t.permissions.wa_sessions)
            ? t.permissions.wa_sessions
            : [];
        if (sessions.includes(row.session_name)) {
            return true;
        }
    }

    return false;
}

function buildMessageTypeFilter(messageType) {
    switch (messageType) {
        case 'bot':
            return "AND reply_by = 'bot'";
        case 'reminder':
            return "AND (status = 'reminder' OR reply_by = 'system')";
        case 'user':
            return "AND reply_by = 'user'";
        case 'error':
            return "AND status IN ('system_error', 'reminder_error')";
        default:
            return '';
    }
}

async function ensureWhatsAppOrderColumns() {
    await pgClient.query(`
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS customer_email text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS customer_name text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS status text DEFAULT 'ongoing';
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'ecommerce';
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS service_name text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS service_package text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS service_details text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS delivery_method text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS appointment_type text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS appointment_date text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS appointment_time text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS appointment_notes text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS assigned_to text;
        ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    `);
}

function sendLegacySessionRetired(res) {
    return res.status(410).json({
        error: 'Legacy QR/session-based WhatsApp has been retired. Please use the Meta official connection flow.'
    });
}

function handleLegacyWhatsAppRoute(req, res) {
    return sendLegacySessionRetired(res);
}

// WhatsApp Cloud API Official Routes
router.post('/official/signup-complete', authMiddleware, whatsappCloudController.completeEmbeddedSignup);
router.post('/official/:sessionName/repair-webhook', authMiddleware, async (req, res) => {
    try {
        await ensureOfficialWhatsAppColumns();

        const sessionName = String(req.params.sessionName || '').trim();
        if (!sessionName) {
            return res.status(400).json({ error: 'Session name is required' });
        }

        const userId = req.user?.id || null;
        const userEmail = req.user?.email || null;
        const allowed = await hasSessionAccess(sessionName, userId, userEmail);

        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = await pgClient.query(
            `SELECT session_name, waba_id, phone_number_id, cloud_access_token
             FROM whatsapp_message_database
             WHERE session_name = $1
             LIMIT 1`,
            [sessionName]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'WhatsApp connection not found' });
        }

        const repair = await ensureOfficialWebhookSubscription(result.rows[0], 'manual_repair');
        if (!repair.success && !repair.skipped) {
            return res.status(502).json({ error: 'Failed to repair webhook subscription' });
        }

        return res.json({ success: true, repair });
    } catch (error) {
        console.error('Repair official WhatsApp webhook error:', error);
        return res.status(500).json({ error: error.message });
    }
});
router.delete('/official/:sessionName', authMiddleware, async (req, res) => {
    try {
        await ensureOfficialWhatsAppColumns();

        const sessionName = String(req.params.sessionName || '').trim();
        if (!sessionName) {
            return res.status(400).json({ error: 'Session name is required' });
        }

        const userId = req.user?.id || null;
        const userEmail = req.user?.email || null;
        const allowed = await hasSessionAccess(sessionName, userId, userEmail);

        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = await pgClient.query(
            `SELECT session_name, waba_id, phone_number_id, cloud_access_token
             FROM whatsapp_message_database
             WHERE session_name = $1
             LIMIT 1`,
            [sessionName]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'WhatsApp connection not found' });
        }

        const row = result.rows[0];

        if (row.waba_id && row.cloud_access_token) {
            const siblingResult = await pgClient.query(
                `SELECT 1
                 FROM whatsapp_message_database
                 WHERE provider_type = 'official'
                   AND waba_id = $1
                   AND session_name <> $2
                 LIMIT 1`,
                [row.waba_id, row.session_name]
            );

            if (siblingResult.rowCount === 0) {
                try {
                    await whatsappCloudService.unsubscribeAppFromWaba(row.waba_id, row.cloud_access_token);
                } catch (unsubscribeError) {
                    console.warn(`[WhatsApp Official] Failed to unsubscribe app from WABA ${row.waba_id}:`, unsubscribeError.response?.data || unsubscribeError.message);
                }
            }
        }

        await dbService.deleteWhatsAppEntry(row.session_name);
        webhookController.clearPageCache(row.session_name);
        if (row.waba_id) {
            webhookController.clearPageCache(row.waba_id);
        }
        if (row.phone_number_id) {
            webhookController.clearPageCache(row.phone_number_id);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete official WhatsApp connection error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Backward-compatible official webhook route.
router.get('/webhook', webhookController.verifyWhatsAppWebhook);
router.post('/webhook', webhookController.handleWhatsAppWebhook);

// Get Session QR (Real-time)
router.get('/session/qr/:sessionName', handleLegacyWhatsAppRoute);

// Get Sessions (Merged with DB Info & Team Permissions)
router.get('/sessions', async (req, res) => {
    try {
        await ensureOfficialWhatsAppColumns();

        const authHeader = req.headers.authorization;
        let userId = null;
        let userEmail = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            const secret = process.env.JWT_SECRET;
            const payload = jwt.verify(token, secret);
            userId = payload.sub;
            userEmail = payload.email;
        }

        if (!userId) {
            // Return empty if not authenticated (Security)
            return res.json([]);
        }

        const requestedOwner = req.query?.team_owner || req.headers['x-team-owner'];

        // 2. Fetch Personal Sessions
        let mySessions = [];
        if (!requestedOwner || requestedOwner === userEmail) {
            // Safer query that handles potential null userIds and type mismatches
            const { rows } = await pgClient.query(
                `SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email, engine_override, provider_type, waba_id, phone_number_id, cloud_access_token 
                 FROM whatsapp_message_database 
                 WHERE 
                    (user_id IS NOT NULL AND user_id::text = $1::text) 
                    OR (email IS NOT NULL AND email = $2)`,
                [userId ? String(userId) : null, userEmail]
            );
            mySessions = rows;
        }

        // 3. Fetch Shared Sessions (Team Members)
        let sharedSessionNames = [];
        if (userEmail && requestedOwner && requestedOwner !== userEmail) {
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
                [userEmail, requestedOwner, 'active']
            );

            teamData.forEach(row => {
                if (row.permissions && Array.isArray(row.permissions.wa_sessions)) {
                    sharedSessionNames.push(...row.permissions.wa_sessions);
                }
            });
        }

        let sharedSessions = [];
        if (sharedSessionNames.length > 0) {
            const { rows: sharedData } = await pgClient.query(
                'SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email, engine_override, provider_type, waba_id, phone_number_id, cloud_access_token FROM whatsapp_message_database WHERE session_name = ANY($1::text[])',
                [sharedSessionNames]
            );
            sharedSessions = sharedData;
        }

        const officialSessionsToSync = [...mySessions, ...sharedSessions].filter((sessionRow) =>
            sessionRow.provider_type === 'official'
            && sessionRow.waba_id
            && sessionRow.cloud_access_token
        );

        for (const sessionRow of officialSessionsToSync) {
            try {
                await whatsappCloudController.syncOfficialConnections({
                    userId: sessionRow.user_id || userId,
                    userEmail: sessionRow.email || userEmail,
                    accessToken: sessionRow.cloud_access_token,
                    wabaId: sessionRow.waba_id,
                    phoneNumberId: sessionRow.phone_number_id,
                    phoneNumbers: []
                });
            } catch (syncError) {
                console.warn(
                    `[WhatsApp Official] Failed to sync WABA phone numbers for ${sessionRow.session_name || sessionRow.waba_id}:`,
                    syncError.response?.data || syncError.message
                );
            }
        }

        // 4. Combine DB Sessions
        // Deduplicate by session_name
        const refreshedMySessions = !requestedOwner || requestedOwner === userEmail
            ? (await pgClient.query(
                `SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email, engine_override, provider_type, waba_id, phone_number_id, cloud_access_token
                 FROM whatsapp_message_database
                 WHERE
                    (user_id IS NOT NULL AND user_id::text = $1::text)
                    OR (email IS NOT NULL AND email = $2)`,
                [userId ? String(userId) : null, userEmail]
            )).rows
            : mySessions;
        const refreshedSharedSessions = sharedSessionNames.length > 0
            ? (await pgClient.query(
                'SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email, engine_override, provider_type, waba_id, phone_number_id, cloud_access_token FROM whatsapp_message_database WHERE session_name = ANY($1::text[])',
                [sharedSessionNames]
            )).rows
            : sharedSessions;
        const allDBSessions = [...(refreshedMySessions || []), ...(refreshedSharedSessions || [])];
        const uniqueDBSessions = Array.from(new Map(allDBSessions.map(item => [item.session_name, item])).values());

        await Promise.all(
            uniqueDBSessions
                .filter((sessionRow) =>
                    sessionRow.provider_type === 'official'
                    || String(sessionRow.session_name || '').startsWith('official_'))
                .map((sessionRow) => ensureOfficialWebhookSubscription(sessionRow, 'list_sessions'))
        );

        // 5. Only expose official integrations in the current product flow.
        const finalSessions = uniqueDBSessions
            .filter((ds) => ds.provider_type === 'official' || String(ds.session_name || '').startsWith('official_'))
            .map((ds) => {
                const rawStatus = String(ds.status || '').toUpperCase();
                const hasOfficialCredentials = Boolean(ds.phone_number_id && ds.cloud_access_token);
                const hasActiveSubscription = String(ds.subscription_status || '').toLowerCase() === 'active';
                const resolvedStatus =
                    hasOfficialCredentials && hasActiveSubscription
                        ? 'WORKING'
                        : (rawStatus === 'ACTIVE' ? 'WORKING' : (ds.status || 'WORKING'));

                return {
                name: ds.session_name,
                status: resolvedStatus,
                config: {},
                me: null,
                wp_db_id: ds.id,
                wp_id: ds.id,
                expires_at: ds.expires_at,
                plan_days: ds.plan_days,
                subscription_status: ds.subscription_status || 'unknown',
                db_status: ds.status || 'unknown',
                engine_override: ds.engine_override || null,
                provider_type: ds.provider_type || 'official',
                waba_id: ds.waba_id || null,
                phone_number_id: ds.phone_number_id || null,
                is_shared: ds.user_id !== userId
            }});

        res.json(finalSessions);
    } catch (err) {
        console.error("Get Sessions Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get WhatsApp Config (Owner or Team Member with Access)
router.get('/config/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);

        const userId = payload.sub;
        const userEmail = payload.email;
        req.user = { ...req.user, id: userId, email: userEmail };

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        try {
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS pro_plus_mode boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS order_business_type text DEFAULT 'ecommerce'`);
        } catch (e) {
            console.warn("[WhatsApp] GET migration failed:", e.message);
        }

        const configResult = await pgClient.query(
            `SELECT w.*, u.message_credit 
             FROM whatsapp_message_database w
             LEFT JOIN user_configs u ON u.user_id::text = w.user_id::text
             WHERE w.id = $1`,
            [parseInt(id, 10)]
        );

        if (configResult.rowCount === 0) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const row = configResult.rows[0];

        if (row.provider_type === 'official' || String(row.session_name || '').startsWith('official_')) {
            await ensureOfficialWebhookSubscription(row, 'get_config');
        }

        const authorization = await requireWhatsAppResource(req, res, row.session_name, 'ai_settings', 'view');
        if (!authorization) return;

        if (!authorization.isOwner) {
            delete row.api_key;
            delete row.cloud_access_token;
        }

        res.json(row);
    } catch (err) {
        console.error("Get WhatsApp Config Error:", err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/order-states', authMiddleware, async (req, res) => {
    try {
        const sessionName = String(req.query.session_name || '').trim();
        const section = String(req.query.section || '').trim();
        const from = req.query.from ? Number(req.query.from) : null;
        const to = req.query.to ? Number(req.query.to) : null;
        const limit = req.query.limit ? Number(req.query.limit) : 200;
        if (!sessionName) return res.status(400).json({ error: 'session_name is required' });
        if (!await requireWhatsAppResource(req, res, sessionName, 'orders', 'view_all')) return;

        const rows = await orderService.listOrderStates({
            platform: 'whatsapp',
            pageId: sessionName,
            section: section || null,
            from,
            to,
            limit
        });
        res.json(rows);
    } catch (err) {
        console.error('WhatsApp order states error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/orders', authMiddleware, async (req, res) => {
    try {
        await ensureWhatsAppOrderColumns();
        const sessionName = String(req.query.session_name || '').trim();
        const from = req.query.from ? Number(req.query.from) : null;
        const to = req.query.to ? Number(req.query.to) : null;
        const businessType = String(req.query.business_type || '').trim().toLowerCase();

        if (!sessionName) {
            return res.status(400).json({ error: 'session_name is required' });
        }

        let authorization = await authorizeWhatsAppResource(req, sessionName, 'orders', 'view_all');
        let assignedOnly = false;
        if (!authorization?.authorized) {
            authorization = await authorizeWhatsAppResource(req, sessionName, 'orders', 'view_assigned');
            if (!authorization?.authorized) return res.status(403).json({ error: 'Forbidden' });
            assignedOnly = !authorization.isOwner;
        }

        const values = [authorization.resourceId];
        const conditions = ['o.session_name = $1'];
        let idx = 2;
        if (assignedOnly) {
            conditions.push(`EXISTS (SELECT 1 FROM team_order_assignments toa WHERE LOWER(toa.owner_email) = LOWER($${idx}) AND toa.source = 'whatsapp' AND toa.resource_id = $1 AND toa.order_identity = o.id::text AND LOWER(toa.member_email) = LOWER($${idx + 1}))`);
            values.push(authorization.ownerEmail, authorization.membership.member_email);
            idx += 2;
        }

        if (Number.isFinite(from)) {
            conditions.push(`created_at >= to_timestamp($${idx} / 1000.0)`);
            values.push(from);
            idx += 1;
        }
        if (Number.isFinite(to)) {
            conditions.push(`created_at <= to_timestamp($${idx} / 1000.0)`);
            values.push(to);
            idx += 1;
        }
        if (['ecommerce', 'service', 'appointment'].includes(businessType)) {
            const typeAliases = businessType === 'service'
                ? ['service', 'digital_service']
                : businessType === 'ecommerce'
                    ? ['ecommerce', 'physical_ecommerce']
                    : ['appointment'];
            conditions.push(`COALESCE(o.business_type, 'ecommerce') = ANY($${idx}::text[])`);
            values.push(typeAliases);
            idx += 1;
        }

        const where = conditions.join(' AND ');
        const queryText = `
            SELECT o.id, o.product_name, o.number, o.location, o.product_quantity, o.price, o.created_at, o.sender_id, o.status, COALESCE(o.customer_name, c.name) AS customer_name,
                   COALESCE(o.business_type, 'ecommerce') AS business_type, o.service_name, o.service_package, o.service_details, o.delivery_method,
                   o.appointment_type, o.appointment_date, o.appointment_time, o.appointment_notes, o.assigned_to
            FROM whatsapp_order_tracking o
            LEFT JOIN whatsapp_contacts c ON o.session_name = c.session_name AND o.sender_id = c.phone_number
            WHERE ${where}
            ORDER BY o.created_at DESC
        `;

        try {
            const result = await pgClient.query(queryText, values);
            res.json(result.rows);
        } catch (err) {
            if (err && err.code === '42703') {
                const fallbackQuery = `
                    SELECT id, number, location, product_quantity, price, created_at
                    FROM whatsapp_order_tracking o
                    WHERE ${where}
                    ORDER BY o.created_at DESC
                `;
                const fallbackResult = await pgClient.query(fallbackQuery, values);
                const rows = (fallbackResult.rows || []).map(row => ({
                    ...row,
                    product_name: null
                }));
                res.json(rows);
                return;
            }
            throw err;
        }
    } catch (err) {
        console.error('Get WhatsApp orders error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.patch('/orders/:id/status', authMiddleware, async (req, res) => {
    try {
        await ensureWhatsAppOrderColumns();
        const { id } = req.params;
        const { status } = req.body;
        const allowedStatuses = ['pending', 'ongoing', 'delivered', 'locked', 'cancelled', 'new', 'in_progress', 'waiting_customer', 'completed', 'requested', 'confirmed', 'rescheduled', 'no_show'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const orderResult = await pgClient.query(
            'SELECT session_name FROM whatsapp_order_tracking WHERE id = $1 LIMIT 1',
            [id]
        );
        if (orderResult.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        if (!await requireWhatsAppResource(req, res, orderResult.rows[0].session_name, 'orders', 'assign')) return;

        const result = await pgClient.query(
            `UPDATE whatsapp_order_tracking 
             SET status = $1, updated_at = NOW()
             WHERE id = $2 
             RETURNING *`,
            [status, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ success: true, order: result.rows[0] });
    } catch (err) {
        console.error('Error updating WhatsApp order status:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/messages', authMiddleware, async (req, res) => {
    try {
        const sessionName = String(req.query.session_name || '').trim();
        const from = req.query.from ? Number(req.query.from) : null;
        const to = req.query.to ? Number(req.query.to) : null;
        const senderId = String(req.query.sender_id || '').trim();
        const messageType = String(req.query.message_type || 'all').trim().toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        if (!sessionName) {
            return res.status(400).json({ error: 'session_name is required' });
        }

        if (!await requireWhatsAppResource(req, res, sessionName, 'smart_inbox', 'view')) return;

        if (!Number.isFinite(from) || !Number.isFinite(to)) {
            return res.status(400).json({ error: 'from and to (ms) are required' });
        }

        const dataSenderFilterSql = senderId ? `AND (sender_id = $4 OR recipient_id = $4)` : '';
        const aggregateSenderFilterSql = senderId ? `AND (sender_id = $4 OR recipient_id = $4)` : '';
        const messageTypeFilterSql = buildMessageTypeFilter(messageType);
        const baseParams = senderId
            ? [sessionName, from, to, senderId, limit, offset]
            : [sessionName, from, to, limit, offset];
        const aggregateParams = senderId
            ? [sessionName, from, to, senderId]
            : [sessionName, from, to];

        try {
            // 1. Fetch Paginated Data
            const dataResult = await pgClient.query(
                `
                SELECT id, message_id, timestamp, sender_id, recipient_id, text, reply_by, status, token_usage, model_used
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND timestamp >= $2
                  AND timestamp <= $3
                  ${dataSenderFilterSql}
                  ${messageTypeFilterSql}
                ORDER BY timestamp DESC
                LIMIT ${senderId ? '$5 OFFSET $6' : '$4 OFFSET $5'}
                `,
                baseParams
            );

            // 2. Fetch Total Count for Pagination
            const countResult = await pgClient.query(
                `
                SELECT COUNT(*) AS total
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND timestamp >= $2
                  AND timestamp <= $3
                  ${aggregateSenderFilterSql}
                  ${messageTypeFilterSql}
                `,
                aggregateParams
            );

            // 3. Fetch Filtered Stats
            const statsResult = await pgClient.query(
                `
                SELECT 
                    COUNT(*) AS total_count,
                    SUM(CASE WHEN reply_by = 'bot' THEN 1 ELSE 0 END) AS bot_replies,
                    COALESCE(SUM(token_usage), 0)::int AS total_tokens
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND timestamp >= $2
                  AND timestamp <= $3
                  ${aggregateSenderFilterSql}
                  ${messageTypeFilterSql}
                `,
                aggregateParams
            );

            // 4. Fetch Token Breakdown
            const breakdownResult = await pgClient.query(
                `
                SELECT model_used, SUM(token_usage)::int AS total_tokens
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND timestamp >= $2
                  AND timestamp <= $3
                  ${aggregateSenderFilterSql}
                  ${messageTypeFilterSql}
                  AND reply_by = 'bot'
                  AND token_usage > 0
                GROUP BY model_used
                `,
                aggregateParams
            );

            const tokenBreakdown = {};
            breakdownResult.rows.forEach(row => {
                tokenBreakdown[row.model_used || 'Unknown'] = row.total_tokens;
            });

            const finalTotal = parseInt(countResult.rows[0].total || 0);
            const finalBotReplies = parseInt(statsResult.rows[0].bot_replies || 0);
            const finalTokens = parseInt(statsResult.rows[0].total_tokens || 0);

            res.json({
                data: dataResult.rows,
                total: finalTotal,
                filteredBotReplyCount: finalBotReplies,
                filteredTokenCount: finalTokens,
                tokenBreakdown: tokenBreakdown
            });
        } catch (err) {
            if (err && err.code === '42703') {
                // Fallback for missing columns
                const fallbackResult = await pgClient.query(
                    `
                    SELECT id, message_id, timestamp, sender_id, recipient_id, text, reply_by, status
                    FROM whatsapp_chats
                    WHERE session_name = $1
                      AND timestamp >= $2
                      AND timestamp <= $3
                      ${dataSenderFilterSql}
                      ${messageTypeFilterSql}
                    ORDER BY timestamp DESC
                    LIMIT ${senderId ? '$5 OFFSET $6' : '$4 OFFSET $5'}
                    `,
                    baseParams
                );
                
                const fallbackCount = await pgClient.query(
                    `SELECT COUNT(*) AS total FROM whatsapp_chats WHERE session_name = $1 AND timestamp >= $2 AND timestamp <= $3 ${aggregateSenderFilterSql} ${messageTypeFilterSql}`,
                    aggregateParams
                );

                res.json({
                    data: (fallbackResult.rows || []).map(row => ({
                        ...row,
                        token_usage: 0,
                        model_used: null
                    })),
                    total: parseInt(fallbackCount.rows[0].total || 0),
                    filteredBotReplyCount: 0,
                    filteredTokenCount: 0,
                    tokenBreakdown: {}
                });
                return;
            }
            throw err;
        }
    } catch (err) {
        console.error('Get WhatsApp messages error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const sessionName = String(req.query.session_name || '').trim();

        if (!sessionName) {
            return res.status(400).json({ error: 'session_name is required' });
        }

        if (!await requireWhatsAppResource(req, res, sessionName, 'smart_inbox', 'analytics')) return;

        const countResult = await pgClient.query(
            `
            SELECT COUNT(*)::int AS count
            FROM whatsapp_chats
            WHERE session_name = $1
              AND reply_by = 'bot'
            `,
            [sessionName]
        );

        let tokenResult = { rows: [{ total_tokens: 0 }] };
        try {
            tokenResult = await pgClient.query(
                `
                SELECT COALESCE(SUM(token_usage), 0)::int AS total_tokens
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND token_usage > 0
                `,
                [sessionName]
            );
        } catch (err) {
            if (!(err && err.code === '42703')) {
                throw err;
            }
        }

        const allTimeBotReplies = countResult.rows[0]?.count || 0;
        const allTimeTokenCount = tokenResult.rows[0]?.total_tokens || 0;

        res.json({ allTimeBotReplies, allTimeTokenCount });
    } catch (err) {
        console.error('Get WhatsApp stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/contacts', authMiddleware, async (req, res) => {
    try {
        const sessionName = String(req.query.session_name || '').trim();

        if (!sessionName) {
            return res.status(400).json({ error: 'session_name is required' });
        }

        const userId = req.user.id;
        const userEmail = req.user.email;

        const allowed = await hasSessionAccess(sessionName, userId, userEmail);
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = await pgClient.query(
            `
            SELECT phone_number, is_locked
            FROM whatsapp_contacts
            WHERE session_name = $1
              AND is_locked = true
            `,
            [sessionName]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Get WhatsApp contacts error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/contacts/lock', authMiddleware, async (req, res) => {
    try {
        const sessionName = String(req.body.session_name || '').trim();
        const phoneNumber = String(req.body.phone_number || '').trim();
        const isLocked = Boolean(req.body.is_locked);

        if (!sessionName || !phoneNumber) {
            return res.status(400).json({ error: 'session_name and phone_number are required' });
        }

        const userId = req.user.id;
        const userEmail = req.user.email;

        const allowed = await hasSessionAccess(sessionName, userId, userEmail);
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await pgClient.query(
            `
            INSERT INTO whatsapp_contacts (session_name, phone_number, is_locked, last_interaction)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (session_name, phone_number)
            DO UPDATE SET is_locked = EXCLUDED.is_locked, last_interaction = EXCLUDED.last_interaction
            `,
            [sessionName, phoneNumber, isLocked]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Update WhatsApp contact lock error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/session-name/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id || Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const result = await pgClient.query(
            'SELECT session_name FROM whatsapp_message_database WHERE id = $1',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Not found' });
        }

        res.json({ session_name: result.rows[0].session_name });
    } catch (err) {
        console.error('Get WhatsApp session name error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update WhatsApp Config (Owner or Team Member with Access)
router.put('/config/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);

        const userId = payload.sub;
        const userEmail = payload.email;
        req.user = { ...req.user, id: userId, email: userEmail };

        const configResult = await pgClient.query(
            'SELECT * FROM whatsapp_message_database WHERE id = $1',
            [parseInt(id, 10)]
        );

        if (configResult.rowCount === 0) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const row = configResult.rows[0];
        if (!await requireWhatsAppResource(req, res, row.session_name, 'ai_settings', 'manage')) return;

        const allowedKeys = [
            'reply_message',
            'swipe_reply',
            'image_detection',
            'image_send',
            'order_tracking',
            'audio_detection',
            'file_upload',
            'group_reply',
            'lock_emojis',
            'unlock_emojis',
            'image_prompt',
            'memory_context_name',
            'order_lock_minutes',
            'text_prompt',
            'wait',
            'check_conversion',
            'block_emoji',
            'unblock_emoji',
            'emoji_check_count',
            'ai_provider',
            'api_key',
            'chat_model',
            'vision_model',
            'voice_model',
            'cheap_engine',
            'custom_base_url',
            'temperature',
            'top_p',
            'semantic_cache_enabled',
            'semantic_cache_threshold',
            'embed_enabled',
            'pro_plus_mode',
            'order_business_type',
            'order_email_confirmation_enabled',
            'admin_notification_email',
            'order_reminder_enabled',
            'order_reminder_delay_hours',
            'order_reminder_message'
        ];

        // Ensure new columns exist
        try {
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS ai_provider text`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS chat_model text`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS vision_model text`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS voice_model text`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS custom_base_url text`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS temperature numeric DEFAULT 0.7`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS top_p numeric DEFAULT 0.9`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS semantic_cache_enabled boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS semantic_cache_threshold numeric DEFAULT 0.96`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS embed_enabled boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS cheap_engine boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS pro_plus_mode boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS order_business_type text DEFAULT 'ecommerce'`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS order_email_confirmation_enabled boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS admin_notification_email text`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS order_reminder_enabled boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS order_reminder_delay_hours integer DEFAULT 4`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS order_reminder_message text`);
        } catch (e) {
            console.warn("[WhatsApp] Failed to add migration columns:", e.message);
        }

        const updates = {};
        for (const key of allowedKeys) {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) {
                updates[key] = req.body[key];
            }
        }

        // Map frontend fields to DB columns
        if (req.body.wait_time !== undefined) updates.wait = req.body.wait_time;
        if (req.body.history_limit !== undefined) updates.check_conversion = req.body.history_limit;
        if (req.body.provider !== undefined) updates.ai_provider = req.body.provider;
        if (req.body.chatmodel !== undefined) updates.chat_model = req.body.chatmodel;
        if (req.body.base_url !== undefined) updates.custom_base_url = req.body.base_url;
        if (req.body.ai !== undefined) updates.ai_provider = req.body.ai; // Support Messenger legacy payload name
        if (req.body.chat_model !== undefined) updates.chat_model = req.body.chat_model; // Support Messenger legacy payload name
        if (req.body.voice_model !== undefined) updates.voice_model = req.body.voice_model; // Support Messenger legacy payload name
        updates.pro_plus_mode = true; // force enabled for all users until code unlock changes it

        const keys = Object.keys(updates);
        if (keys.length === 0) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        const setClauses = keys.map((key, index) => `${key} = $${index + 2}`);
        const values = [parseInt(id, 10), ...keys.map(k => updates[k])];

        const updateResult = await pgClient.query(
            `UPDATE whatsapp_message_database SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
            values
        );

        if (updateResult.rowCount > 0) {
            const updatedRow = updateResult.rows[0];
            const cacheKeys = [
                updatedRow.session_name,
                updatedRow.waba_id,
                updatedRow.phone_number_id
            ].filter(Boolean);

            for (const cacheKey of cacheKeys) {
                webhookController.clearPageCache(cacheKey);
            }
        }

        res.json(updateResult.rows[0]);
    } catch (err) {
        console.error("Update WhatsApp Config Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get Pairing Code
router.post('/session/pairing-code', handleLegacyWhatsAppRoute);

// Create Session
router.post('/session/create', handleLegacyWhatsAppRoute);

// Restart Session
router.post('/session/restart', handleLegacyWhatsAppRoute);

// Stop Session
router.post('/session/stop', handleLegacyWhatsAppRoute);

// Renew Session
router.post('/session/renew', handleLegacyWhatsAppRoute);

// Delete Session
router.delete('/session/delete', handleLegacyWhatsAppRoute);

// Legacy contacts shortcut retired.
router.get('/contacts/:sessionName', handleLegacyWhatsAppRoute);

// Toggle Lock Status (Handover)
router.post('/toggle-lock', handleLegacyWhatsAppRoute);

router.get('/download-conversation', authMiddleware, async (req, res) => {
    try {
        const sessionName = String(req.query.session_name || '').trim();
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;

        if (!sessionName || !from || !to) {
            return res.status(400).json({ error: 'session_name, from, and to are required' });
        }
        if (!await requireWhatsAppResource(req, res, sessionName, 'smart_inbox', 'view')) return;

        const conversationHistory = await pgClient.query(
            `SELECT timestamp, reply_by, text, sender_id FROM whatsapp_chats WHERE session_name = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY sender_id, timestamp ASC`,
            [sessionName, from, to]
        );

        let formattedConversation = 'Conversation History:\n\n';
        let currentSenderId = null;

        conversationHistory.rows.forEach(message => {
            if (message.sender_id !== currentSenderId) {
                currentSenderId = message.sender_id;
                formattedConversation += `\n--- User: ${currentSenderId} ---\n\n`;
            }
            const timestamp = new Date(message.timestamp).toLocaleString();
            const sender = message.reply_by === 'bot' ? 'Bot' : 'User';
            formattedConversation += `[${timestamp}] ${sender}: ${message.text}\n`;
        });

        res.setHeader('Content-disposition', `attachment; filename=conversation_${sessionName}.txt`);
        res.setHeader('Content-type', 'text/plain');
        res.charset = 'UTF-8';
        res.write(formattedConversation);
        res.end();

    } catch (err) {
        console.error('Error downloading conversation:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/conversations/:sessionName', authMiddleware, async (req, res) => {
    try {
        const { sessionName } = req.params;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 20), 120);
        if (!await requireWhatsAppResource(req, res, sessionName, 'smart_inbox', 'view')) return;
        const rows = await getSmartInboxConversations(pgClient, 'whatsapp', sessionName, { limit });
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/messages/:sessionName/:senderId', authMiddleware, async (req, res) => {
    try {
        const { sessionName, senderId } = req.params;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 10), 120);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        if (!await requireWhatsAppResource(req, res, sessionName, 'smart_inbox', 'view')) return;
        const { rows } = await pgClient.query(
            `SELECT *
             FROM (
                SELECT
                    id,
                    message_id,
                    CASE WHEN reply_by IN ('bot', 'admin', 'system') THEN 'me' ELSE sender_id END as from,
                    text as body,
                    COALESCE(timestamp, EXTRACT(EPOCH FROM created_at) * 1000) as timestamp,
                    reply_by,
                    status,
                    (reply_by IN ('bot', 'system') OR status = 'reminder') as is_ai
                FROM whatsapp_chats
                WHERE session_name = $1 AND (sender_id = $2 OR recipient_id = $2)
                ORDER BY COALESCE(timestamp, EXTRACT(EPOCH FROM created_at) * 1000) DESC
                LIMIT $3 OFFSET $4
             ) recent_messages
             ORDER BY timestamp ASC`,
            [sessionName, senderId, limit, offset]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/conversations/:sessionName/:senderId/labels', authMiddleware, async (req, res) => {
    try {
        const { sessionName, senderId } = req.params;
        const { labelKey, active } = req.body || {};

        if (typeof active !== 'boolean' || !labelKey) {
            return res.status(400).json({ error: 'labelKey and boolean active are required' });
        }
        if (!await requireWhatsAppResource(req, res, sessionName, 'smart_inbox', 'reply')) return;

        const updatedConversation = await upsertSmartInboxLabel(pgClient, {
            platform: 'whatsapp',
            resourceId: sessionName,
            senderId,
            labelKey,
            isActive: active
        });

        res.json({
            success: true,
            conversation: updatedConversation
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/send', authMiddleware, smartInboxUpload.single('image'), async (req, res) => {
    try {
        const { sessionName, to } = req.body || {};
        const message = String(req.body?.message || '').trim();

        if (!sessionName || !to || (!message && !req.file)) {
            return res.status(400).json({ error: 'sessionName, to and message or image are required' });
        }

        if (!await requireWhatsAppResource(req, res, String(sessionName), 'smart_inbox', 'reply')) return;

        const configResult = await pgClient.query(
            `SELECT session_name, provider_type, phone_number_id, cloud_access_token
             FROM whatsapp_message_database
             WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1
             LIMIT 1`,
            [String(sessionName)]
        );
        const config = configResult.rows[0] || {};
        const resolvedSessionName = String(config.session_name || sessionName);
        const isOfficial = config.provider_type === 'official' && config.phone_number_id && config.cloud_access_token;
        if (!isOfficial) {
            return res.status(400).json({ error: 'Official WhatsApp Cloud API credentials not found for this inbox.' });
        }
        const recipientId = String(to).replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '');
        // #region debug-point E:whatsapp-cross-routing
        reportWhatsAppRoutingDebug('E', 'whatsappRoutes.js:smartInboxSend', 'manual inbox send requested', {
            sessionName: hashRoutingId(resolvedSessionName),
            recipientId: hashRoutingId(recipientId),
            isOfficial,
            hasImage: Boolean(req.file),
            hasText: Boolean(message)
        });
        // #endregion
        const sentParts = [];

        if (req.file) {
            const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
            const imageUrl = await imageService.uploadProductImage(req.file.buffer, req.file.mimetype, `smart-inbox/${String(sessionName)}`, baseUrl);
            const imageResponse = await whatsappCloudService.sendImageMessage(String(config.phone_number_id), String(config.cloud_access_token), recipientId, imageUrl, message || undefined);
            if (!imageResponse) throw new Error('WhatsApp image send failed');
            const imageMessageId = imageResponse?.messages?.[0]?.id || imageResponse?.id || imageResponse?.messageId || `smart_inbox_admin_image_${Date.now()}`;
            const imageText = `[Image Message]\n[Image URL]: ${imageUrl}${message ? `\n${message}` : ''}`;
            await dbService.saveWhatsAppChat({
                session_name: resolvedSessionName,
                sender_id: resolvedSessionName,
                recipient_id: String(to),
                message_id: String(imageMessageId),
                text: imageText,
                timestamp: Date.now(),
                status: 'sent',
                reply_by: 'admin',
                admin_user_id: req.user.id,
                admin_email: String(req.user.email || '').trim().toLowerCase() || null
            });
            sentParts.push({ messageId: imageMessageId, imageUrl, body: imageText });
        }

        if (message && !req.file) {
            const response = await whatsappCloudService.sendTextMessage(String(config.phone_number_id), String(config.cloud_access_token), recipientId, message);
            if (!response) throw new Error('WhatsApp text send failed');
            const messageId = response?.messages?.[0]?.id || response?.id || response?.messageId || `smart_inbox_admin_${Date.now()}`;
            await dbService.saveWhatsAppChat({
                session_name: resolvedSessionName,
                sender_id: resolvedSessionName,
                recipient_id: String(to),
                message_id: String(messageId),
                text: message,
                timestamp: Date.now(),
                status: 'sent',
                reply_by: 'admin',
                admin_user_id: req.user.id,
                admin_email: String(req.user.email || '').trim().toLowerCase() || null
            });
            sentParts.push({ messageId, body: message });
        }

        res.json({
            success: true,
            message: {
                message_id: sentParts[0]?.messageId || null,
                from: 'me',
                body: sentParts.map((part) => part.body).filter(Boolean).join('\n\n'),
                timestamp: Date.now(),
                reply_by: 'admin',
                is_ai: false
            },
            sent: sentParts
        });
    } catch (err) {
        console.error('Error sending WhatsApp smart inbox message:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
