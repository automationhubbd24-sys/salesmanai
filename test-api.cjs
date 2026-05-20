const axios = require('axios');

const BASE_URL = 'https://api.salesmanchatbot.online/v1';
const API_KEY = 'salesmanchatbot-0f41ca29c557eae6becb8acb4fd79f56e8f4456ad0239b83';

async function testMultimodal(modelId) {
    console.log(`\n=== Testing Model: ${modelId} ===`);
    
    // 1. Test Text
    console.log('\n[1] Testing Text...');
    try {
        const res = await axios.post(`${BASE_URL}/chat/completions`, {
            model: modelId,
            messages: [{ role: 'user', content: 'Say "Text test successful"' }]
        }, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log('Response:', res.data.choices[0].message.content);
    } catch (err) {
        console.error('Text Error:', err.response?.data || err.message);
    }

    // 2. Test Vision
    console.log('\n[2] Testing Vision...');
    try {
        const res = await axios.post(`${BASE_URL}/chat/completions`, {
            model: modelId,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: 'What is in this image?' },
                    { type: 'image_url', image_url: { url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb' } }
                ]
            }]
        }, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log('Response:', res.data.choices[0].message.content);
    } catch (err) {
        console.error('Vision Error:', err.response?.data || err.message);
    }

    // 3. Test Audio
    console.log('\n[3] Testing Audio Analysis...');
    try {
        const res = await axios.post(`${BASE_URL}/chat/completions`, {
            model: modelId,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe the audio content.' },
                    { type: 'audio_url', audio_url: { url: 'https://storage.googleapis.com/generativeai-downloads/data/sample_audio.mp3' } }
                ]
            }]
        }, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log('Response:', res.data.choices[0].message.content);
    } catch (err) {
        console.error('Audio Error:', err.response?.data || err.message);
    }
}

async function runAll() {
    await testMultimodal('gemini-2.5-flash');
    await testMultimodal('gemini-3.1-flash-lite');
}

runAll();
