#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Client } = require('pg');

function parseArgs(argv) {
  const args = {};
  const setArg = (key, value) => {
    if (args[key] === undefined) {
      args[key] = value;
    } else if (Array.isArray(args[key])) {
      args[key].push(value);
    } else {
      args[key] = [args[key], value];
    }
  };

  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      setArg(key, true);
    } else {
      setArg(key, next);
      i += 1;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
A/B Image Embedding + Vision Reasoning Test

Architecture:
  user image -> direct image embedding -> top 5 candidate products -> one vision LLM call with user image + candidate product images

Required:
  --image-url <url>             User/customer image URL. Repeat for multiple images.
  --image-urls <url1,url2>      Optional comma/newline separated URLs.
  --page-id <id>                Messenger page id / resource id

DB / Embedding:
  --database-url <postgres-url> Optional, or DATABASE_URL env
  --embedding-api-key <key>     Optional, or IMAGE_EMBEDDING_API_KEY/GEMINI_EMBEDDING_API_KEY/GEMINI_API_KEY env
  --embedding-model <model>     Default: gemini-embedding-2-preview
  --embedding-dimension <n>     Default: 3072

Vision LLM:
  --vision-base-url <url>       Optional, or VISION_BASE_URL/OPENAI_BASE_URL env
  --vision-api-key <key>        Optional, or VISION_API_KEY/OPENAI_API_KEY env
  --vision-model <model>        Optional, or VISION_MODEL env, default: gemini-3.5-flash

Options:
  --top-k <n>                   Default: 5
  --candidate-images <n>        Candidate images sent to vision, default: 3
  --architecture independent    Multi-image: each image runs embedding->top5->vision independently, then final LLM aggregates.
  --per-image-max-tokens <n>    Default: 2200
  --final-max-tokens <n>        Default: 1600
  --json                        Output only JSON
  --help                        Show help

Example:
  node scripts/ab_image_embedding_vision_test.js --page-id 658762267328000 --image-url "https://...jpg" --vision-base-url https://gemini.salesmanchatbot.online/v1 --vision-api-key sk-... --vision-model gemini-3.5-flash
`);
}

function normalizeGeminiEmbeddingModel(model) {
  const raw = String(model || 'gemini-embedding-2-preview').replace(/^google\//i, '').replace(/^models\//i, '');
  return `models/${raw}`;
}

async function withTimer(label, fn, timings) {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    timings[label] = Date.now() - start;
  }
}

async function urlToInlineData(imageUrl) {
  if (String(imageUrl || '').startsWith('data:')) {
    const [meta, data] = String(imageUrl).split(',', 2);
    const mimeType = meta.match(/^data:([^;]+)/)?.[1] || 'image/jpeg';
    return { mimeType, data };
  }
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`image_download_failed status=${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  return { mimeType, data: Buffer.from(arrayBuffer).toString('base64') };
}

async function getDirectImageEmbedding(imageUrl, config) {
  if (!config.apiKey) throw new Error('missing_embedding_api_key');
  const model = normalizeGeminiEmbeddingModel(config.model);
  const inlineData = await urlToInlineData(imageUrl);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      content: { parts: [{ inlineData }] },
      outputDimensionality: config.dimension
    })
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(json?.error?.message || text);
  const vector = json?.embedding?.values || json?.embeddings?.[0]?.values || null;
  if (!Array.isArray(vector)) throw new Error('no_embedding_vector_returned');
  return vector;
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeUrl(value) {
  const url = String(value || '').trim().replace(/^`+|`+$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
  return url.startsWith('http') ? url : null;
}

function collectProductImages(product, limit) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    const clean = normalizeUrl(url);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  };
  push(product.matched_image_url);
  push(product.image_url);
  parseMaybeJson(product.additional_images, []).forEach(push);
  parseMaybeJson(product.variants, []).forEach(v => push(v?.image_url));
  parseMaybeJson(product.sku_matrix, []).forEach(s => push(s?.image_url));
  return urls.slice(0, limit);
}

function collectUserImageUrls(args) {
  const values = [];
  const add = (value) => {
    if (Array.isArray(value)) return value.forEach(add);
    String(value || '')
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => values.push(item));
  };
  add(args['image-url']);
  add(args['image-urls']);
  return Array.from(new Set(values.map(normalizeUrl).filter(Boolean)));
}

