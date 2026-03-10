const axios = require('axios');

async function testSalesmanPro() {
    console.log("--- SalesmanChatbot-Pro (Gemini 2.5) Integration Test ---");
    
    // আপনার লোকাল বা প্রোডাকশন ইউআরএল (আমরা লোকাল টেস্ট করছি)
    const BASE_URL = 'http://localhost:3001/api/external/v1/chat/completions';
    
    // টেস্ট করার জন্য একটি ডামি এপিআই কী (আপনার ডাটাবেস অনুযায়ী)
    // দ্রষ্টব্য: এটি টেস্ট করার জন্য আপনার সার্ভার রানিং থাকতে হবে।
    const API_KEY = 'MANAGED_SECRET_KEY'; 

    const payload = {
        model: 'salesmanchatbot-pro',
        messages: [
            { role: 'system', content: 'You are a helpful AI assistant.' },
            { role: 'user', content: 'Hello, what is your name?' }
        ]
    };

    try {
        console.log("\nCalling salesmanchatbot-pro engine...");
        const response = await axios.post(BASE_URL, payload, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        console.log("Success! AI Response:");
        console.log(JSON.stringify(response.data.choices[0].message, null, 2));
        console.log("\nUsage Stats:", response.data.usage);
    } catch (error) {
        console.error("\nTest Failed!");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error("Error Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(`Message: ${error.message}`);
            console.log("\n[Note] Make sure your backend server is running on port 3001.");
        }
    }
}

testSalesmanPro();
