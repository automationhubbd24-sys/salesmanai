const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres'
});

async function findBismillah() {
    try {
        await client.connect();
        
        console.log("Searching for 'Bismillah' or 'Homeo' or 'Cosmetic' in user_configs...");
        const res = await client.query(`
            SELECT id, user_id, email, model_name 
            FROM user_configs 
            WHERE email ILIKE '%bismillah%' 
               OR email ILIKE '%homeo%' 
               OR email ILIKE '%cosmetic%'
        `);
        console.log("Found Configs:", res.rows);

        console.log("\nSearching in fb_message_database for prompts containing 'Bismillah'...");
        const promptRes = await client.query(`
            SELECT page_id, text_prompt 
            FROM fb_message_database 
            WHERE text_prompt ILIKE '%Bismillah%' 
               OR text_prompt ILIKE '%বিসমিল্লাহ%'
            LIMIT 5
        `);
        
        promptRes.rows.forEach(r => {
            console.log(`Page ID: ${r.page_id}`);
            console.log(`Prompt Preview: ${r.text_prompt.substring(0, 100)}...`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

findBismillah();