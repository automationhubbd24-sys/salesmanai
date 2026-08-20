# Team Management পূর্ণাঙ্গ সমাপ্তি পরিকল্পনা

## সারসংক্ষেপ
বর্তমান Team Management-এ member/permission persistence এবং quota settings আছে, কিন্তু তিনটি production capability অসম্পূর্ণ:

1. নির্দিষ্ট admin/team member কে কতটি human reply দিয়েছেন তার বাস্তব analytics নেই।
2. নতুন Messenger/WhatsApp order তৈরি হওয়ার সাথে সাথে সমানভাবে member-এ auto-allocation হয় না।
3. সংরক্ষিত module permissions সব সংশ্লিষ্ট backend route এবং frontend navigation/route-এ enforce হয় না।

এই পরিকল্পনায় এগুলো backward-compatible migration, backend authorization, transactional allocation, বাস্তব analytics এবং UI guard দিয়ে সম্পূর্ণ করা হবে। পুরনো chat বা order silently reassign/backfill করা হবে না।

## বর্তমান অবস্থা বিশ্লেষণ

### Permission storage আছে, enforcement অসম্পূর্ণ
- [teamRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/teamRoutes.js) `MODULE_PERMISSION_SCHEMA`-এ `smart_inbox`, `orders`, `conversion`, `ai_settings`, `control_panel`, `team` action সংজ্ঞায়িত ও persist করে।
- একই ফাইলে Team Management endpoints owner-only, কিন্তু এই permission logic router-local। Messenger/WhatsApp routes reusable authorization helper ব্যবহার করে না।
- [messengerRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/messengerRoutes.js) Smart Inbox send/read/order routes authenticated হলেও module action এবং সবক্ষেত্রে resource access enforce করে না।
- [whatsappRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/whatsappRoutes.js) কিছু session access check আছে, কিন্তু action-level permission এবং status-update ownership enforce করে না।

### Reply attribution নেই
- Messenger `POST /send` [messengerRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/messengerRoutes.js)-এ `reply_by: 'admin'` লিখে, কিন্তু `req.user` identity সংরক্ষণ করে না।
- WhatsApp send flow-ও একইভাবে generic `reply_by: 'admin'` রাখে।
- [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js)-এ `fb_chats`/`whatsapp_chats` write path-এ actor column নেই।
- ফলে [teamRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/teamRoutes.js)-এর `GET /analytics` নিরাপদভাবে empty payload ফেরত দেয়।

### Allocation settings আছে, allocation write-path নেই
- `team_order_settings` এবং `team_order_assignments` migration-এ তৈরি হয়েছে।
- [teamRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/teamRoutes.js)-এ quota display কেবল persisted assignment count দেখায়।
- [dbService.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/services/dbService.js)-এর `saveOrderTracking()` এবং `saveWhatsAppOrderTracking()` নতুন order insert বা existing order merge করে, কিন্তু allocation record লেখে না।
- [messengerRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/messengerRoutes.js) ও [whatsappRoutes.js](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/backend/src/routes/whatsappRoutes.js)-এর orders listing assignment join/filter করে না।

## নিশ্চিত সিদ্ধান্ত

### Reply analytics
- Owner-এর পাঠানো reply `Owner replies` হিসেবে আলাদা metric হবে।
- Team member-এর reply সংশ্লিষ্ট member-এর নামে প্রদর্শিত হবে।
- শুধু `reply_by = 'admin'` এবং attributed human message গণনা হবে। Bot, AI, automation, system এবং inbound customer message গণনা হবে না।
- পুরনো attributed নয় এমন messages member metrics-এ ঢুকবে না; প্রয়োজনে `unattributed_replies` metric-এ দেখানো হবে।

### Order allocation
- Equal-share mode-এ active workload ভিত্তিতে বণ্টন হবে।
- উদাহরণ: মোট active capacity 100, 5 member হলে প্রত্যেকের target workload 20। (1000/5 হলে প্রত্যেকের target 200।)
- নতুন order সেই active member পাবেন যার current active assigned order সর্বনিম্ন; tie হলে stable email order ব্যবহার হবে।
- একটি order `delivered`, `locked`, বা `cancelled` হলে member-এর active workload কমবে। পরের নতুন order সে পেতে পারবে।
- Member কেবল নিজের assigned orders দেখতে পাবে। Owner সব order এবং assignment দেখতে পারবে।
- Existing orders reassign হবে না। Duplicate webhook/retry একই assignment ফেরত দেবে।
- Equal-share capacity পূর্ণ থাকলে order assigned হবে না; `member_email = NULL` রেখে pending/unassigned হিসেবে নিরাপদে থাকবে। Owner capacity/member পরিবর্তন বা manual assignment করলে সেটি সমাধান করা যাবে।

