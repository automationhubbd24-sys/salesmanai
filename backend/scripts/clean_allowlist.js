
const axios = require('axios');

// CONFIG
const KEEP_IPS = ['203.190.8.241', '72.62.196.104'];
const ZONE_NAME = 'data_center';
const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;

async function cleanAllowlist() {
    console.log(`--- CLEANING IP ALLOWLIST ON BRIGHT DATA ---`);
    console.log(`Zone: ${ZONE_NAME}`);
    console.log(`Keeping IPs: ${KEEP_IPS.join(', ')}`);

    if (!BRIGHTDATA_API_TOKEN) {
        console.error('\nERROR: BRIGHTDATA_API_TOKEN environment variable is missing.');
        return;
    }

    try {
        // 1. Get Current Allowlist
        console.log('\n1. Fetching current allowlist...');
        const zoneInfo = await axios.get(
            `https://api.brightdata.com/zone?zone=${ZONE_NAME}`,
            {
                headers: { 'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}` }
            }
        );

        let currentIps = [];
        if (Array.isArray(zoneInfo.data)) {
             const zone = zoneInfo.data.find(z => z.name === ZONE_NAME);
             currentIps = zone ? zone.ips : [];
        } else if (zoneInfo.data && zoneInfo.data.ips) {
             currentIps = zoneInfo.data.ips;
        }

        if (!currentIps || currentIps.length === 0) {
            console.log('No IPs found.');
            return;
        }

        console.log(`Current IPs: ${JSON.stringify(currentIps)}`);

        // 2. Identify IPs to Remove
        const ipsToRemove = currentIps.filter(ip => !KEEP_IPS.includes(ip));

        if (ipsToRemove.length === 0) {
            console.log('\nNothing to remove. Allowlist is already clean.');
            return;
        }

        console.log(`\nRemoving IPs: ${ipsToRemove.join(', ')}`);

        // 3. Remove Each Unwanted IP
        for (const ip of ipsToRemove) {
            console.log(`Removing ${ip}...`);
            try {
                await axios.delete(
                    'https://api.brightdata.com/zone/whitelist',
                    {
                        data: { // DELETE body
                            zone: ZONE_NAME,
                            ip: ip
                        },
                        headers: {
                            'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                console.log(`Success: ${ip} removed.`);
            } catch (err) {
                console.error(`Failed to remove ${ip}:`, err.message);
            }
        }

        console.log('\nCLEANUP COMPLETE!');

    } catch (error) {
        console.error('\nFAILED:', error.message);
    }
}

cleanAllowlist();
