const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const commentAutomationService = require('../services/commentAutomationService');

const facebookService = require('../services/facebookService');
const pgClient = require('../services/pgClient');

const recentInstagramWebhookLogs = [];
const MAX_INSTAGRAM_WEBHOOK_LOGS = 50;

function addInstagramWebhookLog(payload) {
    recentInstagramWebhookLogs.unshift({
        id: Date.now() + Math.random().toString(36).slice(2, 7),
        timestamp: new Date().toISOString(),
        object: payload?.object,
        sourceId: String(payload?.entry?.[0]?.id || 'unknown'),
        entry_count: Array.isArray(payload?.entry) ? payload.entry.length : 0,
        payload
    });
    if (recentInstagramWebhookLogs.length > MAX_INSTAGRAM_WEBHOOK_LOGS) recentInstagramWebhookLogs.pop();
}

function getInstagramWebhookLogs(req, res) {
    const sourceId = req.query.sourceId ? String(req.query.sourceId) : '';
    const logs = sourceId ? recentInstagramWebhookLogs.filter(log => log.sourceId === sourceId) : recentInstagramWebhookLogs;
    res.json({ logs });
}

function verifyInstagramWebhook(req, res) {
    const token = req.query['hub.verify_token'];
    const expected = new Set([
        process.env.INSTAGRAM_VERIFY_TOKEN,
        process.env.FACEBOOK_VERIFY_TOKEN,
        process.env.VERIFY_TOKEN,
        '123456'
    ].filter(Boolean));
    if (req.query['hub.mode'] === 'subscribe' && expected.has(token)) {
        return res.status(200).send(req.query['hub.challenge']);
    }
    return res.sendStatus(403);
}

async function getInstagramConfig(accountId) {
    const result = await pgClient.query(`
        SELECT p.*, d.*,
               p.id AS token_row_id, d.id AS config_id
        FROM page_access_token_message p
        LEFT JOIN fb_message_database d ON d.page_id = p.page_id AND d.platform = 'instagram'
        WHERE p.page_id = $1 AND p.platform = 'instagram'
        LIMIT 1`, [String(accountId)]);
    return result.rows[0] || null;
}

function normalizeAttachments(message) {
    return (message.attachments || [])
        .map((attachment) => attachment.payload?.url || attachment.payload?.src)
        .filter(Boolean);
}

async function processInstagramWebhook(body) {
    for (const entry of body.entry || []) {
        const accountId = String(entry.id || '');
        if (!accountId) continue;
        const config = await getInstagramConfig(accountId);
        if (!config?.page_access_token) continue;

        for (const change of entry.changes || []) {
            if (!['comments', 'feed'].includes(change.field)) continue;
            const value = change.value || {};
            const commentId = value.comment_id || value.id;
            const commenterId = value.from?.id || value.user_id;
            const postId = value.media?.id || value.media_id || value.post_id;
            const commentText = value.text || value.message || '';
            if (!commentId || !commenterId || !postId || String(commenterId) === accountId) continue;
            await commentAutomationService.processCommentAutomationEvent({
                platform: 'instagram',
                accountId,
                postId,
                commentId,
                commenterId,
                commentText,
                accessToken: config.page_access_token,
                accountConfig: config
            });
        }

        for (const event of entry.messaging || []) {
            if (event.message?.is_echo || !event.sender?.id || !event.message) continue;
            const senderId = String(event.sender.id);
            const messageId = String(event.message.mid || `instagram_${Date.now()}_${senderId}`);
            const text = String(event.message.text || '').trim();
            const imageUrls = normalizeAttachments(event.message);
            if (!text && !imageUrls.length) continue;

            const bodyText = [text, ...imageUrls.map((url) => `[Image URL]: ${url}`)].filter(Boolean).join('\n');
            await dbService.saveFbChat({
                page_id: accountId,
                sender_id: senderId,
                recipient_id: accountId,
                message_id: messageId,
                text: bodyText,
                timestamp: Number(event.timestamp) || Date.now(),
                status: 'received',
                reply_by: 'user',
                platform: 'instagram'
            });

            if (!text && imageUrls.length && !config.image_detection) continue;
            const history = await dbService.getFbChatHistory(accountId, senderId, 12, 'instagram');
            const result = await aiService.generateResponse({
                pageId: accountId,
                userId: senderId,
                userMessage: text || 'The customer sent an image.',
                history,
                imageUrls,
                audioUrls: [],
                config,
                platform: 'instagram'
            });
            const reply = typeof result === 'string' ? result : (result?.reply || result?.reply_text || '');
            if (!reply) continue;

            const sent = await facebookService.sendInstagramMessage(accountId, senderId, reply, config.page_access_token);
            await dbService.saveFbChat({
                page_id: accountId,
                sender_id: accountId,
                recipient_id: senderId,
                message_id: String(sent?.message_id || `instagram_bot_${Date.now()}`),
                text: reply,
                timestamp: Date.now(),
                status: 'sent',
                reply_by: 'bot',
                token: Number(result?.token || result?.tokens || 0),
                ai_model: result?.model || result?.ai_model || config.chat_model,
                platform: 'instagram'
            });
        }
    }
}

async function handleInstagramWebhook(req, res) {
    addInstagramWebhookLog(req.body);
    res.status(200).send('EVENT_RECEIVED');
    if (req.body?.object !== 'instagram') return;
    processInstagramWebhook(req.body).catch((error) => {
        console.error('[Instagram Webhook] Background processing failed:', error.message);
    });
}

module.exports = { verifyInstagramWebhook, handleInstagramWebhook, processInstagramWebhook, getInstagramWebhookLogs };
