const axios = require('axios');

async function run() {
    const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3001/webhook';
    const PAGE_ID = process.env.TEST_PAGE_ID || 'TEST_PAGE_ID';
    const SENDER_ID = process.env.TEST_SENDER_ID || 'TEST_SENDER_ID';

    const body = {
        object: 'page',
        entry: [
            {
                id: PAGE_ID,
                time: Date.now(),
                messaging: [
                    {
                        sender: { id: SENDER_ID },
                        recipient: { id: PAGE_ID },
                        timestamp: Date.now(),
                        message: {
                            mid: `mid.${Date.now()}`,
                            text: 'Hi'
                        }
                    }
                ]
            }
        ]
    };

    try {
        console.log(`[TestWebhook] POST ${WEBHOOK_URL}`);
        const res = await axios.post(WEBHOOK_URL, body, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log('[TestWebhook] Status:', res.status);
        console.log('[TestWebhook] Body:', res.data);
    } catch (err) {
        console.error('[TestWebhook] Error calling webhook:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Body:', err.response.data);
        }
    }
}

run();

