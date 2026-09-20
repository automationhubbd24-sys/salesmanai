# Safe Order Management Brain Plan

## Summary

বর্তdমান order flow-তে সমস্যা হচ্ছে LLM reply, structured `order_etails`, fallback parser, order action resolver, DB merge/update logic, এবং dashboard management — এগুলো আলাদা আলাদা জায়গায় সিদ্ধান্ত নিচ্ছে। তাই live server-এ কখনও duplicate order, কখনও wrong phone/name/price mismatch, কখনও reply text ঠিক কিন্তু DB ভুল — এই ধরনের issue হচ্ছে।

এই plan-এর লক্ষ্য হলো backend LLM brain থেকে শুরু করে DB persistence এবং Active/Draft order management পর্যন্ত একটি safer, predictable order lifecycle তৈরি করা। Implementation হবে incremental এবং rollback-safe: আগে deterministic guard/normalization, তারপর persistence rules, তারপর UI management polish, তারপর verification.

## Current State Analysis

### 1. Messenger webhook entry

- File: `backend/src/routes/webhookRoutes.js`
- Facebook webhook route `POST /` থেকে `webhookController.handleWebhook` call হয়।
- Actual Messenger order flow `backend/src/controllers/webhookController.js`-এর `queueMessage(...)` এবং `processBufferedMessages(...)` দিয়ে যায়।

### 2. LLM/order orchestration controller

- File: `backend/src/controllers/webhookController.js`
- Important existing helpers:
  - `isInfoOnlyCustomerQuery(text)`
  - `hasMeaningfulOrderFields(orderData)`
  - `extractOrderDetailsFromReply(replyText)`
  - `mergeReplyOrderFallback(orderData, replyText)`
  - `shouldSkipOrderOrchestration(userText, orderData)`
- Messenger order orchestration currently happens around `processBufferedMessages(...)`:
  - `aiResponse.order_details?.fields || aiResponse.order_details` নেওয়া হয়।
  - `replyText || aiResponse.reply` থেকে fallback merge করা হয়।
  - fallback থাকলে default intent `update_existing_order` হয়।
  - তারপর `orderService.orchestrateOrder(...)` call হয়।

Current risk:
- Reply text এবং structured JSON mismatch হলে fallback only name/price ধরতে পারে; phone/address/product/quantity consistency fully managed নয়।
- `orderIntent` fallback থাকলেই `update_existing_order`; কিন্তু true new order বনাম correction/update distinction সবসময় deterministic নয়।
- `rawText` হিসেবে only customer combined text যায়; assistant reply/context-এর structured decision audit কম।

### 3. LLM service brain

- File: `backend/src/services/aiService.js`
- `generateResponse(...)` AI response বানায়।
- `runAgentLoop(...)` tool calling দিয়ে product grounding করে।
- Structured response schema-তে আছে:
  - `reply_text`
  - `action`
  - `customer_phone`
  - `customer_address`
  - `customer_name`
  - `product_name`
  - `quantity`
  - `price`
  - `order_details.intent`
  - `order_details.fields`
- Prompt-এ human-like order instruction already আছে।

Current risk:
- LLM prompt ভালো হলেও model sometimes reply text-এ correct summary দেয় কিন্তু `order_details` null দেয়।
- Prompt-only solution safe না; deterministic backend validation দরকার।
- Product/price grounding LLM/tools থেকে আসে, কিন্তু final persisted data-এর consistency checker নেই।

### 4. Order service normalization

- File: `backend/src/services/orderService.js`
- Important functions:
  - `normalizeBdPhone(phone)`
  - `normalizeBanglaDigits(text)`
  - `parsePrice(value)`
  - `resolveOrderAction({ intent, data, rawText })`
  - `orchestrateOrder(params)`
- `orchestrateOrder(...)` extracted AI data normalize করে `dbService.saveOrder(...)`-এ পাঠায়।

Current risk:
- `normalizeBdPhone` invalid phone হলে `null` করে দেয়। কিন্তু user যদি typo/short phone দেয়, UI old phone রেখে দিতে পারে।
- `resolveOrderAction` keyword-based; customer says “new order ager ta alada” ধরতে পারে, কিন্তু edge cases আরো guarded হওয়া দরকার।
- Phone/address/name source priority audit নেই।

### 5. DB save/update logic

- File: `backend/src/services/dbService.js`
- Function: `saveOrderTracking(orderData)`
- Current recent order lookup:
  - same `page_id`
  - same `sender_id`
  - `created_at > NOW() - INTERVAL '24 hours'`
  - latest one row
- Current logic:
  - locked/delivered/create_new_order হলে fresh row
  - answer_only হলে untouched
  - incomplete/correction/same order হলে update
  - otherwise new row
