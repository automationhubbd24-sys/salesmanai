const { Client } = require('pg');

const connectionString = "postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres";

async function checkRimuColumns() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const rimuId = '106524637410742';

        console.log(`\n--- Checking columns for Rimu's World (${rimuId}) ---`);
        const res = await client.query(
            "SELECT name, allowed_page_ids, allowed_messenger_ids FROM products WHERE (allowed_page_ids::jsonb @> jsonb_build_array($1::text)) OR (allowed_messenger_ids::jsonb @> jsonb_build_array($1::text)) LIMIT 5",
            [rimuId]
        );

        res.rows.forEach(row => {
            console.log(`Product: ${row.name}`);
            console.log(`  allowed_page_ids: ${JSON.stringify(row.allowed_page_ids)}`);
            console.log(`  allowed_messenger_ids: ${JSON.stringify(row.allowed_messenger_ids)}`);
        });

    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await client.end();
    }
}

checkRimuColumns();
