const dbService = require('../services/dbService');
const orderService = require('../services/orderService');
const { query } = require('../services/pgClient');
const aiService = require('../services/aiService');
const facebookService = require('../services/facebookService');
const { runMessengerWorkflow } = require('../services/messenger_workflow');
const { runWhatsAppWorkflow } = require('../services/whatsapp_workflow');
const { buildResolvedProductMediaContext } = require('../utils/productMediaResolver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- GATEKEEPER CACHE (In-Memory) ---
// Purpose: Block unauthorized pages instantly to protect backend resources.
let allowedPagesCache = new Set();
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 Minutes

// --- WEBHOOK MONITOR CACHE (In-Memory) ---
// Purpose: Store last 50 webhook payloads for debugging (n8n like interface) without hitting DB
const recentWebhookLogs = [];
const MAX_WEBHOOK_LOGS = 50;

function addWebhookLog(payload) {
    // Extract Page ID or Phone ID to allow filtering
    let sourceId = 'unknown';
    if (payload.object === 'page' && payload.entry?.[0]?.id) {
        sourceId = String(payload.entry[0].id);
    } else if (payload.object === 'whatsapp_business_account' && payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id) {
        sourceId = String(payload.entry[0].changes[0].value.metadata.phone_number_id);
    } else if (payload.object === 'verification' && payload.query?.['hub.verify_token']) {
        sourceId = 'verification';
    }

    // Only store minimal required data to save RAM
    const logEntry = {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        timestamp: new Date().toISOString(),
        object: payload.object,
        sourceId, // Added for filtering
        entry_count: payload.entry ? payload.entry.length : 0,
        payload: payload
    };
    
    recentWebhookLogs.unshift(logEntry); // Add to beginning
    if (recentWebhookLogs.length > MAX_WEBHOOK_LOGS) {
        recentWebhookLogs.pop(); // Remove oldest
    }
}
// ------------------------------------------

async function refreshAllowedPages() {
    const now = Date.now();
    if (now - lastCacheUpdate < CACHE_TTL && allowedPagesCache.size > 0) return;

    // console.log("[Gatekeeper] Refreshing allowed pages cache...");
    const pages = await dbService.getAllActivePages();
    if (pages && pages.length > 0) {
        allowedPagesCache = new Set(pages);
        lastCacheUpdate = now;
        console.log(`[Gatekeeper] Cache updated. Allowed Pages: ${allowedPagesCache.size}`);
    }
}

// Initial Warmup
refreshAllowedPages();
setInterval(refreshAllowedPages, CACHE_TTL);
// ------------------------------------

// --- CONFIG & ECHO CACHE (In-Memory Optimization) ---
const configCache = new Map(); // Key: pageId, Value: { config, prompts, timestamp }
const recentBotReplies = new Map(); // Key: senderId, Value: Array of { text, timestamp }

// #region debug-point A:variant-media-reporter
function reportVariantDebug(hypothesisId, location, msg, data = {}) {
    try {
        const envPath = path.join(__dirname, '../../.dbg/variant-primary-image.env');
        let debugUrl = 'http://127.0.0.1:7777/event';
        let sessionId = 'variant-primary-image';
        try {
            const envContent = fs.readFileSync(envPath, 'utf8');
            debugUrl = envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || debugUrl;
            sessionId = envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || sessionId;
        } catch (_) {}
        fetch(debugUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                runId: 'pre-fix',
                hypothesisId,
                location,
                msg: `[DEBUG] ${msg}`,
                data,
                ts: Date.now()
            })
        }).catch(() => {});
    } catch (_) {}
}
// #endregion

function matchesCachedConfigKey(config, lookupKey) {
    if (!config || !lookupKey) return false;

    const normalizedKey = String(lookupKey);
    const candidateKeys = [
        config.page_id,
        config.session_name,
        config.waba_id,
        config.phone_number_id
    ].filter(Boolean).map(String);

    return candidateKeys.includes(normalizedKey) || candidateKeys.includes(`official_${normalizedKey}`);
}

// Helper to get cached page data (Fast Path with Strict Validation)
async function getCachedPageData(pageId) {
    if (!pageId) return { config: null, prompts: null };
    
    const now = Date.now();
    const cached = configCache.get(String(pageId));
    
    // Refresh cache ONLY if not exists or TTL expired (e.g. 10 minutes)
    // To prevent prompt leakage, we ensure the cached data strictly belongs to the requested pageId
    if (!cached || (now - cached.timestamp > 10 * 60 * 1000)) {
        try {
            // console.log(`[Cache Miss] Fetching fresh data for Page: ${pageId}`);
            const [messengerConfig, messengerPrompts, whatsappConfig] = await Promise.all([
                dbService.getPageConfig(pageId),
                dbService.getPagePrompts(pageId),
                dbService.getWhatsAppConfig(pageId)
            ]);

            const config = messengerConfig || whatsappConfig;
            const prompts = messengerPrompts || whatsappConfig;
            
            if (config) {
                // Ensure data belongs to THIS pageId before caching
                const validatedConfig = matchesCachedConfigKey(config, pageId) ? config : null;
                const validatedPrompts = prompts && matchesCachedConfigKey(prompts, pageId) ? prompts : prompts;

                if (validatedConfig) {
                    configCache.set(String(pageId), { 
                        config: validatedConfig, 
                        prompts: validatedPrompts, 
                        timestamp: now 
                    });
                    return { config: validatedConfig, prompts: validatedPrompts };
                }
            }
        } catch (e) {
            console.warn(`[Cache] Critical failure for ${pageId}:`, e.message);
        }
    }
    
    // Extra safety check on returned cached data
    if (cached && cached.config && !matchesCachedConfigKey(cached.config, pageId)) {
        console.error(`[Security Alert] Cache mismatch detected for ${pageId}! Purging invalid entry.`);
        configCache.delete(String(pageId));
        return { config: null, prompts: null };
    }

    if (cached) return cached;
    return { config: null, prompts: null };
}

// Helper to track bot replies for echo filtering
function trackBotReply(senderId, text) {
    const normalized = normalizeText(text);
    if (!normalized) return;
    
    const now = Date.now();
    let history = recentBotReplies.get(senderId) || [];
    // Keep only last 20 seconds of replies
    history = history.filter(r => now - r.timestamp < 20000);
    history.push({ text: normalized, timestamp: now });
    recentBotReplies.set(senderId, history);
}

async function hasRecentOutgoingFbMatch(pageId, recipientId, text, allowedReplyBy = ['bot', 'system'], windowMs = 120000) {
    const normalized = normalizeText(text);
    if (!pageId || !recipientId || !normalized) return false;

    try {
        const history = await dbService.getFbChatHistory(pageId, recipientId, 20);
        const now = Date.now();
        return history.some(msg => {
            if (!allowedReplyBy.includes(msg.reply_by)) return false;
            if (Math.abs(now - Number(msg.timestamp || 0)) > windowMs) return false;
            return normalizeText(msg.text || '') === normalized;
        });
    } catch (err) {
        console.warn(`[Echo Guard] Failed DB recent-outgoing check for ${pageId}_${recipientId}: ${err.message}`);
        return false;
    }
}

async function saveFbOutgoingLog({
    pageId,
    recipientId,
    messageId,
    text,
    status = 'sending',
    replyBy = 'bot',
    token = 0,
    aiModel = null
}) {
    if (!messageId || !text) return;

    await dbService.saveFbChat({
        page_id: pageId,
        sender_id: pageId,
        recipient_id: recipientId,
        message_id: messageId,
        text,
        timestamp: Date.now(),
        status,
        reply_by: replyBy,
        token,
        ai_model: aiModel
    });
}

// Helper to log to file (Async)
function logToFile(message) {
    const logPath = path.join(__dirname, '../../debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFile(logPath, `[${timestamp}] ${message}\n`, (err) => {
        if (err) console.error('Log Error:', err);
    });
}

// Helper to normalize text for comparison
const normalizeText = (text) => {
    // Remove all whitespace and special characters to ensure robust matching
    // Support Unicode (Bengali) by using unicode property escapes
    return (text || '').toLowerCase().replace(/[\s\p{P}]/gu, '');
};

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildResolvedProductContext(product, queryText = '', preferredSkuKey = null) {
    const resolved = buildResolvedProductMediaContext(product, {
        queryText,
        preferredSkuKey,
        normalizeImageUrl,
        resolveProductSkuSelection: dbService.resolveProductSkuSelection
    });
    const baseProduct = resolved.product || product;
    const selectedSku = resolved.selectedSku;
    const mediaImages = resolved.mediaImages;
    const mediaVideos = resolved.mediaVideos;

    let variantsText = '';
    if (selectedSku) {
        const skuPrice = parsePrice(selectedSku.price);
        if (selectedSku.bulk_price) {
            variantsText = ` | Exact SKU: ${selectedSku.name} (${selectedSku.sku_code || 'SKU'}) | Pricing Rule: ${selectedSku.bulk_price}`;
        } else {
            variantsText = ` | Exact SKU: ${selectedSku.name} (${selectedSku.sku_code || 'SKU'}) | Price: ${skuPrice > 0 ? `${skuPrice} ${selectedSku.currency || baseProduct.currency || 'BDT'}` : 'Ask for Price'}`;
        }
    } else if (resolved.missingAttributes.length > 0) {
        variantsText = ' | Need: ' + resolved.missingAttributes.map((item) => `${item.label} [${item.values.join(', ')}]`).join('; ');
    } else if (Array.isArray(baseProduct.variants) && baseProduct.variants.length > 0) {
        variantsText = ' | Variants: ' + baseProduct.variants.map((variant) => {
            const vPrice = parsePrice(variant.price);
            return `${variant.name || 'Option'}:${vPrice || parsePrice(baseProduct.price)}${variant.currency || baseProduct.currency || 'BDT'}`;
        }).join(', ');
    }

    // #region debug-point A:resolved-product-context
    reportVariantDebug('A', 'webhookController.js:buildResolvedProductContext', 'resolved product media context', {
        productId: baseProduct?.id || product?.id || null,
        preferredSkuKey: preferredSkuKey || null,
        selectedSkuKey: selectedSku?.key || null,
        selectedSkuName: selectedSku?.name || null,
        mediaImages,
        mediaVideos,
        variantCount: Array.isArray(baseProduct?.variants) ? baseProduct.variants.length : 0,
        skuMatrixCount: Array.isArray(baseProduct?.sku_matrix) ? baseProduct.sku_matrix.length : 0,
        missingAttributes: Array.isArray(resolved?.missingAttributes) ? resolved.missingAttributes.map((item) => item?.key || item?.label || null) : []
    });
    // #endregion

    return {
        product: baseProduct,
        selectedSku,
        variantsText,
        mediaImages: Array.from(new Set(mediaImages.filter(Boolean))),
        mediaVideos: Array.from(new Set(mediaVideos.filter(Boolean)))
    };
}

function extractImageUrlsFromText(text) {
    const urls = [];
    if (!text || typeof text !== 'string') return { cleanText: text || '', urls };
    const imageUrlRegex = /https?:\/\/[^\s,)]*?\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s,)]*)?/gi;
    const cleanText = text.replace(imageUrlRegex, match => {
        const cleaned = match.replace(/[,.]$/, '');
        urls.push(cleaned);
        return '';
    });
    return {
        cleanText: cleanText.trim(),
        urls
    };
}

function sanitizeReplyText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\[[A-Z0-9_]+:[\s\S]*?\]/g, '')
        .replace(/\[.*?\]\s*\(\s*https?:\/\/[^\s)]+\s*\)/gi, '')
        .replace(/\[\s*\/?[^\]]*\]/gi, '')
        .replace(/\(\s*\)/g, '')
        .trim();
}

function extractVisionProductNames(text) {
    const names = [];
    if (!text || typeof text !== 'string') return names;
    
    // 1. Look for numbered list items like: ১. **The Face Shop...**
    const listMatches = text.match(/(?:\d+|[০-৯])\.\s*\*\*([^*]+)\*\*/g) || [];
    for (const match of listMatches) {
        const name = match.replace(/(?:\d+|[০-৯])\.\s*\*\*/, '').replace(/\*\*/, '').trim();
        if (name && name.length > 2) names.push(name);
    }

    // 2. Fallback to PRODUCT: format
    if (names.length === 0) {
        const productLines = text.match(/PRODUCT:\s*([^\n]+)/gi) || [];
        for (const line of productLines) {
            const name = line.split(':').slice(1).join(':').trim();
            if (name && name.length > 2) names.push(name);
        }
    }

    if (names.length === 0) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (line.length < 4) continue;
            if (/price|৳|tk|bdt|\d{3,}/i.test(line)) continue;
            names.push(line);
            if (names.length >= 5) break;
        }
    }
    return Array.from(new Set(names));
}

function normalizeImageUrl(url) {
    if (!url || url === 'N/A') return null;
    if (url.startsWith('http')) return url;
    const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    return `${baseUrl.replace(/\/$/, '')}${cleanPath}`;
}

function pushUniqueMedia(target, media) {
    if (!Array.isArray(target) || !media || !media.url) return;
    const mediaUrl = String(media.url).trim();
    if (!mediaUrl) return;
    if (!target.some(item => (typeof item === 'string' ? item : item?.url) === mediaUrl)) {
        target.push({ ...media, url: mediaUrl });
    }
}

async function getAllowedResourceMediaMap(pageId) {
    const imageUrls = new Set();
    const videoUrls = new Set();

    if (!pageId) return { imageUrls, videoUrls };

    const products = await dbService.getResourceProductsWithMedia(pageId);
    for (const product of products) {
        const primaryImage = normalizeImageUrl(product.image_url);
        if (primaryImage) imageUrls.add(primaryImage);

        if (Array.isArray(product.additional_images)) {
            product.additional_images
                .map(normalizeImageUrl)
                .filter(Boolean)
                .forEach(url => imageUrls.add(url));
        } else if (typeof product.additional_images === 'string' && product.additional_images.trim()) {
            try {
                JSON.parse(product.additional_images)
                    .map(normalizeImageUrl)
                    .filter(Boolean)
                    .forEach(url => imageUrls.add(url));
            } catch (_) {
                product.additional_images
                    .split(',')
                    .map(item => normalizeImageUrl(item.trim()))
                    .filter(Boolean)
                    .forEach(url => imageUrls.add(url));
            }
        }

        const videoUrl = normalizeImageUrl(product.video_url);
        if (videoUrl) videoUrls.add(videoUrl);
    }

    return { imageUrls, videoUrls };
}

function filterQueuedMediaByAllowedUrls(queue, allowedUrls) {
    if (!Array.isArray(queue) || allowedUrls.size === 0) return [];
    return queue.filter(item => {
        const url = typeof item === 'string' ? item : item?.url;
        return !!url && allowedUrls.has(String(url).trim());
    });
}

function stripUnsupportedLinksFromText(text, allowedUrls) {
    if (!text || typeof text !== 'string') return '';

    const cleaned = text
        .replace(/https?:\/\/[^\s)]+/gi, (match) => {
            const trimmed = match.replace(/[.,!?]+$/, '');
            return allowedUrls.has(trimmed) ? match : '';
        })
        .replace(/(?:^|\n)\s*Link:\s*(?=\n|$)/gi, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return sanitizeReplyText(cleaned);
}

function hasQueuedMedia(aiResponse) {
    const imageCount = Array.isArray(aiResponse?.images) ? aiResponse.images.length : 0;
    const videoCount = Array.isArray(aiResponse?.videos) ? aiResponse.videos.length : 0;
    return imageCount > 0 || videoCount > 0;
}

function hasPhotoIntent(historyList) {
    if (!Array.isArray(historyList)) return false;
    return historyList.some(item => {
        let content = '';
        if (typeof item === 'string') content = item;
        else if (typeof item.content === 'string') content = item.content;
        else if (typeof item.text === 'string') content = item.text;
        else if (item.message && typeof item.message.content === 'string') content = item.message.content;
        else if (item.message && typeof item.message.text === 'string') content = item.message.text;
        return typeof content === 'string' && content.includes('[INTENT_DETECTED: USER_REQUESTED_PHOTO]');
    });
}

function getHistoryText(historyList) {
    if (!Array.isArray(historyList)) return '';
    return historyList
        .map(item => {
            let content = '';
            if (!item) return '';
            if (typeof item === 'string') content = item;
            else if (typeof item.content === 'string') content = item.content;
            else if (typeof item.text === 'string') content = item.text;
            else if (item.message && typeof item.message.content === 'string') content = item.message.content;
            else if (item.message && typeof item.message.text === 'string') content = item.message.text;
            if (!content) return '';
            if (content.includes('[SYSTEM MEMORY]') || content.includes('Link: http')) return '';
            return content
                .replace(/Image URL: https?:\/\/[^\s|]+/gi, '(Image)')
                .replace(/Desc: [\s\S]*?(?=\||\[End|$)/gi, '')
                .replace(/\[Instruction Products\]/gi, '')
                .trim();
        })
        .filter(Boolean)
        .join('\n');
}

async function buildImageHash(imageUrl) {
    const normalizedUrl = String(imageUrl || '').trim();
    if (!normalizedUrl) return null;

    try {
        const response = await fetch(normalizedUrl);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            return crypto.createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
        }
    } catch (error) {
        console.warn(`[Image Cache] Failed to hash image bytes, falling back to URL hash: ${error.message}`);
    }

    return crypto.createHash('sha256').update(normalizedUrl).digest('hex');
}

function normalizePublicMediaUrl(url) {
    if (!url || url === 'N/A') return 'N/A';
    const value = String(url).trim();
    if (!value) return 'N/A';
    if (value.startsWith('http')) return value;
    const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
    const cleanPath = value.startsWith('/') ? value : `/${value}`;
    return `${baseUrl.replace(/\/$/, '')}${cleanPath}`;
}

