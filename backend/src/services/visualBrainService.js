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
    return {
        product_id: candidate.product_id || String(candidate.id || ''),
        name: candidate.name || null,
        price: candidate.price || null,
        match_score: Number(candidate.match_score || 0),
        base_match_score: Number(candidate.base_match_score ?? candidate.match_score ?? 0),
        match_source: candidate.match_source || null,
        visual_fingerprint: safeJsonParse(candidate.visual_fingerprint, candidate.visual_fingerprint || {}),
        visual_tags: candidate.visual_tags || [],
        searchable_text: String(candidate.searchable_text || '').slice(0, 1200),
        description: String(candidate.description || '').slice(0, 800),
        keywords: String(candidate.keywords || '').slice(0, 500)
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
    return { status: 'EXACT_MATCH', confidence: topScore >= 90 ? 'high' : 'medium', reason: 'fallback_strong_vector_score', score_gap: gap, options };
}

async function judgeVisualMatch({ analysisText, candidates, apiKey, baseURL, model, timeoutMs = 25000 }) {
    const compactCandidates = (candidates || []).slice(0, 5).map(compactCandidate);
    const resolvedApiKey = apiKey || process.env.VISUAL_BRAIN_API_KEY;
    const resolvedBaseURL = baseURL || process.env.VISUAL_BRAIN_BASE_URL;
    const resolvedModel = model || process.env.VISUAL_BRAIN_MODEL;
    if (!analysisText || compactCandidates.length === 0) return fallbackDecision(compactCandidates);
    if (!resolvedApiKey || !resolvedBaseURL || !resolvedModel) return fallbackDecision(compactCandidates);

    const client = new OpenAI({ apiKey: resolvedApiKey, baseURL: String(resolvedBaseURL).replace(/\/+$/, '') });
    const prompt = `You are a generic e-commerce visual matching judge for any product type.
Do not use hardcoded categories, fixed keyword rules, product IDs, or brand assumptions.
Compare the customer image analysis against candidates by visible product type, color, shape/silhouette, pattern placement, material impression, and distinctive details.
Use vector/search scores only as supporting signals.
Be conservative: EXACT_MATCH only when the same sellable visible item is strongly supported. If visually related but not exact, use SIMILAR_ALTERNATIVE. If multiple candidates are equally plausible, use AMBIGUOUS_MATCH. If candidates are visibly different, use NO_MATCH.
Return only compact valid JSON. No markdown, no code fences, no extra text.
Schema: {"status":"EXACT_MATCH|SIMILAR_ALTERNATIVE|AMBIGUOUS_MATCH|NO_MATCH","confidence":"high|medium|low","selected_product_id":string|null,"reason":string,"score_gap_note":string,"options":[{"product_id":string,"visual_judgment":"exact|similar|different|uncertain","confidence":"high|medium|low","match_score":number,"key_matches":string[],"key_mismatches":string[]}]}`;

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
        if (!parsed || !parsed.status) return { ...fallbackDecision(compactCandidates), reason: 'visual_brain_invalid_json' };
        const allowed = new Set(['EXACT_MATCH', 'SIMILAR_ALTERNATIVE', 'AMBIGUOUS_MATCH', 'NO_MATCH']);
        const status = allowed.has(parsed.status) ? parsed.status : 'NO_MATCH';
        const selectedId = parsed.selected_product_id ? String(parsed.selected_product_id) : null;
        const options = Array.isArray(parsed.options) ? parsed.options.slice(0, 5) : [];
        return {
            status,
            confidence: parsed.confidence || (status === 'EXACT_MATCH' ? 'medium' : 'low'),
            selected_product_id: selectedId,
            reason: parsed.reason || 'visual_brain_decision',
            score_gap_note: parsed.score_gap_note || null,
            options,
            token_usage: completion.usage?.total_tokens || 0,
            model: completion.model || model || 'visual-brain'
        };
    } catch (error) {
        return { ...fallbackDecision(compactCandidates), reason: `visual_brain_error:${error.message}` };
    }
}

module.exports = {
    judgeVisualMatch,
    fallbackDecision
};
