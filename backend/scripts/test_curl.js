
const axios = require('axios');

const API_KEY = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
const URL = 'https://api.salesmanchatbot.online/api/external/v1/chat/completions';

async function testApi() {
    console.log("Testing SalesmanChatbot Pro API...");
    try {
        const res = await axios.post(URL, {
            model: "salesmanchatbot-pro",
            messages: [
                { role: "user", content: "Hello, how are you?" }
            ]
        }, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            }
        });

        console.log("\n✅ API Response:", JSON.stringify(res.data, null, 2));
    } catch (error) {
        console.error("\n❌ API Error:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

testApi();
