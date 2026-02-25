
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function checkApiKey() {
    const searchKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    try {
        console.log(`Checking if API Key exists in database...`);
        const res = await pgClient.query("SELECT id, provider, model, status FROM api_list WHERE api = $1", [searchKey]);
        if (res.rows.length > 0) {
            console.log("Key Found:", res.rows[0]);
        } else {
            console.log("Key NOT found in api_list table.");
        }
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

checkApiKey();
