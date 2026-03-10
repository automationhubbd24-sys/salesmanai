const aiService = require('./src/services/aiService');
const dbService = require('./src/services/dbService');
const keyService = require('./src/services/keyService');

async function testProModel() {
    console.log("--- Deep Debug: SalesmanChatbot-Pro ---");
    
    const pageConfig = {
        user_id: '1', // Dummy
        page_id: 'TestPage',
        ai_provider: 'salesmanchatbot',
        chat_model: 'salesmanchatbot-pro',
        is_external_api: true,
        cheap_engine: false
    };

    const prompts = { text_prompt: "You are a helpful assistant." };
    const history = [];
    const userMessage = "Hello, what is your name?";

    try {
        console.log("Calling generateReply...");
        const result = await aiService.generateReply(
            userMessage,
            pageConfig,
            prompts,
            history,
            'TestUser',
            'TestOwner'
        );

        console.log("\nResult:");
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error("\nFatal Error in test script:", err);
    }
}

testProModel();
