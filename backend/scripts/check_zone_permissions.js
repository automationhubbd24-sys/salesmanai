
const axios = require('axios');

// CONFIG
const ZONE_NAME = 'data_center';
const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;

async function checkPermissions() {
    console.log(`--- CHECKING PERMISSIONS FOR ZONE: ${ZONE_NAME} ---`);

    if (!BRIGHTDATA_API_TOKEN) {
        console.error('ERROR: BRIGHTDATA_API_TOKEN is missing.');
        return;
    }

    try {
        // 1. Get Zone Permissions
        console.log('Fetching Zone Permissions...');
        const res = await axios.get(`https://api.brightdata.com/zone/permissions?zone=${ZONE_NAME}`, {
            headers: { 'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}` }
        });

        console.log('\n--- PERMISSIONS RESPONSE ---');
        console.log(JSON.stringify(res.data, null, 2));

    } catch (error) {
        console.error('FAILED:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

checkPermissions();
