
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { query, getPool } = require('../src/services/pgClient');

async function debugBalance(email) {
    try {
        console.log(`--- Debugging Balance for: ${email} ---`);

        // 1. Check public.users
        console.log(`\n1. Checking public.users...`);
        const usersRes = await query(`SELECT * FROM public.users WHERE LOWER(email) = LOWER($1)`, [email]);
        if (usersRes.rows.length === 0) {
            console.log("No user found in public.users");
        } else {
            usersRes.rows.forEach(u => {
                console.log(`User ID: ${u.id}, Email: ${u.email}`);
            });
        }

        // 2. Check user_configs
        console.log(`\n2. Checking user_configs...`);
        const configRes = await query(`SELECT * FROM user_configs WHERE LOWER(email) = LOWER($1)`, [email]);
        if (configRes.rows.length === 0) {
            console.log("No config found in user_configs by email");
        } else {
            configRes.rows.forEach(c => {
                console.log(`Config ID: ${c.id}, UserID: ${c.user_id}, Balance: ${c.balance}, Email: ${c.email}`);
            });
        }
        
        // Also check by user_id if we found users
        if (usersRes.rows.length > 0) {
            const userId = usersRes.rows[0].id;
            console.log(`\n2b. Checking user_configs by user_id (${userId})...`);
            const configByIdRes = await query(`SELECT * FROM user_configs WHERE user_id = $1`, [userId]);
             if (configByIdRes.rows.length === 0) {
                console.log("No config found in user_configs by user_id");
            } else {
                configByIdRes.rows.forEach(c => {
                    console.log(`Config ID: ${c.id}, UserID: ${c.user_id}, Balance: ${c.balance}, Email: ${c.email}`);
                });
            }
        }


        // 3. Check payment_transactions
        console.log(`\n3. Checking payment_transactions...`);
        const txnRes = await query(`SELECT * FROM payment_transactions WHERE LOWER(user_email) = LOWER($1) ORDER BY created_at DESC`, [email]);
        if (txnRes.rows.length === 0) {
            console.log("No transactions found");
        } else {
            txnRes.rows.forEach(t => {
                console.log(`TxnID: ${t.id}, TrxID: ${t.trx_id}, Amount: ${t.amount}, Status: ${t.status}, Created: ${t.created_at}`);
            });
        }

    } catch (e) {
        console.error("Debug Error:", e);
    } finally {
        await getPool().end();
    }
}

// Get email from command line arg
const email = process.argv[2];
if (!email) {
    console.log("Please provide an email address as an argument.");
    process.exit(1);
}

debugBalance(email);