### Team Management ownership
- Team Management member list, invite, permission edit, allocation settings এবং full-team analytics owner-only থাকবে।
- Admin `team_owner` query/header বদলে privilege escalate করতে পারবে না।

## প্রস্তাবিত পরিবর্তন

### 1. Canonical database migrations
নতুন versioned migration [supabase/migrations](file:///d:/Downloads/salesmanai-salesmanchatbot-25/salesmanai-salesmanchatbot-25/supabase/migrations)-এ যোগ হবে। একই SQL `backend/schema_update.sql`-এ deployment compatibility-এর জন্য append হবে।

#### Chat attribution
`fb_chats` এবং `whatsapp_chats`-এ additive nullable fields:
- `admin_user_id TEXT`
- `admin_email TEXT`

Indexes:
- `fb_chats(page_id, admin_email, created_at DESC)` যেখানে `reply_by = 'admin'`
- `whatsapp_chats(session_name, admin_email, created_at DESC)` যেখানে `reply_by = 'admin'`

পুরনো rows backfill করা হবে না। নতুন fields nullable হওয়ায় old deployment/read path compatible থাকবে।

#### Allocation optimization
`team_order_assignments`-এ owner/resource/member query দ্রুত করার partial index যোগ হবে। বর্তমান primary key `(owner_email, source, resource_id, order_identity)` idempotency key হিসেবে রাখা হবে।

### 2. Shared backend authorization service
নতুন file: `backend/src/services/teamAuthorizationService.js`

Responsibilities:
- email normalize;
- authenticated owner/member relationship resolve;
- active duplicates merge করে legacy resource permission ও granular permissions বের করা;
- Messenger page এবং WhatsApp session owner verify করা;
- owner-এর full access এবং member-এর `module.action` + allowed resource check করা;
- orders-এর ক্ষেত্রে `view_all` বনাম `view_assigned` scope return করা;
- untrusted `team_owner` শুধু DB-verified workspace hint হিসেবে গ্রহণ করা; user input দিয়ে owner নির্বাচন করা যাবে না।

`teamRoutes.js` helperগুলো এই shared service import করবে, যাতে permission validation/merge behavior এক জায়গায় থাকে। Public Team API behavior বজায় থাকবে।

### 3. Backend endpoint permission enforcement

#### Messenger: `backend/src/routes/messengerRoutes.js`
- conversations/messages/chats read: `smart_inbox.view` + verified page access।
- labels write ও `/send`: `smart_inbox.reply` + verified page access।
- stats: `smart_inbox.analytics` + verified page access।
- order list: verified page access + `orders.view_all` অথবা `orders.view_assigned` filter।
- order status/manual assignment actions: `orders.assign` + scope check।
- any guessed page ID, manipulated owner header, or other business page access deny হবে।

#### WhatsApp: `backend/src/routes/whatsappRoutes.js`
- existing `hasSessionAccess()` shared authorization service দিয়ে replace হবে।
- messages/conversations read: `smart_inbox.view`।
- send/labels: `smart_inbox.reply`।
- orders read: `orders.view_all` অথবা `orders.view_assigned` assignment filter।
- order status update: target order-এর session resolve করে permission/resource/assignment scope check বাধ্যতামূলক।

#### Other module routes
Repository route discovery অনুযায়ী Conversion, AI settings এবং Control Panel-এর API routes-এ একই service দিয়ে:
- read → `.view`
- mutation → `.manage`
apply করা হবে। কোন request কোন module-এর resource owner/workspace ব্যবহার করে তা route-level mapping-এ explicit থাকবে।

### 4. Save-time human reply attribution

#### Messenger
`POST /send`-এ image এবং text উভয় `dbService.saveFbChat()` call-এ:
- `admin_user_id: req.user.id`
- `admin_email: normalized req.user.email`
pass করা হবে।

#### WhatsApp
সংশ্লিষ্ট `/send` flow-তে একই actor data `saveWhatsAppChat()` call-এ pass করা হবে।

#### db service
`saveFbChat()` এবং `saveWhatsAppChat()`:
- নতুন columns insert করবে;
- duplicate message/upsert হলে webhook echo যেন existing human actor metadata মুছে না দেয় সেজন্য `COALESCE(EXCLUDED.admin_email, existing.admin_email)` ধরনের conflict update ব্যবহার করবে;
- bot/AI/system writes actor fields null রাখবে।

### 5. বাস্তব Team Analytics API
`backend/src/routes/teamRoutes.js`-এর `GET /analytics` বাস্তব aggregate return করবে।

Input: `period=today|7d|30d`.

Data rules:
1. Owner-এর Messenger pages এবং WhatsApp sessions DB join দিয়ে scope হবে।
2. `reply_by = 'admin'` only।
3. Team member row: `admin_email` active team member-এর canonical email হলে member-wise count।
4. Owner row: `admin_email = owner_email` হলে আলাদা `owner_replies`।
5. Unknown/legacy actor: `unattributed_replies`।
6. Duplicate event পুনরায় গণনা হবে না, কারণ chat write path stable message identity ব্যবহার করবে।

Response contract frontend-এর সাথে একীভূত হবে:
```json
{
  "period": "7d",
  "kpis": [
    { "label": "Team replies", "value": 42 },
    { "label": "Owner replies", "value": 5 },
    { "label": "Active responders", "value": 3 }
  ],
  "members": [
    { "member_email": "member@example.com", "replies": 12, "percentage": 28.6 }
  ],
  "activity": [
    { "date": "2026-08-18", "replies": 8 }
  ],
  "owner_replies": 5,
  "unattributed_replies": 0,
  "attribution_available": true
}
```

Admin API calls owner-wide analytics পাবে না। Restricted member-এর own analytics কেবল `smart_inbox.analytics=true` হলে তার নিজের row/series-এ সীমিত থাকবে; অন্য members বা owner data return করা হবে না।

### 6. Transaction-safe automatic order allocation
নতুন file: `backend/src/services/teamOrderAllocationService.js`.

#### Owner/resource resolution
- Messenger: `page_id` থেকে page owner resolve।
- WhatsApp: `session_name` থেকে session owner resolve।
- Team setting `mode !== 'equal_share'` হলে allocation record লিখবে না।

#### Candidate selection
1. Active team member list canonical email দিয়ে load।
2. `team_order_settings.batch_size` মোট active capacity হিসেবে ব্যবহার।
3. active target quota = deterministic `distributeOrderQuotas(batch_size, sorted members)`।
4. active assigned workload count হবে assignment join করে শুধুমাত্র underlying order যার status `ongoing|pending`। `delivered|locked|cancelled` active workload-এ গণনা হবে না।
5. quota-র নিচে lowest active workload member select। tie-break `member_email ASC`।
6. সবাই quota full হলে `overflow=false` অবস্থায় `member_email=NULL` দিয়ে unassigned assignment row লিখবে।

#### Concurrency/idempotency
- Platform order insert এবং allocation একই PostgreSQL transaction-এ হবে।
- একই owner/source/resource lane-এ `pg_advisory_xact_lock` ব্যবহার করে simultaneous order allocation serialise হবে।
- assignment insert `ON CONFLICT ... DO NOTHING` ব্যবহার করবে; duplicate retry existing assignment ফেরত দেবে।
- existing smart-merge/update path allocator trigger করবে না।
- allocation failure হলে নতুন order এবং assignment উভয় rollback হবে; outbound notification commit-এর পরে চলবে।

#### db write integration
- `saveOrderTracking()` এবং `saveWhatsAppOrderTracking()` transaction-capable করে refactor হবে অথবা `orderService.orchestrateOrder()` এক shared transaction client ব্যবহার করে platform order write ও allocator call করবে।
- নতুন order result সর্বত্র canonical `{ order, created: true|false }` shape হবে।
- Messenger/WhatsApp পুরনো save API callers compatibility-এর জন্য existing fields retain করবে।

### 7. Order visibility and assignment endpoints

#### Read paths
Messenger ও WhatsApp orders listing-এ `team_order_assignments` left join হবে এবং response-এ `assigned_member_email` থাকবে।

- Owner / `orders.view_all`: সব scoped business order।
- `orders.view_assigned`: authenticated member-এর `assigned_member_email`-এর order মাত্র।
- কোনো order assignment না থাকলে member সেটি দেখতে পাবে না।

#### Owner actions
Team routes-এ owner-only explicit API যোগ হবে:
- `GET /api/teams/orders?member_email=...` — owner-এর scoped assignment view।
- `PUT /api/teams/orders/:source/:resourceId/:orderIdentity/assignment` — manual assign/unassign, target member active কিনা verify করে।

Manual assignment existing order automatically move করবে না; owner-এর explicit action ছাড়া কোনো reassignment হবে না।

### 8. Frontend permission state, navigation, route guards

Files:
- `src/context/MessengerContext.tsx`
- `src/context/WhatsAppContext.tsx`
- `src/components/dashboard/DashboardSidebar.tsx`
- `src/App.tsx`
- `src/pages/dashboard/TeamManagementPage.tsx`

Changes:
1. selected workspace-এর `/api/teams/me` permissions থেকে shared hook/context তৈরি।
2. Sidebar-এ unauthorized module links/actions hide।
3. `RequireModulePermission` route wrapper direct URL access block করে explicit forbidden screen/allowed landing-এ নেয়।
4. Team Management link ও route owner-only।
5. Smart Inbox send button, order mutation buttons, settings mutation controls permission অনুযায়ী hide/disable।
6. Team Management UI-তে analytics API-এর real `kpis/members/activity` render হবে; unavailable analytics বা empty data-তে fake numbers নয়।
7. Member’s assigned order view only backend-filtered data ব্যবহার করবে; frontend filter security mechanism হবে না।

## Test পরিকল্পনা

### Backend unit/API tests
বর্তমান `backend/test/teamRoutes.test.js` প্রসারিত এবং প্রয়োজনমতো নতুন test files যোগ হবে। Node built-in `node:test` ব্যবহার হবে।

1. Authorization:
   - owner full access;
   - inactive member deny;
   - member without resource access deny;
   - `smart_inbox.view` read allow কিন্তু `reply=false` send deny;
   - `orders.view_assigned` অন্য member order দেখতে না পারে;
   - `orders.view_all` scoped team orders দেখতে পারে;
   - forged `team_owner` header/query deny;
   - Messenger ও WhatsApp status update cross-business deny।

2. Attribution/analytics:
   - text এবং image send actor user id/email persist করে;
   - bot/customer/system exclude;
   - duplicate webhook same message পুনরায় count করে না;
   - owner reply আলাদা metric;
   - member reply member-name/email row;
   - analytics period boundary;
   - restricted admin কেবল own analytics।

3. Allocation:
   - 100 capacity/5 active member = 20 target each;
   - 1000 capacity/5 = 200 target each;
   - completed/delivered/cancelled assignment active workload কমায়;
   - deterministic least-loaded selection;
   - existing merged order নতুন assignment পায় না;
   - duplicate retry idempotent;
   - full quota হলে unassigned safely retained;
   - concurrent allocation quota exceed করে না;
   - existing order only explicit owner action-এ reassign হয়।

### Frontend validation
- Add member modal valid permission keys পাঠায়, বিশেষত `orders.view_assigned`।
- Team Analytics payload render হয়; empty/error state truthful থাকে।
- Sidebar/route/action permission visibility পরীক্ষা।
- `npm run build:frontend` এবং backend `npm test` সফল।

### Manual acceptance scenario
1. Owner পাঁচটি active member যোগ করেন।
2. Equal-share capacity 100 সেট করেন; প্রতিটি member target 20 দেখেন।
3. নতুন orders এলে তারা lowest active workload member-এ যায়; member কেবল নিজের order দেখে।
4. একটি order delivered করলে পরের নতুন order-এর জন্য সেই member-এর slot available হয়।
5. Owner সব member, সব order এবং assignment দেখতে পারেন।
6. Team member B member A-এর order, permission, team analytics বা Team Management খুলতে পারে না।
7. Owner ও members human reply পাঠান; selected period-এ owner replies আলাদা এবং member replies পৃথক নামসহ আসে।

## Verification
1. Migration staging/production DB-তে apply এবং columns/indexes check।
2. Automated backend tests pass।
3. Frontend production build pass।
4. Owner/member manual scenario চালানো।
5. Direct API tests দিয়ে cross-team resource, order ID, `team_owner` manipulation এবং websocket/event scope deny নিশ্চিত করা।
6. Existing WhatsApp, Messenger, Smart Inbox, orders, AI/control/settings regression smoke-test।

## সীমা
- Legacy chat/order history-তে actor/assignment অনুমান করে backfill করা হবে না।
- Email invitation delivery এই scope-এ নয়; existing member creation workflow database membership create করে।
- Websocket analytics events কেবল existing event architecture audit করার পরে permission-scoped করা হবে; নতুন event type প্রয়োজন হলে backend authorization service ব্যবহার বাধ্যতামূলক।
