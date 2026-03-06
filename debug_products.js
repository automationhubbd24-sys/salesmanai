const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function checkProducts() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        console.log("--- Products and their Platform Assignments ---");
        const res = await client.query(`
            SELECT id, name, allowed_page_ids, allowed_wa_sessions 
            FROM products 
            ORDER BY created_at DESC 
            LIMIT 20
        `);
        
        res.rows.forEach(p => {
            console.log(`ID: ${p.id} | Name: ${p.name}`);
            console.log(`  Allowed Page IDs (Messenger): ${JSON.stringify(p.allowed_page_ids)}`);
            console.log(`  Allowed WA Sessions (WhatsApp): ${JSON.stringify(p.allowed_wa_sessions)}`);
            console.log("-----------------------------------");
        });

        console.log("\n--- Checking for product 'money_wpp' ---");
        const moneyWppRes = await client.query(`
            SELECT id, name, allowed_page_ids, allowed_wa_sessions, is_active 
            FROM products 
            WHERE name ILIKE '%money_wpp%'
        `);
        if (moneyWppRes.rows.length === 0) {
            console.log("Product 'money_wpp' not found in database.");
        } else {
            moneyWppRes.rows.forEach(p => {
                console.log(`ID: ${p.id} | Name: ${p.name} | Active: ${p.is_active}`);
                console.log(`  Allowed Page IDs (FB): ${JSON.stringify(p.allowed_page_ids)}`);
                console.log(`  Allowed WA Sessions (WA): ${JSON.stringify(p.allowed_wa_sessions)}`);
            });
        }
    } catch (e) {
        console.error("Error checking DB:", e.message);
    } finally {
        await client.end();
        process.exit();
    }
}

checkProducts();
