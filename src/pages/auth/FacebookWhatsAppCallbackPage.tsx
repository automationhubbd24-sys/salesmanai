import { useEffect } from "react";
import {
  WHATSAPP_MOBILE_CALLBACK_KEY,
  WHATSAPP_MOBILE_FLOW_STATE_KEY,
  clearFlowState,
  readFlowState,
  storeCallbackPayload,
} from "@/lib/facebookMobileAuth";
import { BACKEND_URL } from "@/config";

export default function FacebookWhatsAppCallbackPage() {
  useEffect(() => {
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

    // Store locally for PC/Direct browser flow
    storeCallbackPayload(WHATSAPP_MOBILE_CALLBACK_KEY, payload);

    // PERSIST TO DATABASE FOR POLLING (Crucial for Mobile/App Hijacking)
    // This allows the original browser (Chrome) to see the result from the FB App browser
    if (returnedState) {
        void fetch(`${BACKEND_URL}/api/auth/facebook/callback-persist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: returnedState, ...payload })
        }).catch(e => console.error("Persistence failed:", e));
    }

    // Try to find the original flow state to know where to return
    const storedState = readFlowState(WHATSAPP_MOBILE_FLOW_STATE_KEY);
    clearFlowState(WHATSAPP_MOBILE_FLOW_STATE_KEY);

    // PC/Smart Mobile Flow: Close popup if possible
    if (window.opener) {
      try {
        window.opener.postMessage({ type: "WA_MOBILE_CALLBACK_COMPLETE" }, window.location.origin);
        window.close();
        return;
      } catch (e) {
        console.error("Failed to notify opener:", e);
      }
    }

    // Fallback: Redirect main window
    window.location.replace(storedState?.returnPath || "/dashboard/whatsapp/sessions");
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
