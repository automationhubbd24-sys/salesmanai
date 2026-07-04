const { Pool } = require('pg');

const DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const USER_EMAIL = 'kabialnoor@gmail.com';

async function checkWhatsAppSessions() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    });

    try {
        console.log('Connected to database successfully');
        console.log('--------------------------------');
        
        // Get user info
        console.log('1. Checking user_configs for email:', USER_EMAIL);
        const userResult = await pool.query(
            'SELECT * FROM user_configs WHERE email = $1 LIMIT 1',
            [USER_EMAIL]
        );
        console.log('user_configs result:', userResult.rows.length > 0 ? userResult.rows[0] : 'No user found');
        
        console.log('\n--------------------------------');
        
        // Get WhatsApp sessions for this user
        console.log('2. Checking whatsapp_sessions for email:', USER_EMAIL);
        const waSessionsResult = await pool.query(
            'SELECT * FROM whatsapp_sessions WHERE user_email = $1',
            [USER_EMAIL]
        );
        console.log('whatsapp_sessions results:', waSessionsResult.rows.length > 0 ? waSessionsResult.rows : 'No WhatsApp sessions found');
        
        console.log('\n--------------------------------');
        
        // Also check by user_id if we found one
        if (userResult.rows.length > 0 && userResult.rows[0].user_id) {
            console.log('3. Checking whatsapp_sessions by user_id:', userResult.rows[0].user_id);
            const waSessionsByUserId = await pool.query(
                'SELECT * FROM whatsapp_sessions WHERE user_id = $1',
                [userResult.rows[0].user_id]
            );
            console.log('whatsapp_sessions by user_id:', waSessionsByUserId.rows.length > 0 ? waSessionsByUserId.rows : 'No WhatsApp sessions found by user_id');
        }

    } catch (err) {
        console.error('Error querying database:', err.message);
        console.error(err.stack);
    } finally {
        await pool.end();
        console.log('\nDisconnected from database');
    }
}

checkWhatsAppSessions();
