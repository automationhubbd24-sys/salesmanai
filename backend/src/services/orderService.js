const dbService = require('./dbService');
const emailService = require('./emailService');
const pgClient = require('./pgClient');

const BUSINESS_TYPES = ['ecommerce', 'service', 'appointment'];
const REQUIRED_FIELDS_BY_TYPE = {
    ecommerce: ['product_name', 'quantity', 'customer_name', 'phone', 'address'],
    service: ['service_name', 'customer_name', 'phone'],
    appointment: ['appointment_type', 'appointment_date', 'appointment_time', 'customer_name', 'phone']
};
const CONFIRMABLE_FIELDS_BY_TYPE = {
    ecommerce: ['product_name', 'quantity', 'phone', 'address'],
    service: ['service_name', 'phone'],
    appointment: ['appointment_type', 'appointment_date', 'appointment_time', 'phone']
};
const VALID_LEAD_STATUSES = ['draft', 'confirmed'];

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

function normalizeTextValue(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (['null', 'undefined', 'pending', 'unknown', 'n/a'].includes(text.toLowerCase())) return null;
    return text;
}

function resolveBusinessType(value) {
    const type = normalizeTextValue(value)?.toLowerCase();
    return BUSINESS_TYPES.includes(type) ? type : 'ecommerce';
}

function cleanExtractedData(data = {}) {
    const fields = data.fields && typeof data.fields === 'object' ? data.fields : data;
    const phoneSource = fields.phone || fields.number || fields.mobile || fields.customer_phone;
    const phone = normalizeBdPhone(phoneSource);
    const quantity = normalizeTextValue(fields.quantity || fields.product_quantity);
    const emailSource = fields.email || fields.customer_email;
    const businessType = resolveBusinessType(fields.business_type || fields.order_type || fields.type);
    const serviceName = normalizeTextValue(fields.service_name || fields.service || fields.package_name || fields.product_name || fields.product || fields.item_name);
    const appointmentType = normalizeTextValue(fields.appointment_type || fields.booking_type || fields.service_name || fields.service || fields.product_name || fields.product);

    return {
        business_type: businessType,
        product_name: normalizeTextValue(fields.product_name || fields.product || fields.item_name),
        service_name: serviceName,
        service_package: normalizeTextValue(fields.service_package || fields.package || fields.plan || fields.package_name),
        service_details: normalizeTextValue(fields.service_details || fields.requirements || fields.details || fields.note || fields.notes),
        delivery_method: normalizeTextValue(fields.delivery_method || fields.delivery_channel || fields.method),
        appointment_type: appointmentType,
        appointment_date: normalizeTextValue(fields.appointment_date || fields.booking_date || fields.date),
        appointment_time: normalizeTextValue(fields.appointment_time || fields.booking_time || fields.time),
        appointment_notes: normalizeTextValue(fields.appointment_notes || fields.notes || fields.note),
        assigned_to: normalizeTextValue(fields.assigned_to || fields.doctor || fields.consultant),
        variant: normalizeTextValue(fields.variant || fields.color || fields.size),
        quantity: quantity || null,
        phone,
        address: normalizeTextValue(fields.address || fields.location || fields.customer_address),
        customer_name: normalizeTextValue(fields.customer_name || fields.name),
        customer_email: emailSource ? String(emailSource).toLowerCase().trim() : null,
        price: fields.price ? parsePrice(fields.price) : null,
        delivery_charge: fields.delivery_charge ? parsePrice(fields.delivery_charge) : null,
        product_id: normalizeTextValue(fields.product_id),
        sku_code: normalizeTextValue(fields.sku_code || fields.sku_id || fields.last_variant_key)
    };
}

function mergeOrderData(existing = {}, incoming = {}) {
    const merged = { ...(existing || {}) };
    for (const [key, value] of Object.entries(incoming || {})) {
        if (value !== undefined && value !== null && value !== '') merged[key] = value;
    }
    return merged;
}

