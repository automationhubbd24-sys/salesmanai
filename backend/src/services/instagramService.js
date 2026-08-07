const axios = require('axios');

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v25.0';
const RETRY_DELAYS = [500, 1000, 2000];

async function fetchLinkedInstagramAccounts(accessToken) {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
        params: {
            fields: 'id,name,access_token,instagram_business_account{id,username,name}',
            access_token: accessToken
        },
        timeout: 20000
    });

    return Array.isArray(response.data?.data) ? response.data.data : [];
}

async function verifyInstagramAccount(accountId, pageAccessToken) {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`, {
        params: { fields: 'id,username,name', access_token: pageAccessToken },
        timeout: 15000
    });

    if (String(response.data?.id) !== String(accountId)) {
        throw new Error('Instagram account ID does not match the access token');
    }

    return response.data;
}

async function subscribeLinkedPage(pageId, pageAccessToken) {
    const fields = ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_echoes'];
    try {
        await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/subscribed_apps`, null, {
            params: { access_token: pageAccessToken, subscribed_fields: fields.join(',') },
            timeout: 15000
        });
        return true;
    } catch (error) {
        console.warn(`[Instagram] Page subscription failed for ${pageId}:`, error.response?.data?.error?.message || error.message);
        return false;
    }
}

async function sendMessage(accountId, recipientId, text, accessToken) {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`;
    const payload = { recipient: { id: String(recipientId) }, message: { text: String(text) } };

    for (let attempt = 0; ; attempt += 1) {
        try {
            const response = await axios.post(url, payload, { params: { access_token: accessToken }, timeout: 20000 });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            if (!(status === 429 || status === 613 || status >= 500) || attempt >= RETRY_DELAYS.length) throw error;
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
        }
    }
}

async function sendImage(accountId, recipientId, imageUrl, accessToken) {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`;
    const payload = { recipient: { id: String(recipientId) }, message: { attachment: { type: 'image', payload: { url: imageUrl } } } };

    for (let attempt = 0; ; attempt += 1) {
        try {
            const response = await axios.post(url, payload, { params: { access_token: accessToken }, timeout: 20000 });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            if (!(status === 429 || status === 613 || status >= 500) || attempt >= RETRY_DELAYS.length) throw error;
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
        }
    }
}

module.exports = {
    fetchLinkedInstagramAccounts,
    verifyInstagramAccount,
    subscribeLinkedPage,
    sendMessage,
    sendImage
};
