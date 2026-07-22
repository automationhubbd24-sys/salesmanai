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

function normalizeCandidateUrl(url) {
    if (!url || url === 'N/A') return null;
    const value = String(url).trim();
    if (!value) return null;
    return value.startsWith('http') ? value : normalizePublicMediaUrl(value);
}

function parseMaybeJson(value, fallback = []) {
    if (Array.isArray(value)) return value;
    const parsed = safeJsonParse(value, fallback);
    return Array.isArray(parsed) ? parsed : fallback;
}

function collectCandidateImages(product, limit = 3) {
    const urls = [];
    const seen = new Set();
    const push = (value) => {
        const clean = normalizeCandidateUrl(value);
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        urls.push(clean);
    };

    push(product.matched_image_url);
    push(product.image_url);
    parseMaybeJson(product.additional_images, []).forEach(push);
    parseMaybeJson(product.variants, []).forEach((item) => push(item?.image_url));
    parseMaybeJson(product.sku_matrix, []).forEach((item) => push(item?.image_url));
    return urls.slice(0, Math.max(1, Number(limit) || 3));
}

function mergeBatchCandidates(perImageCandidates, topK = 5) {
    const byId = new Map();
    perImageCandidates.forEach((entry) => {
        const imageIndex = Number(entry.image_index || 0);
        (entry.candidates || []).forEach((candidate) => {
            const id = String(candidate.id || '').trim();
            const score = Number(candidate.score || 0);
            if (!id || !Number.isFinite(score)) return;
            const existing = byId.get(id);
            if (!existing) {
                byId.set(id, {
                    ...candidate,
                    best_score: score,
                    score_sum: score,
                    appear_count: 1,
                    source_image_indexes: imageIndex ? [imageIndex] : [],
                    per_image_scores: imageIndex ? [{ image_index: imageIndex, score }] : []
                });
                return;
            }

            existing.best_score = Math.max(existing.best_score, score);
            existing.score_sum += score;
            existing.appear_count += 1;
            if (imageIndex) {
                if (!existing.source_image_indexes.includes(imageIndex)) existing.source_image_indexes.push(imageIndex);
                existing.per_image_scores.push({ image_index: imageIndex, score });
            }
            if (score > Number(existing.score || 0)) {
                Object.assign(existing, candidate);
            }
        });
    });

    return Array.from(byId.values())
        .map((candidate) => ({
            ...candidate,
            merged_score: Number((candidate.best_score + Math.min(8, Math.max(0, candidate.appear_count - 1) * 2.5)).toFixed(1))
        }))
        .sort((a, b) => Number(b.merged_score || 0) - Number(a.merged_score || 0))
        .slice(0, Math.max(1, Number(topK) || 5));
}

async function resolveOpenAiCompatibleVisionConfig(pageConfig = {}) {
    return aiService.resolveOpenAiCompatibleVisionConfig(pageConfig);
}

function resolveImageMatchingMode(pageConfig = {}) {
    const rawMode = String(
        pageConfig.image_matching_mode
        || pageConfig.image_analysis_architecture
        || pageConfig.page_prompts?.image_matching_mode
        || pageConfig.page_prompts?.image_analysis_architecture
        || process.env.DEFAULT_IMAGE_MATCHING_MODE
        || 'ab_independent'
    ).trim().toLowerCase();

    if (['legacy', 'single_pass', 'embedding_only'].includes(rawMode)) return 'legacy';
    if (['ab_merged', 'merged', 'batch_merged'].includes(rawMode)) return 'ab_merged';
    return 'ab_independent';
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        const bodyText = await response.text();
        let parsed = null;
        try {
            parsed = JSON.parse(bodyText);
        } catch {
            parsed = null;
        }
        if (!response.ok) {
            throw new Error(parsed?.error?.message || bodyText || `HTTP ${response.status}`);
        }
        return parsed;
    } finally {
        clearTimeout(timeout);
    }
}