function hasAnyOrderData(data = {}) {
    return [
        'product_name', 'service_name', 'service_package', 'service_details', 'delivery_method',
        'appointment_type', 'appointment_date', 'appointment_time', 'appointment_notes', 'assigned_to',
        'variant', 'quantity', 'phone', 'address', 'customer_name', 'customer_email', 'price', 'product_id', 'sku_code'
    ].some(key => data[key] !== undefined && data[key] !== null && data[key] !== '');
}

function hasDraftOrderData(data = {}) {
    return [
        'quantity', 'phone', 'address', 'customer_name', 'service_name', 'service_details',
        'appointment_type', 'appointment_date', 'appointment_time'
    ].some(key => data[key] !== undefined && data[key] !== null && data[key] !== '');
}

function detectOrderStart(rawText = '') {
    const text = normalizeBanglaDigits(String(rawText || '').toLowerCase());
    return /(অর্ডার|order|দেন|দিন|লাগবে|পাঠান|নিতে চাই|নিব|নেব|confirm|কনফার্ম)/i.test(text);
}

function isPureInfoQuery(rawText = '', data = {}) {
    if (hasDraftOrderData(data)) return false;
    const text = normalizeBanglaDigits(String(rawText || '').toLowerCase());
    const asksInfo = /(দাম|price|koto|কত|available|আছে|details|ডিটেইল|কালার|color|size|সাইজ|ছবি|photo|pic|ভিডিও|video)/i.test(text);
    return asksInfo && !detectOrderStart(text);
}

function detectConfirmation(rawText = '', intent = '') {
    const text = normalizeBanglaDigits(String(rawText || '').toLowerCase());
    if (['order_confirmed', 'confirmed_order', 'confirm_order'].includes(String(intent || '').toLowerCase())) return true;
    return /(confirm|confirmed|হ্যাঁ|হ্যা|ঠিক আছে|পাঠান|অর্ডার করেন|order koren|নেন)/i.test(text);
}

function detectSummaryShown(rawText = '') {
    const text = String(rawText || '').toLowerCase();
    const markers = ['summary', 'সামারি', 'অর্ডার:', 'আপনার অর্ডার', 'total', 'মোট', 'confirm'];
    return markers.some(marker => text.includes(marker));
}

function getRequiredFields(orderData = {}) {
    return REQUIRED_FIELDS_BY_TYPE[resolveBusinessType(orderData.business_type)] || REQUIRED_FIELDS_BY_TYPE.ecommerce;
}

function getConfirmableFields(orderData = {}) {
    return CONFIRMABLE_FIELDS_BY_TYPE[resolveBusinessType(orderData.business_type)] || CONFIRMABLE_FIELDS_BY_TYPE.ecommerce;
}

function getMissingFields(orderData = {}) {
    return getRequiredFields(orderData).filter(field => !normalizeTextValue(orderData[field]));
}

function getConfirmableMissingFields(orderData = {}) {
    return getConfirmableFields(orderData).filter(field => !normalizeTextValue(orderData[field]));
}

function buildOrderItems(orderData = {}) {
    const businessType = resolveBusinessType(orderData.business_type);
    return [{
        business_type: businessType,
        product_name: orderData.product_name || null,
        service_name: orderData.service_name || null,
        appointment_type: orderData.appointment_type || null,
        appointment_date: orderData.appointment_date || null,
        appointment_time: orderData.appointment_time || null,
        variant: orderData.variant || null,
        quantity: orderData.quantity || (businessType === 'ecommerce' ? '1' : null),
        price: orderData.price || null,
        sku_code: orderData.sku_code || null,
        product_id: orderData.product_id || null
    }].filter(item => item.product_name || item.service_name || item.appointment_type || item.product_id || item.variant || item.sku_code);
}

