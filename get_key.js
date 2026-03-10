const pgClient = require('./backend/src/services/pgClient');

async function getGeminiKey() {
    try {
        const result = await pgClient.query("SELECT api FROM api_list WHERE provider = 'google' AND status = 'active' LIMIT 1;");
        if (result.rows.length > 0) {
            console.log("KEY_FOUND:", result.rows[0].api);
        } else {
            console.log("NO_KEY_FOUND");
        }
    } catch (err) {
        console.error("DB_ERROR:", err.message);
    } finally {
        process.exit();
    }
}
getGeminiKey();
