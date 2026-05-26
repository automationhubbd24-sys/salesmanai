const axios = require('axios');

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v22.0';

function getGraphUrl(pathname) {
    return `https://graph.facebook.com/${GRAPH_VERSION}${pathname}`;
}

/**
 * WhatsApp Cloud API Service
 */
class WhatsAppCloudService {
    async graphGet(pathname, accessToken, params = {}) {
        const response = await axios.get(getGraphUrl(pathname), {
            params,
            headers: accessToken ? {
                Authorization: `Bearer ${accessToken}`
            } : undefined
        });

        return response.data;
    }

    async graphPost(pathname, body = {}, accessToken) {
        const response = await axios.post(getGraphUrl(pathname), body, {
            headers: {
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    }

    /**
     * Exchange code from Embedded Signup for an Access Token
     * @param {string} code - The code received from frontend
     * @param {string} appId - Your Meta App ID
     * @param {string} appSecret - Your Meta App Secret
     */
    async getAccessTokenFromCode(code, appId, appSecret) {
        try {
            const response = await axios.get(getGraphUrl('/oauth/access_token'), {
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

    async getSharedWabaId(accessToken, appId, appSecret) {
        try {
            const appAccessToken = `${appId}|${appSecret}`;
            const response = await axios.get(getGraphUrl('/debug_token'), {
                params: {
                    input_token: accessToken,
                    access_token: appAccessToken
                }
            });

            const granularScopes = response.data?.data?.granular_scopes || [];
            const wabaScope = granularScopes.find((scope) =>
                (scope.scope === 'whatsapp_business_management' || scope.scope === 'whatsapp_business_messaging') &&
                Array.isArray(scope.target_ids) &&
                scope.target_ids.length > 0
            );

            return wabaScope?.target_ids?.[0] || null;
        } catch (error) {
            console.error('[WhatsApp Cloud] Shared WABA lookup error:', error.response?.data || error.message);
            return null;
        }
    }

    async getPhoneNumbersForWaba(wabaId, accessToken) {
        try {
            const response = await this.graphGet(`/${wabaId}/phone_numbers`, accessToken);
            return Array.isArray(response?.data) ? response.data : [];
        } catch (error) {
            console.error('[WhatsApp Cloud] Phone numbers lookup error:', error.response?.data || error.message);
            return [];
        }
    }

    async getPhoneNumberDetails(phoneNumberId, accessToken) {
        try {
            return await this.graphGet(`/${phoneNumberId}`, accessToken, {
                fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type'
            });
        } catch (error) {
            console.error('[WhatsApp Cloud] Phone number details error:', error.response?.data || error.message);
            return null;
        }
    }

    async getEmbeddedSignupDetails({ accessToken, appId, appSecret, wabaId, phoneNumberId }) {
        let resolvedWabaId = wabaId || null;
        let resolvedPhoneNumberId = phoneNumberId || null;
        let phoneNumberDetails = null;

        if (!resolvedWabaId && accessToken && appId && appSecret) {
            resolvedWabaId = await this.getSharedWabaId(accessToken, appId, appSecret);
        }

        if (resolvedWabaId && accessToken) {
            const phoneNumbers = await this.getPhoneNumbersForWaba(resolvedWabaId, accessToken);
            phoneNumberDetails = phoneNumbers.find((item) => String(item.id) === String(resolvedPhoneNumberId))
                || phoneNumbers[0]
                || null;

            if (!resolvedPhoneNumberId && phoneNumberDetails?.id) {
                resolvedPhoneNumberId = phoneNumberDetails.id;
            }
        }

        if (!phoneNumberDetails && resolvedPhoneNumberId && accessToken) {
            phoneNumberDetails = await this.getPhoneNumberDetails(resolvedPhoneNumberId, accessToken);
        }

        return {
            wabaId: resolvedWabaId || null,
            phoneNumberId: resolvedPhoneNumberId || null,
            displayPhoneNumber: phoneNumberDetails?.display_phone_number || null,
            verifiedName: phoneNumberDetails?.verified_name || null
        };
    }

    /**
     * Send a text message using Cloud API
     */
    async sendTextMessage(phoneNumberId, accessToken, recipientNumber, text) {
        try {
            const response = await this.graphPost(`/${phoneNumberId}/messages`, {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: recipientNumber,
                type: "text",
                text: { body: text }
            }, accessToken);
            return response;
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
            return await this.graphPost(`/${wabaId}/subscribed_apps`, {}, accessToken);
        } catch (error) {
            console.error('[WhatsApp Cloud] WABA Subscription Error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new WhatsAppCloudService();
