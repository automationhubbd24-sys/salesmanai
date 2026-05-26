import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import { useWhatsApp } from "@/context/WhatsAppContext";

declare global {
  interface Window {
    FB: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options?: Record<string, unknown>
      ) => void;
    };
    fbAsyncInit: () => void;
  }
}

type EmbeddedSignupMeta = {
  wabaId?: string;
  phoneNumberId?: string;
};

const APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID || "3741087806186945";
const CONFIG_ID = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || "1592300178695434";
const GRAPH_VERSION = import.meta.env.VITE_FACEBOOK_GRAPH_VERSION || "v22.0";

export default function WhatsAppOfficialIntegration() {
  const { refreshSessions } = useWhatsApp();
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [wabaInfo, setWabaInfo] = useState<EmbeddedSignupMeta | null>(null);
  const embeddedSignupMetaRef = useRef<EmbeddedSignupMeta>({});

  useEffect(() => {
    const initFacebookSdk = () => {
      if (!window.FB) return;

      window.FB.init({
        appId: APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: GRAPH_VERSION,
      });

      setSdkReady(true);
    };

    if (window.FB) {
      initFacebookSdk();
      return;
    }

    window.fbAsyncInit = initFacebookSdk;

    if (document.getElementById("facebook-jssdk")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    const sessionInfoListener = (event: MessageEvent) => {
      if (!event.origin || !/facebook\.com$/.test(new URL(event.origin).hostname)) {
        return;
      }

      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (payload?.type !== "WA_EMBEDDED_SIGNUP") {
          return;
        }

        if (payload.event === "FINISH") {
          embeddedSignupMetaRef.current = {
            wabaId: payload.data?.waba_id,
            phoneNumberId: payload.data?.phone_number_id,
          };
          return;
        }

        if (payload.event === "ERROR") {
          const message = payload.data?.error_message || "WhatsApp setup failed.";
          toast.error(message);
          setLoading(false);
          return;
        }

        if (payload.event === "CANCEL") {
          setLoading(false);
        }
      } catch {
        // Ignore unrelated postMessage traffic.
      }
    };

    window.addEventListener("message", sessionInfoListener);
    return () => window.removeEventListener("message", sessionInfoListener);
  }, []);

  const handleSignupCompletion = async (code: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again and reconnect WhatsApp.");
      }

      const response = await fetch(`${BACKEND_URL}/api/whatsapp/official/signup-complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code,
          wabaId: embeddedSignupMetaRef.current.wabaId,
          phoneNumberId: embeddedSignupMetaRef.current.phoneNumberId,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to complete official WhatsApp connection.");
      }

      setConnected(true);
      setWabaInfo(data.data || embeddedSignupMetaRef.current);
      if (data.data?.sessionName) {
        localStorage.setItem("active_wa_session_id", data.data.sessionName);
      }
      if (data.data?.id) {
        localStorage.setItem("active_wp_db_id", String(data.data.id));
      }
      await refreshSessions();
      toast.success("Official WhatsApp connected successfully.");
      window.dispatchEvent(new Event("db-connection-changed"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to connect official WhatsApp.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const launchWhatsAppSignup = () => {
    if (!sdkReady || !window.FB) {
      toast.error("Facebook SDK is still loading. Please try again.");
      return;
    }

    embeddedSignupMetaRef.current = {};
    setLoading(true);

    window.FB.login(
      async (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setLoading(false);
          toast.error("Facebook authorization was cancelled or failed.");
          return;
        }

        await handleSignupCompletion(code);
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          sessionInfoVersion: 3,
          setup: {
            business: {
              name: "Automation Hub BD",
            },
          },
          features: {
            whatsapp_business_app_coexistence: true,
          },
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      {connected ? (
        <div className="space-y-4">
          <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
            <div>
              <p className="font-medium text-green-500">Official Connection Active</p>
              <p className="text-sm text-muted-foreground">
                Your chatbot now runs on Meta official WhatsApp Cloud API.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-white/5 rounded-md">
              <p className="text-muted-foreground text-xs mb-1">WABA ID</p>
              <p className="font-mono break-all">{wabaInfo?.wabaId || "Pending sync"}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-md">
              <p className="text-muted-foreground text-xs mb-1">Phone Number ID</p>
              <p className="font-mono break-all">{wabaInfo?.phoneNumberId || "Pending sync"}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Integration Fee</p>
              <p className="text-xs text-muted-foreground">Session connection on your dashboard stays free.</p>
            </div>
            <Badge className="bg-green-600 text-white hover:bg-green-600">Free</Badge>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Button
            onClick={launchWhatsAppSignup}
            disabled={loading || !sdkReady}
            className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white font-semibold py-6"
          >
            {loading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <img src="https://www.facebook.com/favicon.ico" className="w-5 h-5 mr-2 invert" alt="FB" />
            )}
            Connect Official WhatsApp
          </Button>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-slate-300 space-y-1">
            <p>Use your existing WhatsApp Business App number via coexistence.</p>
            <p>No QR session, no third-party connector, no dashboard integration fee.</p>
            <p>Meta message charges may still apply for template and bulk messaging.</p>
          </div>
        </div>
      )}
    </div>
  );
}
