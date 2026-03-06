const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function fixProducts() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        console.log("--- Fixing Product Assignments ---");
        
        // Find products where a WA session ID is incorrectly in allowed_page_ids
        const waSessionId = 'bottow_wh03lz';
        
        // Fix ID 657, 656, 655, 654
        const idsToFix = [657, 656, 655, 654];
        
        for (const id of idsToFix) {
            console.log(`Fixing Product ID: ${id}...`);
            await client.query(`
                UPDATE products 
                SET allowed_wa_sessions = jsonb_build_array($1::text),
                    allowed_page_ids = '[]'::jsonb
                WHERE id = $2
            `, [waSessionId, id]);
        }

        console.log("Done fixing specific products.");

        // General cleanup: Move any WA session ID from FB column to WA column if found
        // (Only for IDs starting with 'bottow_')
        console.log("Running general cleanup for 'bottow_' sessions...");
        const cleanupRes = await client.query(`
            UPDATE products
            SET allowed_wa_sessions = COALESCE(allowed_wa_sessions, '[]'::jsonb) || (
                SELECT jsonb_agg(elem) 
                FROM jsonb_array_elements_text(allowed_page_ids) AS elem 
                WHERE elem LIKE 'bottow_%'
            ),
            allowed_page_ids = (
                SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                FROM jsonb_array_elements_text(allowed_page_ids) AS elem 
                WHERE elem NOT LIKE 'bottow_%'
            )
            WHERE allowed_page_ids::text LIKE '%bottow_%'
        `);
        console.log(`General cleanup affected ${cleanupRes.rowCount} rows.`);

    } catch (e) {
        console.error("Error fixing DB:", e.message);
    } finally {
        await client.end();
        process.exit();
    }
}

fixProducts();
