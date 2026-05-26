import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, Radio, ShieldCheck, Sparkles, AlertCircle, Info, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  displayPhoneNumber?: string;
  verifiedName?: string;
};

const APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID || "3741087806186945";
const CONFIG_ID = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || "1592300178695434";
const GRAPH_VERSION = import.meta.env.VITE_FACEBOOK_GRAPH_VERSION || "v22.0";
const SIGNUP_META_WAIT_MS = 15000;

function isAllowedFacebookOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return hostname === "facebook.com" || hostname === "www.facebook.com" || hostname === "web.facebook.com";
  } catch {
    return false;
  }
}

export default function WhatsAppOfficialIntegration() {
  const { refreshSessions, sessions, currentSession } = useWhatsApp();
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [wabaInfo, setWabaInfo] = useState<EmbeddedSignupMeta | null>(null);
  const embeddedSignupMetaRef = useRef<EmbeddedSignupMeta>({});
  const metaResolverRef = useRef<((meta: EmbeddedSignupMeta | null) => void) | null>(null);
  const metaTimeoutRef = useRef<number | null>(null);

  const resolvePendingMeta = (meta: EmbeddedSignupMeta | null) => {
    if (metaTimeoutRef.current) {
      window.clearTimeout(metaTimeoutRef.current);
      metaTimeoutRef.current = null;
    }

    metaResolverRef.current?.(meta);
    metaResolverRef.current = null;
  };

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
      if (!event.origin || !isAllowedFacebookOrigin(event.origin)) {
        return;
      }

      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (payload?.type !== "WA_EMBEDDED_SIGNUP") {
          return;
        }

        if (payload.event === "FINISH") {
          const meta = {
            wabaId: payload.data?.waba_id,
            phoneNumberId: payload.data?.phone_number_id,
          };
          embeddedSignupMetaRef.current = meta;
          resolvePendingMeta(meta);
          return;
        }

        if (payload.event === "ERROR") {
          const message = payload.data?.error_message || "WhatsApp setup failed.";
          resolvePendingMeta(null);
          toast.error(message);
          setLoading(false);
          return;
        }

        if (payload.event === "CANCEL") {
          resolvePendingMeta(null);
          setLoading(false);
        }
      } catch {
        // Ignore unrelated postMessage traffic.
      }
    };

    window.addEventListener("message", sessionInfoListener);
    return () => {
      if (metaTimeoutRef.current) {
        window.clearTimeout(metaTimeoutRef.current);
      }
      metaResolverRef.current = null;
      window.removeEventListener("message", sessionInfoListener);
    };
  }, []);

  useEffect(() => {
    const officialSession = (currentSession?.provider_type === "official" ? currentSession : null)
      || sessions.find((session) => session.provider_type === "official" || String(session.name || "").startsWith("official_"))
      || null;

    if (!officialSession) {
      setConnected(false);
      setWabaInfo(null);
      return;
    }

    setConnected(true);
    setWabaInfo({
      wabaId: officialSession.waba_id,
      phoneNumberId: officialSession.phone_number_id,
    });
  }, [currentSession, sessions]);

  const waitForEmbeddedSignupMeta = async () => {
    if (embeddedSignupMetaRef.current.wabaId || embeddedSignupMetaRef.current.phoneNumberId) {
      return embeddedSignupMetaRef.current;
    }

    return new Promise<EmbeddedSignupMeta | null>((resolve) => {
      metaResolverRef.current = resolve;
      metaTimeoutRef.current = window.setTimeout(() => {
        resolvePendingMeta(null);
      }, SIGNUP_META_WAIT_MS);
    });
  };

  const handleSignupCompletion = async (code: string, signupMeta?: EmbeddedSignupMeta | null) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again and reconnect WhatsApp.");
      }

      const meta = signupMeta && (signupMeta.wabaId || signupMeta.phoneNumberId)
        ? signupMeta
        : embeddedSignupMetaRef.current;

      const response = await fetch(`${BACKEND_URL}/api/whatsapp/official/signup-complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code,
          wabaId: meta.wabaId,
          phoneNumberId: meta.phoneNumberId,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to complete official WhatsApp connection.");
      }

      setConnected(true);
      setWabaInfo(data.data || meta);
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

    // Coexistence Warning
    toast.info("Meta Popup খুললে 'Create a WhatsApp Business account' select না করে existing account select করার চেষ্টা করুন (যদি থাকে)।", {
      duration: 6000,
    });

    embeddedSignupMetaRef.current = {};
    setLoading(true);

    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setLoading(false);
          toast.error("Facebook authorization was cancelled or failed.");
          return;
        }

        void (async () => {
          const signupMeta = await waitForEmbeddedSignupMeta();
          await handleSignupCompletion(code, signupMeta);
        })();
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
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 md:p-5 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-300">Official Connection Active</p>
              <p className="text-sm text-slate-300">
                Your chatbot now runs on Meta official WhatsApp Cloud API.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <p className="text-slate-500 text-xs mb-2 uppercase tracking-[0.2em]">WABA ID</p>
              <p className="font-mono break-all text-slate-100">{wabaInfo?.wabaId || "Pending sync"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <p className="text-slate-500 text-xs mb-2 uppercase tracking-[0.2em]">Phone Number ID</p>
              <p className="font-mono break-all text-slate-100">{wabaInfo?.phoneNumberId || "Pending sync"}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Integration Fee</p>
              <p className="text-xs text-slate-400">Session connection on your dashboard stays free.</p>
            </div>
            <Badge className="bg-green-600 text-white hover:bg-green-600">Free</Badge>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              <div className="flex items-center gap-2 text-slate-200">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium">Official API</span>
              </div>
              <p className="mt-2 text-xs text-slate-400">Meta-supported stable connection for production chatbot flows.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Radio className="h-4 w-4 text-sky-400" />
                <span className="text-sm font-medium">Coexistence</span>
              </div>
              <p className="mt-2 text-xs text-slate-400">Use an existing WhatsApp Business App number without QR pairing.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-medium">No Setup Fee</span>
              </div>
              <p className="mt-2 text-xs text-slate-400">Dashboard connection stays free. Meta message pricing may still apply.</p>
            </div>
          </div>

          <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-200 rounded-2xl">
            <Info className="h-4 w-4 text-amber-400" />
            <AlertTitle className="text-sm font-bold flex items-center gap-2">
              Coexistence Flow Guide (গুরুত্বপূর্ণ)
            </AlertTitle>
            <AlertDescription className="mt-2 space-y-2 text-xs text-slate-300">
              <div className="flex items-start gap-2">
                <div className="h-4 w-4 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] mt-0.5 shrink-0">1</div>
                <p>Meta Popup ওপেন হলে <span className="text-amber-400 font-semibold">"Create a WhatsApp Business account"</span> অপশনটি এড়িয়ে চলার চেষ্টা করুন।</p>
              </div>
              <div className="flex items-start gap-2">
                <div className="h-4 w-4 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] mt-0.5 shrink-0">2</div>
                <p>আপনার যদি আগে থেকেই WABA একাউন্ট থাকে, সেটি সিলেক্ট করুন।</p>
              </div>
              <div className="flex items-start gap-2">
                <div className="h-4 w-4 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] mt-0.5 shrink-0">3</div>
                <p>যদি বারবার <span className="text-rose-400 font-semibold">"Add your WhatsApp phone number"</span> স্ক্রিন আসে, তবে বুঝবেন Meta আপনাকে Coexistence ফ্লো-তে নিচ্ছে না। এক্ষেত্রে Meta Dashboard থেকে Config ID চেক করতে হবে।</p>
              </div>
            </AlertDescription>
          </Alert>

          <Button
            onClick={launchWhatsAppSignup}
            disabled={loading || !sdkReady}
            className="h-14 w-full rounded-2xl bg-gradient-to-r from-[#1877F2] to-[#1f6fe5] text-white font-semibold shadow-lg shadow-blue-950/30 transition-all hover:scale-[1.01] hover:from-[#166fe5] hover:to-[#166fe5] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <img src="https://www.facebook.com/favicon.ico" className="mr-2 h-5 w-5 invert" alt="FB" />
            )}
            {loading ? "Opening Meta Signup..." : sdkReady ? "Connect WhatsApp Business" : "Preparing Meta SDK..."}
          </Button>

          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-slate-300 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-sky-300">Connection Notes</p>
              <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-300">
                {sdkReady ? "Ready" : "Loading SDK"}
              </Badge>
            </div>
            <p>Business owners can connect their own WhatsApp Business App number via coexistence.</p>
            <p>No QR session, no third-party connector, no dashboard integration fee.</p>
            <p>Meta message charges may still apply for template and bulk messaging.</p>
          </div>
        </div>
      )}
    </div>
  );
}
