# Comment Hide Rules Plan

## Summary

Comment Automation-er current `Hide Comments` toggle ekhono binary: ON hole oi post-er sob comment hide hoy. User-er requirement holo global + per-post hide rule add kora, jekhane keyword matching ebong AI instruction duita diye decide hobe comment hide hobe kina.

Ei plan implement korle user UI theke command dite parbe:

- Global level: sob post-er jonno common hide keywords/instruction
- Per post level: specific post-er jonno extra/override hide keywords/instruction
- Keyword + AI decision: keyword match hole hide, ba AI instruction onujayi comment risky/targeted hole hide

Auto order feature add kora hobe na.

## Current State Analysis

### Backend current state

1. Main automation service:
   - `backend/src/services/commentAutomationService.js`
   - Table creation/migration `ensureTables()` er moddhe ache.
   - `comment_automation_configs` table currently fields:
     - `platform`, `account_id`, `enabled`, `system_prompt`
   - `social_post_product_mappings` table currently fields:
     - post info, product ids, active toggle
     - `auto_like`, `auto_like_children_comment`
     - `auto_reply`, `auto_reply_children_comment`
     - `auto_hidden`, `auto_comment`
     - `prompt_comment`
   - Incoming comment flow `processCommentAutomationEvent()` e line-er current logic:
     - `shouldLike` toggle based
     - `shouldReply` toggle based
     - `shouldHide = Boolean(mapping.auto_hidden)`
   - So currently keyword/prompt based hide decision nei.

2. Facebook hide API:
   - `backend/src/services/facebookService.js`
   - `hideComment(commentId, accessToken, hidden = true)` Graph API te `is_hidden: true` POST kore.
   - Ei helper already working, change needed nei.

3. Messenger API routes:
   - `backend/src/routes/messengerRoutes.js`
   - Existing endpoints:
     - `GET /api/messenger/comment-automation/:pageId`
     - `PUT /api/messenger/comment-automation/:pageId`
     - `GET /api/messenger/post-mappings/:pageId`
     - `POST /api/messenger/post-mappings/:pageId`
     - `POST /api/messenger/post-mappings/:pageId/sync`
     - `GET /api/messenger/comment-automation/:pageId/events`
   - Routes already call `commentAutomationService`, so mostly service-layer schema/update changes enough.

4. Instagram API routes:
   - `backend/src/routes/instagramRoutes.js`
   - Existing comment automation config/mapping endpoints use same `commentAutomationService`.
   - Same schema changes automatically apply for Instagram mappings too.

### Frontend current state

1. Main UI:
   - `src/components/dashboard/CommentAutomationSettings.tsx`
   - `Config` type currently:
     - `enabled`, `system_prompt`
   - `Mapping` type currently:
     - post fields + automation booleans + `prompt_comment`
   - Global AI Prompt card exists for reply generation.
   - Post cards are mobile-first compact/collapsible.
   - Existing post rules include `Hide Comments`, but no hide keywords/instruction fields.
   - `saveConfig()` sends global config.
   - `saveMapping()` sends full mapping object.

2. Current UX issue to solve
   - User does not know where to write hide instructions.
   - `Global AI Prompt` and `Comment Reply Prompt` are reply-related, so hide rules need a separate professional UI section.

## Proposed Changes

### 1. Backend schema: add global hide rules

File: `backend/src/services/commentAutomationService.js`

Add columns in `comment_automation_configs` table and migration:

- `hide_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`
- `hide_ai_instruction TEXT NOT NULL DEFAULT ''`
- `hide_ai_enabled BOOLEAN NOT NULL DEFAULT FALSE`

Why:
- Global hide rules should apply to all active post mappings under one page/account.
- User selected `Global + per post`.

How:
- Update `CREATE TABLE IF NOT EXISTS comment_automation_configs`.
- Update `ALTER TABLE comment_automation_configs ADD COLUMN IF NOT EXISTS ...`.
- Update `getConfig()` SELECT to return these fields.
- Update `updateConfig()` to parse and save these fields while preserving existing values if omitted.

### 2. Backend schema: add per-post hide rules

File: `backend/src/services/commentAutomationService.js`

Add columns in `social_post_product_mappings` table and migration:

