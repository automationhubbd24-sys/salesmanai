const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- SIMULATED AISERVICE LOGIC ---
function getDynamicUserAgent() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
}

function getStealthHeaders(apiKey, provider = 'google') {
    const ua = getDynamicUserAgent();
    return {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`, // Standard OpenAI format for Google v1beta/openai
        'Sec-CH-UA': '"Chromium";v="122"',
        'Sec-CH-UA-Platform': '"Windows"',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty'
    };
}

// --- TEST CONFIG ---
const API_KEYS = [
    'AIzaSyCQjZ8--bokDF5vt4KWIttcsV0ybLgE7bE', // Index 3 from logs
    'AIzaSyA97qQOHLYiKppSmm8YtekN2eRDwpMARS0', // Index 4 from logs
    'AIzaSyC7AalcC4yUi3QJYAn8U6S0q0OPIMWbmr0'  // Index 5 from logs
];

const TARGET_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MODEL = 'gemini-2.5-flash';

async function testSingleKey(apiKey) {
    console.log(`\nTesting Key: ${apiKey.substring(0, 12)}...`);
    
    const payload = {
        model: MODEL,
        messages: [{ role: "user", content: "Hello, reply with 'Success' if you work." }]
    };

    try {
        const response = await axios.post(TARGET_URL, payload, {
            headers: getStealthHeaders(apiKey),
            timeout: 30000,
            validateStatus: () => true
        });

        console.log(`Status: ${response.status}`);
        if (response.status >= 400) {
            console.log('Error Data:', JSON.stringify(response.data, null, 2));
        } else {
            console.log('Success Data:', JSON.stringify(response.data.choices[0].message, null, 2));
        }
    } catch (err) {
        console.error('Network/Request Error:', err.message);
    }
}

async function runTests() {
    for (const key of API_KEYS) {
        await testSingleKey(key);
    }
}

runTests();
