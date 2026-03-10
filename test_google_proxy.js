const { OpenAI } = require('openai');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- BRIGHT DATA CONFIGURATION ---
const PROXY_USER = 'brd-customer-hl_69ebe07e-zone-data_center';
const PROXY_PASS = 'zgs4711vyxnp';
const PROXY_HOST = 'brd.superproxy.io:33335';

// --- GOOGLE GEMINI CONFIGURATION ---
const GEMINI_API_KEY = 'YOUR_ACTUAL_GEMINI_KEY_HERE'; // I need to get one from the pool or ask user
const MODEL = 'gemini-2.0-flash'; // Let's try 2.0 first as 2.5 might be the issue

async function testGoogleViaProxy() {
    const session = `sess${Math.floor(Math.random() * 9999999)}`;
    const proxyUrl = `http://${PROXY_USER}-session-${session}:${PROXY_PASS}@${PROXY_HOST}`;
    const proxyAgent = new HttpsProxyAgent(proxyUrl);

    console.log(`Testing with Proxy Session: ${session}`);

    const openai = new OpenAI({
        apiKey: 'DUMMY_KEY', // We'll replace with real one if we find it
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent
    });

    try {
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: 'Say hello' }]
        });
        console.log("Success:", completion.choices[0].message.content);
    } catch (err) {
        console.error("Failed:", err.message);
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Headers:", err.response.headers);
            console.error("Body:", err.response.data);
        }
    }
}
// testGoogleViaProxy();
