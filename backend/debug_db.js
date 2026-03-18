
const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function check() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        
        // 1. Check for specific page ID (Cosmetic Hub)
        const pageId = '1018705751321580';
        const res = await client.query(
            "SELECT id, name, allowed_page_ids, allowed_wa_sessions FROM products WHERE allowed_page_ids::jsonb @> jsonb_build_array($1::text) LIMIT 10",
            [pageId]
        );
        console.log(`\n--- Products for Cosmetic Hub (${pageId}) ---`);
        console.log(JSON.stringify(res.rows, null, 2));

        // 2. Check general visibility (all products)
        const allRes = await client.query(
            "SELECT id, name, allowed_page_ids, allowed_wa_sessions FROM products LIMIT 5"
        );
        console.log('\n--- General Product Samples (All) ---');
        console.log(JSON.stringify(allRes.rows, null, 2));

        // 3. Check WhatsApp assigned products
        const waRes = await client.query(
            "SELECT id, name, allowed_wa_sessions FROM products WHERE allowed_wa_sessions IS NOT NULL AND allowed_wa_sessions::jsonb != '[]'::jsonb LIMIT 5"
        );
        console.log('\n--- WhatsApp Assigned Products ---');
        console.log(JSON.stringify(waRes.rows, null, 2));

    } catch (e) {
        console.error("DB Check Failed:", e.message);
    } finally {
        await client.end();
    }
}

check();
