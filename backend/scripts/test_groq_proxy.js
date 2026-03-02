
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// CONFIG
const AUDIO_URL = 'https://wahubbd.salesmanchatbot.online/api/files/bottow_wh03lz/A5DFCD791A1A4EBDFC2E8C568E56DE3A.mp3';
const GROQ_API_KEY = process.env.GROQ_API_KEY || 'gsk_...'; // Will be replaced by actual key if not in env
const PROXY_URL = 'http://brd-customer-hl_e956420e-zone-data_center:mwiju3dghh0n@brd.superproxy.io:33335';

async function testGroqWithProxy() {
    console.log('--- TESTING GROQ WHISPER WITH PROXY ---');
    console.log(`Audio URL: ${AUDIO_URL}`);
    console.log(`Proxy: ${PROXY_URL}`);

    try {
        // 1. Download Audio
        console.log('1. Downloading Audio...');
        const audioResponse = await axios.get(AUDIO_URL, { responseType: 'arraybuffer' });
        const audioBuffer = Buffer.from(audioResponse.data);
        console.log(`   Downloaded ${audioBuffer.length} bytes.`);

        // 2. Prepare Form Data
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: 'test_audio.mp3', contentType: 'audio/mpeg' });
        formData.append('model', 'whisper-large-v3');

        // 3. Setup Proxy Agent
        const agent = new HttpsProxyAgent(PROXY_URL);

        // 4. Call Groq API
        console.log('2. Sending to Groq API via Proxy...');
        
        // Use a system key if available, otherwise fail
        // Since user said "salesmanchatbot er groq diye test deo", we assume a system key is needed.
        // We will try to fetch one from DB if we were inside the app, but here we need a hardcoded one or mock.
        // Let's assume the user has a key or we use a placeholder that fails if invalid.
        // Actually, we should check if we can import keyService, but that's complex in a standalone script.
        // Let's use a known working key if possible, or ask user.
        // WAIT, the user said "salesmanchatbot er groq diye test deo". This implies using the internal logic?
        // But the user asked for a "test file". So a standalone script is better.
        // I will use a placeholder key and ask user to set env var or I will try to read from .env file if exists.
        
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            console.error('ERROR: GROQ_API_KEY environment variable is missing.');
            console.log('Please run: $env:GROQ_API_KEY="your_key"; node scripts/test_groq_proxy.js');
            return;
        }

        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${apiKey}`
            },
            httpsAgent: agent, // Use Proxy
            proxy: false, // Disable axios default proxy handling
            timeout: 30000
        });

        console.log('3. Result:');
        console.log('------------------------------------------------');
        console.log(res.data.text);
        console.log('------------------------------------------------');
        console.log('SUCCESS: Proxy works and Groq responded.');

    } catch (error) {
        console.error('FAILED:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

testGroqWithProxy();
