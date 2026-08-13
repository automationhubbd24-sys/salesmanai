#!/usr/bin/env node
'use strict';

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function applyEnv(args) {
  const setIf = (name, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      process.env[name] = String(value).trim();
    }
  };

  setIf('DATABASE_URL', args['database-url']);

  setIf('VISION_BASE_URL_OPENAI', args['vision-base-url']);
  setIf('VISION_API_KEY_OPENAI', args['vision-api-key']);
  setIf('VISION_MODEL_OPENAI', args['vision-model']);
  setIf('VISUAL_BRAIN_BASE_URL', args['vision-base-url']);
  setIf('VISUAL_BRAIN_API_KEY', args['vision-api-key']);
  setIf('VISUAL_BRAIN_MODEL', args['vision-model']);

  setIf('IMAGE_EMBEDDING_ENABLED', args['image-embedding-enabled'] || 'true');
  setIf('IMAGE_EMBEDDING_PROVIDER', args['image-embedding-provider'] || 'openrouter');
  setIf('IMAGE_EMBEDDING_BASE_URL', args['image-embedding-base-url'] || 'https://openrouter.ai/api/v1');
  setIf('IMAGE_EMBEDDING_API_KEY', args['image-embedding-api-key'] || args['openrouter-api-key']);
  setIf('GEMINI_EMBEDDING_API_KEY', args['gemini-api-key']);
  setIf('IMAGE_EMBEDDING_MODEL', args['image-embedding-model'] || 'google/gemini-embedding-2-preview');
  setIf('IMAGE_EMBEDDING_DIMENSION', args['image-embedding-dimension'] || '3072');

  setIf('EMBEDDING_PROVIDER', args['text-embedding-provider'] || 'openrouter');
  setIf('EMBEDDING_MODEL', args['text-embedding-model'] || 'qwen/qwen3-embedding-8b');
  setIf('EMBEDDING_BASE_URL', args['text-embedding-base-url'] || 'https://openrouter.ai/api/v1');
  setIf('EMBEDDING_API_KEY', args['text-embedding-api-key'] || args['openrouter-api-key']);
  setIf('OPENROUTER_API_KEY', args['openrouter-api-key'] || args['text-embedding-api-key']);

  setIf('VISION_IMAGE_DATA_CACHE_MAX', args['vision-image-cache-max'] || '300');
  setIf('VISION_IMAGE_DATA_CACHE_TTL_MS', args['vision-image-cache-ttl-ms'] || String(6 * 3600 * 1000));
  setIf('VISION_IMAGE_DATA_CACHE_MAX_BYTES', args['vision-image-cache-max-bytes'] || String(4 * 1024 * 1024));
  setIf('LOCAL_IMAGE_EMBEDDING_CACHE_ENABLED', args['local-image-cache'] === undefined ? 'false' : args['local-image-cache']);
  setIf('LOCAL_TEXT_EMBEDDING_CACHE_PROBE_ENABLED', args['local-text-cache-probe'] === undefined ? 'false' : args['local-text-cache-probe']);

  setIf('DEFAULT_IMAGE_MATCHING_MODE', args['image-matching-mode'] || 'ab_independent');
}

function collectImageUrls(args) {
  return String(args['image-url'] || args['image-urls'] || '')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('http'));
}

