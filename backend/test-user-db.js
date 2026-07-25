
const { Client } = require('pg');

const dbUrl = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function check() {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    console.log('Connected!');

    try {
        // Get user by email
        const userResult = await client.query('SELECT id, email FROM users WHERE email = $1', ['gamersahariar@gmail.com']);
        console.log('User:', userResult.rows);

        if (userResult.rows.length > 0) {
            const userId = userResult.rows[0].id;

            // Get WhatsApp sessions for this user
            const waSessions = await client.query('SELECT session_name, waba_id, phone_number_id, user_id, email FROM whatsapp_message_database WHERE user_id = $1 OR email = $2', [userId, 'gamersahariar@gmail.com']);
            console.log('WA Sessions:', waSessions.rows);

            // Get ALL products
            const allProducts = await client.query('SELECT id, name, user_id, allowed_wa_sessions, allowed_messenger_ids FROM products');
            console.log('All Products:', allProducts.rows);

            // Find products named test1, test2, test3, test4
            const testProducts = allProducts.rows.filter(p => /test[1-4]/.test(p.name.toLowerCase()));
            console.log('Test Products:', testProducts);

            // Check if products have allowed_wa_sessions that match any of the sessions
            const waSessionIds = waSessions.rows.flatMap(s => [s.session_name, s.waba_id, s.phone_number_id]).filter(Boolean);
            console.log('WA Session IDs to check:', waSessionIds);

            for (const product of testProducts) {
                const allowedWaSessions = product.allowed_wa_sessions || [];
                console.log(`Test Product ${product.name} (user: ${product.user_id}): allowed_wa_sessions:`, allowedWaSessions);
                console.log('  Matches any session IDs?', allowedWaSessions.some(s => waSessionIds.includes(s)));
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }

    await client.end();
}

check();
