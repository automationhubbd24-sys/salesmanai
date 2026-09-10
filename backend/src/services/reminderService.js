const dbService = require('./dbService');
const aiService = require('./aiService');
const facebookService = require('./facebookService');
const whatsappCloudService = require('./whatsappCloudService');
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
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_order_tracking' AND column_name='reminder_count') THEN
                    ALTER TABLE whatsapp_order_tracking ADD COLUMN reminder_count INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_order_tracking' AND column_name='last_reminder_sent_at') THEN
                    ALTER TABLE whatsapp_order_tracking ADD COLUMN last_reminder_sent_at TIMESTAMP WITH TIME ZONE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_order_tracking' AND column_name='updated_at') THEN
                    ALTER TABLE whatsapp_order_tracking ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_reminder_enabled') THEN
                    ALTER TABLE fb_message_database ADD COLUMN order_reminder_enabled BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_reminder_delay_hours') THEN
                    ALTER TABLE fb_message_database ADD COLUMN order_reminder_delay_hours INTEGER DEFAULT 4;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_reminder_message') THEN
                    ALTER TABLE fb_message_database ADD COLUMN order_reminder_message TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='order_reminder_enabled') THEN
                    ALTER TABLE whatsapp_message_database ADD COLUMN order_reminder_enabled BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='order_reminder_delay_hours') THEN
                    ALTER TABLE whatsapp_message_database ADD COLUMN order_reminder_delay_hours INTEGER DEFAULT 4;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='order_reminder_message') THEN
                    ALTER TABLE whatsapp_message_database ADD COLUMN order_reminder_message TEXT;
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

        await query(`
            UPDATE whatsapp_order_tracking
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

            const whatsappRes = await query(
                `SELECT session_name, provider_type, phone_number_id, cloud_access_token, order_reminder_enabled, order_reminder_delay_hours, order_reminder_message
                 FROM whatsapp_message_database
                 WHERE order_reminder_enabled = true`
            );

            for (const config of pagesRes.rows) {
                try {
                    await this.processPageReminders(config);
                } catch (pageErr) {
                    console.error(`[Reminder] Error processing page ${config.page_id}:`, pageErr.message);
                }
            }

            for (const config of whatsappRes.rows) {
                try {
                    await this.processWhatsAppReminders(config);
                } catch (waErr) {
                    console.error(`[Reminder] Error processing WhatsApp ${config.session_name}:`, waErr.message);
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
        const reminderTemplate = order_reminder_message || 'স্যার, আপনি কি এখনও সাহায্য চান? চাইলে এখানে রিপ্লাই করুন।';

        // 2. Fetch inactive conversations that haven't been reminded yet
        // Rule: Must be within 24-hour window (safety)
        // Rule: Inactivity period must be at least delayHours
        const conversationsRes = await query(
            `WITH conversations AS (
                SELECT
                    CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS sender_id,
                    MAX(timestamp) AS last_activity_ts
                FROM fb_chats
                WHERE page_id = $1
                  AND timestamp IS NOT NULL
                  AND (sender_id = $1 OR recipient_id = $1)
                GROUP BY 1
             ), latest AS (
                SELECT DISTINCT ON (CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)
                    CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS sender_id,
                    status,
                    reply_by,
                    timestamp
                FROM fb_chats
                WHERE page_id = $1
                  AND timestamp IS NOT NULL
                  AND (sender_id = $1 OR recipient_id = $1)
                ORDER BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END, timestamp DESC
             )
             SELECT
                'chat_fb_' || $1 || '_' || c.sender_id AS id,
                c.sender_id,
                NULL::text AS product_name,
                NULL::text AS customer_name,
                to_timestamp(c.last_activity_ts / 1000.0) AS updated_at,
                'conversation' AS reminder_source
             FROM conversations c
             JOIN latest l ON l.sender_id = c.sender_id
             WHERE c.sender_id IS NOT NULL
               AND c.sender_id <> $1
               AND COALESCE(l.status, '') <> 'reminder'
               AND c.last_activity_ts <= (EXTRACT(EPOCH FROM (NOW() - make_interval(hours => $2::int))) * 1000)
               AND c.last_activity_ts >= (EXTRACT(EPOCH FROM (NOW() - INTERVAL '23 hours')) * 1000)
               AND EXISTS (
                    SELECT 1 FROM fb_chats inbound
                    WHERE inbound.page_id = $1
                      AND inbound.sender_id = c.sender_id
                      AND inbound.timestamp IS NOT NULL
                      AND COALESCE(inbound.status, '') <> 'reminder'
               )`,
            [page_id, delayHours]
        );

        if (conversationsRes.rows.length === 0) return;

        console.log(`[Reminder] Found ${conversationsRes.rows.length} inactive conversations for Page ${page_id}`);

        // Get Page Token
        const pageConfig = await dbService.getPageConfig(page_id);
        if (!pageConfig || !pageConfig.page_access_token) {
            console.warn(`[Reminder] No token found for page ${page_id}`);
            return;
        }

        for (const conversation of conversationsRes.rows) {
            try {
                await this.sendSmartReminder(pageConfig, conversation, reminderTemplate);
            } catch (orderErr) {
                console.error(`[Reminder] Failed to send to ${conversation.sender_id}:`, orderErr.message);
            }
            
            // Add a small delay between messages to avoid CPU/Network spikes
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    async processWhatsAppReminders(config) {
        const { session_name, phone_number_id, cloud_access_token, order_reminder_delay_hours, order_reminder_message } = config;
        if (!phone_number_id || !cloud_access_token) {
            console.warn(`[Reminder] Skipping WhatsApp connection ${session_name}: missing Cloud API credentials`);
            return;
        }

        const delayHours = order_reminder_delay_hours || 4;
        const reminderTemplate = order_reminder_message || 'স্যার, আপনি কি এখনও সাহায্য চান? চাইলে এখানে রিপ্লাই করুন।';

        const conversationsRes = await query(
            `WITH conversations AS (
                SELECT
                    CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS sender_id,
                    MAX(timestamp) AS last_activity_ts
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND timestamp IS NOT NULL
                  AND (sender_id = $1 OR recipient_id = $1)
                GROUP BY 1
             ), latest AS (
                SELECT DISTINCT ON (CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)
                    CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS sender_id,
                    status,
                    reply_by,
                    timestamp
                FROM whatsapp_chats
                WHERE session_name = $1
                  AND timestamp IS NOT NULL
                  AND (sender_id = $1 OR recipient_id = $1)
                ORDER BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END, timestamp DESC
             )
             SELECT
                'chat_wa_' || $1 || '_' || c.sender_id AS id,
                c.sender_id,
                NULL::text AS product_name,
                to_timestamp(c.last_activity_ts / 1000.0) AS updated_at,
                'conversation' AS reminder_source
             FROM conversations c
             JOIN latest l ON l.sender_id = c.sender_id
             WHERE c.sender_id IS NOT NULL
               AND c.sender_id <> $1
               AND COALESCE(l.status, '') <> 'reminder'
               AND c.last_activity_ts <= (EXTRACT(EPOCH FROM (NOW() - make_interval(hours => $2::int))) * 1000)
               AND c.last_activity_ts >= (EXTRACT(EPOCH FROM (NOW() - INTERVAL '23 hours')) * 1000)
               AND EXISTS (
                    SELECT 1 FROM whatsapp_chats inbound
                    WHERE inbound.session_name = $1
                      AND inbound.sender_id = c.sender_id
                      AND inbound.timestamp IS NOT NULL
                      AND COALESCE(inbound.status, '') <> 'reminder'
               )`,
            [session_name, delayHours]
        );

        if (conversationsRes.rows.length === 0) return;

        console.log(`[Reminder] Found ${conversationsRes.rows.length} inactive conversations for WhatsApp ${session_name}`);

        const sessionConfig = await dbService.getWhatsAppConfig(session_name);
        if (!sessionConfig) {
            console.warn(`[Reminder] No WhatsApp config found for ${session_name}`);
            return;
        }
        if (!sessionConfig.phone_number_id || !sessionConfig.cloud_access_token) {
            console.warn(`[Reminder] Skipping WhatsApp connection ${session_name}: missing Cloud API credentials`);
            return;
        }

        for (const conversation of conversationsRes.rows) {
            try {
                await this.sendSmartWhatsAppReminder(sessionConfig, conversation, reminderTemplate);
            } catch (orderErr) {
                console.error(`[Reminder] Failed WhatsApp send to ${conversation.sender_id}:`, orderErr.message);
            }

            await new Promise(r => setTimeout(r, 1500));
        }
    }

    /**
     * Send an AI-Spun reminder to a single customer
     */
    async sendSmartReminder(pageConfig, order, baseMessageTemplate) {
        const { page_id, page_access_token } = pageConfig;
        const { id: reminderId, sender_id, product_name, customer_name } = order;

        // 1. AI Spinning (Rewrite message to be unique)
        const product = product_name || 'পণ্যটি';
        const name = customer_name && customer_name !== 'Unknown' ? customer_name : '';
        
        const spinPrompt = `You are a helpful sales assistant for a Facebook page.
        A customer recently chatted but has not continued the conversation.
        Write a friendly, polite, and professional follow-up message in Bengali asking if they still need help.
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
        const reminderMessageId = `reminder_fb_${reminderId}_${Date.now()}`;

        // 2. Send Message via Facebook API
        // We don't use tags for now because we are within the 24h window
        await facebookService.sendTypingAction(sender_id, page_access_token, 'typing_on');
        await new Promise(r => setTimeout(r, 2000));
        try {
            await facebookService.sendMessage(page_id, sender_id, finalMessage, page_access_token);
            await dbService.saveFbChat({
                page_id,
                sender_id: page_id,
                recipient_id: sender_id,
                message_id: reminderMessageId,
                text: finalMessage,
                timestamp: Date.now(),
                status: 'reminder',
                reply_by: 'system',
                ai_model: aiResponse.model || 'reminder'
            });
        } catch (error) {
            await dbService.saveFbChat({
                page_id,
                sender_id: page_id,
                recipient_id: sender_id,
                message_id: `${reminderMessageId}_error`,
                text: finalMessage,
                timestamp: Date.now(),
                status: 'reminder_error',
                reply_by: 'system',
                ai_model: aiResponse.model || 'reminder'
            });
            throw error;
        }

        console.log(`[Reminder] Sent successfully to ${sender_id}`);
    }

    async sendSmartWhatsAppReminder(sessionConfig, order, baseMessageTemplate) {
        const sessionName = sessionConfig.session_name;
        const { id: reminderId, sender_id, product_name } = order;
        const product = product_name || 'পণ্যটি';

        const spinPrompt = `You are a helpful sales assistant for a WhatsApp store.
        A customer recently chatted but has not continued the conversation.
        Write a friendly, polite, and short follow-up message in Bengali asking if they still need help.
        Base Message Idea: "${baseMessageTemplate.replace('[PRODUCT]', product)}"
        Rewrite this to be unique:`;

        const aiResponse = await aiService.generateResponse({
            pageId: sessionName,
            userId: sender_id,
            userMessage: spinPrompt,
            config: sessionConfig,
            platform: 'whatsapp',
            senderName: 'Reminder System'
        });

        const finalMessage = aiResponse.reply || baseMessageTemplate.replace('[PRODUCT]', product);
        const reminderMessageId = `reminder_wa_${reminderId}_${Date.now()}`;

        try {
            await whatsappCloudService.sendTextMessage(
                sessionConfig.phone_number_id,
                sessionConfig.cloud_access_token,
                sender_id,
                finalMessage
            );
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: sender_id,
                message_id: reminderMessageId,
                text: finalMessage,
                timestamp: Date.now(),
                status: 'reminder',
                reply_by: 'system',
                model_used: aiResponse.model || 'reminder'
            });
        } catch (error) {
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: sender_id,
                message_id: `${reminderMessageId}_error`,
                text: finalMessage,
                timestamp: Date.now(),
                status: 'reminder_error',
                reply_by: 'system',
                model_used: aiResponse.model || 'reminder'
            });
            throw error;
        }

        console.log(`[Reminder] WhatsApp reminder sent successfully to ${sender_id}`);
    }
}

module.exports = new ReminderService();
