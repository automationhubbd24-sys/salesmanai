
const { Client } = require('pg');

async function checkData() {
    const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
    const client = new Client({ connectionString });
    
    try {
        await client.connect();
        console.log('Connected to DB');
        
        const email = 'automationhubbd24@gmail.com';
        
        console.log(`Checking whatsapp_message_database for email: ${email}`);
        const res = await client.query('SELECT id, session_name, email, user_id, provider_type, status FROM whatsapp_message_database WHERE email = $1', [email]);
        console.log('Results from whatsapp_message_database:', JSON.stringify(res.rows, null, 2));
        
        console.log('Checking whatsapp_sessions for user_email:', email);
        const res2 = await client.query('SELECT id, session_id, session_name, user_email, user_id, status FROM whatsapp_sessions WHERE user_email = $1', [email]);
        console.log('Results from whatsapp_sessions:', JSON.stringify(res2.rows, null, 2));

        // Also check users table to see if the user exists and what's their ID
        const res3 = await client.query('SELECT id, email FROM users WHERE email = $1', [email]);
        console.log('Results from users table:', JSON.stringify(res3.rows, null, 2));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkData();
