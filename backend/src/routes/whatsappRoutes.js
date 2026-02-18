const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const whatsappService = require('../services/whatsappService');
const dbService = require('../services/dbService');
const pgClient = require('../services/pgClient');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');

async function hasSessionAccess(sessionName, userId, userEmail) {
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

// WAHA Webhook Listener (POST)
// Endpoint: /whatsapp/webhook
router.post('/webhook', whatsappController.handleWebhook);

// Get Session QR (Real-time)
router.get('/session/qr/:sessionName', async (req, res) => {
    try {
        const { sessionName } = req.params;
        // console.log(`[WhatsApp] Fetching real-time QR for ${sessionName}...`);
        const qr = await whatsappService.getScreenshot(sessionName);
        res.json({ qr_code: qr });
    } catch (err) {
        console.error("Get QR Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get Sessions (Merged with DB Info & Team Permissions)
router.get('/sessions', async (req, res) => {
    try {
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

        const { rows: mySessions } = await pgClient.query(
            'SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email FROM whatsapp_message_database WHERE user_id = $1 OR email = $2',
            [userId, userEmail]
        );

        // 3. Fetch Shared Sessions (Team Members)
        let sharedSessionNames = [];
        if (userEmail) {
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND status = $2',
                [userEmail, 'active']
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
                'SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email FROM whatsapp_message_database WHERE session_name = ANY($1::text[])',
                [sharedSessionNames]
            );
            sharedSessions = sharedData;
        }

        // 4. Combine DB Sessions
        // Deduplicate by ID
        const allDBSessions = [...(mySessions || []), ...sharedSessions];
        const uniqueDBSessions = Array.from(new Map(allDBSessions.map(item => [item.session_name, item])).values());

        // 5. Get WAHA Sessions (Real-time Status)
        let wahaSessions = [];
        try {
            wahaSessions = await whatsappService.getSessions(true);
        } catch (e) {
            console.warn("WAHA Sessions Fetch Failed:", e.message);
        }
        
        // 6. Merge and Format
        const finalSessions = uniqueDBSessions.map(ds => {
            const ws = wahaSessions.find(s => s.name === ds.session_name);
            return {
                name: ds.session_name,
                status: ws ? ws.status : (ds.status || 'STOPPED'), // Use WAHA status if available, else DB
                config: ws ? ws.config : {},
                me: ws ? ws.me : null,
                wp_db_id: ds.id,
                wp_id: ds.id,
                expires_at: ds.expires_at,
                plan_days: ds.plan_days,
                subscription_status: ds.subscription_status || 'unknown',
                db_status: ds.status || 'unknown',
                is_shared: ds.user_id !== userId // Flag if it's a shared session
            };
        });

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

        const configResult = await pgClient.query(
            'SELECT * FROM whatsapp_message_database WHERE id = $1',
            [parseInt(id, 10)]
        );

        if (configResult.rowCount === 0) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const row = configResult.rows[0];

        let allowed = false;
        if (row.user_id === userId || row.email === userEmail) {
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
            SELECT id, product_name, number, location, product_quantity, price, created_at
            FROM whatsapp_order_tracking
            WHERE ${where}
            ORDER BY created_at DESC
        `;

        const result = await pgClient.query(queryText, values);
        res.json(result.rows);
    } catch (err) {
        console.error('Get WhatsApp orders error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/messages', authMiddleware, async (req, res) => {
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

        if (!Number.isFinite(from) || !Number.isFinite(to)) {
            return res.status(400).json({ error: 'from and to (ms) are required' });
        }

        const result = await pgClient.query(
            `
            SELECT id, message_id, timestamp, sender_id, recipient_id, text, reply_by, status, token_usage, model_used
            FROM whatsapp_chats
            WHERE session_name = $1
              AND timestamp >= $2
              AND timestamp <= $3
            ORDER BY timestamp DESC
            `,
            [sessionName, from, to]
        );

        res.json(result.rows);
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

        const tokenResult = await pgClient.query(
            `
            SELECT COALESCE(SUM(token_usage), 0)::int AS total_tokens
            FROM whatsapp_chats
            WHERE session_name = $1
              AND token_usage > 0
            `,
            [sessionName]
        );

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
        if (row.user_id === userId || row.email === userEmail) {
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
            'check_conversion',
            'image_prompt',
            'memory_context_name',
            'order_lock_minutes',
            'text_prompt',
            'wait_time',
            'block_emoji',
            'unblock_emoji',
            'emoji_check_count'
        ];

        const updates = {};
        for (const key of allowedKeys) {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) {
                updates[key] = req.body[key];
            }
        }

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

        res.json(updateResult.rows[0]);
    } catch (err) {
        console.error("Update WhatsApp Config Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get Pairing Code
router.post('/session/pairing-code', async (req, res) => {
    try {
        const { sessionName, phoneNumber } = req.body;
        if (!sessionName || !phoneNumber) {
            return res.status(400).json({ error: "Missing sessionName or phoneNumber" });
        }
        
        console.log(`[WhatsApp] Requesting Pairing Code for ${sessionName} (Phone: ${phoneNumber})...`);

        // --- Switch to Pairing Mode Config (Ubuntu/Chrome) if needed ---
        try {
            // Check current config
            const currentSession = await whatsappService.getSession(sessionName);
            const currentDeviceName = currentSession?.config?.client?.deviceName || "";
            
            // If using the "QR Branding" name (or any non-standard name), switch to "Ubuntu"
            // This ensures reliable pairing code generation as WAHA/WhatsApp prefers standard browser agents for this flow.
            if (!currentDeviceName.includes("Ubuntu")) {
                console.log(`[WhatsApp] Switching session '${sessionName}' to Pairing Mode (Ubuntu)...`);
                
                // 1. Stop & Delete
                try { await whatsappService.stopSession(sessionName); } catch (e) {}
                try { await whatsappService.deleteSession(sessionName); } catch (e) {}
                await new Promise(r => setTimeout(r, 1500));

                // 2. Re-create with Ubuntu Config
                const backendWebhookUrl = process.env.BACKEND_URL 
                    ? `${process.env.BACKEND_URL}/whatsapp/webhook`
                    : "https://webhook.salesmanchatbot.online/whatsapp/webhook";

                const pairingConfig = {
                    metadata: {},
                    debug: false,
                    noweb: {
                        markOnline: true,
                        store: { enabled: true, fullSync: true }
                    },
                    webhooks: [
                        {
                            url: backendWebhookUrl,
                            events: ["message", "message.any", "state.change"],
                            retries: { delaySeconds: 2, attempts: 15, policy: "linear" }
                        }
                    ],
                    client: {
                        deviceName: "Ubuntu",
                        browserName: "Chrome"
                    }
                };

                await whatsappService.createSession({ name: sessionName, config: pairingConfig });
                
                // 3. Start and Wait
                await new Promise(r => setTimeout(r, 1000));
                try { await whatsappService.startSession(sessionName); } catch (e) {}
                
                // Wait for 'SCAN_QR_CODE' status
                let attempts = 0;
                while (attempts < 15) {
                    await new Promise(r => setTimeout(r, 1000));
                    try {
                        const s = await whatsappService.getSession(sessionName);
                        if (s.status === 'SCAN_QR_CODE' || s.status === 'WORKING') break;
                    } catch (e) { /* ignore */ }
                    attempts++;
                }
                console.log(`[WhatsApp] Switched to Pairing Mode.`);
            }
        } catch (switchErr) {
            console.warn(`[WhatsApp] Warning: Failed to switch to Pairing Mode config: ${switchErr.message}`);
        }
        // -----------------------------------------------------------

        const code = await whatsappService.getPairingCode(sessionName, phoneNumber);
        
        res.json({ success: true, code: code });
    } catch (err) {
        console.error("Get Pairing Code Error:", err);
        // Extract helpful error message if possible
        const msg = err.response?.data?.error || err.message;
        res.status(500).json({ error: msg });
    }
});

// Create Session
router.post('/session/create', async (req, res) => {
    try {
        const { name, sessionName, config, engine, planDays } = req.body;
        const finalName = (sessionName || name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
        const duration = planDays ? parseInt(planDays) : 30; // Default 30 days
        const selectedEngine = engine || 'WEBJS'; // Default WEBJS if not sent

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);
        const user = { id: payload.sub, email: payload.email };

        // Pricing Logic
        const PRICING = {
            'WEBJS': { 2: 200, 30: 2000, 60: 3500, 90: 4000 },
            'NOWEB': { 2: 100, 30: 500, 60: 900, 90: 1500 }
        };
        
        // Fallback pricing if engine/duration not found
        const enginePricing = PRICING[selectedEngine] || PRICING['WEBJS'];
        const cost = enginePricing[duration] || (duration * 10); // Fallback safe default 

        // Deduct Balance
        try {
            await dbService.deductUserBalance(user.id, cost, `Create WhatsApp Session '${finalName}' (${duration} days, ${selectedEngine})`);
        } catch (paymentError) {
            return res.status(402).json({ error: `Insufficient Balance. Required: ${cost} BDT.` });
        }
        
        // Construct WAHA Config
        const backendWebhookUrl = process.env.BACKEND_URL 
            ? `${process.env.BACKEND_URL}/whatsapp/webhook`
            : "https://webhook.salesmanchatbot.online/whatsapp/webhook";

        const wahaConfig = config || {
            metadata: {},
            debug: false,
            noweb: {
                markOnline: true,
                    store: {
                        enabled: true,
                        fullSync: true
                    }
                },
            webhooks: [
                {
                    url: backendWebhookUrl,
                    events: ["message", "message.any", "state.change"],
                    retries: {
                        delaySeconds: 2,
                        attempts: 15,
                        policy: "linear"
                    },
                    customHeaders: null
                }
            ],
            client: {
                deviceName: "salesmanchatbot.online || wp : +8801956871403",
                browserName: "Chrome"
            }
        };

        // 1. Insert into DB immediately with 'created' status (So card appears in UI)
        console.log(`[WhatsApp] Inserting session '${finalName}' into DB for User ${user.id}...`);
        const dbEntry = await dbService.createWhatsAppEntry(finalName, user.id, duration, 'created', user.email);
        console.log(`[WhatsApp] DB Entry Created: ID=${dbEntry.id}, Session=${dbEntry.session_name}`);

        // 1.5 Insert into public.whatsapp_sessions table (Requested by User)
        try {
            await dbService.createWhatsAppSessionEntry(finalName, user.id, duration, 'created', user.email);
            console.log(`[WhatsApp] Inserted into public.whatsapp_sessions for '${finalName}'`);
        } catch (dbErr) {
            console.warn(`[WhatsApp] Warning: Failed to insert into public.whatsapp_sessions: ${dbErr.message}`);
        }

        // 2. Create Session in WAHA
        console.log(`[WhatsApp] Creating session '${finalName}'...`);
        try {
            await whatsappService.createSession({ name: finalName, config: wahaConfig });
        } catch (wahaError) {
             console.warn(`[WhatsApp] WAHA Create Session warning (might exist): ${wahaError.message}`);
        }

        // 3. Wait for Session to appear and Start it
        let sessionReady = false;
        let attempts = 0;
        let detectedStatus = 'created'; // Default
        const maxAttempts = 20; // 20 seconds timeout

        while (!sessionReady && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
            
            try {
                // Check if session exists and its status
                const allSessions = await whatsappService.getSessions(true);
                const session = allSessions.find(s => s.name === finalName);

                if (session) {
                    console.log(`[WhatsApp] Session '${finalName}' found. Status: ${session.status}`);
                    detectedStatus = session.status; // Capture status
                    
                    if (session.status === 'STOPPED') {
                        console.log(`[WhatsApp] Session '${finalName}' is STOPPED. Starting...`);
                        await whatsappService.startSession(finalName);
                    } else if (session.status === 'STARTING' || session.status === 'SCAN_QR_CODE' || session.status === 'SCAN_QR' || session.status === 'WORKING') {
                         sessionReady = true;
                         console.log(`[WhatsApp] Session '${finalName}' is active/starting.`);
                    } else {
                        console.log(`[WhatsApp] Session '${finalName}' status: ${session.status}. Waiting...`);
                    }
                } else {
                    console.log(`[WhatsApp] Session '${finalName}' not found yet. Attempt ${attempts}/${maxAttempts}`);
                }
            } catch (err) {
                console.warn(`[WhatsApp] Error checking session status: ${err.message}`);
            }
        }

        if (!sessionReady) {
            console.warn(`[WhatsApp] Session '${finalName}' creation/start timed out.`);
        }
        
        // 4. Update DB with final status
        await dbService.updateWhatsAppEntry(dbEntry.id, { 
             status: detectedStatus 
        });
        
        let qr = null;

        // ALWAYS fetch QR Code
        try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            qr = await whatsappService.getScreenshot(finalName);
        } catch (error) {
            console.warn(`[WhatsApp] Failed to fetch QR code: ${error.message}`);
        }

        // Save QR to DB for frontend polling
        if (qr) {
             await dbService.updateWhatsAppEntry(dbEntry.id, { 
                 qr_code: qr,
                 status: 'scanned' 
             });
        }

        res.json({ 
            success: true, 
            id: dbEntry.id,
            wp_db_id: dbEntry.id, // Explicitly return wp_db_id for frontend consistency
            session_name: finalName,
            qr_code: qr
        });
        
    } catch (err) {
        console.error("Create Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Restart Session
router.post('/session/restart', async (req, res) => {
    try {
        const { sessionName } = req.body;
        console.log(`[WhatsApp] Restarting session '${sessionName}'...`);
        
        // 0. Update DB status immediately to 'RESTARTING' to clear 'FAILED' status in UI
        await dbService.updateWhatsAppEntryByName(sessionName, { status: 'RESTARTING' });

        // 1. Try to fetch existing config first (to preserve settings)
        let existingConfig = null;
        try {
            const sessionInfo = await whatsappService.getSession(sessionName);
            if (sessionInfo && sessionInfo.config) {
                existingConfig = sessionInfo.config;
            }
        } catch (e) {
            console.warn(`[WhatsApp] Could not fetch config for restart (will use default): ${e.message}`);
        }

        // 2. Stop & Delete Session (Clean Slate)
        try {
            await whatsappService.stopSession(sessionName);
        } catch (e) { /* Ignore */ }
        
        try {
            await whatsappService.deleteSession(sessionName);
            await new Promise(r => setTimeout(r, 2000)); // Wait for deletion
        } catch (e) { 
             console.warn(`[WhatsApp] Delete failed during restart: ${e.message}`);
        }
        
        // 3. Re-create Session
        const backendWebhookUrl = process.env.BACKEND_URL 
            ? `${process.env.BACKEND_URL}/whatsapp/webhook`
            : "https://webhook.salesmanchatbot.online/whatsapp/webhook";

        const defaultConfig = {
            metadata: {},
            debug: false,
            noweb: {
                markOnline: true,
                store: {
                    enabled: true,
                    fullSync: false
                }
            },
            webhooks: [
                {
                    url: backendWebhookUrl,
                    events: ["message", "message.any", "state.change"],
                    retries: {
                        delaySeconds: 2,
                        attempts: 15,
                        policy: "linear"
                    },
                    customHeaders: null
                }
            ],
            client: {
                deviceName: "salesmanchatbot.online || wp : +8801956871403",
                browserName: "Chrome"
            }
        };

        const finalConfig = existingConfig || defaultConfig;
        
        await whatsappService.createSession({ 
            name: sessionName, 
            config: finalConfig 
        });

        // 4. Start (Just in case create didn't start)
        await new Promise(r => setTimeout(r, 2000));
        try {
             await whatsappService.startSession(sessionName);
        } catch (e) { /* Ignore if already started */ }
        
        res.json({ success: true });
    } catch (err) {
        console.error("Restart Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Stop Session
router.post('/session/stop', async (req, res) => {
    try {
        const { sessionName } = req.body;
        console.log(`[WhatsApp] Stopping session '${sessionName}'...`);
        
        // 1. Try to Stop on WAHA (Best Effort)
        try {
            await whatsappService.stopSession(sessionName);
        } catch (wahaError) {
            console.warn(`[WhatsApp] WAHA Stop failed for '${sessionName}' (ignoring to update DB): ${wahaError.message}`);
        }
        
        // 2. Update DB status immediately (Force Update)
        await dbService.updateWhatsAppEntryByName(sessionName, { 
            status: 'STOPPED', 
            active: false 
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Stop Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Renew Session
router.post('/session/renew', async (req, res) => {
    try {
        const { sessionName, days } = req.body;
        if (!sessionName || !days) return res.status(400).json({ error: "Missing sessionName or days" });

        // Pricing Logic (Configurable)
        const PLAN_COSTS = {
            1: 10,   // 1 Day = 10 Credits/Balance
            30: 200, // 30 Days = 200 Credits/Balance
            60: 350,
            90: 500
        };

        const cost = PLAN_COSTS[days] || (days * 10); // Fallback to 10 per day

        const pgClient = require('../services/pgClient');

        const sessionRes = await pgClient.query(
            'SELECT user_id FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1',
            [sessionName]
        );

        if (sessionRes.rows.length === 0 || !sessionRes.rows[0].user_id) {
            return res.status(404).json({ error: "Session not found" });
        }

        const session = sessionRes.rows[0];

        // 2. Deduct Balance
        try {
            await dbService.deductUserBalance(session.user_id, cost, `Renew Session ${sessionName} for ${days} days`);
        } catch (paymentError) {
            return res.status(402).json({ error: `Payment Failed: ${paymentError.message}` });
        }
        
        // 3. Renew
        const result = await dbService.renewWhatsAppSession(sessionName, parseInt(days));
        res.json({ success: true, data: result, cost_deducted: cost });
    } catch (err) {
        console.error("Renew Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Delete Session
router.delete('/session/delete', async (req, res) => {
    try {
        const { sessionName, name } = req.body; // Support both
        const target = sessionName || name;
        
        console.log(`[WhatsApp] Deleting session '${target}'...`);

        // 1. Try Logout (Best Effort)
        try {
            await whatsappService.logoutSession(target);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) { 
            console.warn(`[WhatsApp] Logout failed (ignoring): ${e.message}`);
        }

        // 2. Try Stop (Best Effort)
        try {
            await whatsappService.stopSession(target);
            await new Promise(resolve => setTimeout(resolve, 1000)); 
        } catch (stopErr) {
            console.warn(`[WhatsApp] Stop failed (ignoring): ${stopErr.message}`);
        }

        // 3. Try Delete from WAHA (Best Effort)
        try {
            await whatsappService.deleteSession(target);
        } catch (delErr) {
            console.warn(`[WhatsApp] WAHA Delete failed for '${target}' (might be already gone): ${delErr.message}`);
            // Do NOT throw here, proceed to DB delete
        }
        
        // 4. Always Delete from DB
        await dbService.deleteWhatsAppEntry(target);
        console.log(`[WhatsApp] DB Entry deleted for '${target}'.`);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Delete Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get Contacts (Only Locked Ones for Performance)
router.get('/contacts/:sessionName', async (req, res) => {
    try {
        const { sessionName } = req.params;
        const pgClient = require('../services/pgClient');

        const result = await pgClient.query(
            `SELECT phone_number, is_locked
             FROM whatsapp_contacts
             WHERE session_name = $1 AND is_locked = true`,
            [sessionName]
        );

        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Lock Status (Handover)
router.post('/toggle-lock', async (req, res) => {
    try {
        const { sessionName, phoneNumber, isLocked } = req.body;
        
        if (!sessionName || !phoneNumber || typeof isLocked !== 'boolean') {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const success = await dbService.toggleWhatsAppLock(sessionName, phoneNumber, isLocked);
        
        if (success) {
            res.json({ success: true, isLocked });
        } else {
            res.status(500).json({ error: "Failed to update lock status" });
        }
    } catch (err) {
        console.error("Toggle Lock Error:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
