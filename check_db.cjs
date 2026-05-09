const { query } = require('./backend/src/services/pgClient');
require('dotenv').config({ path: './backend/.env' });

async function checkTables() {
    try {
        console.log('--- Table: page_access_token_message ---');
        const res1 = await query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'page_access_token_message'
        `);
        console.table(res1.rows);

        console.log('\n--- Table: user_configs ---');
        const res2 = await query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'user_configs'
        `);
        console.table(res2.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkTables();
