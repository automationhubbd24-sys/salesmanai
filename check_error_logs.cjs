
const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkLogs() {
  try {
    const client = await pool.connect();
    
    console.log("=== LATEST 20 ERROR LOGS ===");
    try {
        const res = await client.query('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 20');
        if (res.rows.length === 0) {
            console.log("No error logs found in 'error_logs' table.");
        } else {
            res.rows.forEach(row => {
                console.log(`[${row.created_at}] [${row.context}] ${row.error_message}`);
                // console.log(row.metadata);
            });
        }
    } catch (e) {
        console.log("Could not query 'error_logs': " + e.message);
    }

    console.log("\n=== LATEST 5 SYSTEM LOGS ===");
    try {
        const res = await client.query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 5');
         if (res.rows.length === 0) {
            console.log("No system logs found in 'system_logs' table.");
        } else {
            res.rows.forEach(row => {
                console.log(`[${row.created_at}] [${row.level}] ${row.message}`);
            });
        }
    } catch (e) {
        console.log("Could not query 'system_logs': " + e.message);
    }

    client.release();
  } catch (err) {
    console.error('Error connecting to DB:', err);
  } finally {
    await pool.end();
  }
}

checkLogs();
