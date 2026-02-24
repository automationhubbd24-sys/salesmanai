const axios = require('axios');

async function testApi() {
    const key = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    const url = 'https://api.salesmanchatbot.online/api/external/v1/chat/completions';
    
    console.log(`Testing API at: ${url}`);
    console.log(`Using Key: ${key}`);
    
    try {
        const response = await axios.post(url, {
            model: 'salesmanchatbot-pro',
            messages: [
                { role: 'user', content: 'Hello, are you working?' }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ API Response Success:');
        console.log(JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.log('❌ API Response Error:');
        if (err.response) {
            console.log(`Status: ${err.response.status}`);
            console.log('Data:', JSON.stringify(err.response.data, null, 2));
        } else {
            console.log('Error Message:', err.message);
        }
    }
}

testApi();
