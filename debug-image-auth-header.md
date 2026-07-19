# Debug Session: image-auth-header [OPEN]

## Symptom
- Runtime log shows: `[Image Batch AB Independent] Failed: Missing Authentication header`
- User requested live testing because static assumption may be wrong.

## Hypotheses
1. Image batch analyzer fetches a protected media URL directly without Authorization header.
2. A first-step downloader adds auth, but a second independent batch path reuses the raw URL without auth.
3. A URL transformation changes `source=webhook` to `source=getMedia` and drops the authenticated fetch flow.
4. The failing request is not WhatsApp media itself, but another internal API endpoint that requires auth and is being called anonymously.
5. A fallback path for image embedding/batch analysis bypasses the normal media download helper.

## Plan
- Locate the code path for `Image Batch AB Independent`.
- Find all places that fetch/download WhatsApp/Facebook media URLs.
- Reproduce locally or via targeted runtime execution.
- Confirm or reject hypotheses with evidence.

## Status
- Session initialized.
