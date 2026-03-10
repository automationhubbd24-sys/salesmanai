
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log("Starting migration...");
        
        // Add image_prompt column to whatsapp_message_database
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS image_prompt TEXT;
        `);
        console.log("Added image_prompt column to whatsapp_message_database");

        // Unified Credit System Migration
        // Check if user_credits table exists, if not create it or ensure users have credit column
        // But the user said "100 credits usable across Messenger/WhatsApp".
        // This implies a shared credit pool.
        // Currently, Messenger credits are per page (page_access_token_message table?).
        // WhatsApp credits seem to be deducted from user balance?
        // Let's check where credits are stored.
        
        // For now, just fix the image_prompt error.
        
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();
