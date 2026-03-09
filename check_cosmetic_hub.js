const { Pool } = require('pg');
const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString: DATABASE_URL });

async function checkCosmeticHub() {
    try {
        console.log('Connecting to NEW database...');
        
        // 1. Find page_id for Cosmetic Hub
        const pages = await pool.query("SELECT page_id, name FROM page_access_token_message WHERE name ILIKE '%Cosmetic%'");
        console.log('FB Pages matching Cosmetic:', JSON.stringify(pages.rows, null, 2));
        
        // 2. Find session_name for Cosmetic Hub
        const waSessions = await pool.query("SELECT session_name, push_name FROM whatsapp_message_database WHERE push_name ILIKE '%Cosmetic%' OR session_name ILIKE '%Cosmetic%'");
        console.log('WA Sessions matching Cosmetic:', JSON.stringify(waSessions.rows, null, 2));

        // 3. Check for ANY entries in semantic_cache to see how they are stored
        const anyCache = await pool.query("SELECT page_id, session_name, COUNT(*) as cnt FROM semantic_cache GROUP BY page_id, session_name");
        console.log('Semantic Cache identifiers in DB:', JSON.stringify(anyCache.rows, null, 2));

        const checkEntries = async (id, type, name) => {
            const res = await pool.query("SELECT id, question_norm FROM semantic_cache WHERE page_id = $1 OR session_name = $1", [id]);
            console.log(`Cache entries for ${type} ${name} (${id}):`, res.rowCount);
            if (res.rowCount > 0) {
                console.log('Sample entry:', JSON.stringify(res.rows[0], null, 2));
            }
        };

        for (const page of pages.rows) await checkEntries(page.page_id, 'FB Page', page.name);
        for (const wa of waSessions.rows) await checkEntries(wa.session_name, 'WA Session', wa.push_name);

    } catch (e) {
        console.error('Check failed:', e.message);
    } finally {
        await pool.end();
    }
}

checkCosmeticHub();