function safeJsonParse(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeFingerprintValue(value) {
    if (Array.isArray(value)) return value.map(normalizeFingerprintValue).flat().filter(Boolean);
    if (value && typeof value === 'object') return Object.values(value).map(normalizeFingerprintValue).flat().filter(Boolean);
    return String(value || '').toLowerCase().trim();
}

function extractFingerprintTerms(fingerprint) {
    const parsed = typeof fingerprint === 'string'
        ? safeJsonParse(fingerprint, fingerprint)
        : safeJsonParse(fingerprint, {});
    const normalizedValues = normalizeFingerprintValue(parsed);
    const values = Array.isArray(normalizedValues) ? normalizedValues : [normalizedValues];
    const terms = new Set();
    values.forEach((value) => {
        String(value || '')
            .split(/[^a-z0-9]+/i)
            .map(token => token.toLowerCase().trim())
            .filter(token => token.length > 2 && !['unknown', 'none', 'product', 'design', 'color', 'type', 'with', 'and', 'the'].includes(token))
            .forEach(token => terms.add(token));
    });
    return terms;
}

function extractStructuredVisualFingerprint(analysisText) {
    const text = String(analysisText || '');
    const getField = (label) => {
        const pattern = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Za-z /]+\\s*:|$)`, 'i');
        const match = text.match(pattern);
        return match ? match[1].trim().replace(/\s+/g, ' ') : '';
    };
    const splitList = (value) => String(value || '')
        .split(/[,;|\n]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 30);
    const getAnyField = (...labels) => labels.map(getField).find(Boolean) || '';

    return {
        product_type: getAnyField('Product Category', 'Product Type', 'Item Type'),
        structural_model: getAnyField('Structural Model', 'Shape / Structure', 'Form Factor'),
        material: splitList(getAnyField('Main Material', 'Material', 'Visible Material')),
        primary_color: getAnyField('Primary Color', 'Main Color'),
        accent_colors: splitList(getAnyField('Accent Colors', 'Secondary Colors')),
        pattern: splitList(getAnyField('Pattern / Print', 'Pattern', 'Print')),
        texture: getAnyField('Texture', 'Surface Texture'),
        construction: getAnyField('Construction', 'Build Type', 'Structure'),
        attachment_features: getAnyField('Attachment Features', 'Handle Type', 'Shoulder Strap', 'Strap Type', 'Connector Type'),
        visible_design_features: getAnyField('Visible Design Features', 'Front Design', 'Main Visible Design', 'Exterior Design'),
        unique_features: splitList(getAnyField('Unique Design Features', 'Unique Features', 'Distinctive Features')),
        distinguishing_characteristics: getAnyField('Distinguishing Characteristics', 'Variant Differentiators'),
        search_keywords: splitList(getAnyField('Search Keywords', 'Keywords')),
        stable_visual_fingerprint: splitList(getAnyField('Stable Visual Fingerprint', 'Visual Fingerprint'))
    };
}

function getFingerprintRerankScore(queryFingerprint, candidate) {
    const queryTerms = extractFingerprintTerms(queryFingerprint);
    const candidateFingerprint = candidate.visual_fingerprint || candidate.visualFingerprint || null;
    const candidateTerms = extractFingerprintTerms(candidateFingerprint);
    if (candidateTerms.size === 0) {
        extractFingerprintTerms(candidate.visual_tags || []).forEach(term => candidateTerms.add(term));
        extractFingerprintTerms(candidate.searchable_text || '').forEach(term => candidateTerms.add(term));
        extractFingerprintTerms(candidate.keywords || '').forEach(term => candidateTerms.add(term));
        extractFingerprintTerms(candidate.name || '').forEach(term => candidateTerms.add(term));
    }

    let hits = [];
    for (const term of queryTerms) {
        if (candidateTerms.has(term)) hits.push(term);
    }

    const importantFields = [
        ['product_type', 12], ['structural_model', 10], ['primary_color', 8], ['accent_colors', 6],
        ['material', 8], ['pattern', 6], ['texture', 6], ['construction', 6],
        ['attachment_features', 6], ['visible_design_features', 10], ['unique_features', 10],
        ['distinguishing_characteristics', 10], ['stable_visual_fingerprint', 12]
    ];
    let bonus = Math.min(20, hits.length * 1.2);
    const candidateText = [candidate.name, candidate.description, candidate.searchable_text, candidate.keywords, JSON.stringify(candidate.visual_tags || []), JSON.stringify(candidateFingerprint || {})].join(' ').toLowerCase();
    for (const [field, weight] of importantFields) {
        const value = queryFingerprint?.[field];
        const terms = [...extractFingerprintTerms(value)];
        if (terms.length && terms.some(term => candidateText.includes(term))) bonus += weight;
    }

    return { bonus: Number(Math.min(45, bonus).toFixed(2)), hits: hits.slice(0, 25) };
}

function clampMatchScore(value) {
    const score = Number(value || 0);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, Number(score.toFixed(1))));
}

function formatMatchSignals(product = {}) {
    const signals = [];
    if (product.match_source) signals.push(`source ${product.match_source}`);
    if (product.direct_image_score !== undefined) signals.push(`image ${clampMatchScore(product.direct_image_score)}%`);
    if (product.old_vector_score !== undefined) signals.push(`old ${clampMatchScore(product.old_vector_score)}%`);
    if (product.text_match_score !== undefined) signals.push(`text ${clampMatchScore(product.text_match_score)}%`);
    if (product.fingerprint_bonus !== undefined) signals.push(`fingerprint +${Number(product.fingerprint_bonus || 0).toFixed(1)}`);
    return signals.length ? ` [${signals.join(', ')}]` : '';
}

function toImageMatchSummary(product) {
    if (!product || !product.id) return null;
    const score = product.distance !== undefined && product.distance !== null
        ? clampMatchScore((1 - Number(product.distance)) * 100)
        : clampMatchScore(product.match_score || 0);
    return {
        product_id: String(product.id),
        name: product.name || null,
        price: product.price || null,
        currency: product.currency || 'BDT',
        description: product.description || null,
        image_url: normalizePublicMediaUrl(product.image_url),
        additional_images: Array.isArray(product.additional_images) ? product.additional_images.map(normalizePublicMediaUrl).filter(Boolean) : [],
        match_score: score,
        base_match_score: score,
        visual_fingerprint: safeJsonParse(product.visual_fingerprint, {}),
        visual_tags: product.visual_tags || [],
        searchable_text: product.searchable_text || '',
        keywords: product.keywords || ''
    };
}

function rerankMatchesWithFingerprint(matches, fingerprint) {
    return (matches || []).map(match => {
        const rerank = getFingerprintRerankScore(fingerprint, match);
        return {
            ...match,
            base_match_score: clampMatchScore(match.base_match_score ?? match.match_score ?? 0),
            fingerprint_bonus: rerank.bonus,
            fingerprint_hits: rerank.hits,
            match_score: clampMatchScore(Number(match.base_match_score ?? match.match_score ?? 0) + rerank.bonus)
        };
    }).sort((a, b) => Number(b.match_score || 0) - Number(a.match_score || 0));
}

function buildVisualMatchDecision(matches) {
    const top = matches?.[0] || null;
    if (!top) return { status: 'NO_MATCH', confidence: 'low', reason: 'no_candidate', options: [] };
    const second = matches[1] || null;
    const topScore = Number(top.match_score || 0);
    const secondScore = Number(second?.match_score || 0);
    const gap = second ? Number((topScore - secondScore).toFixed(1)) : 100;
    const options = matches.slice(0, 3).map(match => ({
        product_id: match.product_id,
        name: match.name,
        price: match.price,
        currency: match.currency || 'BDT',
        match_score: match.match_score,
        base_match_score: match.base_match_score ?? match.match_score,
        fingerprint_bonus: match.fingerprint_bonus || 0
    }));
    if (topScore < 80) return { status: 'NO_MATCH', confidence: 'low', reason: 'top_score_below_threshold', score_gap: gap, options };
    if (topScore < 85 && second && gap < 10) return { status: 'AMBIGUOUS_MATCH', confidence: 'medium', reason: 'moderate_score_with_close_candidates', score_gap: gap, options };
    if (second && gap < 3) return { status: 'AMBIGUOUS_MATCH', confidence: 'medium', reason: 'top_candidates_too_close', score_gap: gap, options };
    return { status: 'CONFIDENT_MATCH', confidence: topScore >= 85 ? 'high' : 'medium', reason: 'fingerprint_reranked_top_candidate', score_gap: gap, options };
}

async function analyzeAndMatchIncomingImage({ platform, pageId, senderId, imageUrl, imageIndex, batchId, pageConfig, prompt }) {
    const imageHash = await buildImageHash(imageUrl);
    const useIncomingImageCache = false;
    if (useIncomingImageCache) {
        const cached = await dbService.getIncomingImageAnalysis({ platform, pageId, senderId, imageUrl, imageHash });
        if (cached?.analysis_text) {
            const cachedMatches = Array.isArray(cached.matched_products) ? cached.matched_products : [];
            const cachedDecision = buildVisualMatchDecision(cachedMatches);
            return {
                imageIndex,
                imageUrl,
                imageHash,
                analysisText: cached.analysis_text,
                matchedProducts: cachedMatches,
                topMatch: cachedDecision.status === 'CONFIDENT_MATCH' ? (cachedMatches[0] || null) : null,
                matchDecision: cachedDecision,
                matchScore: cached.match_score === null || cached.match_score === undefined ? null : Number(cached.match_score),
                visualFingerprint: safeJsonParse(cached.visual_fingerprint, {}),
                usage: 0,
                model: 'image-analysis-cache',
                fromCache: true
            };
        }
    }

    const visionResult = await aiService.processImageWithVision(imageUrl, pageConfig, { prompt: prompt || '' });
    const analysisText = typeof visionResult === 'object' ? String(visionResult.text || '').trim() : String(visionResult || '').trim();
    const usage = typeof visionResult === 'object' ? (visionResult.usage || 0) : 0;
    const model = typeof visionResult === 'object' ? (visionResult.model || 'unknown') : 'unknown';

    const visualFingerprint = {};
    let matchedProducts = [];
    let matchDecision = { status: 'EVIDENCE_ONLY', confidence: 'informational', reason: 'main_llm_decides', options: [] };
    if (analysisText && !analysisText.startsWith('[Vision Analysis Failed]')) {
        try {
            const directImageVector = await aiService.getDirectImageEmbedding(imageUrl, { log: false });
            const directImageMatches = directImageVector
                ? await dbService.searchProductByDirectImageVector(directImageVector, pageId)
                : [];

            matchedProducts = directImageMatches
                .map((product) => {
                    const summary = toImageMatchSummary(product);
                    if (!summary) return null;
                    summary.match_source = 'direct_image_embedding';
                    summary.direct_image_score = summary.match_score;
                    return summary;
                })
                .filter(Boolean)
                .sort((a, b) => Number(b.direct_image_score || 0) - Number(a.direct_image_score || 0))
                .slice(0, 5);

            matchDecision.options = matchedProducts;
        } catch (matchErr) {
            console.warn(`[${platform}] Direct image embedding evidence failed: ${matchErr.message}`);
        }
    }

    const topMatch = matchedProducts[0] || null;
    await dbService.upsertIncomingImageAnalysis({
        platform,
        page_id: pageId,
        sender_id: senderId,
        image_url: imageUrl,
        image_hash: imageHash,
        image_index: imageIndex,
        batch_id: batchId,
        analysis_text: analysisText,
        matched_product_id: topMatch?.product_id || null,
        match_score: topMatch?.match_score ?? null,
        matched_products: matchedProducts,
        visual_fingerprint: visualFingerprint
    });

    return {
        imageIndex,
        imageUrl,
        imageHash,
        analysisText,
        visualFingerprint,
        matchDecision,
        matchedProducts,
        topMatch,
        matchScore: topMatch?.match_score ?? null,
        usage,
        model,
        fromCache: false
    };
}

function formatImageAnalysisBlock(result) {
    const label = `IMAGE ${result.imageIndex}`;
    const candidates = result.matchedProducts || [];
    const options = candidates.map((product, idx) => {
        const additionalImages = Array.isArray(product.additional_images) ? product.additional_images.join(', ') : 'None';
        return `${idx + 1}. ${product.name || 'Unknown'} - ${product.price || 'Ask'} ${product.currency || 'BDT'} | Direct Image Embedding Score: ${clampMatchScore(product.direct_image_score ?? product.match_score)}% | Product ID: ${product.product_id} | Primary Image: ${product.image_url || 'N/A'} | Additional Images: ${additionalImages}`;
    }).join('\n') || 'None';
    return `[${label} ANALYSIS RESULT]\nOriginal Image URL: ${result.imageUrl}\nImage Analyzer Text:\n${result.analysisText || 'N/A'}\n\nDirect Image Embedding Evidence (retrieval only, main LLM must decide exact/similar/no-match using business rules):\n${options}`;
}

function buildLastImageMap(results) {
    return results.reduce((map, result) => {
        const options = result.matchDecision?.options || [];
        const primary = result.topMatch || options[0] || null;
        if (primary || options.length > 0) {
            map[String(result.imageIndex)] = {
                product_id: primary?.product_id || null,
                name: primary?.name || null,
                price: primary?.price || null,
                currency: primary?.currency || 'BDT',
                match_score: primary?.match_score || null,
                match_decision: result.matchDecision?.status || 'UNKNOWN',
                candidate_options: options,
                image_url: result.imageUrl
            };
        }
        return map;
    }, {});
}

function normalizePhotoDecision(photoDecision) {
    if (!photoDecision || typeof photoDecision !== 'object') return null;
    return {
        clarification_needed: photoDecision.clarification_needed === true,
        requested_scope: photoDecision.requested_scope === 'all' ? 'all' : 'focused',
        target_product_id: photoDecision.target_product_id != null
            ? String(photoDecision.target_product_id).trim() || null
            : null,
        clarification_text: typeof photoDecision.clarification_text === 'string'
            ? photoDecision.clarification_text.trim()
            : ''
    };
}

function normalizeAiDeliveryItems(aiResponse, fallbackReplyText = '') {
    const rawItems = Array.isArray(aiResponse?.items) ? aiResponse.items : [];
    const normalizeItem = (item) => {
        if (!item || typeof item !== 'object') return null;
        const replyText = typeof item.reply_text === 'string'
            ? item.reply_text.trim()
            : (typeof item.reply === 'string' ? item.reply.trim() : '');
        const productId = item.product_id != null ? (String(item.product_id).trim() || null) : null;
        const imageUrls = Array.isArray(item.image_urls)
            ? item.image_urls.map((url) => String(url || '').trim()).filter(Boolean)
            : [];
        const videoUrls = Array.isArray(item.video_urls)
            ? item.video_urls.map((url) => String(url || '').trim()).filter(Boolean)
            : [];
        const action = typeof item.action === 'string' && item.action.trim() ? item.action.trim() : 'NONE';
        const photoDecision = normalizePhotoDecision(item.photo_decision || null);

        if (!replyText && !productId && imageUrls.length === 0 && videoUrls.length === 0) {
            return null;
        }

        return {
            reply_text: replyText,
            product_id: productId,
            image_urls: imageUrls,
            video_urls: videoUrls,
            action,
            photo_decision: photoDecision
        };
    };

    const items = rawItems.map(normalizeItem).filter(Boolean);
    if (items.length > 0) return items;

    const fallbackItem = normalizeItem({
        reply_text: fallbackReplyText,
        product_id: aiResponse?.product_id || null,
        image_urls: aiResponse?.image_urls || [],
        video_urls: aiResponse?.video_urls || [],
        action: aiResponse?.action || 'NONE',
        photo_decision: aiResponse?.photo_decision || null
    });

    return fallbackItem ? [fallbackItem] : [];
}

function shouldBlockOutgoingReply(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return true; // Silence if empty

    // 1. Check for remaining Structural Symbols (e.g. [ , ] , { , } , http)
    // If the Logic-Based Sanitizer didn't catch these, it means the message is messy.
    // Professional messages should be pure text, emojis, and common punctuation.
    const hasBrackets = trimmed.includes('[') || trimmed.includes(']');
    const hasBraces = trimmed.includes('{') || trimmed.includes('}');
    const hasBackslashes = trimmed.includes('\\');

    if (hasBrackets || hasBraces || hasBackslashes) {
        console.warn(`[Quality Control] Blocked unprofessional message: "${trimmed.substring(0, 50)}..."`);
        return true; // BLOCK it. Better silence than garbage.
    }

    // 2. Original JSON check
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return true;
        } catch (e) {}
    }
    
    return false;
}

function extractProductNamesFromPrompt(promptText) {
    if (!promptText || typeof promptText !== 'string') return [];
    const regex = /##PRODUCT\s+"([^"]+)"/gi;
    const set = new Set();
    let match;
    while ((match = regex.exec(promptText)) !== null) {
        let name = match[1].trim();
        name = name.replace(/^\*+/, '').replace(/\*+$/, '').trim();
        if (name) set.add(name.toLowerCase());
    }
    return Array.from(set);
}

function detectImageMode(promptText) {
    const text = String(promptText || '');
    const tagMatch = text.match(/\[(?:IMAGE_MODE|MODE):\s*(image_only|image_title|title_desc|full_product)\s*\]/i);
    if (tagMatch) return tagMatch[1].toLowerCase();
    if (/(image\s*only|only\s*image|only\s*picture|only\s*photo|শুধু\s*(ইমেজ|ছবি|সবি)|sudu\s*sobi)/i.test(text)) return 'image_only';
    if (/(image\s*(and|&)\s*title|title\s*(and|&)\s*image|ছবি\s*.*টাইটেল|ইমেজ\s*.*টাইটেল)/i.test(text)) return 'image_title';
    if (/(title\s*(and|&)\s*description|description\s*(and|&)\s*title|টাইটেল\s*.*ডেসক্রিপশন|টাইটেল\s*.*বর্ণনা)/i.test(text)) return 'title_desc';
    if (/(full\s*product|title\s*description\s*price|সব\s*দাও|সব\s*দেবে|সম্পূর্ণ)/i.test(text)) return 'full_product';
    return null;
}

function extractDecisionMode(text) {
    if (!text || typeof text !== 'string') return { mode: null, cleaned: text };
    const match = text.match(/\[(?:IMAGE_DECISION|DECISION_MODE):\s*(image_only|image_title|title_desc|full_product)\s*\]/i);
    if (!match) return { mode: null, cleaned: text };
    const mode = match[1].toLowerCase();
    const cleaned = text.replace(match[0], '').trim();
    return { mode, cleaned };
}

const debounceMap = new Map();
const waDebounceMap = new Map();
const DEBOUNCE_MS = 2500;
const pageQueueMap = new Map();
const MAX_CONCURRENT_PER_PAGE = 5;
const AI_REQUEST_BUDGET_MS = process.env.AI_REQUEST_BUDGET_MS ? parseInt(process.env.AI_REQUEST_BUDGET_MS) : 180000;

function schedulePageTask(pageId, task) {
    const key = String(pageId);
    let state = pageQueueMap.get(key);
    if (!state) {
        state = { active: 0, queue: [] };
        pageQueueMap.set(key, state);
    }
    const run = async () => {
        let watchdog = null;
        try {
            watchdog = setTimeout(() => {
                console.error(`[BurstQueue] Task warning (Page ${pageId}): Task running longer than ${AI_REQUEST_BUDGET_MS}ms`);
            }, AI_REQUEST_BUDGET_MS);
            await task();
        } catch (e) {
            console.error(`[BurstQueue] Task error (Page ${pageId}):`, e.message || e);
        } finally {
            if (watchdog) clearTimeout(watchdog);
            state.active -= 1;
            if (state.queue.length > 0) {
                const next = state.queue.shift();
                state.active += 1;
                next();
            }
        }
    };
    if (state.active < MAX_CONCURRENT_PER_PAGE) {
        state.active += 1;
        run();
    } else {
        state.queue.push(run);
    }
}

function parsePrice(value) {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    // Remove currency symbols, commas, and other non-numeric chars except dot
    const cleanValue = String(value).replace(/[^\d.]/g, '');
    const num = parseFloat(cleanValue);
    return isFinite(num) ? num : 0;
}

const whatsappCloudService = require('../services/whatsappCloudService');

// Step 1: Webhook Trigger
const handleWebhook = async (req, res) => {
    const body = req.body;
    console.log(`[Webhook] Incoming POST Request. Object: ${body.object}`); 
    // console.log('Webhook Body Received:', JSON.stringify(body, null, 2)); // Too verbose for production

    // Log incoming payload to monitor cache (In-Memory)
    addWebhookLog(body);

    if (body.object === 'whatsapp_business_account') {
        return handleWhatsAppWebhook(req, res);
    }

    if (body.object === 'page') {
        // --- REALTIME OPTIMIZATION: Respond Immediately ---
        // Facebook requires a 200 OK within a few seconds.
        // We send it NOW, before any heavy lifting (DB, Gatekeeper, AI).
        res.status(200).send('EVENT_RECEIVED');

        // Execute processing in background (Fire & Forget)
        (async () => {
            try {
                // --- GATEKEEPER CHECK (Fail Fast) ---
                if (allowedPagesCache.size === 0) await refreshAllowedPages();
                
                // Async Processing
                for (const entry of body.entry) {
                    const pageId = entry.id; // Correct way to get pageId for THIS entry
                    if (!pageId) {
                        console.warn(`[Webhook] Missing Page ID in entry.`);
                        continue;
                    }

                    // Log identifying page
                    console.log(`[Webhook] Processing event for Page: ${pageId}`);
                    if (!allowedPagesCache.has(pageId)) {
                        // Double check DB before hard blocking (in case of new signup not in cache yet)
                        const isActuallyActive = await dbService.getPageConfig(pageId);
                        
                        if (isActuallyActive) {
                            const hasUserLink = isActuallyActive.user_id !== null && isActuallyActive.user_id !== undefined;
                            const hasLegacy = Number(isActuallyActive.message_credit || 0) > 0;
                            const hasPermanent = Number(isActuallyActive.permanent_credit || 0) > 0;
                            const hasBonus = Number(isActuallyActive.bonus_credit || 0) > 0;
                            const hasDailyCredit = Number(isActuallyActive.daily_limit || 0) > Number(isActuallyActive.daily_used || 0);
                            const hasMonthlyCredit = Number(isActuallyActive.monthly_limit || 0) > Number(isActuallyActive.monthly_used || 0);
                            const hasCredit = (hasLegacy || hasPermanent || hasBonus || hasDailyCredit || hasMonthlyCredit);

                            const hasOwnKey = (isActuallyActive.api_key && isActuallyActive.api_key.length > 5 && isActuallyActive.cheap_engine === false);
                            const isBanned = isActuallyActive.subscription_status === 'banned';
        
                            // SECURITY: Hard block if cheap engine is active but no user link (orphan page)
                            if (isActuallyActive.cheap_engine !== false && !hasUserLink) {
                                console.error(`[Gatekeeper] SECURITY ALERT: Page ${pageId} has no user_id link. Blocking to prevent free usage.`);
                                continue;
                            }

                            if (!isBanned && (hasCredit || hasOwnKey || hasMonthlyCredit)) {
                                allowedPagesCache.add(pageId); 
                            } else {
                                console.warn(`[Gatekeeper] BLOCKED unauthorized event for Page ID: ${pageId}. Status: ${isActuallyActive.subscription_status}, Credits: L:${Number(isActuallyActive.message_credit || 0)} D:${Number(isActuallyActive.daily_limit || 0)}-${Number(isActuallyActive.daily_used || 0)} M:${Number(isActuallyActive.monthly_limit || 0)}-${Number(isActuallyActive.monthly_used || 0)} B:${Number(isActuallyActive.bonus_credit || 0)} P:${Number(isActuallyActive.permanent_credit || 0)}, OwnAPI: ${hasOwnKey}, Linked: ${hasUserLink}`);
                                continue; // Skip THIS entry
                            }
                        } else {
                            // Page not found in DB
                            continue; // Skip THIS entry
                        }
                    }

                    // 1. Handle Messaging Events (Direct Messages - Primary Receiver)
                    if (entry.messaging) {
                        for (const webhookEvent of entry.messaging) {
                            if (webhookEvent) {
                                await queueMessage(webhookEvent, pageId);
                            }
                        }
                    }

                    // 1.5 Handle Standby Events (Direct Messages - Secondary Receiver / Handover Protocol)
                    if (entry.standby) {
                        for (const webhookEvent of entry.standby) {
                            if (webhookEvent) {
                                // Process standby messages exactly like normal messages
                                // This is crucial for pages where Meta Business Suite or another app is the Primary Receiver
                                await queueMessage(webhookEvent, pageId);
                            }
                        }
                    }
                    
                    // 2. Handle Changes Events (Comments / Feed)
                    if (entry.changes) {
                        for (const change of entry.changes) {
                            if (change.field === 'feed') {
                                await processCommentEvent(change.value, pageId);
                            }
                        }
                    }
                }
            } catch (bgError) {
                console.error("[Webhook] Background Processing Error:", bgError);
            }
        })();

    } else {
        res.sendStatus(404);
    }
};

const verifyWebhook = (req, res) => {
    const verifyTokens = new Set([
        process.env.FACEBOOK_VERIFY_TOKEN,
        process.env.WHATSAPP_OFFICIAL_VERIFY_TOKEN,
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        process.env.VERIFY_TOKEN,
        '123456',
        'salesman_monster_wa_2026_official'
    ].filter(Boolean));
    console.log(`[Webhook] Verification Request: Mode=${req.query['hub.mode']}, Token=${req.query['hub.verify_token']}`);

    // Log verification requests to monitor cache
    addWebhookLog({
        object: 'verification',
        entry: [],
        type: 'GET',
        query: req.query,
        timestamp: new Date().toISOString()
    });

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && verifyTokens.has(token)) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.error('WEBHOOK_VERIFICATION_FAILED');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

// WhatsApp Webhook Verification (GET)
const verifyWhatsAppWebhook = (req, res) => {
    const OFFICIAL_WA_TOKEN =
        process.env.WHATSAPP_OFFICIAL_VERIFY_TOKEN ||
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
        process.env.FACEBOOK_VERIFY_TOKEN ||
        process.env.VERIFY_TOKEN ||
        'salesman_monster_wa_2026_official';
    
    console.log(`[WhatsApp Webhook Verification] Mode: ${req.query['hub.mode']}, Token: ${req.query['hub.verify_token']}`);

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === OFFICIAL_WA_TOKEN) {
            console.log('WHATSAPP_WEBHOOK_VERIFIED ✅');
            return res.status(200).send(challenge);
        } else {
            console.error('WHATSAPP_WEBHOOK_VERIFICATION_FAILED ❌');
            return res.sendStatus(403);
        }
    }
    res.sendStatus(400);
};

function extractOfficialMessageText(message) {
    if (!message || typeof message !== 'object') return '';

    const parts = [];

    if (message.text?.body) {
        parts.push(String(message.text.body).trim());
    }

    if (message.button?.text) {
        parts.push(String(message.button.text).trim());
    } else if (message.button?.payload) {
        parts.push(String(message.button.payload).trim());
    }

    if (message.interactive?.button_reply) {
        const buttonReply = message.interactive.button_reply;
        parts.push(String(buttonReply.title || buttonReply.id || '').trim());
    }

    if (message.interactive?.list_reply) {
        const listReply = message.interactive.list_reply;
        const listText = [
            listReply.title,
            listReply.description,
            listReply.id
        ].filter(Boolean).join(' | ').trim();

        if (listText) {
            parts.push(listText);
        }
    }

    if (message.image?.caption) {
        parts.push(String(message.image.caption).trim());
    }

    if (message.document?.caption) {
        parts.push(String(message.document.caption).trim());
    }

    if (message.video?.caption) {
        parts.push(String(message.video.caption).trim());
    }

    if (message.location) {
        const locationBits = [
            message.location.name,
            message.location.address,
            (message.location.latitude && message.location.longitude)
                ? `${message.location.latitude}, ${message.location.longitude}`
                : null
        ].filter(Boolean);

        if (locationBits.length > 0) {
            parts.push(`[Location] ${locationBits.join(' | ')}`);
        }
    }

    return parts.filter(Boolean).join('\n').trim();
}

async function collectOfficialMediaUrls(message, accessToken) {
    const imageUrls = [];
    const audioUrls = [];
    const notes = [];

    const mediaTargets = [
        { type: 'image', id: message?.image?.id },
        { type: 'audio', id: message?.audio?.id },
        { type: 'voice', id: message?.voice?.id }
    ].filter((item) => item.id);

    for (const mediaTarget of mediaTargets) {
        const mediaDetails = await whatsappCloudService.getMediaDetails(mediaTarget.id, accessToken);
        const mediaUrl = mediaDetails?.url || null;
        const mimeType = String(mediaDetails?.mime_type || '').toLowerCase();

        if (!mediaUrl) {
            notes.push(`[User sent ${mediaTarget.type}, but media download URL could not be resolved.]`);
            continue;
        }

        if (mediaTarget.type === 'image' || mimeType.startsWith('image/')) {
            imageUrls.push(mediaUrl);
            continue;
        }

        if (mediaTarget.type === 'audio' || mediaTarget.type === 'voice' || mimeType.startsWith('audio/')) {
            audioUrls.push(mediaUrl);
            continue;
        }

        notes.push(`[User sent unsupported media type: ${mediaTarget.type}]`);
    }

    if (message?.document?.id) {
        notes.push(`[User sent a document${message.document.filename ? `: ${message.document.filename}` : ''}]`);
    }

    if (message?.video?.id) {
        notes.push('[User sent a video]');
    }

    return { imageUrls, audioUrls, notes };
}

function getWhatsAppDebounceTime(config, pagePrompts) {
    const waitSeconds = pagePrompts?.wait
        ?? config?.page_prompts?.wait
        ?? config?.wait_time
        ?? config?.wait;

    if (waitSeconds === undefined || waitSeconds === null || waitSeconds === '') {
        return DEBOUNCE_MS;
    }

    const debounceTime = Number(waitSeconds) * 1000;
    if (!Number.isFinite(debounceTime) || debounceTime < 0) {
        return DEBOUNCE_MS;
    }

    return debounceTime;
}

function flushWhatsAppDebounce(batchKey) {
    const sessionData = waDebounceMap.get(batchKey);
    if (!sessionData || sessionData.isProcessing) {
        return;
    }

    if (sessionData.timer) {
        clearTimeout(sessionData.timer);
        sessionData.timer = null;
    }

    if (sessionData.messages.length === 0) {
        waDebounceMap.delete(batchKey);
        return;
    }

    sessionData.isProcessing = true;
    const messagesToProcess = [...sessionData.messages];
    sessionData.messages = [];

    const queueKey = sessionData.config?.phone_number_id
        || sessionData.phoneNumberId
        || sessionData.config?.session_name
        || sessionData.wabaId
        || batchKey;

    schedulePageTask(queueKey, async () => {
        try {
            await processWhatsAppBatch(
                messagesToProcess,
                sessionData.config,
                sessionData.prompts,
                sessionData.senderName,
                sessionData.senderId,
                sessionData.wabaId,
                sessionData.phoneNumberId
            );
        } finally {
            const remaining = waDebounceMap.get(batchKey);
            if (!remaining) {
                return;
            }

            if (remaining.messages.length > 0) {
                const retryDelay = Math.min(getWhatsAppDebounceTime(remaining.config, remaining.prompts), 2000);
                remaining.isProcessing = false;
                remaining.timer = setTimeout(() => flushWhatsAppDebounce(batchKey), retryDelay);
            } else {
                waDebounceMap.delete(batchKey);
            }
        }
    });
}

function queueWhatsAppBatch(batch) {
    const sessionKey = batch.config?.session_name || batch.config?.waba_id || batch.wabaId || batch.phoneNumberId || 'official_unknown';
    const batchKey = `${batch.senderId}:${sessionKey}`;

    if (!waDebounceMap.has(batchKey)) {
        waDebounceMap.set(batchKey, {
            messages: [],
            timer: null,
            isProcessing: false,
            config: batch.config,
            prompts: batch.prompts,
            senderName: batch.senderName,
            senderId: batch.senderId,
            wabaId: batch.wabaId,
            phoneNumberId: batch.phoneNumberId
        });
    }

    const sessionData = waDebounceMap.get(batchKey);
    sessionData.messages.push(...batch.messages);
    sessionData.config = batch.config;
    sessionData.prompts = batch.prompts;
    sessionData.senderName = batch.senderName;
    sessionData.senderId = batch.senderId;
    sessionData.wabaId = batch.wabaId;
    sessionData.phoneNumberId = batch.phoneNumberId;

    console.log(`[WhatsApp Debounce] Queued ${batch.messages.length} message(s) for ${batchKey}. Buffer size: ${sessionData.messages.length}`);

    if (sessionData.isProcessing) {
        console.log(`[WhatsApp Debounce] ${batchKey} is currently processing. Appended to buffer.`);
        return;
    }

    const debounceTime = getWhatsAppDebounceTime(batch.config, batch.prompts);
    console.log(`[WhatsApp Debounce] Using wait time ${debounceTime}ms for ${batchKey}`);

    if (sessionData.timer) {
        clearTimeout(sessionData.timer);
    }

    sessionData.timer = setTimeout(() => flushWhatsAppDebounce(batchKey), debounceTime);
}

// --- WHATSAPP INLINE BATCH PROCESSING ---
async function processWhatsAppBatch(bufferedMessages, config, pagePrompts, senderName, senderId, wabaId, phoneNumberId) {
    const effectiveSessionName = config.session_name || `official_${wabaId || phoneNumberId}`;
    const resolvedPhoneNumberId = config.phone_number_id || phoneNumberId;
    const latestIncomingMessageId = [...bufferedMessages].reverse().map(msg => msg?.id).find(Boolean) || null;
    const controlConfig = {
        ...(config || {}),
        ...((config && config.page_prompts) || {}),
        ...(pagePrompts || {})
    };
    // Get trigger timestamp (use first message's time or current time)
    const triggerTimestamp = Date.now();
    let totalVisionTokens = 0;
    let totalAudioTokens = 0;

    // 1. Media Collection
    const imageUrls = [];
    const audioUrls = [];
    const normalizedMessages = [];

    const whatsappCloudService = require('../services/whatsappCloudService');

    for (const msg of bufferedMessages) {
        const { imageUrls: msgImages, audioUrls: msgAudios, notes } = await collectOfficialMediaUrls(msg, config.cloud_access_token);
        const msgText = extractOfficialMessageText(msg);
        
        imageUrls.push(...msgImages);
        audioUrls.push(...msgAudios);
        
        normalizedMessages.push({
            id: msg.id,
            text: [msgText, ...notes].filter(Boolean).join('\n').trim(),
            images: msgImages,
            audios: msgAudios,
            referral: msg.referral || null
        });
    }

    // 2. Run Workflow (Normalization & Ad Context)
    const workflow = runWhatsAppWorkflow(normalizedMessages);
    let combinedText = workflow.combinedText;
    const allImages = [...imageUrls];
    const allAudios = [...audioUrls];
    const inboundLogParts = [];
    if (combinedText) inboundLogParts.push(combinedText);
    const inboundLogText = inboundLogParts.join('\n\n').trim();

    if (inboundLogText) {
        await dbService.saveWhatsAppChat({
            session_name: effectiveSessionName,
            sender_id: senderId,
            recipient_id: effectiveSessionName,
            message_id: `${bufferedMessages[0].id}_batch_raw`,
            text: inboundLogText,
            timestamp: Date.now(),
            status: 'received',
            reply_by: 'user'
        });
    }

    // --- ALWAYS MARK SEEN FIRST (like Messenger) ---
    if (latestIncomingMessageId && resolvedPhoneNumberId && config.cloud_access_token) {
        whatsappCloudService.sendSeen(resolvedPhoneNumberId, config.cloud_access_token, latestIncomingMessageId)
            .catch((err) => console.warn(`[WhatsApp Webhook] Failed to mark seen: ${err.message}`));
    }

    // --- FEATURE FLAGS CHECK (WhatsApp Cloud API) ---
    const hasReplyTo = bufferedMessages.some(m => m.context?.message_id);
    const isSwipeEnabled = controlConfig.swipe_reply !== false && controlConfig.swipe_reply !== 'false' && controlConfig.swipe_reply !== 0 && controlConfig.swipe_reply !== '0';
    const isReplyEnabled = controlConfig.reply_message !== false && controlConfig.reply_message !== 'false' && controlConfig.reply_message !== 0 && controlConfig.reply_message !== '0';

    if (hasReplyTo && !isSwipeEnabled) {
        console.log(`[WhatsApp Webhook] Swipe Reply disabled for ${senderId}. Ignoring.`);
        return;
    }
    if (!hasReplyTo && !isReplyEnabled) {
        console.log(`[WhatsApp Webhook] Reply Message disabled for ${senderId}. Ignoring.`);
        return;
    }

    console.log(`[WhatsApp Batch] Processing ${bufferedMessages.length} message(s) for ${senderId}`);

    // --- MEDIA PROCESSING (Upgraded to Messenger Style) ---
    
    // A. Image Analysis
    if (allImages.length > 0) {
        const imageDetectionEnabled = controlConfig.image_detection !== false && controlConfig.image_detection !== 'false' && controlConfig.image_detection !== 0 && controlConfig.image_detection !== '0' && controlConfig.image_detection !== null;

        if (!imageDetectionEnabled) {
            console.log(`[WhatsApp Batch] Image Detection disabled. Skipping.`);
            await dbService.setConversationState(effectiveSessionName, senderId, {
                last_image_map: null,
                last_image_batch_id: `wa_img_skipped_${Date.now()}`,
                last_intent: 'image_analysis_skipped'
            });
            combinedText += `\n[System Note: User sent ${allImages.length} images. Image detection is disabled.]`;
        } else {
            console.log(`[WhatsApp Batch] Analyzing and matching ${allImages.length} images...`);
            let productAnalysisPrompt = `Analyze this image with 100% precision. Focus on products and text. Output in Bengali format.`;
            if (controlConfig.image_prompt || controlConfig.vision_prompt) {
                productAnalysisPrompt = controlConfig.image_prompt || controlConfig.vision_prompt;
            }

            const batchId = `wa_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const imageJobs = [];
            let imageIndex = 1;
            for (const msg of normalizedMessages) {
                for (const url of msg.images || []) {
                    imageJobs.push({ msg, url, imageIndex: imageIndex++ });
                }
            }

            const imageAnalysisResults = await Promise.all(imageJobs.map(job =>
                analyzeAndMatchIncomingImage({
                    platform: 'whatsapp',
                    pageId: effectiveSessionName,
                    senderId,
                    imageUrl: job.url,
                    imageIndex: job.imageIndex,
                    batchId,
                    pageConfig: config,
                    prompt: productAnalysisPrompt
                }).catch(error => ({

                    imageIndex: job.imageIndex,
                    imageUrl: job.url,
                    analysisText: `[Vision Analysis Failed] ${error.message}`,
                    matchedProducts: [],
                    topMatch: null,
                    usage: 0,
                    model: 'vision-error'
                }))
            ));

            totalVisionTokens += imageAnalysisResults.reduce((sum, result) => sum + Number(result.usage || 0), 0);
            const combinedImageAnalysis = imageAnalysisResults.map(formatImageAnalysisBlock).join('\n\n');
            const lastImageMap = buildLastImageMap(imageAnalysisResults);

            await dbService.setConversationState(effectiveSessionName, senderId, {
                last_image_map: Object.keys(lastImageMap).length > 0 ? lastImageMap : null,
                last_image_batch_id: batchId,
                last_intent: 'multi_image_analysis'
            });

            if (combinedImageAnalysis) {
                dbService.saveWhatsAppChat({
                    session_name: effectiveSessionName,
                    sender_id: effectiveSessionName,
                    recipient_id: senderId,
                    message_id: `img_analysis_${batchId}`,
                    text: `[Analyzed Images]:\n${combinedImageAnalysis}`,
                    timestamp: Date.now(),
                    status: 'analyzed',
                    reply_by: 'bot',
                    token_usage: totalVisionTokens,
                    model_used: imageAnalysisResults.find(r => r.model && r.model !== 'image-analysis-cache')?.model || 'image-analysis-cache'
                }).catch(e => console.error(`[WhatsApp] Failed to save image analysis:`, e.message));

                combinedText += `\n\n[NEW VISUAL CONTEXT - IMPORTANT]:
The user has just sent the following image(s). This is the CURRENT FOCUS of the conversation.
If the user asks "eta ase?", "price koto?", "chobi den", or refers to "1/2/3 number", they are referring to the numbered image results below.

${combinedImageAnalysis.trim()}

[CRITICAL RULE FOR IMAGES AND MULTIPLE PRODUCTS]:
1. Use the exact IMAGE 1 / IMAGE 2 / IMAGE 3 order above when answering.
2. If matched product details are present, answer from those verified details and do NOT merge all products into one ambiguous paragraph.
3. For multiple images, list each answer as "ছবি ১", "ছবি ২" etc. with product name and price.
4. If an image has no matching product, say exact match পাওয়া যায়নি for that specific image.
5. If user later says "২ নাম্বারটা", use IMAGE 2 from the saved image map.
[END OF NEW VISUAL CONTEXT]`;
            }
        }
    }

    // B. Audio Transcription
    if (allAudios.length > 0) {
        const audioEnabled = controlConfig.audio_detection !== false && controlConfig.audio_detection !== 'false' && controlConfig.audio_detection !== 0 && controlConfig.audio_detection !== '0' && controlConfig.audio_detection !== null;

        if (audioEnabled) {
            console.log(`[WhatsApp Batch] Transcribing ${allAudios.length} voice messages...`);
            const audioJobs = [];
            for (const msg of normalizedMessages) {
                for (const url of msg.audios) {
                    audioJobs.push({ id: msg.id, url, rawText: msg.text });
                }
            }

            const audioResults = await Promise.all(audioJobs.map(job => aiService.transcribeAudio(job.url, config)));
            let combinedAudioTranscript = "";
            let lastAudioModel = 'unknown';

            audioResults.forEach((res, i) => {
                const text = typeof res === 'object' ? (res.text || '') : String(res || '');
                totalAudioTokens += (res.usage || 0);
                lastAudioModel = res.model || 'unknown';
                if (text.trim()) {
                    combinedAudioTranscript += `${text.trim()}\n`;
                    const job = audioJobs[i];
                    dbService.saveWhatsAppChat({
                        session_name: effectiveSessionName,
                        sender_id: senderId,
                        recipient_id: effectiveSessionName,
                        message_id: job.id,
                        text: job.rawText ? `${job.rawText}\n[Transcript]: ${text.trim()}` : `[Transcript]: ${text.trim()}`,
                        timestamp: Date.now(),
                        status: 'transcribed',
                        reply_by: 'user',
                        token_usage: totalAudioTokens,
                        model_used: lastAudioModel
                    }).catch(e => console.error(`[WhatsApp] Failed to save transcript:`, e.message));
                }
            });

            if (combinedAudioTranscript) {
                combinedText += `\n\n[Voice Message Transcript]:\n${combinedAudioTranscript.trim()}`;
            }
        } else {
            combinedText += `\n[System Note: User sent ${allAudios.length} voice messages. Audio detection is disabled.]`;
        }
    }

    if (!combinedText && allImages.length === 0 && allAudios.length === 0) {
        console.log(`[WhatsApp Batch] Skipping empty batch for ${senderId}`);
        return;
    }

    const semEnabled = controlConfig.semantic_cache_enabled === true || controlConfig.semantic_cache_enabled === 1 || controlConfig.semantic_cache_enabled === 'true';
    const threshold = controlConfig.semantic_cache_threshold ? Math.max(0.5, Math.min(0.99, Number(controlConfig.semantic_cache_threshold))) : 0.96;
    const isMediaTurn = allImages.length > 0 || allAudios.length > 0;

    if (semEnabled && !isMediaTurn && combinedText.trim()) {
        try {
            const cacheQuery = combinedText.trim().replace(/\s+/g, ' ');
            const state = await dbService.getConversationState(effectiveSessionName, senderId);
            const contextId = state?.last_product_id || null;
            const cached = await dbService.findSemanticCache({
                page_id: effectiveSessionName,
                session_name: effectiveSessionName,
                context_id: contextId,
                question: cacheQuery,
                threshold
            });

            if (cached) {
                // Check if admin replied after last user message
                const lastUserTs = await dbService.getLastWhatsAppUserMessageTimestamp(effectiveSessionName, senderId);
                const checkTs = lastUserTs || triggerTimestamp;
                const hasAdminReplied = await dbService.hasWhatsAppAdminReplySince(effectiveSessionName, senderId, checkTs);
                
                if (hasAdminReplied) {
                    console.log(`[WhatsApp Cloud] Bot skipped: Admin replied before send to ${senderId}`);
                    const cacheMessageId = `bot_skip_${Date.now()}`;
                    await dbService.saveWhatsAppChat({
                        session_name: effectiveSessionName,
                        sender_id: effectiveSessionName,
                        recipient_id: senderId,
                        message_id: cacheMessageId,
                        text: '[Bot skipped: Admin replied before send]',
                        timestamp: Date.now(),
                        status: 'skipped_admin_reply',
                        reply_by: 'bot',
                        model_used: 'semantic-cache'
                    });
                    return;
                }

                const cacheMessageId = `cache_${Date.now()}`;
                await dbService.saveWhatsAppChat({
                    session_name: effectiveSessionName,
                    sender_id: effectiveSessionName,
                    recipient_id: senderId,
                    message_id: cacheMessageId,
                    text: cached,
                    timestamp: Date.now(),
                    status: 'sending',
                    reply_by: 'bot',
                    model_used: 'semantic-cache'
                });

                if (latestIncomingMessageId && resolvedPhoneNumberId && config.cloud_access_token) {
                    try {
                        await whatsappCloudService.sendTyping(resolvedPhoneNumberId, config.cloud_access_token, latestIncomingMessageId);
                    } catch (typingErr) {
                        console.warn(`[WhatsApp Webhook] Cache typing indicator failed: ${typingErr.message}`);
                    }
                }

                await whatsappCloudService.sendTextMessage(resolvedPhoneNumberId, config.cloud_access_token, senderId, cached);
                await dbService.saveWhatsAppChat({
                    session_name: effectiveSessionName,
                    sender_id: effectiveSessionName,
                    recipient_id: senderId,
                    message_id: cacheMessageId,
                    text: cached,
                    timestamp: Date.now(),
                    status: 'sent',
                    reply_by: 'bot',
                    model_used: 'semantic-cache'
                });
                return;
            }
        } catch (cacheErr) {
            console.warn(`[WhatsApp Webhook] Early cache check failed: ${cacheErr.message}`);
        }
    }

    // 3. Save User Message to DB (Main Log)
    console.log(`[WhatsApp Webhook] Saving inbound chat for ${senderId}...`);
    await dbService.saveWhatsAppChat({
        session_name: effectiveSessionName,
        sender_id: senderId,
        recipient_id: effectiveSessionName,
        message_id: bufferedMessages[0].id,
        text: combinedText || inboundLogText,
        timestamp: Date.now(),
        status: 'received',
        reply_by: 'user'
    });

    const isLocked = await dbService.checkWhatsAppLockStatus(effectiveSessionName, senderId);
    if (isLocked) {
        console.log(`[WhatsApp Webhook] Conversation locked for ${senderId}. Skipping AI reply.`);
        await dbService.saveWhatsAppChat({
            session_name: effectiveSessionName,
            sender_id: effectiveSessionName,
            recipient_id: senderId,
            message_id: `sys_${Date.now()}`,
            text: `[SYSTEM ERROR] Conversation Locked (Too many failures).`,
            timestamp: Date.now(),
            status: 'system_error',
            reply_by: 'system'
        });
        return;
    }

    const hasDaily = Number(controlConfig.daily_limit || 0) > Number(controlConfig.daily_used || 0);
    const hasMonthly = Number(controlConfig.monthly_limit || 0) > Number(controlConfig.monthly_used || 0);
    const hasBonus = Number(controlConfig.bonus_credit || 0) > 0;
    const hasLegacy = Number(controlConfig.message_credit || 0) > 0;
    const hasPermanent = Number(controlConfig.permanent_credit || 0) > 0;
    const hasAnyCredit = hasDaily || hasMonthly || hasBonus || hasLegacy || hasPermanent;
    const hasOwnKey = Boolean(
        controlConfig.api_key
        && controlConfig.api_key !== 'MANAGED_SECRET_KEY'
        && !String(controlConfig.api_key).startsWith('salesman_')
        && controlConfig.cheap_engine === false
    );
    const isBanned = String(controlConfig.subscription_status || '').toLowerCase() === 'banned';

    if (isBanned || (!hasAnyCredit && !hasOwnKey)) {
        console.log(`[WhatsApp Webhook] Session ${effectiveSessionName} blocked. Banned=${isBanned} Credits=${hasAnyCredit} OwnKey=${hasOwnKey}`);
        await dbService.saveWhatsAppChat({
            session_name: effectiveSessionName,
            sender_id: effectiveSessionName,
            recipient_id: senderId,
            message_id: `sys_${Date.now()}`,
            text: `[SYSTEM ERROR] Out of Credits. Please recharge to continue using AI.`,
            timestamp: Date.now(),
            status: 'system_error',
            reply_by: 'system'
        });
        return;
    }

    // 4. AI Response Generation
    console.log(`[WhatsApp Webhook] Generating AI response for ${senderId}...`);
    const historyLimit = Math.max(1, Number(controlConfig.check_conversion) || 10);
    const history = await dbService.getWhatsAppChatHistory(effectiveSessionName, senderId, historyLimit);
    const recentRawHistory = await dbService.getLastNWhatsAppMessages(effectiveSessionName, senderId, historyLimit);

    let finalUserMessage = combinedText || inboundLogText;
    const replyToId = bufferedMessages
        .map(m => m?.context?.id || m?.context?.message_id)
        .find(Boolean) || null;

    if (replyToId) {
        try {
            const quotedText = await dbService.getMessageById(replyToId);
            if (quotedText && quotedText.trim()) {
                finalUserMessage = `[Replying to: "${quotedText.trim()}"]\n${finalUserMessage}`;
            }
        } catch (replyErr) {
            console.warn(`[WhatsApp Webhook] Failed to resolve quoted message ${replyToId}: ${replyErr.message}`);
        }
    }

    let smartAdContext = "";
    if (workflow.adId && workflow.adId !== 'N/A') {
        try {
            const adData = await dbService.getAdContext(workflow.adId, effectiveSessionName);
            if (adData) {
                let contextObj = {
                    type: 'ad_referral',
                    description: adData.description || 'N/A',
                    linked_products: []
                };
                if (Array.isArray(adData.linked_product_ids) && adData.linked_product_ids.length > 0) {
                    for (const productId of adData.linked_product_ids) {
                        const product = await dbService.getProductById(productId);
                        if (product) {
                            contextObj.linked_products.push({
                                id: product.id,
                                name: product.name,
                                price: product.price,
                                currency: product.currency || 'BDT',
                                discount_price: product.discount_price || null
                            });
                        }
                    }
                }
                smartAdContext = `\n<system_hidden_context>\n${JSON.stringify(contextObj, null, 2)}\nInstruction: The user clicked on this ad. Treat the linked products as current context. If they ask about price/details without specifying a product, assume they mean these linked products.\n</system_hidden_context>\n`;
            }
        } catch (adErr) {
            console.warn(`[WhatsApp Webhook] Failed to load smart ad context for ${workflow.adId}: ${adErr.message}`);
        }
    }

    let promptProductContext = "";
    let productNamesFromPrompt = extractProductNamesFromPrompt(controlConfig.text_prompt || "");
    if (productNamesFromPrompt.length > 0 && effectiveSessionName) {
        const lowerCombined = String(combinedText || '').toLowerCase();
        const isGreeting = /\b(hi+|hello|hey)\b/.test(lowerCombined);
        productNamesFromPrompt = productNamesFromPrompt.filter(name => {
            if (name.toLowerCase() === 'logo' && !isGreeting) return false;
            return true;
        });

        const promptProductMap = {};
        for (const rawName of Array.from(new Set(productNamesFromPrompt))) {
            const key = rawName.toLowerCase();
            if (promptProductMap[key]) continue;
            try {
                const productsForPrompt = await dbService.searchProductsForResource(rawName, effectiveSessionName);
                if (productsForPrompt && productsForPrompt.length > 0) {
                    promptProductMap[key] = productsForPrompt[0];
                }
            } catch (promptErr) {
                console.warn(`[WhatsApp Webhook] Prompt product lookup failed for "${rawName}": ${promptErr.message}`);
            }
        }

        const promptProducts = Object.values(promptProductMap);
        if (promptProducts.length > 0) {
            promptProductContext = "\n[Instruction Products]\n";
            promptProducts.forEach((product, index) => {
                const priceDisplay = product.price ? `${product.price} ${product.currency || 'BDT'}` : 'N/A';
                const imgDisplay = product.image_url || 'N/A';
                const descDisplay = product.description ? product.description.replace(/\n/g, ' ').substring(0, 200) : '';
                const resolvedContext = buildResolvedProductContext(product, combinedText || '');
                const variantsPart = resolvedContext.variantsText;
                
                if (!product.allow_description) {
                    promptProductContext += `Item ${index + 1}: Image URL: ${imgDisplay}${variantsPart}\n`;
                    return;
                }
                const descPart = descDisplay ? ` | Desc: ${descDisplay}` : '';
                promptProductContext += `Item ${index + 1}: ${product.name} | Price: ${priceDisplay} | Image URL: ${imgDisplay}${descPart}${variantsPart}\n`;
            });
            promptProductContext += "[End of Instruction Products]\n";
        }
    }

    finalUserMessage = `${smartAdContext}${finalUserMessage}${promptProductContext}`;

    const professionalRules = `\n\n[PROFESSIONAL OUTPUT RULES]\n` +
            `1) IDENTITY: You are a professional human sales representative. Talk naturally.\n` +
            `2) TOOL-FIRST: If the user asks about product price/details, you MUST call tools. Do NOT invent prices or descriptions.\n` +
            `3) IMAGE DECISION: If you decide to send a product's image (based on user request or appropriateness), you MUST append [PRODUCT_ID:id] to your reply. Example: "Yes, it is available. [PRODUCT_ID:82]".\n` +
            `4) SYSTEM PROMPT PRIORITY: If your custom instructions (System Prompt) say NOT to send images proactively, you MUST obey that and only use the [PRODUCT_ID:id] tag when the user explicitly asks for a photo.\n` +
            `5) SMART PHOTO FLOW: If the customer asks for a photo of multiple products, append [PRODUCT_ID:id] for each product. If they haven't specified which product they want, ask for clarification.\n` +
        `6) PHOTO SCOPE: Focus on the products the user asked for. If they ask for "both" or "all" available products' photos, provide their IDs.\n` +
            `7) SKU FLOW: If a product has multiple design/color/size/item options and the customer did not specify enough details, ask the missing attribute instead of guessing.\n` +
            `8) LISTING PRODUCTS: If asked "What do you sell?", list 3-5 names naturally and ask which one they are interested in.\n` +
            `9) DELIVERY CLAIMS: Never say a photo has already been sent or delivered. Keep the wording neutral; the system will decide final delivery wording.\n` +
            `10) NO HALLUCINATIONS: Never guess or invent prices. Always use tool data only.\n`;

    const aiConfig = {
        ...controlConfig,
        page_id: effectiveSessionName,
        request_budget_ms: AI_REQUEST_BUDGET_MS,
        request_deadline_at: Date.now() + AI_REQUEST_BUDGET_MS
    };
    if (aiConfig.text_prompt) {
        aiConfig.text_prompt += professionalRules;
    } else {
        aiConfig.text_prompt = professionalRules;
    }
    const ownerName = aiConfig.push_name || aiConfig.name || effectiveSessionName;

    let aiResponse;
    try {
        aiResponse = await aiService.generateResponse({
            pageId: effectiveSessionName,
            userId: senderId,
            userMessage: finalUserMessage,
            history,
            imageUrls: [],
            audioUrls: allAudios,
            config: aiConfig,
            platform: 'whatsapp',
            senderName: senderName,
            ownerName,
            extraTokenUsage: totalVisionTokens + totalAudioTokens
        });
        } catch (genErr) {
        console.error(`[WhatsApp Webhook] AI Generation CRITICAL Error:`, genErr.message);
        if (genErr.message.includes('PRODUCT_SEARCH_API_FAILURE')) {
            await dbService.saveWhatsAppChat({
                session_name: effectiveSessionName,
                sender_id: effectiveSessionName,
                recipient_id: senderId,
                message_id: `err_search_${Date.now()}`,
                text: `[CRITICAL ERROR] Product search failed due to API problem. (Code: 503_VECTOR_DB_FAIL). Details: ${genErr.message}`,
                timestamp: Date.now(),
                status: 'api_failure',
                reply_by: 'system'
            });
            return;
        }
            aiResponse = {
                reply: aiConfig.fallback_message || "দুঃখিত, সার্ভার বর্তমানে ব্যস্ত আছে। একটু পরে আবার চেষ্টা করুন।",
                error: genErr.message
            };
    }

    if (!aiResponse) {
            aiResponse = {
                reply: aiConfig.fallback_message || "দুঃখিত, সার্ভার বর্তমানে ব্যস্ত আছে। একটু পরে আবার চেষ্টা করুন।",
                error: 'empty_ai_response'
            };
    }

    let finalReplyText = aiResponse.reply || aiResponse.text || '';

    if (finalReplyText && (finalReplyText.trim().startsWith('{') || finalReplyText.trim().startsWith('['))) {
        try {
            const cleanJson = finalReplyText.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            if (parsed.reply_text) finalReplyText = parsed.reply_text;
            else if (parsed.reply) finalReplyText = parsed.reply;
            else if (parsed.message) finalReplyText = parsed.message;
            else if (parsed.text) finalReplyText = parsed.text;
        } catch (jsonErr) {
            console.warn(`[WhatsApp Webhook] JSON rescue failed: ${jsonErr.message}`);
        }
    }

    const structuredDeliveryItems = normalizeAiDeliveryItems(aiResponse, finalReplyText);
    if (!aiResponse?.product_id) {
        aiResponse.product_id = structuredDeliveryItems.find((item) => item.product_id)?.product_id || null;
    }

    if (aiResponse?.product_id) {
        try {
            await dbService.setConversationState(effectiveSessionName, senderId, { last_product_id: aiResponse.product_id });
        } catch (stateErr) {
            console.warn(`[Context] Failed to update WhatsApp conversation state: ${stateErr.message}`);
        }
    }

    // --- NEW PROFESSIONAL TAG PROCESSOR (PRODUCT_ID) ---
    // Robust check for the tag, allowing for variations in spacing and quotes
    if (/\[PRODUCT_ID\s*:\s*/i.test(finalReplyText)) {
        // Loose regex to capture whatever is inside the tag
        const productTagRegex = /\[PRODUCT_ID\s*:\s*["']?\s*([^"\]\s']+)["']?\s*\]/gi;
        
        const matches = [...finalReplyText.matchAll(productTagRegex)];
        const uniqueTags = new Set(matches.map(m => m[0]));

        for (const fullTag of uniqueTags) {
            const match = matches.find(m => m[0] === fullTag);
            const productId = match[1].trim().replace(/["']/g, ''); // Extra cleanup for quotes

            try {
                // Fetch product by exact ID
                const product = await dbService.getProductById(productId);
                if (product) {
                    const historyText = getHistoryText(recentRawHistory);
                    const state = await dbService.getConversationState(effectiveSessionName, senderId).catch(() => null);
                    const resolvedContext = buildResolvedProductContext(product, historyText || combinedText || '', state?.last_variant_key || null);
                    const selectedSku = resolvedContext.selectedSku;
                    const numericPrice = parsePrice(selectedSku?.price ?? product.price);
                    let priceDisplay = numericPrice > 0 ? `${numericPrice} ${selectedSku?.currency || product.currency || 'BDT'}` : "Ask for Price";
                    const description = product.description || "No description available.";

                    // Build variants display
                    let variantsDisplay = '';
                    if (selectedSku) {
                        variantsDisplay = `\n📌 Selected SKU: ${selectedSku.name}${selectedSku.sku_code ? ` (${selectedSku.sku_code})` : ''}`;
                    } else if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
                        const availableVariants = product.variants.filter(v => v.available !== false);
                        if (availableVariants.length > 0) {
                            variantsDisplay = '\n📋 Available Options:';
                            availableVariants.forEach((v, idx) => {
                                const variantPrice = parsePrice(v.price);
                                const variantPriceDisplay = variantPrice > 0 ? `${variantPrice} ${v.currency || product.currency || 'BDT'}` : "Ask for Price";
                                variantsDisplay += `\n   ${idx + 1}. ${v.name || `Option ${idx + 1}`}: ${variantPriceDisplay}`;
                            });
                        }
                    }

                    // Prepare replacement text
                    const replacementText = `\n\n🛍️ *${product.name}*\n💰 Price: ${priceDisplay}\n📝 Details: ${description}${variantsDisplay}`;
                    
                    // Replace all occurrences of this exact tag string
                    finalReplyText = finalReplyText.split(fullTag).join(replacementText);

                    // Image attachment logic
                    const userWantsPhoto = hasPhotoIntent(recentRawHistory);
                    
                    // Track all sent media to avoid duplicates
                    const sentMediaUrls = new Set();
                    if (aiResponse.images) {
                        aiResponse.images.forEach(img => sentMediaUrls.add(img.url));
                    }
                    if (aiResponse.videos) {
                        aiResponse.videos.forEach(vid => sentMediaUrls.add(vid.url));
                    }

                    if (selectedSku) {
                        await dbService.setConversationState(effectiveSessionName, senderId, {
                            last_product_id: product.id,
                            last_variant_key: selectedSku.key || null
                        });
                    }

                    resolvedContext.mediaImages.forEach((mediaUrl) => {
                        if (!sentMediaUrls.has(mediaUrl)) {
                            if (!aiResponse.images) aiResponse.images = [];
                            aiResponse.images.push({
                                url: mediaUrl,
                                title: product.name,
                                description
                            });
                            sentMediaUrls.add(mediaUrl);
                        }
                    });

                    resolvedContext.mediaVideos.forEach((mediaUrl) => {
                        const normalizedVideoUrl = normalizeImageUrl(mediaUrl);
                        if (!sentMediaUrls.has(normalizedVideoUrl)) {
                            if (!aiResponse.videos) aiResponse.videos = [];
                            aiResponse.videos.push({
                                url: normalizedVideoUrl,
                                title: product.name,
                                description
                            });
                            sentMediaUrls.add(normalizedVideoUrl);
                        }
                    });

                } else {
                    console.warn(`[TagProcessor] Product ID "${productId}" not found in DB.`);
                    // If not found, we still remove the tag but show a clean "not found" message
                    finalReplyText = finalReplyText.split(fullTag).join(`\n(Product info currently unavailable)`);
                }
            } catch (err) {
                console.error(`[TagProcessor] Error for ID ${productId}:`, err);
            }
        }
    }
    // -----------------------------------------------------

    if (Array.isArray(aiResponse?.image_urls)) {
        if (!aiResponse.images) aiResponse.images = [];
        aiResponse.image_urls.forEach(url => {
            if (url && typeof url === 'string' && url.startsWith('http')) {
                pushUniqueMedia(aiResponse.images, { url, title: 'Product Image' });
            }
        });
    }

    if (Array.isArray(aiResponse?.video_urls)) {
        if (!aiResponse.videos) aiResponse.videos = [];
        aiResponse.video_urls.forEach(url => {
            if (url && typeof url === 'string' && url.startsWith('http')) {
                pushUniqueMedia(aiResponse.videos, { url, title: 'Product Video' });
            }
        });
    }

    if (finalReplyText && typeof finalReplyText === 'string') {
        const extracted = extractImageUrlsFromText(finalReplyText);
        finalReplyText = sanitizeReplyText(extracted.cleanText);
        if (extracted.urls.length > 0) {
            if (!aiResponse.images) aiResponse.images = [];
            extracted.urls.forEach(url => {
                pushUniqueMedia(aiResponse.images, { url, title: 'Product Image' });
            });
        }
    }

    if (hasPhotoIntent(recentRawHistory)) {
        let targetProductId = null;
        const state = await dbService.getConversationState(effectiveSessionName, senderId);
        if (state && state.last_product_id) targetProductId = state.last_product_id;
        if (!targetProductId && aiResponse?.product_id) targetProductId = aiResponse.product_id;
        if (targetProductId) {
            const product = await dbService.getProductById(targetProductId);
            if (product) {
                const resolvedContext = buildResolvedProductContext(product, getHistoryText(recentRawHistory), state?.last_variant_key || null);
                if (!Array.isArray(aiResponse.images) || aiResponse.images.length === 0) {
                    aiResponse.images = resolvedContext.mediaImages.map((url, idx) => ({
                        url,
                        title: product.name || (idx === 0 ? 'Product Image' : `Product Image ${idx + 1}`),
                        description: product.description || ''
                    }));
                }

                if ((!Array.isArray(aiResponse.videos) || aiResponse.videos.length === 0) && resolvedContext.mediaVideos.length > 0) {
                    aiResponse.videos = resolvedContext.mediaVideos.map((url) => ({
                        url: normalizeImageUrl(url),
                        title: product.name || 'Product Video',
                        description: product.description || ''
                    }));
                }
            }
        }
    }

    let decisionMode = null;
    if (finalReplyText && typeof finalReplyText === 'string') {
        const decision = extractDecisionMode(finalReplyText);
        decisionMode = decision.mode;
        finalReplyText = decision.cleaned;
    }

    let promptMode = decisionMode || detectImageMode(aiConfig.text_prompt);
    const sendModeMatch = finalReplyText && typeof finalReplyText === 'string'
        ? finalReplyText.match(/\[SEND_MODE:\s*(image_only|text_and_image|text_only)\]/i)
        : null;

    if (sendModeMatch) {
        promptMode = sendModeMatch[1].toLowerCase();
        finalReplyText = finalReplyText.replace(/\[SEND_MODE:\s*(image_only|text_and_image|text_only)\]/i, '').trim();
    }

    if (promptMode === 'image_only' && hasQueuedMedia(aiResponse)) {
        finalReplyText = '';
    }

    if (finalReplyText && shouldBlockOutgoingReply(finalReplyText)) {
        await dbService.saveWhatsAppChat({
            session_name: effectiveSessionName,
            sender_id: effectiveSessionName,
            recipient_id: senderId,
            message_id: `fail_${Date.now()}`,
            text: `[AI Error - Silent] JSON reply blocked`,
            timestamp: Date.now(),
            status: 'ai_ignored',
            reply_by: 'bot'
        });
        return;
    }

    if (aiResponse?.product_id) {
        try {
            await dbService.setConversationState(effectiveSessionName, senderId, { last_product_id: aiResponse.product_id });
        } catch (stateErr) {
            console.warn(`[WhatsApp Webhook] Failed to update conversation state: ${stateErr.message}`);
        }
    }

    try {
        const orderDataFromAI = aiResponse.order_details?.fields || aiResponse.order_details;
        const orderIntent = aiResponse.order_details?.intent || 'upsert';
        await orderService.orchestrateOrder({
            pageId: effectiveSessionName,
            senderId,
            platform: 'whatsapp',
            intent: orderIntent,
            data: orderDataFromAI || {},
            rawText: `${finalUserMessage}\n${finalReplyText || aiResponse.reply || ''}`.trim()
        });

        const orderMatch = typeof finalReplyText === 'string'
            ? finalReplyText.match(/\[SAVE_ORDER:\s*({.*?})\]/s)
            : null;
        if (orderMatch && orderMatch[1]) {
            const orderJson = JSON.parse(orderMatch[1]);
            await orderService.orchestrateOrder({
                pageId: effectiveSessionName,
                senderId,
                platform: 'whatsapp',
                intent: 'upsert',
                data: orderJson
            });
            finalReplyText = finalReplyText.replace(orderMatch[0], '').trim();
        }
    } catch (orderErr) {
        console.warn(`[WhatsApp Webhook] Order orchestration failed: ${orderErr.message}`);
    }

    const deliveryQueue = [];
    if (structuredDeliveryItems.length > 1) {
        const state = await dbService.getConversationState(effectiveSessionName, senderId).catch(() => null);
        const historyText = getHistoryText(recentRawHistory) || combinedText || '';
        const wantsPhoto = hasPhotoIntent(recentRawHistory);

        for (const item of structuredDeliveryItems) {
            const queueEntry = {
                text: sanitizeReplyText(item.reply_text || ''),
                images: [],
                videos: []
            };

            item.image_urls.forEach((url) => {
                if (url && typeof url === 'string' && url.startsWith('http')) {
                    pushUniqueMedia(queueEntry.images, { url, title: 'Product Image' });
                }
            });
            item.video_urls.forEach((url) => {
                if (url && typeof url === 'string' && url.startsWith('http')) {
                    pushUniqueMedia(queueEntry.videos, { url, title: 'Product Video' });
                }
            });

            if (item.product_id) {
                const product = await dbService.getProductById(item.product_id).catch(() => null);
                if (product) {
                    const resolvedContext = buildResolvedProductContext(product, historyText, state?.last_variant_key || null);
                    const selectedSku = resolvedContext.selectedSku;
                    const numericPrice = parsePrice(selectedSku?.price ?? product.price);
                    const priceDisplay = numericPrice > 0 ? `${numericPrice} ${selectedSku?.currency || product.currency || 'BDT'}` : "Ask for Price";

                    if ((item.action === 'SEND_DETAILS' || item.action === 'SEND_BOTH') && (!queueEntry.text || queueEntry.text.length < 50)) {
                        const description = product.description || "No description available.";
                        const skuLine = selectedSku ? `\n📌 Selected SKU: ${selectedSku.name}${selectedSku.sku_code ? ` (${selectedSku.sku_code})` : ''}` : '';
                        queueEntry.text = `${queueEntry.text}\n\n🛍️ *${product.name}*\n💰 Price: ${priceDisplay}${skuLine}\n📝 Details: ${description}`.trim();
                    }

                    if (item.action === 'SEND_PHOTO' || item.action === 'SEND_BOTH' || wantsPhoto) {
                        resolvedContext.mediaImages.forEach((url) => {
                            pushUniqueMedia(queueEntry.images, { url, title: product.name, description: product.description || '' });
                        });
                        resolvedContext.mediaVideos.forEach((url) => {
                            pushUniqueMedia(queueEntry.videos, { url: normalizeImageUrl(url), title: product.name, description: product.description || '' });
                        });
                    }
                }
            }

            if (queueEntry.text || queueEntry.images.length > 0 || queueEntry.videos.length > 0) {
                deliveryQueue.push(queueEntry);
            }
        }
    }

    const allowImageSend = controlConfig.image_send !== false && controlConfig.image_send !== 'false' && controlConfig.image_send !== 0 && controlConfig.image_send !== '0';
    const outboundImages = allowImageSend && Array.isArray(aiResponse?.images)
        ? aiResponse.images.map(img => (typeof img === 'string' ? { url: img, title: null } : { url: img?.url || null, title: img?.title || null })).filter(img => img.url)
        : [];
    const outboundVideos = allowImageSend && Array.isArray(aiResponse?.videos)
        ? aiResponse.videos.map(video => (typeof video === 'string' ? { url: video, title: null } : { url: video?.url || null, title: video?.title || null })).filter(video => video.url)
        : [];
    const sendQueue = deliveryQueue.length > 0
        ? deliveryQueue
        : [{ text: finalReplyText, images: outboundImages, videos: outboundVideos }].filter((entry) => entry.text || entry.images.length > 0 || entry.videos.length > 0);

    if (sendQueue.length === 0) {
        console.log(`[WhatsApp Webhook] AI stayed silent for ${senderId}`);
        return;
    }

    console.log(`[WhatsApp Webhook] AI generated response for ${senderId}: "${String(finalReplyText || '').substring(0, 30)}..."`);

    if (latestIncomingMessageId && resolvedPhoneNumberId && config.cloud_access_token) {
        try {
            await whatsappCloudService.sendTyping(resolvedPhoneNumberId, config.cloud_access_token, latestIncomingMessageId);
            await new Promise(resolve => setTimeout(resolve, 600));
        } catch (typingErr) {
            console.warn(`[WhatsApp Webhook] Typing indicator failed: ${typingErr.message}`);
        }
    }

    // 5. Send Responses
    const lastUserTs = await dbService.getLastWhatsAppUserMessageTimestamp(effectiveSessionName, senderId);
    const checkTs = lastUserTs || triggerTimestamp;
    const hasAdminReplied = await dbService.hasWhatsAppAdminReplySince(effectiveSessionName, senderId, checkTs);
    
    if (hasAdminReplied) {
        console.log(`[WhatsApp Cloud] Bot skipped: Admin replied before send to ${senderId}`);
        const pendingTextMessageId = `bot_skip_${bufferedMessages[0].id}`;
        await dbService.saveWhatsAppChat({
            session_name: effectiveSessionName,
            sender_id: effectiveSessionName,
            recipient_id: senderId,
            message_id: pendingTextMessageId,
            text: '[Bot skipped: Admin replied before send]',
            timestamp: Date.now(),
            status: 'skipped_admin_reply',
            reply_by: 'bot'
        });
        // Don't deduct credit if admin replied
        return;
    }

    for (let queueIndex = 0; queueIndex < sendQueue.length; queueIndex++) {
        const entry = sendQueue[queueIndex];
        const pendingTextMessageId = `reply_${bufferedMessages[0].id}_${queueIndex}`;

        if (entry.text) {
            await dbService.saveWhatsAppChat({
                session_name: effectiveSessionName,
                sender_id: effectiveSessionName,
                recipient_id: senderId,
                message_id: pendingTextMessageId,
                text: entry.text,
                timestamp: Date.now(),
                status: 'sending',
                reply_by: 'bot'
            });
            console.log(`[WhatsApp Webhook] Sending text reply to ${senderId}...`);
            await whatsappCloudService.sendTextMessage(resolvedPhoneNumberId, config.cloud_access_token, senderId, entry.text);
            await dbService.saveWhatsAppChat({
                session_name: effectiveSessionName,
                sender_id: effectiveSessionName,
                recipient_id: senderId,
                message_id: pendingTextMessageId,
                text: entry.text,
                timestamp: Date.now(),
                status: 'sent',
                reply_by: 'bot'
            });
        }

        for (let i = 0; i < entry.images.length; i++) {
            const image = entry.images[i];
            const caption = !entry.text && i === 0 && image.title ? String(image.title).slice(0, 1024) : undefined;
            console.log(`[WhatsApp Webhook] Sending image reply to ${senderId}...`);
            await whatsappCloudService.sendImageMessage(resolvedPhoneNumberId, config.cloud_access_token, senderId, image.url, caption);
        }

        for (let i = 0; i < entry.videos.length; i++) {
            const video = entry.videos[i];
            const caption = !entry.text && entry.images.length === 0 && i === 0 && video.title ? String(video.title).slice(0, 1024) : undefined;
            console.log(`[WhatsApp Webhook] Sending video reply to ${senderId}...`);
            await whatsappCloudService.sendVideoMessage(resolvedPhoneNumberId, config.cloud_access_token, senderId, video.url, caption);
        }
    }

    // 6. Deduct Credit (If not Own API)
    if (!hasOwnKey) {
        const deducted = await dbService.deductWhatsAppCredit(effectiveSessionName);
        if (!deducted) {
            console.warn(`[WhatsApp Webhook] Credit deduction failed for ${effectiveSessionName}.`);
        } else {
             console.log(`[WhatsApp Webhook] Credit deducted successfully for ${effectiveSessionName}.`);
        }
    }

    const sentImageCount = sendQueue.reduce((total, entry) => total + entry.images.length, 0);
    const sentVideoCount = sendQueue.reduce((total, entry) => total + entry.videos.length, 0);
    if (sentImageCount > 0 || sentVideoCount > 0) {
        await dbService.saveWhatsAppChat({
            session_name: effectiveSessionName,
            sender_id: effectiveSessionName,
            recipient_id: senderId,
            message_id: `reply_media_${bufferedMessages[0].id}`,
            text: `[Bot sent ${sentImageCount} image(s) and ${sentVideoCount} video(s)]`.trim(),
            timestamp: Date.now(),
            status: 'sent',
            reply_by: 'bot'
        });
    }
}

