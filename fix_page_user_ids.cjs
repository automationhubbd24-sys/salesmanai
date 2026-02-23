const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        
        console.log("Fetching pages with NULL user_id...");
        const res = await client.query('SELECT page_id, email FROM page_access_token_message WHERE user_id IS NULL AND email IS NOT NULL');
        
        if (res.rows.length === 0) {
            console.log("No pages found with NULL user_id and valid email.");
            return;
        }

        console.log(`Found ${res.rows.length} pages to fix.`);
        
        for (const row of res.rows) {
            const userRes = await client.query('SELECT id FROM users WHERE email = $1', [row.email]);
            
            if (userRes.rows.length > 0) {
                const userId = userRes.rows[0].id;
                console.log(`Updating Page ${row.page_id} (${row.email}) -> UserID: ${userId}`);
                await client.query('UPDATE page_access_token_message SET user_id = $1 WHERE page_id = $2', [userId, row.page_id]);
            } else {
                console.log(`User not found for email: ${row.email} (Page ${row.page_id})`);
            }
        }
        
        console.log("Migration complete.");

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
