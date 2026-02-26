
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Configuration
const API_KEY = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
const BASE_URL = 'http://localhost:3000/api/external/v1'; // Adjust if needed
const MODEL = 'salesmanchatbot-pro';

// Helper: Delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function testText() {
    console.log("\n[TEST] 1. Testing Text Chat...");
    try {
        const res = await axios.post(`${BASE_URL}/chat/completions`, {
            model: MODEL,
            messages: [{ role: "user", content: "Hello! Who are you?" }]
        }, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log("✅ Text Success:", res.data.choices[0].message.content);
    } catch (err) {
        console.error("❌ Text Failed:", err.response?.data || err.message);
    }
}

async function testVision() {
    console.log("\n[TEST] 2. Testing Vision (Image Analysis)...");
    const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg";
    
    try {
        const res = await axios.post(`${BASE_URL}/chat/completions`, {
            model: MODEL,
            messages: [
                { 
                    role: "user", 
                    content: [
                        { type: "text", text: "What is in this image?" },
                        { type: "image_url", image_url: { url: imageUrl } }
                    ] 
                }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log("✅ Vision Success:", res.data.choices[0].message.content);
    } catch (err) {
        console.error("❌ Vision Failed:", err.response?.data || err.message);
    }
}

async function testVoice() {
    console.log("\n[TEST] 3. Testing Voice Transcription (Whisper)...");
    
    // Download a small sample audio if not exists, or use a dummy one
    // For this test, we need a real audio file. Let's assume one exists or download one.
    const audioPath = path.join(__dirname, 'test_audio.mp3');
    
    // Check if file exists, if not download a sample
    if (!fs.existsSync(audioPath)) {
        console.log("Downloading sample audio...");
        const writer = fs.createWriteStream(audioPath);
        const response = await axios({
            url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', // Long file, but we will just read a bit or hope it works
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
        formData.append('model', 'whisper-1'); // Standard OpenAI format, but backend should route to Groq/Gemini

        // Note: The endpoint for audio might be different depending on implementation
        // Usually it is /audio/transcriptions
        const res = await axios.post(`${BASE_URL}/audio/transcriptions`, formData, {
            headers: { 
                'Authorization': `Bearer ${API_KEY}`, 
                ...formData.getHeaders() 
            }
        });
        console.log("✅ Voice Success:", res.data.text);
    } catch (err) {
        console.error("❌ Voice Failed:", err.response?.data || err.message);
    }
}

async function runTests() {
    console.log(`Starting SalesmanChatbot Pro Test with Key: ${API_KEY.substring(0, 10)}...`);
    
    // 1. Text
    await testText();
    
    // Delay to simulate human behavior and respect Rate Limits (2 RPM default)
    console.log("Waiting 30 seconds to respect Rate Limits...");
    await delay(30000);

    // 2. Vision
    await testVision();

    console.log("Waiting 30 seconds to respect Rate Limits...");
    await delay(30000);

    // 3. Voice
    // Note: We need to make sure the backend supports the /audio/transcriptions endpoint mapped to SalesmanChatbot
    // If not, we might need to use the chat completion with audio input format if supported.
    // But standard OpenAI is /audio/transcriptions.
    // Let's try standard endpoint.
    await testVoice();

    console.log("\n✅ All Tests Completed.");
}

runTests();
