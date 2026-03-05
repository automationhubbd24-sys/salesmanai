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

        const res = await client.query('SELECT id, session_name, user_id, email FROM whatsapp_message_database LIMIT 10');
        console.log("Rows found:", res.rowCount);
        res.rows.forEach(row => console.log(row));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

check();
