# WhatsApp Bot Off Seen Receipt Fix Plan

## Summary

WhatsApp bot off thakleo customer message `seen/read` hoye jacche. Eta customer-er jonno confusing, karon bot reply dicche na kintu message seen dekhacche. Plan holo WhatsApp flow-ke Messenger-er moto kora: bot jodi disabled/blocked/skipped hoy, tahole read receipt ba typing indicator pathano hobe na. Read/typing sudhu tokhon pathano hobe jokhon bot actually reply pathanor stage-e jay.

## Current State Analysis

### Relevant files explored

- `backend/src/controllers/webhookController.js`
  - Messenger webhook + official WhatsApp Cloud webhook ekhane process hoy.
  - Official WhatsApp-er `processWhatsAppBatch()`-e message save korar por feature flag check-er age `whatsappCloudService.sendSeen(...)` call hoy.
  - Messenger flow-e `facebookService.sendTypingAction(..., 'mark_seen')` final send-er age hoy, `reply_message` / `swipe_reply` disabled check-er pore.

- `backend/src/services/whatsappCloudService.js`
  - `sendSeen(...)` Cloud API-te `status: "read"` pathay.
  - `sendTyping(...)`-o `status: "read"` pathay, sathe `typing_indicator` pathay.

- `backend/src/controllers/whatsappController.js`
  - Legacy/WAHA/WPP-style WhatsApp flow ekhane ache.
  - Main debounced flow-e `reply_message` / `swipe_reply` check-er pore `sendSeen(...)` hoy, so main flow comparatively safe.
  - Kintu semantic cache ultra-fast path-e `sendSeen(...)`, `sendTyping(...)`, `sendMessage(...)` call ache. Ei path feature flag-er age trigger hote pare, tai bot off thakleo seen/reply risk thake.

- `backend/src/services/facebookService.js`
  - Messenger `sendTypingAction(..., 'mark_seen')` final reply path-e use hoy.
  - Messenger behavior target model: bot reply na dile mark_seen korbe na.

- `backend/src/routes/whatsappRoutes.js`
  - WhatsApp config update route-e `reply_message`, `swipe_reply` existing bot control flags hisebe use hoy.
  - New DB field add kora ei fix-er jonno necessary na.

### Root cause

Official WhatsApp Cloud flow-e `sendSeen` feature flag check-er age call hocche:

- `reply_message=false` holeo message first-e read/seen hoye jay.
- `swipe_reply=false` holeo reply-to/swipe message seen hoye jay.
- Poroborti early return-er karone bot reply kore na, but customer dekhe seen.

Legacy/WPP flow-e main path feature flag check-er pore seen kore, but early semantic cache path bot-control bypass korte pare.

## Proposed Changes

### 1. Official WhatsApp Cloud: move/guard early seen receipt

File: `backend/src/controllers/webhookController.js`

What:
- `processWhatsAppBatch()`-er early `whatsappCloudService.sendSeen(...)` block remove/move korte hobe.
- `hasReplyTo`, `isSwipeEnabled`, `isReplyEnabled` calculate korar por disabled hole return korte hobe without seen.
- Seen/typing behavior final reply stage-e existing `sendTyping(...)` call diye handled thakbe, because `sendTyping(...)` already read status pathay.

Why:
- Bot off/disabled hole customer message read dekha jabe na.
- Messenger-er moto mark_seen final send stage-e thakbe.

How:
- Lines around official WhatsApp `// --- ALWAYS MARK SEEN FIRST (like Messenger) ---` block delete korte hobe.
- Comment update kore bujhate hobe: read receipt intentionally delayed until bot is ready to reply.
- Existing feature flag checks unchanged thakbe.
- Existing final `whatsappCloudService.sendTyping(...)` before reply unchanged thakbe, karon eta bot reply-er immediate age read+typing pathay.

### 2. Official WhatsApp Cloud: avoid read when final reply is skipped by admin handover

File: `backend/src/controllers/webhookController.js`

What:
- Final `sendTyping(...)` call-er position verify korte hobe je admin replied / lock / credits skip checks-er pore ache kina.
- Jodi kono skip branch-er age `sendTyping(...)` hoy, seta final send-er closer-e move korte hobe.

Why:
- `sendTyping(...)` Cloud API-te `status: "read"` pathay, so eta-o seen receipt.

