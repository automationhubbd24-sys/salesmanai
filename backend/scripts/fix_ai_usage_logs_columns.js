const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log('Starting ai_usage_logs columns migration...');

        await pgClient.query(`
            ALTER TABLE ai_usage_logs
            ADD COLUMN IF NOT EXISTS page_id TEXT,
            ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success',
            ADD COLUMN IF NOT EXISTS error_message TEXT,
            ADD COLUMN IF NOT EXISTS sender_name TEXT,
            ADD COLUMN IF NOT EXISTS user_message TEXT,
            ADD COLUMN IF NOT EXISTS ai_reply TEXT;
        `);

        console.log('ai_usage_logs columns migration completed.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
