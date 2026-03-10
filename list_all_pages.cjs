const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        
        console.log("Listing Pages (limit 20):");
        const res = await client.query('SELECT page_id, user_id, email, name FROM page_access_token_message LIMIT 20');
        
        if (res.rows.length === 0) {
            console.log("No pages found in page_access_token_message table.");
            return;
        }

        const userIds = [...new Set(res.rows.map(r => r.user_id).filter(id => id))];
        let userMap = new Map();
        if (userIds.length > 0) {
            const users = await client.query('SELECT id, email FROM users WHERE id = ANY($1)', [userIds]);
            userMap = new Map(users.rows.map(u => [u.id, u.email]));
        }

        res.rows.forEach(r => {
            console.log(`Page: ${r.name} (${r.page_id}), OwnerID: ${r.user_id}, Email: ${r.email}, Resolved: ${userMap.get(r.user_id) || 'N/A'}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
