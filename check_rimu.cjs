const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres',
    ssl: false 
});

async function checkRimu() {
    try {
        await client.connect();
        
        // 1. Inspect table schema first
    try {
        const schemaRes = await client.query("SELECT * FROM page_access_token_message LIMIT 1");
        if (schemaRes.rows.length > 0) {
            console.log("page_access_token_message Schema:", Object.keys(schemaRes.rows[0]));
        }
    } catch (e) { console.log("Error checking page_access_token_message schema:", e.message); }

    // 1. List all pages to find the correct name/ID
    console.log("\n--- Listing all pages ---");
    const pagesRes = await client.query("SELECT page_id, name FROM page_access_token_message");
    pagesRes.rows.forEach(p => console.log(`Page: ${p.name} (ID: ${p.page_id})`));

    // 2. Inspect fb_message_database for Rimu's Shop
    console.log("\n--- Inspecting fb_message_database for Rimu's Shop (ID: 106524637410742) ---");
    try {
        const promptRes = await client.query("SELECT * FROM fb_message_database WHERE page_id = '106524637410742'");
        if (promptRes.rows.length > 0) {
            const row = promptRes.rows[0];
            console.log("Found Prompt Config!");
            console.log("Columns:", Object.keys(row));
            // Print the prompt text if available
            if (row.text_prompt) {
                console.log("\nSystem Prompt (First 500 chars):\n", row.text_prompt.substring(0, 500));
                console.log("...\n");
            } else if (row.prompt) {
                 console.log("\nSystem Prompt (First 500 chars):\n", row.prompt.substring(0, 500));
            } else {
                console.log("No 'text_prompt' or 'prompt' column found. Dumping row keys:", Object.keys(row));
            }
        } else {
            console.log("No entry found in fb_message_database for this Page ID.");
        }
    } catch (err) {
        console.error("Error inspecting fb_message_database:", err.message);
    }

    // 3. Inspect products for Rimu's Shop
    console.log("\n--- Inspecting products for Rimu's Shop ---");
    try {
        // Products are linked via allowed_page_ids (array) or user_id?
        // Let's check allowed_page_ids first as it's common in this codebase
        // Note: allowed_page_ids might be a JSONB or Text array. 
        // Based on schema from previous run: 'allowed_page_ids' exists.
        
        // Simple query first
        const productsRes = await client.query(`
            SELECT id, name, price, stock, variants 
            FROM products 
            WHERE allowed_page_ids @> '["106524637410742"]' OR user_id = (SELECT user_id FROM page_access_token_message WHERE page_id = '106524637410742')
        `);
        
        if (productsRes.rows.length > 0) {
            console.log(`Found ${productsRes.rows.length} products:`);
            productsRes.rows.forEach(p => {
                console.log(`- ${p.name}: Price=${p.price}, Stock=${p.stock}, Variants=${JSON.stringify(p.variants)}`);
            });
        } else {
             console.log("No products found for this page (checked allowed_page_ids and user_id).");
        }
    } catch (err) {
        console.error("Error inspecting products:", err.message);
    }

    return;
        
        // 2. Get the system prompt
        const promptRes = await client.query("SELECT * FROM page_prompts WHERE page_id = $1", [page.page_id]);
        if (promptRes.rows.length > 0) {
            console.log("System Prompt Found. Length:", promptRes.rows[0].text_prompt.length);
            console.log("First 500 chars:", promptRes.rows[0].text_prompt.substring(0, 500));
        } else {
            console.log("No system prompt found for this page.");
        }

        // 3. Check products for this user
        const productRes = await client.query("SELECT count(*) as count FROM products WHERE user_id = $1", [page.user_id]);
        console.log("Product Count for User:", productRes.rows[0].count);
        
        // 4. List a few products to see if they match the text file
        const sampleProducts = await client.query("SELECT name, price, image_url FROM products WHERE user_id = $1 LIMIT 5", [page.user_id]);
        console.log("Sample Products:", sampleProducts.rows);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await client.end();
    }
}

checkRimu();
