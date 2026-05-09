const { Client } = require('pg');
const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function checkConfigs() {
    const client = new Client({ connectionString, ssl: false });
    try {
        await client.connect();
        const pages = ['106524637410742', '102360321669770'];
        
        console.log('--- page_access_token_message ---');
        const res1 = await client.query('SELECT page_id, name, subscription_status, cheap_engine FROM page_access_token_message WHERE page_id = ANY($1)', [pages]);
        console.table(res1.rows);

        console.log('--- fb_message_database ---');
        const res2 = await client.query('SELECT page_id, image_detection, image_send, verified FROM fb_message_database WHERE page_id = ANY($1)', [pages]);
        console.table(res2.rows);

        console.log('--- Products Count ---');
        const res3 = await client.query(`
            SELECT allowed_page_ids, COUNT(*) 
            FROM products 
            WHERE allowed_page_ids::jsonb ? '106524637410742' OR allowed_page_ids::jsonb ? '102360321669770'
            GROUP BY allowed_page_ids
        `);
        console.log(res3.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
checkConfigs();
