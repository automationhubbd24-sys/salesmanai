
const { query } = require('./src/services/pgClient');
process.env.DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function testSessionsAPI() {
    try {
        const userId = '45b7647f-8ee0-44c6-a230-ae82943ab6a6';
        const userEmail = 'mdedu99@gmail.com'; // From my knowledge or debug logs

        const { rows } = await query(
            'SELECT id, session_name, expires_at, plan_days, status, subscription_status, user_id, email FROM whatsapp_message_database WHERE user_id = $1 OR email = $2',
            [userId, userEmail]
        );
        console.log("WhatsApp Sessions Rows:");
        console.log(JSON.stringify(rows, null, 2));

    } catch (e) {
        console.error("Test Failed:", e.message);
    } finally {
        process.exit(0);
    }
}

testSessionsAPI();
