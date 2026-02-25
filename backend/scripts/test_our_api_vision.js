
const axios = require('axios');

async function testOurApiVision() {
    const apiKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    const model = 'salesmanchatbot-flash';
    const imageUrl = 'https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/657a89a4-f712-44ba-a3b7-b150b966a65c/1771914711503.jpg';

    console.log(`[Test] Calling OUR Backend API...`);
    console.log(`[Test] Model: ${model}`);

    try {
        const payload = {
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

        const response = await axios.post('https://api.salesmanchatbot.online/api/external/v1/chat/completions', payload, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        console.log(`[Test] Success! Response:`, response.data?.choices?.[0]?.message?.content);
    } catch (err) {
        console.error(`[Test] Failed:`, err.response?.data?.error?.message || err.message);
    }
}

testOurApiVision();
