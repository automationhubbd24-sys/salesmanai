[OPEN] Debug Session: size-filter-mismatch

## Symptom
- Customer asks for size `34`
- Bot responds with products/SKUs for size `42`

## Falsifiable Hypotheses
1. Retrieval ranks the right product family but does not hard-filter by requested size, so a `42` SKU is still selected as top candidate.
2. `sku_matrix` / `attribute_schema` data for this page is missing, malformed, or does not contain size `34`, forcing fallback to another available size.
3. Embedding/searchable text overweights general product terms (`bra`, `pusha`, etc.) and underweights numeric size tokens, so query `34` is not preserved strongly enough.
4. Prompt snapshot or tool response includes all SKUs, but the text model ignores the missing-attribute rule and answers with the first/highest-ranked SKU anyway.
5. Conversation state (`last_variant_key`) or prior context biases selection toward a previously discussed SKU such as size `42`.

## Evidence Log
- DB page row: `fb_message_database.page_id = 442734308926132`, `embed_enabled = false`, `has_prompt = true`
- Product data check: page has a valid size `34` product (`id=206`, `sku_code=PUSHA-34`, price `125`)
- Stored product embeddings for page are all `4096` dimensions
- Global embedding config row is stale/misaligned:
  - `config_type = embedding_global`
  - `text_model = gemini-embedding-001`
  - OpenRouter / OpenAI-compatible
- Direct model checks:
  - `qwen/qwen3-embedding-8b` returns `4096`
  - `gemini-embedding-001` returns `3072`
- Runtime reproduction before patch:
  - `searchProductsForResource('34 size pusha bra', '442734308926132')`
  - PostgreSQL error: `different vector dimensions 4096 and 3072`
- Runtime reproduction with user-provided Qwen embedding config:
  - Query returns top product `id=206` / `PUSHA-34`
- Prompt spot-check:
  - Page prompt contains hardcoded generic pricing rule: `42, 44 size – 150 টাকা`
  - This can bias replies when retrieval context is missing or broken
- Code patch applied:
  - vector-dimension mismatch now falls back to lexical ranking instead of throwing

## Next Checks
- Inspect `searchProductsForResource(...)`
- Inspect `resolveProductSkuSelection(...)`
- Query page products and `sku_matrix` values from Postgres
- Reproduce with direct query text similar to user message
