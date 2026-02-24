
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Read .env manually
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) {
        envVars[key.trim()] = value.join('=').trim();
    }
});

const pool = new Pool({
    connectionString: envVars.DATABASE_URL,
});

async function checkRecentProducts() {
    try {
        console.log("Checking users...");
        const users = await pool.query("SELECT id, email FROM users WHERE email IN ('automationhubbd24@gmail.com', 'xbluewhalebd@gmail.com', 'azaharalifrimick714420@gmail.com')");
        console.log("Users found:", users.rows);
        
        const userIdMap = {};
        users.rows.forEach(u => userIdMap[u.id] = u.email);

        console.log("\nChecking recent products (last 10)...");
        // Check columns first
        const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'products'");
        console.log("Product Columns:", cols.rows.map(r => r.column_name).join(', '));
        
        // Select recent products
        const res = await pool.query(`
            SELECT * FROM products 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        console.log("\nRecent Products:");
        res.rows.forEach(p => {
            console.log(`[${p.id}] Name: ${p.name}, UserID: ${p.user_id} (${userIdMap[p.user_id] || 'Unknown'}), Created: ${p.created_at}`);
            // Check if page_id is in columns
            if (p.page_id) console.log(`      PageID: ${p.page_id}`);
            if (p.description) console.log(`      Desc: ${p.description.substring(0, 50)}...`);
        });

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

checkRecentProducts();
