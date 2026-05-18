const { Client } = require('pg');

async function debugDB() {
    const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
    const client = new Client({ connectionString, ssl: false });

    try {
        await client.connect();
        const configRes = await client.query(
            "SELECT text_models_list FROM api_engine_configs WHERE provider = 'google'"
        );
        console.log(JSON.stringify(configRes.rows[0].text_models_list, null, 2));
        await client.end();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
debugDB();
