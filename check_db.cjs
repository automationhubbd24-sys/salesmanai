const { Client } = require('pg');

const client = new Client('postgres://postgres:KNCyFJA3h3NJdf (1)qApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres');

async function checkDb() {
    try {
        await client.connect();
        console.log('--- DB Connection: SUCCESS ---');

        // Check api_list table
        const apiListCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'api_list'");
        const apiCols = apiListCols.rows.map(r => r.column_name);
        console.log('api_list Columns:', apiCols.join(', '));

        // Check if cooldown_until exists in api_list, if not add it
        if (!apiCols.includes('cooldown_until')) {
            console.log('Adding cooldown_until to api_list...');
            await client.query("ALTER TABLE api_list ADD COLUMN cooldown_until TIMESTAMP WITH TIME ZONE");
            console.log('Column added successfully.');
        } else {
            console.log('cooldown_until already exists in api_list.');
        }

        // Check fb_order_tracking table
        const orderColsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'fb_order_tracking'");
        const orderCols = orderColsRes.rows.map(r => r.column_name);
        console.log('fb_order_tracking Columns:', orderCols.join(', '));
        
        // Final verification for required columns
        const requiredOrderCols = ['customer_name', 'status'];
        for (const col of requiredOrderCols) {
            if (!orderCols.includes(col)) {
                console.log(`Adding ${col} to fb_order_tracking...`);
                await client.query(`ALTER TABLE fb_order_tracking ADD COLUMN IF NOT EXISTS ${col} TEXT`);
            }
        }

        await client.end();
        console.log('--- DB Check: COMPLETED ---');
    } catch (err) {
        console.error('DB Error:', err.message);
        process.exit(1);
    }
}

checkDb();
