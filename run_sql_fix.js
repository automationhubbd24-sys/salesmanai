const pg = require('pg');

// Use the new DATABASE_URL provided by user
const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function fixDatabase() {
    const client = new pg.Client({ 
        connectionString: DATABASE_URL,
        connectionTimeoutMillis: 10000 
    });
    
    try {
        await client.connect();
        console.log("--- Executing SQL Fixes ---");
        
        // 1. Add use_proxy column if it doesn't exist
        console.log("Adding 'use_proxy' column to engine_configs...");
        await client.query("ALTER TABLE engine_configs ADD COLUMN IF NOT EXISTS use_proxy BOOLEAN DEFAULT FALSE;");
        console.log("✅ Column added (or already exists).");

        // 2. Set use_proxy = TRUE for branded models
        console.log("Enabling proxy for branded models...");
        await client.query("UPDATE engine_configs SET use_proxy = TRUE WHERE name IN ('salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite');");
        console.log("✅ Proxy enabled for pro, flash, and lite models.");

        // 3. Check for 'model' vs 'name' vs other columns to debug why your endpoint fails
        console.log("\n--- Debugging engine_configs Table Structure ---");
        const tableInfo = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'engine_configs';
        `);
        console.table(tableInfo.rows);

        // 4. Verify current state
        const verifyRes = await client.query("SELECT name, use_proxy FROM engine_configs WHERE name IN ('salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite');");
        console.log("\n--- Current Configuration ---");
        console.table(verifyRes.rows);

    } catch (err) {
        console.error("❌ SQL Error:", err.message);
    } finally {
        await client.end();
        process.exit();
    }
}

fixDatabase();
