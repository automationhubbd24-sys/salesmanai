const { Pool } = require('pg');
const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString: DATABASE_URL });

async function findBismillahSafe() {
    try {
        console.log('--- Searching for Bismillah Homeo Chamber (Safe) ---');
        
        // Search in page_access_token_message
        const messengerRes = await pool.query(`
            SELECT page_id, name FROM page_access_token_message 
            WHERE name ILIKE '%Bismillah%' OR name ILIKE '%বিসমিল্লাহ%'
        `);
        console.log('Messenger Matches:', JSON.stringify(messengerRes.rows, null, 2));

        // Search in whatsapp_message_database
        const whatsappRes = await pool.query(`
            SELECT session_name, push_name FROM whatsapp_message_database 
            WHERE push_name ILIKE '%Bismillah%' OR push_name ILIKE '%বিসমিল্লাহ%' OR session_name ILIKE '%Bismillah%'
        `);
        console.log('WhatsApp Matches:', JSON.stringify(whatsappRes.rows, null, 2));

    } catch (e) {
        console.error('Search failed:', e.message);
    } finally {
        await pool.end();
    }
}

findBismillahSafe();
