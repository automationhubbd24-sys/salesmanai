function getOfficialWebhookSubscriptionOptions() {
    const baseUrl = process.env.PUBLIC_BASE_URL
        || process.env.BACKEND_URL
        || 'https://webhook.salesmanchatbot.online';
    const callbackBaseUrl = String(baseUrl).replace(/\/+$/, '');
    const verifyToken = process.env.WHATSAPP_OFFICIAL_VERIFY_TOKEN
        || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        || process.env.FACEBOOK_VERIFY_TOKEN
        || process.env.WHATSAPP_VERIFY_TOKEN
        || process.env.VERIFY_TOKEN
        || '123456';

    const isPublicHttps = /^https:\/\//i.test(callbackBaseUrl);

    return {
        overrideCallbackUri: isPublicHttps ? `${callbackBaseUrl}/webhook/whatsapp` : null,
        verifyToken
    };
}

module.exports = {
    getOfficialWebhookSubscriptionOptions
};
