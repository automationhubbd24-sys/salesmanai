const { Client } = require('pg');
require('dotenv').config();

async function checkUrls() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        const res = await client.query("SELECT image_url FROM products WHERE image_url IS NOT NULL LIMIT 5");
        console.log("Sample Image URLs:");
        res.rows.forEach(row => console.log(row.image_url));
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

checkUrls();
