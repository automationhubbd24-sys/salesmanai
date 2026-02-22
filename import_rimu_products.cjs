const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: 'backend/.env' });

const PAGE_ID = '106524637410742';
const TEXT_FILE = 'C:/Users/mdedu/Downloads/New Text Document (4).txt';

async function importProducts() {
    console.log("--- Starting Product Import ---");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // 1. Get User ID
    const pageRes = await client.query("SELECT user_id, name FROM page_access_token_message WHERE page_id = $1", [PAGE_ID]);
    if (pageRes.rows.length === 0) {
        console.error("Page not found!");
        await client.end();
        return;
    }
    const userId = pageRes.rows[0].user_id;
    console.log(`Page: ${pageRes.rows[0].name} | User ID: ${userId}`);

    // 2. Read and Parse File
    const content = fs.readFileSync(TEXT_FILE, 'utf8');
    // Regex for: * Name: Price টাকা (Link: ...)
    // Captures: Name, Price, Image/Link (optional)
    const regex = /\*\s+([^*]+?):\s*([\d\.]+)\s*(?:৳|টাকা)(?:\s*\((?:Link|Image):\s*`?([^`\)]+)`?\))?/gi;
    
    let match;
    let products = [];
    while ((match = regex.exec(content)) !== null) {
        const name = match[1].trim();
        const price = parseFloat(match[2]);
        let imageUrl = match[3] ? match[3].trim() : null;
        
        // Clean up Image URL (remove backticks if any)
        if (imageUrl) imageUrl = imageUrl.replace(/`/g, '');

        products.push({ name, price, imageUrl });
    }

    console.log(`Parsed ${products.length} products from text file.`);

    // 3. Insert into Database
    let addedCount = 0;
    for (const p of products) {
        try {
            // Check if exists (simple name check)
            const check = await client.query(
                "SELECT id FROM products WHERE user_id = $1 AND name = $2", 
                [userId, p.name]
            );

            if (check.rows.length === 0) {
                // Insert
                await client.query(
                    `INSERT INTO products 
                    (user_id, name, description, price, stock, is_active, image_url, allowed_page_ids, currency)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'BDT')`,
                    [
                        userId, 
                        p.name, 
                        `Extracted from System Prompt. Price: ${p.price} BDT`, 
                        p.price, 
                        100, // Default stock
                        true, 
                        p.imageUrl,
                        JSON.stringify([PAGE_ID]) // Allow for this page
                    ]
                );
                addedCount++;
                process.stdout.write("."); // Progress dot
            }
        } catch (err) {
            console.error(`\nFailed to add ${p.name}: ${err.message}`);
        }
    }

    console.log(`\n\nSuccessfully imported ${addedCount} new products into Database.`);
    await client.end();
}

importProducts();
