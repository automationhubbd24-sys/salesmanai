const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
  try {
    console.log('Starting WhatsApp order tracking columns migration...');

    await pgClient.query(`
      ALTER TABLE whatsapp_order_tracking
      ADD COLUMN IF NOT EXISTS product_name TEXT,
      ADD COLUMN IF NOT EXISTS number TEXT,
      ADD COLUMN IF NOT EXISTS location TEXT,
      ADD COLUMN IF NOT EXISTS product_quantity TEXT DEFAULT '1',
      ADD COLUMN IF NOT EXISTS price NUMERIC;
    `);

    await pgClient.query(`
      ALTER TABLE whatsapp_chats
      ADD COLUMN IF NOT EXISTS token_usage INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS model_used TEXT;
    `);

    console.log('WhatsApp order tracking columns migration completed.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
