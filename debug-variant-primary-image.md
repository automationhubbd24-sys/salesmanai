# [OPEN] Debug Session: variant-primary-image

## Summary
- Symptom: Messenger-e `Sudu grape flavour er image deo` bolleo bot exact grape SKU image na diye primary image pathacche.
- Expected: Variant product-e exact flavour/SKU match hole sudhu oi variant-er assigned image jabe.
- Scope: Messenger `webhookController.js` flow, AI product snapshot, agentic media selection, final media queue.

## Hypotheses
1. `grape` query runtime-e `selectedSku` resolve hocche na, tai shared resolver primary image-e fallback nicche.
2. AI reply-te `product_id` thik thakleo Messenger photo/tag path-e wrong query text pass hocche, tai generic media resolve hocche.
3. Resolver exact SKU media ber korar pore later stage-e `aiResponse.images` ba `extractedImages` diye abar primary image overwrite hocche.
4. AI prompt snapshot-e primary image beshi dominant thakar karone model `grape` mention korleo primary image URL prefer korche.
5. Conversation state-er `last_variant_key` null ba stale thakar karone resolver generic product branch nicche.

## Plan
1. Debug Server start kore session env create kora.
2. `webhookController.js`-e resolver input/output, selected SKU, and final media queue-r instrumentation add kora.
3. `aiService.js`-e product snapshot-e exact SKU image vs primary image ki inject hocche seta instrument kora.
4. Runtime logs collect kore confirmed hypothesis identify kora.
5. Evidence confirm hole minimal fix apply kora.

## Evidence
- `2026-06-28 04:08:34` at page `468040036388093` the target query `Sudu grape flavour er image deo` enters processing normally.
- `2026-06-28 04:09:04` the same page hits `[BurstQueue] Task error ... Task Timeout (30s)`.
- Later retries at `04:14:34` and `04:15:44` show `Processing: true`, meaning the Messenger debounce session stayed locked and new messages were only appended.
- Conclusion: before fixing variant image selection, Messenger session unlock logic must recover after burst timeout; otherwise the user receives no reply and no new media-resolution evidence is produced.
- `2026-06-28 04:30:21` and `04:30:56` show `grape` and `mint` queries now complete, but both send the same primary image URL `1782581945851-c3fe6ad067a76431.jpg`.
- DB verification for product `326` confirms `grape` and `mint` each have different `sku_matrix.image_url`, while the sent URL is the product-level `image_url`.
- Local reproduction using `buildResolvedProductMediaContext()` with the exact user queries selects the correct SKU image, so resolver logic is correct in isolation.
- Confirmed root cause: Messenger TIER 2 agentic-delivery path passed only `effectiveHistory` into variant resolution and omitted the current `combinedText`, causing generic primary-image fallback.

## Status
- Bootstrap complete.
- Instrumentation complete.
- Root cause for current "no answer" symptom confirmed: Messenger debounce session stays busy after burst timeout.
- Timeout recovery fix applied.
- TIER 2 variant-resolution fix applied to include current user text with history.
