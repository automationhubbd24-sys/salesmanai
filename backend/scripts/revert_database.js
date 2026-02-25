
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');

async function revertDatabase() {
    try {
        console.log("Reverting api_engine_configs to OpenRouter models...");
        
        // Revert Flash Engine (ID: 2) to OpenRouter Trinity for Vision
        await pgClient.query(
            "UPDATE api_engine_configs SET vision_model = 'arcee-ai/trinity-large-preview' WHERE id = '2'"
        );
        
        // Revert Pro Engine (ID: 1) to Google Gemini (but keep it as it was if possible, or common default)
        await pgClient.query(
            "UPDATE api_engine_configs SET vision_model = 'qwen/qwen3-vl-30b-a3b-thinking', text_model = 'gemini-2.5-flash', voice_model = 'gemini-2.5-flash-lite' WHERE id = '1'"
        );

        console.log("SUCCESS: Database reverted.");
        process.exit(0);
    } catch (err) {
        console.error("ERROR:", err.message);
        process.exit(1);
    }
}

revertDatabase();
