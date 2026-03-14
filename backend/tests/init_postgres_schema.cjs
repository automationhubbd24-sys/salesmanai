const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL missing in backend/.env');
        process.exit(1);
    }

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    console.log('Connected to Postgres');

    const sql = fs.readFileSync(path.join(__dirname, 'init_postgres_schema.sql'), 'utf8');
    await client.query(sql);
    console.log('Schema created/updated');

    const insertRes = await client.query(
        `INSERT INTO fb_chats (page_id, text, status) VALUES ($1, $2, $3) RETURNING id`,
        ['TEST_PAGE', 'Hello from init_postgres_schema.cjs', 'received']
    );
    console.log('Inserted test row with id=', insertRes.rows[0].id);

    const selectRes = await client.query(
        `SELECT id, page_id, text, status FROM fb_chats ORDER BY id DESC LIMIT 5`
    );
    console.log('Last fb_chats rows:', selectRes.rows);

    await client.end();
}

main().catch(err => {
    console.error('Error running init script:', err);
    process.exit(1);
});

