const axios = require('axios');

async function testOwnAPI() {
    console.log("--- 🧪 Testing Own SalesmanChatbot API Integration ---");
    
    // User's provided API Key from input
    const apiKey = "sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d";
    // Using the public base URL or local fallback
    const baseUrl = "https://salesmanchatbot.online/api/external/v1/chat/completions"; 
    const model = "salesmanchatbot-flash"; // The model user was testing

    const payload = {
        model: model,
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello, can you hear me?" }
        ]
    };

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };

    console.log(`URL: ${baseUrl}`);
    console.log(`Model: ${model}`);
    console.log(`API Key (First 10 chars): ${apiKey.substring(0, 10)}...`);

    try {
        const response = await axios.post(`${baseUrl}`, payload, { headers, timeout: 15000 });
        console.log("\n✅ SUCCESS! API Responded:");
        console.log("Response Text:", response.data.choices[0].message.content);
        console.log("Tokens Used:", response.data.usage.total_tokens);
    } catch (error) {
        console.error("\n❌ API TEST FAILED!");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Error Data:`, JSON.stringify(error.response.data));
        } else {
            console.error(`Message: ${error.message}`);
        }
    }
}

testOwnAPI();
