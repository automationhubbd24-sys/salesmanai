
const axios = require('axios');

async function testSalesmanChatbotFlash() {
    const apiKey = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    const model = 'salesmanchatbot-flash';
    const imageUrl = 'https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/657a89a4-f712-44ba-a3b7-b150b966a65c/1771914711503.jpg';

    console.log(`[Test] Testing SalesmanChatbot API with model: ${model}`);
    console.log(`[Test] Endpoint: http://localhost:3001/api/external/v1/chat/completions`);

    try {
        const payload = {
            model: model,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "এই ছবিতে কী আছে? বিসমিল্লাহ হোমিও চেম্বার বা GED-90XA কোডটি কি দেখা যাচ্ছে?" },
                        { type: "image_url", image_url: { url: imageUrl } }
                    ]
                }
            ]
        };

        const response = await axios.post('http://localhost:3001/api/external/v1/chat/completions', payload, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000 // Increase timeout for image analysis
        });

        console.log("[Test] AI Response:", JSON.stringify(response.data, null, 2));
        
        if (response.data?.choices?.[0]?.message?.content) {
            console.log("[Test] SUCCESS: SalesmanChatbot Flash Vision is working!");
        } else {
            console.error("[Test] FAILED: No content in response.");
        }

    } catch (err) {
        console.error("[Test] ERROR:", err.message);
        if (err.response) {
            console.error("[Test] API Error Details:", JSON.stringify(err.response.data, null, 2));
        }
    }
}

testSalesmanChatbotFlash();
