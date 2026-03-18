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

        const email = 'xbluewhalebd@gmail.com';

        console.log(`\n--- WhatsApp Sessions for ${email} ---`);
        const res = await client.query(`
            SELECT * FROM whatsapp_message_database 
            WHERE email = $1 OR user_id IN (SELECT id FROM users WHERE email = $1)
        `, [email]);
        console.table(res.rows);

        console.log(`\n--- WhatsApp Sessions for automationhubbd24@gmail.com ---`);
        const res2 = await client.query(`
            SELECT * FROM whatsapp_message_database 
            WHERE email = 'automationhubbd24@gmail.com'
        `);
        console.table(res2.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

check();
