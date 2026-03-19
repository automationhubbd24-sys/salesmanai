const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load environment from backend folder
const envPath = path.join(__dirname, 'backend', '.env');
dotenv.config({ path: envPath });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

(async () => {
    try {
        await client.connect();
        console.log("Connected to DB");

        console.log("\n=== Page Access Token Message Table (Ownership) ===");
        const res = await client.query('SELECT page_id, name, email FROM page_access_token_message ORDER BY email');
        console.table(res.rows);

        console.log("\n=== Team Members Table ===");
        const teamRes = await client.query('SELECT owner_email, member_email, status FROM team_members');
        console.table(teamRes.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
})();