- `hide_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`
- `hide_ai_instruction TEXT NOT NULL DEFAULT ''`
- `hide_ai_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- `hide_match_mode TEXT NOT NULL DEFAULT 'keyword_or_ai'`

Allowed `hide_match_mode` values will be handled in code:

- `all`: current behavior, hide every comment when `auto_hidden` is ON
- `keyword_or_ai`: hide if keyword matches OR AI says hide
- `keyword_only`: hide only keyword matches
- `ai_only`: hide only AI says hide

Why:
- Per-post rule gives precise control for 100+ contents.
- Keeps current `auto_hidden` as the main enable/disable switch for hiding.

How:
- Update `CREATE TABLE IF NOT EXISTS social_post_product_mappings`.
- Update `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Update `upsertMapping()` insert/update fields and values.
- Update `syncFacebookPosts()` to preserve existing hide rule fields during sync.

### 3. Backend hide decision evaluator

File: `backend/src/services/commentAutomationService.js`

Add helper functions:

- `normalizeKeywords(value)`
  - Accept array/string.
  - Trim, lowercase, remove empty.

- `keywordMatches(commentText, keywords)`
  - Case-insensitive matching.
  - Bangla/English simple substring matching.

- `buildHidePrompt({ commentText, postId, isReplyComment, caption, globalInstruction, postInstruction, matchedKeywords })`
  - AI-ke only JSON return korte bolbe.
  - Expected JSON shape:
    - `{ "hide": true/false, "reason": "short reason" }`

- `parseHideDecision(value)`
  - AI response theke JSON parse try korbe.
  - Parse fail hole safe default `{ hide: false, reason: 'ai_parse_failed' }`.

- `evaluateHideRules({ config, mapping, commentText, postId, isReplyComment })`
  - If `mapping.auto_hidden` false: no hide.
  - If `hide_match_mode === 'all'`: hide all, preserving current behavior intentionally only when selected.
  - Combine global + post keywords.
  - Keyword decision first.
  - If AI enabled globally or post-level enabled, call `aiService.generateResponse()` with strict moderation prompt.
  - Final decision based on mode.
  - Return:
    - `shouldHide`
    - `reason`
    - `matchedKeywords`
    - `mode`
    - `aiHide`
    - `aiReason`

Important behavior:
- No AI call if AI hide is disabled.
- No AI call if mode is `keyword_only`.
- `auto_hidden` remains the master hide switch for that post.
- Empty keywords + AI disabled means no hide unless mode is `all`.

### 4. Backend process flow update

File: `backend/src/services/commentAutomationService.js`

Change in `processCommentAutomationEvent()`:

Current:

```js
const shouldHide = Boolean(mapping.auto_hidden);
```

Replace with:

```js
const hideDecision = await evaluateHideRules({ config, mapping, commentText, postId, isReplyComment });
const shouldHide = hideDecision.shouldHide;
```

Update `decision` JSON to include:

- `hide_mode`
- `hide_reason`
- `hide_matched_keywords`
- `hide_ai_enabled`
- `hide_ai_reason`

Why:
- Audit e clear hobe kon karone comment hide holo.

### 5. Frontend types/default state

File: `src/components/dashboard/CommentAutomationSettings.tsx`

Update `Config` type:

- `hide_keywords: string[]`
- `hide_ai_instruction: string`
- `hide_ai_enabled: boolean`

Update `Mapping` type:

- `hide_keywords?: string[]`
- `hide_ai_instruction?: string`
- `hide_ai_enabled?: boolean`
- `hide_match_mode?: 'all' | 'keyword_or_ai' | 'keyword_only' | 'ai_only'`

Update `defaultConfig` and `emptyMapping()` defaults:

- global keywords empty
- global AI instruction empty
- global AI disabled false
- per-post hide mode `keyword_or_ai`
- per-post keywords empty
- per-post AI instruction empty
- per-post AI disabled false

Add helper:

- `updateKeywords(value: string): string[]`
  - comma/newline split
  - trim and remove empty

### 6. Frontend global hide rules card

File: `src/components/dashboard/CommentAutomationSettings.tsx`

Add a new card separate from Global AI Prompt:

Title: `Global Hide Rules`

Fields:

- `Hide Keywords`
  - Textarea
  - Placeholder: `price, দাম কত, inbox price, fake, বাজে`
  - Helper text: comma or new line separated keywords.

- `Use AI Hide Decision`
  - Switch
  - Enables global AI instruction based moderation.

- `Global Hide Instruction`
  - Textarea
  - Example placeholder: `Hide comments asking for price, abusive language, competitor promotion, or spam. Do not hide genuine product questions unless they match this policy.`

Save:
- Existing `saveConfig()` button will save these fields with config.

Why:
- User should not write hide rules inside reply prompt.
- Global rule helps manage 100+ posts without repeating same keywords.

### 7. Frontend per-post Hide Rules card

File: `src/components/dashboard/CommentAutomationSettings.tsx`

