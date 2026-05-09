const { Client } = require('pg');
const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function checkProducts() {
    const client = new Client({ connectionString, ssl: false });
    try {
        await client.connect();
        const pages = ['106524637410742', '102360321669770'];
        
        console.log('--- Products for Rimu\'s shop (106524637410742) ---');
        const res1 = await client.query(`
            SELECT id, name, image_url 
            FROM products 
            WHERE allowed_page_ids::jsonb ? '106524637410742' 
            LIMIT 5
        `);
        console.table(res1.rows);

        console.log('--- Products for Nishchinto dot Com (102360321669770) ---');
        const res2 = await client.query(`
            SELECT id, name, image_url 
            FROM products 
            WHERE allowed_page_ids::jsonb ? '102360321669770' 
            LIMIT 5
        `);
        console.table(res2.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
checkProducts();
