# Facebook/WhatsApp Chatbot Improvement Plan

## Summary

এই প্ল্যানের লক্ষ্য হলো Salesman AI Chatbot-কে e-commerce use-case-এর জন্য আরও দ্রুত, নির্ভুল এবং সাজানো করা। বিশেষ ফোকাস:

1. 20+ সেকেন্ড রিপ্লাই latency কমানো। লক্ষ্য: repeat/FAQ/product-query ক্ষেত্রে 500ms–2s fast path; complex LLM reasoning ক্ষেত্রে accuracy compromise না করে latency কমানো।
2. image analyze আরও fast ও strong করা। লক্ষ্য: repeated image/cache hit 1s-এর কাছাকাছি; নতুন image-এর ক্ষেত্রে expensive vision reasoning কমিয়ে embedding-first pipeline।
3. e-commerce chatbot architecture আরও পরিষ্কার করা: product knowledge, catalog sync, memory, order flow, admin handover, observability।

গুরুত্বপূর্ণ সিদ্ধান্ত: accuracy compromise না করার strict rule থাকলে সব মেসেজে 500ms নিশ্চিত করা বাস্তবসম্মত নয়। 500ms সম্ভব হবে শুধুমাত্র precomputed/cache/template/semantic cache hit path-এ। নতুন complex query, image download, embedding, LLM, vision reasoning থাকলে network/provider latency থাকবে। তাই plan হবে tiered latency architecture: fast deterministic path আগে, তারপর accurate AI path।

## Current State Analysis

### 1. Webhook ও message orchestration

