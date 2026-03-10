const axios = require('axios');

/**
 * এই স্ক্রিপ্টটি লাইভ সার্ভারে (api.salesmanchatbot.online) ব্রাইট ডাটা প্রক্সি 
 * ঠিকঠাক কাজ করছে কি না তা যাচাই করবে।
 * 
 * ব্যবহার: node verify_brightdata_live.js <DEBUG_TOKEN>
 */

const BASE_URL = 'https://api.salesmanchatbot.online/api/debug/proxy';
const TOKEN = process.argv[2] || 'YOUR_TOKEN_HERE';

async function testLiveProxy() {
    console.log("--- Bright Data Live Verification Started ---");
    console.log(`Target: ${BASE_URL}`);
    
    try {
        console.log("\n[Step 1] Fetching IP info from live server via Proxy...");
        const response = await axios.get(`${BASE_URL}?token=${TOKEN}`, {
            timeout: 15000
        });

        if (response.data.ok) {
            console.log("✅ SUCCESS: Live server is using Bright Data Proxy!");
            console.log("--- Response Details ---");
            console.log(`Status: ${response.data.status}`);
            console.log(`Via: ${response.data.via}`);
            console.log(`Target Checked: ${response.data.target}`);
            console.log(`Body Preview (IP Info): \n${response.data.body_preview}`);
        } else {
            console.log("❌ FAILED: Server returned OK: false");
            console.log(JSON.stringify(response.data, null, 2));
        }

    } catch (error) {
        console.log("❌ CRITICAL ERROR:");
        if (error.response) {
            console.log(`Status: ${error.response.status}`);
            if (error.response.status === 403) {
                console.log("Error: Invalid DEBUG_TOKEN. Please provide the correct token.");
            } else {
                console.log("Data:", JSON.stringify(error.response.data, null, 2));
            }
        } else {
            console.log("Message:", error.message);
        }
    }
}

if (TOKEN === 'YOUR_TOKEN_HERE') {
    console.log("Error: Please provide the DEBUG_ADMIN_TOKEN as an argument.");
    console.log("Usage: node verify_brightdata_live.js YOUR_TOKEN");
} else {
    testLiveProxy();
}
