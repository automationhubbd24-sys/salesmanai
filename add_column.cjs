const { Client } = require('pg');
require('dotenv').config({ path: 'backend/.env' });

async function addColumn() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS visual_tags TEXT");
        console.log("Added visual_tags column successfully.");
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
addColumn();