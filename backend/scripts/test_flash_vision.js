
const axios = require('axios');

async function testFlashVision() {
    const apiKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    const model = 'qwen/qwen-2.5-vl-7b-instruct:free'; // Using a free vision model on OpenRouter as per flash config
    const imageUrl = 'https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/657a89a4-f712-44ba-a3b7-b150b966a65c/1771914711503.jpg';

    console.log(`[Test] Testing Vision for SalesmanChatbot-Flash...`);
    console.log(`[Test] Using API Key: ${apiKey.substring(0, 10)}...`);

    try {
        const payload = {
            model: model,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe this image. Focus on the product name and details like GED-90XA or similar codes if visible." },
                        { type: "image_url", image_url: { url: imageUrl } }
                    ]
                }
            ]
        };

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://salesmanchatbot.online', 
                'X-Title': 'SalesmanChatbot Test'
            },
            timeout: 30000
        });

        const result = response.data?.choices?.[0]?.message?.content;
        console.log("[Test] AI Response:", result);
        
        if (result) {
            console.log("[Test] SUCCESS: Vision is working with this key!");
        } else {
            console.error("[Test] FAILED: Empty response from AI.");
            console.log("[Test] Full Response:", JSON.stringify(response.data, null, 2));
        }

    } catch (err) {
        console.error("[Test] ERROR:", err.message);
        if (err.response) {
            console.error("[Test] API Error Details:", JSON.stringify(err.response.data, null, 2));
        }
    }
}

testFlashVision();
