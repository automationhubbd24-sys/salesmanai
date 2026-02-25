
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function checkSchema() {
    try {
        const res = await pgClient.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'api_engine_configs'");
        console.log("Columns:", res.rows.map(r => r.column_name).join(', '));
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

checkSchema();
