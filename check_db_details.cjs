const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env
dotenv.config({ path: path.join(__dirname, 'backend', '.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function checkUserConfigs() {
    try {
        await client.connect();
        console.log('Connected to database.');

        // Check user_configs columns
        const res = await client.query(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_configs'"
        );
        console.log('user_configs columns:', res.rows);
        
        // Check contents for xbluewhalebd
        const rows = await client.query(
            "SELECT * FROM user_configs WHERE email = 'xbluewhalebd@gmail.com'"
        );
        console.log('xbluewhalebd configs:', rows.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkUserConfigs();
