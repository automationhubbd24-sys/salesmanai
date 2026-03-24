
const axios = require('axios');
const aiService = require('./src/services/aiService');

const audioUrl = 'https://wahubbd.salesmanchatbot.online/api/files/bottow_wh03lz/A59F690BBE85DD9C835B06C706D0E14B.mp3';

async function test() {
    console.log('Testing Audio URL:', audioUrl);
    try {
        // Mock config
        const config = {
            audio_detection: true,
            voice_model: 'gemini-1.5-flash',
            ai_provider: 'google'
        };
        
        const result = await aiService.transcribeAudio(audioUrl, config);
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
