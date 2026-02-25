
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function insertKey() {
    const key = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    try {
        console.log(`Inserting key into api_list...`);
        await pgClient.query(
            "INSERT INTO api_list (api, provider, model, status) VALUES ($1, $2, $3, $4) ON CONFLICT (api) DO NOTHING",
            [key, 'openrouter', 'default', 'active']
        );
        console.log("SUCCESS: Key inserted/verified in api_list.");
        process.exit(0);
    } catch (err) {
        console.error("ERROR:", err.message);
        process.exit(1);
    }
}

insertKey();
