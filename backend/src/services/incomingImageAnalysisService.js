const crypto = require('crypto');
const aiService = require('./aiService');
const dbService = require('./dbService');

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

function safeJsonParse(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function extractJsonObject(text) {
    const raw = String(text || '').replace(/```json|```/gi, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(raw.slice(start, end + 1));
    } catch {
        return null;
    }
}

function clampMatchScore(value) {
    const score = Number(value || 0);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, Number(score.toFixed(1))));
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
        matched_image_url: normalizePublicMediaUrl(product.matched_image_url || product.image_url),
        additional_images: Array.isArray(product.additional_images) ? product.additional_images.map(normalizePublicMediaUrl).filter(Boolean) : [],
        match_score: score,
        base_match_score: score,
        visual_fingerprint: safeJsonParse(product.visual_fingerprint, {}),
        visual_tags: product.visual_tags || [],
        searchable_text: product.searchable_text || '',
        keywords: product.keywords || ''
    };
}

function buildVisualMatchDecision(matches) {
    const top = matches?.[0] || null;
    if (!top) return { status: 'NO_MATCH', confidence: 'low', reason: 'no_candidate', options: [] };

    const second = matches[1] || null;
    const topScore = Number(top.match_score || 0);
    const secondScore = Number(second?.match_score || 0);
    const gap = second ? Number((topScore - secondScore).toFixed(1)) : 100;
    const options = matches.slice(0, 5).map((match) => ({
        product_id: match.product_id,
        product_name: match.name,
        name: match.name,
        match_score: match.match_score,
        base_match_score: match.base_match_score ?? match.match_score,
        fingerprint_bonus: match.fingerprint_bonus || 0
    }));

    if (topScore < 50) return { status: 'NO_PRODUCT_MATCH', confidence: 'low', reason: 'top_score_below_50_threshold', score_gap: gap, options: [] };
    if (topScore < 70) return { status: 'POSSIBLE_PRODUCT_MATCH', confidence: 'low', reason: 'weak_but_allowed_by_50_threshold', score_gap: gap, options };
    if (second && gap < 3) return { status: 'AMBIGUOUS_MATCH', confidence: 'medium', reason: 'top_candidates_too_close', score_gap: gap, options };
    return { status: 'CONFIDENT_MATCH', confidence: topScore >= 80 ? 'high' : 'medium', reason: 'image_embedding_score_above_threshold', score_gap: gap, options };
}

function normalizeCachedMatches(value) {
    if (Array.isArray(value)) return value;
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? parsed : [];
}

function resolveIncomingImagePrompt({ pagePrompts = null, pageConfig = null, fallbackPrompt = '' } = {}) {
    const promptSources = [pagePrompts, pageConfig?.page_prompts, pageConfig];
    for (const source of promptSources) {
        if (!source || typeof source !== 'object') continue;
        if (typeof source.image_prompt === 'string' && source.image_prompt.trim()) return source.image_prompt.trim();
        if (typeof source.vision_prompt === 'string' && source.vision_prompt.trim()) return source.vision_prompt.trim();
    }
    return String(fallbackPrompt || '').trim();
}

function extractVisionReasoningText(result = {}) {
    if (typeof result.matchDecision?.vision_reasoning_text === 'string' && result.matchDecision.vision_reasoning_text.trim()) {
        return result.matchDecision.vision_reasoning_text.trim();
    }

    const analysisText = String(result.analysisText || '');
    const match = analysisText.match(/\[Product Vision Reasoning\]([\s\S]*)$/i);
    return match ? String(match[1] || '').trim() : '';
}

function stripVisionReasoningFromAnalysis(text) {
    return String(text || '')
        .replace(/\n*\[Product Vision Reasoning\][\s\S]*$/i, '')
        .trim();
}

