import pkg from 'pg';
const { Pool } = pkg;

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

const pool = new Pool({
    connectionString,
    ssl: false 
});

async function debugOrderSaving() {
    console.log('--- DEBUG ORDER SAVING ---');
    const pageId = 'debug_page_123';
    const senderId = 'debug_user_456';
    const phoneNumber = '01711223344';

    try {
        const client = await pool.connect();
        try {
            console.log('1. Checking for existing orders in last 24h...');
            const recentRes = await client.query(
                `SELECT id, number FROM fb_order_tracking 
                 WHERE page_id = $1 AND sender_id = $2 
                 AND created_at > NOW() - INTERVAL '24 hours'
                 ORDER BY created_at DESC LIMIT 1`,
                [pageId, senderId]
            );
            console.log('Recent orders found:', recentRes.rows.length);

            console.log('2. Attempting to INSERT a new order with ONLY a number...');
            const insertRes = await client.query(
                `INSERT INTO fb_order_tracking
                    (page_id, sender_id, product_name, number, location, product_quantity, price, sender_number, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6::text, $7::text, $8, NOW())
                 RETURNING *`,
                [pageId, senderId, 'Recovered Lead', phoneNumber, 'Pending', '1', '0', phoneNumber]
            );
            console.log('Insert successful! ID:', insertRes.rows[0].id);

            console.log('3. Attempting to UPDATE the order with a location...');
            const updateRes = await client.query(
                `UPDATE fb_order_tracking SET
                    location = $1,
                    created_at = NOW()
                 WHERE id = $2
                 RETURNING *`,
                ['Dhaka, Bangladesh', insertRes.rows[0].id]
            );
            console.log('Update successful! New location:', updateRes.rows[0].location);

            // Cleanup debug data
            await client.query('DELETE FROM fb_order_tracking WHERE page_id = $1', [pageId]);
            console.log('Debug data cleaned up.');

        } catch (err) {
            console.error('DATABASE ERROR DURING EXECUTION:', err.message);
            console.error('Error Code:', err.code);
            console.error('Error Detail:', err.detail);
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Connection error:', err.message);
    } finally {
        await pool.end();
    }
}

debugOrderSaving();
