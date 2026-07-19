# Debug Session: ads-price-intent
- **Status**: [OPEN]
- **Issue**: Customers arriving from Messenger, WhatsApp, and Instagram ads ask for price/details, but the main LLM does not understand or use the ads library context.
- **Debug Server**: Pending startup
- **Log File**: .dbg/trae-debug-log-ads-price-intent.ndjson

## Reproduction Steps
1. Use a live ad entry point on Messenger, WhatsApp, or Instagram.
2. Send a price/details question such as "price details?".
3. Inspect the request path, ads context lookup, routing decision, and LLM payload through runtime logs.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Ad attribution/context is absent from the inbound channel payload. | High | Low | Pending |
| B | Ads library lookup cannot match the received campaign/ad/product identifiers. | High | Low | Pending |
| C | Price/details intent is routed to a fallback instead of the ads-aware LLM path. | Medium | Low | Pending |
| D | Ads context is found but omitted or truncated before the main LLM call. | Medium | Low | Pending |
| E | Channel normalization differs among Messenger, WhatsApp, and Instagram. | Medium | Medium | Pending |

## Log Evidence
Pending collection.

## Verification Conclusion
Pending runtime reproduction.
