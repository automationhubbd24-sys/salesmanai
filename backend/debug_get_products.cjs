
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres' });

async function testGetProducts(userId, pageId = null) {
    console.log(`\n--- Testing getProducts for User: ${userId} | Page: ${pageId} ---`);
    
    let params = [];
    let whereClause = '';

    if (pageId) {
        params.push(userId); // $1
        params.push(String(pageId)); // $2
        const userIdParam = '$1';
        
        // REPLICATING dbService.js logic EXACTLY
        whereClause = `(
            (user_id = ${userIdParam} AND (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb))
            OR
            (allowed_page_ids::jsonb @> jsonb_build_array($2::text))
        )`;
    } else {
        params.push(userId); // $1
        whereClause = 'user_id = $1';
    }

    const queryStr = `SELECT id, name, user_id, allowed_page_ids FROM products WHERE ${whereClause} LIMIT 5`;
    
    console.log("Query:", queryStr);
    console.log("Params:", params);

    try {
        const res = await client.query(queryStr, params);
        console.table(res.rows);
        return res.rows;
    } catch (e) {
        console.error("Query Failed:", e);
    }
}

(async () => {
    try {
        await client.connect();
        const ownerId = '45b7647f-8ee0-44c6-a230-ae82943ab6a6';
        const pageId = '997118700148575';

        // 1. Test Owner Viewing Page Context (Should see Product 627)
        await testGetProducts(ownerId, pageId);

        // 2. Test Owner Viewing Global Context (Should see Product 627??)
        await testGetProducts(ownerId, null);

    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
})();
