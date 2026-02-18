const { Pool } = require('pg');

let pool = null;

function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL is not set for pgClient');
        }
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
    }
    return pool;
}

async function query(text, params) {
    const client = getPool();
    return client.query(text, params);
}

module.exports = {
    query,
    getPool,
};

