const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log('Starting WhatsApp missing columns v3 migration...');

        await pgClient.query(`
            ALTER TABLE whatsapp_contacts
            ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
        `);

        await pgClient.query(`
            ALTER TABLE whatsapp_message_database
            ADD COLUMN IF NOT EXISTS push_name TEXT;
        `);

        console.log('WhatsApp missing columns v3 migration completed.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
