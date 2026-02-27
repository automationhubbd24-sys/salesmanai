const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function migrate() {
    try {
        console.log('Starting api_list rph_limit migration...');

        await pgClient.query(`
            ALTER TABLE api_list
            ADD COLUMN IF NOT EXISTS rph_limit INT DEFAULT 0;
        `);

        console.log('api_list rph_limit migration completed.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