function mask(value) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= 12) return '***';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function extractJson(text) {
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

const openRouterImageEmbeddingCache = new Map();
const openRouterImageEmbeddingStats = { calls: 0, api_calls: 0, cache_hits: 0, failures: 0 };

async function imageUrlToDataUrl(imageUrl) {
  if (String(imageUrl || '').startsWith('data:')) return imageUrl;
  const response = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`image_download_failed status=${response.status}`);
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  return `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

function normalizeEmbeddingVector(vector, dimension) {
  if (!Array.isArray(vector)) return null;
  const clean = vector.map(Number).filter(Number.isFinite);
  if (clean.length === Number(dimension || 3072)) return clean;
  return clean.length > 0 ? clean : null;
}

async function getOpenRouterImageEmbedding(imageUrl, options = {}) {
  openRouterImageEmbeddingStats.calls += 1;
  const provider = String(process.env.IMAGE_EMBEDDING_PROVIDER || '').toLowerCase();
  if (provider !== 'openrouter') throw new Error(`unsupported_image_embedding_provider:${provider}`);

  const apiKey = process.env.IMAGE_EMBEDDING_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('missing_openrouter_image_embedding_api_key');

  const model = process.env.IMAGE_EMBEDDING_MODEL || 'google/gemini-embedding-2-preview';
  const baseURL = String(process.env.IMAGE_EMBEDDING_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const dimension = Number(process.env.IMAGE_EMBEDDING_DIMENSION || 3072);
  const cacheKey = `${baseURL}:${model}:${imageUrl}`;

  const localCacheEnabled = process.env.LOCAL_IMAGE_EMBEDDING_CACHE_ENABLED !== 'false' && process.env.LOCAL_IMAGE_EMBEDDING_CACHE_ENABLED !== '0';
  if (localCacheEnabled && options.cache === true && openRouterImageEmbeddingCache.has(cacheKey)) {
    openRouterImageEmbeddingStats.cache_hits += 1;
    return openRouterImageEmbeddingCache.get(cacheKey);
  }

  const dataUrl = await imageUrlToDataUrl(imageUrl);
  const bodies = [
    {
      model,
      input: [{ type: 'image_url', image_url: { url: dataUrl } }],
      encoding_format: 'float'
    },
    {
      model,
      input: [{ type: 'input_image', image_url: dataUrl }],
      encoding_format: 'float'
    },
    {
      model,
      input: dataUrl,
      encoding_format: 'float'
    }
  ];

  let lastError = null;
  for (const body of bodies) {
    try {
      openRouterImageEmbeddingStats.api_calls += 1;
      const response = await fetch(`${baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      if (!response.ok) throw new Error(json?.error?.message || text);
      const vector = normalizeEmbeddingVector(json?.data?.[0]?.embedding || json?.embedding?.values || json?.embeddings?.[0]?.values, dimension);
      if (!vector) throw new Error('openrouter_image_embedding_empty_vector');
      if (localCacheEnabled && options.cache === true) openRouterImageEmbeddingCache.set(cacheKey, vector);
      return vector;
    } catch (error) {
      lastError = error;
    }
  }

  openRouterImageEmbeddingStats.failures += 1;
  throw lastError || new Error('openrouter_image_embedding_failed');
}

async function maybeReadDbCache({ dbService, platform, pageId, senderId, imageUrl }) {
  const crypto = require('crypto');
  let imageHash = null;

  try {
    const response = await fetch(imageUrl);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      imageHash = crypto.createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
    }
  } catch {
    imageHash = crypto.createHash('sha256').update(String(imageUrl)).digest('hex');
  }

  return dbService.getIncomingImageAnalysis({ platform, pageId, senderId, imageUrl, imageHash });
}

async function runOpenRouterPromptCacheProbe(args, imageUrls) {
  const enabled = args['openrouter-cache-probe'] === true || args['openrouter-cache-probe'] === 'true';
  if (!enabled) return { skipped: true, reason: 'openrouter_cache_probe_disabled' };

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.EMBEDDING_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'missing_openrouter_api_key' };

  const model = args['openrouter-cache-model'] || 'google/gemini-2.5-flash';
  const repeat = Math.max(2, Number(args['openrouter-cache-repeat'] || 2));
  const baseURL = String(args['openrouter-cache-base-url'] || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const stableText = (`SalesmanAI cache probe for page ${args['page-id'] || ''}. ` +
    'This repeated block is intentionally long so provider-side prompt caching can activate. '.repeat(900));
  const imageUrl = imageUrls[0];
  const results = [];

  for (let i = 1; i <= repeat; i += 1) {
    const startedAt = Date.now();
    const content = [
      {
        type: 'text',
        text: stableText,
        cache_control: { type: 'ephemeral' }
      },
      {
        type: 'text',
        text: 'Return JSON only: {"ok":true,"seen":"cache_probe"}'
      }
    ];

    if (imageUrl && args['openrouter-cache-include-image'] === 'true') {
      content.push({ type: 'image_url', image_url: { url: imageUrl } });
    }

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost/salesmanai-cache-test',
        'X-Title': 'SalesmanAI Cache Test'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        temperature: 0,
        max_tokens: 80,
        provider: {
          order: ['Google AI Studio'],
          allow_fallbacks: true
        }
      })
    });

    const raw = await response.text();
    let json = null;
    try { json = JSON.parse(raw); } catch {}
    results.push({
      run: i,
      ok: response.ok,
      elapsed_ms: Date.now() - startedAt,
      status: response.status,
      model: json?.model || model,
      usage: json?.usage || null,
      cache_discount: json?.usage?.cache_discount || null,
      cache_tokens: json?.usage?.cache_tokens || json?.usage?.cached_tokens || json?.usage?.prompt_tokens_details?.cached_tokens || null,
      error: response.ok ? null : (json?.error?.message || raw.slice(0, 500)),
      output: String(json?.choices?.[0]?.message?.content || '').slice(0, 300)
    });
  }

  return {
    skipped: false,
    note: 'Eta OpenRouter provider-side prompt caching probe. Dashboard cache hit rate ei requests theke update hote pare, local backend cache na.',
    model,
    repeat,
    include_image: args['openrouter-cache-include-image'] === 'true',
    results
  };
}

