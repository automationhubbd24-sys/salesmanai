
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log("Starting WhatsApp Cheap Engine migration...");
        
        // Add cheap_engine (boolean)
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS cheap_engine BOOLEAN DEFAULT false;
        `);
        console.log("Added/Checked cheap_engine");

        console.log("Migration completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();
