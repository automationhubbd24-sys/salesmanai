
const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres'
});

const PAGE_ID = '106524637410742';

async function fetchPrompts() {
    try {
        await client.connect();
        console.log(`Fetching current config for Page ID: ${PAGE_ID}...`);
        
        const res = await client.query(`
            SELECT text_prompt, image_prompt 
            FROM fb_message_database 
            WHERE page_id = $1
        `, [PAGE_ID]);
        
        if (res.rows.length === 0) {
            console.log("No config found!");
        } else {
            console.log("Current Text Prompt:", JSON.stringify(res.rows[0].text_prompt));
            console.log("Current Image Prompt:", JSON.stringify(res.rows[0].image_prompt));
        }

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await client.end();
    }
}

fetchPrompts();
