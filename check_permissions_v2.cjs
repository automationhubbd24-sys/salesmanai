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

        const email1 = 'automationhubbd24@gmail.com'; // Owner
                const email2 = 'helenaqueen010@gmail.com';     // Another Owner

                console.log(`\n--- Pages for ${email1} ---`);
                const res1 = await client.query(`
                    SELECT id, page_id, name, email, user_id FROM page_access_token_message 
                    WHERE email = $1 OR user_id IN (SELECT id FROM users WHERE email = $1)
                `, [email1]);
                console.table(res1.rows);

                console.log(`\n--- Pages for ${email2} ---`);
                const res2 = await client.query(`
                    SELECT id, page_id, name, email, user_id FROM page_access_token_message 
                    WHERE email = $1 OR user_id IN (SELECT id FROM users WHERE email = $1)
                `, [email2]);
                console.table(res2.rows);

        console.log(`\n--- Team Membership (Owner: ${email1}) ---`);
        const res3 = await client.query(`
            SELECT * FROM team_members 
            WHERE owner_email = $1
        `, [email1]);
        console.log(JSON.stringify(res3.rows, null, 2));

        console.log(`\n--- Team Membership (Member: ${email2}) ---`);
        // Check if this email is a member in ANY team
        const res4 = await client.query(`
            SELECT * FROM team_members 
            WHERE member_email = $1
        `, [email2]);
        console.log(JSON.stringify(res4.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

check();
