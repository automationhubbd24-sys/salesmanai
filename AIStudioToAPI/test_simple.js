const https = require('https');

const API_KEY = 'sk-fa8d1997a7838fdc6fdb1f51c763bd36ae0bbec5d153d527';
const BASE_URL = 'gemini.salesmanchatbot.online';
const BASE_PATH = '/v1/chat/completions';

function makeRequest(data) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        const options = {
            hostname: BASE_URL,
            port: 443,
            path: BASE_PATH,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const parsedBody = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedBody);
                    } else {
                        reject({ statusCode: res.statusCode, body: parsedBody });
                    }
                } catch (e) {
                    reject({ statusCode: res.statusCode, error: 'Failed to parse response body', rawBody: body });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

async function testSimple() {
    console.log('--- Testing Simple Request ---');
    const data = {
        model: 'gemini-2.5-flash',
        messages: [
            {
                role: 'user',
                content: 'Hello, who are you?'
            }
        ]
    };

    try {
        const result = await makeRequest(data);
        console.log('Response:', result.choices[0].message.content);
        return true;
    } catch (error) {
        console.error('Test Failed:', JSON.stringify(error, null, 2));
        return false;
    }
}

testSimple();
