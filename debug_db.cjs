const pg = require('./backend/src/services/pgClient');
require('dotenv').config({ path: './backend/.env' });

async function check() {
    try {
        const res = await pg.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_configs'");
        console.log('Columns:', JSON.stringify(res.rows, null, 2));
        
        const userRes = await pg.query("SELECT user_id FROM user_configs LIMIT 1");
        console.log("Sample user_id:", userRes.rows[0]);
        
        const apiListRes = await pg.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'api_list'");
        console.log('API List Columns:', JSON.stringify(apiListRes.rows, null, 2));
        
        process.exit(0);
    } catch (e) {
        console.error('Error during check:', e);
        process.exit(1);
    }
}

check();
