const express = require('express');
const router = express.Router();
const dbService = require('../services/dbService');
const pgClient = require('../services/pgClient');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');

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
        }

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { rows: myPages } = await pgClient.query(
            'SELECT * FROM page_access_token_message WHERE email = $1',
            [userEmail]
        );

        // 3. Fetch Shared Pages (Team Members)
        let sharedPageIds = [];
        if (userEmail) {
            const { rows: teamData } = await pgClient.query(
                'SELECT permissions, owner_email FROM team_members WHERE member_email = $1 AND status = $2',
                [userEmail, 'active']
            );

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
                'SELECT * FROM page_access_token_message WHERE page_id = ANY($1::text[])',
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
                'SELECT * FROM fb_message_database WHERE page_id = ANY($1::text[])',
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
                        `INSERT INTO fb_message_database (page_id, text_prompt)
                         VALUES ($1, $2)
                         RETURNING *`,
                        [p.page_id, 'You are a helpful sales assistant.']
                    );
                    dbInfo = insertRes.rows[0];
                } catch (err) {
                    console.error("Error auto-creating fb config:", err);
                }
            }

            finalPages.push({
                ...p,
                ...(dbInfo || {}),
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
    try {
        const { page_id, name, page_access_token, email } = req.body;

        if (!page_id || !name || !page_access_token || !email) {
            return res.status(400).json({ error: 'page_id, name, page_access_token, and email are required' });
        }

        const existsResult = await pgClient.query(
            'SELECT id FROM fb_message_database WHERE page_id = $1 LIMIT 1',
            [String(page_id)]
        );

        let dbId = null;

        if (existsResult.rows.length === 0) {
            const insertResult = await pgClient.query(
                `INSERT INTO fb_message_database (page_id, text_prompt)
                 VALUES ($1, $2)
                 RETURNING id`,
                [String(page_id), 'You are a helpful sales assistant.']
            );
            dbId = insertResult.rows[0].id;
        } else {
            dbId = existsResult.rows[0].id;
        }

        const ownerEmail = email.toLowerCase();

        await pgClient.query(
            `INSERT INTO page_access_token_message (page_id, name, page_access_token, email)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (page_id) DO UPDATE SET
                name = EXCLUDED.name,
                page_access_token = EXCLUDED.page_access_token,
                email = EXCLUDED.email`,
            [String(page_id), name, page_access_token, ownerEmail]
        );

        res.json({ id: dbId });
    } catch (error) {
        console.error('Error saving Messenger page (manual):', error);
        res.status(500).json({ error: error.message });
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

        let configRow = null;

        // Try lookup by primary key (id) first IF it looks like a database integer (not a page ID)
        // Assume database IDs are relatively small (e.g. < 2 billion), while Page IDs are huge strings
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
            // Fallback: Try lookup by page_id (in case id passed is actually page_id string)
            // Use TRIM to handle potential whitespace issues
            const configByPageId = await pgClient.query(
                'SELECT * FROM fb_message_database WHERE page_id = $1',
                [id]
            );
            if (configByPageId.rowCount > 0) {
                configRow = configByPageId.rows[0];
            }
        }

        if (!configRow) {
            // Second Fallback: Auto-create if page exists in page_access_token_message but config missing
             const pageExists = await pgClient.query(
                'SELECT page_id FROM page_access_token_message WHERE page_id = $1',
                [id]
            );
            
            if (pageExists.rowCount > 0) {
                 try {
                    const insertRes = await pgClient.query(
                        `INSERT INTO fb_message_database (page_id, text_prompt)
                         VALUES ($1, $2)
                         RETURNING *`,
                        [id, 'You are a helpful sales assistant.']
                    );
                    configRow = insertRes.rows[0];
                } catch (err) {
                    console.error("Error auto-creating fb config in /config/:id:", err);
                }
            } else {
                 // Final attempt: Check if the ID was actually a DB ID but missed (unlikely if isInteger logic holds)
                 // Or maybe page_access_token_message has it but we missed it?
                 // No further fallback possible without valid page_id
            }
        }

        if (!configRow) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const pageId = configRow.page_id;

        const pageResult = await pgClient.query(
            'SELECT page_id, email FROM page_access_token_message WHERE page_id = $1',
            [pageId]
        );

        const pageRow = pageResult.rows[0] || null;

        let allowed = false;

        if (pageRow && pageRow.email === userEmail) {
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

        res.json(configRow);
    } catch (error) {
        console.error("Error fetching Messenger config:", error);
        res.status(500).json({ error: error.message });
    }
});