function mergeCandidateLists(perImageCandidates, topK) {
  const byId = new Map();
  perImageCandidates.forEach((entry, imageIdx) => {
    entry.candidates.forEach(candidate => {
      const id = String(candidate.id);
      const existing = byId.get(id);
      const score = Number(candidate.score || 0);
      if (!existing) {
        byId.set(id, {
          ...candidate,
          best_score: score,
          score_sum: score,
          appear_count: 1,
          source_image_indexes: [imageIdx + 1],
          per_image_scores: [{ image_index: imageIdx + 1, score, distance: Number(candidate.distance) }]
        });
      } else {
        existing.best_score = Math.max(existing.best_score, score);
        existing.score_sum += score;
        existing.appear_count += 1;
        existing.source_image_indexes.push(imageIdx + 1);
        existing.per_image_scores.push({ image_index: imageIdx + 1, score, distance: Number(candidate.distance) });
        if (score > Number(existing.score || 0)) {
          Object.assign(existing, candidate);
        }
      }
    });
  });

  return Array.from(byId.values())
    .map(candidate => ({
      ...candidate,
      merged_score: Number((candidate.best_score + Math.min(8, (candidate.appear_count - 1) * 2.5)).toFixed(2))
    }))
    .sort((a, b) => Number(b.merged_score || 0) - Number(a.merged_score || 0))
    .slice(0, topK);
}

async function searchTopCandidates(client, vector, pageId, topK) {
  if (!Array.isArray(vector) || vector.length !== 3072) {
    throw new Error(`embedding_dimension_mismatch got=${Array.isArray(vector) ? vector.length : 'none'} expected=3072`);
  }

  const sql = `
    WITH ranked_matches AS (
      SELECT
        p.id, p.name, p.description, p.image_url, p.additional_images, p.price, p.currency,
        p.variants, p.sku_matrix, p.allowed_messenger_ids, p.allowed_wa_sessions,
        pie.image_role, pie.image_url AS matched_image_url, pie.image_embedding_model,
        (pie.image_embedding_3072 <=> $1::vector) AS distance
      FROM product_image_embeddings pie
      JOIN products p ON p.id = pie.product_id
      WHERE p.is_active = true
        AND pie.image_embedding_3072 IS NOT NULL
        AND (
          p.allowed_messenger_ids::jsonb @> jsonb_build_array($2::text)
          OR p.allowed_wa_sessions::jsonb @> jsonb_build_array($2::text)
          OR pie.page_id = $2::text
        )
    ),
    best_ranked_matches AS (
      SELECT DISTINCT ON (id) *
      FROM ranked_matches
      ORDER BY id, distance ASC
    )
    SELECT *
    FROM best_ranked_matches
    ORDER BY distance ASC
    LIMIT $3
  `;

  const result = await client.query(sql, [JSON.stringify(vector), String(pageId), Number(topK)]);
  return result.rows.map(row => ({
    ...row,
    score: Number(((1 - Number(row.distance)) * 100).toFixed(2))
  }));
}

function buildVisionPrompt(userText, userImageUrls, candidates, candidateImageLimit) {
  const candidateList = candidates.map((p, idx) => {
    const images = collectProductImages(p, candidateImageLimit);
    const score = p.merged_score ?? p.score;
    return `${idx + 1}. product_id=${p.id}, name=${p.name}, price=${p.price || 'N/A'} ${p.currency || 'BDT'}, embedding_score=${score}%, appeared_in_user_images=${(p.source_image_indexes || []).join(',') || '1'}, images=${images.length}`;
  }).join('\n');

  return `You are testing multi-image product visual matching for an ecommerce chatbot.

Task:
1. Analyze ALL USER IMAGES visually. A single user image may contain multiple product photos/collage panels.
2. Compare the visible user products against the TOP CANDIDATE PRODUCT IMAGES provided in this same message.
3. Decide which product or products match best. If multiple user images show different products, return multiple matched products.
4. Return concise reasoning and visual text summary.

Important rules:
- Do not trust candidate order blindly. Use visual comparison.
- If a user image is a collage/post screenshot, identify each visible product/variant if possible.
- If top products are visually too similar, mark ambiguous and list closest options.
- Prefer exact design/shape/color/print match over embedding score.
- Return valid JSON only.

JSON schema:
{
  "status": "match|multi_match|ambiguous|no_match",
  "best_product_id": "string|null",
  "best_product_name": "string|null",
  "confidence": "high|medium|low",
  "reasoning": "short explanation",
  "user_images_visual_text": [
    {"image_index":1, "visual_summary":"summary", "visible_products_count":"number_or_unknown"}
  ],
  "per_image_match": [
    {"image_index":1, "matched_product_id":"string|null", "matched_product_name":"string|null", "confidence":"high|medium|low", "reason":"short"}
  ],
  "candidate_comparison": [
    {"product_id":"string", "name":"string", "visual_match":"short", "score_reason":"short"}
  ]
}

User request/context:
${userText || `User sent ${userImageUrls.length} image(s) and asked which product/price it matches.`}

User image count: ${userImageUrls.length}
Embedding merged top candidates:
${candidateList}`;
}

