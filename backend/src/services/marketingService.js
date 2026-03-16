const dbService = require('./dbService');
const aiService = require('./aiService');
const facebookService = require('./facebookService');
const whatsappService = require('./whatsappService');
const { query } = require('./pgClient');

class MarketingService {
    constructor() {
        this.campaignQueue = [];
        this.isProcessing = false;
        this.batchSize = 5; // Process 5 messages at a time to avoid CPU spikes
        this.delayBetweenMessages = 15000; // 15 seconds average delay
    }

    /**
     * Start a new bulk campaign
     */
    async startCampaign(campaignData) {
        const { userId, pageId, platform, message, imageUrl, excludeBuyers, range } = campaignData;

        // 0. Ensure tables exist (On-the-fly migration)
        try {
            await query(`
                CREATE TABLE IF NOT EXISTS bulk_campaigns (
                    id SERIAL PRIMARY KEY,
                    user_id UUID,
                    page_id TEXT,
                    platform TEXT,
                    message TEXT,
                    image_url TEXT,
                    exclude_buyers BOOLEAN DEFAULT TRUE,
                    status TEXT DEFAULT 'processing',
                    total_messages INTEGER DEFAULT 0,
                    sent_messages INTEGER DEFAULT 0,
                    failed_messages INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS bulk_messages (
                    id SERIAL PRIMARY KEY,
                    campaign_id INTEGER REFERENCES bulk_campaigns(id) ON DELETE CASCADE,
                    recipient_id TEXT,
                    status TEXT,
                    error_message TEXT,
                    sent_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
        } catch (e) {
            console.warn("[Marketing] Migration failed:", e.message);
        }

        // 1. Create campaign record
        const campaignRes = await query(
            `INSERT INTO bulk_campaigns (user_id, page_id, platform, message, image_url, exclude_buyers, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'processing') RETURNING id`,
            [userId, pageId, platform, message, imageUrl, excludeBuyers]
        );
        const campaignId = campaignRes.rows[0].id;

        // 2. Fetch target recipients (Limited to "Today" for safety as per user request)
        let recipients = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (platform === 'messenger') {
            // Get unique senders from today's chats
            const res = await query(
                `SELECT DISTINCT sender_id FROM fb_chats 
                 WHERE page_id = $1 AND created_at >= $2 AND reply_by = 'user'`,
                [pageId, today]
            );
            recipients = res.rows.map(r => r.sender_id);
        } else if (platform === 'whatsapp') {
            const res = await query(
                `SELECT DISTINCT phone_number FROM whatsapp_chats 
                 WHERE session_name = $1 AND created_at >= $2 AND reply_by = 'user'`,
                [pageId, today]
            );
            recipients = res.rows.map(r => r.phone_number);
        }

        // 3. Filter out buyers if requested
        if (excludeBuyers) {
            const orderTable = platform === 'messenger' ? 'fb_order_tracking' : 'whatsapp_order_tracking';
            const idCol = platform === 'messenger' ? 'sender_id' : 'phone_number';
            const buyersRes = await query(
                `SELECT DISTINCT ${idCol} FROM ${orderTable} WHERE page_id = $1 AND status != 'cancelled'`,
                [pageId]
            );
            const buyerIds = new Set(buyersRes.rows.map(r => r[idCol]));
            recipients = recipients.filter(id => !buyerIds.has(id));
        }

        if (recipients.length === 0) {
            await query(`UPDATE bulk_campaigns SET status = 'completed', total_messages = 0 WHERE id = $1`, [campaignId]);
            return { success: true, message: 'No recipients found for today.', campaignId };
        }

        // 4. Update total messages
        await query(`UPDATE bulk_campaigns SET total_messages = $1 WHERE id = $2`, [recipients.length, campaignId]);

        // 5. Add to queue
        for (const recipientId of recipients) {
            this.campaignQueue.push({
                campaignId,
                recipientId,
                pageId,
                platform,
                baseMessage: message,
                imageUrl,
                userId
            });
        }

        // 6. Start processing if not already
        if (!this.isProcessing) {
            this.processQueue();
        }

        return { success: true, campaignId, total: recipients.length };
    }

    async processQueue() {
        if (this.campaignQueue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const task = this.campaignQueue.shift();

        try {
            await this.sendBulkMessage(task);
        } catch (error) {
            console.error(`[Marketing] Failed to send bulk message to ${task.recipientId}:`, error.message);
        }

        // Add random delay to look human and avoid CPU spikes
        const randomDelay = this.delayBetweenMessages + (Math.random() * 10000 - 5000); // 10-20 seconds
        setTimeout(() => this.processQueue(), randomDelay);
    }

    async sendBulkMessage(task) {
        const { campaignId, recipientId, pageId, platform, baseMessage, imageUrl, userId } = task;

        try {
            // 1. Check credits
            const config = await dbService.getPageConfig(pageId);
            if (!config || config.message_credit <= 0) {
                throw new Error('Insufficient credits');
            }

            // 2. AI Spinning (Rewrite message to avoid spam)
            const spinPrompt = `Rewrite this marketing message to be unique but keep the same meaning and call to action. 
            Keep it professional and friendly. Do NOT use emojis unless they are in the original.
            Original Message: "${baseMessage}"
            Rewrite:`;

            const aiResponse = await aiService.generateResponse({
                pageId,
                userId: recipientId,
                userMessage: spinPrompt,
                config,
                platform,
                senderName: 'Marketing System'
            });

            const finalMessage = aiResponse.reply || baseMessage;

            // 3. Send Message
            if (platform === 'messenger') {
                await facebookService.sendTypingAction(recipientId, config.page_access_token, 'typing_on');
                await new Promise(r => setTimeout(r, 2000)); // Wait for typing effect
                
                if (imageUrl) {
                    await facebookService.sendImageUpload(pageId, recipientId, imageUrl, config.page_access_token);
                }
                await facebookService.sendMessage(pageId, recipientId, finalMessage, config.page_access_token);
            } else if (platform === 'whatsapp') {
                await whatsappService.sendTyping(pageId, recipientId);
                await new Promise(r => setTimeout(r, 2000));

                if (imageUrl) {
                    await whatsappService.sendImage(pageId, recipientId, imageUrl, finalMessage);
                } else {
                    await whatsappService.sendMessage(pageId, recipientId, finalMessage);
                }
            }

            // 4. Deduct Credit
            await dbService.deductCredit(pageId, config.message_credit);

            // 5. Update Status
            await query(
                `INSERT INTO bulk_messages (campaign_id, recipient_id, status, sent_at)
                 VALUES ($1, $2, 'sent', NOW())`,
                [campaignId, recipientId]
            );
            await query(
                `UPDATE bulk_campaigns SET sent_messages = sent_messages + 1 WHERE id = $1`,
                [campaignId]
            );

            // 6. Log AI Usage to Bot Replies (as requested by user)
            // This is already handled inside aiService/deductCredit if integrated correctly
            
        } catch (error) {
            await query(
                `INSERT INTO bulk_messages (campaign_id, recipient_id, status, error_message)
                 VALUES ($1, $2, 'failed', $3)`,
                [campaignId, recipientId, error.message]
            );
            await query(
                `UPDATE bulk_campaigns SET failed_messages = failed_messages + 1 WHERE id = $1`,
                [campaignId]
            );
            throw error;
        } finally {
            // Final check: if queue is empty for this campaign, mark it completed
            const remaining = this.campaignQueue.filter(t => t.campaignId === campaignId).length;
            if (remaining === 0) {
                await query(`UPDATE bulk_campaigns SET status = 'completed' WHERE id = $1 AND status = 'processing'`, [campaignId]);
            }
        }
    }

    async getCampaignStatus(campaignId) {
        const res = await query(`SELECT * FROM bulk_campaigns WHERE id = $1`, [campaignId]);
        return res.rows[0];
    }
}

module.exports = new MarketingService();