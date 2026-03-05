import pg from 'pg';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testConnections() {
    console.log("--- Testing Connections ---");

    // 1. COOLIFY TEST
    try {
        console.log("Checking Coolify...");
        // Coolify API usually has a /version or /health endpoint, checking /services or similar via generic call
        // Using the base URL provided: http://72.62.196.104:8000/api/v1
        const coolifyRes = await axios.get(`${process.env.COOLIFY_URL}/version`, {
            headers: { Authorization: `Bearer ${process.env.COOLIFY_TOKEN}` },
            timeout: 5000
        });
        console.log(`✅ Coolify Connected! Version: ${coolifyRes.data}`);
    } catch (err) {
        console.log(`❌ Coolify Failed: ${err.message}`);
        if (err.response) console.log(`   Status: ${err.response.status}`);
    }

    // 2. POSTGRES TEST
    try {
        console.log("Checking Postgres...");
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        const res = await client.query('SELECT 1 as val');
        await client.end();
        console.log(`✅ Postgres Connected! Test Query Result: ${res.rows[0].val}`);
    } catch (err) {
        console.log(`❌ Postgres Failed: ${err.message}`);
    }

    // 3. HOSTINGER API TEST (Assuming the key is an API Token)
    try {
        console.log("Checking Hostinger API...");
        // Hostinger API Base URL (Example: https://api.hostinger.com/v1)
        // Trying to list servers or get account info
        const hostingerRes = await axios.get('https://api.hostinger.com/v1/servers', {
            headers: { Authorization: `Bearer ${process.env.HOSTINGER_PASSWORD}` },
            timeout: 5000
        });
        console.log(`✅ Hostinger API Connected! Servers: ${hostingerRes.data.length}`);
    } catch (err) {
        console.log(`❌ Hostinger API Failed: ${err.message}`);
        if (err.response) console.log(`   Status: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
    }
}

testConnections();
