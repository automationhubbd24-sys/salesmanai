const { Pool } = require('pg');
const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString: DATABASE_URL });

async function checkBismillahCache() {
    try {
        const pageId = '473665619156212';
        console.log(`--- Checking Cache for Bismillah Homeo Chamber (${pageId}) ---`);

        // Check cache count
        const cacheRes = await pool.query("SELECT COUNT(*) FROM semantic_cache WHERE page_id = $1", [pageId]);
        console.log(`Cache Entries Count: ${cacheRes.rows[0].count}`);

        // Check if config exists in fb_message_database
        const configRes = await pool.query("SELECT * FROM fb_message_database WHERE page_id = $1", [pageId]);
        console.log('FB Message Database Config:', JSON.stringify(configRes.rows, null, 2));

    } catch (e) {
        console.error('Check failed:', e.message);
    } finally {
        await pool.end();
    }
}

checkBismillahCache();
