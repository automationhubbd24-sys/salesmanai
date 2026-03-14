
const OpenAI = require('openai');
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Backend functions for testing
function getProxyUrl(modelName = 'default', useSession = true) {
    const proxyUrl = process.env.BRIGHT_DATA_PROXY_URL;
    const user = process.env.BRIGHT_DATA_USER;
    const pass = process.env.BRIGHT_DATA_PASS;
    if (!proxyUrl || !user || !pass) return null;
    
    let url = "";
    if (useSession) {
        const session = Math.floor(Math.random() * 1000000);
        url = `http://${user}-session-${session}:${pass}@${proxyUrl}`;
    } else {
        url = `http://${user}:${pass}@${proxyUrl}`;
    }
    return url;
}

function createProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        const agent = new HttpsProxyAgent(proxyUrl);
        const sessionName = proxyUrl.includes('-session-') ? proxyUrl.split('-session-')[1]?.split(':')[0] : 'direct';
        agent.proxySessionName = sessionName;
        return agent;
    } catch (e) {
        console.warn(`[Proxy] Failed to create Proxy Agent: ${e.message}`);
        return null;
    }
}

async function testGeminiProxy() {
    console.log("--- Starting Gemini Proxy Test (salesmanchatbot-pro) ---");
    
    const model = "gemini-2.5-flash"; // The model to test
    const brandedModel = "salesmanchatbot-pro";
    const baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    
    // In production, this comes from keyService.getSmartKey
    // For testing, we use the key from environment or you can replace it
    const apiKey = process.env.GOOGLE_API_KEY || "YOUR_GOOGLE_API_KEY_HERE";
    
    if (apiKey === "YOUR_GOOGLE_API_KEY_HERE" && !process.env.GOOGLE_API_KEY) {
        console.error("Error: No Google API Key found. Please set GOOGLE_API_KEY in .env or script.");
        return;
    }

    // Proxy Setup (Backend Logic)
    const proxyUrl = getProxyUrl(brandedModel);
    const proxyAgent = createProxyAgent(proxyUrl);
    
    console.log(`[Test Request] Model: ${model} | Proxy: ${proxyAgent?.proxySessionName || 'NONE'} | URL: ${baseURL}`);

    if (proxyAgent) {
        // Verification call (Like backend does)
        try {
            const res = await axios.get('https://api.ip.sb/geoip', { httpsAgent: proxyAgent, timeout: 5000 });
            console.log(`[Proxy Verification] Agent Ready | IP: ${res.data.ip} | Country: ${res.data.country}`);
        } catch (e) {
            console.warn(`[Proxy Verification Failed] but continuing with AI call...`);
        }
    }

    // OpenAI SDK Call (Backend Logic)
    const openai = new OpenAI({ 
        apiKey: apiKey, 
        baseURL: baseURL,
        timeout: 40000,
        ...(proxyAgent ? { httpAgent: proxyAgent, httpsAgent: proxyAgent } : {})
    });

    try {
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [{ role: "user", content: "Hello, this is a proxy test. Are you working?" }],
            temperature: 0.7
        });

        console.log(`[Test Response] Status: Success | Provider: Google | Tokens: ${completion.usage?.total_tokens || 0}`);
        console.log(`[AI Message]: ${completion.choices[0].message.content}`);
    } catch (err) {
        console.error(`[Test Error] Status: ${err.status} | Msg: ${err.message}`);
        if (err.status === 400) {
            console.error(`[Detailed Error]:`, err.error || err.message);
        }
    }
}

testGeminiProxy();
