require('dotenv').config();
const { query } = require('./src/services/pgClient');

(async () => {
    try {
        // Create coupon_usage table to track user-specific coupon usage
        await query(`
            CREATE TABLE IF NOT EXISTS coupon_usage (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                coupon_id INTEGER NOT NULL,
                used_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, coupon_id)
            )
        `);
        console.log('coupon_usage table created or already exists.');

        // Update referral_codes to support usage limits
        await query(`ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS usage_limit INTEGER DEFAULT 1`);
        await query(`ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS current_usage INTEGER DEFAULT 0`);
        await query(`ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS per_user_limit INTEGER DEFAULT 1`);
        console.log('referral_codes table updated with usage limits.');

        // Ensure user_configs has balance and message_credit
        await query(`ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0`);
        await query(`ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS message_credit INTEGER DEFAULT 0`);
        console.log('user_configs table verified.');

        process.exit(0);
    } catch (err) {
        console.error('Database update failed:', err);
        process.exit(1);
    }
})();
