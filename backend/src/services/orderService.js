const dbService = require('./dbService');

/**
 * Normalizes a Bangladeshi phone number to 01XXXXXXXXX format.
 */
function normalizeBdPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.startsWith('88')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('+88')) cleaned = cleaned.substring(3);
    if (cleaned.length === 10 && cleaned.startsWith('1')) cleaned = '0' + cleaned;
    if (cleaned.length === 11 && cleaned.startsWith('01')) return cleaned;
    return null;
}

/**
 * Normalizes Bengali digits to English digits.
 */
function normalizeBanglaDigits(text) {
    if (!text) return '';
    const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return text.replace(/[০-৯]/g, d => banglaDigits.indexOf(d));
}

/**
 * Parses price from string/number.
 */
function parsePrice(value) {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    const cleanValue = String(value).replace(/[^\d.]/g, '');
    const num = parseFloat(cleanValue);
    return isFinite(num) ? num : 0;
}

/**
 * Fetches the most recent pending/incomplete order for a user to provide context to the AI.
 */
async function getPendingOrderContext(pageId, senderId) {
    try {
        const pgClient = require('./pgClient');
        // Look for the latest order for this sender on this page
        const result = await pgClient.query(
            "SELECT product_name, phone, address, customer_name, quantity, price, status FROM fb_order_list WHERE page_id = $1 AND sender_id = $2 ORDER BY created_at DESC LIMIT 1",
            [pageId, senderId]
        );

        if (result.rows.length === 0) return null;

        const order = result.rows[0];
        const missingFields = [];
        if (!order.phone || order.phone === 'null') missingFields.push('phone number');
        if (!order.address || order.address === 'Pending' || order.address === 'null') missingFields.push('delivery address');
        if (!order.customer_name || order.customer_name === 'Pending' || order.customer_name === 'Unknown') missingFields.push('customer name');
        if (!order.product_name || order.product_name === 'Unknown' || order.product_name === 'Recovered Lead') missingFields.push('product name');

        return {
            exists: true,
            data: order,
            missingFields: missingFields,
            isComplete: missingFields.length === 0
        };
    } catch (err) {
        console.error(`[OrderEngine] Context Error:`, err.message);
        return null;
    }
}

/**
 * Orchestrates order-related actions (creation, update, lookup).
 * This is the single source of truth for all order logic.
 */
async function orchestrateOrder(params) {
    const { 
        pageId, 
        senderId, 
        platform, 
        intent = 'upsert', // upsert, status_check, etc.
        data = {}, 
        rawText = '' 
    } = params;

    console.log(`[OrderEngine] Orchestrating for ${platform}/${senderId}. Intent: ${intent}`);

    // 1. DATA EXTRACTION (AI-Only Strategy)
    let extracted = { ...data };
    
    // Normalize Phone (if provided by AI)
    if (extracted.phone || extracted.number || extracted.mobile) {
        extracted.phone = normalizeBdPhone(extracted.phone || extracted.number || extracted.mobile);
    }

    // Handle Intent: Status Check
    if (intent === 'status_check') {
        // Logic for checking status could go here
        return { status: 'LOOKUP_REQUIRED', phone: extracted.phone };
    }

    // Handle Intent: Upsert (Create or Update)
    if (intent === 'upsert' || intent === 'order_create_or_update') {
        const hasPhone = extracted.phone && extracted.phone.length >= 8;
        const hasCriticalInfo = hasPhone || extracted.address || extracted.location || extracted.product_name || extracted.customer_name || extracted.name;
        
        if (!hasCriticalInfo) return { status: 'NO_ACTION' };

        // Persistence via dbService (which already handles the smart merge internally)
        // dbService now strictly enforces that a NEW order MUST have a phone number.
        const savePayload = {
            page_id: pageId,
            sender_id: senderId,
            platform: platform,
            product_name: extracted.product_name || 'Recovered Lead',
            phone: extracted.phone || null,
            address: extracted.address || extracted.location || 'Pending',
            quantity: extracted.quantity || '1',
            price: extracted.price ? parsePrice(extracted.price) : null,
            customer_name: extracted.customer_name || extracted.name || 'Pending'
        };

        try {
            const result = await dbService.saveOrder(savePayload);
            return { 
                status: 'SUCCESS', 
                orderId: result?.id, 
                isNew: result?.status !== 'updated',
                capturedFields: Object.keys(extracted).filter(k => extracted[k])
            };
        } catch (err) {
            console.error(`[OrderEngine] Failed to save order:`, err.message);
            return { status: 'ERROR', message: err.message };
        }
    }

    return { status: 'UNKNOWN_INTENT' };
}

module.exports = {
    orchestrateOrder,
    normalizeBdPhone,
    normalizeBanglaDigits
};
