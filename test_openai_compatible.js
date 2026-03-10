const axios = require('axios');

const API_KEY = 'salesmanchatbot-2eacc0b72391c9436e02fc45245262229953778b314b0acf';
const BASE_URL = 'https://api.salesmanchatbot.online/api/external/v1';

async function testChat() {
    try {
        console.log("Testing SalesmanChatbot Pro Engine...");
        const response = await axios.post(`${BASE_URL}/chat/completions`, {
            model: "salesmanchatbot-pro",
            messages: [
                { role: "user", content: "hi" }
            ],
            stream: false
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log("\n--- Response ---");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("\n--- Error ---");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

testChat();
