
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_HOST = 'brd.superproxy.io';
const PROXY_PORT = '33335';
const USER = 'brd-customer-hl_c0e91071-zone-isp';
const PASS = 'ccc6mnaq09d7';

async function testProxyRotation() {
    console.log('--- Starting Proxy Rotation Test ---');
    
    for (let i = 1; i <= 3; i++) {
        // Generating a unique session ID for each request to force IP rotation
        const sessionId = `test_session_${Math.floor(Math.random() * 99999)}`;
        const proxyUrl = `http://${USER}-session-${sessionId}:${PASS}@${PROXY_HOST}:${PROXY_PORT}`;
        const agent = new HttpsProxyAgent(proxyUrl);
        
        console.log(`\n[Test #${i}] Requesting with Session: ${sessionId}`);
        
        try {
            const response = await axios.get('https://geo.brdtest.com/mygeo.json', {
                httpsAgent: agent,
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            console.log(`✅ Success!`);
            console.log(`   IP: ${response.data.ip}`);
            console.log(`   Country: ${response.data.country}`);
            console.log(`   City: ${response.data.city}`);
            console.log(`   ASN: ${response.data.asn?.name || 'N/A'}`);
            
        } catch (error) {
            console.error(`❌ Failed: ${error.message}`);
            if (error.response) {
                console.error(`   Status: ${error.response.status}`);
                console.error(`   Error Header: ${error.response.headers['x-brd-err-msg'] || 'N/A'}`);
            }
        }
    }
    
    console.log('\n--- Test Completed ---');
}

testProxyRotation();