function buildBatchReasoningPrompt(userImageUrls, candidates, candidateImageLimit) {
    const candidateList = candidates.map((candidate, idx) => {
        const imageCount = collectCandidateImages(candidate, candidateImageLimit).length;
        return `${idx + 1}. product_id=${candidate.id}, product_name=${candidate.name || 'Unknown'}, price=${candidate.price || 'N/A'} ${candidate.currency || 'BDT'}, merged_score=${candidate.merged_score || candidate.score}%, source_images=${(candidate.source_image_indexes || []).join(',') || 'unknown'}, images=${imageCount}`;
    }).join('\n');

    return `You are validating multi-image product matching for an ecommerce chatbot.
Compare ALL USER IMAGES against the candidate product images in this request.

Rules:
- Candidate order is only a hint from image embedding. Trust the visuals more than the scores.
- If a user image is a collage or screenshot, identify every visible product you can confirm.
- Return only products that visually match. If nothing matches, return status "no_product_match".
- If the result is unclear between close products, return status "ambiguous".
- Return valid JSON only.

Schema:
{"status":"match|multi_match|ambiguous|no_product_match","reasoning":"short explanation","matched_products":[{"product_id":"string","product_name":"string","confidence":"high|medium|low","reason":"short"}],"per_image_match":[{"image_index":1,"matched_product_ids":["string"],"reason":"short"}],"user_images_visual_text":[{"image_index":1,"visual_summary":"short","visible_products_count":"number_or_unknown"}],"candidate_comparison":[{"product_id":"string","product_name":"string","visual_match":"exact|partial|no_match","reason":"short"}]}

User image count: ${userImageUrls.length}
Merged top candidates:
${candidateList}`;
}

