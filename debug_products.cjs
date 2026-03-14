const pg = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new pg.Client({
    connectionString: process.env.DATABASE_URL
});

async function debugProducts() {
    try {
        await client.connect();
        
        console.log("=== Recent Products ===");
        const res = await client.query(`
            SELECT p.id, p.name, p.user_id, u.email as user_email, p.created_at, p.allowed_page_ids
            FROM products p
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC
            LIMIT 5
        `);
        
        res.rows.forEach(r => {
            console.log(`Product: ${r.name} (ID: ${r.id})`);
            console.log(`  Owner: ${r.user_email} (${r.user_id})`);
            console.log(`  Allowed Pages:`, r.allowed_page_ids);
            console.log(`  Created: ${r.created_at}`);
        });

        console.log("\n=== Page Ownership ===");
        // Check pages mentioned in products or just recent pages
        const pageRes = await client.query(`
            SELECT page_id, name, email, user_id
            FROM page_access_token_message
            LIMIT 10
        `);
        
        pageRes.rows.forEach(p => {
             console.log(`Page: ${p.name} (${p.page_id}) -> Owner: ${p.email}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

debugProducts();
