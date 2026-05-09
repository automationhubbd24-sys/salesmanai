const { Client } = require('pg');
const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function checkImages() {
    const client = new Client({ connectionString, ssl: false });
    try {
        await client.connect();
        const rimusShopId = '106524637410742';
        const nishchintoId = '102360321669770';
        
        console.log('--- Checking Rimu\'s shop (Working) ---');
        const res1 = await client.query(`
            SELECT id, name, image_url, additional_images 
            FROM products 
            WHERE allowed_messenger_ids::jsonb @> jsonb_build_array($1::text)
            OR allowed_page_ids::jsonb @> jsonb_build_array($1::text)
            LIMIT 10
        `, [rimusShopId]);
        
        if (res1.rows.length === 0) {
            console.log('No products found for Rimu\'s shop using JSONB query. Checking with ILIKE...');
            const res1Alt = await client.query(`SELECT id, name, image_url FROM products WHERE allowed_page_ids::text LIKE $1 LIMIT 10`, [`%${rimusShopId}%`]);
            console.table(res1Alt.rows);
        } else {
            console.table(res1.rows);
        }

        console.log('\n--- Checking Nishchinto dot Com (Failing) ---');
        const res2 = await client.query(`
            SELECT id, name, image_url, additional_images 
            FROM products 
            WHERE allowed_messenger_ids::jsonb @> jsonb_build_array($1::text)
            OR allowed_page_ids::jsonb @> jsonb_build_array($1::text)
            LIMIT 10
        `, [nishchintoId]);

        if (res2.rows.length === 0) {
            console.log('No products found for Nishchinto dot Com using JSONB query. Checking with ILIKE...');
            const res2Alt = await client.query(`SELECT id, name, image_url FROM products WHERE allowed_page_ids::text LIKE $1 LIMIT 10`, [`%${nishchintoId}%`]);
            console.table(res2Alt.rows);
        } else {
            console.table(res2.rows);
        }

        // Global Products check
        console.log('\n--- Checking Global Products ---');
        const res3 = await client.query(`SELECT id, name, image_url FROM products WHERE platform = 'global' LIMIT 5`);
        console.table(res3.rows);

    } catch (err) {
        console.error('Database Error:', err.message);
    } finally {
        await client.end();
    }
}
checkImages();
