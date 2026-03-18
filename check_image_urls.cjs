const { Client } = require('pg');
require('dotenv').config();

async function checkImageUrls() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        const res = await client.query("SELECT name, image_url FROM products WHERE image_url IS NOT NULL LIMIT 10");
        console.log("--- Sample Image URLs ---");
        res.rows.forEach(row => {
            console.log(`Product: ${row.name}`);
            console.log(`URL: ${row.image_url}`);
            console.log("---");
        });
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

checkImageUrls();
