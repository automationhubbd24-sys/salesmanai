const axios = require('axios');
require('dotenv').config();

async function debugCoolifyEnv() {
    console.log("🔍 Debugging Coolify Environment Variables for Bright Data...");
    
    // 1. Fetch from ENV (with hardcoded fallbacks from memory for local test)
    const rawUser = process.env.BRIGHT_DATA_USER || 'brd-customer-hl_69ebe07e-zone-data_center';
    const rawPass = process.env.BRIGHT_DATA_PASS || 'zgs4711vyxnp';
    const rawProxyUrl = process.env.BRIGHT_DATA_PROXY_URL || 'brd.superproxy.io:33335';

    console.log("--- RAW VALUES ---");
    console.log(`BRIGHT_DATA_USER: ${rawUser ? `'${rawUser}' (Length: ${rawUser.length})` : 'MISSING'}`);
    console.log(`BRIGHT_DATA_PASS: ${rawPass ? `'${rawPass}' (Length: ${rawPass.length})` : 'MISSING'}`);
    console.log(`BRIGHT_DATA_PROXY_URL: ${rawProxyUrl ? `'${rawProxyUrl}' (Length: ${rawProxyUrl.length})` : 'MISSING'}`);

    if (!rawUser || !rawPass || !rawProxyUrl) {
        console.error("❌ Critical credentials missing in ENV!");
        return;
    }

    // 2. Check for hidden characters (Quotes, spaces, etc.)
    const cleanUser = rawUser.replace(/['"]/g, '').trim();
    const cleanPass = rawPass.replace(/['"]/g, '').trim();
    const cleanUrl = rawProxyUrl.replace(/['"]/g, '').trim();

    console.log("\n--- CLEANED VALUES ---");
    console.log(`Clean User: '${cleanUser}'`);
    console.log(`Clean Pass: '${cleanPass}'`);
    console.log(`Clean URL: '${cleanUrl}'`);

    // 3. Test Proxy Connection directly
    try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        const session = `debug${Math.floor(Math.random() * 999999)}`;
        const host = cleanUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const finalProxyUrl = `http://${cleanUser}-session-${session}:${cleanPass}@${host}`;
        
        console.log(`\n📡 Testing Connection via: http://${cleanUser}-session-${session}:****@${host}`);
        
        const agent = new HttpsProxyAgent(finalProxyUrl);
        const response = await axios.get('https://geo.brdtest.com/mygeo.json', {
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false,
            timeout: 10000
        });

        console.log("✅ Proxy Success!");
        console.log("IP Details:", JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("\n❌ Proxy Test Failed!");
        console.error(`Message: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data: ${JSON.stringify(error.response.data)}`);
        }
    }
}

debugCoolifyEnv();
