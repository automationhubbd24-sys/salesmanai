import pkg from 'pg';
const { Pool } = pkg;

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

const pool = new Pool({
    connectionString,
    ssl: false 
});

async function testConnection() {
    console.log('Testing database connection...');
    try {
        const client = await pool.connect();
        try {
            const res = await client.query('SELECT NOW() as current_time');
            console.log('Connection successful!');
            console.log('Database time:', res.rows[0].current_time);

            // Check if fb_order_tracking table exists
            const tableCheck = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'fb_order_tracking'
                );
            `);
            console.log('fb_order_tracking table exists:', tableCheck.rows[0].exists);

            // Check if whatsapp_order_tracking table exists
            const waTableCheck = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'whatsapp_order_tracking'
                );
            `);
            console.log('whatsapp_order_tracking table exists:', waTableCheck.rows[0].exists);

        } catch (err) {
            console.error('Query error:', err.message);
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Database connection error:', err.message);
    } finally {
        await pool.end();
    }
}

testConnection();
