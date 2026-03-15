const { Client } = require('pg');

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function check() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const emails = ['xbluewhalebd@gmail.com', 'azaharalifrimick714420@gmail.com'];
        
        for (const email of emails) {
            console.log(`\n=== Checking: ${email} ===`);
            
            // 1. Check users table
            const userRes = await client.query("SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)", [email]);
            console.log('Users table:', userRes.rows);
            
            if (userRes.rows.length > 0) {
                const userId = userRes.rows[0].id;
                // 2. Check pages by email AND user_id
                const pageRes = await client.query(
                    "SELECT page_id, name, email, user_id FROM page_access_token_message WHERE LOWER(email) = LOWER($1) OR user_id::text = $2",
                    [email, userId]
                );
                console.log(`Pages found: ${pageRes.rows.length}`);
                pageRes.rows.forEach(p => console.log(` - ${p.name} (ID: ${p.page_id}, Email: ${p.email}, UserID: ${p.user_id})`));
            } else {
                // If user not in users table, check pages by email only
                const pageRes = await client.query(
                    "SELECT page_id, name, email, user_id FROM page_access_token_message WHERE LOWER(email) = LOWER($1)",
                    [email]
                );
                console.log(`Pages found (by email only): ${pageRes.rows.length}`);
                pageRes.rows.forEach(p => console.log(` - ${p.name} (ID: ${p.page_id}, Email: ${p.email}, UserID: ${p.user_id})`));
            }
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

check();
