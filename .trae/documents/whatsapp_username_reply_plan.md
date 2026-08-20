# WhatsApp Username Reply Plan

## সারাংশ
Meta-এর নতুন WhatsApp username / BSUID আচরণে incoming পরিচয় phone number-এর বদলে username বা business-scoped identifier হতে পারে। এখনকার backend WhatsApp flow এখনো মূলত `senderId`/`phone_number`-নির্ভর, তাই username-যুক্ত user এলে contact lookup, chat history, lock check, এবং reply routing ভেঙে bot reply নাও দিতে পারে।

## বর্তমান অবস্থা বিশ্লেষণ
- WhatsApp inbound batch flow `senderId` দিয়ে contact save ও chat save করছে: [webhookController.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/controllers/webhookController.js#L1361-L1705)
- Contact validity logic শুধু নাম valid কিনা দেখে, পরিচয় key হিসেবে username/BSUID ধরে না: [contactName.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/utils/contactName.js)
- WhatsApp contact schema ও upsert path এখন `phone_number`/`lid` ভিত্তিক: [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js#L2383-L2499)
- Chat history ও lock check-ও একই identifier path ধরে: [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js#L2212-L2383) এবং [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js#L3255-L3274)
- Smart inbox name resolution name/profile_name-এর ওপর নির্ভরশীল: [smartInbox.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/utils/smartInbox.js#L10-L73)
- Meta-side username/BSUID behavior অনুযায়ী phone number সব সময় থাকবে না; business username only display/lookup feature নয়, backend identity mapping-ও আপডেট দরকার: search result source below.

## প্রস্তাবিত পরিবর্তন

### 1) WhatsApp inbound identity normalize করা
**ফাইল:** [webhookController.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/controllers/webhookController.js#L1361-L1705)
- incoming payload থেকে শুধু `senderId` না ধরে অতিরিক্ত identity field বের করতে হবে: `wa_id`, `profile_name`, `username`, `business_scoped_user_id` বা payload-এ যা থাকে তা।
- একটি normalized identity object বানাতে হবে, যাতে bot একই conversation-এর জন্য stable key ব্যবহার করতে পারে।
- যদি username/BSUID আসে, fallback হিসেবে `phone_number` না থাকলেও reply flow চলবে।

### 2) WhatsApp contact save / lookup প্রসারিত করা
**ফাইল:** [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js#L2383-L2499)
- `whatsapp_contacts`-এ username/BSUID রাখার জন্য existing columns reuse করা যায় কিনা তা আগে inspect করতে হবে; না হলে existing schema path-এ safe extension করতে হবে।
- contact upsert-এ `phone_number` ছাড়াও normalized identity key save করতে হবে।
- lookup logic-এ phone number absent হলেও same contact শনাক্ত করতে হবে।

### 3) Chat history, lock, and reply eligibility একই normalized identity-তে চালানো
**ফাইল:** [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js#L2212-L2383), [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js#L3255-L3274)
- `getWhatsAppChatHistory` ও `checkWhatsAppLockStatus`-এ username-based conversation key support যোগ করতে হবে।
- current sender lookup যদি username-based key পায়, সেটাকে একই conversation হিসেবে treat করতে হবে।
- reply gating যেন `phone_number` না থাকলেও bot reply বন্ধ না করে।

### 4) Smart inbox display name fallback ঠিক করা
**ফাইল:** [smartInbox.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/utils/smartInbox.js#L10-L73)
- contact name resolution-এ `profile_name`/username fallback যোগ করতে হবে, যাতে inbox-এ contact blank বা numeric identifier না দেখায়।
- username থাকলে সেটাকে display-friendly name হিসেবে prefer করা হবে, কিন্তু manual নাম override থাকলে সেটা অপরিবর্তিত থাকবে।

### 5) Meta webhook docs অনুযায়ী payload mapping যাচাই করা
- Webhook payload-এ কোন field username/BSUID দেয় তা নিশ্চিত করে mapping বসাতে হবে।
- যদি Meta-এর incoming event-এ নতুন identifier field না থাকে, তাহলে fallback strategy লিখতে হবে: business-scoped mapping table + phone fallback.

### 6) Regression guard
- Messenger flow-এ কোনো পরিবর্তন না এনে শুধু WhatsApp path-এ কাজ করতে হবে।
- Shared `aiService.js`-এ WhatsApp identity change যেন Messenger behavior না ভাঙে।

## সিদ্ধান্ত ও অনুমান
- এই কাজের scope WhatsApp incoming reply routing পর্যন্ত সীমাবদ্ধ থাকবে; frontend UI বদলানো হবে না।
- ধরে নিচ্ছি Meta payload-এ username/BSUID-related identifier পাওয়া যেতে পারে, বা অন্তত webhook context থেকে derived করা যাবে।
- যদি payload-এ এমন field না থাকে, তাহলে DB mapping layer-এ stable identifier derive করতে হবে।

## যাচাই
1. Username/BSUID-সহ sample webhook payload দিয়ে inbound path চালানো।
2. নিশ্চিত করা যে contact save, history save, lock check, এবং AI reply সব একই identity ধরে চলছে।
3. username থাকলেও bot reply দিচ্ছে কি না verify করা।
4. Messenger flow untouched আছে কি না regression check করা।
5. WhatsApp conversation view/smart inbox-এ নাম ঠিক দেখাচ্ছে কি না দেখা।

## Meta doc references
- WhatsApp Business username best practices show username can replace phone-number-centric discovery and business profile display priority includes username: [Best practices for WhatsApp Business Username](https://www.alibabacloud.com/help/en/chatapp/use-cases/whatsapp-business-username-best-practices)
- Business-scoped user IDs are part of the 2026 WhatsApp identity update and phone numbers may disappear from webhook context: [Business-scoped user IDs](https://support.chatarchitect.com/books/meta-whatsapp/page/business-scoped-user-ids-developer-documentation)
- 2026 BSUID rollout guidance stresses updating CRM/backend identifier mapping: [WhatsApp Username Update 2026](https://myoperator.com/blog/whatsapp-username-update-2026)
