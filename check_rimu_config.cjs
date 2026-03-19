
require('dotenv').config({ path: './backend/.env' });
const { query } = require('./backend/src/services/pgClient');

async function checkRimu() {
    try {
        const res = await query('SELECT page_id, ai, chat_model, api_key, cheap_engine FROM page_access_token_message WHERE page_id = $1', ['473665619156212']);
        console.log("Rimu Page Configs:");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}

checkRimu();
