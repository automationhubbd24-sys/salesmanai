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
    // ssl removed
});

async function checkData() {
    try {
        await client.connect();
        console.log("Connected to database.");

        console.log("\n--- WhatsApp Sessions ---");
        const res = await client.query('SELECT id, session_name, user_id, api_key, ai_provider FROM whatsapp_message_database LIMIT 5');
        res.rows.forEach(row => {
            console.log(row);
        });

        console.log("\n--- WhatsApp Message Database Columns ---");
        const res4 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'whatsapp_message_database'
        `);
        console.table(res4.rows);

        console.log("\n--- API List Columns ---");
        const res5 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'api_list'
        `);
        console.table(res5.rows);

        console.log("\n--- FB Message Database Columns ---");
        const res6 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'fb_message_database'
        `);
        console.table(res6.rows);

        console.log("\n--- Page Access Token Message Columns ---");
        const res7 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'page_access_token_message'
        `);
        console.table(res7.rows);

        console.log("\n--- Products Columns ---");
        const res8 = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'products'
        `);
        console.table(res8.rows);

    } catch (err) {
        console.error("Database error:", err);
    } finally {
        await client.end();
    }
}

checkData();
