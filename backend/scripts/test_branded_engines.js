
const axios = require('axios');

async function testUnifiedBrandedEngines() {
    const apiKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    const models = ['salesmanchatbot-pro', 'salesmanchatbot-flash', 'salesmanchatbot-lite'];
    const imageUrl = 'https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/657a89a4-f712-44ba-a3b7-b150b966a65c/1771914711503.jpg';

    for (const model of models) {
        console.log(`\n--- Testing Model: ${model} ---`);
        
        // 1. Text Test
        console.log(`[Text Test] Sending 'Hello'...`);
        try {
            const textPayload = {
                model: model,
                messages: [{ role: "user", content: "Hello" }]
            };
            const textResp = await axios.post('https://api.salesmanchatbot.online/api/external/v1/chat/completions', textPayload, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 30000
            });
            console.log(`[Text Test] Success! Response: ${textResp.data?.choices?.[0]?.message?.content}`);
        } catch (err) {
            console.error(`[Text Test] Failed:`, err.response?.data?.error?.message || err.message);
        }

        // 2. Image Test
        console.log(`[Image Test] Sending image...`);
        try {
            const imagePayload = {
                model: model,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "এই ছবিতে কী আছে?" },
                            { type: "image_url", image_url: { url: imageUrl } }
                        ]
                    }
                ]
            };
            const imgResp = await axios.post('https://api.salesmanchatbot.online/api/external/v1/chat/completions', imagePayload, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 60000
            });
            console.log(`[Image Test] Success! Response: ${imgResp.data?.choices?.[0]?.message?.content?.substring(0, 150)}...`);
        } catch (err) {
            console.error(`[Image Test] Failed:`, err.response?.data?.error?.message || err.message);
        }
    }
}

testUnifiedBrandedEngines();
