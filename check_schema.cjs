const { Client } = require('pg');
require('dotenv').config({ path: 'backend/.env' });

async function checkSchema() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products'");
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
checkSchema();