async function processWhatsAppEcho(echo, phoneNumberId, wabaId, metadata) {
    const messageId = echo.id;
    const senderId = echo.to; // recipient is user
    let text = '';
    if (echo.type === 'text' && echo.text?.body) {
        text = echo.text.body;
    } else if (echo.type === 'image' && echo.image?.caption) {
        text = echo.image.caption;
    }

    console.log(`[WhatsApp Echo] ADMIN ACTION DETECTED: Phone Number ${phoneNumberId} -> User ${senderId}. Text: ${text.substring(0, 50)}...`);

    const lookupKeys = [
        phoneNumberId,
        wabaId,
        phoneNumberId ? `official_${phoneNumberId}` : null,
        wabaId ? `official_${wabaId}` : null
    ].filter(Boolean);

    let pageData = { config: null, prompts: null };
    for (const lookupKey of lookupKeys) {
        const candidate = await getCachedPageData(lookupKey);
        if (candidate?.config) {
            pageData = candidate;
            break;
        }
    }
    if (!pageData.config) {
        console.warn(`[WhatsApp Echo] No config found for lookup keys: ${lookupKeys.join(', ')}`);
        return;
    }

    const effectiveSessionName = pageData.config.session_name || `official_${phoneNumberId || wabaId}`;

    // Save Admin Reply to DB (Async - Fire and Forget)
    dbService.saveWhatsAppChat({
        session_name: effectiveSessionName,
        sender_id: effectiveSessionName,
        recipient_id: senderId,
        message_id: messageId,
        text: text,
        timestamp: Date.now(),
        status: 'sent',
        reply_by: 'admin'
    }).catch(() => {});

    // Save to AI Context Memory (Async)
    const echoSessionId = `${effectiveSessionName}_${senderId}`;
    dbService.saveChatMessage(echoSessionId, 'assistant', text, messageId).catch(() => {});

    // --- INSTANT EMOJI LOCK CHECK ---
    const { config: controlConfig, prompts } = pageData;
    if (prompts && text) {
        const lockList = [
            prompts.lock_emojis,
            controlConfig.lock_emojis,
            prompts.block_emoji,
            controlConfig.block_emoji
        ].filter(Boolean).join(' ').split(/[, ]+/).map(e => e.trim()).filter(e => e && e.length > 0);
        const unlockList = [
            prompts.unlock_emojis,
            controlConfig.unlock_emojis,
            prompts.unblock_emoji,
            controlConfig.unblock_emoji
        ].filter(Boolean).join(' ').split(/[, ]+/).map(e => e.trim()).filter(e => e && e.length > 0);

        let isLocked = lockList.some(e => text.includes(e));
        let isUnlocked = !isLocked && unlockList.some(e => text.includes(e));

        if (isLocked) {
            await dbService.toggleWhatsAppLock(effectiveSessionName, senderId, true);
            console.log(`[WhatsApp Handover Lock] Session ${effectiveSessionName} locked chat for User ${senderId} via emoji.`);
        } else if (isUnlocked) {
            await dbService.toggleWhatsAppLock(effectiveSessionName, senderId, false);
            console.log(`[WhatsApp Handover Lock] Session ${effectiveSessionName} unlocked chat for User ${senderId} via emoji.`);
        }
    }
}

