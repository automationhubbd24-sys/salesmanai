const { Client } = require('pg');
const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function checkUserCredits() {
    const client = new Client({ connectionString, ssl: false });
    try {
        await client.connect();
        const nishchintoId = '102360321669770';
        
        console.log(`--- Investigating Owner of Page ${nishchintoId} ---`);
        
        // 1. Get Owner
        const ownerRes = await client.query(`
            SELECT user_id, email, name 
            FROM page_access_token_message 
            WHERE page_id = $1
        `, [nishchintoId]);
        
        if (ownerRes.rows.length === 0) {
            console.log('Page owner not found.');
            return;
        }
        
        const owner = ownerRes.rows[0];
        console.log('Owner Info:', owner);

        // 2. Get User Config
        const configRes = await client.query(`
            SELECT balance, message_credit, permanent_credit, daily_limit, daily_used, bonus_credit
            FROM user_configs 
            WHERE user_id::text = $1::text
        `, [owner.user_id]);
        
        console.log('User Config:', configRes.rows[0]);

        // 3. Get Recent Transactions
        const transRes = await client.query(`
            SELECT method, amount, trx_id, status, created_at 
            FROM payment_transactions 
            WHERE user_email = $1 
            ORDER BY created_at DESC 
            LIMIT 10
        `, [owner.email]);
        
        console.log('Recent Transactions:');
        console.table(transRes.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
checkUserCredits();
