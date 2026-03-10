const axios = require('axios');

/**
 * এই স্ক্রিপ্টটি লাইভ সার্ভারে (api.salesmanchatbot.online) ব্রাইট ডাটা প্রক্সি 
 * ঠিকঠাক কাজ করছে কি না তা সরাসরি চেক করবে।
 * এটি ডিব্যাগ টোকেন ছাড়াই চেক করার চেষ্টা করবে যদি সার্ভারে টোকেন সেট না থাকে, 
 * নতুবা আপনাকে টোকেনটি দিতে হবে।
 */

const BASE_URL = 'https://api.salesmanchatbot.online/api/debug/proxy';
// যদি আপনি DEBUG_ADMIN_TOKEN সেট করে থাকেন, তবে সেটি এখানে দিন
const TOKEN = process.argv[2] || ''; 

async function verifyOnlyProxy() {
    console.log("--- Bright Data Proxy Verification (Live) ---");
    
    try {
        console.log(`[Step 1] Requesting Proxy Check from: ${BASE_URL}`);
        
        const response = await axios.get(`${BASE_URL}`, {
            params: { 
                token: TOKEN,
                target: 'json' // mygeo.json চেক করবে
            },
            timeout: 15000
        });

        if (response.data.ok) {
            console.log("\n✅ SUCCESS: Bright Data Proxy is working on the live server!");
            console.log("--------------------------------------------------");
            console.log(`Status: ${response.data.status}`);
            console.log(`Method: ${response.data.via === 'env' ? 'Environment Variables' : 'Headers'}`);
            
            // Body Preview থেকে আইপি এবং দেশ বের করা
            const geo = JSON.parse(response.data.body_preview);
            console.log(`Current Proxy IP: ${geo.ip}`);
            console.log(`Country: ${geo.country}`);
            console.log(`City: ${geo.city}`);
            console.log("--------------------------------------------------");
        } else {
            console.log("\n❌ FAILED: Server returned an error.");
            console.log(JSON.stringify(response.data, null, 2));
        }

    } catch (error) {
        console.log("\n❌ ERROR during verification:");
        if (error.response) {
            if (error.response.status === 403) {
                console.log("Status 403: Forbidden. আপনার সার্ভারে DEBUG_ADMIN_TOKEN সেট করা আছে।");
                console.log("দয়া করে কমান্ডটি এভাবে চালান: node verify_proxy_only.js আপনার_টোকেন");
            } else {
                console.log(`Status: ${error.response.status}`);
                console.log("Data:", error.response.data);
            }
        } else {
            console.log("Message:", error.message);
        }
    }
}

verifyOnlyProxy();
