import { useEffect } from "react";
import {
  MESSENGER_MOBILE_CALLBACK_KEY,
  MESSENGER_MOBILE_FLOW_STATE_KEY,
  clearFlowState,
  readFlowState,
  storeCallbackPayload,
} from "@/lib/facebookMobileAuth";
import { BACKEND_URL } from "@/config";

export default function FacebookMessengerCallbackPage() {
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
    storeCallbackPayload(MESSENGER_MOBILE_CALLBACK_KEY, payload);

    // PERSIST TO DATABASE FOR POLLING (Crucial for Mobile/App Hijacking)
    if (returnedState) {
        void fetch(`${BACKEND_URL}/api/auth/facebook/callback-persist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: returnedState, ...payload })
        }).catch(e => console.error("Persistence failed:", e));
    }

    // Try to find the original flow state to know where to return
    const storedState = readFlowState(MESSENGER_MOBILE_FLOW_STATE_KEY);
    clearFlowState(MESSENGER_MOBILE_FLOW_STATE_KEY);

    // PC/Smart Mobile Flow: Close popup if possible
    if (window.opener) {
      try {
        window.opener.postMessage({ type: "MESSENGER_MOBILE_CALLBACK_COMPLETE" }, window.location.origin);
        window.close();
        return;
      } catch (e) {
        console.error("Failed to notify opener:", e);
      }
    }

    // Fallback: Redirect main window
    window.location.replace(storedState?.returnPath || "/dashboard/messenger/integration");
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Completing Facebook login</h1>
        <p className="mt-3 text-sm text-slate-400">Please wait while we return you to Messenger integration.</p>
      </div>
    </div>
  );
}
