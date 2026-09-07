#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const axios = require('axios');

function parseArgs(argv) {
  const args = {};
  const add = (key, value) => {
    if (args[key] === undefined) args[key] = value;
    else if (Array.isArray(args[key])) args[key].push(value);
    else args[key] = [args[key], value];
  };

  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) add(key, true);
    else {
      add(key, next);
      i += 1;
    }
  }
  return args;
}

function listFromArgs(args) {
  const values = [];
  for (const key of ['image', 'images', 'image-url', 'image-urls']) {
    const value = args[key];
    if (!value) continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      values.push(...String(item).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean));
    }
  }
  return values;
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function toImageUrl(input) {
  if (/^https?:\/\//i.test(input) || input.startsWith('data:')) return input;
  const absolute = path.resolve(process.cwd(), input);
  const data = await fs.promises.readFile(absolute);
  return `data:${mimeFromPath(absolute)};base64,${data.toString('base64')}`;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const images = listFromArgs(args);

  if (args.help || images.length === 0) {
    console.log(`Multi-image product count test\n\nUsage:\n  node scripts/test_multi_image_product_count.js --image "C:\\path\\1.jpg" --image "C:\\path\\2.jpg"\n  node scripts/test_multi_image_product_count.js --images "url1,url2,url3"\n\nOutput:\n  JSON result with total_distinct_products and grouped images.`);
    process.exit(images.length === 0 ? 1 : 0);
  }

  const imageUrls = await Promise.all(images.map(toImageUrl));
  
  const apiKey = args['vision-api-key'] || process.env.VISION_API_KEY_OPENAI || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const model = args['vision-model'] || process.env.VISION_MODEL || 'gemini-2.5-flash';
  let baseURL = args['vision-base-url'] || process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL;

  if (!baseURL) {
      if (model.includes('gemini') || (apiKey && String(apiKey).startsWith('AIza'))) {
          baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai';
      } else {
          baseURL = 'https://openrouter.ai/api/v1';
      }
  }

  if (!apiKey) throw new Error('missing_vision_api_key (please provide via --vision-api-key or .env)');

  const content = [{
    type: 'text',
    text: `You are an ecommerce visual product grouping judge.\nTask: Count how many DISTINCT sellable products are shown across all images.\nImportant rules:\n- Multiple photos/angles/usages of the same product count as 1 product.\n- Same design but different bag type/shape/function counts as different product.\n- Ignore background props, plants, people, furniture, hands, books, walls.\n- Focus on sellable bag/product only.\nReturn valid JSON only with this schema:\n{\n  "total_images": number,\n  "total_distinct_products": number,\n  "products": [\n    {"product_group": 1, "image_numbers": [1,2], "short_name": "short visual name", "reason": "why grouped together"}\n  ],\n  "confidence": "high|medium|low",\n  "notes": "short"\n}`
  }];

  imageUrls.forEach((url, index) => {
    content.push({ type: 'text', text: `IMAGE ${index + 1}:` });
    content.push({ type: 'image_url', image_url: { url } });
  });

  const startedAt = Date.now();
  const res = await axios.post(`${baseURL}/chat/completions`, {
    model: model,
    messages: [{ role: 'user', content }],
    temperature: 0,
    max_tokens: Number(args['max-tokens'] || 900)
  }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: Number(args.timeout || 60000),
    proxy: false
  });

  const text = res.data?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(text);
  console.log(JSON.stringify({
    ok: true,
    model: res.data?.model || model,
    latency_ms: Date.now() - startedAt,
    input_images: images,
    parsed,
    raw: parsed ? undefined : text
  }, null, 2));
}

main().catch((error) => {
  const errMsg = error.response?.data?.error?.message || error.response?.data || error.message;
  console.error(JSON.stringify({ ok: false, error: errMsg }, null, 2));
  process.exit(1);
});
