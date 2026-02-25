
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function updateConfig() {
    try {
        console.log("Updating api_engine_configs...");
        
        // Update Flash Engine (ID: 2) and Pro Engine (ID: 1)
        await pgClient.query(
            "UPDATE api_engine_configs SET vision_model = 'google/gemini-2.0-flash-001' WHERE id IN ('1', '2')"
        );

        // Fix typos in model names for Pro Engine (ID: 1)
        await pgClient.query(
            "UPDATE api_engine_configs SET text_model = 'gemini-2.0-flash', voice_model = 'gemini-2.0-flash-lite' WHERE id = '1'"
        );

        console.log("SUCCESS: Engine configurations updated.");
        process.exit(0);
    } catch (err) {
        console.error("ERROR:", err.message);
        process.exit(1);
    }
}

updateConfig();
