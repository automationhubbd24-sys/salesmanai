
require('dotenv').config({ path: './backend/.env' });
const { query } = require('./backend/src/services/pgClient');
const aiService = require('./backend/src/services/aiService');

// Mock Dependencies
const mockPageConfig = {
    user_id: '657a89a4-f712-44ba-a3b7-b150b966a65c', // Rimu's User ID
    page_id: '473665619156212',
    ai: 'gemini',
    chat_model: 'gemini-2.5-flash',
    api_key: 'AIzaSyAYxkloC5mykrgj5JwBImu67pH0TiOJ2OU', // Real Key from DB (Will fail if invalid/quota)
    cheap_engine: false,
    is_external_api: false,
    billing_mode: 'subscription'
};

async function testRimuMessage() {
    console.log("Testing Rimu's Page Logic with Custom Key...");
    
    const userMessage = "Test message to check custom key fallback logic.";
    
    try {
        // Mock DB calls inside aiService if needed, but we are running integration test
        // We will call generateReply directly if possible, but it's not exported.
        // So we use a temporary route or mock. 
        // Actually, let's just try to replicate the logic in script or import the service.
        // aiService IS imported.
        
        // Mock dbService functions used by aiService
        const dbService = require('./backend/src/services/dbService');
        dbService.searchProducts = async () => [];
        dbService.getProductsByNames = async () => [];
        dbService.logAiUsage = async (data) => console.log("[LogAiUsage]", data.status, data.error_message);
        dbService.logApiUsage = async () => {};
        dbService.calculateCost = () => 0;
        
        // We need to access generateReply. It is not exported directly but 'generateResponse' is.
        // generateResponse calls generateReply.
        
        const response = await aiService.generateResponse({
            pageId: mockPageConfig.page_id,
            userId: 'test_user_123',
            userMessage: userMessage,
            history: [],
            imageUrls: [],
            audioUrls: [],
            config: mockPageConfig,
            platform: 'messenger'
        });
        
        console.log("\n--- Final Response ---");
        console.log(JSON.stringify(response, null, 2));
        
    } catch (err) {
        console.error("\n--- Test Failed ---");
        console.error(err);
    }
}

testRimuMessage();
