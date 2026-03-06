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

        const requestedOwner = req.query?.team_owner || req.headers['x-team-owner'];

        console.log(`[GET /pages] User: ${userEmail}, RequestedOwner: ${requestedOwner}`);

        // 2. Fetch Personal Pages
        // Only if Personal Context (no requestedOwner or requestedOwner is self)
        let myPages = [];
        if (!requestedOwner || requestedOwner === userEmail) {
            const { rows } = await pgClient.query(
                `SELECT p.*, u.message_credit AS user_message_credit
                 FROM page_access_token_message p
                 LEFT JOIN user_configs u ON u.user_id::text = p.user_id::text
                 WHERE p.email = $1`,
                [userEmail]
            );
            myPages = rows;
            console.log(`[GET /pages] Personal Pages found: ${myPages.length}`);
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
                 LEFT JOIN user_configs u ON u.user_id::text = p.user_id::text
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
            `INSERT INTO page_access_token_message (page_id, name, page_access_token, email, ai, chat_model, cheap_engine)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (page_id) DO UPDATE SET
                name = EXCLUDED.name,
                page_access_token = EXCLUDED.page_access_token,
                email = EXCLUDED.email`,
            [String(page_id), name, page_access_token, ownerEmail, 'google', 'gemini-2.5-flash', true]
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

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

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
            'SELECT page_id, email, page_access_token, api_key, ai, chat_model, cheap_engine FROM page_access_token_message WHERE page_id = $1',
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
                cheap_engine: pageRow.cheap_engine !== undefined ? pageRow.cheap_engine : configRow.cheap_engine
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

        console.log(`[PUT /config/:id] Body:`, req.body);

        // 1. Update fb_message_database (Settings)
        const allowedKeys = [
            'reply_message', 'swipe_reply', 'image_detection', 'image_send', 'template', 'order_tracking',
            'block_emoji', 'unblock_emoji', 'check_conversion', 'text_prompt', 'image_prompt', 'wait',
            'memory_context_name', 'order_lock_minutes', 'audio_detection'
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

        // Map frontend fields to DB columns
        const aiProvider = req.body.ai_provider || req.body.ai || req.body.provider;
        const chatModel = req.body.chat_model || req.body.model || req.body.model_name;
        const apiKey = req.body.api_key;
        const pageAccessToken = req.body.page_access_token_message || req.body.page_access_token;
        const cheapEngine = req.body.cheap_engine;
        const customBaseUrl = req.body.custom_base_url;

        console.log(`[PUT /config/:id] Token Updates - API Key: ${apiKey ? 'Provided' : 'Missing'}, Provider: ${aiProvider}, Model: ${chatModel}`);

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
        if (cheapEngine !== undefined) {
            tokenUpdates.push(`cheap_engine = $${tIdx}`);
            tokenValues.push(cheapEngine);
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
                        cheap_engine: updatedTokenRow.cheap_engine
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
            SELECT id, product_name, number, location, product_quantity, price, created_at, sender_id
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        if (!pageId) {
            return res.status(400).json({ error: 'page_id is required' });
        }

        if (!from || !to) {
            return res.status(400).json({ error: 'from and to are required ISO date strings' });
        }

        // 1. Fetch Paginated Data
        const dataResult = await pgClient.query(
            `
            SELECT id, page_id, created_at, reply_by, token, ai_model, text, sender_id, timestamp, status
            FROM fb_chats
            WHERE page_id = $1
              AND (created_at >= $2::timestamptz OR timestamp >= EXTRACT(EPOCH FROM $2::timestamptz) * 1000)
              AND (created_at <= $3::timestamptz OR timestamp <= EXTRACT(EPOCH FROM $3::timestamptz) * 1000)
            ORDER BY created_at DESC, timestamp DESC
            LIMIT $4 OFFSET $5
            `,
            [pageId, from, to, limit, offset]
        );

        // 2. Fetch Total Count for Pagination
        const countResult = await pgClient.query(
            `
            SELECT COUNT(*) AS total
            FROM fb_chats
            WHERE page_id = $1
              AND (created_at >= $2::timestamptz OR timestamp >= EXTRACT(EPOCH FROM $2::timestamptz) * 1000)
              AND (created_at <= $3::timestamptz OR timestamp <= EXTRACT(EPOCH FROM $3::timestamptz) * 1000)
            `,
            [pageId, from, to]
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
            `,
            [pageId, from, to]
        );

        // 4. Fetch Token Breakdown for the range
        const breakdownResult = await pgClient.query(
            `
            SELECT ai_model, SUM(token)::int AS total_tokens
            FROM fb_chats
            WHERE page_id = $1
              AND (created_at >= $2::timestamptz OR timestamp >= EXTRACT(EPOCH FROM $2::timestamptz) * 1000)
              AND (created_at <= $3::timestamptz OR timestamp <= EXTRACT(EPOCH FROM $3::timestamptz) * 1000)
              AND reply_by = 'bot'
              AND token > 0
            GROUP BY ai_model
            `,
            [pageId, from, to]
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

module.exports = router;
