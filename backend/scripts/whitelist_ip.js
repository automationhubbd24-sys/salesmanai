
const axios = require('axios');

// CONFIG
const IP_TO_WHITELIST = '203.190.8.241';
const ZONE_NAME = 'data_center';
const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;

async function whitelistIp() {
    console.log(`--- WHITELISTING IP ON BRIGHT DATA ---`);
    console.log(`Zone: ${ZONE_NAME}`);
    console.log(`IP: ${IP_TO_WHITELIST}`);

    if (!BRIGHTDATA_API_TOKEN) {
        console.error('\nERROR: BRIGHTDATA_API_TOKEN environment variable is missing.');
        console.log('Please obtain an API Token from Bright Data (Settings -> API Tokens).');
        console.log('Run: $env:BRIGHTDATA_API_TOKEN="your_token"; node scripts/whitelist_ip.js');
        process.exit(1);
    }

    try {
        console.log('\nSending Request...');
        const response = await axios.post(
            'https://api.brightdata.com/zone/whitelist',
            {
                zone: ZONE_NAME,
                ip: IP_TO_WHITELIST
            },
            {
                headers: {
                    'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('\nSUCCESS!');
        console.log('Status:', response.status);
        console.log('Response:', response.data);

    } catch (error) {
        console.error('\nFAILED:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error Details:', error);
        }
    }
}

whitelistIp();