Inside manual add section and existing post expanded section, add a separate `Hide Rules` card under Automation Rules.

Fields:

- `Hide Comments` switch remains as enable/disable for hiding.
- `Hide Mode` selector/button group:
  - `All`
  - `Keyword or AI`
  - `Keyword only`
  - `AI only`
- `Post Hide Keywords`
  - Textarea
  - comma/newline separated
- `Use AI for this post`
  - Switch
- `Post Hide Instruction`
  - Textarea

UX rules:
- If `Hide Comments` OFF, show fields disabled/muted or helper: `Turn on Hide Comments to use these rules.`
- Keep mobile layout single-column.
- Keep desktop layout 2 columns when enough space.
- Do not put hide instructions inside `Comment Reply Prompt`.

Why:
- Clear separation:
  - Reply prompt = public reply writing
  - Hide rules = moderation decision

### 8. Frontend load/save payload updates

File: `src/components/dashboard/CommentAutomationSettings.tsx`

Update `load()` mapping/config normalization:
- Ensure arrays are arrays.
- Ensure default hide mode is `keyword_or_ai`.
- Ensure booleans default false.

Update `saveConfig()` body:

- `enabled`
- `system_prompt`
- `hide_keywords`
- `hide_ai_instruction`
- `hide_ai_enabled`

`saveMapping()` already sends full mapping object; after type/state fields are added, no endpoint change needed.

### 9. Audit visibility

File: `src/components/dashboard/CommentAutomationSettings.tsx`

Update event card to show hide reason when available:

- `Hide reason: keyword_match / ai_hide / all_comments / no_rule_match`
- `Matched: keyword1, keyword2`

Data source:
- Existing `event.decision` JSON.

Why:
- User can understand why a comment was hidden or skipped.

## Assumptions & Decisions

1. `auto_hidden` stays as the main per-post hide enable switch.
2. Global hide rules do not hide comments by themselves if the post’s `auto_hidden` is OFF. This prevents accidental hiding across all posts.
3. Global keywords/instruction are combined with per-post keywords/instruction when post hide is enabled.
4. `keyword_or_ai` will be default mode for new posts.
5. `all` mode preserves old behavior but only when selected.
6. AI hide decision should be conservative:
   - If AI response cannot be parsed, do not hide.
   - If AI errors, do not hide, but save error in audit if hide attempt was expected.
7. No auto order logic will be added.
8. Existing API routes remain the same.
9. Post sync must preserve existing hide settings, same as current toggle preservation behavior.

## Verification Steps

### Frontend

1. Run TypeScript diagnostics for:
   - `src/components/dashboard/CommentAutomationSettings.tsx`
2. Run frontend build:
   - `npm run build`
3. Manual UI checks:
   - Global Hide Rules card visible.
   - Manual Add Post has Hide Rules card.
   - Existing post expanded card has Hide Rules card.
   - Mobile width layout remains usable.
   - Save global config preserves hide keywords/instruction.
   - Save post mapping preserves per-post hide keywords/instruction.

### Backend

1. Syntax check:
   - `node -c backend/src/services/commentAutomationService.js`
   - `node -c backend/src/services/facebookService.js`
   - `node -c backend/src/routes/messengerRoutes.js`
   - `node -c backend/src/routes/instagramRoutes.js`
2. DB migration behavior:
   - Existing tables should add new columns automatically through `ensureTables()`.
3. Functional checks:
   - `auto_hidden = false`: no hide, even if global keyword matches.
   - `auto_hidden = true`, mode `all`: every comment hidden.
   - `auto_hidden = true`, mode `keyword_only`: only matching keywords hidden.
   - `auto_hidden = true`, mode `ai_only`: AI decision controls hide.
   - `auto_hidden = true`, mode `keyword_or_ai`: keyword match or AI true hides.
4. Audit checks:
   - `decision.hide_reason` exists.
   - `decision.hide_matched_keywords` exists.
   - `moderation_status` becomes `hidden` only when Facebook hide API succeeds.

## Implementation Order

1. Update backend schema/config/mapping persistence in `commentAutomationService.js`.
2. Add hide rule evaluator helpers in `commentAutomationService.js`.
3. Replace binary `shouldHide` logic with evaluator.
4. Preserve hide rules inside `syncFacebookPosts()`.
5. Update frontend types/defaults/load/save in `CommentAutomationSettings.tsx`.
6. Add `Global Hide Rules` card.
7. Add per-post/manual `Hide Rules` card.
8. Add audit hide reason display.
9. Run diagnostics/build/syntax checks.
10. Commit and push only if user requests or after execution confirms commit/push is desired.