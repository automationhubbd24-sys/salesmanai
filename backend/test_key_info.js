
const axios = require('axios');

// User provided key for testing (load from env when running locally)
const API_KEY = process.env.OPENROUTER_API_KEY || 'your-openrouter-api-key';

async function checkKeyInfo() {
    console.log(`\n----------------------------------------`);
    console.log(`Testing /auth/key endpoint...`);
    try {
        const response = await axios.get('https://openrouter.ai/api/v1/auth/key', {
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });
        console.log(`✅ Auth Key Info Status: ${response.status}`);
        console.log('🔍 Key Info:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error(`❌ Auth Key Info Error:`, error.message);
        if (error.response) {
             console.error(JSON.stringify(error.response.data, null, 2));
        }
    }
}

checkKeyInfo();