async function processWhatsAppWebhook(body) {
    console.log(`[WhatsApp Webhook] Processing ${body.entry?.length || 0} entries...`);
    console.log(`[WhatsApp Webhook] Full body: ${JSON.stringify(body, null, 2)}`);
    for (const entry of body.entry || []) {
        const wabaId = entry.id;
        for (const change of entry.changes || []) {
            const value = change.value || {};
            const phoneNumberId = value.metadata?.phone_number_id;

            if (change.field === 'smb_message_echoes') {
                // Handle WhatsApp Cloud API Echo (admin/bot replies
                for (const echo of value.message_echoes || []) {
                    await processWhatsAppEcho(echo, phoneNumberId, wabaId, value.metadata);
                }
                continue;
            }

            if (change.field !== 'messages') continue;

            const groupedMessages = new Map();

            // Handle incoming messages from users
            for (const message of value.messages || []) {
                const messageId = message.id;
                console.log(`[WhatsApp Webhook] Evaluating message ID: ${messageId}`);
                
                // Use checkWhatsAppDuplicate which is the specialized version for WhatsApp
                const isDuplicate = await dbService.checkWhatsAppDuplicate(messageId);
                console.log(`[WhatsApp Webhook] Duplicate check for ${messageId}: ${isDuplicate}`);
                
                if (isDuplicate) {
                    continue;
                }

                const senderId = message.from;
                const senderName = value.contacts?.[0]?.profile?.name || 'Unknown';
                console.log(`[WhatsApp Webhook] Inbound from ${senderName} (${senderId}). Type: ${message.type}`);

                const lookupKeys = [
                    phoneNumberId,
                    wabaId,
                    phoneNumberId ? `official_${phoneNumberId}` : null,
                    wabaId ? `official_${wabaId}` : null
                ].filter(Boolean);

                let pageData = { config: null, prompts: null };
                for (const lookupKey of lookupKeys) {
                    const candidate = await getCachedPageData(lookupKey);
                    if (candidate?.config) {
                        pageData = candidate;
                        break;
                    }
                }

                if (!pageData.config) {
                    console.warn(`[WhatsApp Webhook] No config found for lookup keys: ${lookupKeys.join(', ')}`);
                    continue;
                }

                const batchKey = `${senderId}:${pageData.config.session_name || pageData.config.waba_id || wabaId || phoneNumberId}`;
                const existingBatch = groupedMessages.get(batchKey) || {
                    messages: [],
                    config: pageData.config,
                    prompts: pageData.prompts,
                    senderName,
                    senderId,
                    wabaId,
                    phoneNumberId
                };

                existingBatch.messages.push(message);
                groupedMessages.set(batchKey, existingBatch);
            }

            // Handle outgoing messages from the business (admin replies)
            for (const status of value.statuses || []) {
                console.log(`[WhatsApp Webhook] Received status update: ${JSON.stringify(status, null, 2)}`);
            }

            for (const batch of groupedMessages.values()) {
                console.log(`[WhatsApp Webhook] Queueing batch for ${batch.senderId} (${batch.messages.length} msgs)`);
                queueWhatsAppBatch(batch);
            }
        }
    }
}

// WhatsApp Webhook Event Listener (POST)
const handleWhatsAppWebhook = async (req, res) => {
    const body = req.body;

    // Log incoming payload to monitor cache (In-Memory)
    addWebhookLog(body);

    // --- REALTIME OPTIMIZATION: Respond Immediately ---
    res.status(200).send('EVENT_RECEIVED');

    // --- CRITICAL DEBUG LOG ---
    console.log(`[WhatsApp Webhook] Triggered at ${new Date().toISOString()}`);
    // --------------------------

    if (body.object !== 'whatsapp_business_account') {
        return;
    }

    // Execute processing in background
    (async () => {
        try {
            console.log(`[WhatsApp Webhook] Starting background processing...`);
            await processWhatsAppWebhook(body);
        } catch (err) {
            console.error(`[WhatsApp Webhook] Background Error:`, err);
        }
    })();
};

