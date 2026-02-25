
const axios = require('axios');

async function testOpenRouterSimple() {
    const apiKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    const model = 'meta-llama/llama-3.1-8b-instruct:free';
    
    console.log(`[Test] Testing Simple Text Request to OpenRouter...`);
    try {
        const payload = {
            model: model,
            messages: [{ role: "user", content: "Hello, are you working?" }]
        };

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        console.log(`[Test] Response:`, response.data?.choices?.[0]?.message?.content || "EMPTY");
    } catch (err) {
        console.error(`[Test] Failed:`, err.response?.data?.error?.message || err.message);
        console.error(`[Test] Status Code:`, err.response?.status);
    }
}

testOpenRouterSimple();
