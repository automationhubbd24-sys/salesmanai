const axios = require('axios');

/**
 * WhatsApp Cloud API Service
 */
class WhatsAppCloudService {
    /**
     * Exchange code from Embedded Signup for an Access Token
     * @param {string} code - The code received from frontend
     * @param {string} appId - Your Meta App ID
     * @param {string} appSecret - Your Meta App Secret
     */
    async getAccessTokenFromCode(code, appId, appSecret) {
        try {
            const response = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token`, {
                params: {
                    client_id: appId,
                    client_secret: appSecret,
                    code: code
                }
            });
            return response.data.access_token;
        } catch (error) {
            console.error('[WhatsApp Cloud] Access Token Exchange Error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Send a text message using Cloud API
     */
    async sendTextMessage(phoneNumberId, accessToken, recipientNumber, text) {
        try {
            const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
            const response = await axios.post(url, {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: recipientNumber,
                type: "text",
                text: { body: text }
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error('[WhatsApp Cloud] Send Message Error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Subscribe app to WABA (Required to receive webhooks)
     */
    async subscribeAppToWaba(wabaId, accessToken) {
        try {
            const url = `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`;
            const response = await axios.post(url, {}, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            return response.data;
        } catch (error) {
            console.error('[WhatsApp Cloud] WABA Subscription Error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new WhatsAppCloudService();
