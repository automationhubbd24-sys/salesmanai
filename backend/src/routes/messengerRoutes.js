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

        console.log(`[GET /config/:id] Request ID: ${id}, User: ${userEmail}`);

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
                console.log(`[GET /config/:id] Found by DB ID: ${id}`);
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
                console.log(`[GET /config/:id] Found by Page ID: ${id}`);
            }
        }

        if (!configRow) {
            console.log(`[GET /config/:id] Config not found for ${id}. Attempting auto-create...`);
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
                    console.log(`[GET /config/:id] Auto-created config for Page ID: ${id}`);
                } catch (err) {
                    console.error("Error auto-creating fb config in /config/:id:", err);
                }
            } else {
                 // Final attempt: Check if the ID was actually a DB ID but missed (unlikely if isInteger logic holds)
                 console.log(`[GET /config/:id] Page not found in token table for ID: ${id}`);
            }
        }

        if (!configRow) {
            console.warn(`[GET /config/:id] Final Result: Config not found for ${id}`);
            return res.status(404).json({ error: 'Config not found' });
        }

        const pageId = configRow.page_id;

        const pageResult = await pgClient.query(
            'SELECT page_id, email FROM page_access_token_message WHERE page_id = $1',
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

        // 1. Update fb_message_database (Settings)
        const allowedKeys = [
            'reply_message', 'swipe_reply', 'image_detection', 'image_send', 'template', 'order_tracking',
            'block_emoji', 'unblock_emoji', 'check_conversion', 'text_prompt', 'image_prompt', 'wait',
            'memory_context_name', 'order_lock_minutes'
        ];

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
            const updateResult = await pgClient.query(queryText, values);
            if (updateResult.rowCount > 0) {
                updatedConfig = updateResult.rows[0];
            }
        }

        // 2. Update page_access_token_message (AI Credentials & Page Access Token)
        const tokenUpdates = [];
        const tokenValues = [];
        let tIdx = 1;

        // Map frontend fields to DB columns
        const aiProvider = req.body.ai_provider || req.body.ai || req.body.provider;
        const chatModel = req.body.chat_model || req.body.model;
        const apiKey = req.body.api_key;
        const pageAccessToken = req.body.page_access_token_message || req.body.page_access_token;

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

        if (tokenUpdates.length > 0) {
            tokenValues.push(pageId);
            const tokenQuery = `
                UPDATE page_access_token_message
                SET ${tokenUpdates.join(', ')}
                WHERE page_id = $${tIdx}
            `;
            try {
                await pgClient.query(tokenQuery, tokenValues);
            } catch (err) {
                console.error("Failed to update page_access_token_message:", err);
            }
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
