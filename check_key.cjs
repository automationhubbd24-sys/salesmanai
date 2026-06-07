const pg = require('./backend/src/services/pgClient');
require('dotenv').config({ path: './backend/.env' });

async function check() {
    try {
        const apiKey = 'sk-fa8d1997a7838fdc6fdb1f51c763bd36ae0bbec5d153d527';
        const res = await pg.query(
            'SELECT user_id, balance, service_api_key, api_key FROM user_configs WHERE service_api_key = $1',
            [apiKey]
        );
        
        if (res.rows.length === 0) {
            console.log('Key not found');
        } else {
            console.log(JSON.stringify(res.rows[0], null, 2));
        }
        process.exit(0);
    } catch (e) {
        console.error('Error during check:', e);
        process.exit(1);
    }
}

check();