How:
- Existing final send area around `AI generated response` and `sendTyping(...)` inspect kore ensure korte hobe je disabled/lock/credit/admin skip return-er pore only actual send path-e call hoy.
- No new helper needed unless duplicate logic creates risk.

### 3. Legacy WAHA/WPP: gate ultra-fast semantic cache path by bot control flags

File: `backend/src/controllers/whatsappController.js`

What:
- `queueMessage()`-er ultra-fast semantic cache path-e cached reply send korar age page config-er `reply_message`/`swipe_reply` respected kina ensure korte hobe.
- Normal text message hole `reply_message=false` thakle cache reply, seen, typing kichui pathabe na.
- Reply-to/swipe message hole `swipe_reply=false` thakle cache reply, seen, typing kichui pathabe na.

Why:
- Main WPP processing flow already feature flag check kore, kintu ultra-fast path bypass korle bot off thakleo seen/reply hote pare.

How:
- Ultra-fast cache block-e `pageConfig` load-er por same boolean logic use korte hobe:
  - `isSwipeEnabled = pageConfig.swipe_reply !== false && pageConfig.swipe_reply !== 'false' && pageConfig.swipe_reply !== 0 && pageConfig.swipe_reply !== '0'`
  - `isReplyEnabled = pageConfig.reply_message !== false && pageConfig.reply_message !== 'false' && pageConfig.reply_message !== 0 && pageConfig.reply_message !== '0'`
- Message reply-to kina determine korte existing payload fields use korte hobe (`replyTo`, `_data.quotedMsgId`, `_data.message.extendedTextMessage.contextInfo.stanzaId`, etc.) or existing extracted context if available in that scope.
- Disabled hole return; no `sendSeen`, no `sendTyping`, no `sendMessage`.

### 4. Legacy WAHA/WPP: keep main flow unchanged except verification

File: `backend/src/controllers/whatsappController.js`

What:
- Main `processBufferedMessages()` flow-e feature flag check already `sendSeen(...)`-er age ache, so unnecessary refactor kora hobe na.
- Existing cache path inside main processing is after feature flag check, so it can remain unless testing shows bypass.

Why:
- Minimal fix; over-engineering avoid.

### 5. Messenger behavior will not be changed

File: `backend/src/controllers/webhookController.js`

What:
- Messenger final `mark_seen` behavior unchanged thakbe.

Why:
- User WhatsApp/WPP-ke Messenger-er moto korte bolechen; Messenger already desired pattern follow korche.

## Assumptions & Decisions

- Existing bot off control holo `reply_message=false` for normal text replies and `swipe_reply=false` for reply-to/postback/swipe replies.
- New global `bot_enabled` DB column add kora hobe na, karon current UI/backend already `reply_message` and `swipe_reply` diye control kore.
- Inbound customer message DB-te save hobe even bot off thakle, so inbox/history thik thakbe.
- Bot off thakle no read receipt, no typing indicator, no bot reply.
- Bot on thakle current behavior maintained: reply-er age read/typing hobe.
- Messenger code only reference model hisebe use hobe; change kora hobe na.

## Verification Steps

1. Static verification
   - Search `webhookController.js` official WhatsApp `processWhatsAppBatch()`-e `sendSeen` feature flag check-er age nei kina confirm korte hobe.
   - Search `whatsappController.js` ultra-fast cache path-e bot-control guard ache kina confirm korte hobe.

2. Manual webhook scenario: Official WhatsApp Cloud
   - WhatsApp config-e `reply_message=false` set kore normal inbound message simulate/test korte hobe.
   - Expected: inbound chat saved, no `sendSeen`, no `sendTyping`, no bot reply.
   - `reply_message=true` kore same test.
   - Expected: bot reply path-e `sendTyping`/read happens before actual reply.

3. Manual webhook scenario: WPP/WAHA
   - `reply_message=false` + semantic cache matchable text send korte hobe.
   - Expected: no cache reply, no seen, no typing.
   - `reply_message=true` kore same message.
   - Expected: cache/normal bot reply works.

4. Swipe/reply scenario
   - `swipe_reply=false` kore reply-to message send korte hobe.
   - Expected: no seen, no typing, no bot reply.

5. Regression check
   - Messenger normal reply still sends `mark_seen` near final send.
   - WhatsApp bot on state still replies normally.
