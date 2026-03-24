
const { Client } = require('pg');

async function checkApiList() {
    const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
    const client = new Client({ connectionString });

    try {
        console.log('--- Connecting to Database ---');
        await client.connect();
        console.log('✅ Connected successfully.');

        console.log('\n--- Checking API Key Status Summary ---');
        const statusRes = await client.query('SELECT status, COUNT(*) as count FROM api_list GROUP BY status');
        console.table(statusRes.rows);

        console.log('\n--- Checking Locked Keys Details ---');
        const lockedRes = await client.query("SELECT id, provider, api, status, usage_today, cooldown_until, last_date_checked FROM api_list WHERE status = 'locked' LIMIT 10");
        if (lockedRes.rows.length > 0) {
            console.table(lockedRes.rows.map(r => ({
                ...r,
                api: r.api.substring(0, 10) + '***'
            })));
        } else {
            console.log('No keys currently have "locked" status.');
        }

        console.log('\n--- Checking Top Usage Keys Today ---');
        const usageRes = await client.query("SELECT id, provider, usage_today, last_date_checked FROM api_list ORDER BY usage_today DESC LIMIT 5");
        console.table(usageRes.rows);

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
        console.log('\n--- Connection Closed ---');
    }
}

checkApiList();
