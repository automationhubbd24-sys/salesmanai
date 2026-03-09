const { Pool } = require('pg');
const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString: DATABASE_URL });

async function findBismillah() {
    try {
        console.log('--- Searching for Bismillah Homeo Chamber ---');
        
        // Search in messenger configs
        const messengerRes = await pool.query(`
            SELECT page_id, name, semantic_cache_enabled, embed_enabled 
            FROM page_access_token_message 
            WHERE name ILIKE '%Bismillah%' OR name ILIKE '%বিসমিল্লাহ%'
        `);
        console.log('Messenger Matches:', JSON.stringify(messengerRes.rows, null, 2));

        // Search in whatsapp configs
        const whatsappRes = await pool.query(`
            SELECT session_name, push_name, semantic_cache_enabled, embed_enabled 
            FROM whatsapp_message_database 
            WHERE push_name ILIKE '%Bismillah%' OR push_name ILIKE '%বিসমিল্লাহ%' OR session_name ILIKE '%Bismillah%'
        `);
        console.log('WhatsApp Matches:', JSON.stringify(whatsappRes.rows, null, 2));

        const targetId = messengerRes.rows[0]?.page_id || whatsappRes.rows[0]?.session_name;
        if (targetId) {
            const cacheCount = await pool.query("SELECT COUNT(*) FROM semantic_cache WHERE page_id = $1 OR session_name = $1", [targetId]);
            console.log(`\nTotal Cache Entries for ${targetId}: ${cacheCount.rows[0].count}`);
        }

    } catch (e) {
        console.error('Search failed:', e.message);
    } finally {
        await pool.end();
    }
}

findBismillah();