function buildNextPromptInstruction(missingFields = [], businessType = 'ecommerce') {
    const labels = {
        product_name: 'প্রোডাক্টের নাম',
        service_name: 'সার্ভিসের নাম',
        appointment_type: 'অ্যাপয়েন্টমেন্টের ধরন',
        appointment_date: 'তারিখ',
        appointment_time: 'সময়',
        quantity: 'পরিমাণ',
        customer_name: 'আপনার নাম',
        phone: 'ফোন নম্বর',
        address: 'ডেলিভারি লোকেশন'
    };
    const important = missingFields.filter(field => ['customer_name', 'phone', 'address', 'appointment_date', 'appointment_time'].includes(field));
    const fieldsToAsk = important.length > 0 ? important : missingFields.slice(0, 2);
    if (fieldsToAsk.length === 0) return null;
    const noun = businessType === 'appointment' ? 'বুকিংটি' : businessType === 'service' ? 'সার্ভিস রিকোয়েস্টটি' : 'অর্ডারটি';
    return `${noun} নিতে ${fieldsToAsk.map(field => labels[field] || field).join(', ')} দিন।`;
}

function determineSection({ intent, mergedData, rawText, previousState }) {
    const normalizedIntent = String(intent || '').toLowerCase();
    const missingFields = getMissingFields(mergedData);
    const confirmableMissingFields = getConfirmableMissingFields(mergedData);
    const requiredComplete = missingFields.length === 0;
    const confirmableComplete = confirmableMissingFields.length === 0;
    const orderStarted = normalizedIntent.includes('order') || hasDraftOrderData(mergedData) || detectOrderStart(rawText) || previousState?.section === 'draft';
    const customerConfirmed = detectConfirmation(rawText, intent);

    if (previousState?.section === 'confirmed') {
        return { section: 'confirmed', missingFields, requiredComplete, shouldSave: false };
    }

    if ((requiredComplete || (confirmableComplete && customerConfirmed)) && orderStarted) {
        return { section: 'confirmed', missingFields, requiredComplete, shouldSave: true };
    }

    if (orderStarted && hasAnyOrderData(mergedData)) {
        return { section: 'draft', missingFields, requiredComplete, shouldSave: false };
    }

    return { section: null, missingFields, requiredComplete, shouldSave: false };
}

async function ensureOrderStateTable() {
    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS conversation_order_states (
            id bigserial PRIMARY KEY,
            platform text NOT NULL,
            page_id text NOT NULL,
            sender_id text NOT NULL,
            section text NOT NULL DEFAULT 'draft',
            status text NOT NULL DEFAULT 'active',
            order_data jsonb NOT NULL DEFAULT '{}'::jsonb,
            items jsonb NOT NULL DEFAULT '[]'::jsonb,
            missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
            summary_shown boolean NOT NULL DEFAULT false,
            confirmed_order_id text,
            order_id text UNIQUE,
            last_message text,
            last_contact_at timestamptz NOT NULL DEFAULT NOW(),
            created_at timestamptz NOT NULL DEFAULT NOW(),
            updated_at timestamptz NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS conversation_order_states_active_idx
            ON conversation_order_states(platform, page_id, sender_id)
            WHERE status = 'active';
    `);
}

async function getActiveOrderState(platform, pageId, senderId) {
    await ensureOrderStateTable();
    const result = await pgClient.query(
        `SELECT * FROM conversation_order_states
         WHERE platform = $1 AND page_id = $2 AND sender_id = $3 AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
        [platform, String(pageId), String(senderId)]
    );
    return result.rows[0] || null;
}

async function upsertOrderState({ platform, pageId, senderId, section, orderData, items, missingFields, summaryShown, rawText, confirmedOrderId, orderId }) {
    await ensureOrderStateTable();
    const safeSection = VALID_LEAD_STATUSES.includes(section) ? section : 'draft';
    const result = await pgClient.query(
        `INSERT INTO conversation_order_states
            (platform, page_id, sender_id, section, order_data, items, missing_fields, summary_shown, last_message, confirmed_order_id, order_id, last_contact_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, NOW(), NOW())
         ON CONFLICT (platform, page_id, sender_id) WHERE status = 'active'
         DO UPDATE SET
            section = EXCLUDED.section,
            order_data = conversation_order_states.order_data || EXCLUDED.order_data,
            items = EXCLUDED.items,
            missing_fields = EXCLUDED.missing_fields,
            summary_shown = conversation_order_states.summary_shown OR EXCLUDED.summary_shown,
            last_message = EXCLUDED.last_message,
            confirmed_order_id = COALESCE(EXCLUDED.confirmed_order_id, conversation_order_states.confirmed_order_id),
            order_id = COALESCE(EXCLUDED.order_id, conversation_order_states.order_id),
            last_contact_at = NOW(),
            updated_at = NOW()
         RETURNING *`,
        [
            platform,
            String(pageId),
            String(senderId),
            safeSection,
            JSON.stringify(orderData || {}),
            JSON.stringify(items || []),
            JSON.stringify(missingFields || []),
            Boolean(summaryShown),
            String(rawText || '').slice(0, 2000),
            confirmedOrderId || null,
            orderId || null
        ]
    );
    return result.rows[0];
}

