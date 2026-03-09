const { Pool } = require('pg');
const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString: DATABASE_URL });

async function debugCosmeticCache() {
    try {
        const pageId = '1018705751321580';
        console.log(`--- Debugging Cache for Cosmetic Hub (${pageId}) ---`);

        // 1. Check entries with exact page_id match
        const pageMatch = await pool.query("SELECT id, page_id, session_name, question_norm FROM semantic_cache WHERE page_id = $1", [pageId]);
        console.log(`Entries with page_id match: ${pageMatch.rowCount}`);

        // 2. Check entries with exact session_name match
        const sessionMatch = await pool.query("SELECT id, page_id, session_name, question_norm FROM semantic_cache WHERE session_name = $1", [pageId]);
        console.log(`Entries with session_name match: ${sessionMatch.rowCount}`);

        // 3. Check for any variation (just in case)
        const anyMatch = await pool.query("SELECT id, page_id, session_name FROM semantic_cache WHERE page_id LIKE $1 OR session_name LIKE $1", [`%${pageId}%`]);
        console.log(`Entries with partial match: ${anyMatch.rowCount}`);

        if (pageMatch.rowCount > 0 || sessionMatch.rowCount > 0) {
            console.log('\nSample data from DB:');
            console.log(JSON.stringify(pageMatch.rows[0] || sessionMatch.rows[0], null, 2));
        } else {
            console.log('\nWARNING: No entries found in DB for this ID!');
            const total = await pool.query("SELECT COUNT(*) FROM semantic_cache");
            console.log(`Total entries in semantic_cache table: ${total.rows[0].count}`);
        }

    } catch (e) {
        console.error('Debug failed:', e.message);
    } finally {
        await pool.end();
    }
}

debugCosmeticCache();