function formatVisionDecisionSummary(reasoningText) {
    const parsed = extractJsonObject(reasoningText);
    if (!parsed) return 'final_decision=unavailable';

    // Support both old JSON schema (matched_products) and new JSON schema (best_product_id/per_image_match)
    if (parsed.matched_products === undefined && parsed.non_product_analysis === undefined && parsed.status === undefined) {
        return null;
    }

    const lines = [];
    lines.push(`status=${parsed.status || 'unknown'}`);
    if (parsed.visual_text) lines.push(`visual_text=${String(parsed.visual_text).trim()}`);
    if (parsed.ocr_text) lines.push(`ocr_text=${String(parsed.ocr_text).trim()}`);

    // If new schema is found, format it
    if (parsed.per_image_match || parsed.best_product_id) {
        if (parsed.best_product_id) {
            lines.push(`best_product_id=${parsed.best_product_id} | best_product_name=${parsed.best_product_name || 'Unknown'} | confidence=${parsed.confidence || 'unknown'}`);
            if (parsed.reasoning) lines.push(`reasoning=${parsed.reasoning}`);
        } else {
             lines.push('matched_products=None');
             if (parsed.reasoning) lines.push(`reasoning=${parsed.reasoning}`);
        }
        return lines.join('\n');
    }

    // Fallback to old schema
    const matchedProducts = Array.isArray(parsed.matched_products) ? parsed.matched_products : [];
    if (matchedProducts.length > 0) {
        matchedProducts.forEach((product, idx) => {
            lines.push(`${idx + 1}. product_id=${product.product_id || 'N/A'} | product_name=${product.product_name || 'Unknown'} | confidence=${product.confidence || 'unknown'}${product.reason ? ` | reason=${product.reason}` : ''}`);
        });
    } else if (parsed.non_product_analysis?.summary) {
        lines.push(`summary=${String(parsed.non_product_analysis.summary).trim()}`);
    } else {
        lines.push('matched_products=None');
    }

    return lines.join('\n');
}

async function analyzeAndMatchIncomingImage({
    platform,
    pageId,
    senderId,
    imageUrl,
    imageIndex,
    batchId,
    pageConfig,
    prompt
}) {
    const imageHash = await buildImageHash(imageUrl);
    const useIncomingImageCache = false;

    if (useIncomingImageCache) {
        const cached = await dbService.getIncomingImageAnalysis({ platform, pageId, senderId, imageUrl, imageHash });
        if (cached?.analysis_text) {
            const cachedMatches = normalizeCachedMatches(cached.matched_products);
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
    let analysisText = typeof visionResult === 'object' ? String(visionResult.text || '').trim() : String(visionResult || '').trim();
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
                .filter((product) => product && Number(product.direct_image_score || product.match_score || 0) >= 50)
                .sort((a, b) => Number(b.direct_image_score || 0) - Number(a.direct_image_score || 0))
                .slice(0, 5);

            matchDecision = buildVisualMatchDecision(matchedProducts);
            if (matchedProducts.length > 0) {
                const reasoned = await aiService.reasonImageProductMatchWithVision(imageUrl, matchedProducts, pageConfig, { timeoutMs: 45000 });
                if (reasoned?.text) {
                    matchDecision.vision_reasoning_text = reasoned.text;
                    analysisText += `\n\n[Product Vision Reasoning]\n${reasoned.text}`;
                }
            }
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
    const cleanAnalysisText = stripVisionReasoningFromAnalysis(result.analysisText || '');
    const reasoningText = extractVisionReasoningText(result);
    const reasoningSummary = reasoningText ? formatVisionDecisionSummary(reasoningText) : null;
    let block = `[${label} VISUAL EVIDENCE]\nAnalyzer Summary / OCR / Visual Text:\n${cleanAnalysisText || 'N/A'}`;

    if (reasoningSummary) {
        block += `\n\n[Product Vision Reasoning]\n${reasoningText}`;
        block += `\n\nVision Final Decision:\n${reasoningSummary}`;
    } else {
        const candidates = result.matchedProducts || [];
        if (candidates.length > 0) {
            const options = candidates.map((product, idx) => {
                return `${idx + 1}. product_id=${product.product_id} | product_name=${product.name || 'Unknown'} | image_score=${clampMatchScore(product.direct_image_score ?? product.match_score)}%`;
            }).join('\n');
            const decision = result.matchDecision || {};
            block += `\n\nProduct Match Gate (Embedding Fallback):\nstatus=${decision.status || 'EVIDENCE_ONLY'} | confidence=${decision.confidence || 'informational'} | reason=${decision.reason || 'vision_reasoning_failed'}`;
            block += `\n\nRecommended Product Candidates:\n${options}`;
        } else {
            block += `\n\nProduct Match Gate:\nstatus=no_product_match\nmatched_products=None`;
        }
    }

    return block;
}

function buildLastImageMap(results) {
    return results.reduce((map, result) => {
        const options = result.matchDecision?.options || [];
        const primary = result.topMatch || options[0] || null;
        if (primary || options.length > 0) {
            map[String(result.imageIndex)] = {
                product_id: primary?.product_id || null,
                name: primary?.name || null,
                product_name: primary?.name || null,
                match_score: primary?.match_score || null,
                match_decision: result.matchDecision?.status || 'UNKNOWN',
                candidate_options: options,
                image_url: result.imageUrl
            };
        }
        return map;
    }, {});
}

module.exports = {
    clampMatchScore,
    resolveIncomingImagePrompt,
    analyzeAndMatchIncomingImage,
    formatImageAnalysisBlock,
    buildLastImageMap
};