- [webhookController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js) Facebook ও WhatsApp দুটির মূল orchestration করে।
- একই ফাইলে debounce, queue, semantic cache, image/audio handling, AI response generation, send logic আছে।
- Messenger path-এ default debounce 8s: [webhookController.js#L2885-L2895](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js#L2885-L2895)। শুধু এই wait time-ই অনেক ক্ষেত্রে 20s latency-এর বড় অংশ হতে পারে।
- WhatsApp path-এ default debounce 2500ms: [webhookController.js#L1243-L1258](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js#L1243-L1258)।
- semantic cache fast path আছে, Messenger path-এ cache hit হলে AI call বাদ দিয়ে সরাসরি reply পাঠায়: [webhookController.js#L2763-L2831](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js#L2763-L2831)।
- WhatsApp path-এও semantic cache আছে: [webhookController.js#L1560-L1622](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js#L1560-L1622)।

### 2. AI/LLM path

- [aiService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/aiService.js) central AI service। এখানে text generation, embedding, vision, audio transcription, model routing/cache আছে।
- `generateResponse()` high-level wrapper: [aiService.js#L1281-L1344](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/aiService.js#L1281-L1344)।
- embedding cache, image embedding cache, vision image data cache আছে: [aiService.js#L17-L89](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/aiService.js#L17-L89)।
- direct image embedding default timeout 12s এবং image fetch max 8s: [aiService.js#L1391-L1455](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/aiService.js#L1391-L1455)।

### 3. Image analysis path

- [incomingImageAnalysisService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/incomingImageAnalysisService.js) incoming image analysis + product match করে।
- বর্তমানে `useIncomingImageCache = false`, অর্থাৎ DB image analysis cache লেখা হলেও read করা হচ্ছে না: [incomingImageAnalysisService.js#L606-L610](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/incomingImageAnalysisService.js#L606-L610)। এটা image repeat হলে 1s target নষ্ট করে।
- image vision summary ও direct image embedding parallel চলে: [incomingImageAnalysisService.js#L635-L649](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/incomingImageAnalysisService.js#L635-L649)। ভালো pattern আছে।
- কিন্তু candidate পাওয়া গেলে extra product vision reasoning call হয়, timeout 45s: [incomingImageAnalysisService.js#L667-L678](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/incomingImageAnalysisService.js#L667-L678)। accuracy বাড়ায়, কিন্তু latency অনেক বাড়াতে পারে।
- multi-image শেষে aggregate vision call হয়: [incomingImageAnalysisService.js#L811-L814](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/incomingImageAnalysisService.js#L811-L814)।

### 4. Product/RAG/knowledge

- [dbService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/dbService.js) product search, semantic cache, chat state, DB operations করে।
- `getPageConfig()` user credit/config/prompt related DB reads করে এবং config cache দিয়ে webhookController থেকে 10 মিনিট cache করা হয়।
- `conversation_state` আছে, যেখানে last_product_id, last_variant_key, last_intent, last_image_map রাখা হয়: [dbService.js#L253-L304](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/dbService.js#L253-L304)। এটা e-commerce memory-এর জন্য ভালো base।

### 5. Observability

- [runtimeMonitor.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/runtimeMonitor.js) latency/error events রাখে।
- slow reply threshold এখন 45s, slow vision 30s, slow AI 60s: [runtimeMonitor.js#L93-L101](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/runtimeMonitor.js#L93-L101)। 500ms/1s improvement করার জন্য আরও granular metrics দরকার।

### 6. Research document থেকে প্রাসঙ্গিক ধারণা

- [Salesman_AI_Research_Projects.md](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/Salesman_AI_Research_Projects.md) অনুযায়ী সবচেয়ে relevant ideas:
  - LightRAG/LlamaIndex/Quivr: product RAG ও multimodal knowledge structuring।
  - LiteLLM: model routing/proxy/observability।
  - vLLM/Ollama/LocalAI: low-latency/self-host inference research।
  - mem0/memory projects: customer preference, size, purchase history memory।
  - LangGraph/CowAgent/AstrBot: channel-independent workflow/state machine architecture।
  - prompt optimizer/token compression: prompt ছোট করে latency/cost কমানো।

## Proposed Changes

### Phase A — Latency baseline ও bottleneck identify

#### File: [runtimeMonitor.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/runtimeMonitor.js)

What:
- নতুন latency stages যোগ করতে হবে:
  - `debounce_wait_started/finished`
  - `config_cache_finished`
  - `semantic_cache_finished`
  - `product_search_started/finished`
  - `image_fetch_finished`
  - `image_embedding_finished`
  - `vision_summary_finished`
  - `vision_reasoning_finished`
  - `outbound_send_finished`

Why:
- 20s latency কোথায় যাচ্ছে তা না মেপে safe optimization করা যাবে না।

How:
- existing `recordLatency()` structure রাখবে। শুধু stage names ও summary calculation বাড়াবে।
- threshold নতুনভাবে tiered করবে:
  - fast path warning: > 1000ms
  - normal text AI warning: > 8000ms
  - image warning: > 12000ms

#### File: [webhookController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js)

What:
- Messenger/WhatsApp path-এর major stages-এ `runtimeMonitor.recordLatency()` call বসাতে হবে।

Why:
- real traffic-এ debounce, DB, LLM, image, send latency আলাদা করে দেখা যাবে।

How:
- existing `logMessengerLatency()` pattern থাকলে সেটাকেই extend করতে হবে।
- WhatsApp path-এও একই naming convention ব্যবহার করতে হবে।

### Phase B — 500ms-class reply path without accuracy loss

#### File: [webhookController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js)

What:
- “Fast Deterministic Reply Path” যোগ করতে হবে, semantic cache-এর আগেও/সাথে:
  1. exact FAQ/template cache
  2. semantic cache
  3. product quick lookup for simple price/availability query
  4. only then full AI generation

Why:
- 500ms target শুধু তখনই safe যখন উত্তর আগে থেকেই নির্ভরযোগ্যভাবে জানা আছে। এতে accuracy compromise হয় না, কারণ hallucination-prone LLM এড়ানো যায়।

How:
- প্রথম message হলে এবং media/audio না থাকলে:
  - normalized query বানাবে।
  - exact cache/table বা existing semantic cache lookup করবে।
  - product-specific simple query হলে product DB থেকে deterministic answer compose করবে।
  - match confidence না থাকলে full AI path-এ যাবে।

Decision:
- threshold strict রাখতে হবে। semantic cache threshold 0.96 বা তার বেশি থাকবে। fast path ভুল answer দিলে accuracy compromise হবে, তাই low-confidence cache hit reject করতে হবে।

#### File: [dbService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/dbService.js)

What:
- existing semantic cache ব্যবহার করে আরও strict exact/near-exact lookup helper যোগ করা যেতে পারে।
- product quick answer helper যোগ করা যেতে পারে, যেমন `findProductQuickAnswerForResource()`।

Why:
- AI call বাদ দিয়ে price, stock, delivery, size, color, SKU availability-এর deterministic answer দ্রুত দেওয়া যাবে।

How:
- existing product/resource filtering rules reuse করবে, যেন page/session isolation নষ্ট না হয়।
- product query confident না হলে null return করবে।

#### File: [webhookController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/webhookController.js#L2885-L2895)

What:
- Messenger default debounce 8s থেকে কমিয়ে configurable low-latency default করতে হবে।

Why:
- 8s wait থাকলে 500ms/2s reply অসম্ভব।

How:
- default 8s hardcoded না রেখে env/config ভিত্তিক:
  - `MESSENGER_DEFAULT_DEBOUNCE_MS=800` বা `1000`
  - media/audio থাকলে আলাদা wait, যেমন 1500–2500ms
  - user-defined `pagePrompts.wait` থাকলে সেটি মানবে, কিন্তু negative বা invalid হলে default।

Decision:
- Accuracy compromise না করতে rapid multi-message combine প্রয়োজন। তাই debounce একেবারে 0 করা হবে না; fast cache hit path debounce bypass করতে পারে।

### Phase C — AI response speed improve, accuracy same

#### File: [aiService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/aiService.js)

What:
- prompt/context compression strategy যোগ করতে হবে:
  - history limit dynamic করবে।
  - product context compact JSON বা bullet summary আকারে পাঠাবে।
  - irrelevant old messages বাদ দেবে।

Why:
- LLM latency token count-এর সাথে বাড়ে। accuracy রাখতে relevant context থাকবে, noise কমবে।

How:
- `generateResponse()` / core `generateReply()` path-এ:
  - query intent অনুযায়ী history কমানো।
  - image evidence থাকলে duplicate product text কমানো।
  - product candidates top 3–5 সীমিত রাখা।

What:
- model routing rule clearer করা।

Why:
- simple sales FAQ-তে fast flash model, complex order/product reasoning-এ stronger model ব্যবহার করলে accuracy-loss ছাড়া latency কমে।

How:
- existing branded model/pro-plus routing রাখবে।
- intent classification যদি deterministic হয়, simple intent fast model-এ যাবে।
- uncertain/complex/image-conflict হলে strong model।

### Phase D — Image analysis 1s-class fast path + stronger accuracy

#### File: [incomingImageAnalysisService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/incomingImageAnalysisService.js#L606-L610)

What:
- `useIncomingImageCache` env/config দিয়ে enable করতে হবে, default true করা যেতে পারে।

Why:
- একই image বারবার এলে DB cache hit দিয়ে 1s-এর কাছাকাছি উত্তর সম্ভব। এখন cache read বন্ধ।

How:
- `INCOMING_IMAGE_ANALYSIS_CACHE_ENABLED` env যোগ করবে।
- image hash cache lookup করবে।
- hash করতে full image fetch latency লাগে; তাই URL cache first, hash fallback pattern করা উচিত।

#### File: [incomingImageAnalysisService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/incomingImageAnalysisService.js#L635-L678)

What:
- image pipeline tiered করতে হবে:
  1. cached result
  2. direct image embedding + pgvector product match
  3. only ambiguous হলে vision reasoning
  4. only generic visual question হলে full vision summary

Why:
- এখন matchedProducts থাকলেই extra vision reasoning call হয়। এটা accurate হলেও slow। high-confidence embedding match হলে deterministic answer দেওয়া যায়।

How:
- if top direct image score high এবং gap clear:
  - `reasonImageProductMatchWithVision()` skip করা যাবে।
  - result-এ `CONFIDENT_MATCH_BY_EMBEDDING` হিসেবে evidence রাখা যাবে।
- if top score medium/ambiguous:
  - vision reasoning call হবে।
- if user asks “এই ছবির দাম কত?” এবং product match high:
  - product DB answer আগে।

Decision:
- Accuracy rule বজায় রাখতে low-confidence image match কখনও final answer করবে না। ambiguous হলে AI/vision reasoning চলবে।

#### File: [aiService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/aiService.js#L1391-L1455)

What:
- image embedding timeout ও cache tuning env-এ expose করতে হবে।

Why:
- বর্তমান default 12s/8s fetch fast target-এর জন্য বেশি। তবে খুব কম timeout দিলে accuracy/coverage কমতে পারে।

How:
- production config suggestion:
  - `IMAGE_EMBEDDING_TIMEOUT_MS=5000-8000`
  - `VISION_IMAGE_DATA_FETCH_TIMEOUT_MS=3000-5000`
  - `VISION_IMAGE_DATA_CACHE_MAX` বাড়ানো traffic অনুযায়ী।
- timeout হলে final wrong answer নয়; fallback হবে “আরেকটু পরিষ্কার ছবি/আরেকটু সময়” বা full vision path depending channel policy।

### Phase E — E-commerce chatbot structure

#### File: [dbService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/dbService.js)

What:
- Product knowledge layer আলাদাভাবে সাজাতে হবে:
  - product canonical fields
  - variant/SKU facts
  - policy facts: delivery, return, payment, warranty
  - campaign/ad context facts
  - FAQ/semantic cache facts

Why:
- e-commerce bot-এর answer যেন product DB থেকে grounded হয়, LLM hallucination না করে।

How:
- existing product search functions reuse।
- product answer composer helper বানানো যেতে পারে:
  - product price/stock
  - available sizes/colors
  - delivery charge/time
  - return policy
  - order CTA

#### File: [productController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/productController.js)

What:
- product import/update flow-তে embedding freshness নিশ্চিত করতে হবে।

Why:
- stale embeddings থাকলে image/text search inaccurate হবে।

How:
- product create/update/import-এর পর queue embedding already আছে; সেটা monitoring/status সহ visible করা দরকার।
- failed embedding retry queue রাখা যেতে পারে।

#### File: [productMediaResolver.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/utils/productMediaResolver.js)

What:
- product/variant-specific media decision strictly use করতে হবে।

Why:
- customer যদি red XL variant জিজ্ঞেস করে, wrong image/video পাঠানো যাবে না।

How:
- last_variant_key ও sku_matrix থেকে primary image/video resolve করবে।
- fallback order document করবে: variant image → matched image → product image → additional image।

### Phase F — Research-inspired improvements, but minimal integration

#### LiteLLM-style routing

- এখনই LiteLLM install না করে existing [aiService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/aiService.js)-এর model routing পরিষ্কার করা উচিত।
- ভবিষ্যতে multi-provider observability/proxy দরকার হলে LiteLLM আলাদা service হিসেবে রাখা যাবে।

#### LightRAG/LlamaIndex-style knowledge

- এখন pgvector already আছে, তাই নতুন framework না এনে product facts + embeddings + strict grounding improve করা উচিত।
- বড় catalog হলে Milvus/LightRAG evaluate করা যাবে, কিন্তু current codebase-এ pgvector path রাখাই simplest।

#### mem0-style customer memory

- existing `conversation_state` আছে। এটাকে expand করে customer preferences রাখা যাবে:
  - preferred size
  - preferred color
  - budget
  - last viewed products
  - order intent
- কিন্তু privacy-sensitive data কম রাখবে এবং per page/session scoped হবে।

#### LangGraph-style workflow

- এখন workflow logic controller-এ বড় হয়ে গেছে। future refactor হিসেবে channel-independent sales state machine করা যেতে পারে:
  - classify intent
  - retrieve facts
  - decide action
  - compose answer
  - send media/order CTA
- প্রথম implementation-এ বড় refactor না করে helper extraction করা উচিত।

## Assumptions & Decisions

1. “500 sec” কথাটিকে “500ms/অতি দ্রুত” হিসেবে ধরা হয়েছে, কারণ context-এ user latency কমাতে চেয়েছেন।
2. Accuracy compromise করা যাবে না — তাই full LLM/vision call বাদ দিয়ে সবসময় 500ms করার চেষ্টা করা হবে না। শুধু confident deterministic/cache hit হলেই fast reply।
3. New image analysis 1s guarantee করা যাবে না যদি image download + remote embedding/vision লাগে। কিন্তু repeated/cached image এবং high-confidence embedding match 1s-এর কাছাকাছি করা যাবে।
4. Existing pgvector/product embedding architecture রাখা হবে; নতুন heavy framework যোগ করা হবে না যতক্ষণ না catalog scale সেটা দাবি করে।
5. Debounce কমানো হবে কিন্তু remove করা হবে না, কারণ rapid multi-message customer input combine করা sales accuracy-এর জন্য দরকার।

## Verification Steps

### Latency verification

1. Messenger text-only FAQ query পাঠিয়ে measure:
   - cache miss latency
   - semantic cache hit latency
   - exact/template cache hit latency
2. WhatsApp text-only FAQ query দিয়ে একই test।
3. Target:
   - exact/template/semantic cache hit: ideally 500ms–2s end-to-end
   - normal LLM text: current 20s থেকে উল্লেখযোগ্যভাবে কম
   - no wrong reply from low-confidence cache

### Accuracy verification

1. Same product price/stock query 20–30 variations দিয়ে test।
2. Semantic cache threshold high রেখে false-positive আছে কি না check।
3. Product not found হলে bot যেন fake answer না দেয়।

### Image verification

1. Same image repeat পাঠিয়ে cache hit হয় কি না verify।
2. High-confidence product image match হলে vision reasoning skip করে সঠিক product answer দেয় কি না verify।
3. Ambiguous similar products হলে bot final wrong answer না দিয়ে clarification/options দেয় কি না verify।
4. Runtime monitor-এ image stages আলাদা latency দেখাচ্ছে কি না verify।

### E-commerce flow verification

1. Price, size, color, stock, delivery, return, order intent আলাদা করে test।
2. Variant-specific image/video resolve হয় কি না test।
3. Admin handover থাকলে bot skip করে কি না test।
4. Product update/import করার পর embedding refresh হয় কি না test।

## Recommended Implementation Order

1. Runtime metrics add করা।
2. Messenger default debounce configurable করে কমানো।
3. Exact/semantic/product fast path strengthen করা।
4. Incoming image cache enable করা।
5. Image embedding-first confidence gate যোগ করা।
6. Product answer composer/helper যোগ করা।
7. E-commerce memory/state fields expand করা।
8. End-to-end latency/accuracy test করা।
