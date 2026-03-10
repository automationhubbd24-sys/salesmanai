const pg = require('pg');
const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function checkConfigs() {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        console.log("--- api_engine_configs ---");
        const res1 = await client.query("SELECT * FROM api_engine_configs");
        console.table(res1.rows);
        
        console.log("\n--- engine_configs ---");
        const res2 = await client.query("SELECT * FROM engine_configs");
        console.table(res2.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
checkConfigs();
