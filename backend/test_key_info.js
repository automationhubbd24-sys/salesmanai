
const axios = require('axios');

// User provided key for testing
const API_KEY = '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';

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
