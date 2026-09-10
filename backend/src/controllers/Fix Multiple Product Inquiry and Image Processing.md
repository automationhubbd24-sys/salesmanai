# Fix Multiple Product Inquiry and Image Processing

> **Workspace:** c:\Users\autom\Downloads\salesmanai-salesmanchatbot-11\salesmanai-salesmanchatbot-10-backup-july6

---

**User**

multiple image jodi ase tobe sob image ek sate perelly process kore main ai agent er modde ek sate marge hoye data na giye 1 ta 1 ta kore data jabe mane jodi 4 ta image hoi 4 ta image ek sate paile eki sate process houya start hobe. But problem hosse main ai agent ke 4 ta picture er data ek sate pass korle se products er details sobi ek sate patate osubida hote pare amra tokon ek satei 4 ta data main ai agent ke amon vabe dibo se 4 ta output send korbe parellay but serial motabek 1st image er output then 2nd image er output then 3rd avabe 
 
 user jodi multiple products inqurey kore tobe se product er dam dite Parleo sobi dite pare na tai amra etao multiple product inqurey r ketre amon ekta system korbo je ai multiple nijei nijek loop e convert kore ans dibe 
 
 
 
 
 aro deep jodi boli multiple product qurey te amader bot durbol keo jodi 4 ta product er details jante cai se sekane heellucinate kore and image sudu 1tar patate pare but tar ucit je 4 ta product er 1st product er detai;s and picture then 2nd prodcut er details and ans mane 1 ta 1 ta kore output 
 
 
 agula fix koro e ommerce business e asob kub jururi

**Assistant**

এখন আমি মাল্টিপল ইমেজ আর মাল্টিপল প্রোডাক্ট ইনকোয়ারি কোথায় হ্যান্ডল হচ্ছে সেটা খুঁজে দেখছি, তারপর এমনভাবে ফ্লো বদলাবো যাতে প্রসেসিং parallel শুরু হলেও main AI response serial order-এ `1st -> 2nd -> 3rd` আউটপুট দিতে পারে।

আমি backend flow পুরোটা দেখে নিশ্চিতভাবে exact loop-point গুলো বের করেছি। বর্তমান কোডে product search বহু candidate তুলতে পারে, কিন্তু final AI response এখনো মূলত single `product_id`/single delivery path-এ বাঁধা।

**মূল Loop Points**
- [aiService.js:runAgentLoop](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1540-L1883)
  - এখানে structured schema-তে শুধু একটাই `product_id` + `action` আছে ([L1618-L1669](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1618-L1669))।
  - return path-ও single product ধরে ([L1718-L1730](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1718-L1730), [L1775-L1883](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1775-L1883))।
  - multiple product inquiry support দিতে সবচেয়ে গুরুত্বপূর্ণ loop এখানেই: `items[]`/`products[]` response schema করে per-product reply block generate করা।

