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
    const storedState = readFlowState(MESSENGER_MOBILE_FLOW_STATE_KEY);
    const returnedState = params.get("state");
    const isStateValid = Boolean(storedState?.state && returnedState && storedState.state === returnedState);

    const payload = {
      code: isStateValid ? params.get("code") : null,
      error: isStateValid ? params.get("error") : (params.get("error") || "invalid_state"),
      errorReason: isStateValid ? params.get("error_reason") : "state_mismatch",
      errorDescription: isStateValid
        ? params.get("error_description")
        : "Facebook login state mismatch. Please try again.",
      state: returnedState,
    };

    storeCallbackPayload(MESSENGER_MOBILE_CALLBACK_KEY, payload);

    // PERSIST TO DATABASE FOR POLLING (Mobile Fix)
    if (returnedState) {
        void fetch(`${BACKEND_URL}/api/auth/facebook/callback-persist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: returnedState, ...payload })
        }).catch(e => console.error("Persistence failed:", e));
    }

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
