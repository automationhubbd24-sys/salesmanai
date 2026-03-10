const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// ব্রাইট ডাটা কনফিগারেশন (আপনার স্ক্রিনশট অনুযায়ী)
const config = {
    proxyUrl: 'brd.superproxy.io:33335',
    user: 'brd-customer-hl_69ebe07e-zone-data_center',
    pass: 'zgs4711vyxnp'
};

function getProxyUrl() {
    // রোটেশন নিশ্চিত করতে প্রতিবার নতুন সেশন আইডি জেনারেট করা হচ্ছে
    const session = `sess_${Math.floor(Math.random() * 1000000)}`;
    return `http://${config.user}-session-${session}:${config.pass}@${config.proxyUrl}`;
}

async function testProxyRotation() {
    console.log("--- Bright Data Proxy Rotation Test Started ---");
    
    for (let i = 1; i <= 3; i++) {
        const proxy = getProxyUrl();
        const agent = new HttpsProxyAgent(proxy);
        
        try {
            console.log(`\n[Request ${i}] Using Proxy Session...`);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: agent,
                proxy: false, // Agent handles proxy
                timeout: 10000
            });
            console.log(`[Request ${i}] Success! Current IP: ${response.data.ip}`);
        } catch (error) {
            console.error(`[Request ${i}] Failed: ${error.message}`);
            if (error.response) {
                console.error(`Status: ${error.response.status}`);
            }
        }
    }
}

testProxyRotation();
