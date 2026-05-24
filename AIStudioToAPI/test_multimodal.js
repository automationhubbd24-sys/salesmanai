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

async function testImage() {
    console.log('--- Testing Image ---');
    const data = {
        model: 'gemini-2.5-flash',
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What is in this image?' },
                    {
                        type: 'image_url',
                        image_url: {
                            url: 'https://raw.githubusercontent.com/google/generative-ai-docs/main/site/en/tutorials/assets/beagle.png'
                        }
                    }
                ]
            }
        ]
    };

    try {
        const result = await makeRequest(data);
        console.log('Image Response:', result.choices[0].message.content);
        return true;
    } catch (error) {
        console.error('Image Test Failed:', JSON.stringify(error, null, 2));
        return false;
    }
}

async function testAudio() {
    console.log('--- Testing Audio ---');
    const data = {
        model: 'gemini-2.5-flash',
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What is being said in this audio?' },
                    {
                        type: 'audio_url',
                        audio_url: {
                            url: 'https://storage.googleapis.com/generativeai-downloads/data/State_of_the_Union_Address_Excerpt.mp3'
                        }
                    }
                ]
            }
        ]
    };

    try {
        const result = await makeRequest(data);
        console.log('Audio Response:', result.choices[0].message.content);
        return true;
    } catch (error) {
        console.error('Audio Test Failed:', JSON.stringify(error, null, 2));
        return false;
    }
}

async function runTests() {
    const imageOk = await testImage();
    const audioOk = await testAudio();

    console.log('\n--- Summary ---');
    console.log(`Image Test: ${imageOk ? 'PASSED' : 'FAILED'}`);
    console.log(`Audio Test: ${audioOk ? 'PASSED' : 'FAILED'}`);
}

runTests();
