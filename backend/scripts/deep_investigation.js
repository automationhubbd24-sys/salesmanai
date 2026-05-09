const { Client } = require('pg');
const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function investigate() {
    const client = new Client({ connectionString, ssl: false });
    try {
        await client.connect();
        const pages = ['106524637410742', '102360321669770'];
        
        console.log('\n--- 1. Products Check (allowed_page_ids OR allowed_messenger_ids) ---');
        const res = await client.query(`
            SELECT id, name, image_url, allowed_page_ids, allowed_messenger_ids, platform 
            FROM products 
            WHERE allowed_page_ids::text LIKE '%102360321669770%' 
               OR allowed_messenger_ids::text LIKE '%102360321669770%'
               OR allowed_page_ids::text LIKE '%106524637410742%'
               OR allowed_messenger_ids::text LIKE '%106524637410742%'
               OR platform = 'global'
            LIMIT 20
        `);
        console.table(res.rows);

        console.log('\n--- 2. Page Config Check (fb_message_database) ---');
        const configRes = await client.query(`
            SELECT page_id, image_send, image_detection, verified 
            FROM fb_message_database 
            WHERE page_id = ANY($1)
        `, [pages]);
        console.table(configRes.rows);

        console.log('\n--- 3. Page Prompts Check (page_prompts) ---');
        const promptRes = await client.query(`
            SELECT page_id, template_reply, image_send 
            FROM page_prompts 
            WHERE page_id = ANY($1)
        `, [pages]);
        console.table(promptRes.rows);

    } catch (err) {
        console.error('Error during investigation:', err.message);
    } finally {
        await client.end();
    }
}
investigate();
