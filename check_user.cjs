const pg = require('./backend/src/services/pgClient');
require('dotenv').config({ path: './backend/.env' });

async function check() {
    try {
        const email = 'xbluewhalebd@gmail.com';
        const res = await pg.query('SELECT user_id, email FROM user_configs WHERE email = $1', [email]);
        console.log('User Data:', JSON.stringify(res.rows[0], null, 2));
        
        if (res.rows[0]) {
            const userId = res.rows[0].user_id;
            const apiRes = await pg.query('SELECT id, provider, api, mode, owner_id FROM api_list WHERE owner_id = $1::uuid', [userId]);
            console.log('API List for this user:', JSON.stringify(apiRes.rows, null, 2));
        }
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

check();
