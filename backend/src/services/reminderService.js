const dbService = require('./dbService');
const aiService = require('./aiService');
const facebookService = require('./facebookService');
const { query } = require('./pgClient');

class ReminderService {
    constructor() {
        this.isProcessing = false;
    }

    async ensureReminderSchema() {
        await query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='reminder_count') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN reminder_count INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='last_reminder_sent_at') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN last_reminder_sent_at TIMESTAMP WITH TIME ZONE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='updated_at') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                END IF;
            END $$;
        `);

        await query(`
            UPDATE fb_order_tracking
            SET
                updated_at = COALESCE(updated_at, created_at, NOW()),
                reminder_count = COALESCE(reminder_count, 0)
            WHERE updated_at IS NULL OR reminder_count IS NULL
        `);
    }

    /**
     * Main task to check and send reminders for all active pages
     */
    async checkAndSendReminders() {
        if (this.isProcessing) {
            console.log('[Reminder] Already processing. Skipping...');
            return;
        }

        this.isProcessing = true;
        console.log('[Reminder] Starting reminder check...');

        try {
            await this.ensureReminderSchema();

            // 1. Fetch all pages with reminders enabled
            const pagesRes = await query(
                `SELECT id, page_id, order_reminder_enabled, order_reminder_delay_hours, order_reminder_message 
                 FROM fb_message_database 
                 WHERE order_reminder_enabled = true`
            );

            for (const config of pagesRes.rows) {
                try {
                    await this.processPageReminders(config);
                } catch (pageErr) {
                    console.error(`[Reminder] Error processing page ${config.page_id}:`, pageErr.message);
                }
            }
        } catch (err) {
            console.error('[Reminder] Global check error:', err.message);
        } finally {
            this.isProcessing = false;
            console.log('[Reminder] Finished reminder check.');
        }
    }

    /**
     * Process reminders for a specific page
     */
    async processPageReminders(config) {
        const { page_id, order_reminder_delay_hours, order_reminder_message } = config;
        const delayHours = order_reminder_delay_hours || 4;
        const reminderTemplate = order_reminder_message || 'স্যার, আপনি [PRODUCT] টি নিতে চেয়েছিলেন, আপনি কি অর্ডারটি কনফার্ম করতে চান?';

        // 2. Fetch "ongoing" orders that haven't been reminded yet
        // Rule: Must be within 24-hour window (safety)
        // Rule: Inactivity period must be at least delayHours
        const ordersRes = await query(
            `SELECT id, sender_id, product_name, number, location, customer_name, updated_at 
             FROM fb_order_tracking 
             WHERE page_id = $1 
             AND status = 'ongoing' 
             AND reminder_count = 0
             AND updated_at <= NOW() - make_interval(hours => $2::int)
             AND updated_at >= NOW() - INTERVAL '23 hours'`, // 23h to leave 1h buffer for standard window
            [page_id, delayHours]
        );

        if (ordersRes.rows.length === 0) return;

        console.log(`[Reminder] Found ${ordersRes.rows.length} pending reminders for Page ${page_id}`);

        // Get Page Token
        const pageConfig = await dbService.getPageConfig(page_id);
        if (!pageConfig || !pageConfig.page_access_token) {
            console.warn(`[Reminder] No token found for page ${page_id}`);
            return;
        }

        for (const order of ordersRes.rows) {
            try {
                await this.sendSmartReminder(pageConfig, order, reminderTemplate);
            } catch (orderErr) {
                console.error(`[Reminder] Failed to send to ${order.sender_id}:`, orderErr.message);
            }
            
            // Add a small delay between messages to avoid CPU/Network spikes
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    /**
     * Send an AI-Spun reminder to a single customer
     */
    async sendSmartReminder(pageConfig, order, baseMessageTemplate) {
        const { page_id, page_access_token } = pageConfig;
        const { id: orderId, sender_id, product_name, customer_name } = order;

        // 1. AI Spinning (Rewrite message to be unique)
        const product = product_name || 'পণ্যটি';
        const name = customer_name && customer_name !== 'Unknown' ? customer_name : '';
        
        const spinPrompt = `You are a helpful sales assistant for a Facebook page. 
        A customer named "${name}" started an order for "${product}" but didn't finish providing their phone or address.
        Write a friendly, polite, and professional reminder message in Bengali to ask if they want to confirm the order.
        Do NOT be pushy. Keep it short.
        Base Message Idea: "${baseMessageTemplate.replace('[PRODUCT]', product)}"
        Rewrite this to be unique:`;

        const aiResponse = await aiService.generateResponse({
            pageId: page_id,
            userId: sender_id,
            userMessage: spinPrompt,
            config: pageConfig,
            platform: 'messenger',
            senderName: 'Reminder System'
        });

        const finalMessage = aiResponse.reply || baseMessageTemplate.replace('[PRODUCT]', product);

        // 2. Send Message via Facebook API
        // We don't use tags for now because we are within the 24h window
        await facebookService.sendTypingAction(sender_id, page_access_token, 'typing_on');
        await new Promise(r => setTimeout(r, 2000));
        await facebookService.sendMessage(page_id, sender_id, finalMessage, page_access_token);

        // 3. Update Order Tracking
        await query(
            `UPDATE fb_order_tracking 
             SET reminder_count = reminder_count + 1, 
                 last_reminder_sent_at = NOW() 
             WHERE id = $1`,
            [orderId]
        );

        console.log(`[Reminder] Sent successfully to ${sender_id} for order ${orderId}`);
    }
}

module.exports = new ReminderService();