async function analyzeIncomingImageBatchMerged({
    results = [],
    pageConfig = {},
    candidateImageLimit = Number(process.env.IMAGE_AB_CANDIDATE_IMAGES || 3),
    topK = Number(process.env.IMAGE_AB_TOP_K || 5),
    timeoutMs = Number(process.env.IMAGE_AB_VISION_TIMEOUT_MS || process.env.PRODUCT_VISION_REASONING_TIMEOUT_MS || 45000)
} = {}) {
    const uniqueUserImageUrls = Array.from(new Set(
        (results || [])
            .map((result) => normalizeCandidateUrl(result?.imageUrl))
            .filter(Boolean)
    )).slice(0, Math.max(2, Number(process.env.IMAGE_AB_MAX_USER_IMAGES || 6)));

    if (uniqueUserImageUrls.length < 2) return null;

    const perImageCandidates = (results || []).map((result) => ({
        image_index: result?.imageIndex,
        candidates: (result?.matchedProducts || [])
            .map((product) => ({
                id: String(product?.product_id || '').trim(),
                name: product?.name || product?.product_name || null,
                price: product?.price || null,
                currency: product?.currency || 'BDT',
                image_url: normalizeCandidateUrl(product?.image_url),
                matched_image_url: normalizeCandidateUrl(product?.matched_image_url || product?.image_url),
                additional_images: Array.isArray(product?.additional_images) ? product.additional_images : parseMaybeJson(product?.additional_images, []),
                variants: Array.isArray(product?.variants) ? product.variants : parseMaybeJson(product?.variants, []),
                sku_matrix: Array.isArray(product?.sku_matrix) ? product.sku_matrix : parseMaybeJson(product?.sku_matrix, []),
                score: clampMatchScore(product?.direct_image_score ?? product?.match_score)
            }))
            .filter((product) => product.id && Number(product.score || 0) >= 50)
            .slice(0, Math.max(1, Number(topK) || 5))
    })).filter((entry) => entry.candidates.length > 0);

    if (perImageCandidates.length < 2) return null;

    const mergedCandidates = mergeBatchCandidates(perImageCandidates, topK);
    if (mergedCandidates.length === 0) return null;

    const config = await resolveOpenAiCompatibleVisionConfig(pageConfig);
    if (!config.apiKey || !config.baseURL || !config.model) return null;

    const content = [{ type: 'text', text: buildBatchReasoningPrompt(uniqueUserImageUrls, mergedCandidates, candidateImageLimit) }];
    uniqueUserImageUrls.forEach((url, idx) => {
        content.push({ type: 'text', text: `USER IMAGE ${idx + 1}:` });
        content.push({ type: 'image_url', image_url: { url } });
    });

    mergedCandidates.forEach((candidate, idx) => {
        const productImages = collectCandidateImages(candidate, candidateImageLimit);
        content.push({
            type: 'text',
            text: `CANDIDATE ${idx + 1}: product_id=${candidate.id}, product_name=${candidate.name || 'Unknown'}, merged_score=${candidate.merged_score || candidate.score}%`
        });
        productImages.forEach((url, imageIdx) => {
            content.push({ type: 'text', text: `Candidate ${idx + 1} image ${imageIdx + 1}` });
            content.push({ type: 'image_url', image_url: { url } });
        });
    });

    try {
        const json = await fetchJsonWithTimeout(`${config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [{ role: 'user', content }],
                temperature: 0.1,
                max_tokens: Number(process.env.IMAGE_AB_MAX_TOKENS || 2200)
            })
        }, timeoutMs);

        const raw = String(json?.choices?.[0]?.message?.content || '').trim();
        if (!raw) return null;

        return {
            raw,
            parsed: extractJsonObject(raw),
            usage: Number(json?.usage?.total_tokens || json?.usage?.completion_tokens || 0),
            model: json?.model || config.model,
            mergedCandidates,
            userImageUrls: uniqueUserImageUrls
        };
    } catch (error) {
        console.warn(`[Image Batch AB] Failed: ${error.message}`);
        return null;
    }
}

function buildIndependentAggregatePrompt(results = []) {
    const blocks = (results || []).map((result) => {
        const reasoningText = extractVisionReasoningText(result);
        const fallback = reasoningText
            ? reasoningText
            : JSON.stringify({
                image_index: result?.imageIndex || null,
                status: 'no_product_match',
                matched_products: [],
                reason: result?.matchDecision?.reason || 'no_visual_reasoning'
            });
        return `IMAGE ${result?.imageIndex || 'unknown'} RESULT:\n${fallback}`;
    }).join('\n\n');

    return `You are the final multi-image product matching judge for an ecommerce chatbot.

Each user image was independently analyzed with image embedding + candidate product vision comparison.
Now combine those per-image results into one strict final decision.

Rules:
- Trust the per-image visual reasoning more than embedding rank.
- If multiple images match different products, return all confirmed products.
- If the same product appears in multiple images, keep it once in matched_products but mention all source_image_indexes.
- If nothing is visually confirmed, return status "no_product_match".
- If results conflict or remain uncertain, return status "ambiguous".
- Return valid JSON only.

Schema:
{"status":"match|multi_match|ambiguous|no_product_match","reasoning":"short explanation","matched_products":[{"source_image_indexes":[1],"product_id":"string","product_name":"string","confidence":"high|medium|low","reason":"short"}],"per_image_match":[{"image_index":1,"matched_product_ids":["string"],"reason":"short"}]}

Per-image results:
${blocks}`;
}

async function analyzeIncomingImageBatchIndependent({
    results = [],
    pageConfig = {},
    timeoutMs = Number(process.env.IMAGE_AB_VISION_TIMEOUT_MS || process.env.PRODUCT_VISION_REASONING_TIMEOUT_MS || 45000)
} = {}) {
    const usableResults = (results || []).filter((result) => result && result.imageUrl);
    if (usableResults.length < 2) return null;

    const config = await resolveOpenAiCompatibleVisionConfig(pageConfig);
    if (!config.apiKey || !config.baseURL || !config.model) return null;

    try {
        const json = await fetchJsonWithTimeout(`${config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [{
                    role: 'user',
                    content: [{ type: 'text', text: buildIndependentAggregatePrompt(usableResults) }]
                }],
                temperature: 0.1,
                max_tokens: Number(process.env.IMAGE_AB_FINAL_MAX_TOKENS || 1600)
            })
        }, timeoutMs);

        const raw = String(json?.choices?.[0]?.message?.content || '').trim();
        if (!raw) return null;

        return {
            raw,
            parsed: extractJsonObject(raw),
            usage: Number(json?.usage?.total_tokens || json?.usage?.completion_tokens || 0),
            model: json?.model || config.model,
            mode: 'ab_independent'
        };
    } catch (error) {
        console.warn(`[Image Batch AB Independent] Failed: ${error.message}`);
        return null;
    }
}

