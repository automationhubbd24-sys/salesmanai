
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log("Starting WhatsApp missing columns migration...");
        
        // 1. Add phone_number to whatsapp_chats
        await pgClient.query(`
            ALTER TABLE whatsapp_chats
            ADD COLUMN IF NOT EXISTS phone_number TEXT;
        `);
        console.log("Added phone_number to whatsapp_chats");

        // 2. Add is_locked to whatsapp_chats (optional but useful for history)
        await pgClient.query(`
            ALTER TABLE whatsapp_chats
            ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
        `);
        console.log("Added is_locked to whatsapp_chats");

        console.log("Migration completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();
