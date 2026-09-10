# Instagram Backend Completion Plan

## Summary
Instagram-ke Facebook/Messenger theke logical-vabe separate platform hisebe complete kora hobe. Current code-e Instagram route/page alada thakleo backend-er storage, token naming, service layer, OAuth mobile flow, webhook config onek jaygay Facebook/Messenger infrastructure-er sathe coupled. Plan-er main goal:

1. User `/dashboard` theke Instagram select korbe.
2. User `/dashboard/instagram/integration` e giye Meta login diye Instagram Professional account auto-connect korbe.
3. Instagram connect hole shudhu Instagram account-i connected hobe; Facebook Messenger page connected hobe na.
4. Instagram-er account/config/webhook/send flow Messenger-er moto complete hobe, but platform boundary clear thakbe.

## Current State Analysis

### Facebook/Messenger complete pattern
- Backend route mounted in [app.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/app.js).
- Messenger backend route [messengerRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/messengerRoutes.js) has:
  - `GET /pages` for connected pages.
  - `POST /pages/manual` for selected page persistence.
  - Page token verify, page subscribe, config create/update.
  - `GET /config/:id`, `PUT /config/:id`.
- Auth/OAuth logic in [authController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/authController.js) supports Facebook SDK token exchange and mobile redirect/polling for Messenger/WhatsApp.
- Frontend Messenger route is separate in [App.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/App.tsx#L120-L136), and integration UI is [MessengerIntegrationPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/messenger/MessengerIntegrationPage.tsx).

### Instagram current implementation
- Instagram backend is mounted as `/api/instagram` and implemented in [instagramRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/instagramRoutes.js).
- Instagram frontend route is already separate in [App.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/App.tsx#L138-L154), with its own page [InstagramIntegrationPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/instagram/InstagramIntegrationPage.tsx).
- Instagram webhook controller exists in [instagramController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/instagramController.js).
- Instagram context exists in [InstagramContext.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/context/InstagramContext.tsx).

### Problems found
1. [instagramRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/instagramRoutes.js#L21-L72) creates/uses Facebook-named tables:
   - `page_access_token_message`
   - `fb_message_database`
   - `fb_chats`
   - Adds `platform='instagram'` columns later.
2. [instagramRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/instagramRoutes.js#L87-L109) stores Instagram account ID as `page_id`, but stores Facebook Page access token as `page_access_token`. Linked Facebook page ID is not persisted in the token table.
3. `ON CONFLICT (page_id)` in [instagramRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/instagramRoutes.js#L90-L105) can overwrite/cross-connect rows because uniqueness is only `page_id`, not platform-aware.
4. [messengerRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/messengerRoutes.js#L146-L152) reads all `page_access_token_message` rows for a user without filtering `platform='messenger'`. This is likely why Instagram connect can appear in Facebook/Messenger too.
5. [facebookService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/facebookService.js) contains Instagram send logic, so Instagram messaging is service-level coupled to Facebook.
6. [facebookMobileAuth.ts](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/lib/facebookMobileAuth.ts) supports WhatsApp and Messenger mobile OAuth, but not Instagram.
7. [App.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/App.tsx#L81-L82) has Messenger/WhatsApp OAuth callback routes, but no Instagram callback route.
8. [InstagramIntegrationPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/instagram/InstagramIntegrationPage.tsx#L40-L92) only uses `FB.login`; no mobile redirect/poll fallback like Messenger/WhatsApp.
9. [instagramController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/instagramController.js#L65-L74) looks up Instagram config from Facebook-named tables.
10. [backend/.env.example](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/.env.example) does not document `INSTAGRAM_VERIFY_TOKEN`, although controller supports it.

## Proposed Changes

### 1. Keep user-facing Instagram platform page fully separate
Files:
- [PlatformSelection.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/PlatformSelection.tsx)
- [App.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/App.tsx)
- [InstagramIntegrationPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/instagram/InstagramIntegrationPage.tsx)

Plan:
- Keep existing `/dashboard/instagram/integration` page as the only Instagram connect page.
- Ensure Instagram auto-connect calls only `/api/instagram/pages/auto-connect`.
- Do not reuse Messenger integration route/page for Instagram.
- Add Instagram OAuth callback route: `/auth/facebook/instagram/callback`.

Why:
- User specifically wants Instagram as separate platform/page like Facebook/WhatsApp.

### 2. Stop Instagram accounts from showing/connecting under Facebook Messenger
File:
- [messengerRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/messengerRoutes.js)

Plan:
- In Messenger `GET /pages`, filter token table rows to Messenger only:
  - Include rows where `platform IS NULL`, `platform = 'messenger'`, or legacy rows without platform value.
  - Exclude `platform = 'instagram'`.
- In Messenger page lookup/config flows, keep Messenger access scoped to Messenger rows.
- Do not change Facebook Messenger behavior for existing legacy Messenger pages.

Why:
- Current query can return Instagram rows because it filters only by `email/user_id`, not platform. This directly addresses: “insta id connect korle facebook eo connect hoi eta tik na”.

### 3. Add Instagram-specific backend service layer
New file:
- `backend/src/services/instagramService.js`

Plan:
- Move Instagram Graph API operations from route/controller/Facebook service into this service:
  - Fetch user pages with linked Instagram Professional accounts.
  - Verify Instagram account with token.
  - Subscribe linked Facebook Page for Instagram webhook fields.
  - Send Instagram DM through Graph `/me/messages` using page token.
- Keep Graph version from `FACEBOOK_GRAPH_VERSION` because Meta Graph API is shared, but expose Instagram-named functions.
- Update [instagramController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/instagramController.js) to call `instagramService.sendMessage()` instead of `facebookService.sendInstagramMessage()`.
- Keep `facebookService.sendInstagramMessage()` only if needed temporarily by other code; otherwise remove usage from Instagram controller.

Why:
- Instagram should not depend on `facebookService` for its core backend behavior.

### 4. Create/ensure Instagram-specific DB tables and migrate reads/writes
Main file:
- [instagramRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/instagramRoutes.js)

Plan:
- Replace `ensureInstagramColumns()` shared-table dependency with Instagram-specific tables:
  - `instagram_accounts`
    - `id`
    - `instagram_account_id TEXT NOT NULL`
    - `instagram_username TEXT`
    - `name TEXT`
    - `facebook_page_id TEXT`
    - `page_access_token TEXT`
    - `user_access_token TEXT`
    - `email TEXT`
    - `user_id TEXT`
    - `ai TEXT DEFAULT 'gemini'`
    - `chat_model TEXT DEFAULT 'gemini-2.0-flash'`
    - `cheap_engine BOOLEAN DEFAULT TRUE`
    - `subscription_status TEXT DEFAULT 'active'`
    - unique constraint on `(user_id, instagram_account_id)`
  - `instagram_message_database`
    - `id`
    - `instagram_account_id TEXT NOT NULL`
    - existing Messenger-like config columns needed by AI/control/settings pages: `text_prompt`, `wait`, `image_send`, `image_detection`, `template`, `reply_message`, `order_tracking`, `swipe_reply`, `audio_detection`, `block_emoji`, `unblock_emoji`, `image_prompt`, `check_conversion`, `temperature`, `top_p`
    - unique constraint on `(instagram_account_id)` initially, or `(user_id, instagram_account_id)` if user_id is added to config.
  - `instagram_chats`
    - mirror `fb_chats` fields needed by Instagram inbox/database/control.
    - `message_id TEXT UNIQUE`.
- Update `saveInstagramAccount()` to write only Instagram tables.
- Persist both `instagram_account_id` and `facebook_page_id` during auto-connect.
- Return API shape compatible with frontend:
  - `page_id` should remain as Instagram account ID for now, so existing frontend/context pages do not break.
  - Also include clearer fields: `instagram_account_id`, `instagram_username`, `facebook_page_id`, `db_id`.
- Add a one-time compatibility read fallback only if needed:
  - If no rows exist in new Instagram tables, optionally read old `page_access_token_message/platform='instagram'` rows and insert them into new tables when `/api/instagram/pages` runs.
  - This fallback should not write Facebook/Messenger rows.

Why:
- Separate tables remove accidental Facebook/Messenger coupling and make Instagram a first-class platform.

### 5. Update Instagram config/webhook/chat reads to use Instagram tables
Files:
- [instagramRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/instagramRoutes.js)
- [instagramController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/instagramController.js)
- [dbService.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/services/dbService.js)

Plan:
- Change Instagram `/pages`, `/config/:id`, `/config/:id` update, delete, smart inbox/media/conversation endpoints to use Instagram-specific tables.
- Add Instagram-specific dbService methods if current generic `saveFbChat/getFbChatHistory` cannot target `instagram_chats` cleanly:
  - `saveInstagramChat()`
  - `getInstagramChatHistory()`
  - any minimal helpers needed by controller.
- In [instagramController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/instagramController.js), update `getInstagramConfig()` to join `instagram_accounts` + `instagram_message_database`.
- Save incoming/outgoing Instagram messages into `instagram_chats`.
- Keep AI generation input `platform: 'instagram'` unchanged.

Why:
- Webhook and AI reply flow must be fully Instagram-owned, not `fb_*` owned.

### 6. Complete Instagram auto-connect flow same pattern as Messenger
Files:
- [authController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/authController.js)
- [authRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/authRoutes.js)
- [facebookMobileAuth.ts](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/lib/facebookMobileAuth.ts)
- [InstagramIntegrationPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/instagram/InstagramIntegrationPage.tsx)
- New file: `src/pages/auth/FacebookInstagramCallbackPage.tsx`
- [App.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/App.tsx)

Plan:
- Backend [authController.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/controllers/authController.js):
  - Add `type === 'instagram'` branch in `startFacebookAuth`.
  - Use redirect URI `/auth/facebook/instagram/callback`.
  - Use Instagram scopes:
    - `email`
    - `public_profile`
    - `pages_show_list`
    - `pages_read_engagement`
    - `pages_manage_metadata`
    - `pages_messaging`
    - `instagram_basic`
    - `instagram_manage_messages`
    - `business_management`
  - Reuse existing `facebook_pending_auths`, `pollFacebookAuth`, and `callback-persist` pattern.
- Backend [authRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/authRoutes.js):
  - Add `POST /facebook/instagram/complete-code` if current Messenger complete-code response is not suitable for Instagram.
  - The endpoint should exchange code and return a long-lived token or token usable by `/api/instagram/pages/auto-connect`.
- Frontend [facebookMobileAuth.ts](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/lib/facebookMobileAuth.ts):
  - Add `INSTAGRAM_MOBILE_CALLBACK_KEY`.
  - Add `INSTAGRAM_MOBILE_FLOW_STATE_KEY`.
  - Add `getInstagramMobileRedirectUri()`.
  - Add `beginInstagramMobileOAuth()` using `/api/auth/facebook/start?type=instagram`.
- New frontend callback page:
  - Copy Messenger callback pattern from [FacebookMessengerCallbackPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/auth/FacebookMessengerCallbackPage.tsx).
  - Store callback payload under Instagram keys.
  - Redirect back to `/dashboard/instagram/integration`.
- [App.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/App.tsx):
  - Import and register `/auth/facebook/instagram/callback`.
- [InstagramIntegrationPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/instagram/InstagramIntegrationPage.tsx):
  - Keep desktop `FB.login` flow.
  - Add mobile redirect flow like Messenger.
  - After callback/code, exchange token and call `/api/instagram/pages/auto-connect`.

Why:
- Instagram will support start-to-end connect on desktop and mobile like Facebook/Messenger/WhatsApp.

### 7. Make Instagram manual connect clear and platform-safe
File:
- [InstagramIntegrationPage.tsx](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/src/pages/dashboard/instagram/InstagramIntegrationPage.tsx)
- [instagramRoutes.js](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/src/routes/instagramRoutes.js)

Plan:
- Keep manual connect as fallback.
- Backend manual route should verify Instagram account ID using token via Instagram service.
- Manual save should write only `instagram_accounts` and `instagram_message_database`.
- UI labels should clarify:
  - Instagram Professional Account ID.
  - Page Access Token for the linked Facebook Page, used only for Instagram Messaging API.

Why:
- Manual connect should not create/modify Facebook Messenger page rows.

### 8. Document Instagram env requirement
File:
- [backend/.env.example](file:///c:/Users/autom/Downloads/salesmanai-salesmanchatbot-22/salesmanai-salesmanchatbot-22/backend/.env.example)

Plan:
- Add `INSTAGRAM_VERIFY_TOKEN`.
- Keep existing `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_GRAPH_VERSION` because Meta OAuth/Graph still uses Facebook app credentials.

Why:
- Webhook setup is incomplete without visible Instagram verify token config.

## Assumptions & Decisions

1. Instagram will remain under Meta/Facebook OAuth because Instagram Professional Messaging API requires Meta Graph and linked Facebook Page tokens.
2. “Separate platform” means separate route/page/service/storage boundaries, not a separate Meta app.
3. Existing frontend route `/dashboard/instagram/integration` stays as the Instagram selection/connect page.
4. API compatibility will keep returning `page_id` as Instagram account ID so current Instagram frontend pages continue working while backend gains clearer fields.
5. The immediate bug “Instagram connect hole Facebook-o connect hoy” will be fixed by Messenger queries excluding `platform='instagram'` and by moving new Instagram writes out of Facebook token/config tables.
6. No unrelated refactor or UI redesign will be done.

## Verification Steps

1. Backend static verification:
   - Confirm Instagram route no longer writes new records to `page_access_token_message` or `fb_message_database` for auto/manual connect.
   - Confirm Messenger `GET /pages` excludes Instagram rows.
   - Confirm Instagram webhook controller reads from Instagram tables and sends via Instagram service.

2. Frontend static verification:
   - Confirm `/dashboard` Instagram selection still navigates to `/dashboard/instagram/integration`.
   - Confirm `/auth/facebook/instagram/callback` route exists.
   - Confirm Instagram integration uses `/api/instagram/pages/auto-connect`, not Messenger endpoints.

3. Runtime/manual test:
   - Login as user.
   - Select Instagram from platform selection.
   - Click Connect with Meta.
   - Complete permissions.
   - Verify `/api/instagram/pages` returns connected Instagram account.
   - Verify `/api/messenger/pages` does not show that Instagram account.
   - Open Instagram control/settings/database pages and confirm selected Instagram account works.

4. Mobile OAuth test:
   - Open Instagram integration page on mobile browser.
   - Start Meta connect.
   - Confirm callback returns to `/dashboard/instagram/integration`.
   - Confirm account auto-connect completes after callback/poll.

5. Webhook test:
   - Configure Instagram webhook verify token with `INSTAGRAM_VERIFY_TOKEN`.
   - Verify webhook challenge succeeds.
   - Send an Instagram DM.
   - Confirm inbound chat is saved in Instagram chat storage and AI reply sends via Instagram service.
