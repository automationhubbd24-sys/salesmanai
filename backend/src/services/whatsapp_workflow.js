function normalizeWhatsAppMessages(messages) {
    return messages.map(msg => {
        if (typeof msg === 'string') {
            return { text: msg, images: [], audios: [], referral: null, id: null };
        }
        return {
            id: msg.id || null,
            text: msg.text || '',
            images: Array.isArray(msg.images) ? msg.images : [],
            audios: Array.isArray(msg.audios) ? msg.audios : [],
            referral: msg.referral || null
        };
    });
}

function buildWhatsAppAdContext(items) {
    let adContext = "";
    for (const item of items) {
        if (item.referral) {
            const headline = item.referral.headline || 'N/A';
            const body = item.referral.body || 'N/A';
            const sourceId = item.referral.source_id || 'N/A';
            adContext = `\n[System Note: User came from a WhatsApp AD. Headline: "${headline}", Body: "${body}", Ad ID: ${sourceId}. Use this context to understand what they are interested in.]`;
        }
    }
    return adContext;
}

function runWhatsAppWorkflow(messages) {
    const items = normalizeWhatsAppMessages(messages);
    let allImages = [];
    let allAudios = [];
    let adId = null;

    for (const item of items) {
        if (item.images.length > 0) allImages.push(...item.images);
        if (item.audios.length > 0) allAudios.push(...item.audios);
        if (item.referral && item.referral.source_id) adId = item.referral.source_id;
    }

    const textOutputs = items.map(i => String(i.text || '').trim()).filter(Boolean);
    const adContext = buildWhatsAppAdContext(items);
    
    let combinedText = textOutputs.join("\n").trim();
    if (adContext) combinedText = combinedText ? `${combinedText}${adContext}` : adContext.trim();

    return { combinedText, allImages, allAudios, adContext, adId };
}

module.exports = { runWhatsAppWorkflow };
