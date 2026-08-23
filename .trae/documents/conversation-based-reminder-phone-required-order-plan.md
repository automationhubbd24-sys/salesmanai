# Conversation-based Reminder + Phone-required Order Plan

## Summary
এই প্ল্যানে আগের ভুল direction ঠিক করা হবে:

1. Phone number ছাড়া lead/order save হবে না — আগের মতো phone-required order rule ফিরিয়ে আনা হবে।
2. Reminder আর lead/order table-এর উপর depend করবে না। Reminder যাবে conversation/chat table থেকে inactive customer ধরে, যাতে যারা শুধু message করেছে কিন্তু phone/order দেয়নি তারাও reminder পায়।
3. Messenger ও WhatsApp—দুই platform-এই conversation-based reminder হবে।
4. 23-hour safety window থাকবে, যাতে Messenger/WhatsApp policy issue না হয়।

## Current State Analysis

### Reminder এখন কোথা থেকে candidate নেয়
**File:** `backend/src/services/reminderService.js`

বর্তমানে:
- `processPageReminders()` Facebook/Messenger reminder candidate নেয় `fb_order_tracking` থেকে।
- `processWhatsAppReminders()` WhatsApp reminder candidate নেয় `whatsapp_order_tracking` থেকে।
- তাই order/lead row না থাকলে reminder যায় না।
- এটা user requirement-এর সাথে mismatch, কারণ user চান যারা শুধু message করেছে, phone দেয়নি, তারাও reminder পাক।

### Chat data কোথায় save হয়
**File:** `backend/src/services/dbService.js`

Messenger:
- `saveFbChat(data)` function `fb_chats` table-এ save করে।
- key fields: `page_id`, `sender_id`, `recipient_id`, `message_id`, `text`, `timestamp`, `status`, `reply_by`।

WhatsApp:
- `saveWhatsAppChat(data)` function `whatsapp_chats` table-এ save করে।
- key fields: `session_name`, `sender_id`, `recipient_id`, `message_id`, `text`, `timestamp`, `status`, `reply_by`।

### Scheduler কোথা থেকে চলে
**File:** `backend/index.js`

- Server start হলে `reminderService.checkAndSendReminders()` প্রতি 10 মিনিটে চলে।
- তাই নতুন reminder logic একই service-এর ভিতরে রাখলে existing scheduler reuse হবে।

### Phone-less order save এখন কোথায় allow হয়েছে
Recent change-এর কারণে নিচের জায়গাগুলো phone ছাড়া save করতে পারে:

1. **File:** `backend/src/services/orderService.js`
   - `orchestrateOrder()` এ `hasCriticalInfo` phone ছাড়াও address/product/name থাকলে true হয়।
   - ফলে phone না থাকলেও `dbService.saveOrder()` call হতে পারে।

2. **File:** `backend/src/services/dbService.js`
   - Messenger `saveOrderTracking()` এ `hasUsefulOrderData` দিয়ে phone ছাড়া new order row create হয়।
   - WhatsApp `saveWhatsAppOrderTracking()` এ `if (!number && !product_name && !location) return null;` থাকার কারণে product/location থাকলে phone ছাড়া row create হতে পারে।

3. **File:** `backend/src/services/aiService.js`
   - AI fallback path phone ছাড়াও meaningful order data থাকলে `orderService.orchestrateOrder()` call করছে।

## Proposed Changes

### Step 1 — Phone-required order rule restore
**Files:**
- `backend/src/services/orderService.js`
- `backend/src/services/dbService.js`
- `backend/src/services/aiService.js`

**What:** phone number ছাড়া actual lead/order tracking row save হবে না।

**How:**
1. `orderService.orchestrateOrder()` এ `hasPhone` না থাকলে save skip করবে:
   - `hasPhone = extracted.phone && extracted.phone.length >= 8`
   - `if (!hasPhone) return { status: 'NO_ACTION', reason: 'PHONE_REQUIRED' }`
