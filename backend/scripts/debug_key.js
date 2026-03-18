const pg = require('pg');
const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function checkKey() {
    const client = new pg.Client(DATABASE_URL);
    try {
        await client.connect();
        const key = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
        console.log(`Checking key: ${key}`);
        
        const res = await client.query(
            'SELECT user_id, balance, service_api_key FROM user_configs WHERE service_api_key = $1',
            [key]
        );
        
        if (res.rows.length === 0) {
            console.log('❌ Key NOT found in database.');
        } else {
            console.log('✅ Key found:');
            console.log(JSON.stringify(res.rows[0], null, 2));
            
            const userId = res.rows[0].user_id;
            const usageRes = await client.query(
                'SELECT COUNT(*)::int AS cnt FROM api_usage_stats WHERE user_id = $1',
                [userId]
            );
            console.log(`Usage count: ${usageRes.rows[0].cnt}`);
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkKey();
