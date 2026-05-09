
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log("Starting WhatsApp fields migration...");
        
        // 1. Add image_prompt
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS image_prompt TEXT;
        `);
        console.log("Added/Checked image_prompt");

        // 2. Add wait (Smart Reply Delay)
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS wait INTEGER DEFAULT 5;
        `);
        console.log("Added/Checked wait");

        // 3. Add check_conversion (Memory Context Limit / Conversion Limit)
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS check_conversion INTEGER DEFAULT 10;
        `);
        console.log("Added/Checked check_conversion");

        console.log("Migration completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();