async function callChatCompletion(config, content, maxTokens = null) {
  if (!config.baseUrl) throw new Error('missing_vision_base_url');
  if (!config.apiKey) throw new Error('missing_vision_api_key');

  const endpoint = `${String(config.baseUrl).replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content }],
      temperature: 0.1,
      max_tokens: Number(maxTokens || config.maxTokens || 3500)
    })
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(json?.error?.message || text);
  return {
    raw: json?.choices?.[0]?.message?.content || '',
    model: json?.model || config.model,
    usage: json?.usage || null
  };
}

async function callVisionReasoner(config, userImageUrls, candidates, candidateImageLimit, userText) {
  if (!config.baseUrl) throw new Error('missing_vision_base_url');
  if (!config.apiKey) throw new Error('missing_vision_api_key');

  const content = [{ type: 'text', text: buildVisionPrompt(userText, userImageUrls, candidates, candidateImageLimit) }];
  userImageUrls.forEach((url, idx) => {
    content.push({ type: 'text', text: `USER IMAGE ${idx + 1}:` });
    content.push({ type: 'image_url', image_url: { url } });
  });

  candidates.forEach((candidate, idx) => {
    const images = collectProductImages(candidate, candidateImageLimit);
    content.push({ type: 'text', text: `CANDIDATE ${idx + 1}: product_id=${candidate.id}, name=${candidate.name}, embedding_score=${candidate.score}%` });
    images.forEach((url, imageIdx) => {
      content.push({ type: 'text', text: `Candidate ${idx + 1} image ${imageIdx + 1}` });
      content.push({ type: 'image_url', image_url: { url } });
    });
  });

  return callChatCompletion(config, content);
}

function buildSingleImagePrompt(imageIndex, userText, candidates, candidateImageLimit) {
  const candidateList = candidates.map((p, idx) => {
    const images = collectProductImages(p, candidateImageLimit);
    return `${idx + 1}. product_id=${p.id}, name=${p.name}, price=${p.price || 'N/A'} ${p.currency || 'BDT'}, embedding_score=${p.score}%, db_distance=${Number(p.distance).toFixed(4)}, images=${images.length}`;
  }).join('\n');

  return `You are testing one image product matching for an ecommerce chatbot.

This is USER IMAGE ${imageIndex} only.
The image may contain one product or multiple products/collage panels.
Compare this user image against only its own top candidate product images.

Rules:
- Identify whether the user image has one product or multiple visible products.
- Match all visible products if they are present in the candidate list.
- Prefer exact design, shape, color, pattern, and structure over embedding score.
- If no candidate matches a visible product, say no_match for that product.
- Return valid JSON only.

JSON schema:
{
  "image_index": ${imageIndex},
  "status": "match|multi_match|ambiguous|no_match",
  "visible_products_count": "number_or_unknown",
  "visual_summary": "short visual description",
  "matched_products": [
    {"product_id":"string", "name":"string", "price":"string|null", "currency":"string", "confidence":"high|medium|low", "reason":"short"}
  ],
  "unmatched_visible_products": [
    {"description":"short", "reason":"short"}
  ],
  "candidate_comparison": [
    {"product_id":"string", "name":"string", "visual_match":"exact|partial|no_match", "reason":"short"}
  ]
}

User request/context:
${userText || 'User sent image(s) and asked which product/price it matches.'}

Top candidates for this image:
${candidateList}`;
}

async function runIndependentImagePipeline({ imageUrl, imageIndex, client, pageId, topK, candidateImageLimit, embeddingConfig, visionConfig, userText }) {
  const timings = {};
  const queryVector = await withTimer('image_embedding_ms', () => getDirectImageEmbedding(imageUrl, embeddingConfig), timings);
  const candidates = await withTimer('vector_search_ms', () => searchTopCandidates(client, queryVector, pageId, topK), timings);

  const content = [{ type: 'text', text: buildSingleImagePrompt(imageIndex, userText, candidates, candidateImageLimit) }];
  content.push({ type: 'text', text: `USER IMAGE ${imageIndex}:` });
  content.push({ type: 'image_url', image_url: { url: imageUrl } });
  candidates.forEach((candidate, idx) => {
    const images = collectProductImages(candidate, candidateImageLimit);
    content.push({ type: 'text', text: `IMAGE ${imageIndex} CANDIDATE ${idx + 1}: product_id=${candidate.id}, name=${candidate.name}, embedding_score=${candidate.score}%` });
    images.forEach((url, imageIdx) => {
      content.push({ type: 'text', text: `Image ${imageIndex} candidate ${idx + 1} product image ${imageIdx + 1}` });
      content.push({ type: 'image_url', image_url: { url } });
    });
  });

  const vision = await withTimer('vision_reasoning_ms', () => callChatCompletion(visionConfig, content, visionConfig.perImageMaxTokens || 2200), timings);
  return {
    image_index: imageIndex,
    image_url: imageUrl,
    query_vector_length: queryVector.length,
    timings,
    top_candidates: candidates.map(p => ({
      product_id: String(p.id),
      name: p.name,
      price: p.price,
      currency: p.currency || 'BDT',
      embedding_score: p.score,
      distance: Number(Number(p.distance).toFixed(6)),
      matched_image_url: p.matched_image_url,
      product_images_sent: collectProductImages(p, candidateImageLimit)
    })),
    vision_result_raw: vision.raw,
    usage: vision.usage
  };
}

function buildFinalAggregatePrompt(userText, perImageResults) {
  const blocks = perImageResults.map(result => `IMAGE ${result.image_index} RESULT:\n${result.vision_result_raw}`).join('\n\n');
  return `You are the final ecommerce chatbot response generator.

The previous step independently analyzed each user image with its own top 5 candidate products.
Now combine those per-image results into one clean user-facing answer.

Rules:
- If multiple products matched, list each product with price.
- If one image contained multiple products, include all matched products.
- If any image had no exact match, mention that politely.
- Keep answer concise and practical.
- Return valid JSON only.

JSON schema:
{
  "final_status":"match|multi_match|partial_match|no_match",
  "customer_answer":"short answer in Bangla/Banglish",
  "matched_products":[
    {"source_image_index":1, "product_id":"string", "name":"string", "price":"string|null", "currency":"string", "confidence":"high|medium|low"}
  ],
  "needs_clarification": false,
  "clarification_question": "string|null"
}

User request/context:
${userText || 'User sent image(s) and asked product/price.'}

Per-image analysis results:
${blocks}`;
}

async function runIndependentMultiImageArchitecture({ userImageUrls, client, pageId, topK, candidateImageLimit, embeddingConfig, visionConfig, userText }) {
  const timings = {};
  const perImageResults = await withTimer('parallel_independent_image_pipelines_ms', () => Promise.all(
    userImageUrls.map((imageUrl, idx) => runIndependentImagePipeline({
      imageUrl,
      imageIndex: idx + 1,
      client,
      pageId,
      topK,
      candidateImageLimit,
      embeddingConfig,
      visionConfig,
      userText
    }))
  ), timings);

  const finalContent = [{ type: 'text', text: buildFinalAggregatePrompt(userText, perImageResults) }];
  const final = await withTimer('final_main_llm_ms', () => callChatCompletion(visionConfig, finalContent, visionConfig.finalMaxTokens || 1600), timings);
  return { timings, perImageResults, final };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const userImageUrls = collectUserImageUrls(args);
  const pageId = args['page-id'];
  const topK = Number(args['top-k'] || 5);
  const candidateImageLimit = Number(args['candidate-images'] || 3);
  const timings = {};

  if (userImageUrls.length === 0 || !pageId) {
    printHelp();
    throw new Error('missing_required_args image-url/page-id');
  }

  const databaseUrl = args['database-url'] || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('missing_database_url');

  const embeddingConfig = {
    apiKey: args['embedding-api-key'] || process.env.IMAGE_EMBEDDING_API_KEY || process.env.GEMINI_EMBEDDING_API_KEY || process.env.GEMINI_API_KEY,
    model: args['embedding-model'] || process.env.IMAGE_EMBEDDING_MODEL || 'gemini-embedding-2-preview',
    dimension: Number(args['embedding-dimension'] || process.env.IMAGE_EMBEDDING_DIMENSION || 3072)
  };

  const visionConfig = {
    baseUrl: args['vision-base-url'] || process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL,
    apiKey: args['vision-api-key'] || process.env.VISION_API_KEY || process.env.OPENAI_API_KEY,
    model: args['vision-model'] || process.env.VISION_MODEL || 'gemini-3.5-flash',
    maxTokens: Number(args['max-tokens'] || process.env.VISION_MAX_TOKENS || 3500),
    perImageMaxTokens: Number(args['per-image-max-tokens'] || 2200),
    finalMaxTokens: Number(args['final-max-tokens'] || 1600)
  };

  const client = new Client({ connectionString: databaseUrl });
  await withTimer('db_connect_ms', () => client.connect(), timings);

  try {
    if ((args.architecture || args.mode) === 'independent' && userImageUrls.length > 1) {
      const independent = await runIndependentMultiImageArchitecture({
        userImageUrls,
        client,
        pageId,
        topK,
        candidateImageLimit,
        embeddingConfig,
        visionConfig,
        userText: args.text || ''
      });

      const report = {
        ok: true,
        architecture: 'parallel_independent_per_image: each image -> embedding -> top5 -> vision reasoning, then final main llm aggregate',
        page_id: pageId,
        user_image_urls: userImageUrls,
        embedding_model: embeddingConfig.model,
        vision_model: visionConfig.model,
        timings: independent.timings,
        per_image_results: independent.perImageResults,
        final_main_llm_result_raw: independent.final.raw,
        final_usage: independent.final.usage
      };
      console.log(args.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
      return;
    }

    const queryVectors = await withTimer('image_embedding_parallel_ms', () => Promise.all(
      userImageUrls.map(url => getDirectImageEmbedding(url, embeddingConfig))
    ), timings);

    const perImageCandidates = await withTimer('vector_search_parallel_ms', async () => {
      const lists = await Promise.all(queryVectors.map(vector => searchTopCandidates(client, vector, pageId, topK)));
      return lists.map((candidates, idx) => ({
        image_index: idx + 1,
        image_url: userImageUrls[idx],
        query_vector_length: queryVectors[idx].length,
        candidates
      }));
    }, timings);

    const candidates = mergeCandidateLists(perImageCandidates, topK);

    if (candidates.length === 0) {
      const out = {
        ok: false,
        reason: 'no_candidates_found',
        page_id: pageId,
        user_image_urls: userImageUrls,
        query_vector_lengths: queryVectors.map(v => v.length),
        timings
      };
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    const vision = await withTimer('vision_reasoning_ms', () => callVisionReasoner(visionConfig, userImageUrls, candidates, candidateImageLimit, args.text || ''), timings);

    const report = {
      ok: true,
      architecture: 'user_images_parallel_embedding -> per_image_top_5_candidates -> merged_top_5 -> one_vision_llm_call_user_images_plus_candidate_images',
      page_id: pageId,
      user_image_urls: userImageUrls,
      query_vector_lengths: queryVectors.map(v => v.length),
      embedding_model: embeddingConfig.model,
      vision_model: vision.model,
      timings,
      per_image_top_candidates: perImageCandidates.map(entry => ({
        image_index: entry.image_index,
        image_url: entry.image_url,
        candidates: entry.candidates.map(p => ({
          product_id: String(p.id),
          name: p.name,
          price: p.price,
          currency: p.currency || 'BDT',
          embedding_score: p.score,
          distance: Number(Number(p.distance).toFixed(6)),
          matched_image_url: p.matched_image_url
        }))
      })),
      merged_top_candidates: candidates.map(p => ({
        product_id: String(p.id),
        name: p.name,
        price: p.price,
        currency: p.currency || 'BDT',
        best_embedding_score: p.best_score ?? p.score,
        merged_score: p.merged_score ?? p.score,
        appeared_in_user_images: p.source_image_indexes || [],
        per_image_scores: p.per_image_scores || [],
        distance: Number(Number(p.distance).toFixed(6)),
        matched_image_url: p.matched_image_url,
        product_images_sent: collectProductImages(p, candidateImageLimit)
      })),
      final_vision_result_raw: vision.raw,
      usage: vision.usage
    };

    if (args.json) {
      console.log(JSON.stringify(report));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
