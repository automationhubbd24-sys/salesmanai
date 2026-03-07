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
    try {
        return await client.query(text, params);
    } catch (err) {
        // Log detailed info for UUID/Type mismatch errors to help debugging
        if (err.message.includes('operator does not exist') || err.code === '42883') {
            console.error("[PGClient] Query Error:", err.message);
            console.error("[PGClient] SQL:", text);
            console.error("[PGClient] Params:", JSON.stringify(params));
        }
        throw err;
    }
}

module.exports = {
    query,
    getPool,
};

