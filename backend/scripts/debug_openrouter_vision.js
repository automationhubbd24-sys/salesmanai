
const axios = require('axios');

async function debugOpenRouterVision() {
    const apiKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    // Test multiple OpenRouter Vision models
    const models = [
        'arcee-ai/trinity-large-preview',
        'qwen/qwen-2.5-vl-7b-instruct:free',
        'google/gemini-2.0-flash-001'
    ];
    
    const imageUrl = 'https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/657a89a4-f712-44ba-a3b7-b150b966a65c/1771914711503.jpg';

    for (const model of models) {
        console.log(`\n[Debug] Testing OpenRouter Model: ${model}`);
        try {
            const payload = {
                model: model,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "What is written in this image? Focus on the product code." },
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
                    'X-Title': 'Vision Debug'
                },
                timeout: 30000
            });

            console.log(`[Debug] ${model} Response:`, response.data?.choices?.[0]?.message?.content || "EMPTY CONTENT");
            if (response.data?.usage) {
                console.log(`[Debug] Usage:`, JSON.stringify(response.data.usage));
            }

        } catch (err) {
            console.error(`[Debug] ${model} Failed:`, err.response?.data?.error?.message || err.message);
            if (err.response?.data?.error) {
                console.error(`[Debug] Error Code:`, err.response.data.error.code);
            }
        }
    }
}

debugOpenRouterVision();
