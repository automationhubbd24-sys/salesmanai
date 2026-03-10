const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- BRIGHT DATA CONFIGURATION (From Memory) ---
const PROXY_USER = 'brd-customer-hl_69ebe07e-zone-data_center';
const PROXY_PASS = 'zgs4711vyxnp';
const PROXY_HOST = 'brd.superproxy.io';
const PROXY_PORT = '33335';

// --- TARGET API CONFIGURATION ---
const API_KEY = 'salesmanchatbot-2eacc0b72391c9436e02fc45245262229953778b314b0acf';
const BASE_URL = 'https://api.salesmanchatbot.online/api/external/v1';

async function testOpenAICompatible() {
    try {
        console.log("🚀 Starting OpenAI Compatible Proxy Test...");
        
        // 1. Create Proxy Agent with Rotation Session
        const sessionId = Math.floor(Math.random() * 9999999);
        const proxyUrl = `http://${PROXY_USER}-session-${sessionId}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;
        const proxyAgent = new HttpsProxyAgent(proxyUrl);
        
        console.log(`📡 Using Proxy Session: ${sessionId}`);

        // 2. Step 1: Check IP via Proxy
        console.log("🔍 Checking IP via Bright Data...");
        const ipCheck = await axios.get('https://geo.brdtest.com/mygeo.json', {
            httpsAgent: proxyAgent,
            httpAgent: proxyAgent,
            proxy: false,
            timeout: 10000
        });
        console.log("✅ Current Proxy IP Details:", JSON.stringify(ipCheck.data, null, 2));

        // 3. Step 2: Call SalesmanChatbot API via Proxy
        console.log("\n🤖 Calling SalesmanChatbot Pro Engine (gemini-2.5-flash)...");
        const response = await axios.post(`${BASE_URL}/chat/completions`, {
            model: "salesmanchatbot-pro",
            messages: [
                { role: "user", content: "hi, tell me your identity and current date" }
            ],
            stream: false
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            httpsAgent: proxyAgent,
            httpAgent: proxyAgent,
            proxy: false,
            timeout: 30000
        });

        console.log("\n--- Full Raw Response ---");
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.choices && response.data.choices[0].message) {
            console.log("\n--- AI Reply ---");
            console.log(response.data.choices[0].message.content);
        }

    } catch (error) {
        console.error("\n❌ Test Failed!");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

testOpenAICompatible();
