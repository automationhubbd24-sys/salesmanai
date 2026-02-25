
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function checkData() {
    try {
        const res = await pgClient.query("SELECT * FROM api_engine_configs");
        console.log("Data:", JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

checkData();
