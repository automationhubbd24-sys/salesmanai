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
        const finalPages = uniquePages.map(p => {
            const dbInfo = dbConfigs.find(d => d.page_id === p.page_id);
            // Prioritize page info, merge dbInfo (which has text_prompt, etc.)
            // Note: dbInfo might overwrite some fields if names collide, but usually they are distinct enough
            // page_access_token_message has: page_id, name, email, etc.
            // fb_message_database has: id (pk), page_id, text_prompt
            return {
                ...p,
                ...(dbInfo || {}), // Merge DB info
                is_shared: p.email !== userEmail
            };
        });

        res.json(finalPages);

    } catch (error) {
        console.error("Error fetching Messenger pages:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get Messenger Config (Owner or Team Member with Access)
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

        const keys = Object.keys(updates);
        if (keys.length === 0) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        const setClauses = keys.map((key, index) => `${key} = $${index + 2}`);
        const values = [parseInt(id, 10), ...keys.map(k => updates[k])];

        const updateResult = await pgClient.query(
            `UPDATE fb_message_database SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
            values
        );

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
            'SELECT page_id, email FROM page_access_token_message WHERE page_id = $1',
            [pageId]
        );

        const pageRow = pageResult.rows[0] || null;

        if (!pageRow) {
            return res.status(404).json({ error: 'Page not found' });
        }

        if (pageRow.email !== userEmail) {
            return res.status(403).json({ error: 'Forbidden' });
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
            SELECT id, page_id, created_at, reply_by, token, ai_model, message, sender
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
