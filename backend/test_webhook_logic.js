
const webhookController = require('./src/controllers/webhookController');

// Mock Request and Response
const mockRes = {
    status: (code) => {
        console.log(`[Test] Response Status: ${code}`);
        return {
            send: (msg) => console.log(`[Test] Response Body: ${msg}`)
        };
    },
    sendStatus: (code) => {
        console.log(`[Test] Response Status: ${code}`);
    }
};

// Test 1: Verification
console.log('--- Test 1: Webhook Verification ---');
const reqVerify = {
    query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': '123456', // Default
        'hub.challenge': 'CHALLENGE_ACCEPTED'
    }
};
webhookController.verifyWebhook(reqVerify, mockRes);

// Test 2: Handle Message
console.log('\n--- Test 2: Handle POST Message ---');
const reqPost = {
    body: {
        object: 'page',
        entry: [{
            id: '123',
            messaging: [{
                sender: { id: 'user_123' },
                recipient: { id: 'page_123' },
                message: { text: 'Hello' }
            }]
        }]
    }
};
webhookController.handleWebhook(reqPost, mockRes);
