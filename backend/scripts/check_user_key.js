
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function checkUserKey() {
    const searchKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    try {
        console.log(`Checking if API Key exists in user_configs...`);
        const res = await pgClient.query("SELECT user_id, balance FROM user_configs WHERE service_api_key = $1", [searchKey]);
        if (res.rows.length > 0) {
            console.log("Key Found in user_configs:", res.rows[0]);
        } else {
            console.log("Key NOT found in user_configs table. This is why our API calls might fail.");
        }
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

checkUserKey();