// Update Messenger Config (Owner or Team Member with Access)
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

        const userEmail = payload.email;

        const configResult = await pgClient.query(
            'SELECT * FROM fb_message_database WHERE id = $1',
            [parseInt(id, 10)]
        );

        if (configResult.rowCount === 0) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const configRow = configResult.rows[0];

        const pageId = configRow.page_id;

        const pageResult = await pgClient.query(
            'SELECT page_id, email FROM page_access_token_message WHERE page_id = $1',
            [pageId]
        );

        const pageRow = pageResult.rows[0] || null;

        let allowed = false;

        if (pageRow && pageRow.email === userEmail) {
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

        const allowedKeys = [
            'reply_message',
            'swipe_reply',
            'image_detection',
            'image_send',
            'template',
            'order_tracking',
            'block_emoji',
            'unblock_emoji',
            'check_conversion',
            'text_prompt',
            'image_prompt',
            'wait',
            'memory_context_name',
            'order_lock_minutes'
        ];

        const updates = {};
        for (const key of allowedKeys) {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) {
                updates[key] = req.body[key];
            }
        }

        // Handle AI Provider & API Key updates separately (stored in page_access_token_message)
        const aiProvider = req.body.ai_provider || req.body.ai;
        if (aiProvider || req.body.api_key !== undefined) {
             const tokenUpdates = {};
             if (aiProvider) tokenUpdates.ai = aiProvider;
             if (req.body.api_key !== undefined) tokenUpdates.api_key = req.body.api_key;

             const tokenKeys = Object.keys(tokenUpdates);
             if (tokenKeys.length > 0) {
                 const tokenSet = tokenKeys.map((k, i) => `${k} = $${i + 2}`).join(', ');
                 const tokenValues = [pageId, ...tokenKeys.map(k => tokenUpdates[k])];
                 
                 await pgClient.query(
                     `UPDATE page_access_token_message SET ${tokenSet} WHERE page_id = $1`,
                     tokenValues
                 );
             }
        }

        const keys = Object.keys(updates);
        if (keys.length === 0) {
            // If only AI settings were updated, return success
            if (aiProvider || req.body.api_key !== undefined) {
                 return res.json({ success: true, message: 'AI settings updated' });
            }
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        const setClauses = keys.map((key, index) => `${key} = $${index + 2}`);
        const values = [parseInt(id, 10), ...keys.map(k => updates[k])];

        const updateResult = await pgClient.query(
            `UPDATE fb_message_database SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
            values
        );

        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: 'Config not found or update failed' });
        }

        res.json(updateResult.rows[0]);
    } catch (error) {
        console.error("Error updating Messenger config:", error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/page/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);

        const userEmail = payload.email;

        const pageResult = await pgClient.query(
            'SELECT page_id, email, page_access_token FROM page_access_token_message WHERE page_id = $1',
            [pageId]
        );

        const pageRow = pageResult.rows[0] || null;

        if (!pageRow) {
            return res.status(404).json({ error: 'Page not found' });
        }

        if (pageRow.email !== userEmail) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Unsubscribe App from Facebook Page
        if (pageRow.page_access_token) {
            try {
                const axios = require('axios');
                await axios.delete(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, {
                    params: { access_token: pageRow.page_access_token }
                });
                console.log(`[Facebook] App unsubscribed from page ${pageId}`);
            } catch (fbError) {
                console.error(`[Facebook] Failed to unsubscribe app from page ${pageId}:`, fbError.response?.data || fbError.message);
                // Proceed with deletion even if this fails
            }
        }

        await dbService.deleteMessengerPage(pageId);

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting Messenger page:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

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
            SELECT id, product_name, number, location, product_quantity, price, created_at
            FROM fb_order_tracking
            WHERE ${where}
            ORDER BY created_at DESC
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

        if (!pageId) {
            return res.status(400).json({ error: 'page_id is required' });
        }

        if (!from || !to) {
            return res.status(400).json({ error: 'from and to are required ISO date strings' });
        }

        const result = await pgClient.query(
            `
            SELECT id, page_id, created_at, reply_by, token, ai_model, text as message, sender_id as sender
            FROM fb_chats
            WHERE page_id = $1
              AND created_at >= $2::timestamptz
              AND created_at <= $3::timestamptz
            ORDER BY created_at DESC
            `,
            [pageId, from, to]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Messenger chats error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const pageId = String(req.query.page_id || '').trim();

        if (!pageId) {
            return res.status(400).json({ error: 'page_id is required' });
        }

        const replyResult = await pgClient.query(
            `
            SELECT COUNT(*)::int AS count
            FROM fb_chats
            WHERE page_id = $1
              AND reply_by = 'bot'
            `,
            [pageId]
        );

        // Check if token column exists before querying (backwards compatibility)
        // Or assume it exists since we updated schema.
        // We will assume schema is updated.
        const tokenResult = await pgClient.query(
            `
            SELECT COALESCE(SUM(token), 0)::int AS total_tokens
            FROM fb_chats
            WHERE page_id = $1
              AND token > 0
            `,
            [pageId]
        );

        res.json({
            allTimeBotReplies: replyResult.rows[0]?.count || 0,
            allTimeTokenCount: tokenResult.rows[0]?.total_tokens || 0,
        });
    } catch (err) {
        console.error('Messenger stats error:', err);
        res.status(500).json({ error: err.message });
    }
});
