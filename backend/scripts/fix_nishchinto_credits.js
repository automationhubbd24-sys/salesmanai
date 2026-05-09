const { Client } = require('pg');
const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function fixUserAccount() {
    const client = new Client({ connectionString, ssl: false });
    try {
        await client.connect();
        const userId = 'f1dfcd9c-182d-402f-b137-b009f1e95ce0';
        const userEmail = 'nishchintoshop@gmail.com';
        
        console.log(`--- Fixing Account for Nishchinto Owner (${userEmail}) ---`);
        
        // 1. Current State Check
        const before = await client.query('SELECT balance, message_credit, permanent_credit FROM user_configs WHERE user_id::text = $1', [userId]);
        console.log('Before Fix:', before.rows[0]);

        // 2. The Fix:
        // - Deduct 300 TK from balance
        // - Remove 1000 from message_credit (the "fake" bonus)
        // - Add 1000 to permanent_credit (the actual purchase)
        await client.query(`
            UPDATE user_configs 
            SET balance = balance - 300,
                message_credit = message_credit - 1000,
                permanent_credit = 1000
            WHERE user_id::text = $1
        `, [userId]);

        // 3. Log the transaction as a purchase
        await client.query(`
            INSERT INTO payment_transactions (user_email, amount, method, trx_id, sender_number, status)
            VALUES ($1, 300, 'pack_Basic Pack', $2, 'SYSTEM_FIX', 'completed')
        `, [userEmail, `FIX-${Date.now()}`]);

        // 4. Final State Check
        const after = await client.query('SELECT balance, message_credit, permanent_credit FROM user_configs WHERE user_id::text = $1', [userId]);
        console.log('After Fix:', after.rows[0]);

        console.log('\nSuccess! Balance deducted and 1000 Permanent Credits assigned.');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
fixUserAccount();
