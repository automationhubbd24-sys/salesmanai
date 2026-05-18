const { Client } = require('pg');

async function debugDB() {
    const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
    const client = new Client({
        connectionString: connectionString,
        ssl: false
    });

    try {
        await client.connect();
        console.log('--- Database Connected Successfully ---');

        // 1. Check Dev Keys for your specific owner_id
        const ownerId = 'ce3994c3-56c2-45af-947d-a14f4887964e';
        const res = await client.query(
            "SELECT id, provider, model, status, mode, owner_id, LEFT(api, 12) as api_masked FROM api_list WHERE owner_id = $1::uuid",
            [ownerId]
        );
        
        console.log(`\nFound ${res.rows.length} keys for Owner ID: ${ownerId}`);
        console.table(res.rows);

        // 2. Check if there are ANY keys with mode='dev'
        const devRes = await client.query(
            "SELECT COUNT(*)::int as count FROM api_list WHERE mode = 'dev'"
        );
        console.log(`\nTotal keys in 'dev' mode across all users: ${devRes.rows[0].count}`);

        // 3. Check Global Engine Config for google
        const configRes = await client.query(
            "SELECT * FROM api_engine_configs WHERE provider = 'google'"
        );
        console.log('\n--- Google Engine Configuration ---');
        console.table(configRes.rows);

        await client.end();
    } catch (err) {
        console.error('Database Connection Error:', err.message);
        process.exit(1);
    }
}

debugDB();