function summarizeAnalyzed(analyzed) {
  return {
    batch_id: analyzed.batchId,
    mode: analyzed.mode,
    total_usage: analyzed.totalUsage,
    aggregate_parsed: analyzed.aggregateResult?.parsed || extractJson(analyzed.aggregateResult?.raw),
    last_image_map: analyzed.lastImageMap,
    per_image: (analyzed.results || []).map((result) => ({
      image_index: result.imageIndex,
      model: result.model,
      usage: result.usage,
      from_cache: result.fromCache === true,
      match_decision: result.matchDecision?.status || null,
      top_match: result.topMatch ? {
        product_id: result.topMatch.product_id,
        name: result.topMatch.name || result.topMatch.product_name || null,
        score: result.topMatch.direct_image_score ?? result.topMatch.match_score ?? null
      } : null,
      candidates: (result.matchedProducts || []).slice(0, 5).map((product) => ({
        product_id: product.product_id,
        name: product.name || product.product_name || null,
        score: product.direct_image_score ?? product.match_score ?? null,
        source: product.match_source || null
      })),
      vision_reasoning_parsed: extractJson(result.matchDecision?.vision_reasoning_text || result.analysisText)
    }))
  };
}

async function main() {
  const args = parseArgs(process.argv);
  applyEnv(args);

  const imageUrls = collectImageUrls(args);
  const pageId = String(args['page-id'] || '').trim();
  const pageName = String(args['page-name'] || 'Sales Ai').trim();
  const senderId = String(args['sender-id'] || 'backend-cache-test-user').trim();
  const platform = String(args.platform || 'messenger').trim().toLowerCase();
  const repeat = Math.max(1, Number(args.repeat || 2));
  const useDbAnalysisCache = args['analysis-cache'] === true || args['analysis-cache'] === 'true';

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing. Use --database-url or env.');
  if (!pageId) throw new Error('--page-id missing.');
  if (imageUrls.length === 0) throw new Error('--image-url missing.');

  const incomingImageAnalysisService = require('../src/services/incomingImageAnalysisService');
  const aiService = require('../src/services/aiService');
  const dbService = require('../src/services/dbService');

  aiService.getDirectImageEmbedding = getOpenRouterImageEmbedding;

  const pageConfig = {
    page_id: pageId,
    page_name: pageName,
    ai_provider: 'custom',
    ai: 'custom',
    cheap_engine: false,
    custom_base_url: process.env.VISION_BASE_URL_OPENAI || process.env.VISUAL_BRAIN_BASE_URL,
    vision_api_key: process.env.VISION_API_KEY_OPENAI || process.env.VISUAL_BRAIN_API_KEY,
    api_key: process.env.VISION_API_KEY_OPENAI || process.env.VISUAL_BRAIN_API_KEY,
    vision_model: process.env.VISION_MODEL_OPENAI || process.env.VISUAL_BRAIN_MODEL || 'gemini-3.6-flash',
    chat_model: process.env.VISION_MODEL_OPENAI || process.env.VISUAL_BRAIN_MODEL || 'gemini-3.6-flash',
    chatmodel: process.env.VISION_MODEL_OPENAI || process.env.VISUAL_BRAIN_MODEL || 'gemini-3.6-flash',
    image_matching_mode: process.env.DEFAULT_IMAGE_MATCHING_MODE || 'ab_independent'
  };

  const prompt = args.prompt || 'Analyze this image with 100% precision for ecommerce product matching. Focus on product, OCR, color, design, and visual details. Return concise useful evidence.';
  const runs = [];

  for (let index = 1; index <= repeat; index += 1) {
    const startedAt = Date.now();
    let dbCacheHits = [];
    let analyzed = null;

    if (useDbAnalysisCache) {
      dbCacheHits = await Promise.all(imageUrls.map((imageUrl) => maybeReadDbCache({ dbService, platform, pageId, senderId, imageUrl })));
    }

    const allDbCached = useDbAnalysisCache && dbCacheHits.length === imageUrls.length && dbCacheHits.every((item) => item?.analysis_text);

    if (allDbCached) {
      analyzed = {
        batchId: `manual_db_cache_${Date.now()}`,
        mode: pageConfig.image_matching_mode,
        aggregateResult: null,
        lastImageMap: {},
        totalUsage: 0,
        results: dbCacheHits.map((cached, idx) => {
          const matchedProducts = Array.isArray(cached.matched_products) ? cached.matched_products : [];
          return {
            imageIndex: idx + 1,
            imageUrl: cached.image_url,
            analysisText: cached.analysis_text,
            matchedProducts,
            topMatch: matchedProducts[0] || null,
            matchDecision: { status: 'DB_CACHE_HIT', confidence: 'cached', reason: 'manual_script_analysis_cache', options: matchedProducts },
            usage: 0,
            model: 'manual-db-analysis-cache',
            fromCache: true
          };
        }),
        combinedImageAnalysis: dbCacheHits.map((cached, idx) => `[IMAGE ${idx + 1} DB CACHE]\n${cached.analysis_text}`).join('\n\n')
      };
    } else {
      analyzed = await incomingImageAnalysisService.analyzeIncomingImagesForConversation({
        platform,
        pageId,
        senderId,
        imageUrls,
        pageConfig,
        prompt,
        batchId: `${platform}_backend_cache_test_${index}_${Date.now()}`
      });
    }

    let textEmbeddingCacheProbe = { skipped: true, reason: 'local_text_cache_probe_disabled' };
    if ((process.env.LOCAL_TEXT_EMBEDDING_CACHE_PROBE_ENABLED === 'true' || process.env.LOCAL_TEXT_EMBEDDING_CACHE_PROBE_ENABLED === '1') && (process.env.EMBEDDING_API_KEY || process.env.OPENROUTER_API_KEY)) {
      const textCacheProbe = await aiService.getEmbedding(`image-test-cache-probe:${pageId}:${imageUrls.join('|')}`);
      const textCacheProbeAgain = await aiService.getEmbedding(`image-test-cache-probe:${pageId}:${imageUrls.join('|')}`);
      textEmbeddingCacheProbe = {
        skipped: false,
        first_vector_length: Array.isArray(textCacheProbe) ? textCacheProbe.length : null,
        second_vector_length: Array.isArray(textCacheProbeAgain) ? textCacheProbeAgain.length : null,
        same_process_cache_expected_on_second_call: true
      };
    }

    runs.push({
      run: index,
      elapsed_ms: Date.now() - startedAt,
      analysis_cache_requested: useDbAnalysisCache,
      analysis_cache_hit: allDbCached,
      text_embedding_cache_probe: textEmbeddingCacheProbe,
      image_embedding_cache_stats: { ...openRouterImageEmbeddingStats },
      analyzed: summarizeAnalyzed(analyzed)
    });
  }

  const openrouterPromptCacheProbe = await runOpenRouterPromptCacheProbe(args, imageUrls);

  console.log(JSON.stringify({
    ok: true,
    config: {
      platform,
      page_id: pageId,
      page_name: pageName,
      sender_id: senderId,
      image_count: imageUrls.length,
      repeat,
      vision_base_url: process.env.VISION_BASE_URL_OPENAI || process.env.VISUAL_BRAIN_BASE_URL,
      vision_model: pageConfig.vision_model,
      vision_api_key: mask(process.env.VISION_API_KEY_OPENAI || process.env.VISUAL_BRAIN_API_KEY),
      image_embedding_enabled: process.env.IMAGE_EMBEDDING_ENABLED,
      image_embedding_provider: process.env.IMAGE_EMBEDDING_PROVIDER,
      image_embedding_base_url: process.env.IMAGE_EMBEDDING_BASE_URL,
      image_embedding_model: process.env.IMAGE_EMBEDDING_MODEL,
      image_embedding_api_key: mask(process.env.IMAGE_EMBEDDING_API_KEY || process.env.GEMINI_EMBEDDING_API_KEY),
      local_image_embedding_cache_enabled: process.env.LOCAL_IMAGE_EMBEDDING_CACHE_ENABLED,
      local_text_embedding_cache_probe_enabled: process.env.LOCAL_TEXT_EMBEDDING_CACHE_PROBE_ENABLED,
      text_embedding_provider: process.env.EMBEDDING_PROVIDER,
      text_embedding_model: process.env.EMBEDDING_MODEL,
      text_embedding_base_url: process.env.EMBEDDING_BASE_URL,
      text_embedding_api_key: mask(process.env.EMBEDDING_API_KEY || process.env.OPENROUTER_API_KEY),
      analysis_cache_note: 'backend service er built-in incoming image cache hardcoded off; --analysis-cache true dile ei script DB cache manually check kore.'
    },
    image_urls: imageUrls,
    openrouter_prompt_cache_probe: openrouterPromptCacheProbe,
    runs
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
