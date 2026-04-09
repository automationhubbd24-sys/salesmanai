
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log("Starting WhatsApp Schema Fix V2...");
        
        // 1. Add image_prompt
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS image_prompt TEXT;
        `);
        console.log("Checked/Added image_prompt");

        // 2. Add wait (Smart Reply Delay)
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS wait INTEGER DEFAULT 5;
        `);
        console.log("Checked/Added wait");

        // 3. Add check_conversion (Memory Context Limit)
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS check_conversion INTEGER DEFAULT 10;
        `);
        console.log("Checked/Added check_conversion");

        // 4. Add group_reply
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS group_reply BOOLEAN DEFAULT false;
        `);
        console.log("Checked/Added group_reply");

        // 5. Add lock/unlock emojis
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS lock_emojis TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS unlock_emojis TEXT DEFAULT '';
        `);
        console.log("Checked/Added lock/unlock emojis");
        
        // 6. Add plan_days, expires_at, subscription_status if missing
        await pgClient.query(`
            ALTER TABLE whatsapp_message_database 
            ADD COLUMN IF NOT EXISTS plan_days INTEGER DEFAULT 30,
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active';
        `);
        console.log("Checked/Added subscription fields");

        console.log("Migration completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();
