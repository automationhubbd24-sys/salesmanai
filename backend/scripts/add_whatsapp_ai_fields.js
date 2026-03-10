
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log("Starting WhatsApp AI fields migration...");
        
        // 1. Add ai_provider
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS ai_provider TEXT;
        `);
        console.log("Added/Checked ai_provider");

        // 2. Add api_key
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS api_key TEXT;
        `);
        console.log("Added/Checked api_key");

        // 3. Add chat_model (Messenger uses 'chatmodel', let's check what WhatsApp uses)
        // I'll add both to be safe or standardize on 'chat_model' as per my previous check in WhatsAppSettingsPage
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS chat_model TEXT;
        `);
        console.log("Added/Checked chat_model");

        console.log("Migration completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();
