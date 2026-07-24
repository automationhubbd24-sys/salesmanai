# Debug: reply-delay-logs [OPEN]

## Symptom
Messenger/WhatsApp-e API response 7-8 sec holeo final reply pete ~1 minute lagche. User provided production server log file containing multiple pages/sessions.

## Scope
Read-only log analysis. No business logic modification in this phase.

## Hypotheses
1. Page/session-specific debounce config (`wait`/`wait_time`) production-e zero na, ba cache stale value use korche.
2. Same conversation `isProcessing=true` thakay new messages buffer-e pore current/previous task finish wait korche.
3. Messenger/WhatsApp burst/page queue saturated thakay task start delay hocche.
4. AI lane/global concurrency queue saturated thakay actual model call start late hocche.
5. API response fast holeo final send side-e WAHA/Facebook retry/media/split/typing/admin-check delay add hocche.

## Evidence Log

### Confirmed observations from provided log

1. Messenger page `439257819269472`, sender `28173490285569973`
   - `17:53:45` first `Hello` queued, debounce `4000ms`.
   - `17:53:46` second `Hello` queued, debounce reset again to `4000ms`.
   - `17:53:50` processing starts. So before AI, 4-5 sec already gone due to configured wait.
   - `17:53:52` and `17:53:53` image messages arrive while `Processing: true`; both appended to buffer.
   - `17:54:05` previous processing finishes/retriggers queued images.
   - `17:54:07` image batch processing starts.
   - `17:54:17` vision reasoning fails with `503` and AB independent fails with `Missing Authentication header`.
   - `17:54:28` AI finalizes; `17:54:30` FB send starts.
   - Evidence supports busy-session + image/vision path delay.

2. Messenger page `110426538001028`, sender `37231140356530468`
   - `17:53:59` previous AI reply is sent.
   - `17:53:59` session has 2 new messages; re-triggering.
   - `17:54:01` processing starts.
   - `17:54:09` AI response success.
   - `17:54:10` FB send starts.
   - `17:54:10` new text `Thik ache` arrives while `Processing: true`; appended to buffer, not processed immediately.
   - `17:54:22` later `Janachi` arrives and batch is processed at `17:54:24`.
   - Evidence supports busy-session batching, not raw API slowness.

3. WhatsApp official `8801640910214:official_1920566445180974`
   - `17:53:53` image queued with wait `0ms`.
   - `17:53:53` processing starts immediately.
   - `17:53:59` next text arrives while current batch is still processing; appended to buffer.
   - `17:54:02` direct image embedding skipped due to image download `401`.
   - `17:54:02` conversation locked, AI reply skipped.
   - Evidence: debounce zero worked here, but image/embedding + lock path caused non-normal behavior.

4. WhatsApp official `8801913440147:official_2557742014603031_751467468050798`
   - `17:53:58` first text queued with wait `0ms`; processing starts immediately.
   - `17:54:05` next text arrives while current batch is still processing; appended to buffer.
   - Later `17:54:19` AI generation starts for this official page and `17:54:32` finalization occurs.
   - Evidence supports processing lock/queue delay after first message.

5. WhatsApp official `8801915041433:official_1553788439670835_1202362146293423`
   - `17:54:32` queued with wait `8000ms`.
   - Evidence: this page/session is not zero debounce.

### Hypothesis status
- H1 debounce config/cache: Confirmed for some Messenger/WhatsApp sessions (`4000ms`, `8000ms`, many `2000ms`); false for some official WA where `0ms` is shown.
- H2 busy session lock: Confirmed across Messenger and WhatsApp (`Processing: true`, `currently processing`, `Appended to buffer`).
- H3 burst/page queue saturation: Not directly confirmed; no `BurstQueue` warning/error found in provided slice.
- H4 AI queue saturation: Not directly confirmed; no AI busy/queue timeout log found in provided slice.
- H5 send/media/vision delay: Confirmed for image paths (`Vision Product Reasoning Failed 503`, image embedding 401, vision RPM/RPH=1 logs).

## Status
[OPEN] Log analysis complete. No business logic modified.
