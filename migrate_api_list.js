const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres'
});

async function migrate() {
    try {
        await client.connect();
        console.log("Adding last_rpd_hit_at column to api_list...");
        await client.query(`ALTER TABLE api_list ADD COLUMN IF NOT EXISTS last_rpd_hit_at TIMESTAMP`);
        console.log("Migration completed.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        await client.end();
    }
}

migrate();
