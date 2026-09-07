# Prompt-driven Facebook ও Instagram Comment Automation পরিকল্পনা

## সারসংক্ষেপ

বর্তমান toggle, keyword ও fixed-template নির্ভর comment automation-কে একটি **AI system-prompt driven action engine**-এ রূপান্তর করা হবে। প্রতিটি নতুন Facebook Page বা Instagram comment-এর জন্য AI পোস্ট/product context ও user-এর সংরক্ষিত Comment Automation System Prompt পড়ে নির্দিষ্ট সিদ্ধান্ত দেবে। Backend সেই সিদ্ধান্ত validate করে কেবল অনুমোদিত action চালাবে:

- public comment reply
- private DM
- comment delete
- comment reaction
- কোনো action নয়

Facebook ও Instagram—দুই প্ল্যাটফর্মেই একই prompt ও decision contract প্রয়োগ হবে। DM পাঠানোর প্রয়োজন আছে কি না AI-ই নির্ধারণ করবে।

## বর্তমান অবস্থা

- [commentAutomationService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/commentAutomationService.js) বর্তমানে config থেকে fixed public reply পাঠায়, bad-keyword match হলে delete করে এবং AI থেকে কেবল DM-এর text নেয়। AI response-এর action ব্যবহার বা execute করা হয় না।
- [CommentAutomationSettings.tsx](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/src/components/dashboard/CommentAutomationSettings.tsx) UI-তে public-reply, DM, AI DM, deletion toggle, keyword ও template আলাদা করে দেখায়।
- [facebookService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/facebookService.js) comment reply ও delete, এবং Messenger DM পাঠাতে পারে; reaction action নেই।
- [webhookController.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/controllers/webhookController.js) Facebook `feed` comment event shared service-এ পাঠায়। [instagramController.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/controllers/instagramController.js) Instagram `comments`/`feed` event-ও একই service-এ পাঠায়।
- [aiService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/aiService.js) JSON-oriented response contract দেয়, কিন্তু comment service শুধুই `reply`/`reply_text` পড়ে।
- [messengerRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/routes/messengerRoutes.js) এবং [instagramRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/routes/instagramRoutes.js) platform-specific configuration API দেয়।

## সিদ্ধান্ত ও অনুমান

1. প্রথম release-এ একই implementation Facebook Messenger Page ও Instagram Professional comment-এর জন্য থাকবে।
2. Automation চালু/বন্ধ রাখার একটি master switch থাকবে; বন্ধ থাকলে কোনো AI call বা Meta action হবে না।
3. সব action AI-এর JSON decision থেকে আসবে। পুরোনো trigger keyword, spam keyword, fixed public reply ও DM-specific toggle বাদ যাবে; এগুলোর নিয়ম user System Prompt-এ লিখবে।
4. Backend strict allowlist দিয়ে AI output validate করবে; অনিরাপদ বা ভুল JSON হলে কোনো destructive action করবে না এবং event audit-এ error/status রাখবে।
5. AI `send_dm` সিদ্ধান্ত দিলে backend DM পাঠানোর চেষ্টা করবে; Meta platform eligibility/policy কারণে ব্যর্থ হলে অন্য সফল action rollback হবে না এবং error পৃথকভাবে log হবে।
6. Comment reaction-এর জন্য Meta Graph API capability/permission platformভেদে যাচাই করে endpoint implement হবে। API unsupported/permission-denied হলে event-এ action failure লেখা হবে, অন্য action চলবে।
7. Post/product mapping আগের মতো থাকবে, যাতে prompt-এ নির্ভরযোগ্য context যুক্ত করা যায়।

## প্রস্তাবিত পরিবর্তন

### 1. Comment action decision ও execution engine

**ফাইল:** [commentAutomationService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/commentAutomationService.js)

- `comment_automation_configs` table-কে সরল করে master `enabled` এবং একক `system_prompt` field কেন্দ্রীয় করা হবে। পুরোনো columns database compatibility-এর জন্য অব্যবহৃত রেখে নতুন path-এ পড়া হবে না।
- `comment_automation_events`-এ AI decision, requested actions ও প্রতিটি action-এর status/text/error audit করার জন্য JSONB/নির্দিষ্ট status columns যোগ করা হবে। Existing public reply ও DM log columns compatibility-এর জন্য retain হবে।
- একটি internal `buildCommentDecisionPrompt()` তৈরি হবে, যা user-এর system prompt-এর সঙ্গে untrusted event context যোগ করবে: platform, post caption, comment, mapped products এবং response schema।
- AI-কে কেবল এই strict JSON schema দিতে বলা হবে:

```json
{
  "action": "SKIP | MODERATE | ENGAGE",
  "delete_comment": false,
  "reaction": "NONE | LIKE | LOVE | CARE | HAHA | WOW | SAD | ANGRY",
  "public_reply": "",
  "send_dm": false,
  "dm_message": "",
  "reason": "short audit reason"
}
```

- `normalizeCommentDecision()` response parse, JSON extraction, enum normalization ও content length check করবে। Invalid result হলে default safe decision `SKIP` হবে।
- `processCommentAutomationEvent()`-এর keyword/template-first flow সরিয়ে নতুন sequence হবে: dedup lock/event create → post-product context → AI decision → approved actions নির্দিষ্ট ক্রমে execute → প্রতি action-এর status/audit update।
- Execution order হবে delete আগে; delete true হলে public reply, reaction ও DM নিরাপত্তার জন্য skip হবে। অন্য ক্ষেত্রে reaction → public reply → DM চলবে। AI blank public/DM text দিলে সংশ্লিষ্ট action চলবে না।
- Messenger ও Instagram DM/chat persistence আগের `dbService.saveFbChat`/`saveInstagramChat` convention-এ রাখা হবে।

