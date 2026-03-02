
const axios = require('axios');

// CONFIG
const ZONE_NAME = 'data_center';
const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;

async function updateZonePerms() {
    console.log(`--- UPDATING PERMISSIONS FOR ZONE: ${ZONE_NAME} ---`);

    if (!BRIGHTDATA_API_TOKEN) {
        console.error('ERROR: BRIGHTDATA_API_TOKEN is missing.');
        return;
    }

    try {
        // Try to update the 'perm' field to include 'post'
        // We'll try common formats: space separated or array if accepted
        console.log('Attempting to add "post" permission...');
        
   const res = await axios.post('https://api.brightdata.com/zone', {
            zone: {
                name: ZONE_NAME
            },
            perm: 'country post'
        }, {// Space separated is common in Bright Data API
        }, {
            headers: {
                'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('\nSUCCESS!');
        console.log('Status:', res.status);
        console.log('New Zone Config:', JSON.stringify(res.data, null, 2));

    } catch (error) {
        console.error('\nFAILED:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

updateZonePerms();
