const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
        console.log("Tables:");
        res.rows.forEach(r => console.log(r.table_name));
        
        console.log("\nChecking facebook_pages count:");
        try {
            const pages = await client.query("SELECT * FROM facebook_pages"); // Assuming table name
            console.log(pages.rowCount);
        } catch (e) {
            console.log("facebook_pages table not found or error:", e.message);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
