const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres'
});

const PAGE_ID = '997118700148575';

async function analyzeBismillah() {
    try {
        await client.connect();
        
        console.log(`\nFetching Config for Page ID: ${PAGE_ID}...`);
        const configRes = await client.query(`
            SELECT text_prompt, image_prompt, vision_prompt 
            FROM fb_message_database 
            WHERE page_id = $1
        `, [PAGE_ID]);
        
        if (configRes.rows.length > 0) {
            console.log("--------------------------------------------------");
            console.log("FULL SYSTEM PROMPT:");
            console.log(configRes.rows[0].text_prompt);
            console.log("--------------------------------------------------");
        } else {
            console.log("No prompt found!");
        }

        console.log("\nFetching recent chat history...");
        const chatRes = await client.query(`
            SELECT sender_id, text, reply_by, created_at 
            FROM fb_chats 
            WHERE page_id = $1 
            ORDER BY created_at DESC 
            LIMIT 20
        `, [PAGE_ID]);
        
        if (chatRes.rows.length > 0) {
             chatRes.rows.forEach(msg => {
                 const role = msg.reply_by === 'ai' ? 'AI' : (msg.sender_id === PAGE_ID ? 'Page' : 'User');
                 console.log(`[${msg.created_at.toISOString()}] ${role}: ${msg.text}`);
             });
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

analyzeBismillah();