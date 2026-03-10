
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log("Starting WhatsApp constraints migration...");
        
        // 1. Add unique constraint to whatsapp_chats(message_id)
        // We first need to check if it exists or just try to add it.
        // Also need to handle duplicates if any before adding constraint.
        
        // Option A: Remove duplicates first (keep latest)
        await pgClient.query(`
            DELETE FROM whatsapp_chats a USING whatsapp_chats b
            WHERE a.id < b.id AND a.message_id = b.message_id;
        `);
        console.log("Removed duplicate messages");

        // Option B: Add constraint
        await pgClient.query(`
            ALTER TABLE whatsapp_chats
            ADD CONSTRAINT whatsapp_chats_message_id_key UNIQUE (message_id);
        `).catch(err => {
            if (err.code === '42710') { // duplicate_object (constraint already exists)
                 console.log("Constraint whatsapp_chats_message_id_key already exists");
            } else {
                 throw err;
            }
        });
        console.log("Added unique constraint to whatsapp_chats(message_id)");

        // 2. Add page_id to ai_usage_logs
        await pgClient.query(`
            ALTER TABLE ai_usage_logs 
            ADD COLUMN IF NOT EXISTS page_id TEXT;
        `);
        console.log("Added page_id to ai_usage_logs");

        console.log("Migration completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();
