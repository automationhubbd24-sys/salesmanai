
const dbService = require('../src/services/dbService');
const aiService = require('../src/services/aiService');
const keyService = require('../src/services/keyService');

async function runTest() {
    const pageId = '115300131545728';
    const imageUrl = 'https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/657a89a4-f712-44ba-a3b7-b150b966a65c/1771914711503.jpg';

    try {
        console.log(`[Test] Fetching config for page: ${pageId}`);
        const pageConfig = await dbService.getPageConfig(pageId);
        
        if (!pageConfig) {
            console.error("[Test] Page config not found.");
            return;
        }

        console.log(`[Test] Config Found. Own API: ${pageConfig.cheap_engine === false}. Model: ${pageConfig.chat_model}`);

        // Mocking pagePrompts
        const pagePrompts = {
            image_prompt: "Extract the exact product name from this image. Output must start with: Product:"
        };

        console.log("[Test] Calling processImageWithVision...");
        const result = await aiService.processImageWithVision(imageUrl, pageConfig, { prompt: pagePrompts.image_prompt });
        
        console.log("[Test] Result:", JSON.stringify(result, null, 2));

    } catch (err) {
        console.error("[Test] Error:", err.message);
        if (err.response) {
            console.error("[Test] API Error:", JSON.stringify(err.response.data, null, 2));
        }
    }
}

runTest();
