const pgClient = require('./src/services/pgClient');
require('dotenv').config();

async function checkKeys() {
    try {
        const userId = 'ce3994c3-56c2-45af-947d-a14f4887964e';
        console.log(`Checking keys for user: ${userId}`);
        
        const res = await pgClient.query(
            "SELECT id, provider, model, status, mode, owner_id FROM api_list WHERE owner_id = $1::uuid AND mode = 'dev'",
            [userId]
        );
        
        console.log('--- Dev Keys Found ---');
        console.log(JSON.stringify(res.rows, null, 2));
        console.log(`Total: ${res.rows.length}`);
        
        process.exit(0);
    } catch (err) {
        console.error('Error checking keys:', err.message);
        process.exit(1);
    }
}

checkKeys();
