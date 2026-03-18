
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');
const axios = require('axios');

async function testDirectAPIs() {
    try {
        console.log("Fetching keys from database...");
        
        // 1. Fetch Keys (One per provider)
        const openRouterKey = (await pgClient.query("SELECT api FROM api_list WHERE provider = 'openrouter' AND status = 'active' LIMIT 1")).rows[0]?.api;
        const groqKey = (await pgClient.query("SELECT api FROM api_list WHERE provider = 'groq' AND status = 'active' LIMIT 1")).rows[0]?.api;
        const googleKey = (await pgClient.query("SELECT api FROM api_list WHERE (provider = 'google' OR provider = 'gemini') AND status = 'active' LIMIT 1")).rows[0]?.api;

        if (!openRouterKey) console.warn("WARNING: No active OpenRouter key found.");
        if (!groqKey) console.warn("WARNING: No active Groq key found.");
        if (!googleKey) console.warn("WARNING: No active Google/Gemini key found.");

        const imageUrl = 'https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/657a89a4-f712-44ba-a3b7-b150b966a65c/1771914711503.jpg';
        
        // Pre-fetch image and convert to Base64 to avoid URL access issues
        console.log("Downloading image for Base64 conversion...");
        const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64Img = Buffer.from(imgRes.data, 'binary').toString('base64');
        const mimeType = "image/jpeg";
        const dataUrl = `data:${mimeType};base64,${base64Img}`;
        console.log("Image converted to Base64 successfully.");

        // --- 1. OpenRouter Test ---
        if (openRouterKey) {
            console.log("\n--- Testing OpenRouter (Direct) ---");
            // User provided specific list of Vision Models to test
            const orModels = [
                'nvidia/nemotron-nano-12b-v2-vl:free',
                'qwen/qwen-2.5-vl-7b-instruct:free',
                'mistralai/mistral-small-3.1-24b-instruct:free',
                'qwen/qwen3-vl-30b-a3b-thinking' // Note: 'thinking' usually implies reasoning model.
            ]; 
            
            for (const model of orModels) {
                try {
                    console.log(`OpenRouter: Testing ${model}...`);
                    // Use Base64 Data URL instead of public URL
                    const payload = {
                        model: model,
                        messages: [
                            { 
                                role: "user", 
                                content: [
                                    { type: "text", text: "What is in this image? Answer briefly." }, 
                                    { type: "image_url", image_url: { url: dataUrl } }
                                ]
                            }
                        ]
                    };
                    
                    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                        headers: { 
                            'Authorization': `Bearer ${openRouterKey}`,
                            'Content-Type': 'application/json',
                             'HTTP-Referer': 'https://salesmanchatbot.online', 
                             'X-Title': 'SalesmanChatbot Test'
                        },
                        timeout: 60000 // Increased timeout for heavy models
                    });
                    
                    // Check for valid response structure before accessing
                    if (res.data && res.data.choices && res.data.choices.length > 0) {
                         console.log(`✅ OpenRouter Success (${model}):`, res.data.choices[0].message.content.substring(0, 50) + "...");
                    } else {
                         console.error(`❌ OpenRouter Failed (${model}): Empty response or invalid structure.`);
                    }

                } catch (err) {
                    const errMsg = err.response?.data?.error?.message || err.message;
                    console.error(`❌ OpenRouter Failed (${model}):`, errMsg.substring(0, 200));
                }
            }
        }

        // --- 2. Groq Test ---
        if (groqKey) {
            console.log("\n--- Testing Groq (Direct) ---");
            // User requested Groq models from screenshot/list
            const groqModels = [
                'groq/compound-mini', 
                'meta-llama/llama-4-scout-17b-16e-instruct',
                'llama-3.3-70b-versatile'
            ]; 

            for (const model of groqModels) {
                try {
                    console.log(`Groq: Testing ${model}...`);
                    
                    // Groq Logic: Check if model supports Vision. 
                    // 'llama-3.3-70b-versatile' is TEXT ONLY. Sending image will fail.
                    // 'groq/compound-mini' usually implies multimodal, but let's be safe.
                    // 'meta-llama/llama-4-scout-17b-16e-instruct' supports vision.

                    let contentPayload;
                    if (model.includes('versatile') || model.includes('compound-mini')) {
                        // Text-only test for non-vision models to avoid 400 Bad Request
                         contentPayload = "Hello from Groq test.";
                    } else {
                        // Vision test for vision models (URL preferred for Groq, but trying URL first as Base64 failed for some)
                        // Actually user said "URL might not work due to Supabase".
                        // Let's try URL first for Groq as they recommend it.
                        contentPayload = [
                             { type: "text", text: "What is this?" },
                             { type: "image_url", image_url: { url: imageUrl } } 
                        ];
                    }

                    const payload = {
                        model: model,
                        messages: [{ role: "user", content: contentPayload }]
                    };

                    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
                        headers: { 
                            'Authorization': `Bearer ${groqKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    console.log(`✅ Groq Success (${model}):`, res.data.choices[0].message.content.substring(0, 50) + "...");
                } catch (err) {
                    const errMsg = err.response?.data?.error?.message || err.message;
                    console.error(`❌ Groq Failed (${model}):`, errMsg);
                }
            }
        }

        // --- 3. Google Gemini Test ---
        if (googleKey) {
            console.log("\n--- Testing Google Gemini (Direct) ---");
            // User INSISTS on gemini-2.5-flash-lite. 
            const userModel = 'gemini-2.5-flash-lite'; 

            try {
                console.log(`Gemini: Testing ${userModel} (Text & Vision)...`);
                
                // Using v1beta
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${userModel}:generateContent?key=${googleKey}`;
                
                // Gemini REST API expects inline_data for Base64 (already have base64Img)
                const visionPayload = {
                    contents: [{
                        parts: [
                            { text: "What is this?" },
                            { inline_data: { mime_type: "image/jpeg", data: base64Img } }
                        ]
                    }]
                };

                const res = await axios.post(url, visionPayload, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 40000
                });

                if (res.data.candidates && res.data.candidates.length > 0) {
                     console.log(`✅ Gemini Success (${userModel}):`, res.data.candidates[0].content.parts[0].text.substring(0, 50) + "...");
                } else {
                    console.error(`❌ Gemini Failed: No candidates returned.`);
                }

            } catch (err) {
                console.error(`❌ Gemini Failed:`, err.response?.data?.error?.message || err.message);
            }
        }

        process.exit(0);

    } catch (err) {
        console.error("Script Error:", err);
        process.exit(1);
    }
}

testDirectAPIs();
