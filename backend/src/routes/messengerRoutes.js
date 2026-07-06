const express = require('express');
const router = express.Router();
const axios = require('axios');
const dbService = require('../services/dbService');
const pgClient = require('../services/pgClient');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');

const webhookController = require('../controllers/webhookController');
const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v25.0';

async function ensureMessengerPageColumns() {
    await pgClient.query(`
        ALTER TABLE page_access_token_message
        ADD COLUMN IF NOT EXISTS user_access_token text
    `);
}

async function verifyFacebookPageAccessToken(pageId, pageAccessToken) {
    console.log('🔍 [DEBUG] verifyFacebookPageAccessToken called for page ID:', pageId);
    try {
        console.log('🔍 [DEBUG] Calling Facebook Graph API to verify token...');
        const response = await axios.get(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${pageId}`, {
            params: {
                fields: 'id,name',
                access_token: pageAccessToken
            },
            timeout: 15000
        });

        console.log('✅ [DEBUG] Facebook Graph API verify response:', response.data);

        if (!response.data?.id || String(response.data.id) !== String(pageId)) {
            console.error('❌ [DEBUG] Page ID mismatch! Expected:', pageId, 'Got:', response.data?.id);
            throw new Error('Facebook returned a different page ID for this token.');
        }

        console.log('✅ [DEBUG] Token verified successfully for page:', response.data.name);
        return response.data;
    } catch (error) {
        console.error('❌ [DEBUG] Facebook token verification failed!', {
            message: error.message,
            responseData: error.response?.data,
            statusCode: error.response?.status
        });
        const fbError = error.response?.data?.error;
        if (fbError?.code === 190 || fbError?.code === 102) {
            const mappedError = new Error('Invalid or expired Facebook page token. Please reconnect the page and approve all permissions again.');
            mappedError.statusCode = 400;
            throw mappedError;
        }

        if (fbError?.message) {
            const mappedError = new Error(fbError.message);
            mappedError.statusCode = error.response?.status || 400;
            throw mappedError;
        }

        throw error;
    }
}

// Get Messenger Pages (Merged with Team Permissions)
router.get('/pages', async (req, res) => {
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
            console.log(`[GET /pages] JWT Payload - ID: ${userId}, Email: ${userEmail}`);
        }

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const requestedOwner = req.query?.team_owner || req.headers['x-team-owner'];

        console.log(`[GET /pages] User: ${userEmail}, RequestedOwner: ${requestedOwner}`);

        // 2. Fetch Personal Pages
        // Only if Personal Context (no requestedOwner or requestedOwner is self)
        let myPages = [];
        if (!requestedOwner || (userEmail && requestedOwner.toLowerCase() === userEmail.toLowerCase())) {
            const { rows } = await pgClient.query(
                `SELECT p.*, u.message_credit AS user_message_credit
                 FROM page_access_token_message p
                 LEFT JOIN user_configs u ON LOWER(u.email) = LOWER(p.email)
                 WHERE LOWER(p.email) = LOWER($1) OR p.user_id::text = $2`,
                [userEmail, userId]
            );
            myPages = rows;
            console.log(`[GET /pages] Personal Pages found: ${myPages.length} for ${userEmail}`);
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');


        // 3. Fetch Shared Pages (Team Members)
        let sharedPageIds = [];
        if (userEmail && requestedOwner && requestedOwner !== userEmail) {
            console.log(`[GET /pages] Checking team permissions for ${userEmail} in ${requestedOwner}`);
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
                [userEmail, requestedOwner, 'active']
            );
            console.log(`[GET /pages] Team rows found: ${teamData.length}`);

            teamData.forEach(row => {
                if (row.permissions && row.permissions.fb_pages) {
                    const pages = row.permissions.fb_pages;
                    if (Array.isArray(pages)) {
                        sharedPageIds.push(...pages.map(id => String(id)));
                    }
                }
            });
        }

        let sharedPages = [];
        if (sharedPageIds.length > 0) {
            const { rows: sharedData } = await pgClient.query(
                `SELECT p.*, u.message_credit AS user_message_credit
                 FROM page_access_token_message p
                 LEFT JOIN user_configs u ON LOWER(u.email) = LOWER(p.email)
                 WHERE p.page_id = ANY($1::text[])`,
                [sharedPageIds]
            );
            sharedPages = sharedData;
        }

        // 4. Combine
        const allPages = [...(myPages || []), ...sharedPages];
        
        // Deduplicate by page_id
        const uniquePages = Array.from(new Map(allPages.map(item => [item.page_id, item])).values());

        const allPageIds = uniquePages.map(p => p.page_id);
        let dbConfigs = [];
        
        if (allPageIds.length > 0) {
            const { rows: dbData } = await pgClient.query(
                'SELECT id, page_id, text_prompt, reply_message, swipe_reply, image_detection, image_send, template, order_tracking, image_prompt, template_prompt_x1, template_prompt_x2, verified, wait, block_emoji, unblock_emoji, check_conversion, memory_context_name, order_lock_minutes, audio_detection, semantic_cache_enabled, semantic_cache_threshold, embed_enabled, engine_override FROM fb_message_database WHERE page_id = ANY($1::text[])',
                [allPageIds]
            );
            dbConfigs = dbData;
        }

        // 6. Merge and Enhance
        const finalPages = [];
        
        for (const p of uniquePages) {
            let dbInfo = dbConfigs.find(d => d.page_id === p.page_id);
            
            // Auto-create config if missing (Fix for "No configuration found")
            if (!dbInfo) {
                try {
                    const insertRes = await pgClient.query(
                        `INSERT INTO fb_message_database (page_id, text_prompt, engine_override, wait, image_send, image_detection, template)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         RETURNING *`,
                        [p.page_id, 'You are a helpful sales assistant.', 'salesmanchatbot-flash', 2, true, true, true]
                    );
                    dbInfo = insertRes.rows[0];
                } catch (err) {
                    console.error("Error auto-creating fb config:", err);
                }
            }

            finalPages.push({
                ...p,
                ...(dbInfo || {}),
                message_credit: p.user_message_credit !== null && p.user_message_credit !== undefined ? p.user_message_credit : p.message_credit,
                is_shared: p.email !== userEmail
            });
        }

        res.json(finalPages);

    } catch (error) {
        console.error("Error fetching Messenger pages:", error);
        res.status(500).json({ error: error.message });
    }
});

// Manual Upsert for Messenger Pages (Used by Facebook Connect + Manual Flow)
router.post('/pages/manual', authMiddleware, async (req, res) => {
    console.log('🔍 [DEBUG] /api/messenger/pages/manual called with data:', {
        page_id: req.body.page_id,
        name: req.body.name,
        email: req.body.email,
        hasAccessToken: !!req.body.page_access_token
    });
    try {
        const { page_id, name, page_access_token, user_access_token, email } = req.body;
        const userId = req.user.id;

        if (!page_id || !name || !page_access_token || !email) {
            console.log('❌ [DEBUG] Missing required fields!');
            return res.status(400).json({ error: 'page_id, name, page_access_token, and email are required' });
        }

        await ensureMessengerPageColumns();
        console.log('✅ [DEBUG] Step 1: Ensured messenger page columns exist');

        console.log('✅ [DEBUG] Step 2: Starting Facebook token verification...');
        const verifiedPage = await verifyFacebookPageAccessToken(page_id, page_access_token);
        console.log('✅ [DEBUG] Step 2: Token verified successfully!', verifiedPage);

        console.log('✅ [DEBUG] Step 3: Checking if fb_message_database entry exists...');
        const existsResult = await pgClient.query(
            'SELECT id FROM fb_message_database WHERE page_id = $1 LIMIT 1',
            [String(page_id)]
        );

        let dbId = null;

        if (existsResult.rows.length === 0) {
            const insertResult = await pgClient.query(
                `INSERT INTO fb_message_database (page_id, text_prompt, engine_override, wait, image_send, image_detection, template)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [String(page_id), 'You are a helpful sales assistant.', 'salesmanchatbot-flash', 2, true, true, true]
            );
            dbId = insertResult.rows[0].id;
        } else {
            dbId = existsResult.rows[0].id;
        }

        const ownerEmail = email.toLowerCase();

        // Check if page already exists to avoid giving double free credits
        const pageExists = await pgClient.query(
            'SELECT page_id FROM page_access_token_message WHERE page_id = $1',
            [String(page_id)]
        );

        await pgClient.query(
            `INSERT INTO page_access_token_message (page_id, name, page_access_token, user_access_token, email, user_id, ai, chat_model, cheap_engine, subscription_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (page_id) DO UPDATE SET
                name = EXCLUDED.name,
                page_access_token = EXCLUDED.page_access_token,
                user_access_token = COALESCE(EXCLUDED.user_access_token, page_access_token_message.user_access_token),
                email = EXCLUDED.email,
                user_id = EXCLUDED.user_id,
                subscription_status = EXCLUDED.subscription_status`,
            [
                String(page_id),
                verifiedPage?.name || name,
                page_access_token,
                typeof user_access_token === 'string' && user_access_token.trim() ? user_access_token.trim() : null,
                ownerEmail,
                userId,
                'gemini',
                'salesmanchatbot-flash',
                true,
                'active'
            ]
        );

        // SYNC ALL PRODUCTS TO THIS NEW PAGE ID (Automatic)
        try {
            const allProds = await pgClient.query("SELECT id, allowed_messenger_ids FROM products WHERE user_id::text = $1::text", [userId]);
            for (const prod of allProds.rows) {
                let mIds = Array.isArray(prod.allowed_messenger_ids) ? prod.allowed_messenger_ids : [];
                if (!mIds.includes(String(page_id))) {
                    mIds.push(String(page_id));
                    await pgClient.query("UPDATE products SET allowed_messenger_ids = $1 WHERE id = $2", [JSON.stringify(mIds), prod.id]);
                }
            }
            console.log(`[Messenger] Auto-synced ${allProds.rows.length} products to new page ${page_id}`);
        } catch (syncErr) {
            console.error("[Messenger] Product auto-sync failed:", syncErr.message);
        }

        // --- FREE CREDITS LOGIC: Give 100 credits for new integration ---
        if (pageExists.rowCount === 0) {
            console.log(`[Messenger] New integration detected for ${page_id}. Giving 100 free credits.`);
            try {
                // Check if this page has EVER received free credits to prevent exploit (Connect/Disconnect cycle)
                const alreadyGranted = await pgClient.query(
                    'SELECT id FROM integration_credit_history WHERE integration_id = $1 AND platform = $2',
                    [String(page_id), 'messenger']
                );

                if (alreadyGranted.rowCount === 0) {
                    // Ensure user config exists
                    const userConfig = await pgClient.query(
                        'SELECT user_id, message_credit FROM user_configs WHERE LOWER(email) = LOWER($1) OR user_id::text = $2',
                        [ownerEmail, userId]
                    );

                    if (userConfig.rowCount > 0) {
                        const targetUserId = String(userConfig.rows[0].user_id);
                        
                        // --- FREE CREDITS REMOVED ---
                        // await pgClient.query(
                        //     'UPDATE user_configs SET message_credit = message_credit + 100 WHERE user_id::text = $1',
                        //     [targetUserId]
                        // );
                        
                        // Mark as granted permanently
                        await pgClient.query(
                            'INSERT INTO integration_credit_history (integration_id, platform, user_id, credit_type, amount) VALUES ($1, $2, $3, $4, $5)',
                            [String(page_id), 'messenger', targetUserId, 'welcome_bonus', 100]
                        );

                        console.log(`[Messenger] Added 100 free credits to user ${targetUserId} and logged to history.`);
                    }
                } else {
                    console.log(`[Messenger] Page ${page_id} already received welcome bonus in the past. Skipping credit grant.`);
                }
            } catch (creditErr) {
                console.error('[Messenger] Failed to grant free credits:', creditErr.message);
                // Attempt to create history table if it doesn't exist
                if (creditErr.message.includes('relation "integration_credit_history" does not exist')) {
                    try {
                        await pgClient.query(`
                            CREATE TABLE IF NOT EXISTS integration_credit_history (
                                id SERIAL PRIMARY KEY,
                                integration_id TEXT NOT NULL,
                                platform TEXT NOT NULL,
                                user_id TEXT NOT NULL,
                                credit_type TEXT NOT NULL,
                                amount INTEGER DEFAULT 0,
                                granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                            );
                            CREATE INDEX IF NOT EXISTS idx_integration_credit_history_id ON integration_credit_history(integration_id);
                        `);
                        console.log("[Messenger] Created integration_credit_history table.");
                    } catch (tableErr) {
                        console.error("[Messenger] Failed to create credit history table:", tableErr.message);
                    }
                }
            }
        }

        webhookController.clearPageCache(page_id);

        res.json({ id: dbId });
    } catch (error) {
        console.error('Error saving Messenger page (manual):', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

// Get Messenger Config (Owner or Team Member with Access)
router.get('/config/:id', async (req, res) => {
    try {
        let { id } = req.params;
        id = String(id).trim(); // Sanitize input
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);

        const userEmail = payload.email;

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        console.log(`[GET /config/:id] Request ID: ${id}, User: ${userEmail}`);

        // Ensure columns exist in page_access_token_message (Migration on the fly)
        try {
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS custom_base_url text`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS cheap_engine boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS voice_model text`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS vision_model text`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS pro_plus_mode boolean DEFAULT false`);
        } catch (e) {
            console.warn("[Messenger] GET migration failed:", e.message);
        }

        // Try lookup by page_id (String) first since that's what the frontend mostly sends
        const configByPageId = await pgClient.query(
            'SELECT * FROM fb_message_database WHERE page_id = $1 OR CAST(id AS TEXT) = $1',
            [id]
        );

        if (configByPageId.rowCount > 0) {
            configRow = configByPageId.rows[0];
            console.log(`[GET /config/:id] Found config for: ${id}`);
        }

        if (!configRow) {
            // Check if page exists in page_access_token_message but config missing
            const pageExists = await pgClient.query(
                'SELECT page_id FROM page_access_token_message WHERE page_id = $1',
                [id]
            );
            
            if (pageExists.rowCount > 0) {
                console.log(`[GET /config/:id] Config missing for page ${id}. Auto-creating...`);
                try {
                    const insertRes = await pgClient.query(
                        `INSERT INTO fb_message_database (page_id, text_prompt, engine_override, wait, image_send, image_detection, template)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         RETURNING *`,
                        [id, 'You are a helpful sales assistant.', 'salesmanchatbot-flash', 2, true, true, true]
                    );
                    configRow = insertRes.rows[0];
                    console.log(`[GET /config/:id] Auto-created config for Page ID: ${id}`);
                } catch (err) {
                    console.error("Error auto-creating fb config in GET:", err);
                }
            } else {
                 // Final attempt: Check if the ID was actually a DB ID but missed
                 console.log(`[GET /config/:id] Page not found in token table for ID: ${id}`);
            }
        }

        if (!configRow) {
            console.warn(`[GET /config/:id] Final Result: Config not found for ${id}`);
            return res.status(404).json({ error: 'Config not found' });
        }

        const pageId = configRow.page_id;

        const pageResult = await pgClient.query(
            'SELECT page_id, email, page_access_token, api_key, ai, chat_model, voice_model, vision_model, cheap_engine, custom_base_url, pro_plus_mode FROM page_access_token_message WHERE page_id = $1',
            [pageId]
        );

        const pageRow = pageResult.rows[0] || null;

        let allowed = false;

        // Case insensitive email check
        if (pageRow && pageRow.email && pageRow.email.toLowerCase() === userEmail.toLowerCase()) {
            allowed = true;
        }

        if (!allowed && userEmail) {
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND status = $2',
                [userEmail, 'active']
            );

            for (const t of teamData) {
                const pages = t.permissions && Array.isArray(t.permissions.fb_pages)
                    ? t.permissions.fb_pages
                    : [];
                if (pages.map(String).includes(String(pageId))) {
                    allowed = true;
                    break;
                }
            }
        }

        if (!allowed) {
            console.warn(`[GET /config/:id] Forbidden. Page Owner: ${pageRow?.email}, User: ${userEmail}`);
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Merge credentials from page_access_token_message into configRow
        if (pageRow) {
            configRow = {
                ...configRow,
                api_key: pageRow.api_key || configRow.api_key,
                ai_provider: pageRow.ai || configRow.ai_provider,
                chat_model: pageRow.chat_model || configRow.chat_model,
                voice_model: pageRow.voice_model || configRow.voice_model,
                vision_model: pageRow.vision_model || configRow.vision_model,
                cheap_engine: pageRow.cheap_engine !== undefined ? pageRow.cheap_engine : configRow.cheap_engine,
                custom_base_url: pageRow.custom_base_url || configRow.custom_base_url,
                pro_plus_mode: pageRow.pro_plus_mode !== undefined ? pageRow.pro_plus_mode : configRow.pro_plus_mode
            };
        }

        res.json(configRow);
    } catch (error) {
        console.error("Error fetching Messenger config:", error);
        res.status(500).json({ error: error.message });
    }
});