- Recent fix added same product + same phone + same quantity => same order update.

Current risk:
- Only latest one row considered; if customer has multiple active orders, update target may be wrong.
- Phone mismatch can accidentally create/update wrong row depending on null/old phone.
- Address refinement vs new address is currently handled better, but target selection still shallow.
- No explicit audit trail for why order was updated/created/skipped.

### 6. Order API routes

- File: `backend/src/routes/messengerRoutes.js`
- Relevant routes:
  - `GET /api/messenger/orders`
  - `PATCH /api/messenger/orders/:id/status`
  - `DELETE /api/messenger/orders/:id`
- Delete endpoint now deletes `team_order_assignments` then `fb_order_tracking`.

Current risk:
- Delete is hard delete only. Safe management may need confirmation UI, but backend audit/history is absent.
- Existing order list filters by `created_at`, not `updated_at`; updated old orders may not show in Today if created yesterday.

### 7. Frontend order tracking UI

- File: `src/pages/dashboard/messenger/MessengerOrderTrackingPage.tsx`
- Active/Draft split:
  - draft: `pending` or `draft`
  - active: everything else
- Existing actions:
  - status update
  - conversation preview
  - copy
  - delete
  - CSV/Google Sheet export

Current risk:
- Delete button exists but hard-delete UX may need clearer warning.
- Phone shown in list/context may expose stale data if DB update failed or frontend state not refreshed.
- No manual edit option yet; delete exists but safe correction workflow may require status/edit management later.

## Proposed Changes

### Phase A — Backend LLM brain hardening

#### File: `backend/src/services/aiService.js`

What:
- Tighten order brain instructions so AI must always return `order_details` when reply contains an order summary or asks for missing order fields.
- Make intent vocabulary strict:
  - `answer_only`
  - `update_existing_order`
  - `create_new_order`
  - `confirm_pending_order`
- Add explicit prompt rule:
  - If customer provides name/phone/address after order request, do not treat it as new order.
  - If customer says “new order”, “ager ta alada”, “another”, then `create_new_order`.
  - If phone/address/name differs but no new-order wording, mark `update_existing_order`.

Why:
- Prompt should guide model behavior but not be the only protection.

How:
- Modify only the order workflow instruction block and structured output description.
- Do not change model provider/tool calling.

### Phase B — Deterministic order extraction safety layer

#### File: `backend/src/controllers/webhookController.js`

What:
- Expand `extractOrderDetailsFromReply(replyText)` to safely extract:
  - `customer_name`
  - `phone`
  - `address/location`
  - `product_name`
  - `quantity`
  - `price`
- Keep extraction conservative: only parse labeled summary lines like `নাম:`, `Name:`, `Phone:`, `ঠিকানা:`, `Address:`, `Product:`, `Quantity:`, `Price:`, `মোট বিল:`.
- Add helper `normalizeOrderDetailsForDecision(orderData)` only if needed to remove empty/null-like fields.
- Improve `orderIntent` decision:
  - Use AI explicit intent first.
  - If fallback extracted only missing fields from reply summary, use `update_existing_order`.
  - Do not default to update if user text is clearly info-only.

Why:
- Live bug happened because reply text had correct data but JSON was null.
- Fallback should cover all common summary fields, not only name/price.

How:
- Keep existing function names to avoid broad refactor.
- Only add deterministic labeled-line parser; avoid free-form regex that can hallucinate random text.

### Phase C — Order action resolver improvement

#### File: `backend/src/services/orderService.js`

What:
- Improve `resolveOrderAction(...)` keyword rules:
  - Strong new-order patterns: `new order`, `another`, `arekta`, `abar`, `ager ta alada`, `আগেরটা আলাদা`, `নতুন অর্ডার`.
  - Correction/update patterns: `wrong`, `bhul`, `change`, `correct`, `eta hobe`, `number ta`, `address ta`, `name ta`.
- Add a small internal decision object in logs:
  - action
  - explicit intent
  - matched reason
- Keep return value unchanged so downstream compatibility stays safe.

Why:
- Need human-like distinction between address completion, correction, and separate new order.

How:
- Modify resolver only; no database schema change.

### Phase D — DB save/update target selection hardening

#### File: `backend/src/services/dbService.js`

What:
- Replace “latest one row only” update decision with safer candidate selection:
  - Query recent unlocked non-delivered orders for same page/sender within 24h, not only one.
  - Prefer candidate by score:
    1. same phone + same product
    2. same product + missing/old phone
    3. same phone + missing/recovered product
    4. latest incomplete order
  - Only create new row when:
    - `order_action === create_new_order`, or
    - locked/delivered, or
    - incoming product/phone clearly conflicts with all candidates.
