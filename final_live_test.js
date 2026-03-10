const axios = require('axios');

const API_KEY = 'salesmanchatbot-2eacc0b72391c9436e02fc45245262229953778b314b0acf';
const BASE_URL = 'https://api.salesmanchatbot.online/api/external/v1/chat/completions';

async function finalTest() {
    console.log("--- FINAL VERIFICATION: Branded Pro Model ---");
    console.log(`Target: ${BASE_URL}`);
    
    try {
        const payload = {
            model: "salesmanchatbot-pro",
            messages: [
                { role: "user", content: "hi" }
            ],
            stream: false
        };

        const response = await axios.post(BASE_URL, payload, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        console.log("\n✅ SUCCESS!");
        console.log("AI Response:", response.data.choices[0].message.content);
        console.log("Usage:", JSON.stringify(response.data.usage, null, 2));

    } catch (error) {
        console.log("\n❌ TEST FAILED");
        if (error.response) {
            console.log(`Status: ${error.response.status}`);
            console.log("Error Detail:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.log("Message:", error.message);
        }
    }
}

finalTest();
