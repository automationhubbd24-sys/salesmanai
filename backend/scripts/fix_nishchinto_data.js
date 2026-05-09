const { Client } = require('pg');
const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function fixNishchintoData() {
    const client = new Client({ connectionString, ssl: false });
    try {
        await client.connect();
        const nishchintoId = '102360321669770';
        
        console.log(`--- Fixing Data for Nishchinto dot Com (${nishchintoId}) ---`);
        
        // 1. Find products that are in legacy column but not in new column
        const res = await client.query(`
            UPDATE products 
            SET allowed_messenger_ids = allowed_page_ids
            WHERE allowed_page_ids::text LIKE $1
            AND (allowed_messenger_ids IS NULL OR allowed_messenger_ids::text = '[]')
        `, [`%${nishchintoId}%`]);

        console.log(`Successfully migrated ${res.rowCount} products to allowed_messenger_ids.`);

        // 2. Double check and merge if both exist but messenger_ids is missing the specific ID
        const res2 = await client.query(`
            UPDATE products 
            SET allowed_messenger_ids = allowed_messenger_ids::jsonb || jsonb_build_array($1::text)
            WHERE allowed_page_ids::text LIKE $2
            AND NOT (allowed_messenger_ids::jsonb @> jsonb_build_array($1::text))
        `, [nishchintoId, `%${nishchintoId}%`]);

        console.log(`Successfully synced ${res2.rowCount} additional products.`);

        // 3. Verification
        const verify = await client.query(`
            SELECT id, name, allowed_messenger_ids 
            FROM products 
            WHERE allowed_messenger_ids::jsonb @> jsonb_build_array($1::text)
        `, [nishchintoId]);
        
        console.log(`\nVerification: Total ${verify.rows.length} products are now correctly linked to Nishchinto dot Com.`);

    } catch (err) {
        console.error('Error during data fix:', err.message);
    } finally {
        await client.end();
    }
}
fixNishchintoData();
