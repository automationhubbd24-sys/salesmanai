const { Pool } = require('pg');

let pool = null;

function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL is not set for pgClient');
        }
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: parseInt(process.env.DB_MAX_CONNECTIONS) || 50, // Increased to 50 for high traffic (10k/min)
            idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 10000, // Faster timeout
            connectionTimeoutMillis: 5000, // 5s wait for connection
        });
    }
    return pool;
}

async function query(text, params) {
    const client = getPool();
    
    // Log query for debugging if needed (can be noisy, so we'll keep it simple)
    // console.log("[DBQuery]", text.substring(0, 200), params);

    try {
        return await client.query(text, params);
    } catch (err) {
        if (err.message.includes('operator does not exist: text = uuid') || err.message.includes('code: \'42883\'')) {
            console.error("[PGClient] UUID Type Mismatch detected. Attempting to log context...");
            console.error("[PGClient] Failed Query:", text);
            console.error("[PGClient] Params:", JSON.stringify(params));
        }
        throw err;
    }
}

module.exports = {
    query,
    getPool,
};