- Treat these as update/refinement, not duplicate:
  - more detailed address replacing shorter address
  - customer name completion
  - phone correction when explicit update intent exists
  - price total correction from reply summary

Why:
- Screenshot showed address completion created duplicate before fix.
- Future cases with multiple active orders need safer target selection.

How:
- Keep same table and fields.
- Implement local helper functions inside `saveOrderTracking(...)` or near it:
  - `isPlaceholder(value)`
  - `sameValueOrMissing(incoming, existing)`
  - `scoreOrderCandidate(existing, incoming, order_action)`
- Avoid schema migration unless absolutely necessary.

### Phase E — Phone mismatch safety

#### Files:
- `backend/src/services/orderService.js`
- `backend/src/services/dbService.js`

What:
- Normalize phone before DB save as already done, but add safe behavior:
  - If incoming phone is invalid/null, do not overwrite existing phone.
  - If incoming phone is valid and existing phone differs:
    - update only when `order_action === update_existing_order` or existing phone missing.
    - create new order only if user explicitly says new/separate order.
- Log when incoming phone is rejected due to invalid format.

Why:
- Screenshot showed bot summary and UI/list phone mismatch risk.

How:
- Keep no user-facing behavior change except more correct persistence.

### Phase F — Order tracking API/UI safe management polish

#### Backend file: `backend/src/routes/messengerRoutes.js`

What:
- Keep existing `DELETE /orders/:id` endpoint.
- Make deletion safer by returning deleted order id and page id as now.
- Optional but recommended: wrap delete assignment + order delete in transaction if pg client supports it in this route.

Why:
- Prevent partial delete if assignment delete succeeds but order delete fails.

#### Frontend file: `src/pages/dashboard/messenger/MessengerOrderTrackingPage.tsx`

What:
- Keep existing delete button in both Active and Draft lists.
- Make dialog copy clearer:
  - “This permanently deletes the order from database. Chat messages will stay.”
- Disable delete button while delete is in progress.
- After delete, refresh order list.

Why:
- User wants manual delete from Active/Draft and DB.

How:
- Minimal UI copy/state polish; no new page.

### Phase G — Optional diagnostic visibility, no customer impact

#### Files:
- `backend/src/controllers/webhookController.js`
- existing `ai_message_traces` path if currently used there

What:
- Ensure `diagnosticOrderData` includes:
  - raw AI `order_details`
  - fallback extracted fields
  - final order payload sent to `orderService`
  - skip reason

Why:
- Future live proof collection becomes easier without changing customer behavior.

How:
- Only add to existing trace/debug object if it already exists in controller.
- Do not create noisy logs or new DB table.

## Assumptions & Decisions

1. No new database table will be added in first implementation.
2. Hard delete will remain, because user explicitly asked DB delete.
3. Chat messages will not be deleted when an order is deleted.
4. Delivered/locked orders should not be modified by bot; new customer order after that creates fresh order.
5. Same sender + same product + same phone + ongoing order means update/refinement unless user clearly says new/separate order.
6. If customer explicitly says previous/new order is separate, system creates a new order.
7. Prompt-only fix is not enough; deterministic backend guard must protect live server.
8. Implementation should be small, testable, and avoid broad refactor.

## Verification Steps

### Static checks

Run:

```powershell
node --check "backend/src/controllers/webhookController.js"
node --check "backend/src/services/orderService.js"
node --check "backend/src/services/dbService.js"
node --check "backend/src/routes/messengerRoutes.js"
```

Run frontend diagnostics for:

```text
src/pages/dashboard/messenger/MessengerOrderTrackingPage.tsx
```

### Scenario checks

1. Same order address completion
   - Customer gives partial address first.
   - Customer later gives detailed address.
   - Expected: existing order updates; no duplicate row.

2. Name after order summary
   - Bot reply contains final summary.
   - AI `order_details` missing/null.
   - Expected: fallback extracts name/price/phone/address from summary and updates DB.

3. Wrong phone correction
   - Customer says old number wrong, gives new number.
   - Expected: existing ongoing order phone updates.

4. New separate order
   - Customer says “eta new order, ager ta alada”.
   - Expected: new order row created.

5. Info-only question after order
   - Customer asks delivery time/product quality/price question.
   - Expected: no order update/create.

6. Delete management
   - Delete active order.
   - Expected: row removed from UI and `fb_order_tracking`.
   - Delete draft order.
   - Expected: row removed from UI and `fb_order_tracking`.

### Live safety checks after deploy

- Confirm bot reply still sends successfully.
- Confirm Active Orders count does not duplicate for address/name completion.
- Confirm phone/name/price in bot summary matches order list/context.
- Confirm delete button removes order from DB and does not delete chat history.
