const path = require('path');
// Use the exact same pgClient as the app
process.env.DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

const { query } = require('./backend/src/services/pgClient');
const PAGE_ID = '1018705751321580';

async function check() {
    try {
        console.log(`Checking for ${PAGE_ID}...`);
        const res = await query(
            'SELECT page_id, semantic_cache_enabled, semantic_cache_threshold, embed_enabled FROM fb_message_database WHERE page_id = $1',
            [PAGE_ID]
        );
        if (res.rows.length === 0) {
            console.log("Not found.");
        } else {
            console.log("Settings:", JSON.stringify(res.rows[0], null, 2));
        }
    } catch (e) {
        console.error("Query Error:", e.message);
    }
}

check();
