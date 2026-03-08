const { Pool } = require('pg');

const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';
const PAGE_ID = '1018705751321580';

async function checkCacheSettings() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000, // Wait up to 10s
    });

    try {
        console.log(`--- Checking Cache Settings for Cosmetic Hub (${PAGE_ID}) ---`);
        const res = await pool.query(
            'SELECT page_id, semantic_cache_enabled, semantic_cache_threshold, embed_enabled FROM fb_message_database WHERE page_id = $1',
            [PAGE_ID]
        );

        if (res.rows.length === 0) {
            console.log(`[NOT FOUND] No settings found for page_id: ${PAGE_ID}`);
        } else {
            console.log('[FOUND] Settings:', JSON.stringify(res.rows[0], null, 2));
        }

    } catch (err) {
        console.error('[ERROR]', err.message);
    } finally {
        await pool.end();
    }
}

checkCacheSettings();
