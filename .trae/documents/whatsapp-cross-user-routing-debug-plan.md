# WhatsApp cross-user routing debug plan

## Summary
User reported that WhatsApp bot may be replying with one customer's context/message to another customer. The implementation must first collect reproducible runtime evidence, then apply the smallest evidence-backed fix.

## Current state analysis

- Official webhook processing normalizes customer identity in `backend/src/controllers/webhookController.js`. It prioritizes `message.from`, but falls back to `contacts[0]` if no matching `wa_id` exists. This can associate profile metadata from a different contact when a payload has multiple contacts or lacks `message.from`.
- The outbound bot recipient currently prioritizes `rawSenderId`, which is the correct direct target in normal Meta payloads. The debounce key also includes sender + session, so normal inbound batches should not merge different users.
- `getWhatsAppChatHistory()` in `backend/src/services/dbService.js` uses a broad predicate including `sender_id = sessionName` or `recipient_id = sessionName`. Since bot replies are stored with `sender_id = sessionName`, a customer's AI prompt can include bot replies sent to other customers in the same session. This is the leading cross-user context leakage candidate.
- Successful bot message persistence in `webhookController.js` uses `recipient_id: senderId`, but the actual Cloud API destination is `replyRecipientId`. When identity fallbacks differ, delivery and stored conversation identity can diverge.
- WhatsApp config lookup in `dbService.js` can match `session_name`, `waba_id`, or `phone_number_id` and selects one row with `LIMIT 1`. There is no explored uniqueness guarantee for `waba_id`/`phone_number_id`, which can cause an incorrect business configuration to be selected if duplicate integrations exist.
- Manual Smart Inbox sending in `backend/src/routes/whatsappRoutes.js` accepts a `to` supplied by the client without validating that it belongs to a conversation in the requested session. This can send a human message to the wrong customer on a stale/mismatched UI selection, but is separate from bot reply routing.

## Evidence hypotheses

1. **Cross-customer chat history**: `getWhatsAppChatHistory()` returns assistant rows belonging to other customers in the same session. Evidence: runtime history query/results contain more than one customer recipient ID for the active conversation.
2. **Identity fallback mismatch**: inbound `rawSenderId`, normalized conversation ID, and resolved outbound recipient differ for a Meta webhook. Evidence: instrumentation records non-equal values for one message/batch.
3. **Wrong config selection**: a webhook phone number/WABA lookup resolves a config whose stored phone/WABA does not match the webhook metadata. Evidence: runtime logs record mismatched incoming vs resolved IDs.
4. **Persistence mismatch**: an outbound bot delivery target differs from the `recipient_id` saved in `whatsapp_chats`. Evidence: send/persist logs record different normalized values.
5. **Manual inbox target mismatch**: Smart Inbox sends to a recipient that has no matching conversation under its selected session. Evidence: endpoint instrumentation reports absent/mismatched session-conversation association.

## Proposed changes

### 1. Add temporary runtime instrumentation only
**Files:**
- `backend/src/controllers/webhookController.js`
- `backend/src/services/dbService.js`
- `backend/src/routes/whatsappRoutes.js`

**How:**
- Create the mandatory debug session record before any code diff and run the local debug collector.
- Add minimal network-based debug events (no `console.log`) around inbound identity normalization, config resolution, queued batch processing, outbound Cloud send, and chat persistence.
- Add instrumentation around `getWhatsAppChatHistory()` recording only hashed/redacted IDs, session key, returned message ownership/count, and whether a row belongs to the active pair.
- Add Smart Inbox instrumentation recording the selected session and redacted recipient plus whether that recipient exists in the session conversation data.
- Do not alter routing or SQL logic at this phase.

### 2. Reproduce and analyze the evidence
**Files:** no business logic changes.

**How:**
- Deploy the instrumentation build to the test environment / Coolify branch only after it is committed and pushed on request.
- Send interleaved messages from at least two separate WhatsApp customers to the same business number, including text and image flow.
- Query the debug collector and correlate each inbound message ID, normalized recipient, selected config, AI history membership, Cloud API target, and saved `recipient_id`.
- Mark each hypothesis confirmed or rejected in the debug session record.

### 3. Apply the minimal confirmed fixes
**Likely files:**
- `backend/src/services/dbService.js`
- `backend/src/controllers/webhookController.js`
- `backend/src/routes/whatsappRoutes.js` only if hypothesis 5 is confirmed.

**Fix decisions (apply only if evidence confirms):**
- Replace the broad chat-history predicate with a strict customer/session conversation-pair predicate, matching the existing pairwise approach used by `getLastNWhatsAppMessages()`.
- Reject unsafe identity fallback: do not use `contacts[0]` unless it is the only contact; preserve `message.from` as the required Cloud API reply target.
- Persist outbound bot replies with the actual normalized `replyRecipientId`, not a potentially different fallback identity.
- Make config selection require/match the actual `phone_number_id` from the webhook where available; add a deterministic duplicate-conflict guard rather than silently choosing a random integration row.
- Validate Smart Inbox `to` against the session's existing conversation/contact before sending, if manual send mismatch is observed.

### 4. Verify the fix
**Files:** the modified files above.

**How:**
- Repeat the two-customer interleaved test and compare post-fix debug events against pre-fix events.
- Confirm every AI history row belongs only to its active customer pair.
- Confirm every outbound `to` equals the inbound raw sender ID for the correlated webhook.
- Confirm stored outbound `recipient_id` equals the actual Cloud send target.
- Run relevant backend tests/lint if available, and perform a syntax/module-load check for modified Node.js files.

### 5. Cleanup after confirmation
- Keep instrumentation and debug artifacts until the user confirms the issue is fixed.
- Then remove instrumentation, stop the debug collector, remove the debug session record/environment artifacts, and commit only the actual production fix.

## Assumptions and decisions

- Investigation focuses on WhatsApp Cloud API official webhook/bot flow, not legacy WAHA behavior.
- Customer phone numbers and access tokens must not be recorded in plain text in debug logs; logs will use redacted or hashed identifiers.
- No database schema migration will be added unless runtime evidence proves duplicate phone/WABA configuration records are a live cause. The first remediation will be deterministic safe lookup/guard behavior.
- The existing image media-upload fallback remains unrelated to recipient routing and will not be changed during this debug task.

## Verification checklist

1. Instrumentation captures one complete event chain per inbound webhook.
2. Two customers send messages close together to the same business number.
3. Debug evidence confirms/rejects all five hypotheses.
4. Post-fix history includes no cross-customer rows.
5. Post-fix Cloud API target and saved recipient are identical for each reply.
6. User verifies no wrong-user bot reply is observed in the deployed environment.
