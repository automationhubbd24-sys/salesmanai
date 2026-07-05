const { Pool } = require('pg');

async function checkUser() {
    const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
    const pool = new Pool({ connectionString });

    try {
        const email = 'gamersahariar@gmail.com';
        console.log(`\n--- Checking Account for: ${email} ---\n`);

        // 1. User Info from Auth Table
        const userAuthRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userAuthRes.rows.length === 0) {
            console.log('User not found in users table');
            process.exit(0);
        }
        console.log('--- Users Table Columns ---');
        console.log(Object.keys(userAuthRes.rows[0]).join(', '));
        
        const authUser = userAuthRes.rows[0];
        console.log('\n--- User Auth Info ---');
        console.log('ID:', authUser.id);
        console.log('Full Name:', authUser.full_name);
        
        // Look for password related fields in users table
        const pwFieldAuth = Object.keys(authUser).find(k => k.toLowerCase().includes('pass') || k.toLowerCase().includes('auth'));
        if (pwFieldAuth) {
            console.log(`${pwFieldAuth}:`, authUser[pwFieldAuth]);
        } else {
            console.log('No password-like column found in users table.');
        }

        // 1.1 User Config
        const userRes = await pool.query('SELECT * FROM user_configs WHERE user_id::text = $1::text OR email = $2', [authUser.id, email]);
        if (userRes.rows.length > 0) {
            const config = userRes.rows[0];
            console.log('\n--- User Config (Credits) ---');
            console.log('Subscription Plan:', config.subscription_plan);
            console.log('Monthly Limit:', config.monthly_limit);
            console.log('Monthly Used:', config.monthly_used);
            console.log('Monthly Expires At:', config.monthly_expires_at);
            console.log('Message Credit (Legacy):', config.message_credit);
            console.log('Bonus Credit:', config.bonus_credit);
            console.log('Permanent Credit:', config.permanent_credit);
            console.log('Daily Limit:', config.daily_limit);
            console.log('Daily Used:', config.daily_used);
            
            const availableMonthly = Math.max(0, Number(config.monthly_limit || 0) - Number(config.monthly_used || 0));
            const totalEffective = availableMonthly + Number(config.bonus_credit || 0) + Number(config.message_credit || 0) + Number(config.permanent_credit || 0);
            console.log('Total Effective Credit:', totalEffective);
        } else {
            console.log('No user_configs entry found.');
        }

        // 2. Connected Pages
         const pagesRes = await pool.query('SELECT * FROM page_access_token_message WHERE user_id = $1 OR email = $2', [authUser.id, email]);
        console.log(`\n--- Connected Pages (${pagesRes.rows.length}) ---`);
        pagesRes.rows.forEach(p => {
            console.log(`ID: ${p.page_id} | Name: ${p.page_access_token ? 'Has Token' : 'No Token'} | Status: ${p.subscription_status} | Engine: ${p.cheap_engine ? 'Cheap' : 'Pro'}`);
        });

        // 3. Page Specific DB Settings
        if (pagesRes.rows.length > 0) {
            const pageIds = pagesRes.rows.map(p => p.page_id);
            const dbRes = await pool.query('SELECT page_id, semantic_cache_enabled, engine_override FROM fb_message_database WHERE page_id = ANY($1)', [pageIds]);
            console.log(`\n--- FB DB Settings ---`);
            dbRes.rows.forEach(d => {
                console.log(`Page: ${d.page_id} | Cache: ${d.semantic_cache_enabled} | Override: ${d.engine_override}`);
            });
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

checkUser();
