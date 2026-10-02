const axios = require('axios');
const FormData = require('form-data');

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v22.0';
const DEBUG_SERVER_URL = process.env.DEBUG_SERVER_URL || null;

async function reportMediaSendDebug(hypothesisId, location, msg, data = {}) {
    if (!DEBUG_SERVER_URL) return;

    try {
        await fetch(`${DEBUG_SERVER_URL.replace(/\/$/, '')}/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: 'whatsapp-media-send',
                runId: 'pre-fix',
                hypothesisId,
                location,
                msg,
                data
            })
        });
    } catch {
        // instrumentation only
    }
}

async function uploadMediaFromUrl(phoneNumberId, accessToken, mediaUrl) {
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data, 'binary');
    const extension = contentType.split('/')[1] || 'jpg';
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', buffer, { filename: `media.${extension === 'jpeg' ? 'jpg' : extension}`, contentType });

    const uploadResponse = await axios.post(getGraphUrl(`/${phoneNumberId}/media`), form, {
        headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${accessToken}`
        }
    });

    return uploadResponse.data?.id || null;
}

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

    async graphDelete(pathname, accessToken, params = {}) {
        const response = await axios.delete(getGraphUrl(pathname), {
            params,
            headers: accessToken ? {
                Authorization: `Bearer ${accessToken}`
            } : undefined
        });

        return response.data;
    }

    async sendStatusMessage(phoneNumberId, accessToken, body) {
        return await this.graphPost(`/${phoneNumberId}/messages`, {
            messaging_product: "whatsapp",
            ...body
        }, accessToken);
    }

    /**
     * Exchange code from Embedded Signup for an Access Token
     * @param {string} code - The code received from frontend
     * @param {string} appId - Your Meta App ID
     * @param {string} appSecret - Your Meta App Secret
     */
    async getAccessTokenFromCode(code, appId, appSecret, redirectUri) {
        try {
            const params = {
                client_id: appId,
                client_secret: appSecret,
                code: code
            };

            if (redirectUri) {
                params.redirect_uri = redirectUri;
            }

            const response = await axios.get(getGraphUrl('/oauth/access_token'), { params });
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

    async getMediaDetails(mediaId, accessToken) {
        try {
            return await this.graphGet(`/${mediaId}`, accessToken, {
                fields: 'id,mime_type,sha256,file_size,url'
            });
        } catch (error) {
            console.error('[WhatsApp Cloud] Media details error:', error.response?.data || error.message);
            return null;
        }
    }

    async getEmbeddedSignupDetails({ accessToken, appId, appSecret, wabaId, phoneNumberId }) {
        let resolvedWabaId = wabaId || null;
        let resolvedPhoneNumberId = phoneNumberId || null;
        let phoneNumberDetails = null;
        let phoneNumbers = [];

        if (!resolvedWabaId && accessToken && appId && appSecret) {
            resolvedWabaId = await this.getSharedWabaId(accessToken, appId, appSecret);
        }

        if (resolvedWabaId && accessToken) {
            phoneNumbers = await this.getPhoneNumbersForWaba(resolvedWabaId, accessToken);
            phoneNumberDetails = phoneNumbers.find((item) => String(item.id) === String(resolvedPhoneNumberId))
                || null;

            if (!resolvedPhoneNumberId && phoneNumbers.length === 1 && phoneNumbers[0]?.id) {
                phoneNumberDetails = phoneNumbers[0];
                resolvedPhoneNumberId = phoneNumbers[0].id;
            }
        }

        if (!phoneNumberDetails && resolvedPhoneNumberId && accessToken) {
            phoneNumberDetails = await this.getPhoneNumberDetails(resolvedPhoneNumberId, accessToken);
        }

        return {
            wabaId: resolvedWabaId || null,
            phoneNumberId: resolvedPhoneNumberId || null,
            displayPhoneNumber: phoneNumberDetails?.display_phone_number || null,
            verifiedName: phoneNumberDetails?.verified_name || null,
            phoneNumbers: phoneNumbers.map((item) => ({
                id: item?.id || null,
                displayPhoneNumber: item?.display_phone_number || null,
                verifiedName: item?.verified_name || null
            })).filter((item) => item.id)
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

    async sendSeen(phoneNumberId, accessToken, messageId) {
        try {
            if (!phoneNumberId || !accessToken || !messageId) return null;
            return await this.sendStatusMessage(phoneNumberId, accessToken, {
                status: "read",
                message_id: messageId
            });
        } catch (error) {
            console.error('[WhatsApp Cloud] Mark Read Error:', error.response?.data || error.message);
            throw error;
        }
    }

    async sendTyping(phoneNumberId, accessToken, messageId) {
        try {
            if (!phoneNumberId || !accessToken || !messageId) return null;
            return await this.sendStatusMessage(phoneNumberId, accessToken, {
                status: "read",
                message_id: messageId,
                typing_indicator: {
                    type: "text"
                }
            });
        } catch (error) {
            console.error('[WhatsApp Cloud] Typing Indicator Error:', error.response?.data || error.message);
            throw error;
        }
    }

    async sendImageMessage(phoneNumberId, accessToken, recipientNumber, imageUrl, caption) {
        await reportMediaSendDebug('A', 'whatsappCloudService.js:sendImageMessage:start', 'attempting image send', {
            phoneNumberId,
            recipientNumber,
            imageUrl,
            hasCaption: Boolean(caption)
        });

        try {
            const mediaId = await uploadMediaFromUrl(phoneNumberId, accessToken, imageUrl);
            if (!mediaId) throw new Error('WhatsApp media upload returned empty id');

            const body = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: recipientNumber,
                type: 'image',
                image: { id: mediaId }
            };
            if (caption) {
                body.image.caption = caption;
            }

            const response = await this.graphPost(`/${phoneNumberId}/messages`, body, accessToken);

            await reportMediaSendDebug('B', 'whatsappCloudService.js:sendImageMessage:media-success', 'image sent by uploaded media id', {
                recipientNumber,
                mediaId,
                hasProviderMessageId: Boolean(response?.messages?.[0]?.id)
            });

            return response;
        } catch (mediaError) {
            await reportMediaSendDebug('C', 'whatsappCloudService.js:sendImageMessage:media-failed', 'media upload path failed, trying link fallback', {
                status: mediaError?.response?.status || null,
                providerCode: mediaError?.response?.data?.error?.code || null,
                message: String(mediaError?.message || '').slice(0, 200),
                imageUrl
            });

            try {
                const image = { link: imageUrl };
                if (caption) {
                    image.caption = caption;
                }

                const response = await this.graphPost(`/${phoneNumberId}/messages`, {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: recipientNumber,
                    type: "image",
                    image
                }, accessToken);

                await reportMediaSendDebug('D', 'whatsappCloudService.js:sendImageMessage:link-success', 'image sent by link', {
                    recipientNumber,
                    hasProviderMessageId: Boolean(response?.messages?.[0]?.id)
                });

                return response;
            } catch (linkError) {
                await reportMediaSendDebug('E', 'whatsappCloudService.js:sendImageMessage:link-failed', 'image send failed on both media and link paths', {
                    status: linkError?.response?.status || null,
                    providerCode: linkError?.response?.data?.error?.code || null,
                    message: String(linkError?.message || '').slice(0, 200),
                    imageUrl
                });
                console.error('[WhatsApp Cloud] Send Image Error:', linkError.response?.data || linkError.message);
                throw linkError;
            }
        }
    }

    async sendVideoMessage(phoneNumberId, accessToken, recipientNumber, videoUrl, caption) {
        try {
            const video = { link: videoUrl };
            if (caption) {
                video.caption = caption;
            }

            const response = await this.graphPost(`/${phoneNumberId}/messages`, {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: recipientNumber,
                type: "video",
                video
            }, accessToken);
            return response;
        } catch (error) {
            console.error('[WhatsApp Cloud] Send Video Error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Subscribe app to WABA (Required to receive webhooks)
     */
    async subscribeAppToWaba(wabaId, accessToken, options = {}) {
        try {
            const body = {};

            if (options.overrideCallbackUri && options.verifyToken) {
                body.override_callback_uri = options.overrideCallbackUri;
                body.verify_token = options.verifyToken;
            }

            return await this.graphPost(`/${wabaId}/subscribed_apps`, body, accessToken);
        } catch (error) {
            const metaError = error.response?.data?.error;
            const metaMessage = String(metaError?.message || "").toLowerCase();

            // Meta can return an error when the app is already subscribed. Treat that as success.
            if (metaMessage.includes('already') && metaMessage.includes('subscribed')) {
                return { success: true, alreadySubscribed: true };
            }

            console.error('[WhatsApp Cloud] WABA Subscription Error:', error.response?.data || error.message);
            throw error;
        }
    }

    async unsubscribeAppFromWaba(wabaId, accessToken) {
        try {
            return await this.graphDelete(`/${wabaId}/subscribed_apps`, accessToken);
        } catch (error) {
            console.error('[WhatsApp Cloud] WABA Unsubscribe Error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new WhatsAppCloudService();
