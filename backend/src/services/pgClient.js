const { Pool } = require('pg');

let pool = null;

function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL is not set for pgClient');
        }
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: parseInt(process.env.DB_MAX_CONNECTIONS) || 75, // Increased for ultra-high concurrency
            idleTimeoutMillis: 30000, // Keep connections alive longer to avoid handshake overhead
            connectionTimeoutMillis: 2000, // Fail fast if DB is unreachable
            maxUses: 7500, // Recycle connections periodically to prevent memory leaks
        });
    }
    return pool;
}

async function query(text, params, retries = 2) {
    const client = getPool();
    let lastErr = null;

    for (let i = 0; i <= retries; i++) {
        try {
            return await client.query(text, params);
        } catch (err) {
            lastErr = err;
            // Retry on transient connection issues or busy errors
            const isTransient = err.message.includes('Connection terminated') || 
                              err.message.includes('timeout') ||
                              err.code === '57P01' || // admin_shutdown
                              err.code === '57P03';   // cannot_connect_now

            if (isTransient && i < retries) {
                const delay = (i + 1) * 200; // Exponential backoff
                console.warn(`[PGClient] Transient error (Attempt ${i+1}): ${err.message}. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // Log detailed info for UUID/Type mismatch errors to help debugging
            if (err.message.includes('operator does not exist') || err.code === '42883') {
                console.error("[PGClient] Query Error:", err.message);
                console.error("[PGClient] SQL:", text);
                console.error("[PGClient] Params:", JSON.stringify(params));
            }
            throw err;
        }
    }
    throw lastErr;
}

module.exports = {
    query,
    getPool,
};

