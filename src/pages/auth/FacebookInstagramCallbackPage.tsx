import { useEffect } from "react";
import {
  INSTAGRAM_MOBILE_CALLBACK_KEY,
  INSTAGRAM_MOBILE_FLOW_STATE_KEY,
  readFlowState,
  storeCallbackPayload,
} from "@/lib/facebookMobileAuth";
import { BACKEND_URL } from "@/config";

export default function FacebookInstagramCallbackPage() {
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

      storeCallbackPayload(INSTAGRAM_MOBILE_CALLBACK_KEY, payload);

      if (returnedState) {
        try {
          await fetch(`${BACKEND_URL}/api/auth/facebook/callback-persist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: returnedState, ...payload }),
            keepalive: true,
          });
        } catch (persistError) {
          console.error("Persistence failed:", persistError);
        }
      }

      const storedState = readFlowState(INSTAGRAM_MOBILE_FLOW_STATE_KEY);

      if (window.opener) {
        try {
          window.opener.postMessage({ type: "INSTAGRAM_MOBILE_CALLBACK_COMPLETE" }, window.location.origin);
          window.close();
          return;
        } catch (notifyError) {
          console.error("Failed to notify opener:", notifyError);
        }
      }

      window.location.replace(storedState?.returnPath || "/dashboard/instagram/integration");
    })();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Completing Instagram login</h1>
        <p className="mt-3 text-sm text-slate-400">Please wait while we return you to Instagram integration.</p>
      </div>
    </div>
  );
}