### 2. Meta comment reaction support

**ফাইল:** [facebookService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/facebookService.js)

- `reactToComment(commentId, reactionType, accessToken)` যুক্ত হবে। এটি action enum allowlist validate করে Graph API-র comment reaction endpoint-এ request পাঠাবে।
- Reply/delete-এর মতো consistent error logging ও response return করবে।
- Shared helper Facebook এবং Instagram comment event-এর জন্য service layer থেকে ব্যবহৃত হবে; platform-specific Meta error event audit-এ যাবে।

### 3. Prompt-centered configuration API

**ফাইল:** [commentAutomationService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/commentAutomationService.js), [messengerRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/routes/messengerRoutes.js), [instagramRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/routes/instagramRoutes.js)

- বিদ্যমান GET/PUT endpoint অপরিবর্তিত রেখে response/request-এ `enabled` ও `system_prompt` supported field করা হবে।
- PUT route-এ authenticated resource authorization-এর বিদ্যমান pattern অক্ষুণ্ণ থাকবে।
- API saved config ফেরত দেবে, যাতে UI reload ছাড়া state update করতে পারে।

### 4. Frontend workflow redesign

**ফাইল:** [CommentAutomationSettings.tsx](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/src/components/dashboard/CommentAutomationSettings.tsx)

- বর্তমান পৃথক public-reply, DM, AI DM, delete, cooldown ও keyword controls সরিয়ে একটি master **Enable automation** switch এবং বড় **Comment Automation System Prompt** editor থাকবে।
- Editor-এর নিচে accepted AI actions স্পষ্টভাবে দেখানো হবে: Reply, DM, Delete, React, Skip।
- Prompt example/help text থাকবে যাতে user বাংলায় rules লিখতে পারে: spam delete, দাম চাইলে reply+DM, সাধারণ প্রশ্নে reaction, uncertainty হলে clarification/skip।
- Save request নতুন `system_prompt` config field পাঠাবে এবং existing auth header/API path ব্যবহার করবে।
- UI-তে সর্বশেষ processed event-এর action/status দেখানোর জন্য existing backend audit response ব্যবহার করা হবে অথবা প্রয়োজনীয় read endpoint যোগ করা হবে। এতে prompt কী সিদ্ধান্ত নিয়েছে এবং কোন Meta action fail করেছে বোঝা যাবে।
- Post/product mapping এবং webhook debug section রাখা হবে; এগুলো prompt context-এর জন্য দরকারি। Mapping trash icon-এর জন্য backend DELETE mapping endpoint এবং click handler যোগ হবে, যাতে stale mapping সরানো যায়।

### 5. Mapping lifecycle API

**ফাইল:** [commentAutomationService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/commentAutomationService.js), [messengerRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/routes/messengerRoutes.js), [instagramRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/routes/instagramRoutes.js), [CommentAutomationSettings.tsx](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/src/components/dashboard/CommentAutomationSettings.tsx)

- `deleteMapping(platform, accountId, mappingId/postId)` service method এবং authenticated platform route যোগ হবে।
- UI trash action confirmation ছাড়াই সরাসরি delete API call করবে, তারপর mappings reload করবে—বর্তমান interaction style অনুসরণ করে।

### 6. Instagram subscription alignment

**ফাইল:** [instagramService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/src/services/instagramService.js)

- `subscribeLinkedPage()`-এ controller যেসব comment field process করে (`comments`/`feed`) সেগুলোর subscription Meta-supported form-এ request করা হবে, যাতে Instagram comment automation webhook বাস্তবে event পায়।
- Subscription error existing connect flow-তে surfaced/logged থাকবে।

### 7. Tests and verification coverage

**ফাইল:** নতুন focused backend unit test বা বিদ্যমান backend test convention অনুযায়ী test file; প্রয়োজনমতো [backend/package.json](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/backend/package.json) script ব্যবহার করা হবে।

- Decision parser tests: valid JSON, markdown-wrapped JSON, invalid JSON, invalid enum, delete+other-actions conflict, blank texts।
- Executor tests: safe order, delete short-circuit, reaction/reply/DM calls, partial failure audit।
- Manual end-to-end checklist:
  1. Facebook ও Instagram-এ automation enable করে system prompt save করা।
  2. দাম/বিস্তারিত comment-এ AI reply, expected reaction ও DM দেয় কি না দেখা।
  3. Prompt-নির্ধারিত offensive comment delete হচ্ছে কি না দেখা।
  4. AI `SKIP` দিলে কোনো Meta mutation না হওয়া।
  5. Product mapping থাকলে exact product context ব্যবহার করছে কি না দেখা।
  6. Webhook debug ও event audit-এ decision/action/failure দেখা।
  7. frontend build এবং relevant backend tests চালানো।

## Verification

- TypeScript diagnostics: [CommentAutomationSettings.tsx](file:///d:/Downloads/salesmanai-salesmanchatbot-28/salesmanai-salesmanchatbot-28/src/components/dashboard/CommentAutomationSettings.tsx)
- Node syntax/import checks for modified backend services/routes.
- Frontend production build (`npm run build`) এবং backend relevant test command চালিয়ে যাচাই।
- Meta access token ও permission ছাড়া live action test করা হবে না; mock/service-level tests এবং webhook debug payload দিয়ে local flow যাচাই করা হবে।
