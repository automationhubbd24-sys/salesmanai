const { Pool } = require('pg');

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString });

async function checkProduct56() {
    try {
        const result = await pool.query("SELECT id, name, price, keywords, visual_tags FROM products WHERE id = '56'");
        console.log("Product 56 Details:", JSON.stringify(result.rows[0], null, 2));

        const result850 = await pool.query("SELECT id, name, price, keywords, visual_tags FROM products WHERE price::text = '850'");
        console.log("Products with Price 850:", JSON.stringify(result850.rows, null, 2));

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

checkProduct56();
