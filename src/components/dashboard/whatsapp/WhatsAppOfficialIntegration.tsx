import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Facebook, Link2, Loader2, MessageSquare, RotateCcw, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { useNavigate } from "react-router-dom";

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
const CONFIG_ID = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || "2197274487770639";
const GRAPH_VERSION = import.meta.env.VITE_FACEBOOK_GRAPH_VERSION || "v25.0";
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
  const navigate = useNavigate();
  const { refreshSessions, sessions, currentSession, setCurrentSession } = useWhatsApp();
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [wabaInfo, setWabaInfo] = useState<EmbeddedSignupMeta | null>(null);
  const embeddedSignupMetaRef = useRef<EmbeddedSignupMeta>({});
  const metaResolverRef = useRef<((meta: EmbeddedSignupMeta | null) => void) | null>(null);
  const metaTimeoutRef = useRef<number | null>(null);

  const officialSession = (currentSession?.provider_type === "official" ? currentSession : null)
    || sessions.find((session) => session.provider_type === "official" || String(session.name || "").startsWith("official_"))
    || null;
  const trimmedBackendUrl = BACKEND_URL.replace(/\/$/, "");
  const officialWebhookUrl = `${trimmedBackendUrl}/webhook/whatsapp`;
  const usesLocalBackend = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmedBackendUrl);

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

        if (
          payload.event === "FINISH"
          || payload.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
        ) {
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

  const handleDisconnect = async () => {
    if (!officialSession?.name) {
      toast.error("Connected WhatsApp session khuje paoa jacche na.");
      return;
    }

    if (!window.confirm(`Apni ki ${officialSession.name} disconnect korte chan?`)) {
      return;
    }

    try {
      setDisconnecting(true);
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again and retry.");
      }

      const response = await fetch(`${BACKEND_URL}/api/whatsapp/official/${encodeURIComponent(officialSession.name)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to disconnect WhatsApp.");
      }

      if (currentSession?.name === officialSession.name) {
        localStorage.removeItem("active_wa_session_id");
        localStorage.removeItem("active_wp_db_id");
        setCurrentSession(null);
      }

      setConnected(false);
      setWabaInfo(null);
      await refreshSessions();
      toast.success("WhatsApp disconnected successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to disconnect WhatsApp.";
      toast.error(message);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRepairWebhook = async () => {
    if (!officialSession?.name) {
      toast.error("Connected WhatsApp session khuje paoa jacche na.");
      return;
    }

    try {
      setRepairing(true);
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again and retry.");
      }

      const response = await fetch(
        `${BACKEND_URL}/api/whatsapp/official/${encodeURIComponent(officialSession.name)}/repair-webhook`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to repair WhatsApp webhook.");
      }

      await refreshSessions();
      toast.success("Webhook repair request complete hoyeche.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to repair WhatsApp webhook.";
      toast.error(message);
    } finally {
      setRepairing(false);
    }
  };

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
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      {connected ? (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(24,119,242,0.16),rgba(16,185,129,0.14))] p-5 text-white">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-white text-[#1877F2] hover:bg-white">
                    <Facebook className="mr-1 h-3.5 w-3.5" />
                    Meta Connected
                  </Badge>
                  <Badge variant="outline" className="border-emerald-400/30 bg-emerald-500/10 text-emerald-200">
                    Coexistence Ready
                  </Badge>
                </div>
                <div>
                  <p className="text-xl font-semibold">Official WhatsApp Business number connected</p>
                  <p className="mt-1 text-sm text-slate-200">
                    Same number diye mobile app + Cloud API chatbot ekshathe cholbe. Dorkar hole ekhanei reconnect ba disconnect korte parben.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Active Session</p>
                <p className="mt-1 break-all font-medium">{officialSession?.name || "official_session"}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Connection</p>
              <p className="font-semibold text-emerald-300">Live</p>
              <p className="mt-1 text-xs text-slate-400">Webhook, token, and session linked.</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Phone ID</p>
              <p className="font-mono break-all text-slate-100">{wabaInfo?.phoneNumberId || "Pending sync"}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">WABA ID</p>
              <p className="font-mono break-all text-slate-100">{wabaInfo?.wabaId || "Pending sync"}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <MessageSquare className="h-4 w-4 text-sky-300" />
                Chatbot Control
              </div>
              <p className="mt-2 text-xs text-slate-400">Reply behaviour, live bot, orders, prompts manage korun.</p>
              <Button onClick={() => navigate("/dashboard/whatsapp/control")} className="mt-4 w-full bg-[#1877F2] hover:bg-[#166fe5]">
                Manage Chatbot
              </Button>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Settings2 className="h-4 w-4 text-emerald-300" />
                AI Setup
              </div>
              <p className="mt-2 text-xs text-slate-400">Prompt, model, delay, order email, memory limit update korun.</p>
              <Button onClick={() => navigate("/dashboard/whatsapp/settings")} variant="outline" className="mt-4 w-full border-white/10">
                Open Settings
              </Button>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Link2 className="h-4 w-4 text-amber-300" />
                Connection Actions
              </div>
              <p className="mt-2 text-xs text-slate-400">Webhook issue hole repair din, phone app disconnect hole reconnect korun, dorkar hole clean disconnect korun.</p>
              <div className="mt-4 grid gap-2">
                <Button
                  onClick={handleRepairWebhook}
                  disabled={repairing || loading || disconnecting}
                  variant="outline"
                  className="w-full rounded-xl border-white/10"
                >
                  {repairing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {repairing ? "Repairing..." : "Repair Webhook"}
                </Button>
                <Button
                  onClick={launchWhatsAppSignup}
                  disabled={loading || !sdkReady || disconnecting || repairing}
                  className="w-full rounded-xl bg-[#1877F2] text-white hover:bg-[#166fe5]"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  {loading ? "Opening..." : "Reconnect"}
                </Button>
                <Button
                  onClick={handleDisconnect}
                  disabled={disconnecting || loading || repairing}
                  variant="destructive"
                  className="w-full rounded-xl"
                >
                  {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  {disconnecting ? "Disconnecting..." : "Disconnect"}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" />
              <div className="space-y-1 text-sm text-slate-300">
                <p className="font-medium text-white">Coexistence note</p>
                <p>Meta popup-e existing WhatsApp Business App number select korlei একই number app + bot duijayga theke use korte parben.</p>
                <p>Jodi Meta side-theke phone unlink hoy, same connect flow abar complete korlei session refresh hoye jabe.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 text-sm ${
            usesLocalBackend
              ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
              : "border-sky-500/20 bg-sky-500/10 text-sky-100"
          }`}>
            <p className="font-medium text-white">Webhook setup check</p>
            <p className="mt-2 break-all">
              Callback URL: <span className="font-mono">{officialWebhookUrl}</span>
            </p>
            <p className="mt-2 text-xs leading-5">
              {usesLocalBackend
                ? "Akhon frontend localhost backend use korche. Meta localhost-e webhook pathate parbe na, tai chatbot incoming message pabe na. Public HTTPS backend URL use korun."
                : "Meta Developers > WhatsApp > Webhooks-e ei public callback URL ta set thaka dorkar, ebong `messages` field subscribe kora thakte hobe."}
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(24,119,242,0.24),rgba(15,23,42,0.92))] p-5 md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-white text-[#1877F2] hover:bg-white">
                    <Facebook className="mr-1 h-3.5 w-3.5" />
                    Meta Embedded Signup
                  </Badge>
                  <Badge variant="outline" className="border-white/20 bg-white/5 text-slate-200">
                    {sdkReady ? "SDK Ready" : "Preparing SDK"}
                  </Badge>
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-white">Connect your WhatsApp Business number the Facebook way</h3>
                  <p className="mt-2 text-sm text-slate-200">
                    Existing WhatsApp Business App number die coexistence mode-e connect korun. Meta popup thekei signup, verification, webhook subscription complete hobe.
                  </p>
                </div>
                <div className="grid gap-2 text-sm text-slate-200 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2">Same number on app + bot</div>
                  <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2">No manual token paste</div>
                  <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2">Reconnect anytime</div>
                </div>
              </div>

              <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-slate-950/55 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Start Connection</p>
                <Button
                  onClick={launchWhatsAppSignup}
                  disabled={loading || !sdkReady}
                  className="mt-4 h-14 w-full rounded-2xl bg-[#1877F2] text-white font-semibold shadow-lg shadow-blue-950/30 transition-all hover:bg-[#166fe5] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Facebook className="mr-2 h-5 w-5" />
                  )}
                  {loading ? "Opening Meta Signup..." : sdkReady ? "Connect WhatsApp Business" : "Preparing Meta SDK..."}
                </Button>
                <p className="mt-3 text-xs text-slate-400">
                  Popup-e possible hole existing WhatsApp Business App account select korun, not a fresh migrated setup.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                title: "1. Login with Meta",
                description: "Facebook account diye login kore business portfolio select korun.",
              },
              {
                title: "2. Select Existing Number",
                description: "Popup-e WhatsApp Business App number select kore coexistence enable korun.",
              },
              {
                title: "3. Finish and Configure Bot",
                description: "Connect complete hole settings e giye prompt, AI model, delay, order flow set korun.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-3xl border border-white/10 bg-slate-950/65 p-4">
                <p className="text-sm font-medium text-white">{item.title}</p>
                <p className="mt-2 text-xs leading-5 text-slate-400">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-slate-300">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-sky-300" />
              <div className="space-y-1">
                <p className="font-medium text-white">Quick Note</p>
                <p>Existing WhatsApp Business number use kora jabe, disconnect hole same flow diye reconnect korte parben.</p>
                <p>Connect howar por `Manage Chatbot`/`Settings` page theke full AI chatbot setup complete korun.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
