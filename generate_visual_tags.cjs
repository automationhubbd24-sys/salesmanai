const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend/.env') });

// Helper to mock dbService for aiService if needed, or just let it load
// aiService requires dbService which requires pgClient which requires DATABASE_URL
// We have DATABASE_URL in env.

// We need to make sure we can require the backend modules
const backendPath = path.join(__dirname, 'backend/src');
const aiService = require(path.join(backendPath, 'services/aiService'));

async function generateVisualTags() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        console.log("Connected to DB. Fetching products...");
        
        // 1. Fetch products without visual_tags
        const res = await client.query("SELECT id, name, image_url FROM products WHERE image_url IS NOT NULL AND (visual_tags IS NULL OR visual_tags = '') LIMIT 50");
        
        console.log(`Found ${res.rows.length} products to index.`);

        for (const product of res.rows) {
            console.log(`Processing: ${product.name} (${product.id})`);
            
            try {
                // Use aiService to analyze image
                // processImageWithVision(imageUrl, pageConfig, customOptions)
                // We pass empty pageConfig, and custom prompt (User's Verified Prompt)
                const prompt = `Extract the exact product name from this image.
Rules:
- Output must start with: Product:
- Include brand + full product name.
- Include size if visible.
- Ignore price, offer, discount text.
- Do not explain anything.
- Do not add extra words.
- Single line output only.`;
                
                // Use Gemini 2.0 Flash (or 2.5 if available) for best results
                const description = await aiService.processImageWithVision(
                    product.image_url, 
                    { chatmodel: 'gemini-2.0-flash' }, // Explicitly request Flash 2.0
                    { prompt: prompt }
                );

                if (description && typeof description === 'string' && description.length > 5 && !description.includes("Error")) {
                    // Clean up "Product: " prefix if present
                    const cleanTag = description.replace(/^Product:\s*/i, '').trim();
                    
                    await client.query("UPDATE products SET visual_tags = $1 WHERE id = $2", [cleanTag, product.id]);
                    console.log(`> Updated visual_tags for ${product.name}`);
                    console.log(`  Tags: ${cleanTag}`);
                } else {
                    console.log(`> Skipped (No valid description): ${description}`);
                }
            } catch (err) {
                console.error(`> Failed to analyze ${product.name}: ${err.message}`);
            }
            
            // Add delay to avoid rate limits
            await new Promise(r => setTimeout(r, 2000));
        }

    } catch (err) {
        console.error("Main Error:", err);
    } finally {
        await client.end();
        console.log("Done.");
        process.exit(0); // Force exit as aiService has intervals
    }
}

generateVisualTags();
