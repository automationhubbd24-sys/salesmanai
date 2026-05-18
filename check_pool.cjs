const pg = require('./backend/src/services/pgClient');
require('dotenv').config({ path: './backend/.env' });

async function check() {
    try {
        const userId = 'ce3994c3-56c2-45af-947d-a14f4887964e';
        const res = await pg.query(
            "SELECT id, provider, model, status FROM api_list WHERE owner_id = $1::uuid",
            [userId]
        );
        
        console.log('API List count:', res.rows.length);
        if (res.rows.length > 0) {
            console.log(JSON.stringify(res.rows, null, 2));
        }
        process.exit(0);
    } catch (e) {
        console.error('Error during check:', e);
        process.exit(1);
    }
}

check();
