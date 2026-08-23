# Reminder Lead Rules Update Plan

## Summary
এই প্ল্যানে ৩টি requested change থাকবে: phone number ছাড়া lead/order create না হওয়া rule remove করা, reminder candidate থেকে `status = 'ongoing'` বাধ্যতামূলক filter remove করা, এবং unofficial WhatsApp related reminder guard/code path remove করা—কারণ এখন শুধু official WhatsApp API ব্যবহার হবে।

## Current State Analysis
- Messenger reminder candidate query আছে `backend/src/services/reminderService.js` এর `processPageReminders()` এ। এখানে `status = 'ongoing'`, `reminder_count = 0`, delay window, এবং 23-hour window filter আছে।
- WhatsApp reminder candidate query আছে `backend/src/services/reminderService.js` এর `processWhatsAppReminders()` এ। এখানে `status = 'ongoing'` filter এবং `provider_type !== 'official'` guard আছে।
- AI fallback path `backend/src/services/aiService.js` এ phone ছাড়া order orchestration skip করে।
- Messenger DB save path `backend/src/services/dbService.js` এর `saveOrderTracking()` নতুন order row create করার আগে phone mandatory করে।
- WhatsApp DB save path `backend/src/services/dbService.js` এর `saveWhatsAppOrderTracking()` phone strictly mandatory করে না, তবে normal AI/orderService flow থেকে phone-first guard এর কারণে অনেক case skip হতে পারে।
- Unified order logic `backend/src/services/orderService.js` already phone ছাড়াও address/product/customer_name থাকলে critical info হিসেবে ধরে, কিন্তু comment-এ phone mandatory ধারণা আছে।

## Proposed Changes — ৫ Step

### Step 1 — AI phone-first guard remove
**File:** `backend/src/services/aiService.js`

**What:** `structuredFinal` থেকে order info পাওয়া গেলে শুধু phone থাকলেই `orderService.orchestrateOrder()` call হবে—এই condition remove করা হবে।

**How:**
- `if (orderData.customer_phone && orderData.customer_phone.length >= 10)` guard সরিয়ে `orderData` তে product/address/name/phone এর যেকোনো meaningful data থাকলে orchestration call করা হবে।
- phone না থাকলে `phone: null` যাবে।
- “No phone detected yet. Skipping order save/update.” log remove/update করা হবে।

**Why:** phone না দিলেও lead/order draft create/update করতে হবে।

---

### Step 2 — Messenger DB new lead phone requirement remove
**File:** `backend/src/services/dbService.js`

**What:** `saveOrderTracking()` এ নতুন Messenger/Facebook order create করার আগে phone mandatory check remove করা হবে।

**How:**
- এই block remove/replace করা হবে:
  - missing/invalid `number` হলে return null
- নতুন row create করার আগে minimum requirement হবে: `page_id` + `sender_id` আছে, এবং order info এর মধ্যে অন্তত product/location/name/phone/email/quantity/price এর কোনো useful value আছে।
- phone না থাকলে `number` null বা `Pending` হিসেবে save হবে, existing insert structure যতটা সম্ভব রাখা হবে।

**Why:** customer phone না দিলেও lead যেন তৈরি হয় এবং পরে reminder candidate হতে পারে।

---

### Step 3 — Reminder query থেকে `status = 'ongoing'` filter remove
**File:** `backend/src/services/reminderService.js`

**What:** Messenger ও WhatsApp reminder candidate query থেকে `AND status = 'ongoing'` বাদ দেওয়া হবে।

**How:**
- `processPageReminders()` query থেকে `AND status = 'ongoing'` remove।
- `processWhatsAppReminders()` query থেকে `AND status = 'ongoing'` remove।
- বাকি safety filters রাখা হবে:
  - `reminder_count = 0`
  - delay hours passed
  - 23-hour window

**Why:** reminder যেন শুধু ongoing status এর উপর depend না করে; যেসব lead/order row আছে এবং reminder যায়নি, তারা eligible হতে পারে।

**Decision:** delivered/locked order-এও reminder যাওয়ার risk থাকবে যদি `reminder_count = 0` এবং 23-hour window match করে। User specifically ongoing condition remove করতে বলেছেন, তাই plan এ সেটাই থাকবে।

---

### Step 4 — Unofficial WhatsApp reminder guard remove
**File:** `backend/src/services/reminderService.js`

**What:** `processWhatsAppReminders()` থেকে `provider_type !== 'official'` based skip/remove করা হবে।

**How:**
- function parameter destructuring থেকে `provider_type` দরকার না হলে remove।
- initial guard `provider_type !== 'official' || !phone_number_id || !cloud_access_token` থেকে unofficial provider condition remove করা হবে।
- reloaded `sessionConfig.provider_type !== 'official'` check remove করা হবে।
- `phone_number_id` এবং `cloud_access_token` credential guard রাখা হবে, কারণ official Cloud API send করতে এগুলো লাগবেই।

**Why:** codebase এখন official WhatsApp-only, তাই provider_type unofficial branch/skip unnecessary। কিন্তু credentials ছাড়া Cloud API send সম্ভব না, তাই credential check থাকবে।

---

### Step 5 — Cleanup comments + verification
**Files:**
- `backend/src/services/orderService.js`
- `backend/src/services/dbService.js`
- `backend/src/services/aiService.js`
- `backend/src/services/reminderService.js`

**What:** phone mandatory বা unofficial WhatsApp সম্পর্কিত misleading comments/logs update করা হবে।

**How:**
- `orderService.js` এর “NEW order MUST have a phone number” comment update।
- `dbService.js` এর “Strict Requirement: Must have a phone number” comment remove/update।
- `reminderService.js` এর “ongoing orders” comment update করে “eligible orders/leads” করা।

**Verification:**
1. Static check: modified files syntax error আছে কিনা diagnostics/check করা।
2. Code search: `No phone detected yet. Skipping`, `Must have a phone number`, `provider_type !== 'official'`, এবং reminder query এর `status = 'ongoing'` target জায়গায় আর আছে কিনা verify করা।
3. Manual scenario review:
   - Messenger customer শুধু product/address/name দিলে lead row create হবে।
   - WhatsApp customer phone ছাড়া product/address দিলে order orchestration skip করবে না।
   - Reminder query status-independent হবে।
   - WhatsApp reminder official provider type check ছাড়া Cloud credentials দিয়ে send করবে।

## Assumptions & Decisions
- “ফোন নাম্বার না দিলে Lead Create না হলে remove” মানে phone ছাড়া lead/order draft create করতে হবে।
- “অর্ডার স্ট্যাটাস ongoing না থাকলে” item-টি remove করতে বলা হয়েছে ধরে নেওয়া হয়েছে, তাই reminder query থেকে `status = 'ongoing'` filter বাদ যাবে।
- Unofficial WhatsApp পুরো app থেকে সব historical route remove করা এই plan-এর scope না; এই requested reminder/code path থেকে unofficial provider skip logic remove করা হবে। Existing official-only routes/legacy retired messages untouched থাকবে, কারণ সেগুলো production safety/UX এর অংশ।
- Cloud API send করার জন্য `phone_number_id` এবং `cloud_access_token` guard রাখা হবে। এগুলো remove করলে send fail হবে।
