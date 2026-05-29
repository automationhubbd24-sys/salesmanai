const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const whatsappCloudController = require('../controllers/whatsappCloudController');
const webhookController = require('../controllers/webhookController');
const pgClient = require('../services/pgClient');
const dbService = require('../services/dbService');
const whatsappCloudService = require('../services/whatsappCloudService');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');

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

function getOfficialWebhookSubscriptionOptions() {
    const baseUrl = process.env.PUBLIC_BASE_URL
        || process.env.BACKEND_URL
        || 'https://webhook.salesmanchatbot.online';
    const callbackBaseUrl = String(baseUrl).replace(/\/+$/, '');
    const verifyToken = process.env.WHATSAPP_OFFICIAL_VERIFY_TOKEN
        || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        || process.env.FACEBOOK_VERIFY_TOKEN
        || process.env.VERIFY_TOKEN
        || 'salesman_monster_wa_2026_official';

    const isPublicHttps = /^https:\/\//i.test(callbackBaseUrl);

    return {
        overrideCallbackUri: isPublicHttps ? `${callbackBaseUrl}/webhook/whatsapp` : null,
        verifyToken
    };
}

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

async function hasSessionAccess(sessionName, userId, userEmail) {
    await ensureOfficialWhatsAppColumns();

    const configResult = await pgClient.query(
        'SELECT user_id, email, session_name FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1',
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
            try {
                await whatsappCloudService.unsubscribeAppFromWaba(row.waba_id, row.cloud_access_token);
            } catch (unsubscribeError) {
                console.warn(`[WhatsApp Official] Failed to unsubscribe app from WABA ${row.waba_id}:`, unsubscribeError.response?.data || unsubscribeError.message);
            }
        }

        await dbService.deleteWhatsAppEntry(row.session_name);
        whatsappController.clearPageCache(row.session_name);
        if (row.waba_id) {
            whatsappController.clearPageCache(row.waba_id);
        }
        if (row.phone_number_id) {
            whatsappController.clearPageCache(row.phone_number_id);
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
            const { rows } = await pgClient.query(
                'SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email, engine_override, provider_type, waba_id, phone_number_id, cloud_access_token FROM whatsapp_message_database WHERE user_id::uuid = $1::uuid OR email = $2',
                [userId, userEmail]
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

        // 4. Combine DB Sessions
        // Deduplicate by session_name
        const allDBSessions = [...(mySessions || []), ...sharedSessions];
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

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        try {
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS pro_plus_mode boolean DEFAULT false`);
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

        let allowed = false;
        if (row.user_id === userId || (row.email && userEmail && row.email.toLowerCase() === userEmail.toLowerCase())) {
            allowed = true;
        }

        if (!allowed && userEmail) {
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND status = $2',
                [userEmail, 'active']
            );

            for (const t of teamData) {
                const sessions = t.permissions && Array.isArray(t.permissions.wa_sessions)
                    ? t.permissions.wa_sessions
                    : [];
                if (sessions.includes(row.session_name)) {
                    allowed = true;
                    break;
                }
            }
        }

        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json(row);
    } catch (err) {
        console.error("Get WhatsApp Config Error:", err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/orders', authMiddleware, async (req, res) => {
    try {
        const sessionName = String(req.query.session_name || '').trim();
        const from = req.query.from ? Number(req.query.from) : null;
        const to = req.query.to ? Number(req.query.to) : null;

        if (!sessionName) {
            return res.status(400).json({ error: 'session_name is required' });
        }

        const userId = req.user.id;
        const userEmail = req.user.email;

        const allowed = await hasSessionAccess(sessionName, userId, userEmail);
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const values = [sessionName];
        const conditions = ['session_name = $1'];
        let idx = 2;

        if (Number.isFinite(from)) {
            conditions.push(`created_at >= to_timestamp($${idx} / 1000.0)`);
            values.push(from);
            idx += 1;
        }
        if (Number.isFinite(to)) {
            conditions.push(`created_at <= to_timestamp($${idx} / 1000.0)`);
            values.push(to);
        }

        const where = conditions.join(' AND ');
        const queryText = `
            SELECT id, product_name, number, location, product_quantity, price, created_at, sender_id, status
            FROM whatsapp_order_tracking
            WHERE ${where}
            ORDER BY created_at DESC
        `;

        try {
            const result = await pgClient.query(queryText, values);
            res.json(result.rows);
        } catch (err) {
            if (err && err.code === '42703') {
                const fallbackQuery = `
                    SELECT id, number, location, product_quantity, price, created_at
                    FROM whatsapp_order_tracking
                    WHERE ${where}
                    ORDER BY created_at DESC
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
        const { id } = req.params;
        const { status } = req.body;
        const allowedStatuses = ['pending', 'ongoing', 'delivered', 'locked', 'cancelled'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const result = await pgClient.query(
            `UPDATE whatsapp_order_tracking 
             SET status = $1
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

        if (!sessionName) {
            return res.status(400).json({ error: 'session_name is required' });
        }

        const userId = req.user.id;
        const userEmail = req.user.email;

        const allowed = await hasSessionAccess(sessionName, userId, userEmail);
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!Number.isFinite(from) || !Number.isFinite(to)) {
            return res.status(400).json({ error: 'from and to (ms) are required' });
        }

        try {
            const result = await pgClient.query(
                `
                SELECT id, message_id, timestamp, sender_id, recipient_id, text, reply_by, status, token_usage, model_used
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND timestamp >= $2
                  AND timestamp <= $3
                  ${senderId ? `AND (sender_id = $4 OR recipient_id = $4)` : ''}
                ORDER BY timestamp DESC
                `,
                senderId ? [sessionName, from, to, senderId] : [sessionName, from, to]
            );

            res.json(result.rows);
        } catch (err) {
            if (err && err.code === '42703') {
                const fallbackResult = await pgClient.query(
                    `
                    SELECT id, message_id, timestamp, sender_id, recipient_id, text, reply_by, status
                    FROM whatsapp_chats
                    WHERE session_name = $1
                      AND timestamp >= $2
                      AND timestamp <= $3
                      ${senderId ? `AND (sender_id = $4 OR recipient_id = $4)` : ''}
                    ORDER BY timestamp DESC
                    `,
                    senderId ? [sessionName, from, to, senderId] : [sessionName, from, to]
                );
                const rows = (fallbackResult.rows || []).map(row => ({
                    ...row,
                    token_usage: 0,
                    model_used: null
                }));
                res.json(rows);
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

        const userId = req.user.id;
        const userEmail = req.user.email;

        const allowed = await hasSessionAccess(sessionName, userId, userEmail);
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

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

        const configResult = await pgClient.query(
            'SELECT * FROM whatsapp_message_database WHERE id = $1',
            [parseInt(id, 10)]
        );

        if (configResult.rowCount === 0) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const row = configResult.rows[0];

        let allowed = false;
        if (row.user_id === userId || (row.email && userEmail && row.email.toLowerCase() === userEmail.toLowerCase())) {
            allowed = true;
        }

        if (!allowed && userEmail) {
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND status = $2',
                [userEmail, 'active']
            );

            for (const t of teamData) {
                const sessions = t.permissions && Array.isArray(t.permissions.wa_sessions)
                    ? t.permissions.wa_sessions
                    : [];
                if (sessions.includes(row.session_name)) {
                    allowed = true;
                    break;
                }
            }
        }

        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

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
            'order_email_confirmation_enabled',
            'admin_notification_email'
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
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS order_email_confirmation_enabled boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS admin_notification_email text`);
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
            whatsappController.clearPageCache(updateResult.rows[0].session_name);
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

module.exports = router;
