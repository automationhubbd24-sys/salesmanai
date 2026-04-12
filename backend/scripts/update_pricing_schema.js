const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

async function migrate() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });

    try {
        await client.connect();
        console.log('Connected to database for migration...');

        // 1. Update user_configs table
        await client.query(`
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'none';
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS daily_limit NUMERIC DEFAULT 0;
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS daily_used NUMERIC DEFAULT 0;
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS monthly_limit NUMERIC DEFAULT 0;
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS monthly_used NUMERIC DEFAULT 0;
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS bonus_credit NUMERIC DEFAULT 0;
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS permanent_credit NUMERIC DEFAULT 0;
            ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        `);
        console.log('Successfully updated user_configs table.');

        // 2. Add top_p column to message databases if missing
        await client.query(`
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS top_p NUMERIC DEFAULT 0.9;
            ALTER TABLE fb_message_database ADD COLUMN IF NOT EXISTS top_p NUMERIC DEFAULT 0.9;
        `);
        console.log('Successfully updated message database tables.');

        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}

migrate();