async function analyzeIncomingImageBatch(args = {}) {
    const mode = resolveImageMatchingMode(args.pageConfig || {});
    if (mode === 'legacy') return null;
    if (mode === 'ab_merged') return analyzeIncomingImageBatchMerged(args);
    return analyzeIncomingImageBatchIndependent(args);
}

function formatBatchImageAnalysisBlock(aggregateResult) {
    if (!aggregateResult?.raw) return '';
    const reasoningSummary = formatVisionDecisionSummary(aggregateResult.raw);
    const mode = aggregateResult?.mode || 'ab_merged';
    let block = `[MULTI IMAGE AB MATCH]\nmode=${mode}\nThis block combines all user images into one final match decision. Prefer it over a single-image fallback when it is present.`;
    block += `\n\n[Product Vision Reasoning]\n${aggregateResult.raw}`;
    if (reasoningSummary) {
        block += `\n\nVision Final Decision:\n${reasoningSummary}`;
    }
    return block;
}

function composeImageAnalysisBlocks(results = [], aggregateResult = null) {
    const blocks = (results || []).map(formatImageAnalysisBlock).filter(Boolean);
    const aggregateBlock = formatBatchImageAnalysisBlock(aggregateResult);
    if (aggregateBlock) blocks.push(aggregateBlock);
    return blocks.join('\n\n').trim();
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
    if (!parsed) return null;

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

function extractConfirmedMatchesFromReasoning(reasoningText) {
    const parsed = extractJsonObject(reasoningText);
    if (!parsed) return [];

    const matches = [];
    const matchedProducts = Array.isArray(parsed?.matched_products) ? parsed.matched_products : [];
    matchedProducts.forEach((product) => {
        const id = String(product?.product_id || '').trim();
        const confidence = String(product?.confidence || '').toLowerCase();
        if (!id || confidence === 'low') return;
        matches.push({
            product_id: id,
            product_name: product?.product_name || product?.name || null,
            confidence: confidence || 'medium',
            reason: product?.reason || null
        });
    });

    const bestProductId = String(parsed?.best_product_id || '').trim();
    if (bestProductId) {
        matches.push({
            product_id: bestProductId,
            product_name: parsed?.best_product_name || null,
            confidence: String(parsed?.confidence || '').toLowerCase() || 'medium',
            reason: parsed?.reasoning || null
        });
    }

    return matches.filter((match, index, list) => list.findIndex((item) => item.product_id === match.product_id) === index);
}

function buildAggregatePerImageMatchMap(aggregateResult = null) {
    const parsed = aggregateResult?.parsed;
    const entries = Array.isArray(parsed?.per_image_match) ? parsed.per_image_match : [];
    return entries.reduce((map, entry) => {
        const imageIndex = String(entry?.image_index || '').trim();
        if (!imageIndex) return map;
        const ids = Array.isArray(entry?.matched_product_ids)
            ? entry.matched_product_ids
            : [entry?.matched_product_id];
        const cleanIds = ids.map((id) => String(id || '').trim()).filter(Boolean);
        if (cleanIds.length > 0) map.set(imageIndex, cleanIds);
        return map;
    }, new Map());
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

    // Always run vector search even if initial vision fails (e.g. timeout), so we still have embedding fallback
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
        
        // Run product-vs-candidate visual reasoning even if the generic analyzer failed.
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

function buildLastImageMap(results, aggregateResult = null) {
    return buildLastImageMapWithAggregate(results, aggregateResult);
}

function buildLastImageMapWithAggregate(results, aggregateResult = null) {
    const aggregatePerImageMap = buildAggregatePerImageMatchMap(aggregateResult);
    return results.reduce((map, result) => {
        const reasoningMatches = extractConfirmedMatchesFromReasoning(extractVisionReasoningText(result));
        const options = result.matchDecision?.options || [];
        const aggregateIds = aggregatePerImageMap.get(String(result.imageIndex)) || [];
        const aggregatePrimaryId = aggregateIds[0] || null;
        const primary =
            reasoningMatches[0]
            || (aggregatePrimaryId ? options.find((option) => String(option?.product_id || '') === aggregatePrimaryId) : null)
            || null;

        const confirmedIds = new Set([
            ...reasoningMatches.map((item) => String(item.product_id)),
            ...aggregateIds.map((id) => String(id))
        ]);

        if (primary && confirmedIds.size > 0) {
            map[String(result.imageIndex)] = {
                product_id: primary?.product_id || null,
                name: primary?.name || primary?.product_name || null,
                product_name: primary?.name || primary?.product_name || null,
                match_score: primary?.match_score || null,
                match_decision: result.matchDecision?.status || 'CONFIRMED_VISUAL_MATCH',
                candidate_options: options.filter((option) => confirmedIds.has(String(option?.product_id || ''))),
                image_url: result.imageUrl
            };
        }
        return map;
    }, {});
}

async function analyzeIncomingImagesForConversation({
    platform,
    pageId,
    senderId,
    imageUrls = [],
    pageConfig = {},
    prompt = '',
    batchId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
} = {}) {
    const imageJobs = (imageUrls || []).filter(Boolean).map((url, idx) => ({
        url,
        imageIndex: idx + 1
    }));

    const results = await Promise.all(imageJobs.map((job) =>
        analyzeAndMatchIncomingImage({
            platform,
            pageId,
            senderId,
            imageUrl: job.url,
            imageIndex: job.imageIndex,
            batchId,
            pageConfig,
            prompt
        }).catch((error) => ({
            imageIndex: job.imageIndex,
            imageUrl: job.url,
            analysisText: `[Vision Analysis Failed] ${error.message}`,
            matchedProducts: [],
            topMatch: null,
            matchDecision: { status: 'NO_MATCH', confidence: 'low', reason: error.message, options: [] },
            usage: 0,
            model: 'vision-error'
        }))
    ));

    const aggregateResult = await analyzeIncomingImageBatch({
        results,
        pageConfig
    });

    return {
        batchId,
        results,
        aggregateResult,
        combinedImageAnalysis: composeImageAnalysisBlocks(results, aggregateResult),
        lastImageMap: buildLastImageMapWithAggregate(results, aggregateResult),
        totalUsage: results.reduce((sum, result) => sum + Number(result?.usage || 0), 0) + Number(aggregateResult?.usage || 0),
        mode: resolveImageMatchingMode(pageConfig)
    };
}

module.exports = {
    clampMatchScore,
    resolveIncomingImagePrompt,
    resolveImageMatchingMode,
    analyzeAndMatchIncomingImage,
    analyzeIncomingImagesForConversation,
    analyzeIncomingImageBatch,
    formatImageAnalysisBlock,
    formatBatchImageAnalysisBlock,
    composeImageAnalysisBlocks,
    buildLastImageMap
};
