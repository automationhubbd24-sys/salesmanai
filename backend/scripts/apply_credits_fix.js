const path = require('path');
// Load env BEFORE requiring pgClient, just to be safe, though pgClient is lazy
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { query, getPool } = require('../src/services/pgClient');
const fs = require('fs');

async function run() {
    try {
        const sqlPath = path.join(__dirname, '../sql/grant_initial_credits.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Running SQL...');
        
        // Execute the SQL
        await query(sql);
        
        console.log('Successfully granted initial credits to all users.');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        // We need to close the pool to exit the script
        const pool = getPool();
        if (pool) {
            await pool.end();
        }
    }
}

run();
