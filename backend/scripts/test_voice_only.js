
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Configuration
const API_KEY = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
const BASE_URL = 'https://api.salesmanchatbot.online/api/external/v1'; 
const AUDIO_URL = 'https://cdn.fbsbx.com/v/t59.3654-21/641621865_2352137571927372_3690889597954407438_n.mp4/audioclip-1772033010000-2218.mp4?sdl=1&_nc_cat=110&ccb=1-7&_nc_sid=d61c36&_nc_ohc=Q-brSOWYVvAQ7kNvwFXJ9k9&_nc_oc=AdnWnaRn3hAAQ4_P-krg2fqBxrL7WdnhtZGLWFwzOCzeRN4LPK2yHIYN-plvgdBRDMNWPIPQ3XklwRwzO_w51ZQy&_nc_zt=28&_nc_ht=cdn.fbsbx.com&_nc_gid=sQUSByAPO2XlptjPHzRV0g&oh=03_Q7cD4gHGyfCSuMDPQCcfrpQu-VDuXFmDYg-RtR20aUinytGxdA&oe=69A0E870';

// Models to Test
const MODELS = [
    'salesmanchatbot-pro',
    'salesmanchatbot-flash',
    'salesmanchatbot-lite'
];

// Helper: Delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function downloadAudio() {
    console.log("Downloading audio from provided URL...");
    const audioPath = path.join(__dirname, 'test_input_audio.mp4');
    
    const writer = fs.createWriteStream(audioPath);
    const response = await axios({
        url: AUDIO_URL,
        method: 'GET',
        responseType: 'stream'
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log("Audio downloaded successfully.");
            resolve(audioPath);
        });
        writer.on('error', reject);
    });
}

async function testVoice(model, audioPath) {
    console.log(`\n[${model}] Testing Voice Transcription...`);
    
    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(audioPath));
        formData.append('model', 'whisper-1'); // Standard param, backend should route to Google Gemini

        // Note: We need to pass the model context somehow. 
        // Standard OpenAI Audio API does not support 'model' for routing provider logic easily via header.
        // However, our backend 'aiService.js' doesn't seem to look at 'model' field in formData for Provider Routing logic in 'transcribeAudio'.
        // It relies on Global Config if 'User Key' is not present.
        // BUT wait, we are using a User Key (sk-f8...).
        // So aiService will see 'sk-f8...' and treat it as a User Key.
        // AND it will try to detect provider from key prefix.
        // 'sk-f8...' doesn't match standard prefixes.
        // Let's see what happens.
        
        // Actually, our previous test showed 'salesmanchatbot-pro' failed with 500.
        // The issue might be that for Audio, we can't easily pass 'salesmanchatbot-pro' as the model in the URL like Chat Completions.
        // The endpoint is fixed: /audio/transcriptions.
        
        // Strategy: We will rely on the fact that this is a "System Key" or "Salesman Key".
        // If it's a Salesman Key, the backend should treat it as 'salesmanchatbot' provider.
        
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
    console.log(`Starting Voice Only Test...`);
    const audioPath = await downloadAudio();
    
    // We run the test 3 times, but since we can't easily switch models via API param for Audio (it's global/key based),
    // we are essentially testing the SAME configuration 3 times.
    // Unless the backend has a way to distinguish.
    // For now, let's just run it once to see if the FIX works for the default setup.
    
    await testVoice('salesmanchatbot-pro (Default)', audioPath);
    
    console.log("\n✅ Test Completed.");
}

runTests();