// Update Messenger Config (Owner or Team Member with Access)
router.put('/config/:id', async (req, res) => {
    try {
        let { id } = req.params;
        id = String(id).trim();
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);

        const userEmail = payload.email;

        let configRow = null;

        // Try lookup by primary key (id) first IF it looks like a database integer
        const isInteger = /^\d+$/.test(id) && Number(id) < 2147483647;

        if (isInteger) {
            const configResult = await pgClient.query(
                'SELECT * FROM fb_message_database WHERE id = $1',
                [parseInt(id, 10)]
            );
             if (configResult.rowCount > 0) {
                configRow = configResult.rows[0];
            }
        }

        if (!configRow) {
            // Fallback: Try lookup by page_id
            const configByPageId = await pgClient.query(
                'SELECT * FROM fb_message_database WHERE page_id = $1',
                [id]
            );
            if (configByPageId.rowCount > 0) {
                configRow = configByPageId.rows[0];
            }
        }

        if (!configRow) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const pageId = configRow.page_id;
        const dbId = configRow.id;

        // Check Permissions
        const pageResult = await pgClient.query(
            'SELECT page_id, email FROM page_access_token_message WHERE page_id = $1',
            [pageId]
        );
        
        const pageRow = pageResult.rows[0];
        let allowed = false;

        if (pageRow && pageRow.email && userEmail && pageRow.email.toLowerCase() === userEmail.toLowerCase()) {
            allowed = true;
        }

        if (!allowed && userEmail) {
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND status = $2',
                [userEmail, 'active']
            );

            for (const t of teamData) {
                const pages = t.permissions && Array.isArray(t.permissions.fb_pages)
                    ? t.permissions.fb_pages
                    : [];
                if (pages.map(String).includes(String(pageId))) {
                    allowed = true;
                    break;
                }
            }
        }

        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        console.log(`[PUT /config/:id] Body:`, req.body);

        // 1. Update fb_message_database (Settings)
        const allowedKeys = [
            'reply_message', 'swipe_reply', 'image_detection', 'image_send', 'template', 'order_tracking',
            'block_emoji', 'unblock_emoji', 'check_conversion', 'text_prompt', 'image_prompt', 'wait',
            'temperature', 'top_p',
            'memory_context_name', 'order_lock_minutes', 'audio_detection',
            'semantic_cache_enabled', 'semantic_cache_threshold', 'embed_enabled',
            'order_email_confirmation_enabled', 'admin_notification_email',
            'order_reminder_enabled', 'order_reminder_delay_hours', 'order_reminder_message'
        ];

        // Ensure new columns exist (Migration on the fly)
        try {
            await pgClient.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='temperature') THEN
                        ALTER TABLE fb_message_database ADD COLUMN temperature numeric DEFAULT 0.7;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='top_p') THEN
                        ALTER TABLE fb_message_database ADD COLUMN top_p numeric DEFAULT 0.9;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='audio_detection') THEN
                        ALTER TABLE fb_message_database ADD COLUMN audio_detection boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='semantic_cache_enabled') THEN
                        ALTER TABLE fb_message_database ADD COLUMN semantic_cache_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='semantic_cache_threshold') THEN
                        ALTER TABLE fb_message_database ADD COLUMN semantic_cache_threshold numeric DEFAULT 0.96;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='embed_enabled') THEN
                        ALTER TABLE fb_message_database ADD COLUMN embed_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_email_confirmation_enabled') THEN
                        ALTER TABLE fb_message_database ADD COLUMN order_email_confirmation_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='admin_notification_email') THEN
                        ALTER TABLE fb_message_database ADD COLUMN admin_notification_email text;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_reminder_enabled') THEN
                        ALTER TABLE fb_message_database ADD COLUMN order_reminder_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_reminder_delay_hours') THEN
                        ALTER TABLE fb_message_database ADD COLUMN order_reminder_delay_hours integer DEFAULT 4;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_reminder_message') THEN
                        ALTER TABLE fb_message_database ADD COLUMN order_reminder_message text;
                    END IF;

                    -- User Configs Pricing Columns
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='subscription_plan') THEN
                        ALTER TABLE user_configs ADD COLUMN subscription_plan TEXT DEFAULT 'none';
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='daily_limit') THEN
                        ALTER TABLE user_configs ADD COLUMN daily_limit numeric DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='daily_used') THEN
                        ALTER TABLE user_configs ADD COLUMN daily_used numeric DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='monthly_limit') THEN
                        ALTER TABLE user_configs ADD COLUMN monthly_limit numeric DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='monthly_used') THEN
                        ALTER TABLE user_configs ADD COLUMN monthly_used numeric DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='bonus_credit') THEN
                        ALTER TABLE user_configs ADD COLUMN bonus_credit numeric DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='permanent_credit') THEN
                        ALTER TABLE user_configs ADD COLUMN permanent_credit numeric DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='last_reset_at') THEN
                        ALTER TABLE user_configs ADD COLUMN last_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_configs' AND column_name='last_monthly_reset_at') THEN
                        ALTER TABLE user_configs ADD COLUMN last_monthly_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                    END IF;
                END $$;
            `);
        } catch (e) {
            console.warn("[Messenger] Migration failed (on-the-fly):", e.message);
        }

        const updates = [];
        const values = [];
        let idx = 1;

        for (const key of Object.keys(req.body)) {
            if (allowedKeys.includes(key)) {
                updates.push(`${key} = $${idx}`);
                values.push(req.body[key]);
                idx++;
            }
        }

        let updatedConfig = configRow;

        if (updates.length > 0) {
            values.push(dbId);
            const queryText = `
                UPDATE fb_message_database
                SET ${updates.join(', ')}
                WHERE id = $${idx}
                RETURNING *
            `;
            try {
                const updateResult = await pgClient.query(queryText, values);
                if (updateResult.rowCount > 0) {
                    updatedConfig = updateResult.rows[0];
                }
            } catch (err) {
                console.error("Failed to update fb_message_database:", err);
                throw err;
            }
        }

        // 2. Update page_access_token_message (AI Credentials & Page Access Token)
        const tokenUpdates = [];
        const tokenValues = [];
        let tIdx = 1;

        // Ensure columns exist
        try {
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS custom_base_url text`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS cheap_engine boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS voice_model text`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS vision_model text`);
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS pro_plus_mode boolean DEFAULT false`);
        } catch (e) {
            console.warn("[Messenger] Failed to add migration columns:", e.message);
        }

        // Map frontend fields to DB columns
        const aiProvider = req.body.ai_provider || req.body.ai || req.body.provider;
        const chatModel = req.body.chat_model || req.body.model || req.body.model_name;
        const voiceModel = req.body.voice_model || req.body.audio_model;
        const visionModel = req.body.vision_model || req.body.image_model;
        const apiKey = req.body.api_key;
        const pageAccessToken = req.body.page_access_token_message || req.body.page_access_token;
        const cheapEngine = req.body.cheap_engine;
        const customBaseUrl = req.body.custom_base_url;
        const proPlusMode = req.body.pro_plus_mode;

        console.log(`[PUT /config/:id] Token Updates - API Key: ${apiKey ? 'Provided' : 'Missing'}, Provider: ${aiProvider}, Model: ${chatModel}, Voice Model: ${voiceModel || 'unchanged'}`);

        if (aiProvider !== undefined) {
            tokenUpdates.push(`ai = $${tIdx}`);
            tokenValues.push(aiProvider);
            tIdx++;
        }
        if (chatModel !== undefined) {
            tokenUpdates.push(`chat_model = $${tIdx}`);
            tokenValues.push(chatModel);
            tIdx++;
        }
        if (voiceModel !== undefined) {
            tokenUpdates.push(`voice_model = $${tIdx}`);
            tokenValues.push(voiceModel);
            tIdx++;
        }
        if (visionModel !== undefined) {
            tokenUpdates.push(`vision_model = $${tIdx}`);
            tokenValues.push(visionModel);
            tIdx++;
        }
        if (apiKey !== undefined) {
            tokenUpdates.push(`api_key = $${tIdx}`);
            tokenValues.push(apiKey);
            tIdx++;
        }
        if (pageAccessToken !== undefined) {
            tokenUpdates.push(`page_access_token = $${tIdx}`);
            tokenValues.push(pageAccessToken);
            tIdx++;
        }
        if (cheapEngine !== undefined) {
            tokenUpdates.push(`cheap_engine = $${tIdx}`);
            tokenValues.push(cheapEngine);
            tIdx++;
        }
        if (proPlusMode !== undefined) {
            tokenUpdates.push(`pro_plus_mode = $${tIdx}`);
            tokenValues.push(proPlusMode);
            tIdx++;
        }
        // Always update custom_base_url (can be null)
        if (customBaseUrl !== undefined) {
             tokenUpdates.push(`custom_base_url = $${tIdx}`);
             tokenValues.push(customBaseUrl);
             tIdx++;
        }

        if (tokenUpdates.length > 0) {
            tokenValues.push(pageId);
            const tokenQuery = `
                UPDATE page_access_token_message
                SET ${tokenUpdates.join(', ')}
                WHERE page_id = $${tIdx}
                RETURNING *
            `;
            try {
                const tokenRes = await pgClient.query(tokenQuery, tokenValues);
                console.log(`[PUT /config/:id] Updated token table for Page ${pageId}. Rows: ${tokenRes.rowCount}. Updates:`, tokenUpdates);
                
                // If updated, merge into response
                if (tokenRes.rowCount > 0) {
                     const updatedTokenRow = tokenRes.rows[0];
                     updatedConfig = {
                        ...updatedConfig,
                        api_key: updatedTokenRow.api_key,
                        ai_provider: updatedTokenRow.ai,
                        chat_model: updatedTokenRow.chat_model,
                        voice_model: updatedTokenRow.voice_model,
                        vision_model: updatedTokenRow.vision_model,
                        cheap_engine: updatedTokenRow.cheap_engine,
                        custom_base_url: updatedTokenRow.custom_base_url,
                        pro_plus_mode: updatedTokenRow.pro_plus_mode
                     };
                } else {
                    console.warn(`[PUT /config/:id] Failed to update token table for Page ${pageId}. Row not found?`);
                }
            } catch (err) {
                console.error("Failed to update page_access_token_message:", err);
                // Should we throw error here? Or proceed?
                // If token update fails, the AI settings are NOT saved. We should probably return error.
                throw err;
            }
        }

        if (tokenUpdates.length > 0 || updates.length > 0) {
            webhookController.clearPageCache(pageId);
        }

        res.json(updatedConfig);
    } catch (error) {
        console.error("Error updating Messenger config:", error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/pages/:pageId', async (req, res) => {
    try {
        let { pageId } = req.params;
        pageId = String(pageId).trim();
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);

        const userEmail = payload.email;

        // Resolve pageId if it is a DB ID
        const isInteger = /^\d+$/.test(pageId) && Number(pageId) < 2147483647;
        if (isInteger) {
             const dbRes = await pgClient.query('SELECT page_id FROM fb_message_database WHERE id = $1', [parseInt(pageId, 10)]);
             if (dbRes.rows.length > 0) {
                 pageId = dbRes.rows[0].page_id;
             }
        }

        const pageResult = await pgClient.query(
                    'SELECT page_id, email, page_access_token FROM page_access_token_message WHERE page_id = $1',
                    [pageId]
                );

                const pageRow = pageResult.rows[0] || null;

                // Log for debugging
                console.log(`[DELETE /pages/:pageId] ID: ${pageId}, User: ${userEmail}, Found: ${!!pageRow}, Owner: ${pageRow?.email}`);

                if (!pageRow) {
                    // Even if page not found in token table, try to delete from other tables if it looks like a Page ID
                    // But we can't verify ownership if pageRow is missing.
                    // However, if the user is asking to delete a "ghost" page, we might want to allow it?
                    // But for security, we should probably require it to exist in page_access_token_message OR check team permissions?
                    // If it's not in page_access_token_message, it won't be in the list?
                    // But if we resolved it from fb_message_database, it might exist there.
                    
                    // Let's assume strict ownership check for now.
                    console.warn(`[DELETE] Page ${pageId} not found in page_access_token_message.`);
                    return res.status(404).json({ error: 'Page not found' });
                }

                // Fix case sensitivity check
                if (pageRow.email && pageRow.email.toLowerCase() !== userEmail.toLowerCase()) {
                    console.warn(`[DELETE] Forbidden. Owner: ${pageRow.email}, Request: ${userEmail}`);
                    return res.status(403).json({ error: 'Forbidden' });
                }

                // Unsubscribe App from Facebook Page
                if (pageRow.page_access_token) {
                    try {
                        const axios = require('axios');
                        await axios.delete(`https://graph.facebook.com/v25.0/${pageId}/subscribed_apps`, {
                            params: { access_token: pageRow.page_access_token }
                        });
                        console.log(`[Facebook] App unsubscribed from page ${pageId}`);
                    } catch (fbError) {
                        console.error(`[Facebook] Failed to unsubscribe app from page ${pageId}:`, fbError.response?.data || fbError.message);
                        // Proceed with deletion even if this fails
                    }
                }

                await dbService.deleteMessengerPage(pageId);
                webhookController.clearPageCache(pageId);

                res.json({ success: true });
    } catch (error) {
        console.error("Error deleting Messenger page:", error);
        res.status(500).json({ error: error.message });
    }
});


