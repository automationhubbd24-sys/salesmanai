
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

async function testOpenRouterAudio() {
    try {
        console.log("Starting OpenRouter Audio Test...");
        const audioUrl = 'https://cdn.fbsbx.com/v/t59.3654-21/641621865_2352137571927372_3690889597954407438_n.mp4/audioclip-1772033010000-2218.mp4?sdl=1&_nc_cat=110&ccb=1-7&_nc_sid=d61c36&_nc_ohc=Q-brSOWYVvAQ7kNvwFXJ9k9&_nc_oc=AdnWnaRn3hAAQ4_P-krg2fqBxrL7WdnhtZGLWFwzOCzeRN4LPK2yHIYN-plvgdBRDMNWPIPQ3XklwRwzO_w51ZQy&_nc_zt=28&_nc_ht=cdn.fbsbx.com&_nc_gid=sQUSByAPO2XlptjPHzRV0g&oh=03_Q7cD4gHGyfCSuMDPQCcfrpQu-VDuXFmDYg-RtR20aUinytGxdA&oe=69A0E870';
        
        // 1. Fetch OpenRouter Key
        const keysRes = await pgClient.query("SELECT api FROM api_list WHERE provider = 'openrouter' AND status = 'active' LIMIT 1");
        const openRouterKey = keysRes.rows[0]?.api;
        
        if (!openRouterKey) {
            console.error("❌ No active OpenRouter key found!");
            process.exit(1);
        }

        // 2. Download Audio File
        console.log("Downloading audio...");
        const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const base64Audio = buffer.toString('base64');
        
        // 3. Test Nvidia Nemotron (Is it multimodal audio?)
        // Note: OpenRouter usually takes audio as a file URL or base64 in "content" for multimodal models.
        // Or as a separate endpoint for Whisper.
        // Let's assume user wants to use it as a Chat Completion with audio input (like Gemini/GPT-4o-Audio).
        
        const modelsToTest = [
            'nvidia/nemotron-nano-12b-v2-vl:free', // The one in question
            'google/gemini-2.5-flash:free', // Latest
            'google/gemini-2.0-flash-exp:free' // Another alternative
        ];

        for (const model of modelsToTest) {
            console.log(`\nTesting ${model}...`);
            try {
                const payload = {
                    model: model,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "Transcribe this audio." },
                                { 
                                    type: "input_audio", 
                                    input_audio: { 
                                        data: base64Audio, 
                                        format: "mp3" // The file is actually mp4/m4a container but let's try generic or mp3
                                    } 
                                }
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
                    timeout: 40000
                });

                if (res.data.choices && res.data.choices.length > 0) {
                    console.log(`✅ Success (${model}):`, res.data.choices[0].message.content);
                } else {
                    console.error(`❌ Failed (${model}): Empty response.`);
                }
            } catch (err) {
                console.error(`❌ Failed (${model}):`, err.response?.data?.error?.message || err.message);
            }
        }
        
        process.exit(0);

    } catch (err) {
        console.error("Script Error:", err);
        process.exit(1);
    }
}

testOpenRouterAudio();
