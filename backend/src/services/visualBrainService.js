const OpenAI = require('openai');

function safeJsonParse(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

function extractJsonText(text) {
    const cleaned = String(text || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    const directStart = cleaned.indexOf('{');
    const directEnd = cleaned.lastIndexOf('}');
    if (directStart >= 0 && directEnd > directStart) return cleaned.slice(directStart, directEnd + 1);
    return cleaned;
}

function compactCandidate(candidate) {
    const productId = candidate.product_id || String(candidate.id || '');
    return {
        product_id: productId,
        name: candidate.name || null,
        price: candidate.price || null,
        currency: candidate.currency || 'BDT',
        match_score: Number(candidate.match_score || 0),
        base_match_score: Number(candidate.base_match_score ?? candidate.match_score ?? 0),
        direct_image_score: candidate.direct_image_score !== undefined ? Number(candidate.direct_image_score || 0) : null,
        old_vector_score: candidate.old_vector_score !== undefined ? Number(candidate.old_vector_score || 0) : null,
        text_match_score: candidate.text_match_score !== undefined ? Number(candidate.text_match_score || 0) : null,
        match_source: candidate.match_source || null,
        image_url: candidate.image_url || null,
        additional_images_count: Array.isArray(candidate.additional_images) ? candidate.additional_images.length : 0,
        visual_fingerprint: safeJsonParse(candidate.visual_fingerprint, candidate.visual_fingerprint || {}),
        visual_tags: candidate.visual_tags || [],
        searchable_text: String(candidate.searchable_text || '').slice(0, 1600),
        description: String(candidate.description || '').slice(0, 900),
        keywords: String(candidate.keywords || '').slice(0, 600)
    };
}

function fallbackDecision(candidates = []) {
    const top = candidates[0] || null;
    const second = candidates[1] || null;
    if (!top) return { status: 'NO_MATCH', confidence: 'low', reason: 'no_candidate', options: [] };
    const topScore = Number(top.match_score || 0);
    const secondScore = Number(second?.match_score || 0);
    const gap = second ? Number((topScore - secondScore).toFixed(1)) : 100;
    const options = candidates.slice(0, 3).map(candidate => ({
        product_id: candidate.product_id,
        name: candidate.name,
        price: candidate.price,
        match_score: candidate.match_score,
        visual_judgment: 'not_evaluated'
    }));
    if (topScore < 80) return { status: 'NO_MATCH', confidence: 'low', reason: 'fallback_top_score_below_threshold', score_gap: gap, options };
    if (topScore < 85 && second && gap < 10) return { status: 'AMBIGUOUS_MATCH', confidence: 'medium', reason: 'fallback_moderate_close_candidates', score_gap: gap, options };
    if (second && gap < 3) return { status: 'AMBIGUOUS_MATCH', confidence: 'medium', reason: 'fallback_top_candidates_too_close', score_gap: gap, options };
    return { status: 'EXACT_MATCH', confidence: topScore >= 90 ? 'high' : 'medium', reason: 'fallback_strong_vector_score', score_gap: gap, selected_product_id: top.product_id, options };
}

function adjustDecisionWithImageEmbedding(decision, compactCandidates) {
    if (!decision || !Array.isArray(compactCandidates) || compactCandidates.length === 0) return decision;
    const ranked = compactCandidates
        .map(candidate => ({ ...candidate, image_score: Number(candidate.direct_image_score || 0) }))
        .filter(candidate => candidate.image_score > 0)
        .sort((a, b) => b.image_score - a.image_score);
    const top = ranked[0];
    if (!top || top.image_score < 84) return decision;

    const second = ranked[1] || null;
    const gap = second ? Number((top.image_score - second.image_score).toFixed(1)) : 100;
    const options = ranked.slice(0, 5).map(candidate => ({
        product_id: candidate.product_id,
        visual_judgment: candidate.product_id === top.product_id ? 'similar' : 'uncertain',
        confidence: candidate.image_score >= 84 ? 'high' : 'medium',
        match_score: candidate.match_score,
        direct_image_score: candidate.image_score,
        key_matches: ['strong direct image embedding similarity'],
        key_mismatches: [],
        variant_notes: gap <= 3 ? 'close visual variant candidate' : 'lower visual similarity candidate'
    }));

    if (decision.status === 'NO_MATCH') {
        if (second && second.image_score >= 80 && gap <= 3) {
            return {
                ...decision,
                status: 'AMBIGUOUS_MATCH',
                confidence: 'high',
                selected_product_id: null,
                reason: `strong_image_embedding_close_variants: top image score ${top.image_score}% with ${gap}% gap`,
                score_gap_note: `direct_image_gap_${gap}`,
                options
            };
        }
        return {
            ...decision,
            status: 'SIMILAR_ALTERNATIVE',
            confidence: 'medium',
            selected_product_id: null,
            reason: `strong_image_embedding_similar_product: top image score ${top.image_score}%`,
            score_gap_note: `direct_image_gap_${gap}`,
            options
        };
    }

    return decision;
}

function normalizeAgenticDecision(parsed, compactCandidates) {
    if (!parsed || typeof parsed !== 'object') return null;

    const allowed = new Set(['EXACT_MATCH', 'SIMILAR_ALTERNATIVE', 'AMBIGUOUS_MATCH', 'NO_MATCH']);
    const status = allowed.has(parsed.status) ? parsed.status : 'NO_MATCH';
    const selectedId = parsed.selected_product_id ? String(parsed.selected_product_id) : null;
    const candidateIds = new Set(compactCandidates.map(candidate => String(candidate.product_id)));
    const safeSelectedId = selectedId && candidateIds.has(selectedId) ? selectedId : null;

    return {
        status,
        confidence: parsed.confidence || (status === 'EXACT_MATCH' ? 'medium' : 'low'),
        selected_product_id: status === 'EXACT_MATCH' ? safeSelectedId : null,
        reason: parsed.reason || 'agentic_evidence_decision',
        score_gap_note: parsed.score_gap_note || parsed.score_gap || null,
        evidence_strategy: parsed.evidence_strategy || parsed.strategy || null,
        required_evidence: Array.isArray(parsed.required_evidence) ? parsed.required_evidence.slice(0, 8) : [],
        options: Array.isArray(parsed.options) ? parsed.options.slice(0, 5) : []
    };
}

async function judgeVisualMatch({ analysisText, candidates, apiKey, baseURL, model, timeoutMs = 25000 }) {
    const compactCandidates = (candidates || []).slice(0, 5).map(compactCandidate);
    const resolvedApiKey = apiKey || process.env.VISUAL_BRAIN_API_KEY;
    const resolvedBaseURL = baseURL || process.env.VISUAL_BRAIN_BASE_URL;
    const resolvedModel = model || process.env.VISUAL_BRAIN_MODEL;
    if (!analysisText || compactCandidates.length === 0) return adjustDecisionWithImageEmbedding(fallbackDecision(compactCandidates), compactCandidates);
    if (!resolvedApiKey || !resolvedBaseURL || !resolvedModel) return adjustDecisionWithImageEmbedding(fallbackDecision(compactCandidates), compactCandidates);

    const client = new OpenAI({ apiKey: resolvedApiKey, baseURL: String(resolvedBaseURL).replace(/\/+$/, '') });
    const prompt = `You are an agentic ecommerce product matching judge for any product category.
Do not use hardcoded category rules. First infer what evidence matters for this item.
Possible evidence includes visible text/OCR, brand/logo, model/code/barcode, packaging, shape, layout, material, color/tone, size, pattern, variant details, and vector/search score.
Choose the matching strategy dynamically from the evidence:
- text/model/code first for label, medicine, electronics, books, spare parts, cosmetics shade codes, grocery packaging, etc.
- visual structure first for fashion, bags, furniture, shoes, toys, home goods, etc.
- packaging first when package layout/brand/weight dominates.
Use vector/search scores only as supporting evidence, never as the only reason.
Direct image embedding score is important visual evidence: if a candidate has direct_image_score >= 84, treat it as a strong visual-family match and do not return NO_MATCH only because metadata is sparse; return AMBIGUOUS_MATCH when close variants compete, or SIMILAR_ALTERNATIVE when exactness is uncertain.
If two candidates are the same family/design but the exact variant evidence is not decisive, return AMBIGUOUS_MATCH.
If one candidate has slightly lower vector score but stronger required evidence, select that candidate.
Be conservative: EXACT_MATCH only when the same sellable catalog item is strongly supported.
Return only compact valid JSON. No markdown, no code fences, no extra text.
Schema: {"evidence_strategy":"TEXT_IDENTIFIER_FIRST|VISUAL_STRUCTURE_FIRST|PACKAGING_FIRST|CODE_FIRST|HYBRID","required_evidence":["short evidence names"],"status":"EXACT_MATCH|SIMILAR_ALTERNATIVE|AMBIGUOUS_MATCH|NO_MATCH","confidence":"high|medium|low","selected_product_id":string|null,"reason":"short reason","score_gap_note":"short note","options":[{"product_id":string,"visual_judgment":"exact|similar|different|uncertain","confidence":"high|medium|low","match_score":number,"key_matches":["short"],"key_mismatches":["short"],"variant_notes":"short"}]}`;

    const userContent = JSON.stringify({ customer_image_analysis: analysisText, candidates: compactCandidates }, null, 2);
    try {
        const completion = await client.chat.completions.create({
            model: resolvedModel,
            temperature: 0,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: userContent }
            ]
        }, { timeout: timeoutMs });
        const raw = completion.choices?.[0]?.message?.content || '';
        const parsed = safeJsonParse(extractJsonText(raw), null);
        const normalized = normalizeAgenticDecision(parsed, compactCandidates);
        if (!normalized || !normalized.status) return adjustDecisionWithImageEmbedding({ ...fallbackDecision(compactCandidates), reason: 'visual_brain_invalid_json' }, compactCandidates);
        const adjusted = adjustDecisionWithImageEmbedding(normalized, compactCandidates);
        return {
            ...adjusted,
            token_usage: completion.usage?.total_tokens || 0,
            model: completion.model || model || 'visual-brain-agentic'
        };
    } catch (error) {
        return adjustDecisionWithImageEmbedding({ ...fallbackDecision(compactCandidates), reason: `visual_brain_error:${error.message}` }, compactCandidates);
    }
}

module.exports = {
    judgeVisualMatch,
    fallbackDecision
};