router.get('/orders', authMiddleware, async (req, res) => {
    try {
        const pageId = String(req.query.page_id || '').trim();
        const from = req.query.from ? Number(req.query.from) : null;
        const to = req.query.to ? Number(req.query.to) : null;

        if (!pageId) {
            return res.status(400).json({ error: 'page_id is required' });
        }

        const values = [pageId];
        const conditions = ['page_id = $1'];
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
            SELECT o.id, o.product_name, o.number, o.location, o.product_quantity, o.price, o.created_at, o.sender_id, o.status, o.is_locked, o.customer_name
            FROM fb_order_tracking o
            WHERE o.${where.replace(/page_id/g, 'page_id').replace(/created_at/g, 'o.created_at')}
            ORDER BY o.created_at DESC
        `;

        const result = await pgClient.query(queryText, values);
        res.json(result.rows);
    } catch (err) {
        console.error('Messenger orders error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/chats', authMiddleware, async (req, res) => {
    try {
        const pageId = String(req.query.page_id || '').trim();
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;
        const senderId = String(req.query.sender_id || '').trim();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        if (!pageId) {
            return res.status(400).json({ error: 'page_id is required' });
        }

        if (!from || !to) {
            return res.status(400).json({ error: 'from and to are required ISO date strings' });
        }

        const senderFilterSql = senderId ? `AND (sender_id = $6 OR recipient_id = $6)` : '';
        const baseParams = senderId
            ? [pageId, from, to, limit, offset, senderId]
            : [pageId, from, to, limit, offset];
        const aggregateParams = senderId
            ? [pageId, from, to, senderId]
            : [pageId, from, to];

        // 1. Fetch Paginated Data
        const dataResult = await pgClient.query(
            `
            SELECT id, page_id, created_at, reply_by, token, ai_model, text, sender_id, timestamp, status
            FROM fb_chats
            WHERE page_id = $1
              AND (created_at >= $2::timestamptz OR timestamp >= EXTRACT(EPOCH FROM $2::timestamptz) * 1000)
              AND (created_at <= $3::timestamptz OR timestamp <= EXTRACT(EPOCH FROM $3::timestamptz) * 1000)
              ${senderFilterSql}
            ORDER BY created_at DESC, timestamp DESC
            LIMIT $4 OFFSET $5
            `,
            baseParams
        );

        // 2. Fetch Total Count for Pagination
        const countResult = await pgClient.query(
            `
            SELECT COUNT(*) AS total
            FROM fb_chats
            WHERE page_id = $1
              AND (created_at >= $2::timestamptz OR timestamp >= EXTRACT(EPOCH FROM $2::timestamptz) * 1000)
              AND (created_at <= $3::timestamptz OR timestamp <= EXTRACT(EPOCH FROM $3::timestamptz) * 1000)
              ${senderId ? `AND (sender_id = $4 OR recipient_id = $4)` : ''}
            `,
            aggregateParams
        );

        // 3. Fetch Filtered Stats (Total for the selected range)
        const statsResult = await pgClient.query(
            `
            SELECT 
                COUNT(*) AS total_count,
                SUM(CASE WHEN reply_by = 'bot' THEN 1 ELSE 0 END) AS bot_replies,
                COALESCE(SUM(token), 0)::int AS total_tokens
            FROM fb_chats
            WHERE page_id = $1
              AND (created_at >= $2::timestamptz OR timestamp >= EXTRACT(EPOCH FROM $2::timestamptz) * 1000)
              AND (created_at <= $3::timestamptz OR timestamp <= EXTRACT(EPOCH FROM $3::timestamptz) * 1000)
              ${senderId ? `AND (sender_id = $4 OR recipient_id = $4)` : ''}
            `,
            aggregateParams
        );

        // 4. Fetch Token Breakdown for the range
        const breakdownResult = await pgClient.query(
            `
            SELECT ai_model, SUM(token)::int AS total_tokens
            FROM fb_chats
            WHERE page_id = $1
              AND (created_at >= $2::timestamptz OR timestamp >= EXTRACT(EPOCH FROM $2::timestamptz) * 1000)
              AND (created_at <= $3::timestamptz OR timestamp <= EXTRACT(EPOCH FROM $3::timestamptz) * 1000)
              ${senderId ? `AND (sender_id = $4 OR recipient_id = $4)` : ''}
              AND reply_by = 'bot'
              AND token > 0
            GROUP BY ai_model
            `,
            aggregateParams
        );

        const tokenBreakdown = {};
        breakdownResult.rows.forEach(row => {
            tokenBreakdown[row.ai_model || 'Unknown'] = row.total_tokens;
        });

        const finalTotal = parseInt(countResult.rows[0].total || 0);
        const finalBotReplies = parseInt(statsResult.rows[0].bot_replies || 0);
        const finalTokens = parseInt(statsResult.rows[0].total_tokens || 0);

        console.log(`[GET /chats] Page: ${pageId}, Range: ${from} to ${to}, Found: ${dataResult.rows.length}, Total: ${finalTotal}`);

        res.json({
            data: dataResult.rows,
            total: finalTotal,
            filteredBotReplyCount: finalBotReplies,
            filteredTokenCount: finalTokens,
            tokenBreakdown: tokenBreakdown
        });
    } catch (err) {
        console.error('Messenger chats error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/stats', authMiddleware, async (req, res) => {
    console.log(`[GET /stats] Request for page_id: ${req.query.page_id}`);
    try {
        const pageId = String(req.query.page_id || '').trim();

        if (!pageId) {
            console.warn('[GET /stats] Missing page_id');
            return res.status(400).json({ error: 'page_id is required' });
        }

        console.log('[GET /stats] Querying reply count...');
        const replyResult = await pgClient.query(
            `
            SELECT COUNT(*)::int AS count
            FROM fb_chats
            WHERE page_id = $1
              AND reply_by = 'bot'
            `,
            [pageId]
        );
        console.log('[GET /stats] Reply count result:', replyResult.rows[0]);

        console.log('[GET /stats] Querying token count...');
        const tokenResult = await pgClient.query(
            `
            SELECT COALESCE(SUM(token), 0)::int AS total_tokens
            FROM fb_chats
            WHERE page_id = $1
              AND token > 0
            `,
            [pageId]
        );
        console.log('[GET /stats] Token count result:', tokenResult.rows[0]);

        res.json({
            allTimeBotReplies: replyResult.rows[0]?.count || 0,
            allTimeTokenCount: tokenResult.rows[0]?.total_tokens || 0,
        });
    } catch (err) {
        console.error('Messenger stats error:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

router.patch('/orders/:id/status', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const allowedStatuses = ['ongoing', 'delivered', 'locked', 'cancelled'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const isLocked = (status === 'delivered' || status === 'locked');

        const result = await pgClient.query(
            `UPDATE fb_order_tracking 
             SET status = $1, is_locked = $2, updated_at = NOW() 
             WHERE id = $3 
             RETURNING *`,
            [status, isLocked, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ success: true, order: result.rows[0] });
    } catch (err) {
        console.error('Error updating order status:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/download-conversation', authMiddleware, async (req, res) => {
    try {
        const pageId = String(req.query.page_id || '').trim();
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;

        if (!pageId || !from || !to) {
            return res.status(400).json({ error: 'page_id, from, and to are required' });
        }

        const conversationHistory = await pgClient.query(
            `SELECT created_at, reply_by, text, sender_id FROM fb_chats WHERE page_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY sender_id, created_at ASC`,
            [pageId, from, to]
        );

        let formattedConversation = 'Conversation History:\n\n';
        let currentSenderId = null;

        conversationHistory.rows.forEach(message => {
            if (message.sender_id !== currentSenderId) {
                currentSenderId = message.sender_id;
                formattedConversation += `\n--- User: ${currentSenderId} ---\n\n`;
            }
            const timestamp = new Date(message.created_at).toLocaleString();
            const sender = message.reply_by === 'bot' ? 'Bot' : 'User';
            formattedConversation += `[${timestamp}] ${sender}: ${message.text}\n`;
        });

        res.setHeader('Content-disposition', `attachment; filename=conversation_${pageId}.txt`);
        res.setHeader('Content-type', 'text/plain');
        res.charset = 'UTF-8';
        res.write(formattedConversation);
        res.end();

    } catch (err) {
        console.error('Error downloading conversation:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/conversations/:pageId', authMiddleware, async (req, res) => {
    try {
        const { pageId } = req.params;
        const { rows } = await pgClient.query(
            `SELECT DISTINCT ON (sender_id) 
                sender_id as from, 
                text as body, 
                created_at as timestamp,
                reply_by
             FROM fb_chats 
             WHERE page_id = $1 
             ORDER BY sender_id, created_at DESC`,
            [pageId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/messages/:pageId/:senderId', authMiddleware, async (req, res) => {
    try {
        const { pageId, senderId } = req.params;
        const { rows } = await pgClient.query(
            `SELECT 
                CASE WHEN reply_by = 'bot' THEN 'me' WHEN reply_by = 'admin' THEN 'me' ELSE sender_id END as from,
                text as body,
                created_at as timestamp,
                (reply_by = 'bot') as is_ai
             FROM fb_chats 
             WHERE page_id = $1 AND (sender_id = $2 OR recipient_id = $2)
             ORDER BY created_at ASC`,
            [pageId, senderId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
