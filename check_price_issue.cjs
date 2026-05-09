const { Pool } = require('pg');

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString });

async function check() {
    try {
        console.log("Checking Product ID 43 (নাক ও কান ফোঁড়ানোর মেশিন)");
        
        // 1. Check product 43 details
        const productResult = await pool.query('SELECT * FROM products WHERE id = $1', ['43']);
        console.log("Product Details:", JSON.stringify(productResult.rows, null, 2));

        // 2. Search products with the query "নাক কান ফোঁড়ানোর মেশিন"
        // Simulate searchProducts logic (Hybrid)
        const userId = 'ce3994c3-56c2-45af-947d-a14f4887964e';
        const queryText = "নাক কান ফোঁড়ানোর মেশিন";
        
        console.log(`\nSimulating Search for: "${queryText}"`);
        
        // We can't easily simulate vector search here without embedding service, 
        // but we can check the Keyword part of the hybrid search.
        const keywordMatch = await pool.query(
            "SELECT id, name, price FROM products WHERE user_id::text = $1::text AND (name ILIKE $2 OR keywords::text ILIKE $2)",
            [userId, `%${queryText}%`]
        );
        console.log("Keyword Matches:", keywordMatch.rows);

        // 3. Check if there is ANY product with price 450 that might be confusing the AI
        const products450 = await pool.query(
            "SELECT id, name, price FROM products WHERE user_id::text = $1::text AND price::text = '450'",
            [userId]
        );
        console.log("\nProducts with price 450:", products450.rows);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

check();