- [whatsappController.js:processBufferedMessages](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/whatsappController.js#L1722-L2837)
  - AI call হয় [L2565-L2579](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/whatsappController.js#L2565-L2579)।
  - agentic delivery single `aiResponse.product_id` ধরে চলে [L2631-L2700](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/whatsappController.js#L2631-L2700)।
  - photo fallback-ও single target product নেয় [L2735-L2784](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/whatsappController.js#L2735-L2784)।
  - এক user message-এ একাধিক product reply পাঠাতে চাইলে এখানেই `for (const item of aiResponse.items)` টাইপ loop বসবে।

- [webhookController.js:processWhatsAppBatch](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L972-L1852)
  - AI call [L1445-L1459](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1445-L1459)।
  - `aiResponse.product_id` conversation state-এ single value হিসেবে save হয় [L1503-L1509](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1503-L1509)।
  - যদিও `[PRODUCT_ID:...]` tag processor বহু tag loop করতে পারে [L1513-L1611](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1513-L1611), মূল fallback ও media selection এখনো single target নেয় [L1643-L1669](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1643-L1669)।
  - তাই multi-product response formatting-এর জন্য এই function-ও direct loop point।

- [webhookController.js:processBufferedMessages](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L2472-L3559)
  - Messenger flow-এ AI result single `product_id` state update করে [L3286-L3292](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L3286-L3292)।
  - `[PRODUCT_ID]` tag handling multi-tag capable [L3296-L3393](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L3296-L3393)।
  - কিন্তু photo fallback আবার single `targetProductId` নেয় [L3549-L3559](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L3549-L3559)।
  - Messenger multi-product উত্তর চালু করতে এই function-এও per-product loop দরকার।

**সহায়ক Search Points**
- [aiService.js:executeTool](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1367-L1529)
  - `resolve_product` এক query-এর জন্য top candidates আনে [L1378-L1458](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1378-L1458)।
  - multiple product phrases parse করলে এই function-কে per phrase loop করা যায়।

- [aiService.js:generateReply](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1972-L2269)
  - product snapshot injection আগে থেকেই top 5 candidate তোলে [L2192-L2268](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2192-L2268)।
  - user message split করে “product A”, “product B” আলাদা snapshot বানাতে চাইলে এই function ভালো orchestration point।

- [dbService.js:searchProductsForResource](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/dbService.js#L5008-L5181)
  - search layer already multiple products return করে, vector + lexical fallback সহ।
  - অর্থাৎ bottleneck search-এ না, response assembly-তে।

**সবচেয়ে গুরুত্বপূর্ণ সিদ্ধান্ত**
- search backend already multi-candidate capable
- final AI schema single-product
- controller delivery logic single-product
- `[PRODUCT_ID]` tag processor-এ multi-tag support আংশিক আছে, তাই full multi-product support আনতে সবচেয়ে clean path:
  - `aiService.runAgentLoop`-এ `items[]`
  - `whatsappController.processBufferedMessages`-এ per-item delivery loop
  - `webhookController.processWhatsAppBatch` এবং `webhookController.processBufferedMessages`-এ same loop pattern

চাইলে next step-এ আমি এই exact loop design অনুযায়ী কোন file-এ কী structure change লাগবে সেটা patch plan আকারে বাংলাে দিতে পারি।

সম্পূর্ণভাবে ব্যাকএন্ড স্ক্যান করে দেখেছি। নিচে multiple image processing, AI agent payload assembly, এবং product inquiry response flow-এর exact file/function ও সম্ভাব্য bug hypothesis দিলাম।

**মূল ফাইল/ফাংশন**
- Messenger/Webhook entrypoint: [handleWebhook](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L577-L682)
- WhatsApp official media collect: [collectOfficialMediaUrls](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L810-L853)
- WhatsApp batch flow: [processWhatsAppBatch](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L972-L1486)
- Messenger batch flow: [processBufferedMessages](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L2472-L3279)
- Messenger normalization: [runMessengerWorkflow](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/messenger_workflow.js#L31-L75)
- WhatsApp normalization: [runWhatsAppWorkflow](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/whatsapp_workflow.js#L29-L48)
- AI response wrapper: [generateResponse](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1030-L1085)
- Core AI orchestration: [generateReply](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1972-L2606)
- Agent/tool executor: [executeTool](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1367-L1529)
- LLM payload builder/loop: [runAgentLoop](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1540-L1739)
- Vision/image processing: [processImageWithVision](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L3009-L3268)
- Product media resolver: [buildResolvedProductMediaContext](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/utils/productMediaResolver.js#L41-L117)
- Product search: [searchProductsForResource](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/dbService.js#L5008-L5186)

**Multiple Image Processing**
- WhatsApp-এ প্রতি message থেকে image/audio URL collect হয় [collectOfficialMediaUrls](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L810-L853) দিয়ে।
- তারপর batch level image analysis হয় [processWhatsAppBatch](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1053-L1078) এবং Messenger-এ [processBufferedMessages](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L2864-L2938)।
- দুই জায়গাতেই `msg.images.slice(0, 2)` ব্যবহার হচ্ছে, তাই প্রতি message-এ ২টার বেশি image silently drop হয়: [WhatsApp](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1071-L1075), [Messenger](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L2867-L2872)।
- আসল vision call হয় [processImageWithVision](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L3009-L3268) এ; এখানে URL download/base64 conversion/provider fallback আছে।

**AI Agent Payload Assembly**
- `generateResponse` শুধু wrapper; আসল payload assembly হয় [generateReply](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2281-L2606) এ।
- Media pre-processing block: [generateReply](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2365-L2453)
- Final LLM `messages` array build: [generateReply](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2459-L2605)
- Agent loop request payload: [runAgentLoop](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1597-L1675)
- Tool catalog declare করা আছে [functionTools](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L748-L779), কিন্তু `generateReply`-তে `const tools = [];` সেট করা: [aiService.js:L2463-L2467](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2463-L2467)

**Product Inquiry Response Flow**
- User message normalize/merge হয় [runMessengerWorkflow](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/messenger_workflow.js#L31-L75) / [runWhatsAppWorkflow](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/whatsapp_workflow.js#L29-L48)
- Product snapshot inject হয় [buildPromptProductSnapshot inside generateReply](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2192-L2220)
- Actual DB product retrieval/search হয় [searchProductsForResource](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/dbService.js#L5008-L5186)
- Tool-based resolve হলে [executeTool → resolve_product](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1378-L1458)
- AI reply-তে `[PRODUCT_ID:id]` এলে backend tag processor product info/media inject করে:
  - WhatsApp: [webhookController.js:L1511-L1658](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1511-L1658)
  - Messenger: [webhookController.js:L3294-L3388](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L3294-L3388)
- Product media selection হয় [buildResolvedProductMediaContext](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/utils/productMediaResolver.js#L41-L117) থেকে।

**Bug Hypothesis**
- WhatsApp-এ double vision processing হচ্ছে: controller আগে image analyze করছে, তারপর আবার `generateResponse(... imageUrls: allImages ...)` পাঠাচ্ছে, ফলে `generateReply` দ্বিতীয়বার vision call করছে। দেখুন [processWhatsAppBatch call](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L1447-L1459) বনাম [generateReply media pre-processing](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2377-L2415)। Messenger-এ এটা এড়ানো হয়েছে `imageUrls: []` দিয়ে: [webhookController.js:L3238-L3245](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L3238-L3245)
- Multi-image loss bug: প্রতি message-এ hard limit `slice(0, 2)` থাকায় ৩য়/৪র্থ image inquiry context-এ ঢুকছে না; ফলে “multiple image processing” অসম্পূর্ণ।
- Tool flow effectively disabled: prompt-এ “MUST call tools” বলা হলেও backend `tools = []` পাঠাচ্ছে, তাই `resolve_product/get_product/check_stock` বাস্তবে call নাও হতে পারে। Relevant: [generateReply](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L2463-L2467), [runAgentLoop](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1677-L1719)
- Payload duplication/context bloat: controller-level image analysis text আবার `generateReply`-এর media analysis block দিয়ে repeat হতে পারে, এতে product inquiry prompt noisy হয়ে wrong match/extra token usage হতে পারে।
- `resolve_product` score mapping questionable: `match_score = (1 - distance) * 100` ধরে নেওয়া হয়েছে, কিন্তু lexical fallback rows-এর `distance` synthetic; semantic আর lexical score semantics mixed হওয়ায় ambiguity ranking skew হতে পারে: [executeTool](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/aiService.js#L1405-L1452), [searchProductsForResource](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/services/dbService.js#L5034-L5095)
- WhatsApp official media collection sequential: `for ... await getMediaDetails(...)` pattern অনেক media এ latency বাড়াবে; multiple image inquiry-তে timeout risk আছে: [collectOfficialMediaUrls](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-11/salesmanai-salesmanchatbot-10-backup-july6/backend/src/controllers/webhookController.js#L821-L842)

**সবচেয়ে likely root issues**
- WhatsApp path-এ duplicate vision call
- Tools prompt আছে কিন্তু actual tools disabled
- ২টার বেশি image drop হওয়া
- Search ranking/score normalization mismatch

চাইলে next step-এ আমি এগুলোর জন্য targeted fix planও বাংলায় দিতে পারি।

কোডে এখন পরিষ্কার দেখা যাচ্ছে যে সমস্যা search-এ না, বরং AI response schema আর delivery path single-product ধরে লেখা। এখন আমি relevant অংশগুলো পড়ে exact patch বসাবো যাতে multi-image context হারায় না, আর multi-product answer item-by-item বের হয়।

এখন আমি `aiService`-এর media preprocessing block আর response format একসাথে মেলাচ্ছি। এখানে fixটা সম্ভবত দুই ভাগে হবে: `items[]` support যোগ করা, আর controller delivery path-এ ওই items serial order-এ পাঠানো।

প্যাচ প্ল্যানটা এখন স্পষ্ট:

1. `aiService`-এ single `product_id` এর সাথে `items[]` structured field যোগ করবো  
2. model যদি multi-product detect করে, তাহলে এক reply-এর ভিতরে list না বানিয়ে per-item block ফেরত দিতে পারবে  
3. controller-এ ওই `items[]` normalise করে `1st product -> 2nd product -> 3rd product` order-এ text/media পাঠানো হবে  
4. image analysis-এ per-image parallel থাকবে, কিন্তু final merged prompt/order deterministic থাকবে  
5. WhatsApp path-এর duplicate vision call-ও কমাবো যাতে একই image দুইবার AI-তে না যায়

এখন আমি edit করছি।

---