function buildLegacySavePayload({ pageId, senderId, platform, orderData }) {
    const businessType = resolveBusinessType(orderData.business_type);
    let resolvedProductName = orderData.product_name || orderData.service_name || orderData.appointment_type || 'Recovered Lead';
    const skuRef = orderData.sku_code || null;
    if (skuRef && !String(resolvedProductName).includes('[SKU:')) {
        resolvedProductName = `${resolvedProductName} [SKU:${skuRef}]`;
    }

    return {
        page_id: pageId,
        sender_id: senderId,
        platform,
        business_type: businessType,
        product_name: resolvedProductName,
        service_name: orderData.service_name || null,
        service_package: orderData.service_package || null,
        service_details: orderData.service_details || null,
        delivery_method: orderData.delivery_method || null,
        appointment_type: orderData.appointment_type || null,
        appointment_date: orderData.appointment_date || null,
        appointment_time: orderData.appointment_time || null,
        appointment_notes: orderData.appointment_notes || null,
        assigned_to: orderData.assigned_to || null,
        phone: orderData.phone || null,
        address: orderData.address || (businessType === 'ecommerce' ? 'Pending' : null),
        quantity: orderData.quantity || (businessType === 'ecommerce' ? '1' : null),
        price: orderData.price ? parsePrice(orderData.price) : null,
        customer_name: orderData.customer_name || 'Pending',
        customer_email: orderData.customer_email || null,
        sender_number: orderData.phone || null
    };
}

async function listOrderStates({ platform, pageId, section, from, to, limit = 200 }) {
    await ensureOrderStateTable();
    const values = [platform, String(pageId)];
    const conditions = ['platform = $1', 'page_id = $2', "status = 'active'"];
    let idx = 3;

    if (section && VALID_LEAD_STATUSES.includes(section)) {
        conditions.push(`section = $${idx}`);
        values.push(section);
        idx += 1;
    }
    if (Number.isFinite(from)) {
        conditions.push(`last_contact_at >= to_timestamp($${idx} / 1000.0)`);
        values.push(from);
        idx += 1;
    }
    if (Number.isFinite(to)) {
        conditions.push(`last_contact_at <= to_timestamp($${idx} / 1000.0)`);
        values.push(to);
        idx += 1;
    }

    values.push(Math.min(Number(limit) || 200, 500));
    const result = await pgClient.query(
        `SELECT id, platform, page_id, sender_id, section, order_data, items, missing_fields, summary_shown,
                confirmed_order_id, order_id, last_message, last_contact_at, created_at, updated_at
         FROM conversation_order_states
         WHERE ${conditions.join(' AND ')}
         ORDER BY last_contact_at DESC
         LIMIT $${idx}`,
        values
    );
    return result.rows;
}

async function saveConfirmedLegacyOrder({ pageId, senderId, platform, orderData }) {
    const savePayload = buildLegacySavePayload({ pageId, senderId, platform, orderData });
    const result = await dbService.saveOrder(savePayload);
    const isNewOrder = Boolean(result?.isNew);

    if (result) {
        try {
            const config = platform === 'whatsapp'
                ? await dbService.getWhatsAppConfig(pageId)
                : await dbService.getPageConfig(pageId);

            if (config && config.order_email_confirmation_enabled) {
                const emailOrderData = { ...savePayload, platform };

                if (isNewOrder && savePayload.customer_email) {
                    await emailService.sendOrderConfirmation(emailOrderData);
                }

                if (isNewOrder && config.admin_notification_email) {
                    await emailService.sendAdminOrderNotification(config.admin_notification_email, emailOrderData);
                }
            }
        } catch (emailErr) {
            console.warn('[Order Email] Failed to trigger notifications:', emailErr.message);
        }
    }

    return result;
}