2. `dbService.saveOrderTracking()` Messenger new row creation-এ আবার phone validation add হবে:
   - missing/invalid `number` হলে return null
3. `dbService.saveWhatsAppOrderTracking()` WhatsApp new row creation-এ `number` mandatory করা হবে:
   - `if (!number || number === 'Pending' || number === 'null' || number.length < 8) return null`
4. `aiService.js` এর misleading phone-less order data orchestration path either phone check করবে অথবা orderService-এর PHONE_REQUIRED return trust করবে। Preferred: orderService central enforcement রাখা হবে, aiService শুধু log/comment update করবে।

**Why:** user বলেছেন lead/order phone ছাড়া save হওয়া উচিত না; reminder lead/order save-এর সাথে সম্পর্কিত না।

---

### Step 2 — Conversation-based Messenger reminder query
**File:** `backend/src/services/reminderService.js`

**What:** Messenger reminder candidate `fb_order_tracking` থেকে না নিয়ে `fb_chats` থেকে নেওয়া হবে।

**How:**
`processPageReminders(config)` update করে `fb_chats` থেকে inactive customer conversation বের করা হবে। Proposed query logic:

- Same `page_id`
- Customer inbound message identify:
  - `sender_id <> page_id`
  - `reply_by` user/human অথবা bot/system না
- Last customer/bot activity per customer group করা হবে। Simpler candidate rule:
  - per `customer_id`, latest chat timestamp বের করা
  - latest chat must be older than delay hours
  - latest chat must be within 23 hours
- Already reminder sent avoid:
  - same page/customer pair-এ delay window-এর পর কোনো `status = 'reminder'` chat থাকলে skip
  - অথবা latest message যদি `status = 'reminder'`/`reply_by = 'system'` হয়, skip

Candidate shape হবে:
```js
{
  id: `chat_fb_${page_id}_${sender_id}`,
  sender_id,
  product_name: null,
  customer_name: null,
  updated_at: last_activity_at,
  reminder_source: 'conversation'
}
```

**Why:** যারা lead/order দেয়নি কিন্তু message করেছে, তারাও reminder পাবে।

---

### Step 3 — Conversation-based WhatsApp reminder query
**File:** `backend/src/services/reminderService.js`

**What:** WhatsApp reminder candidate `whatsapp_order_tracking` থেকে না নিয়ে `whatsapp_chats` থেকে নেওয়া হবে।

**How:**
`processWhatsAppReminders(config)` update করে `whatsapp_chats` থেকে inactive customer conversation বের করা হবে। Proposed query logic:

- Same `session_name`
- Customer inbound message identify:
  - `sender_id <> session_name`
  - `reply_by` user/human অথবা bot/system না
- Per customer latest activity group করা হবে।
- latest activity older than delay hours and within 23 hours।
- Already reminder sent skip:
  - same session/customer pair-এ existing `status = 'reminder'` after latest customer activity থাকলে skip।

Candidate shape হবে:
```js
{
  id: `chat_wa_${session_name}_${sender_id}`,
  sender_id,
  product_name: null,
  updated_at: last_activity_at,
  reminder_source: 'conversation'
}
```

Cloud API credential guard থাকবে:
- `phone_number_id`
- `cloud_access_token`

**Why:** WhatsApp user phone/order না দিলেও, শুধুমাত্র conversation inactive হলেই reminder যাবে।

---

### Step 4 — Reminder send functions update: order update বাদ
**File:** `backend/src/services/reminderService.js`

**What:** `sendSmartReminder()` এবং `sendSmartWhatsAppReminder()` এখন order row update করে `reminder_count` বাড়ায়। Conversation-based reminder-এ order id থাকবে না, তাই এই update conditional করতে হবে।

