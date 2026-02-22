const { Client } = require('pg');
require('dotenv').config({ path: 'backend/.env' });
const axios = require('axios');

// Using Google Gemini Flash for description generation (Free/Cheap)
// Need to find an API key. 
// For this script, I'll try to use the one from environment or a hardcoded one if needed (for testing).
// Ideally, I should reuse the aiService logic, but I cannot easily import it if it has complex dependencies.
// So I will implement a minimal "Vision" call here.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Ensure this is in .env

async function generateVisualTags() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        // 1. Fetch products without visual_tags (limit to 10 for test, or loop all)
        // Adjust query to process all products that have image_url but no visual_tags
        const res = await client.query("SELECT id, name, image_url FROM products WHERE image_url IS NOT NULL AND (visual_tags IS NULL OR visual_tags = '') LIMIT 50");
        
        console.log(`Found ${res.rows.length} products to index.`);

        for (const product of res.rows) {
            console.log(`Processing: ${product.name} (${product.id})`);
            
            try {
                const description = await analyzeImage(product.image_url);
                if (description) {
                    await client.query("UPDATE products SET visual_tags = $1 WHERE id = $2", [description, product.id]);
                    console.log(`> Updated visual_tags for ${product.name}`);
                }
            } catch (err) {
                console.error(`> Failed to analyze ${product.name}: ${err.message}`);
            }
            
            // Add small delay to avoid rate limits
            await new Promise(r => setTimeout(r, 2000));
        }

    } catch (err) {
        console.error("Main Error:", err);
    } finally {
        await client.end();
    }
}

async function analyzeImage(imageUrl) {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not found in env");
    
    // Fix relative URLs
    if (!imageUrl.startsWith('http')) {
        // Assuming localhost for relative paths if needed, but usually these are not accessible by external AI
        // If it's a local file path, we can't send it to Gemini API easily unless we upload base64.
        // Let's assume we skip relative paths for now or handle them if they are local files.
        console.log(`Skipping relative URL: ${imageUrl}`);
        return null;
    }

    try {
        // 1. Download Image to Base64
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(response.data).toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';

        // 2. Call Gemini
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const payload = {
            contents: [{
                parts: [
                    { text: "Describe this product image in detail for visual search. Mention color, shape, packaging type, text on label, and key visual features. Output 2-3 sentences." },
                    { inline_data: { mime_type: mimeType, data: base64Image } }
                ]
            }]
        };

        const apiRes = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
        const text = apiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return text;

    } catch (err) {
        throw new Error(`Vision API Error: ${err.message}`);
    }
}

generateVisualTags();