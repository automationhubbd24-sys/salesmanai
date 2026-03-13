import pkg from 'pg';
const { Pool } = pkg;

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

const pool = new Pool({
    connectionString,
    ssl: false 
});

async function practicalTest() {
    console.log('--- PRACTICAL ORDER FLOW TEST ---');
    const pageId = 'practical_test_page';
    const senderId = 'practical_user_123';

    try {
        const client = await pool.connect();
        try {
            // 1. Initial Message with Name and Phone
            console.log('\nStep 1: User provides Name and Phone ("Md 01956871403 Dhaka")');
            const step1 = await client.query(
                `INSERT INTO fb_order_tracking
                    (page_id, sender_id, product_name, number, location, product_quantity, price, sender_number, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 RETURNING *`,
                [pageId, senderId, 'Recovered Lead', '01956871403', 'Dhaka', '1', '0', '01956871403']
            );
            console.log('Result:', JSON.stringify(step1.rows[0]));

            // 2. User provides more address details ("Cokbazar e recive korbo")
            console.log('\nStep 2: User adds specific location ("Cokbazar e recive korbo")');
            // Simulate the smart merge logic
            const step2 = await client.query(
                `UPDATE fb_order_tracking SET
                    location = COALESCE($1, location),
                    created_at = NOW()
                 WHERE id = $2
                 RETURNING *`,
                ['Dhaka | Cokbazar e recive korbo', step1.rows[0].id]
            );
            console.log('Result:', JSON.stringify(step2.rows[0]));

            // 3. Final verification of the order record
            console.log('\nFinal Order Record in DB:');
            const final = await client.query('SELECT * FROM fb_order_tracking WHERE id = $1', [step1.rows[0].id]);
            console.table(final.rows);

            // Cleanup
            await client.query('DELETE FROM fb_order_tracking WHERE page_id = $1', [pageId]);
            console.log('\nPractical test data cleaned up.');

        } catch (err) {
            console.error('Test Error:', err.message);
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Connection error:', err.message);
    } finally {
        await pool.end();
    }
}

practicalTest();
