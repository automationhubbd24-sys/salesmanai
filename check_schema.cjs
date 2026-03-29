const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        
        console.log("Schema for page_access_token_message:");
        const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'page_access_token_message'");
        res.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
