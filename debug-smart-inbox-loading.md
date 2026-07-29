# Debug Session: smart-inbox-loading

Status: OPEN

## Symptom
Smart Inbox page shows no conversations and browser console reports 500 errors while fetching `/api/messenger/conversations/:pageId`.

## Hypotheses
1. Smart Inbox API route is throwing because required query params/page identifiers are missing or malformed.
2. Backend DB query for Messenger conversations references a missing/renamed column or table.
3. Auth/session middleware passes user/page state differently than SmartInbox expects, causing null access.
4. Response parsing mismatch between frontend SmartInbox and backend route causes failed load state after a 500.
5. Recent Developer API changes are unrelated; issue is isolated to SmartInbox route/controller.

## Evidence Plan
- Locate SmartInbox API calls and matching backend routes.
- Add minimal instrumentation to Smart Inbox backend query utility.
- Reproduce and compare query failure/success logs.

## Changes
- Added temporary network instrumentation in `backend/src/utils/smartInbox.js`.
- Static audit found `getSmartInboxConversations()` applied `platform = 'messenger'` to both `fb_chats` and `fb_order_tracking`.
- Existing schema migrations ensure `platform` on `fb_chats`, but not on `fb_order_tracking`.

## Evidence
- Browser console shows 500 for `/api/messenger/conversations/...`.
- Static schema evidence supports Hypothesis 2: query references a likely missing `fb_order_tracking.platform` column.
- Local backend env is not available, so production runtime log comparison requires deploying/restarting backend with this patch or reproducing against a configured local backend.

## Fix
- Changed Smart Inbox config from shared `platformCondition` to `chatPlatformCondition`.
- `platform` filter now applies only to `fb_chats`.
- `fb_order_tracking` query now filters by `page_id/session_name` only, avoiding missing `platform` column.

## Verification
- `node --check src/utils/smartInbox.js` passed.
- VS Code diagnostics clean.
- Needs user/deploy verification on the environment where 500 is happening.
