const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
const envPath = path.join(__dirname, 'backend', '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    console.error("Backend .env file not found at:", envPath);
    process.exit(1);
}

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function check() {
    try {
        await client.connect();
        console.log("Connected to database.");

        console.log("\n--- ALL Pages in page_access_token_message ---");
        const res1 = await client.query(`
            SELECT id, page_id, name, email, user_id FROM page_access_token_message
        `);
        console.table(res1.rows);

        console.log("\n--- ALL Team Memberships ---");
        const res2 = await client.query(`
            SELECT id, owner_email, member_email, status, permissions FROM team_members
        `);
        // console.table(res2.rows); // permissions object might not display well in table
        console.log(JSON.stringify(res2.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

check();
