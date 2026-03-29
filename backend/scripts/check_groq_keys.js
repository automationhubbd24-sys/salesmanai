
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function checkGroqKeys() {
    try {
        console.log("Checking Groq keys in api_list table...");
        const res = await pgClient.query("SELECT id, provider, status, SUBSTRING(api, 1, 15) as key_start FROM api_list WHERE provider = 'groq'");
        console.table(res.rows);
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

checkGroqKeys();
