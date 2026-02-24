const axios = require('axios');

async function testApi() {
    const key = 'sk-f835891e79afe814767ec4499aef8c96fc5698a4397ef79d';
    const url = 'https://api.salesmanchatbot.online/api/external/v1/chat/completions';
    
    const modelsToTest = ['salesmanchatbot-flash', 'salesmanchatbot-lite'];
    
    for (const model of modelsToTest) {
        console.log(`\n--- Testing Model: ${model} ---`);
        try {
            const response = await axios.post(url, {
                model: model,
                messages: [
                    { role: 'user', content: 'What is your name and what model are you?' }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });
            
            console.log(`✅ ${model} SUCCESS:`);
            console.log(`Content: ${response.data.choices[0].message.content}`);
        } catch (err) {
            console.log(`❌ ${model} FAILED:`);
            if (err.response) {
                console.log(`Status: ${err.response.status}`);
                console.log('Error Data:', JSON.stringify(err.response.data, null, 2));
            } else {
                console.log('Error Message:', err.message);
            }
        }
    }
}

testApi();
