#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const incomingImageAnalysisService = require('../src/services/incomingImageAnalysisService');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key.slice(2)] = true;
      continue;
    }
    args[key.slice(2)] = next;
    i += 1;
  }
  return args;
}

function toImageList(args) {
  const raw = [args['image-url'], args['image-urls']].filter(Boolean).join(',');
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('http'));
}

function summarizeResult(result = {}) {
  return {
    image_index: result.imageIndex,
    image_url: result.imageUrl,
    match_decision: result.matchDecision?.status || null,
    top_candidates: (result.matchedProducts || []).slice(0, 5).map((product) => ({
      product_id: product.product_id,
      product_name: product.name || product.product_name || null,
      score: product.direct_image_score ?? product.match_score ?? null
    })),
    vision_reasoning: incomingImageAnalysisService.formatImageAnalysisBlock(result)
  };
}

async function runPlatform({ platform, pageId, senderId, imageUrls, pageConfig, prompt }) {
  const analyzed = await incomingImageAnalysisService.analyzeIncomingImagesForConversation({
    platform,
    pageId,
    senderId,
    imageUrls,
    pageConfig,
    prompt,
    batchId: `${platform}_test_${Date.now()}`
  });

  return {
    platform,
    page_id: pageId,
    mode: analyzed.mode,
    total_usage: analyzed.totalUsage,
    aggregate_result_raw: analyzed.aggregateResult?.raw || null,
    last_image_map: analyzed.lastImageMap,
    per_image_results: analyzed.results.map(summarizeResult)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const imageUrls = toImageList(args);
  const pageId = args['page-id'];
  const senderId = args['sender-id'] || 'image-test-user';
  const waSession = args['wa-session'] || pageId;

  if (!pageId || imageUrls.length === 0) {
    throw new Error('missing_required_args --page-id --image-url');
  }

  const pageConfig = {
    page_id: pageId,
    api_key: args['vision-api-key'],
    custom_base_url: args['vision-base-url'],
    vision_model: args['vision-model'] || 'gemini-3.5-flash',
    ai_provider: args['vision-provider'] || 'custom',
    image_matching_mode: args['image-mode'] || 'ab_independent'
  };

  const prompt = args.prompt || 'Analyze this image with extreme precision for ecommerce product matching.';
  const output = [];

  const platform = String(args.platform || 'all').toLowerCase();
  if (platform === 'all' || platform === 'messenger') {
    output.push(await runPlatform({
      platform: 'messenger',
      pageId,
      senderId,
      imageUrls,
      pageConfig,
      prompt
    }));
  }
  if (platform === 'all' || platform === 'whatsapp') {
    output.push(await runPlatform({
      platform: 'whatsapp',
      pageId: waSession,
      senderId,
      imageUrls,
      pageConfig: { ...pageConfig, page_id: waSession },
      prompt
    }));
  }

  console.log(JSON.stringify({
    ok: true,
    image_urls: imageUrls,
    result_count: output.length,
    results: output
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
