function normalizeMessages(messages) {
    return messages.map(msg => {
        if (typeof msg === 'string') {
            return { text: msg, images: [], audios: [], reply_to: null, isPostback: false, referral: null, id: null };
        }
        return {
            id: msg.id || null,
            text: msg.text || '',
            reply_to: msg.reply_to || null,
            images: Array.isArray(msg.images) ? msg.images : [],
            audios: Array.isArray(msg.audios) ? msg.audios : [],
            isPostback: !!msg.isPostback,
            referral: msg.referral || null
        };
    });
}

function buildAdContext(items) {
    let adContext = "";
    for (const item of items) {
        if (item.referral) {
            const ref = item.referral.ref || 'N/A';
            const source = item.referral.source || 'Ad';
            const adId = item.referral.ad_id || 'N/A';
            adContext = `\n[System Note: User clicked on an AD. Source: ${source}, Ref: "${ref}", Ad ID: ${adId}. Use this context to identify the product they are interested in.]`;
        }
    }
    return adContext;
}

function runMessengerWorkflow(messages) {
    const items = normalizeMessages(messages);
    let replyToId = null;
    let allImages = [];
    let allAudios = [];
    let hasPostback = false;

    const imageItems = [];
    const voiceItems = [];
    const textItems = [];
    const postbackItems = [];
    const emptyItems = [];

    for (const item of items) {
        if (item.reply_to && !replyToId) replyToId = item.reply_to;
        if (item.images.length > 0) allImages.push(...item.images);
        if (item.audios.length > 0) allAudios.push(...item.audios);
        if (item.isPostback) hasPostback = true;

        const hasImage = item.images.length > 0;
        const hasVoice = item.audios.length > 0;
        const hasText = item.text && String(item.text).trim() !== '';

        if (item.isPostback) postbackItems.push(item);
        else if (hasImage) imageItems.push(item);
        else if (hasVoice) voiceItems.push(item);
        else if (hasText) textItems.push(item);
        else emptyItems.push(item);
    }

    const textOutputs = [];
    textItems.forEach(i => { if (i.text) textOutputs.push(String(i.text)); });
    voiceItems.forEach(i => { if (i.text) textOutputs.push(String(i.text)); });
    imageItems.forEach(i => { if (i.text) textOutputs.push(String(i.text)); });
    postbackItems.forEach(i => { if (i.text) textOutputs.push(String(i.text)); });
    emptyItems.forEach(i => { if (i.text) textOutputs.push(String(i.text)); });

    const adContext = buildAdContext(items);
    let combinedText = textOutputs.join("\n").trim();
    if (adContext) combinedText = combinedText ? `${combinedText}${adContext}` : adContext.trim();

    return { combinedText, replyToId, allImages, allAudios, hasPostback, adContext };
}

module.exports = { runMessengerWorkflow };
