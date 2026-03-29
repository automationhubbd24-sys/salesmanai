const { Client } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    await client.connect();
    try {
        const res = await client.query(`
            SELECT * 
            FROM fb_chats 
            WHERE text ILIKE '%Kemei KM 472%' OR text ILIKE '%820%'
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}

run();