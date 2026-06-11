import { useEffect } from "react";
import {
  WHATSAPP_MOBILE_CALLBACK_KEY,
  WHATSAPP_MOBILE_FLOW_STATE_KEY,
  readFlowState,
  storeCallbackPayload,
} from "@/lib/facebookMobileAuth";
import { BACKEND_URL } from "@/config";

const DEBUG_SERVER_URL = "http://10.2.0.2:7777/event";
const DEBUG_SESSION_ID = "whatsapp-loading-stuck";

export default function FacebookWhatsAppCallbackPage() {
  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const returnedState = params.get("state");
      const code = params.get("code");
      const error = params.get("error");
      const errorDescription = params.get("error_description");

      const payload = {
        code,
        error,
        errorReason: error ? "facebook_error" : null,
        errorDescription: errorDescription || (error ? "Facebook login failed." : null),
        state: returnedState,
      };

      // #region debug-point C:callback-page-loaded
      fetch(DEBUG_SERVER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "C", location: "FacebookWhatsAppCallbackPage.tsx:useEffect", msg: "[DEBUG] WhatsApp callback page loaded", data: { hasCode: Boolean(code), hasError: Boolean(error), state: returnedState, search: window.location.search }, ts: Date.now() }) }).catch(() => {});
      // #endregion

      // Store locally for direct browser return flow.
      storeCallbackPayload(WHATSAPP_MOBILE_CALLBACK_KEY, payload);

      // Persist before redirecting so mobile browser/app handoff does not drop the callback.
      if (returnedState) {
        try {
          await fetch(`${BACKEND_URL}/api/auth/facebook/callback-persist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: returnedState, ...payload }),
            keepalive: true,
          });
          // #region debug-point C:callback-persist-success
          fetch(DEBUG_SERVER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "C", location: "FacebookWhatsAppCallbackPage.tsx:useEffect", msg: "[DEBUG] WhatsApp callback persisted", data: { state: returnedState, hasCode: Boolean(code), hasError: Boolean(error) }, ts: Date.now() }) }).catch(() => {});
          // #endregion
        } catch (persistError) {
          console.error("Persistence failed:", persistError);
          // #region debug-point C:callback-persist-failed
          fetch(DEBUG_SERVER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "C", location: "FacebookWhatsAppCallbackPage.tsx:useEffect", msg: "[DEBUG] WhatsApp callback persistence failed", data: { state: returnedState, message: persistError instanceof Error ? persistError.message : "unknown" }, ts: Date.now() }) }).catch(() => {});
          // #endregion
        }
      }

      const storedState = readFlowState(WHATSAPP_MOBILE_FLOW_STATE_KEY);

      if (window.opener) {
        try {
          window.opener.postMessage({ type: "WA_MOBILE_CALLBACK_COMPLETE" }, window.location.origin);
          window.close();
          return;
        } catch (notifyError) {
          console.error("Failed to notify opener:", notifyError);
        }
      }

      // #region debug-point C:callback-page-redirect
      fetch(DEBUG_SERVER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "C", location: "FacebookWhatsAppCallbackPage.tsx:useEffect", msg: "[DEBUG] Redirecting from WhatsApp callback page", data: { returnPath: storedState?.returnPath || "/dashboard/whatsapp/sessions" }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      window.location.replace(storedState?.returnPath || "/dashboard/whatsapp/sessions");
    })();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Completing WhatsApp login</h1>
        <p className="mt-3 text-sm text-slate-400">Please wait while we return you to WhatsApp integration.</p>
      </div>
    </div>
  );
}