**How:**
1. `sendSmartReminder(pageConfig, candidate, template)`:
   - reminder message id হবে conversation-based:
     - `reminder_fb_${sender_id}_${Date.now()}`
   - successful send হলে `fb_chats` এ `status: 'reminder'`, `reply_by: 'system'` already save হবে।
   - শুধু candidate যদি order source হয় তখন order table update; নতুন plan অনুযায়ী source conversation হবে, তাই order update block remove/skip করা হবে।
2. `sendSmartWhatsAppReminder(sessionConfig, candidate, template)`:
   - same approach
   - successful reminder chat log-ই duplicate prevention marker হবে।
3. Prompt text update:
   - “started an order but didn't finish phone/address” এর বদলে generic follow-up:
   - “A customer chatted recently but has not replied/continued. Write a polite short Bengali follow-up.”

**Why:** reminder আর order table-এর সাথে tied থাকবে না। Chat reminder log দিয়েই duplicate control হবে।

---

### Step 5 — Reminder schema/config naming cleanup minimal রাখব
**File:** `backend/src/services/reminderService.js`

**What:** Existing config columns `order_reminder_enabled`, `order_reminder_delay_hours`, `order_reminder_message` এখনো reuse হবে।

**How:**
- DB migration বড় করে rename করা হবে না।
- UI/API breaking change এড়াতে একই config fields থাকবে।
- Comments/logs-এ “order reminder” এর বদলে “conversation reminder/follow-up reminder” wording update হবে যেখানে reminder service-এর internal comments আছে।

**Why:** Existing settings UI/API না ভেঙে behavior change করা।

---

### Step 6 — Verification

**Static verification:**
1. `GetDiagnostics` চালানো হবে:
   - `backend/src/services/reminderService.js`
   - `backend/src/services/orderService.js`
   - `backend/src/services/dbService.js`
   - `backend/src/services/aiService.js`

**Search verification:**
1. Phone-less order save gate আর থাকবে না:
   - `New leads can be created from any useful order data`
   - `Create a lead from any useful order data`
   - `if (!number && !product_name && !location) return null`
2. Reminder candidate source order table থেকে chat table হয়েছে কিনা:
   - `FROM fb_order_tracking` reminder candidate query-তে থাকা উচিত না।
   - `FROM whatsapp_order_tracking` reminder candidate query-তে থাকা উচিত না।
   - `FROM fb_chats` এবং `FROM whatsapp_chats` থাকবে।
3. Reminder duplicate marker:
   - `status = 'reminder'` বা equivalent duplicate filter query থাকবে।

**Manual scenario review:**
1. Messenger user শুধু “price koto?” লিখে চলে গেলে:
   - order/lead save হবে না, কারণ phone নেই।
   - delay hours পর conversation reminder যাবে।
2. WhatsApp user শুধু “details den” লিখে চলে গেলে:
   - order/lead save হবে না।
   - delay hours পর WhatsApp reminder যাবে।
3. User phone দিলে:
   - order/lead save হবে।
   - reminder system still conversation-based, so duplicate reminder only chat marker দিয়ে control হবে।
4. Reminder once sent:
   - same inactive conversation-এ বারবার reminder যাবে না, কারণ `status = 'reminder'` marker থাকবে।
5. 23 hours পার হয়ে গেলে:
   - reminder যাবে না।

## Assumptions & Decisions
- “সবাইকে remind” মানে: যারা page/WhatsApp এ message করেছে এবং delay hours ধরে inactive, তাদের reminder যাবে।
- “সবাই” বলতে database-এর সব historical users নয়; 23-hour messaging window-এর মধ্যে থাকা users।
- Lead/order save phone ছাড়া হবে না। Reminder lead/order dependency ছাড়াই chat/conversation থেকে চলবে।
- Existing config field names `order_reminder_*` এখনই rename করা হবে না, কারণ এতে UI/API migration লাগবে। Behavior change করাই মূল কাজ।
- WhatsApp official Cloud API credentials check থাকবে, কারণ credentials ছাড়া send সম্ভব না।
