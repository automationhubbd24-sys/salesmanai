# [OPEN] voice-analyze-fail

## Bug Summary
- Symptom: Messenger and WhatsApp voice analyze is not working correctly while using Gemini proxy API.
- Goal: Determine whether the root cause is in the proxy API integration or in the SalesmanChatbot workflow.

## Hypotheses
1. Audio payload is not sent in the format expected by the proxy API.
2. The selected model or proxy endpoint does not support the current audio analysis request shape.
3. Workflow preprocessing drops or corrupts media URL, MIME type, or binary content before the API call.
4. Upstream API returns a usable response, but local response mapping or error handling breaks the workflow.
5. Messenger and WhatsApp flows diverge in a shared media handling helper and fail before analysis.

## Investigation Log
- Session created. No business logic changed yet.
- `backend/src/controllers/whatsappController.js` and `backend/src/controllers/webhookController.js` both call `aiService.transcribeAudio(audioUrl, config)` for WhatsApp and Messenger voice notes.
- `backend/src/services/aiService.js` sends voice data to the configured provider in two main proxy-related ways:
  - Pro Plus mode posts `input_audio` to `${baseURL}/chat/completions`
  - Custom Gemini-compatible mode may also post `input_audio` to `${normalizedBaseURL}/chat/completions`
- `AIStudioToAPI/src/core/FormatConverter.js` converts OpenAI content parts for `text` and `image_url`, but there is no handling for `audio_url` or `input_audio` in the OpenAI-to-Google translation path.
- Runtime checks against `https://gemini.salesmanchatbot.online/v1` with the provided key show:
  - `GET /models` works
  - `POST /chat/completions` with `model=gemini-3.5-flash` and text-only works
  - `POST /chat/completions` with `model=gemini-3.5-flash` and `audio_url` returns a text response saying no audio was attached
  - `POST /chat/completions` with `model=gemini-3.5-flash` and `input_audio` returns an unrelated generic text response, indicating audio content is not being forwarded correctly
  - `POST /chat/completions` with `model=gemini-2.5-flash` returns `403 PERMISSION_DENIED` even for text-only input

## Hypothesis Status
1. Audio payload is not sent in the format expected by the proxy API.
   - Confirmed. Proxy translation layer does not map `audio_url` or `input_audio` to Gemini request parts.
2. The selected model or proxy endpoint does not support the current audio analysis request shape.
   - Confirmed for the current proxy implementation. The endpoint exists, but OpenAI-compatible audio message parts are not supported by the adapter.
3. Workflow preprocessing drops or corrupts media URL, MIME type, or binary content before the API call.
   - Rejected as primary root cause. Messenger and WhatsApp both reach `aiService.transcribeAudio(...)`, and the failure pattern is consistent across both.
4. Upstream API returns a usable response, but local response mapping or error handling breaks the workflow.
   - Rejected as primary root cause. The proxy itself returns responses that indicate missing audio context before local mapping happens.
5. Messenger and WhatsApp flows diverge in a shared media handling helper and fail before analysis.
   - Rejected as primary root cause. Both flows converge on the same transcription helper and show the same proxy limitation.

## Current Conclusion
- Primary root cause is in the proxy API path, not in Messenger or WhatsApp workflow orchestration.
- Secondary issue: `gemini-2.5-flash` is currently permission-denied on the proxy for this key/account, so any fallback to that model will also fail.
