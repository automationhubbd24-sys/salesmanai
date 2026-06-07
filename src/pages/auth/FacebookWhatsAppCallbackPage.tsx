import { useEffect } from "react";
import {
  WHATSAPP_MOBILE_CALLBACK_KEY,
  WHATSAPP_MOBILE_FLOW_STATE_KEY,
  clearFlowState,
  readFlowState,
  storeCallbackPayload,
} from "@/lib/facebookMobileAuth";

export default function FacebookWhatsAppCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storedState = readFlowState(WHATSAPP_MOBILE_FLOW_STATE_KEY);
    const returnedState = params.get("state");
    const isStateValid = Boolean(storedState?.state && returnedState && storedState.state === returnedState);

    storeCallbackPayload(WHATSAPP_MOBILE_CALLBACK_KEY, {
      code: isStateValid ? params.get("code") : null,
      error: isStateValid ? params.get("error") : (params.get("error") || "invalid_state"),
      errorReason: isStateValid ? params.get("error_reason") : "state_mismatch",
      errorDescription: isStateValid
        ? params.get("error_description")
        : "Facebook login state mismatch. Please try again.",
      state: returnedState,
    });

    clearFlowState(WHATSAPP_MOBILE_FLOW_STATE_KEY);
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