// Queue Message for Debounce
async function queueMessage(event, entryPageId = null) {
    // --- DEBUG: Log Incoming Event to see why echoes fail ---
    if (event.message && event.message.is_echo) {
        console.log(`[Echo Debug] RAW PAYLOAD:`, JSON.stringify(event));
    }

    // --- ECHO HANDLING (Admin Replies & Bot Confirmations) ---
    const senderIdRaw = event.sender?.id;
    const recipientIdRaw = event.recipient?.id;
    const isAppEcho = Boolean(event.message?.is_echo && event.message?.app_id);
    
    // Robust Admin Detection:
    // 1. Explicit Echo flag
    // 2. Sender is the Page itself (matched against Entry ID)
    // 3. Sender same as Recipient (Self-message case)
    // 4. Sender is a known Page in DB (Fallback)
    
    let isAdminSender = false;
    
    // Check 1 & 2 & 3
    if (event.message?.is_echo || senderIdRaw === entryPageId || senderIdRaw === recipientIdRaw) {
        isAdminSender = true;
    } 
    // Check 4 (Fallback DB Check) - Only if not already identified
    else if (event.message && senderIdRaw && recipientIdRaw) {
        // Optimization: Use in-memory cache check for known pages
        if (allowedPagesCache.has(senderIdRaw)) {
            isAdminSender = true;
        } else {
            // Fallback: Check configCache (faster than DB)
            const cached = configCache.get(senderIdRaw);
            if (cached && cached.config) {
                isAdminSender = true;
            }
        }
    }

    if (event.message && isAdminSender) {
        // IMPORTANT: In Echo, Sender = Page, Recipient = User
        const pageId = senderIdRaw; 
        const messageRecipientId = recipientIdRaw; 
        const messageId = event.message.mid;
        const text = (event.message.text || '').trim();

        // --- SMART ECHO FILTER (Memory + DB) ---
        // 1. Check Memory first (Instant)
        const recentReplies = recentBotReplies.get(messageRecipientId);
        if (recentReplies && text) {
            const normalizedIncoming = normalizeText(text);
            const isEcho = recentReplies.some(reply => {
                const timeDiff = Date.now() - reply.timestamp;
                return timeDiff < 20000 && reply.text === normalizedIncoming;
            });
            if (isEcho) {
                console.log(`[Echo] Blocked (Memory Match): ${text.substring(0, 20)}...`);
                return;
            }
        }

        // 2. Check DB (Fallback)
        try {
            const recentOutgoingDbMatch = text
                ? await hasRecentOutgoingFbMatch(pageId, messageRecipientId, text, ['bot', 'system'])
                : false;

            if (isAppEcho && recentOutgoingDbMatch) {
                console.log(`[Echo] Blocked app echo by recent DB outgoing match: ${text.substring(0, 20)}...`);
                return;
            }

            const existingChat = await dbService.getFbChatById(messageId);
            if (existingChat && (existingChat.reply_by === 'bot' || existingChat.reply_by === 'system')) {
                return; 
            }

            if (recentOutgoingDbMatch) {
                console.log(`[Echo] Blocked by DB text match: ${text.substring(0, 20)}...`);
                return;
            }

            console.log(`[Echo] ADMIN ACTION DETECTED: Page ${pageId} -> User ${messageRecipientId}. Text: ${text.substring(0, 20)}...`);

            // Save Admin Reply to DB (Async - Fire and Forget)
            dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId, 
                recipient_id: messageRecipientId, 
                message_id: messageId,
                text: text,
                timestamp: Date.now(),
                status: 'sent',
                reply_by: 'admin'
            }).catch(() => {});

            // Save to AI Context Memory (Async)
            const echoSessionId = `${pageId}_${messageRecipientId}`;
            dbService.saveChatMessage(echoSessionId, 'assistant', text, messageId).catch(() => {});

            // --- INSTANT EMOJI LOCK CHECK ---
            const pageData = await getCachedPageData(pageId);
            const pagePrompts = pageData?.prompts;
            if (pagePrompts && text) {
                const cleanText = normalizeText(text);
                const lockList = [pagePrompts.block_emoji, pagePrompts.lock_emojis, pagePrompts.block_emojis].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeText(e.trim())).filter(e => e);
                const unlockList = [pagePrompts.unblock_emoji, pagePrompts.unlock_emojis, pagePrompts.unblock_emojis].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeText(e.trim())).filter(e => e);

                let isLocked = lockList.some(e => cleanText.includes(e));
                let isUnlocked = !isLocked && unlockList.some(e => cleanText.includes(e));

                if (isLocked) {
                    await dbService.toggleFbLock(pageId, messageRecipientId, true);
                    console.log(`[Handover Lock] Page ${pageId} locked chat for User ${messageRecipientId} via emoji.`);
                    // REGISTER BOT REPLY to avoid echo loop since we are about to send this 
                    trackBotReply(messageRecipientId, text);
                    // SEND the emoji to customer
                    await facebookService.sendMessage(pageId, messageRecipientId, text, pageData.config.page_access_token);
                } else if (isUnlocked) {
                    await dbService.toggleFbLock(pageId, messageRecipientId, false);
                    console.log(`[Handover Lock] Page ${pageId} unlocked chat for User ${messageRecipientId} via emoji.`);
                    // No need to send anything for unlock usually, or you can send it if you want.
                    // For consistency with your request "bot lock emoji send korlo seta sent hobe", 
                    // we send the unlock emoji too if the admin/bot sent it.
                    trackBotReply(messageRecipientId, text);
                    await facebookService.sendMessage(pageId, messageRecipientId, text, pageData.config.page_access_token);
                }
            }
        } catch (err) {
            console.error(`[Echo Error] Failed to process admin reply:`, err.message);
        }

        return; 
    }
    // ---------------------------------------------------------

    const senderId = event.sender.id;
    const pageId = event.recipient.id || entryPageId; // Always prioritize FB recipient ID for messaging
    console.log(`[Webhook DEBUG] Event for Page: ${pageId} | Sender: ${senderId}`);
    let messageText = event.message?.text || '';
    const messageId = event.message?.mid || `evt_${Date.now()}`;

    // --- EXTRACT AD/REFERRAL DATA ---
    // This handles "Get Started" or "Send Message" clicks from Ads
    let referralData = null;
    if (event.referral) {
        referralData = event.referral;
    } else if (event.postback && event.postback.referral) {
        referralData = event.postback.referral;
    }
    
    if (referralData) {
        const adSource = referralData.source || 'ad';
        const adRef = referralData.ref || 'unknown';
        const adId = referralData.ad_id || 'unknown';
        console.log(`[Webhook] Referral/Ad Detected. Source: ${adSource}, Ref: ${adRef}, Ad ID: ${adId}`);
        
        // Append to text for AI visibility (if not already there)
        // We push this as a separate system note in the buffer logic
    }
    // --------------------------------

    // 1. Handle Postback (Button Clicks)
    if (event.postback) {
        // PRIORITIZE PAYLOAD, THEN TITLE. Ensure it's a string.
        messageText = event.postback.payload || event.postback.title || '';
        if (typeof messageText !== 'string') {
            messageText = JSON.stringify(messageText);
        }
        const logMsg = `[Webhook] Received Postback. Page: ${pageId}, Sender: ${senderId}, Payload: ${messageText}`;
        console.log(logMsg);
        logToFile(logMsg);
    } else {
        const logMsg = `[Webhook] Received Message. Page: ${pageId}, Sender: ${senderId}, Text: ${messageText}`;
        console.log(logMsg);
        logToFile(logMsg);
    }

    // 2. Handle Attachments (Images & Stickers)
    let hasSticker = false;
    if (event.message?.attachments) {
        // DETECT STICKERS: Facebook sends stickers as images but with a sticker_id
        hasSticker = event.message.attachments.some(att => att.payload && att.payload.sticker_id);
        
        const imageUrls = event.message.attachments
            .filter(att => att.type === 'image' && !att.payload.sticker_id) // ONLY real images (no stickers)
            .map(att => att.payload.url);
        
        if (imageUrls.length > 0) {
            console.log(`[Webhook] Image URLs Queued: ${imageUrls.length}`);
        }

        // 3. Handle Audio (Voice Messages) - DEFERRED PROCESSING
        const audioUrls = event.message.attachments
            .filter(att => att.type === 'audio')
            .map(att => att.payload.url);
            
        if (audioUrls.length > 0) {
            console.log(`[Webhook] Audio URLs Queued: ${audioUrls.length}`);
        }

        // Handle other attachments (file, video) placeholders
        const otherAtts = event.message.attachments.filter(att => att.type !== 'image' && att.type !== 'audio');
        if (otherAtts.length > 0) {
             messageText += `\n[User sent attachments: ${otherAtts.map(a => a.type).join(', ')}]`;
        }
    }

    if (!messageText && !event.message?.attachments) return; // Ignore if empty and no attachments

    const replyToId = event.message?.reply_to?.mid || null;
    const isSwipeReply = !!replyToId;
    const triggerTimestamp = Date.now();

    // --- SAVE USER MESSAGE TO fb_chats (Background - Non-Blocking) ---
    // User Instructions: Fire and forget to reduce latency
    const initialImageUrls = event.message?.attachments?.filter(att =>
        att.type === 'image' && !att.payload?.sticker_id
    ).map(att => att.payload.url).filter(Boolean) || [];
    const initialAudioUrls = event.message?.attachments?.filter(att =>
        att.type === 'audio' ||
        (att.type === 'file' && att.payload?.url && /\.(mp3|wav|ogg|m4a|aac|mp4)(\?|$)/i.test(att.payload.url))
    ).map(att => att.payload.url).filter(Boolean) || [];
    let rawLogText = messageText || (hasSticker ? '[Sticker]' : '[Media Message]');
    if (initialImageUrls.length > 0) rawLogText += `\n[Image URLs]: ${initialImageUrls.join(', ')}`;
    if (initialAudioUrls.length > 0) rawLogText += `\n[Audio URLs]: ${initialAudioUrls.join(', ')}`;
    dbService.saveFbChat({
        page_id: pageId,
        sender_id: senderId,
        recipient_id: pageId,
        message_id: messageId,
        text: rawLogText, 
        timestamp: Date.now(),
        status: 'received',
        reply_by: 'user'
    }).catch(err => console.error(`Error saving to fb_chats (Page: ${pageId}, Msg: ${messageId}):`, err.message));

    // -------------------------------------------------

    const sessionId = `${pageId}_${senderId}`;

    // --- EXTRACT MEDIA (Moved up for early cache check) ---
    const thisMsgImages = event.message?.attachments?.filter(att => 
        att.type === 'image' && !att.payload?.sticker_id
    ).map(att => att.payload.url) || [];
    
    const thisMsgAudios = event.message?.attachments?.filter(att => 
        att.type === 'audio' || 
        (att.type === 'file' && att.payload?.url && /\.(mp3|wav|ogg|m4a|aac|mp4)(\?|$)/i.test(att.payload.url))
    ).map(att => att.payload.url) || [];

    // --- EARLY SEMANTIC CACHE CHECK (Instant Path) ---
    // If this is the first message and not media, check cache immediately to bypass debounce.
    const isFirstMessage = !debounceMap.has(sessionId);
    const hasMediaInThisMsg = thisMsgImages.length > 0 || thisMsgAudios.length > 0;
    
    if (isFirstMessage && !hasMediaInThisMsg && messageText && messageText.trim()) {
        const pageData = await getCachedPageData(pageId);
        const pageConfig = pageData?.config;
        if (pageConfig && (pageConfig.semantic_cache_enabled === true || pageConfig.semantic_cache_enabled === 1)) {
            const threshold = pageConfig.semantic_cache_threshold ? Math.max(0.5, Math.min(0.99, Number(pageConfig.semantic_cache_threshold))) : 0.96;
            const cacheQuery = messageText.trim().replace(/\s+/g, ' ');
            
            try {
                // Fetch Context (last_product_id) to make cache intelligent
                const state = await dbService.getConversationState(pageId, senderId);
                const contextId = state?.last_product_id || null;

                const cached = await dbService.findSemanticCache({
                    page_id: pageId,
                    session_name: pageId,
                    context_id: contextId,
                    question: cacheQuery,
                    threshold
                });

                if (cached) {
                    console.log(`[FB] ⚡ ULTRA-FAST CACHE HIT! (Context: ${contextId || 'None'})`);
                    
                    // Check if admin replied after last user message
                    const lastUserTs = await dbService.getLastFbUserMessageTimestamp(pageId, senderId);
                    const checkTs = lastUserTs || triggerTimestamp;
                    const hasAdminReplied = await dbService.hasFbAdminReplySince(pageId, senderId, checkTs);
                    
                    if (hasAdminReplied) {
                        console.log(`[FB] Bot skipped: Admin replied before send to ${senderId}`);
                        // Save skipped status to DB for visibility
                        const pendingMessageId = `bot_skip_${Date.now()}`;
                        await saveFbOutgoingLog({
                            pageId,
                            recipientId: senderId,
                            messageId: pendingMessageId,
                            text: '[Bot skipped: Admin replied before send]',
                            status: 'skipped_admin_reply',
                            replyBy: 'bot',
                            token: 0,
                            aiModel: 'semantic-cache'
                        });
                        return;
                    }
                    
                    const pendingMessageId = `cache_${Date.now()}`;
                    await saveFbOutgoingLog({
                        pageId,
                        recipientId: senderId,
                        messageId: pendingMessageId,
                        text: cached,
                        status: 'sending',
                        replyBy: 'bot',
                        aiModel: 'semantic-cache'
                    });
                    trackBotReply(senderId, cached);
                    await facebookService.sendMessage(pageId, senderId, cached, pageConfig.page_access_token);
                    await saveFbOutgoingLog({
                        pageId,
                        recipientId: senderId,
                        messageId: pendingMessageId,
                        text: cached,
                        status: 'sent',
                        replyBy: 'bot',
                        aiModel: 'semantic-cache'
                    });
                    
                    return; // EXIT EARLY
                }
            } catch (e) {
                console.warn(`[FB] Early cache check failed:`, e.message);
            }
        }
    }
    // --------------------------------------------------

    // Initialize buffer if not exists
    if (!debounceMap.has(sessionId)) {
        debounceMap.set(sessionId, { messages: [], timer: null, isProcessing: false });
    }

    const sessionData = debounceMap.get(sessionId);
    
    // Extract URLs for this specific message (ALREADY EXTRACTED ABOVE)

    // Push Object
    sessionData.messages.push({
        id: messageId,
        text: messageText,
        reply_to: replyToId,
        images: thisMsgImages,
        audios: thisMsgAudios,
        isSticker: hasSticker, // Mark if this specific message was a sticker
        isPostback: !!event.postback,
        referral: referralData,
        timestamp: triggerTimestamp
    });

    console.log(`Queued message for ${sessionId}. Buffer size: ${sessionData.messages.length} (Processing: ${sessionData.isProcessing})`);
    
    // If we are currently processing this session, just append the message to the buffer.
    // The existing 'finally' block in processBufferedMessages will pick it up after finishing the current call.
    if (sessionData.isProcessing) {
        console.log(`[Debounce] Session ${sessionId} is busy processing. Message appended to current buffer.`);
        return;
    }

    if (sessionData.timer) {
        clearTimeout(sessionData.timer); 
    }

    // Dynamic Debounce from Cache/DB
    const pageData = await getCachedPageData(pageId);
    const pagePrompts = pageData?.prompts;
    let debounceTime = 8000; // Default 8s
    if (pagePrompts && pagePrompts.wait !== undefined) {
        debounceTime = Number(pagePrompts.wait) * 1000; 
    }
    
    if (debounceTime < 0) debounceTime = 0; 

    console.log(`[Debounce] Using wait time: ${debounceTime}ms for ${sessionId}`);

    sessionData.timer = setTimeout(() => {
        sessionData.isProcessing = true;
        const messagesToProcess = [...sessionData.messages];
        // Clear the internal buffer we just copied
        sessionData.messages = [];

        let isFinalized = false;
        const finalizeSessionRun = () => {
            if (isFinalized) return;
            isFinalized = true;

            const remaining = debounceMap.get(sessionId);
            if (remaining && remaining.messages.length > 0) {
                console.log(`[Debounce] Session ${sessionId} has ${remaining.messages.length} new messages after processing. Re-triggering.`);
                remaining.isProcessing = false;
                remaining.timer = setTimeout(() => {
                    const nextBatch = [...remaining.messages];
                    remaining.messages = [];
                    remaining.isProcessing = true;
                    processBufferedMessages(sessionId, pageId, senderId, nextBatch)
                        .finally(() => {
                            const stillRemaining = debounceMap.get(sessionId);
                            if (!stillRemaining || stillRemaining.messages.length === 0) {
                                debounceMap.delete(sessionId);
                            } else {
                                stillRemaining.isProcessing = false;
                            }
                        });
                }, 2000);
            } else {
                debounceMap.delete(sessionId);
            }
        };

        const stuckSessionTimer = setTimeout(() => {
            const current = debounceMap.get(sessionId);
            if (current) {
                console.error(`[Debounce] Session ${sessionId} exceeded processing window. Releasing busy lock.`);
                current.isProcessing = false;
            }
            finalizeSessionRun();
        }, AI_REQUEST_BUDGET_MS + 2000);

        schedulePageTask(pageId, async () => {
            try {
                await processBufferedMessages(sessionId, pageId, senderId, messagesToProcess);
            } finally {
                clearTimeout(stuckSessionTimer);
                finalizeSessionRun();
            }
        });
    }, debounceTime); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, pageId, senderId, messages) {
    // 1. Fetch Config (Fast Path)
    const pageData = await getCachedPageData(pageId);
    const pageConfig = pageData?.config;
    const pagePrompts = pageData?.prompts;
    // Get trigger timestamp from first message
    const triggerTimestamp = messages[0]?.timestamp || Date.now();
    
    if (!pageConfig) {
        console.warn(`[AI] Page ${pageId} config not found in cache. This might be a temporary error.`);
        return;
    }

    try {
        // Reconstruct Combined Message & Extract Metadata
        let combinedText = "";
        let replyToId = null;
        let allImages = [];
        let allAudios = [];
        let hasPostback = false;
        let adContext = "";
        let adId = null;

        try {
            const workflowResult = runMessengerWorkflow(messages);
            combinedText = workflowResult.combinedText || "";
            replyToId = workflowResult.replyToId || null;
            allImages = workflowResult.allImages || [];
            allAudios = workflowResult.allAudios || [];
            hasPostback = workflowResult.hasPostback || false;
            adContext = workflowResult.adContext || "";
            adId = workflowResult.adId || null;

            const allStickers = messages.filter(m => m.isSticker);
            const hasOnlyStickers = allStickers.length > 0 && 
                                    allStickers.length === messages.length && 
                                    !combinedText.trim() && 
                                    allImages.length === 0 && 
                                    allAudios.length === 0;
            
            // --- STICKER GATEKEEPER ---
            if (hasOnlyStickers) {
                return;
            }
        } catch (wfError) {
            combinedText = messages.map(m => m.text).filter(Boolean).join("\n");
            allImages = messages.flatMap(m => m.images || []);
            allAudios = messages.flatMap(m => m.audios || []);
        }

        const hasAudioTurn = allAudios.length > 0;
        const delayedAudioHistoryMessageId = hasAudioTurn
            ? `audio_turn_${messages.map(m => m.id).filter(Boolean).join('_') || Date.now()}`
            : null;

        // --- QUICK SEMANTIC CACHE CHECK (ULTRA-FAST PATH) ---
        const semEnabled = pageConfig.semantic_cache_enabled === true || pageConfig.semantic_cache_enabled === 1;
        const threshold = pageConfig.semantic_cache_threshold ? Math.max(0.5, Math.min(0.99, Number(pageConfig.semantic_cache_threshold))) : 0.96;
        const isMediaTurn = allImages.length > 0 || hasAudioTurn;
        
        // IMPORTANT: Use workflow combinedText (raw user text) for cache check, EXCLUDING adContext
        if (semEnabled && !isMediaTurn && combinedText.trim()) {
            try {
                // Normalize for better cache matching
                const cacheQuery = combinedText.trim().replace(/\s+/g, ' ');
                
                const cached = await dbService.findSemanticCache({
                    page_id: pageId,
                    session_name: pageId,
                    question: cacheQuery,
                    threshold
                });

                if (cached) {
                    console.log(`[FB] ⚡ INSTANT CACHE HIT!`);
                    
                    // Check if admin replied after last user message
                    const lastUserTs = await dbService.getLastFbUserMessageTimestamp(pageId, senderId);
                    const checkTs = lastUserTs || triggerTimestamp;
                    const hasAdminReplied = await dbService.hasFbAdminReplySince(pageId, senderId, checkTs);
                    
                    if (hasAdminReplied) {
                        console.log(`[FB] Bot skipped: Admin replied before send to ${senderId}`);
                        const pendingMessageId = `bot_skip_${Date.now()}`;
                        await saveFbOutgoingLog({
                            pageId,
                            recipientId: senderId,
                            messageId: pendingMessageId,
                            text: '[Bot skipped: Admin replied before send]',
                            status: 'skipped_admin_reply',
                            replyBy: 'bot',
                            token: 0,
                            aiModel: 'semantic-cache'
                        });
                        return;
                    }
                    
                    const pendingMessageId = `cache_${Date.now()}`;
                    await saveFbOutgoingLog({
                        pageId,
                        recipientId: senderId,
                        messageId: pendingMessageId,
                        text: cached,
                        status: 'sending',
                        replyBy: 'bot',
                        aiModel: 'semantic-cache'
                    });
                    
                    // Register bot reply in memory BEFORE sending to block the echo
                    trackBotReply(senderId, cached);
                    
                    // Instant FB Send
                    await facebookService.sendMessage(pageId, senderId, cached, pageConfig.page_access_token);
                    
                    await saveFbOutgoingLog({
                        pageId,
                        recipientId: senderId,
                        messageId: pendingMessageId,
                        text: cached,
                        status: 'sent',
                        replyBy: 'bot',
                        aiModel: 'semantic-cache'
                    });
                    
                    return; 
                }
            } catch (cacheErr) {
                console.warn(`[FB] Early cache check failed: ${cacheErr.message}`);
            }
        }
        // ----------------------------------------------------
        
        // --- SAVE USER MESSAGES TO DB (Background) ---
        for (const msg of messages) {
            const hasContent = (msg.text && msg.text.trim()) || (msg.images && msg.images.length > 0) || (msg.audios && msg.audios.length > 0);
            if (!hasContent) continue;
            
            let msgText = msg.text || "";
            if (msg.images && msg.images.length > 0) msgText += ` [Images: ${msg.images.length}]`;
            if (msg.audios && msg.audios.length > 0) msgText += ` [Audio: ${msg.audios.length}]`;

            dbService.saveFbChat({
                page_id: pageId,
                sender_id: senderId,
                recipient_id: pageId,
                message_id: msg.id,
                text: msgText,
                timestamp: Date.now(),
                status: 'received',
                reply_by: 'user'
            }).catch(() => {});

            const hasAudioMessage = Array.isArray(msg.audios) && msg.audios.length > 0;
            if (!hasAudioMessage) {
                dbService.saveChatMessage(sessionId, 'user', msgText, msg.id).catch(() => {});
            }
        }
        // -------------------------------------------

    const normalizedForEmojiCheck = combinedText.replace(/\s/g, '');
    const hasAlphaNumericOrBangla = /[A-Za-z0-9\u0980-\u09FF]/.test(normalizedForEmojiCheck);
    const hasQuestionMark = normalizedForEmojiCheck.includes('?');
    const hasMediaContext = allImages.length > 0 || allAudios.length > 0 || !!replyToId;

    // --- LOCK EMOJI GATEKEEPER BYPASS ---
    // If the message contains a lock emoji, we want to allow it through to process the lock logic,
    // but still block other pure emoji messages.
    const pageDataForEmoji = await getCachedPageData(pageId);
    const lockList = [pageDataForEmoji?.prompts?.block_emoji, pageDataForEmoji?.prompts?.lock_emojis, pageDataForEmoji?.prompts?.block_emojis].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeText(e.trim())).filter(e => e);
    const hasLockEmoji = lockList.some(e => normalizeText(normalizedForEmojiCheck).includes(e));

    if (!hasAlphaNumericOrBangla && !hasQuestionMark && !hasMediaContext && normalizedForEmojiCheck.length > 0 && !hasLockEmoji) {
        const logMsg = `[Emoji Gatekeeper] Blocked emoji-only message for ${sessionId}.`;
        console.log(logMsg);
        logToFile(logMsg);
        return;
    }

    // If this is a swipe-reply, fetch quoted message text by ID for context
    // REMOVED: This logic is now handled in the main reply generation block to avoid duplication.
    // if (replyToId) { ... }

    console.log(`Processing buffered messages for ${sessionId}. Text: ${combinedText.substring(0,50)}... Images: ${allImages.length}, Audios: ${allAudios.length}`);

        // 2. Check Subscription Status (Active/Trial)
        // SaaS Level Credit Check: Daily -> Monthly -> Bonus -> Free -> Permanent
        const hasDaily = Number(pageConfig.daily_limit || 0) > Number(pageConfig.daily_used || 0);
        const hasMonthly = Number(pageConfig.monthly_limit || 0) > Number(pageConfig.monthly_used || 0);
        const hasBonus = Number(pageConfig.bonus_credit || 0) > 0;
        const hasLegacy = Number(pageConfig.message_credit || 0) > 0;
        const hasPermanent = Number(pageConfig.permanent_credit || 0) > 0;

        const hasAnyCredit = (hasDaily || hasMonthly || hasBonus || hasLegacy || hasPermanent);
        
        // Own API Logic: If user provided a real key (not managed), they can use it even if 0 credits.
        const hasOwnKey = pageConfig.api_key && 
                          pageConfig.api_key !== 'MANAGED_SECRET_KEY' && 
                          !pageConfig.api_key.startsWith('salesman_') &&
                          pageConfig.cheap_engine === false;
        
        // Allow if they have Credit OR Own Key, regardless of subscription_status (unless banned)
        const isBanned = pageConfig.subscription_status === 'banned';

        if (isBanned || (!hasAnyCredit && !hasOwnKey)) {
             const logMsg = `Page ${pageConfig.page_id} blocked. Status: ${pageConfig.subscription_status}, Credits: D:${pageConfig.daily_limit} M:${pageConfig.monthly_limit} B:${pageConfig.bonus_credit} P:${pageConfig.permanent_credit}, OwnKey: ${!!hasOwnKey}`;
             console.log(logMsg);
             logToFile(logMsg);
             // Log System Error to DB for visibility
             await dbService.saveFbChat({
                 page_id: pageId,
                 sender_id: pageId,
                 recipient_id: senderId,
                 message_id: `sys_${Date.now()}`,
                 text: `[SYSTEM ERROR] Out of Credits. Please recharge to continue using AI.`,
                 timestamp: Date.now(),
                 status: 'system_error',
                 reply_by: 'system'
             });
             return;
        }
        
        // --- CREDIT CHECK LOGIC (Modified for Cheap Engine vs Own API) ---
        // Default to TRUE (Cheap Engine) if undefined, for backward compatibility
        const isCheapEngine = pageConfig.cheap_engine !== false; 

        if (isCheapEngine) {
            // CHEAP ENGINE: Must have credits
            if (!hasAnyCredit) {
                const logMsg = `Page ${pageId} out of credits (Cheap Engine Active). (Source: ${pageConfig.credit_source || 'page_balance'})`;
                console.log(logMsg);
                logToFile(logMsg);
                // Log System Error to DB for visibility
                await dbService.saveFbChat({
                    page_id: pageId,
                    sender_id: pageId,
                    recipient_id: senderId,
                    message_id: `sys_${Date.now()}`,
                    text: `[SYSTEM ERROR] Out of Credits. Reply Halted.`,
                    timestamp: Date.now(),
                    status: 'system_error',
                    reply_by: 'system'
                });
                return; // STOP Processing
            }
        } else {
            // OWN API: Ignore credit check (Allow even if 0)
            console.log(`Page ${pageId} using Own API. Bypassing credit check.`);
        }
        // -----------------------------------------------------------------

        // --- FAILURE LOCK CHECK ---
        // User Requirement: Lead save korar poreo jeno kotha bole.
        // Handover lock should ONLY block if it was manually set by admin or emoji, 
        // NOT just because a lead was captured.
        const isLocked = await dbService.checkFbLockStatus(pageId, senderId);
        if (isLocked) {
            const logMsg = `[Handover Lock] AI is permanently disabled for ${senderId} on Page ${pageId}.`;
            console.log(logMsg);
            if (typeof logToFile === 'function') logToFile(logMsg);
            return;
        }
        // --------------------------

        // --- OPTIMIZATION: PARALLEL DATA FETCHING (Modified for Dynamic History) ---
        // 1. Fetch Page Prompts FIRST to get the 'check_conversion' (History Limit)
        // This ensures we only fetch exactly what the user configured (Token Saving)
        if (pagePrompts) {
            const promptSnippet = pagePrompts.text_prompt ? pagePrompts.text_prompt.substring(0, 100).replace(/\n/g, ' ') : "EMPTY";
            console.log(`[AI Context Check] Page: ${pageId} | Prompt Snippet: "${promptSnippet}..."`);
        } else {
            console.warn(`[AI Context Check] Page: ${pageId} | NO PROMPT FOUND IN DB!`);
        }

        // Determine History Limit (User Setting or Default 10)
        // "check_conversion" is the setting for Context Memory Limit (1-50)
        // User Requirement: This limit applies to BOTH text and image memory.
        let historyLimit = 20; // Default safe limit
        if (pagePrompts && pagePrompts.check_conversion) {
            historyLimit = parseInt(pagePrompts.check_conversion, 10);
            if (isNaN(historyLimit) || historyLimit < 1) historyLimit = 20;
        }
        console.log(`[Context] Dynamic History Limit: ${historyLimit} (Source: ${pagePrompts ? 'DB' : 'Default'})`);

        // 1. STICKER & EMOJI GATEKEEPER
        const hasOnlyStickers = messages.every(m => m.isSticker === true);
        const combinedRawText = messages.map(m => m.text).filter(Boolean).join(' ').trim();
        
        // --- RELAXED GATEKEEPER ---
        // We only block if it's strictly Emojis/Stickers AND has no special intent characters like ?, !, .
        // "???" or "..." often mean the user is waiting or confused, so the AI should respond.
        const hasNoAlphanumeric = combinedRawText && !/[a-zA-Z0-9\u0980-\u09FF]/.test(combinedRawText);
        const hasNoSpecialPunctuation = combinedRawText && !/[?!.]/.test(combinedRawText);

        if (hasOnlyStickers || (combinedRawText && hasNoAlphanumeric && hasNoSpecialPunctuation && messages.every(m => !m.images?.length))) {
            console.log(`[Gatekeeper] Blocking reply for strictly stickers/emojis only from ${senderId}`);
            debounceMap.delete(sessionId);
            return;
        }

        console.log("Fetching remaining context data in parallel...");
        
        // 2. Fetch the rest in parallel using the dynamic limit
        const [userProfile, fbMessages, history] = await Promise.all([
            facebookService.getUserProfile(senderId, pageConfig.page_access_token),
            facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 10), // For Handover Check
            dbService.getChatHistory(sessionId, historyLimit)
        ]);

        // --- FETCH SMART AD CONTEXT ---
        let smartAdContext = "";
        if (adId && adId !== 'N/A') {
            try {
                const adData = await dbService.getAdContext(adId, pageId);
                if (adData) {
                    let contextObj = {
                        type: 'ad_referral',
                        description: adData.description || 'N/A',
                        linked_products: []
                    };
                    
                    if (adData.linked_product_ids && Array.isArray(adData.linked_product_ids) && adData.linked_product_ids.length > 0) {
                        for (const pId of adData.linked_product_ids) {
                            const p = await dbService.getProductById(pId);
                            if (p) {
                                contextObj.linked_products.push({
                                    id: p.id,
                                    name: p.name,
                                    price: p.price,
                                    currency: p.currency || 'BDT',
                                    discount_price: p.discount_price || null
                                });
                            }
                        }
                    }
                    smartAdContext = `\n<system_hidden_context>\n${JSON.stringify(contextObj, null, 2)}\nInstruction: The user clicked on this ad. Treat the linked products as current context. If they ask about price/details without specifying a product, assume they mean these linked products.\n</system_hidden_context>\n`;
                    console.log(`[Ad Library] Injected smart context for Ad ID: ${adId}`);
                }
            } catch (adErr) {
                console.warn(`[Ad Library] Failed to fetch context for ${adId}:`, adErr.message);
            }
        }
        // ------------------------------

        const senderName = userProfile.name || 'Customer';
        const senderGender = userProfile.gender || null;
        
        // --------------------------------------------

        // --- BATCH PROCESSING: IMAGES & AUDIO ---
        // Now we process all media together BEFORE generating the reply.
        
        // Track Token Usage for Aggregation
        let totalVisionTokens = 0;
        let totalAudioTokens = 0;
        
        // A. Process Images (Vision)
        const allVideos = [];
        const TOO_MANY_IMAGES_THRESHOLD = 10;
        const hasVideo = allVideos.length > 0;
        const tooManyImages = allImages.length > TOO_MANY_IMAGES_THRESHOLD;

        if (hasVideo || tooManyImages) {
             console.log(`[Optimization] Skipping Vision Analysis. Video: ${hasVideo}, Images: ${allImages.length}`);
             await dbService.setConversationState(pageId, senderId, {
                 last_image_map: null,
                 last_image_batch_id: `fb_img_skipped_${Date.now()}`,
                 last_intent: 'image_analysis_skipped'
             });
             const reason = hasVideo ? "User sent a video." : `User sent ${allImages.length} images.`;
             combinedText += `\n[System Note: ${reason} This is too costly/complex to analyze directly. Instead of analyzing these media files, use the Ad Context (Ref/Title) if available, or ask the user to specify which product they are interested in from the post.]`;
        } else if (allImages.length > 0) {
            // MASTER SWITCH: check if 'image_detection' is FALSE (default TRUE if undefined)
            const imageDetectionEnabled = pagePrompts && pagePrompts.image_detection !== false && pagePrompts.image_detection !== 'false' && pagePrompts.image_detection !== 0 && pagePrompts.image_detection !== '0' && pagePrompts.image_detection !== null;

            if (!imageDetectionEnabled) {
                console.log(`[Batch] Image Detection disabled for page ${pageId}. Skipping.`);
                await dbService.setConversationState(pageId, senderId, {
                    last_image_map: null,
                    last_image_batch_id: `fb_img_skipped_${Date.now()}`,
                    last_intent: 'image_analysis_skipped'
                });
                combinedText += `\n[System Note: User sent ${allImages.length} images. Image detection is disabled, so they were not analyzed. Ask the user to describe what they want.]`;
            } else {
                console.log(`[Batch] Analyzing and matching ${allImages.length} images...`);
                let productAnalysisPrompt = `Analyze this image with 100% precision. 
STRICT RULES:
1. FOCUS ONLY on the main products in the foreground (e.g., being held in hand or placed at the front). 
2. IGNORE the background products on shelves or blurred items.
3. READ the actual text printed on each foreground product carefully. 
4. Identify the brand and full product name.
5. Output EXACTLY in this Bengali format:
এই ছবিতে মোট **[সংখ্যা]টি** প্রোডাক্ট রয়েছে। প্রোডাক্টগুলোর নাম নিচে দেওয়া হলো:
১. **[প্রোডাক্টের পুরো নাম]** ([পজিশন ও ছোট ভিজ্যুয়াল বিবরণ])
২. ...
এটি মূলত একটি **"[কম্বো বা অফার নাম]"** হিসেবে সাজানো হয়েছে। [একটি ছোট বাক্যে সারসংক্ষেপ]`;

                if (pagePrompts && (pagePrompts.image_prompt || pagePrompts.vision_prompt)) {
                    productAnalysisPrompt = pagePrompts.image_prompt || pagePrompts.vision_prompt;
                }

                const batchId = `fb_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const imageJobs = [];
                let imageIndex = 1;
                for (const msg of messages) {
                    for (const url of msg.images || []) {
                        imageJobs.push({ msg, url, imageIndex: imageIndex++ });
                    }
                }

                const imageAnalysisResults = await Promise.all(imageJobs.map(job =>
                    analyzeAndMatchIncomingImage({
                        platform: 'messenger',
                        pageId,
                        senderId,
                        imageUrl: job.url,
                        imageIndex: job.imageIndex,
                        batchId,
                        pageConfig,
                        prompt: productAnalysisPrompt
                    }).catch(error => ({

                        imageIndex: job.imageIndex,
                        imageUrl: job.url,
                        analysisText: `[Vision Analysis Failed] ${error.message}`,
                        matchedProducts: [],
                        topMatch: null,
                        usage: 0,
                        model: 'vision-error'
                    }))
                ));

                totalVisionTokens += imageAnalysisResults.reduce((sum, result) => sum + Number(result.usage || 0), 0);
                const combinedImageAnalysis = imageAnalysisResults.map(formatImageAnalysisBlock).join('\n\n');
                const lastImageMap = buildLastImageMap(imageAnalysisResults);

                await dbService.setConversationState(pageId, senderId, {
                    last_image_map: Object.keys(lastImageMap).length > 0 ? lastImageMap : null,
                    last_image_batch_id: batchId,
                    last_intent: 'multi_image_analysis'
                });

                if (combinedImageAnalysis) {
                    dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId,
                        recipient_id: senderId,
                        message_id: `img_analysis_${batchId}`,
                        text: `[Analyzed Images]:\n${combinedImageAnalysis}`,
                        timestamp: Date.now(),
                        status: 'analyzed',
                        reply_by: 'bot',
                        token: totalVisionTokens,
                        ai_model: imageAnalysisResults.find(r => r.model && r.model !== 'image-analysis-cache')?.model || 'image-analysis-cache'
                    }).catch(e => console.error(`[FB] Failed to save image analysis:`, e.message));
                // #region debug-point B:messenger-visual-context
                (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='messenger-image-match';try{const e=fs.readFileSync('.dbg/messenger-image-match.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'B',location:'webhookController.js:messenger:visualContext',msg:'[DEBUG] messenger visual context appended',data:{pageId,senderId,combinedLength:combinedImageAnalysis.length,containsVectorSearchResult:combinedImageAnalysis.includes('[IMAGE ANALYSIS RESULT]'),combinedPreview:combinedImageAnalysis.slice(0,280)},ts:Date.now()})}).catch(()=>{})})();
                // #endregion
                
                // Unified single block for AI - ENHANCED FOCUS
                combinedText += `\n\n[NEW VISUAL CONTEXT - IMPORTANT]:\nThe user has just sent the following image(s). This is the CURRENT FOCUS of the conversation. The image analyzer text is descriptive evidence, and Direct Image Embedding Evidence is visual retrieval evidence only. Main LLM must make the final customer-facing decision using business owner rules and the available product evidence.\n\n${combinedImageAnalysis.trim()}\n\n[CRITICAL RULE FOR IMAGES AND MULTIPLE PRODUCTS]:\n1. Use the exact IMAGE 1 / IMAGE 2 / IMAGE 3 order above when answering.\n2. Do not blindly confirm exact availability only because a candidate exists. Use score, product details, and business rules.\n3. Treat Direct Image Embedding Score >= 84% as strong visual-family evidence, 80-83.9% as similar/uncertain, and below 80% as weak unless other product evidence is strong.\n4. For multiple close options, ask the customer to choose and include product photos by using [PRODUCT_ID:id] when useful/allowed.\n5. If the user asks for photos ("sobi den", "picture"), use the exact Product ID / Primary Image / Additional Images URLs from the evidence block.\n6. If user later says "২ নাম্বারটা", use IMAGE 2 from the saved image map.\n[END OF NEW VISUAL CONTEXT]`;
            } else {
                combinedText += `\n[User sent ${allImages.length} images: ${allImages.join(', ')}]`;
            }
        }
    }

        // B. Process Audio (Voice)
        if (allAudios.length > 0) {
            // Check Feature Flag (default false)
            const audioEnabled = pagePrompts && pagePrompts.audio_detection !== false && pagePrompts.audio_detection !== 'false' && pagePrompts.audio_detection !== 0 && pagePrompts.audio_detection !== '0' && pagePrompts.audio_detection !== null;

            if (audioEnabled) {
                console.log(`[Batch] Transcribing ${allAudios.length} voice messages...`);
                
                const audioJobs = [];
                for (const msg of messages) {
                    const msgAudios = Array.isArray(msg.audios) ? msg.audios.filter(Boolean) : [];
                    for (const audioUrl of msgAudios) {
                        audioJobs.push({
                            messageId: msg.id || `audio_${audioJobs.length}`,
                            rawText: msg.text || '',
                            url: audioUrl
                        });
                    }
                }

                const audioResultsRaw = await Promise.all(
                    audioJobs.map(job => aiService.transcribeAudio(job.url, pageConfig))
                );
                
                let lastAudioModel = 'whisper-large-v3';
                const transcriptsByMessage = new Map();
                const audioTranscripts = audioResultsRaw.map((res, i) => {
                    const job = audioJobs[i];
                    const text = typeof res === 'object' ? (res.text || '') : String(res || '');
                    const usage = typeof res === 'object' ? (res.usage || 0) : 0;
                    const model = typeof res === 'object' ? (res.model || 'unknown') : 'unknown';
                    totalAudioTokens += usage;
                    lastAudioModel = model;

                    if (job && text.trim()) {
                        const existing = transcriptsByMessage.get(job.messageId) || {
                            rawText: job.rawText,
                            transcriptParts: []
                        };
                        existing.transcriptParts.push(text.trim());
                        transcriptsByMessage.set(job.messageId, existing);
                    }

                    return text;
                });

                const combinedAudioTranscript = audioTranscripts.join('\n').trim();
                if (combinedAudioTranscript) {
                    combinedText = combinedText
                        ? `${combinedText}\n${combinedAudioTranscript}`.trim()
                        : combinedAudioTranscript;
                }

                try {
                    const transcriptEntries = Array.from(transcriptsByMessage.entries());
                    const saveTranscriptPromises = transcriptEntries.map(([messageId, data], index) => {
                        const transcriptText = data.transcriptParts.join('\n').trim();
                        if (!transcriptText) return Promise.resolve();

                        const mergedText = data.rawText && data.rawText.trim()
                            ? `${data.rawText.trim()}\n${transcriptText}`
                            : transcriptText;

                        return dbService.saveFbChat({
                            page_id: pageId,
                            sender_id: senderId,
                            recipient_id: pageId,
                            message_id: messageId,
                            text: mergedText,
                            timestamp: Date.now(),
                            status: 'transcribed',
                            reply_by: 'user',
                            token: index === 0 ? totalAudioTokens : 0,
                            ai_model: index === 0 ? lastAudioModel : null
                        });
                    });

                    Promise.allSettled(saveTranscriptPromises).catch(e => {
                        console.error(`[FB] Failed to save audio transcript:`, e.message);
                    });
                } catch (e) {
                    console.error(`[FB] Failed to save audio transcript:`, e.message);
                }
            } else {
                console.log(`[Batch] Audio Detection disabled for page ${pageId}. Skipping.`);
                combinedText += `\n[System Note: User sent ${allAudios.length} voice messages. Audio detection is disabled, so they were not transcribed. Ask the user to type instead.]`;
            }
        }
        
        console.log(`[Batch] Final Context for AI:\n${combinedText}`);
        // ----------------------------------------
        

        // 2. HUMAN HANDOVER & RACE CONDITION CHECK
        console.log("Checking human handover...");
        // fbMessages already fetched in parallel
        
        // 3. Send Typing Indicator
        // Already sent in parallel

        // 4. Get Knowledge Base & Chat History
        // pagePrompts already fetched in parallel
        
        // --- FEATURE FLAGS CHECK ---
        if (pagePrompts) {
            // Check based on message type
            if (hasPostback) {
                // It's a Swipe/Postback
                const isSwipeEnabled = pagePrompts && pagePrompts.swipe_reply !== false && pagePrompts.swipe_reply !== 'false' && pagePrompts.swipe_reply !== 0 && pagePrompts.swipe_reply !== '0';
                if (!isSwipeEnabled) {
                    const logMsg = `[AI] Swipe Reply disabled (swipe_reply=false) for page ${pageId}. Ignoring.`;
                    console.log(logMsg);
                    logToFile(logMsg);
                    // Log to DB
                    await dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId,
                        recipient_id: senderId,
                        message_id: `sys_${Date.now()}`,
                        text: `[SYSTEM] Swipe Reply Disabled in Settings.`,
                        timestamp: Date.now(),
                        status: 'system_info',
                        reply_by: 'system'
                    });
                    return;
                }
            } else {
                // It's a Text Message
                const isReplyEnabled = pagePrompts && pagePrompts.reply_message !== false && pagePrompts.reply_message !== 'false' && pagePrompts.reply_message !== 0 && pagePrompts.reply_message !== '0';
                if (!isReplyEnabled) {
                    const logMsg = `[AI] Reply Message disabled (reply_message=false) for page ${pageId}. Ignoring.`;
                    console.log(logMsg);
                    logToFile(logMsg);
                    // Log to DB
                    await dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId,
                        recipient_id: senderId,
                        message_id: `sys_${Date.now()}`,
                        text: `[SYSTEM] Reply Message Disabled in Settings.`,
                        timestamp: Date.now(),
                        status: 'system_info',
                        reply_by: 'system'
                    });
                    return;
                }
            }
        }

        // Debugging: Log Prompt Info
        if (pagePrompts) {
             const logMsg = `[AI] Loaded Prompts for ${pageId}. Text Prompt: "${pagePrompts.text_prompt?.substring(0, 50)}..."`;
             console.log(logMsg);
             logToFile(logMsg);
        } else {
             const logMsg = `[AI] No Prompts found for ${pageId}. Using Default.`;
             console.log(logMsg);
             logToFile(logMsg);
        }

        // --- FETCH SENDER NAME ---
        // senderName already fetched
        // -------------------------
        
    let effectiveHistory = history;
    // Respect the dynamic history limit fetched above
    if (effectiveHistory.length > historyLimit) {
        effectiveHistory = effectiveHistory.slice(effectiveHistory.length - historyLimit);
    }
    console.log(`[Context] Using last ${effectiveHistory.length} messages (Limit: ${historyLimit})`);

        // --- STOP EMOJI CHECK (Dynamic Logic via Graph API) ---
        // REMOVED: This is now handled permanently via DB status in the echo handling above.
        // ---------------------------------------

        // --- MARK SEEN (Delayed until after Stop Logic) ---
        // MOVED TO TOP (Before typing_on)
        // --------------------------------------------------

        // --- REPLY TO LOGIC ---
        // User Instruction: Try to find old message by message_id from fb_chats first.
        // If not found, try fetching from FB API (Fallback).
        let replyContext = "";
        if (replyToId) {
            let originalText = await dbService.getMessageById(replyToId);
            
            // Fallback: Fetch from Facebook if not in DB
            if (!originalText) {
                console.log(`[Swipe Reply] Message ${replyToId} not found in DB. Fetching from FB...`);
                originalText = await facebookService.getMessageById(replyToId, pageConfig.page_access_token);
            }

            if (originalText) {
                // DETECT IMAGE ANALYSIS CONTEXT
                // Fix: Handle object return from facebookService
                if (typeof originalText === 'object') {
                    originalText = originalText.message || "";
                }

                // If the user is replying to a message that contains "Based on the image",
                // we must explicitly tell the AI that this text IS the image content.
                if (originalText.includes("Based on the image") || originalText.includes("[User sent images:")) {
                    replyContext = `\n[System Note: The user is replying to an image. The AI cannot see the image again, but here is the analysis/description of that image: "${originalText}". Answer the user's question assuming this text is what they are looking at.]\n`;
                } else {
                    replyContext = `\n[User Replying To: "${originalText}"]`;
                }
            }
        }
        
        let productNamesFromPrompt = extractProductNamesFromPrompt(pagePrompts?.text_prompt || "");
        const promptProductMap = {};
        let promptProductContext = "";
        if (productNamesFromPrompt && productNamesFromPrompt.length > 0 && pageConfig && pageConfig.page_id) {
            const lowerCombined = combinedText.toLowerCase();
            const isGreeting = /\b(hi+|hello|hey)\b/.test(lowerCombined);
            productNamesFromPrompt = productNamesFromPrompt.filter(name => {
                if (name.toLowerCase() === 'logo' && !isGreeting) {
                    return false;
                }
                return true;
            });
            if (productNamesFromPrompt.length > 0) {
                const uniqueNames = Array.from(new Set(productNamesFromPrompt));
                for (const rawName of uniqueNames) {
                    const key = rawName.toLowerCase();
                    if (promptProductMap[key]) continue;
                    try {
                        const productsForPrompt = await dbService.searchProductsForResource(rawName, pageConfig.page_id);
                        if (productsForPrompt && productsForPrompt.length > 0) {
                            promptProductMap[key] = productsForPrompt[0];
                        }
                    } catch (e) {}
                }
                const promptProducts = Object.values(promptProductMap);
                if (promptProducts.length > 0) {
                    promptProductContext = "\n[Instruction Products]\n";
                    promptProducts.forEach((p, i) => {
                        const priceDisplay = p.price ? `${p.price} ${p.currency || 'BDT'}` : 'N/A';
                        const imgDisplay = p.image_url || 'N/A';
                        const descDisplay = p.description ? p.description.replace(/\n/g, ' ').substring(0, 200) : '';
                        const resolvedContext = buildResolvedProductContext(p, combinedText || '');
                        const variantsPart = resolvedContext.variantsText;
                        
                        if (!p.allow_description) {
                            promptProductContext += `Item ${i + 1}: Image URL: ${imgDisplay}${variantsPart}\n`;
                            return;
                        }
                        const descPart = descDisplay ? ` | Desc: ${descDisplay}` : '';
                        promptProductContext += `Item ${i + 1}: ${p.name} | Price: ${priceDisplay} | Image URL: ${imgDisplay}${descPart}${variantsPart}\n`;
                    });
                    promptProductContext += "[End of Instruction Products]\n";
                }
            }
        }
        
        const finalUserMessage = `${smartAdContext}${replyContext}${combinedText}${promptProductContext}`;
        if (hasAudioTurn) {
            await dbService.saveChatMessage(sessionId, 'user', finalUserMessage, delayedAudioHistoryMessageId);
        }
        // ------------------------------------

        // 5. Generate AI Reply
        // Use finalUserMessage which includes reply context
        
        // --- INJECT FORMATTING INSTRUCTION (Tool-Driven Product System) ---
        let finalPrompt = pagePrompts?.text_prompt || "";
        const professionalRules = `\n\n[PROFESSIONAL OUTPUT RULES]\n` +
                `1) IDENTITY: You are a professional human sales representative. Talk naturally.\n` +
                `2) TOOL-FIRST: If the user asks about product price/details, you MUST call tools. Do NOT invent prices or descriptions.\n` +
                `3) IMAGE DECISION: If you decide to send a product's image (based on user request or appropriateness), you MUST append [PRODUCT_ID:id] to your reply. Example: "Yes, it is available. [PRODUCT_ID:82]".\n` +
                `4) SYSTEM PROMPT PRIORITY: If your custom instructions (System Prompt) say NOT to send images proactively, you MUST obey that and only use the [PRODUCT_ID:id] tag when the user explicitly asks for a photo.\n` +
                `5) SMART PHOTO FLOW: If the customer asks for a photo but multiple products/options are active in the conversation, do NOT guess and do NOT send all photos. Ask which specific product they want first.\n` +
                `6) PHOTO SCOPE: If one product is clearly selected, focus only on that product. Only send all variants/images when the customer explicitly asks for all images of that selected product.\n` +
                `7) SKU FLOW: If a product has multiple design/color/size/item options and the customer did not specify enough details, ask the missing attribute instead of guessing.\n` +
                `8) LISTING PRODUCTS: If asked "What do you sell?", list 3-5 names naturally and ask which one they are interested in.\n` +
                `9) DELIVERY CLAIMS: Never say a photo has already been sent or delivered. Keep the wording neutral; the system will decide final delivery wording.\n` +
                `10) NO HALLUCINATIONS: Never guess or invent prices. Always use tool data only.\n`;

        if (finalPrompt) {
             finalPrompt += professionalRules;
        } else {
             finalPrompt = professionalRules;
        }
        
        // Use a shallow copy of config to avoid modifying the original config object
        const aiConfig = {
            ...pageConfig,
            request_budget_ms: AI_REQUEST_BUDGET_MS,
            request_deadline_at: Date.now() + AI_REQUEST_BUDGET_MS
        };
        if (finalPrompt) {
             aiConfig.text_prompt = finalPrompt;
        }

        let aiResponse;
        try {
            aiResponse = await aiService.generateResponse({
                pageId: pageId,
                userId: senderId,
                userMessage: finalUserMessage,
                history: effectiveHistory,
                imageUrls: [], // imageUrls (Already processed)
                audioUrls: [], // audioUrls (Already processed)
                config: aiConfig, // Use modified config
                platform: 'messenger',
                extraTokenUsage: totalVisionTokens + totalAudioTokens,
                senderName: senderName
            });
        } catch (genErr) {
            console.error(`[Webhook] AI Generation CRITICAL Error:`, genErr.message);
            
            if (genErr.message.includes('PRODUCT_SEARCH_API_FAILURE')) {
                // Log the failure to dashboard for visibility
                await dbService.saveFbChat({
                    page_id: pageId,
                    sender_id: pageId,
                    recipient_id: senderId,
                    message_id: `err_search_${Date.now()}`,
                    text: `[CRITICAL ERROR] Product search failed due to API problem. (Code: 503_VECTOR_DB_FAIL). Details: ${genErr.message}`,
                    timestamp: Date.now(),
                    status: 'api_failure',
                    reply_by: 'system'
                });
                // STOP THE PROCESS: No message to user
                return;
            }
            
            // For other errors, return a controlled fallback instead of silent drop
            aiResponse = {
                reply: aiConfig.fallback_message || "দুঃখিত, সার্ভার বর্তমানে ব্যস্ত আছে। একটু পরে আবার চেষ্টা করুন।",
                error: genErr.message
            };
        }
        
        if (aiResponse == null) {
             console.error(`[Webhook] AI generation failed or returned NULL for ${senderId}. Using fallback reply.`);
             aiResponse = {
                reply: null, // NO USER MESSAGE ON NULL AI RESPONSE
                error: 'empty_ai_response'
            };
        }

        let replyText = aiResponse.reply || "";

        if (aiResponse.product_id) {
            try {
                await dbService.setConversationState(pageId, senderId, { last_product_id: aiResponse.product_id });
            } catch (stateErr) {
                console.warn(`[Context] Failed to update Messenger conversation state: ${stateErr.message}`);
            }
        }

        // --- NEW PROFESSIONAL TAG PROCESSOR (PRODUCT_ID) ---
        // Robust check for the tag, allowing for variations in spacing and quotes
        if (/\[PRODUCT_ID\s*:\s*/i.test(replyText)) {
            // Loose regex to capture whatever is inside the tag
            const productTagRegex = /\[PRODUCT_ID\s*:\s*["']?\s*([^"\]\s']+)["']?\s*\]/gi;
            
            const matches = [...replyText.matchAll(productTagRegex)];
            const uniqueTags = new Set(matches.map(m => m[0]));

            for (const fullTag of uniqueTags) {
                const match = matches.find(m => m[0] === fullTag);
                const productId = match[1].trim().replace(/["']/g, ''); // Extra cleanup for quotes

                try {
                    // Fetch product by exact ID
                    const product = await dbService.getProductById(productId);
                    if (product) {
                        const historyText = getHistoryText(effectiveHistory);
                        const state = await dbService.getConversationState(pageId, senderId).catch(() => null);
                        const resolvedContext = buildResolvedProductContext(product, `${combinedText}\n${historyText}`.trim(), state?.last_variant_key || null);
                        const selectedSku = resolvedContext.selectedSku;
                        const numericPrice = parsePrice(selectedSku?.price ?? product.price);
                        let priceDisplay = numericPrice > 0 ? `${numericPrice} ${selectedSku?.currency || product.currency || 'BDT'}` : "Ask for Price";
                        const description = product.description || "No description available.";

                        // Build variants display
                        let variantsDisplay = '';
                        if (selectedSku) {
                            variantsDisplay = `\n📌 Selected SKU: ${selectedSku.name}${selectedSku.sku_code ? ` (${selectedSku.sku_code})` : ''}`;
                        } else if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
                            const availableVariants = product.variants.filter(v => v.available !== false);
                            if (availableVariants.length > 0) {
                                variantsDisplay = '\n📋 Available Options:';
                                availableVariants.forEach((v, idx) => {
                                    const variantPrice = parsePrice(v.price);
                                    const variantPriceDisplay = variantPrice > 0 ? `${variantPrice} ${v.currency || product.currency || 'BDT'}` : "Ask for Price";
                                    variantsDisplay += `\n   ${idx + 1}. ${v.name || `Option ${idx + 1}`}: ${variantPriceDisplay}`;
                                });
                            }
                        }

                        // Prepare replacement text
                        const replacementText = `\n\n🛍️ *${product.name}*\n💰 Price: ${priceDisplay}\n📝 Details: ${description}${variantsDisplay}`;
                        
                        // Replace all occurrences of this exact tag string
                        replyText = replyText.split(fullTag).join(replacementText);

                        // Image attachment logic
                        const userWantsPhoto = hasPhotoIntent(effectiveHistory);
                        
                        // Track all sent media to avoid duplicates
                        const sentMediaUrls = new Set();
                        if (aiResponse.images) {
                            aiResponse.images.forEach(img => sentMediaUrls.add(img.url));
                        }

                        if (selectedSku) {
                            await dbService.setConversationState(pageId, senderId, {
                                last_product_id: product.id,
                                last_variant_key: selectedSku.key || null
                            });
                        }
                        if (aiResponse.videos) {
                            aiResponse.videos.forEach(vid => sentMediaUrls.add(vid.url));
                        }

                        resolvedContext.mediaImages.forEach((mediaUrl) => {
                            if (!sentMediaUrls.has(mediaUrl)) {
                                if (!aiResponse.images) aiResponse.images = [];
                                aiResponse.images.push({
                                    url: mediaUrl,
                                    title: product.name,
                                    description
                                });
                                sentMediaUrls.add(mediaUrl);
                            }
                        });

                        resolvedContext.mediaVideos.forEach((mediaUrl) => {
                            const normalizedVideoUrl = normalizeImageUrl(mediaUrl);
                            if (!sentMediaUrls.has(normalizedVideoUrl)) {
                                if (!aiResponse.videos) aiResponse.videos = [];
                                aiResponse.videos.push({
                                    url: normalizedVideoUrl,
                                    title: product.name,
                                    description
                                });
                                sentMediaUrls.add(normalizedVideoUrl);
                            }
                        });
                    } else {
                        console.warn(`[TagProcessor] Product ID "${productId}" not found in DB.`);
                        // If not found, we still remove the tag but show a clean "not found" message
                        replyText = replyText.split(fullTag).join(`\n(Product info currently unavailable)`);
                    }
                } catch (err) {
                    console.error(`[TagProcessor] Error for ID ${productId}:`, err);
                }
            }
        }
        // -----------------------------------------------------

        const extractSaveOrderTag = (replyText) => {
            if (!replyText || typeof replyText !== 'string') return null;
            const match = replyText.match(/\[SAVE_ORDER:\s*({[\s\S]*?})\]/);
            if (!match || !match[1]) return null;
            try {
                return JSON.parse(match[1]);
            } catch (e) {
                console.warn(`[Order] Failed to parse SAVE_ORDER JSON: ${e.message}`);
                return null;
            }
        };

        const getHistoryText = (historyList) => {
            if (!Array.isArray(historyList)) return '';
            return historyList
                .map(item => {
                    let content = '';
                    if (!item) return '';
                    if (typeof item === 'string') content = item;
                    else if (typeof item.content === 'string') content = item.content;
                    else if (typeof item.text === 'string') content = item.text;
                    else if (item.message && typeof item.message.content === 'string') content = item.message.content;
                    else if (item.message && typeof item.message.text === 'string') content = item.message.text;
                    
                    if (!content) return '';

                    // --- IGNORE SYSTEM NOISE & LOGS ---
                    if (content.includes('[SYSTEM MEMORY]') || content.includes('Link: http')) return '';

                    // --- SMART CLEAN INTERNAL NOISE FROM HISTORY ---
                    return content
                        .replace(/Image URL: https?:\/\/[^\s|]+/gi, '(Image)')
                        .replace(/Desc: [\s\S]*?(?=\||\[End|$)/gi, '')
                        .replace(/\[Instruction Products\]/gi, '')
                        .replace(/\[End of Instruction Products\]/gi, '')
                        .replace(/\[SAVE_ORDER:[\s\S]*?\]/gi, '')
                        .replace(/##product/gi, '')
                        .replace(/(?:\d+|[০-৯])\.\s*\*\*[^*]+\*\*/g, '') // Remove numbered product lists from history
                        .trim();
                })
                .filter(Boolean)
                .join('\n');
        };

        const extractHistoryOrder = (historyText) => {
            // LLM manages everything via system prompt and order_details.
            // We return an empty object to satisfy the caller, ensuring no regex-based hallucinations.
            return {
                product_name: '',
                quantity: '',
                price: null,
                location: '',
                name: ''
            };
        };

        // --- UNIFIED ORDER ENGINE (Clean Architecture) ---
        // Handles AI intent + Deterministic fallback in one place.
        const orderDataFromAI = aiResponse.order_details?.fields || aiResponse.order_details;
        const orderIntent = aiResponse.order_details?.intent || 'upsert';

        await orderService.orchestrateOrder({
            pageId: pageId,
            senderId: senderId,
            platform: 'messenger',
            intent: orderIntent,
            data: orderDataFromAI || {},
            rawText: combinedText
        });
        // --------------------------------------

        // 6. Send Reply (Text + Images)
        if (replyText && typeof replyText === 'object') {
            if (replyText.reply) {
                replyText = String(replyText.reply);
            } else {
                replyText = '';
            }
        }
        
        let decisionMode = null;
        if (replyText && typeof replyText === 'string') {
            const decision = extractDecisionMode(replyText);
            decisionMode = decision.mode;
            replyText = decision.cleaned;
        }

        const originalReply = replyText;

        if (replyText == null) {
            replyText = '';
        } else {
            replyText = String(replyText);
        }

        // --- JSON & ERROR HANDLING (Commercial Grade) ---
        // 1. Attempt to Rescue JSON (Moved BEFORE block check)
        if (replyText && (replyText.trim().startsWith('{') || replyText.trim().startsWith('['))) {
            const trimmed = replyText.trim();
            // Robust check: Is it likely JSON? (Contains " : " and " " ")
            const isLikelyJson = (trimmed.includes('"') && trimmed.includes(':')) || trimmed.includes('{}');
            
            if (isLikelyJson) {
                try {
                    // Remove Markdown code blocks if present (```json ... ```)
                    const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    
                    // Extract useful text from common JSON fields
                    if (parsed.reply_text) replyText = parsed.reply_text;
                    else if (parsed.reply) replyText = parsed.reply;
                    else if (parsed.message) replyText = parsed.message;
                    else if (parsed.text) replyText = parsed.text;
                    else if (parsed.answer) replyText = parsed.answer;
                    else if (parsed.content) replyText = parsed.content;
                    
                    console.log(`[JSON Rescuer] Successfully extracted text from JSON: "${replyText.substring(0, 50)}..."`);
                } catch (e) {
                    console.warn(`[JSON Rescuer] Failed to parse JSON: ${e.message}. Content: ${replyText.substring(0, 20)}...`);
                    // If parsing fails, we treat it as potentially harmful raw code.
                    // We will LOG it for Admin but NOT send it to User.
                    await dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId,
                        recipient_id: senderId,
                        message_id: `fail_${Date.now()}`,
                        text: `[AI Error - Silent] Raw JSON/Code Blocked: ${replyText}`,
                        timestamp: Date.now(),
                        status: 'ai_ignored',
                        reply_by: 'bot'
                    });
                    replyText = ''; // SILENCE
                }
            } else {
                // Not likely JSON, just bracketed text like "[Image of...]"
                // Let it pass through to the text handling logic below.
                console.log(`[JSON Rescuer] Skipping non-JSON bracketed text: "${replyText.substring(0, 20)}..."`);
            }
        }

        if (replyText && typeof replyText === 'string') {
            const extracted = extractImageUrlsFromText(replyText);
            replyText = sanitizeReplyText(extracted.cleanText);
            if (extracted.urls.length > 0) {
                if (!aiResponse.images) aiResponse.images = [];
                extracted.urls.forEach(url => {
                    if (!aiResponse.images.some(img => (typeof img === 'string' ? img : img.url) === url)) {
                        aiResponse.images.push({ url: url, title: 'Product Image' });
                    }
                });
            }
        }

        if (hasPhotoIntent(effectiveHistory)) {
            let targetProductId = null;
            const state = await dbService.getConversationState(pageId, senderId);
            if (state && state.last_product_id) targetProductId = state.last_product_id;
            if (!targetProductId && aiResponse.product_id) targetProductId = aiResponse.product_id;
            
            if (targetProductId) {
                const product = await dbService.getProductById(targetProductId);
                if (product) {
                    const resolvedContext = buildResolvedProductContext(product, effectiveHistory || '', state?.last_variant_key || null);
                    if ((!Array.isArray(aiResponse.images) || aiResponse.images.length === 0) && resolvedContext.mediaImages.length > 0) {
                        aiResponse.images = resolvedContext.mediaImages.map((url, idx) => ({
                            url,
                            title: product.name || (idx === 0 ? 'Product Image' : `Product Image ${idx + 1}`),
                            description: product.description || ''
                        }));
                        console.log(`[Image Injection] Injected ${resolvedContext.mediaImages.length} images for Product ID: ${targetProductId}`);
                    }
                    if ((!Array.isArray(aiResponse.videos) || aiResponse.videos.length === 0) && resolvedContext.mediaVideos.length > 0) {
                        aiResponse.videos = resolvedContext.mediaVideos.map((url) => ({
                            url,
                            title: product.name || 'Product Video',
                            description: product.description || ''
                        }));
                    }
                }
            }
        }

        if (replyText && shouldBlockOutgoingReply(replyText)) {
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId,
                recipient_id: senderId,
                message_id: `fail_${Date.now()}`,
                text: `[Blocked Internal Error] ${replyText}`,
                timestamp: Date.now(),
                status: 'ai_ignored',
                reply_by: 'bot'
            });
            replyText = '';
        }

        // 2. Suppress Known Error Patterns (Strict Commercial Quality)
        // Never show "AI Error", "null", "undefined" or technical jargon to customers.
        const forbiddenPatterns = [
            '\\[AI Error', 
            'JSON reply blocked', 
            'Error:', 
            'undefined',
            '\\[System Error\\]',
            '429 status code', 
            'no body',         
            'status code'      
        ];

        if (replyText) {
            let trimmed = replyText.trim();
            // IMPROVEMENT: If the reply is a JSON string, try to parse it and extract reply_text
            // This prevents "Blocked Internal Error" for valid JSON responses from models
            if ((trimmed.startsWith('{') && trimmed.endsWith('}'))) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.reply_text) {
                        replyText = parsed.reply_text;
                        trimmed = replyText.trim();
                        // Re-evaluate images/actions if they were in the JSON
                        if (parsed.image_urls && Array.isArray(parsed.image_urls)) {
                            if (!aiResponse.images) aiResponse.images = [];
                            parsed.image_urls.forEach(url => {
                                if (!aiResponse.images.some(img => (typeof img === 'string' ? img : img.url) === url)) {
                                    aiResponse.images.push({ url: url, title: parsed.product_id || 'Product' });
                                }
                            });
                        }
                    }
                } catch (e) {
                    // Not valid JSON or missing reply_text, continue with normal flow
                }
            }

            for (const pattern of forbiddenPatterns) {
                try {
                    const regex = new RegExp(pattern, 'i');
                    if (regex.test(replyText)) {
                        console.log(`[Quality Control] Blocked internal error text matching: "${pattern}"`);
                        // Log for Admin
                        await dbService.saveFbChat({
                            page_id: pageId,
                            sender_id: pageId,
                            recipient_id: senderId,
                            message_id: `fail_${Date.now()}`,
                            text: `[Blocked Internal Error] ${replyText}`,
                            timestamp: Date.now(),
                            status: 'ai_ignored',
                            reply_by: 'bot'
                        });
                        replyText = ''; // SILENCE
                        break;
                    }
                } catch (reErr) {
                    // Fallback to simple includes if regex fails
                    if (replyText.toLowerCase().includes(pattern.toLowerCase().replace(/\\/g, ''))) {
                        replyText = '';
                        break;
                    }
                }
            }
            // Special check for literal 'null' as a word, not as a substring
            if (replyText && /\bnull\b/i.test(replyText)) {
                 console.log(`[Quality Control] Blocked literal 'null' in reply.`);
                 await dbService.saveFbChat({
                    page_id: pageId,
                    sender_id: pageId,
                    recipient_id: senderId,
                    message_id: `fail_${Date.now()}`,
                    text: `[Blocked Internal Error] ${replyText}`,
                    timestamp: Date.now(),
                    status: 'ai_ignored',
                    reply_by: 'bot'
                });
                replyText = '';
            }
        }

        // 3. Final Empty Check
        if (!replyText || replyText.trim() === '' || replyText === 'null' || replyText.toLowerCase() === 'no reply') {
            replyText = ''; // Ensure it's empty string
            
            // If we also have no images, this is a SILENT event.
            if (!hasQueuedMedia(aiResponse)) {
                 const silentMsg = `[AI Silence] No text and no images. Staying silent for Sender: ${senderId}.`;
                 console.log(silentMsg);
                 if (typeof logToFile === 'function') logToFile(silentMsg);
                 return; // STOP HERE. Do not send anything to FB.
            }
        }


        if (replyText && pagePrompts) {
            const normalizeEmojiText = (str) => (str || '').replace(/\uFE0F/g, '').normalize('NFC');
            const cleanText = normalizeEmojiText(replyText);

            const lockList = [
                pagePrompts.block_emoji,
                pagePrompts.lock_emojis,
                pagePrompts.block_emojis
            ].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeEmojiText(e.trim())).filter(e => e);

            const unlockList = [
                pagePrompts.unblock_emoji,
                pagePrompts.unlock_emojis,
                pagePrompts.unblock_emojis
            ].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeEmojiText(e.trim())).filter(e => e);

            let isLocked = false;
            let isUnlocked = false;

            for (const e of lockList) {
                if (cleanText.includes(e)) {
                    isLocked = true;
                    break;
                }
            }

            if (!isLocked) {
                for (const e of unlockList) {
                    if (cleanText.includes(e)) {
                        isUnlocked = true;
                        break;
                    }
                }
            }

            if (isLocked) {
                await dbService.toggleFbLock(pageId, senderId, true);
                console.log(`[Handover] 🔒 BOT LOCK: ${senderId} via Emoji`);
            } else if (isUnlocked) {
                await dbService.toggleFbLock(pageId, senderId, false);
                console.log(`[Handover] 🔓 BOT UNLOCK: ${senderId} via Emoji`);
            }
        }

        if (replyText && promptProductMap) {
            const products = Object.values(promptProductMap)
                .map(p => ({ ...p, _lowerName: (p.name || '').toLowerCase() }))
                .filter(p => p._lowerName);
            products.sort((a, b) => b._lowerName.length - a._lowerName.length);

            const pricePlaceholderRegex = /\[(price|Check for exact price|Price not available in inventory list)\]/gi;
            const descPlaceholderRegex = /\[(description|Get detailed description|Description not available in inventory list)\]/gi;

            let currentProduct = null;
            const lines = replyText.split('\n').map(line => {
                const lowerLine = line.toLowerCase();
                const matched = products.find(p => lowerLine.includes(p._lowerName));
                if (matched) currentProduct = matched;

                if (currentProduct) {
                    if (pricePlaceholderRegex.test(line)) {
                        const priceText = currentProduct.price
                            ? `${currentProduct.price} ${currentProduct.currency || 'BDT'}`
                            : 'Ask for Price';
                        line = line.replace(pricePlaceholderRegex, priceText);
                    }
                    if (descPlaceholderRegex.test(line)) {
                        const descText = currentProduct.description || 'No description available.';
                        line = line.replace(descPlaceholderRegex, descText);
                    }
                }
                return line;
            });
            replyText = lines.join('\n');
        }

        // --- SMART IMAGE EXTRACTION & CLEANING (TIERED SELECTION) ---
        if (!aiResponse.images) aiResponse.images = [];
        if (!aiResponse.videos) aiResponse.videos = [];
        
        let extractedImages = [];
        let extractedVideos = [];
        const tagRegex = /##PRODUCT\s*["'](.+?)["']/gi;
        const strictImageRegex = /IMAGE:\s*(.+?)\s*\|\s*(https?:\/\/[^\s,]+)/gi;
        const brokenTagRegex = /IMAGE:\s*([^|]+?)\s*\|\s*(?!\s*https?:\/\/)(.*)/gi;
        
        // Detect if ANY form of image tag exists in the text
        const hasTagsInText = tagRegex.test(replyText) || strictImageRegex.test(replyText) || brokenTagRegex.test(replyText);
        
        // Reset regex indices
        tagRegex.lastIndex = 0;
        strictImageRegex.lastIndex = 0;
        brokenTagRegex.lastIndex = 0;

        // --- TIER 1: TAG-BASED EXTRACTION (Highest Priority) ---
        if (hasTagsInText && replyText) {
            console.log(`[Image Selection] TIER 1: Extracting from Tags...`);
            
            // A. Extract from ##PRODUCT tags
            let tagMatch;
            const mentionedViaTag = new Set();
            while ((tagMatch = tagRegex.exec(replyText)) !== null) {
                mentionedViaTag.add(tagMatch[1].toLowerCase());
            }

            if (promptProductMap) {
                const tagState = await dbService.getConversationState(pageId, senderId).catch(() => null);
                Object.keys(promptProductMap).forEach(name => {
                    if (mentionedViaTag.has(name.toLowerCase())) {
                        const product = promptProductMap[name];
                        if (product) {
                            const resolvedContext = buildResolvedProductContext(product, effectiveHistory || '', tagState?.last_variant_key || null);
                            resolvedContext.mediaImages.forEach((fullUrl) => {
                                if (fullUrl && !extractedImages.some(img => img.url === fullUrl)) {
                                    extractedImages.push({ url: fullUrl, title: product.name || name, description: product.description || '' });
                                }
                            });
                            resolvedContext.mediaVideos.forEach((fullVideoUrl) => {
                                if (fullVideoUrl && !extractedVideos.some(video => video.url === fullVideoUrl)) {
                                    extractedVideos.push({ url: fullVideoUrl, title: product.name || name, description: product.description || '' });
                                }
                            });
                        }
                    }
                });
            }

            // B. Extract from IMAGE: tags (Strict & Broken)
            // Broken tag recovery first to populate replyText with strict tags
            const seenBrokenTags = new Set();
            let brokenMatch;
            while ((brokenMatch = brokenTagRegex.exec(replyText)) !== null) {
                const fullMatch = brokenMatch[0];
                const productName = brokenMatch[1].trim();
                if (seenBrokenTags.has(fullMatch)) continue;
                seenBrokenTags.add(fullMatch);
                try {
                    const products = await dbService.searchProductsForResource(productName, pageId);
                    if (products && products.length > 0) {
                        const product = products[0];
                        const fullImgUrl = normalizeImageUrl(product.image_url);
                        if (fullImgUrl) {
                            replyText = replyText.split(fullMatch).join(`IMAGE: ${product.name} | ${fullImgUrl}`);
                        }
                    }
                } catch (e) {}
            }

            // Now extract from all strict IMAGE: tags (including recovered ones)
            let strictMatch;
            while ((strictMatch = strictImageRegex.exec(replyText)) !== null) {
                const fullMatch = strictMatch[0];
                const title = strictMatch[1].trim();
                let url = strictMatch[2].trim().replace(/[,.]$/, '');
                if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) {
                    if (!extractedImages.some(img => img.url === url)) {
                        extractedImages.push({ url: url, title: title });
                    }
                }
                replyText = replyText.replace(fullMatch, '').trim();
            }

            // Final scrub of all tags (More aggressive to prevent "IMAGE:" leaking)
            replyText = replyText.replace(tagRegex, '').trim();
            replyText = replyText.replace(/IMAGE:\s*[^|\n]*\s*\|?[^\n]*/gi, '').trim();
            // Robust cleanup: remove any remaining "IMAGE:" prefix/tag if it leaked
            replyText = replyText.replace(/^IMAGE:\s*/i, '').replace(/\nIMAGE:\s*/gi, '\n').trim();
        }

        // --- TIER 2: AGENTIC ACTION (Priority if no Tags exist) ---
        if (extractedImages.length === 0 && (aiResponse.action && aiResponse.action !== "NONE" || hasPhotoIntent(effectiveHistory))) {
            let targetId = aiResponse.product_id;
            
            // RECOVERY: If AI forgot the product_id but we have it in State Memory
            if (!targetId && hasPhotoIntent(effectiveHistory)) {
                const state = await dbService.getConversationState(pageId, senderId);
                if (state && state.last_product_id) {
                    targetId = state.last_product_id;
                    console.log(`[Image Selection] TIER 2 Recovery: Using last_product_id from Memory: ${targetId}`);
                }
            }

            if (targetId) {
                console.log(`[Image Selection] TIER 2: Using Agentic Delivery for ID: ${targetId}`);
                try {
                    // Check if product_id is a valid number (BigInt compatible)
                    const isNumericId = /^\d+$/.test(String(targetId));
                    if (isNumericId) {
                        const product = await dbService.getProductById(targetId);
                        if (product) {
                            if (aiResponse.action === "SEND_DETAILS" || aiResponse.action === "SEND_BOTH") {
                                if (!replyText || replyText.length < 50) {
                                    const numericPrice = parsePrice(product.price);
                                    const priceDisplay = numericPrice > 0 ? `${numericPrice} ${product.currency || 'BDT'}` : "Ask for Price";
                                    const details = `🛍️ *${product.name}*\n💰 Price: ${priceDisplay}\n📝 Info: ${product.description || 'No details available.'}`;
                                    replyText = `${replyText}\n\n${details}`;
                                }
                            }
                            
                            // Always fetch images if it's a SEND_PHOTO, SEND_BOTH, or if user explicitly asked for photos
                            if (aiResponse.action === "SEND_PHOTO" || aiResponse.action === "SEND_BOTH" || hasPhotoIntent(effectiveHistory)) {
                                const state = await dbService.getConversationState(pageId, senderId);
                                const lastVariantKey = state?.last_variant_key || null;
                                const variantResolutionText = [combinedText, effectiveHistory]
                                    .filter((value) => typeof value === 'string' && value.trim())
                                    .join('\n')
                                    .trim();

                                // #region debug-point B:tier2-before-resolve
                                reportVariantDebug('B', 'webhookController.js:tier2-before-resolve', 'tier2 agentic delivery before media resolve', {
                                    pageId,
                                    senderId,
                                    productId: product.id || null,
                                    aiAction: aiResponse.action || null,
                                    aiProductId: aiResponse.product_id || null,
                                    lastVariantKey,
                                    combinedText,
                                    effectiveHistory,
                                    variantResolutionText,
                                    existingExtractedImages: extractedImages.map((item) => item?.url || item),
                                    existingAiImages: Array.isArray(aiResponse.images) ? aiResponse.images.map((item) => item?.url || item) : []
                                });
                                // #endregion

                                // Resolve context to respect exact variant/SKU selection over base gallery
                                const resolvedContext = buildResolvedProductContext(product, variantResolutionText, lastVariantKey);
                                const urls = resolvedContext.mediaImages || [];
                                const videos = resolvedContext.mediaVideos || [];

                                // #region debug-point B:tier2-after-resolve
                                reportVariantDebug('B', 'webhookController.js:tier2-after-resolve', 'tier2 agentic delivery after media resolve', {
                                    pageId,
                                    senderId,
                                    productId: product.id || null,
                                    selectedSkuKey: resolvedContext.selectedSku?.key || null,
                                    selectedSkuName: resolvedContext.selectedSku?.name || null,
                                    missingAttributes: Array.isArray(resolvedContext?.missingAttributes) ? resolvedContext.missingAttributes.map((item) => item?.label || item?.name || null) : [],
                                    resolvedImages: urls,
                                    resolvedVideos: videos
                                });
                                // #endregion

                                videos.forEach(fullVideoUrl => {
                                    if (fullVideoUrl && !extractedVideos.some(video => video.url === fullVideoUrl)) {
                                        extractedVideos.push({ url: fullVideoUrl, title: product.name, description: product.description || '' });
                                    }
                                });

                                urls.forEach(u => {
                                    if (!extractedImages.some(img => img.url === u)) {
                                        extractedImages.push({ url: u, title: product.name, description: product.description || '' });
                                    }
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[Agentic Delivery] Failed:`, err.message);
                }
            }
        }

        // --- TIER 3: JSON ARRAY FALLBACK (Only if nothing found in Tier 1 or 2) ---
        if (extractedImages.length === 0) {
            console.log(`[Image Selection] TIER 3: Falling back to JSON image_urls/tools.`);
            if (Array.isArray(aiResponse.image_urls)) {
                for (const url of aiResponse.image_urls) {
                    if (url && typeof url === 'string' && url.startsWith('http')) {
                        if (!extractedImages.some(img => img.url === url)) {
                            extractedImages.push({ url: url, title: 'Product Image' });
                        }
                        // DO NOT INJECT ADDITIONAL IMAGES HERE TO PREVENT GALLERY SPAM
                    }
                }
            }
            aiResponse.images.forEach(img => {
                const url = typeof img === 'string' ? img : img.url;
                if (url && !extractedImages.some(i => i.url === url)) {
                    extractedImages.push(typeof img === 'string' ? { url: url, title: 'Product Image' } : img);
                }
            });
        }

        if (Array.isArray(aiResponse.video_urls)) {
            for (const url of aiResponse.video_urls) {
                if (url && typeof url === 'string' && url.startsWith('http') && !extractedVideos.some(video => video.url === url)) {
                    extractedVideos.push({ url, title: 'Product Video' });
                }
            }
        }

        aiResponse.videos.forEach(video => {
            const url = typeof video === 'string' ? video : video.url;
            if (url && !extractedVideos.some(item => item.url === url)) {
                extractedVideos.push(typeof video === 'string' ? { url: url, title: 'Product Video' } : video);
            }
        });

        const allowedMedia = await getAllowedResourceMediaMap(pageId);
        aiResponse.images = filterQueuedMediaByAllowedUrls(extractedImages, allowedMedia.imageUrls);
        aiResponse.videos = filterQueuedMediaByAllowedUrls(extractedVideos, allowedMedia.videoUrls);

        // #region debug-point C:final-media-queue
        reportVariantDebug('C', 'webhookController.js:final-media-queue', 'final media queue after allowlist filter', {
            pageId,
            senderId,
            aiAction: aiResponse.action || null,
            aiProductId: aiResponse.product_id || null,
            extractedImages: extractedImages.map((item) => item?.url || item),
            filteredImages: aiResponse.images.map((item) => item?.url || item),
            extractedVideos: extractedVideos.map((item) => item?.url || item),
            filteredVideos: aiResponse.videos.map((item) => item?.url || item)
        });
        // #endregion

        // --- FINAL DEDUPLICATION ---
        const uniqueUrls = new Set();
        aiResponse.images = aiResponse.images.filter(img => {
            if (!img.url || uniqueUrls.has(img.url)) return false;
            uniqueUrls.add(img.url);
            return true;
        });
        const uniqueVideoUrls = new Set();
        aiResponse.videos = aiResponse.videos.filter(video => {
            if (!video.url || uniqueVideoUrls.has(video.url)) return false;
            uniqueVideoUrls.add(video.url);
            return true;
        });

        const photoDecision = normalizePhotoDecision(aiResponse.photo_decision);
        const isPhotoRequestFlow = aiResponse.action === 'SEND_PHOTO'
            || aiResponse.action === 'SEND_BOTH'
            || hasPhotoIntent(effectiveHistory);

        if (isPhotoRequestFlow && photoDecision) {
            if (photoDecision.target_product_id && !aiResponse.product_id) {
                aiResponse.product_id = photoDecision.target_product_id;
            }

            if (photoDecision.clarification_needed) {
                aiResponse.images = [];
                aiResponse.videos = [];
                aiResponse.action = 'NONE';
                aiResponse.product_id = null;
                if (photoDecision.clarification_text) {
                    replyText = photoDecision.clarification_text;
                }
                console.log(`[Photo Clarification] AI requested clarification before sending media.`);
            } else if (photoDecision.requested_scope !== 'all' && aiResponse.images.length > 50) {
                const trimmedCount = aiResponse.images.length - 50;
                aiResponse.images = aiResponse.images.slice(0, 50);
                if (!/আরও ছবি/i.test(replyText)) {
                    const moreHint = `আরও ছবি লাগলে বলবেন, আমি বাকি ছবিগুলোও দেখাচ্ছি।`;
                    replyText = replyText ? `${replyText}\n\n${moreHint}` : moreHint;
                }
                console.log(`[Photo Scope] Applied AI-focused image scope. Trimmed ${trimmedCount} extra image(s).`);
            }
        }

        // NEW SMART TAG DETECTION
        let promptMode = decisionMode;
        const sendModeMatch = replyText ? replyText.match(/\[SEND_MODE:\s*(image_only|text_and_image|text_only)\]/i) : null;
        
        if (sendModeMatch) {
            promptMode = sendModeMatch[1].toLowerCase();
            // STRIP THE TAG FROM replyText SO USER NEVER SEES IT
            replyText = replyText.replace(/\[SEND_MODE:\s*(image_only|text_and_image|text_only)\]/i, '').trim();
            console.log(`[Smart Tag] Detected Mode: ${promptMode}. Tag stripped from message.`);
        } else {
            promptMode = promptMode || detectImageMode(pagePrompts?.text_prompt);
        }

        // REFINED: Strictly follow image_only if explicitly tagged or detected.
        if (promptMode === 'image_only' && (aiResponse.images.length > 0 || aiResponse.videos.length > 0)) {
            replyText = '';
        } else if (promptMode === 'image_title' && aiResponse.images.length > 0 && (!replyText || replyText.length < 5)) {
            const titles = aiResponse.images.map(img => img.title).filter(Boolean);
            replyText = titles.length > 0 ? titles.join('\n') : '';
        } else if (promptMode === 'title_desc' && replyText) {
            replyText = replyText
                .replace(/(?:৳|bdt|taka|tk)\s*[\d,.]+/gi, '')
                .replace(/[\d,.]+\s*(?:৳|bdt|taka|tk)/gi, '')
                .trim();
        }

        // Final Punctuation/Noise Check before sending to user
        if (replyText) {
             const cleanedForNoise = replyText.trim();
             const isJustPunctuation = /^[\s\p{P}]+$/u.test(cleanedForNoise);
             if (isJustPunctuation && cleanedForNoise.length > 0) {
                  console.log(`[Webhook] Silencing punctuation-only final reply: "${cleanedForNoise}"`);
                  replyText = "";
             }
        }

        try {
            await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'mark_seen');
            await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_on');
        } catch (e) {}

        let botMessageId = `bot_${Date.now()}`;

        // Final Scrub of any remaining "IMAGE:" tags (to prevent leaking to user)
        if (replyText) {
             replyText = replyText.replace(/IMAGE:\s*[^|\n]*\s*\|?\s*https?:\/\/[^\s,]+/gi, '').trim();
             replyText = replyText.replace(/^IMAGE:\s*/i, '').replace(/\nIMAGE:\s*/gi, '\n').trim();
        }

        if (replyText && replyText.length > 0) {
            // FIX: If AI says "no reply", we skip sending it to Facebook but still save it to our DB for history/tracking.
            const isNoReply = replyText.toLowerCase().trim() === 'no reply';
            let aiModelLabel = aiResponse.model || null;
            const isCheapEngineForLog = pageConfig.cheap_engine !== false;
            if (isCheapEngineForLog && (!pageConfig.api_key || pageConfig.api_key === 'MANAGED_SECRET_KEY')) {
                if (aiModelLabel === 'gemini-2.5-flash' || aiModelLabel === 'gemini-2.0-flash' || aiModelLabel === 'gemini-2.0-flash-lite') {
                    aiModelLabel = 'salesmanchatbot-pro';
                }
            }

            // Check if admin replied after last user message
            const lastUserTs = await dbService.getLastFbUserMessageTimestamp(pageId, senderId);
            const checkTs = lastUserTs || triggerTimestamp;
            const hasAdminReplied = await dbService.hasFbAdminReplySince(pageId, senderId, checkTs);
            
            if (hasAdminReplied) {
                console.log(`[FB] Bot skipped: Admin replied before send to ${senderId}`);
                await saveFbOutgoingLog({
                    pageId,
                    recipientId: senderId,
                    messageId: botMessageId,
                    text: '[Bot skipped: Admin replied before send]',
                    status: 'skipped_admin_reply',
                    replyBy: 'bot',
                    token: 0,
                    aiModel: aiModelLabel
                });
                // Still save product context in case admin needs it later
                if (aiResponse.foundProducts && aiResponse.foundProducts.length > 0) {
                    const lastProductId = aiResponse.foundProducts[0].id || aiResponse.foundProducts[0].product_id;
                    if (lastProductId) {
                        await dbService.saveChatMessage(sessionId, 'system', `[CONTEXT: LAST_RESOLVED_PRODUCT_ID: "${lastProductId}"]`);
                        console.log(`[Persistence] Saved last_resolved_product_id: ${lastProductId} for ${sessionId}`);
                    }
                }
                return;
            }

            await saveFbOutgoingLog({
                pageId,
                recipientId: senderId,
                messageId: botMessageId,
                text: replyText,
                status: isNoReply ? 'sent' : 'sending',
                replyBy: 'bot',
                token: aiResponse.token_usage || 0,
                aiModel: aiModelLabel
            });
            
            if (!isNoReply) {
                // Track bot reply in memory BEFORE sending to block the echo
                trackBotReply(senderId, replyText);
                
                try {
                    await facebookService.sendMessage(pageId, senderId, replyText, pageConfig.page_access_token);
                    await saveFbOutgoingLog({
                        pageId,
                        recipientId: senderId,
                        messageId: botMessageId,
                        text: replyText,
                        status: 'sent',
                        replyBy: 'bot',
                        token: aiResponse.token_usage || 0,
                        aiModel: aiModelLabel
                    });
                } catch (sendErr) {
                    console.error(`[FB Send Error] Failed to send message to ${senderId}:`, sendErr.message);
                    if (typeof logToFile === 'function') logToFile(`[FB Send Error] ${sendErr.message}`);
                    await saveFbOutgoingLog({
                        pageId,
                        recipientId: senderId,
                        messageId: botMessageId,
                        text: replyText,
                        status: 'api_failure',
                        replyBy: 'bot',
                        token: aiResponse.token_usage || 0,
                        aiModel: aiModelLabel
                    });
                }
            } else {
                console.log(`[AI Silence] Detected "no reply". Saving to DB but skipping Facebook send.`);
            }

            // --- PERSISTENCE: Save Last Resolved Product ID to Context ---
            if (aiResponse.foundProducts && aiResponse.foundProducts.length > 0) {
                const lastProductId = aiResponse.foundProducts[0].id || aiResponse.foundProducts[0].product_id;
                if (lastProductId) {
                    await dbService.saveChatMessage(sessionId, 'system', `[CONTEXT: LAST_RESOLVED_PRODUCT_ID: "${lastProductId}"]`);
                    console.log(`[Persistence] Saved last_resolved_product_id: ${lastProductId} for ${sessionId}`);
                }
            }
            // ----------------------------------
        }

        // Send Images (if any)
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            // First check if admin already replied after last user message
            const lastUserTs = await dbService.getLastFbUserMessageTimestamp(pageId, senderId);
            const checkTs = lastUserTs || triggerTimestamp;
            const hasAdminReplied = await dbService.hasFbAdminReplySince(pageId, senderId, checkTs);
            
            if (hasAdminReplied) {
                console.log(`[FB] Bot skipped images: Admin replied before send to ${senderId}`);
                // Don't save anything extra for skipped images
                return;
            }

            const images = aiResponse.images; // Array of {url, title}
            console.log(`[AI] Found ${images.length} images to send.`);
            
            // MASTER SWITCH: check if 'image_send' is FALSE (default TRUE if undefined)
            // User requirement: "jodi image send o false ... tobe full image send system ta kaj korbe na"
            const allowImageSend = !pagePrompts || (pagePrompts.image_send !== false && pagePrompts.image_send !== 'false' && pagePrompts.image_send !== 0 && pagePrompts.image_send !== '0');
            
            if (!allowImageSend) {
                console.log(`[Image Send] Disabled by Config (image_send=false). STRICT MODE: Sending nothing.`);
                // Do NOTHING. No links, no text fallback for images.
                // The AI's text reply (sent above) is all the user gets.
                
            } else {
                // Image Send ENABLED
                
                let sentViaCarousel = false;
                
                // Check Config for Template/Carousel
                // Robust check: handles boolean true, string 'true', integer 1, string '1'
                const tVal = pagePrompts?.template;
                const useCarousel = (tVal === true || tVal === 'true' || tVal === 1 || tVal === '1');
                
                console.log(`[Image Group] Template Check: Value=${tVal}, Result=${useCarousel}, ImageCount=${images.length}`);
    
                if (useCarousel && images.length > 1) {
                    console.log(`[Image Group] Template Reply ON. Sending via Carousel...`);
                    try {
                        const elements = images.map((imgObj, index) => ({
                            title: imgObj.title || `View Image ${index + 1}`,
                            subtitle: 'Tap to expand',
                            image_url: imgObj.url,
                            default_action: {
                                type: "web_url",
                                url: imgObj.url,
                                webview_height_ratio: "tall"
                            }
                        }));
                        
                        // Limit to 10 elements (FB limit)
                        const carouselElements = elements.slice(0, 10);
                        
                        const carouselResult = await facebookService.sendCarouselMessage(pageId, senderId, carouselElements, pageConfig.page_access_token);
                        sentViaCarousel = true;
                        console.log(`[Image Group] Sent ${images.length} images via Carousel.`);

                        // FIX: Save Carousel Message ID with Product Context for Reply-To Logic
                        if (carouselResult && carouselResult.message_id) {
                            const productContext = images.map(img => `${img.title || 'Product'} (${img.url})`).join(', ');
                            await dbService.saveFbChat({
                                page_id: pageId,
                                sender_id: pageId,
                                recipient_id: senderId,
                                message_id: carouselResult.message_id, // REAL FB MESSAGE ID
                                text: `[System Memory: User is viewing Carousel with: ${productContext}]`,
                                timestamp: Date.now(),
                                status: 'bot_carousel',
                                reply_by: 'system'
                            });
                        }
                    } catch (carouselError) {
                        console.error(`[Image Group] Carousel failed. Falling back to Binary Upload. Error: ${carouselError.message}`);
                        sentViaCarousel = false;
                    }
                }
    
                if (!sentViaCarousel) {
                    // Binary Upload Fallback - Sequential for Grouping
                    console.log(`[Image Send] Sending ${images.length} images sequentially for group appearance...`);
                    
                    for (const imgObj of images) {
                         try {
                             // --- FORCE UPLOAD FOR STABILITY (User Requirement) ---
                             // We skip the direct URL send and use the binary uploader immediately.
                             // This ensures the image is "uploaded" as an attachment rather than just a linked URL.
                             console.log(`[Image Upload] Forcing binary upload for: ${imgObj.url}`);
                             const uploadResult = await facebookService.sendImageUpload(pageId, senderId, imgObj.url, pageConfig.page_access_token);
                             
                             // FIX: Save Uploaded Image Message ID
                             if (uploadResult && uploadResult.message_id) {
                                await dbService.saveFbChat({
                                    page_id: pageId,
                                    sender_id: pageId,
                                    recipient_id: senderId,
                                    message_id: uploadResult.message_id, // REAL FB MESSAGE ID
                                    text: `[System Memory: User is viewing Image of ${imgObj.title || 'Product'}: ${imgObj.url}]`,
                                    timestamp: Date.now(),
                                    status: 'bot_image',
                                    reply_by: 'system'
                                });
                             }
                         } catch (imgError) {
                             console.error(`[Image Upload] Failed to upload image ${imgObj.url}: ${imgError.message}`);
                             
                             // FINAL FALLBACK: If binary upload fails, try sending via URL as a last resort
                             try {
                                 console.log(`[Image Fallback] Attempting direct URL send for: ${imgObj.url}`);
                                 await facebookService.sendImageMessage(pageId, senderId, imgObj.url, pageConfig.page_access_token);
                             } catch (urlError) {
                                 console.error(`[Image Fallback] Direct URL send also failed: ${urlError.message}`);
                                 // If everything fails, send as a text link
                                 const fallbackText = `Link: ${imgObj.url}`;
                                 await facebookService.sendMessage(pageId, senderId, fallbackText, pageConfig.page_access_token);
                             }
                         }
                    }
                    console.log(`[Image Group] All images processed.`);
                }
            }
        }

        if (aiResponse.videos && Array.isArray(aiResponse.videos) && aiResponse.videos.length > 0) {
            const videos = aiResponse.videos;
            console.log(`[AI] Found ${videos.length} videos to send.`);

            const allowImageSend = !pagePrompts || (pagePrompts.image_send !== false && pagePrompts.image_send !== 'false' && pagePrompts.image_send !== 0 && pagePrompts.image_send !== '0');

            if (!allowImageSend) {
                console.log(`[Video Send] Disabled by Config (image_send=false). STRICT MODE: Sending nothing.`);
            } else {
                const uploadPromises = videos.map(async (videoObj) => {
                    try {
                        console.log(`[Video Upload] Uploading video for: ${videoObj.url}`);
                        const uploadResult = await facebookService.sendVideoUpload(pageId, senderId, videoObj.url, pageConfig.page_access_token);

                        if (uploadResult && uploadResult.message_id) {
                            await dbService.saveFbChat({
                                page_id: pageId,
                                sender_id: pageId,
                                recipient_id: senderId,
                                message_id: uploadResult.message_id,
                                text: `[System Memory: User is viewing Video of ${videoObj.title || 'Product'}: ${videoObj.url}]`,
                                timestamp: Date.now(),
                                status: 'bot_video',
                                reply_by: 'system'
                            });
                        }
                    } catch (videoError) {
                        console.error(`[Video Upload] Failed to upload video ${videoObj.url}: ${videoError.message}`);

                        try {
                            console.log(`[Video Fallback] Attempting direct URL send for: ${videoObj.url}`);
                            await facebookService.sendVideoMessage(pageId, senderId, videoObj.url, pageConfig.page_access_token);
                        } catch (urlError) {
                            console.error(`[Video Fallback] Direct URL send also failed: ${urlError.message}`);
                            const fallbackText = `Video Link: ${videoObj.url}`;
                            await facebookService.sendMessage(pageId, senderId, fallbackText, pageConfig.page_access_token);
                        }
                    }
                });

                await Promise.all(uploadPromises);
                console.log(`[Video Group] All videos processed.`);
            }
        }

        // 7. Save History & Lead
        // Save User Message (Combined with Context)
        if (!hasAudioTurn) {
            await dbService.saveChatMessage(sessionId, 'user', finalUserMessage);
        }

        // Prepare Assistant History Content
        let historyReplyText = replyText;
        
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            let memoryNote = "";
            
            // Priority: Use 'foundProducts' if available to be specific about WHICH product
            // FIX: Include product names, URLs AND descriptions so AI knows exactly what it sent.
            let relevantProducts = [];
            if (aiResponse.foundProducts && Array.isArray(aiResponse.foundProducts) && aiResponse.foundProducts.length > 0) {
                 const sentImages = aiResponse.images.map(img => typeof img === 'string' ? img : img.url);
                 relevantProducts = aiResponse.foundProducts.filter(p => sentImages.includes(p.image_url));
            }

            if (relevantProducts.length > 0) {
                 const productNames = relevantProducts.map(p => p.name).join(', ');
                 memoryNote = `[SYSTEM MEMORY: Sent images for ${productNames}. The user is now looking at these specific products. If they haven't provided their NAME and ADDRESS, ask for them now to finalize the order.]`;
            } else {
                 memoryNote = `[SYSTEM MEMORY: Sent images to user. Continue with the sales flow and ensure you ask for their NAME and FULL ADDRESS.]`;
            }
            
            // MERGE MEMORY INTO ASSISTANT MESSAGE to preserve context flow
            historyReplyText += `\n\n${memoryNote}`;

            // Save to fb_chats (for Audit/Debugging & User Requirement)
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId, // System is sender
                recipient_id: senderId, // User is recipient (context)
                message_id: `mem_${Date.now()}`,
                text: memoryNote,
                timestamp: Date.now(),
                status: 'ai_memory',
                reply_by: 'system'
            });
        }

        // Save Assistant Reply (Text + Memory) to AI Context
        await dbService.saveChatMessage(sessionId, 'assistant', historyReplyText);

        await dbService.saveLead({
            page_id: pageId,
            sender_id: senderId,
            message: finalUserMessage,
            reply: replyText
        });

        // 8. Deduct Credit (ONLY IF CHEAP ENGINE IS ACTIVE)
        if (isCheapEngine) {
            const deductionResult = await dbService.deductCredit(pageId);
            console.log(`[Credit] Deduction Result for Page ${pageId}: ${deductionResult ? 'Success' : 'Failed/NoCredit'}`);
        } else {
            console.log(`[Credit] Skipped deduction for Page ${pageId} (Own API Mode)`);
        }
    } catch (error) {
        console.error(`[Webhook Process Error] ${senderId}:`, error.message);
        if (typeof logToFile === 'function') logToFile(`[Webhook Error] ${error.message}`);
        
        // Log detailed error to DB for admin visibility
        await dbService.logError(error, 'Webhook Controller - Message Processing', {
            pageId,
            senderId,
            sessionId,
            text: combinedText.substring(0, 500)
        });
    } finally {
        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_off');
    }
}

// Handle Comments (n8n "OnComment" Logic)
async function processCommentEvent(changeValue, entryPageId = null) {
    try {
        return;
        if (changeValue.item !== 'comment' || changeValue.verb !== 'add') return;

        const commentId = changeValue.comment_id;
        const message = changeValue.message;
        const senderId = changeValue.from?.id;
        const senderName = changeValue.from?.name || 'Unknown';
        const postId = changeValue.post_id;
        
        // Priority: Use entryPageId from Webhook Entry if available, otherwise extract from Post ID
        const pageId = entryPageId || postId.split('_')[0]; 

        // Ignore if sender is the page itself
        if (senderId === pageId) return;

        console.log(`Processing comment ${commentId} from ${senderName}: ${message}`);

        // 1. Save to DB (Avoid Duplicates)
        await dbService.saveFbComment({
            comment_id: commentId,
            page_id: pageId,
            sender_id: senderId,
            post_id: postId,
            message: message,
            status: 'received'
        });

        // 2. Fetch Config
        const pageConfig = await dbService.getPageConfig(pageId);
        if (!pageConfig || pageConfig.subscription_status === 'banned') {
             console.log(`Page ${pageId} inactive, banned or not found.`);
             return;
        }

        // --- CREDIT CHECK LOGIC (Modified for Cheap Engine vs Own API) ---
        // Default to TRUE (Cheap Engine) if undefined, for backward compatibility
        const isCheapEngine = pageConfig.cheap_engine !== false; 

        const hasBonus = Number(pageConfig.bonus_credit || 0) > 0;
        const hasPermanent = Number(pageConfig.permanent_credit || 0) > 0;
        const hasDaily = Number(pageConfig.daily_limit || 0) > Number(pageConfig.daily_used || 0);
        const hasLegacy = Number(pageConfig.message_credit || 0) > 0;

        const hasAnyCredit = (hasBonus || hasPermanent || hasDaily || hasLegacy);

        if (isCheapEngine) {
            if (!hasAnyCredit) {
                console.log(`Page ${pageId} out of credits for comments (Cheap Engine Active).`);
                return;
            }
        } else {
             console.log(`Page ${pageId} using Own API for comments. Bypassing credit check.`);
        }
        // -----------------------------------------------------------------

        // 3. Generate AI Reply
        // Use a simplified prompt for comments (or same as chat)
        const pagePrompts = await dbService.getPagePrompts(pageId);
        
        // Pass "COMMENT_CONTEXT" to help AI understand
        const aiResponse = await aiService.generateReply(
            `[User Commented on Post]: ${message}`, 
            pageConfig, 
            pagePrompts, 
            [] // No history for comments usually, just single turn
        );

        const replyText = aiResponse.reply;

        if (!replyText || replyText.toLowerCase().trim() === 'no reply') return;

        // 4. Reply to Comment
        await facebookService.replyToComment(commentId, replyText, pageConfig.page_access_token);
        
        // 5. Update DB Status
        await dbService.saveFbComment({
            comment_id: commentId,
            reply_text: replyText,
            status: 'replied'
        });

        // 6. Deduct Credit (ONLY IF CHEAP ENGINE IS ACTIVE)
        if (isCheapEngine) {
             await dbService.deductCredit(pageId);
        } else {
             console.log(`[Credit] Skipped deduction for Page ${pageId} (Own API Mode)`);
        }
        
        console.log(`Replied to comment ${commentId}`);

    } catch (error) {
        console.error("Error processing comment:", error);
        const safeMeta = changeValue ? { commentId: changeValue.comment_id, senderId: changeValue.from?.id } : { raw: 'Invalid changeValue' };
        dbService.logError(error, 'Webhook Controller - Comment Processing', safeMeta);
    }
}

// --- CACHE MANAGEMENT ---
/**
 * Clears cached configuration and prompts for a specific page.
 * @param {string} pageId - Facebook Page ID or WhatsApp Session Name
 */
function clearPageCache(pageId) {
    if (!pageId) return;
    const key = String(pageId);
    configCache.delete(key);
    
    // Also reset gatekeeper to allow new/updated pages immediately
    lastCacheUpdate = 0; 
    refreshAllowedPages();
    
    console.log(`[Cache] Cleared config cache and gatekeeper reset for: ${key}`);
}

/**
 * Clears the gatekeeper cache and all configuration caches.
 */
async function clearAllCaches() {
    configCache.clear();
    allowedPagesCache.clear();
    lastCacheUpdate = 0;
    await refreshAllowedPages();
    console.log(`[Cache] All caches cleared and gatekeeper refreshed.`);
}

// Endpoint to get recent webhook logs for debugging
const getWebhookLogs = (req, res) => {
    const { sourceId } = req.query;
    
    if (sourceId) {
        // Filter logs by pageId or phoneId
        const filteredLogs = recentWebhookLogs.filter(log => 
            log.sourceId === String(sourceId) || log.sourceId === 'verification'
        );
        return res.status(200).json({ logs: filteredLogs });
    }

    res.status(200).json({ logs: recentWebhookLogs });
};

module.exports = {
    handleWebhook,
    verifyWebhook,
    handleWhatsAppWebhook,
    verifyWhatsAppWebhook,
    getWebhookLogs,
    clearPageCache,
    clearAllCaches
};
