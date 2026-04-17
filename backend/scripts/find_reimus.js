const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres'
});

const PAGE_ID = '106524637410742'; // Rimu's shop

async function checkPrompts() {
    try {
        await client.connect();
        console.log("Checking fb_message_database schema...");
        const schemaRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'fb_message_database'
        `);
        console.log(schemaRes.rows.map(r => r.column_name));

        console.log("\nSearching for 'reimus' or 'Rimu' pages...");
        const pageRes = await client.query(`
            SELECT id, user_id, email, model_name, system_prompt
            FROM user_configs 
            WHERE email ILIKE '%rimu%' OR user_id ILIKE '%rimu%'
        `);
        console.log("Potential Page Configs:", pageRes.rows);

        // Try to find the page via fb_chats (if it has page_name)
        console.log("\nSearching in fb_chats...");
        const fbChatRes = await client.query(`
            SELECT * FROM fb_chats LIMIT 1
        `);
        if (fbChatRes.rows.length > 0) {
             console.log("fb_chats schema sample:", Object.keys(fbChatRes.rows[0]));
        }

        const RIMU_PAGE_ID = '106524637410742';
        console.log(`\nChecking config for Page ID: ${RIMU_PAGE_ID} in fb_message_database...`);
        
        const configRes = await client.query(`
            SELECT text_prompt, image_prompt, vision_prompt, block_emoji, unblock_emoji 
            FROM fb_message_database 
            WHERE page_id = $1
        `, [RIMU_PAGE_ID]);
        
        if (configRes.rows.length > 0) {
            console.log("Prompts found:", JSON.stringify(configRes.rows[0], null, 2));
        } else {
            console.log("No config found in fb_message_database for this page.");
        }

        console.log("\nFetching recent chat history from fb_chats...");
        const chatRes = await client.query(`
            SELECT sender_id, text, reply_by, ai_model, created_at 
            FROM fb_chats 
            WHERE page_id = $1 
            ORDER BY created_at DESC 
            LIMIT 20
        `, [RIMU_PAGE_ID]);
        
        if (chatRes.rows.length > 0) {
             console.log(`Found ${chatRes.rows.length} messages.`);
             chatRes.rows.forEach(msg => {
                 const role = msg.reply_by === 'ai' ? 'AI' : (msg.sender_id === RIMU_PAGE_ID ? 'Page' : 'User');
                 console.log(`[${msg.created_at.toISOString()}] ${role} (${msg.sender_id}): ${msg.text}`);
             });
        } else {
            console.log("No chat history found in fb_chats.");
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkPrompts();