/**
 * Fetches the most recent pending/incomplete order for a user to provide context to the AI.
 */
async function getPendingOrderContext(pageId, senderId, platform = 'messenger') {
    try {
        const state = await getActiveOrderState(platform, pageId, senderId);
        if (state) {
            return {
                exists: true,
                data: state.order_data || {},
                section: state.section,
                missingFields: state.missing_fields || [],
                isComplete: Array.isArray(state.missing_fields) && state.missing_fields.length === 0,
                summaryShown: Boolean(state.summary_shown)
            };
        }
        return null;
    } catch (err) {
        console.error(`[OrderEngine] Context Error:`, err.message);
        return null;
    }
}

/**
 * Orchestrates lead, draft and confirmed order transitions.
 */
async function orchestrateOrder(params) {
    const {
        pageId,
        senderId,
        platform,
        intent = 'upsert',
        data = {},
        rawText = ''
    } = params;

    console.log(`[OrderEngine] Orchestrating for ${platform}/${senderId}. Intent: ${intent}`);

    if (intent === 'status_check') {
        const extracted = cleanExtractedData(data);
        return { status: 'LOOKUP_REQUIRED', phone: extracted.phone };
    }

    const extracted = cleanExtractedData(data);
    const previousState = await getActiveOrderState(platform, pageId, senderId);
    const previousData = previousState?.order_data || {};

    if (!previousState && isPureInfoQuery(rawText, extracted)) {
        return { status: 'NO_ACTION', reason: 'PURE_INFO_QUERY' };
    }

    const hasOrderSignal = hasAnyOrderData(extracted) || previousState;

    if (!hasOrderSignal) {
        return { status: 'NO_ACTION', reason: 'NO_ORDER_SIGNAL' };
    }

    if ((!extracted.product_name || extracted.product_name === 'Recovered Lead') && extracted.product_id) {
        try {
            const product = await dbService.getProductById(extracted.product_id);
            if (product?.name) extracted.product_name = product.name;
        } catch (_) {}
    }

    const mergedData = mergeOrderData(previousData, extracted);
    const businessType = resolveBusinessType(mergedData.business_type);
    mergedData.business_type = businessType;
    const decision = determineSection({ intent, mergedData, rawText, previousState });
    if (!decision.section) {
        return { status: 'NO_ACTION', reason: 'NO_ORDER_START' };
    }
    const items = buildOrderItems(mergedData);
    const nextPromptInstruction = decision.section === 'draft'
        ? buildNextPromptInstruction(decision.missingFields, businessType)
        : null;

    let confirmedResult = null;
    let orderId = previousState?.order_id || null;

    if (decision.section === 'confirmed' && !previousState?.confirmed_order_id) {
        if (!orderId) orderId = `ORD-${Date.now()}-${String(senderId).slice(-4)}`;
        confirmedResult = await saveConfirmedLegacyOrder({ pageId, senderId, platform, orderData: mergedData });
    }

    const state = await upsertOrderState({
        platform,
        pageId,
        senderId,
        section: decision.section,
        orderData: mergedData,
        items,
        missingFields: decision.missingFields,
        summaryShown: false,
        rawText,
        confirmedOrderId: confirmedResult?.id ? String(confirmedResult.id) : null,
        orderId
    });

    return {
        status: 'SUCCESS',
        section: state.section,
        orderStateId: state.id,
        orderId: state.order_id,
        confirmedOrderId: state.confirmed_order_id,
        isNew: Boolean(confirmedResult?.isNew),
        missingFields: state.missing_fields,
        nextPromptInstruction,
        capturedFields: Object.keys(extracted).filter(k => extracted[k])
    };
}

module.exports = {
    orchestrateOrder,
    getPendingOrderContext,
    listOrderStates,
    normalizeBdPhone,
    normalizeBanglaDigits,
    getMissingFields
};
