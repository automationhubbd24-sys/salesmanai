
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function checkApiList() {
    try {
        console.log("Fetching api_list from database...");
        const res = await pgClient.query("SELECT id, provider, model, status, SUBSTRING(api, 1, 15) as key_start FROM api_list");
        console.log("API List Keys:");
        console.table(res.rows);
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

checkApiList();
