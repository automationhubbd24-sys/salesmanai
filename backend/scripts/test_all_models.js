
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Configuration
const API_KEY = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
const BASE_URL = 'https://api.salesmanchatbot.online/api/external/v1'; // Live Server

// Models to Test
const MODELS = [
    'salesmanchatbot-pro',
    'salesmanchatbot-flash',
    'salesmanchatbot-lite'
];

// Helper: Delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function testText(model) {
    console.log(`\n[${model}] 1. Testing Text Chat...`);
    try {
        const res = await axios.post(`${BASE_URL}/chat/completions`, {
            model: model,
            messages: [{ role: "user", content: "Hello! Who are you? Reply in 5 words." }]
        }, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`✅ [${model}] Text Success:`, res.data.choices[0].message.content);
    } catch (err) {
        console.error(`❌ [${model}] Text Failed:`, err.response?.data || err.message);
    }
}

async function testVision(model) {
    console.log(`\n[${model}] 2. Testing Vision (Image)...`);
    const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg";
    
    try {
        const res = await axios.post(`${BASE_URL}/chat/completions`, {
            model: model,
            messages: [
                { 
                    role: "user", 
                    content: [
                        { type: "text", text: "What is in this image? Reply in 5 words." },
                        { type: "image_url", image_url: { url: imageUrl } }
                    ] 
                }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`✅ [${model}] Vision Success:`, res.data.choices[0].message.content);
    } catch (err) {
        console.error(`❌ [${model}] Vision Failed:`, err.response?.data || err.message);
    }
}

async function testVoice(model) {
    console.log(`\n[${model}] 3. Testing Voice Transcription...`);
    const audioPath = path.join(__dirname, 'test_audio.mp3');
    
    // Ensure audio file exists
    if (!fs.existsSync(audioPath)) {
        console.log("Downloading sample audio...");
        const writer = fs.createWriteStream(audioPath);
        const response = await axios({
            url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
            method: 'GET',
            responseType: 'stream'
        });
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(audioPath));
        formData.append('model', 'whisper-1'); // Standard param, backend should route based on config

        const res = await axios.post(`${BASE_URL}/audio/transcriptions`, formData, {
            headers: { 
                'Authorization': `Bearer ${API_KEY}`, 
                ...formData.getHeaders() 
            }
        });
        console.log(`✅ [${model}] Voice Success:`, res.data.text ? res.data.text.substring(0, 50) + "..." : "No Text");
    } catch (err) {
        console.error(`❌ [${model}] Voice Failed:`, err.response?.data || err.message);
    }
}

async function runTests() {
    console.log(`Starting Comprehensive Model Test on LIVE SERVER...`);
    console.log(`Key: ${API_KEY.substring(0, 10)}...`);
    
    for (const model of MODELS) {
        console.log(`\n========================================`);
        console.log(`   TESTING MODEL: ${model}`);
        console.log(`========================================`);
        
        await testText(model);
        console.log("Waiting 5s..."); await delay(5000);

        await testVision(model);
        console.log("Waiting 5s..."); await delay(5000);

        // Voice endpoint is global, but let's test it in the loop to see stability
        await testVoice(model);
        console.log("Waiting 5s..."); await delay(5000);
    }

    console.log("\n✅ All Comprehensive Tests Completed.");
}

runTests();
