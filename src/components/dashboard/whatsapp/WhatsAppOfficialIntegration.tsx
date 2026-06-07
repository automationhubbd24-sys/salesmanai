import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Facebook, Link2, Loader2, MessageSquare, RotateCcw, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  WHATSAPP_MOBILE_CALLBACK_KEY,
  beginWhatsAppMobileOAuth,
  consumeCallbackPayload,
  getWhatsAppMobileRedirectUri,
} from "@/lib/facebookMobileAuth";

declare global {
  interface Window {
    FB: any;
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
  const isMobile = useIsMobile();
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
  const pollIntervalRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const sessionsRef = useRef(sessions);
  const mobileCallbackProcessedRef = useRef(false);

  const officialSession = (currentSession?.provider_type === "official" ? currentSession : null)
    || sessions.find((session) => session.provider_type === "official" || String(session.name || "").startsWith("official_"))
    || null;
  const trimmedBackendUrl = BACKEND_URL.replace(/\/$/, "");
  const officialWebhookUrl = `${trimmedBackendUrl}/webhook/whatsapp`;
  const usesLocalBackend = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmedBackendUrl);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const clearSignupPoll = () => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const finishConnectedFlow = (sessionData?: {
    sessionName?: string;
    wabaId?: string;
    phoneNumberId?: string;
  }) => {
    const sessionName = sessionData?.sessionName;

    if (sessionName) {
      localStorage.setItem("active_wa_session_id", sessionName);
      setCurrentSession({
        name: sessionName,
        provider_type: "official",
        waba_id: sessionData?.wabaId,
        phone_number_id: sessionData?.phoneNumberId,
      });
    }

    setConnected(true);
    setLoading(false);
    window.dispatchEvent(new Event("db-connection-changed"));
    navigate("/dashboard/whatsapp/control");
  };

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
          clearSignupPoll();
          toast.error(message);
          setLoading(false);
          return;
        }

        if (payload.event === "CANCEL") {
          resolvePendingMeta(null);
          clearSignupPoll();
          setLoading(false);
        }
      } catch {
        // Ignore unrelated postMessage traffic.
      }
    };

    window.addEventListener("message", sessionInfoListener);

    // Smart Mobile Flow Listener: Detect when popup closes
    const mobileCallbackListener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "WA_MOBILE_CALLBACK_COMPLETE") {
        console.log("Mobile callback complete detected via postMessage");
        // Trigger the same logic as direct redirect return
        const callbackPayload = consumeCallbackPayload(WHATSAPP_MOBILE_CALLBACK_KEY);
        if (callbackPayload) {
          if (callbackPayload.error || !callbackPayload.code) {
            toast.error(callbackPayload.errorDescription || "WhatsApp connection was cancelled.");
            setLoading(false);
          } else {
            setLoading(true);
            void handleSignupCompletion(callbackPayload.code, null, getWhatsAppMobileRedirectUri());
          }
        }
      }
    };
    window.addEventListener("message", mobileCallbackListener);

    return () => {
      clearSignupPoll();
      if (metaTimeoutRef.current) {
        window.clearTimeout(metaTimeoutRef.current);
      }
      metaResolverRef.current = null;
      window.removeEventListener("message", sessionInfoListener);
      window.removeEventListener("message", mobileCallbackListener);
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
  }, [officialSession]);

  const handleDisconnect = async () => {
    if (!officialSession?.name) {
      toast.error("Connected WhatsApp session not found.");
      return;
    }

    if (!window.confirm(`Are you sure you want to disconnect ${officialSession.name}?`)) {
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
      toast.error("Connected WhatsApp session not found.");
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
      toast.success("Webhook repair request completed.");
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

  const handleSignupCompletion = async (
    code: string,
    signupMeta?: EmbeddedSignupMeta | null,
    redirectUri?: string
  ) => {
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
          redirectUri,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to complete official WhatsApp connection.");
      }

      setWabaInfo(data.data || meta);
      if (data.data?.sessionName) {
        localStorage.setItem("active_wa_session_id", data.data.sessionName);
      }
      if (data.data?.id) {
        localStorage.setItem("active_wp_db_id", String(data.data.id));
      }
      await refreshSessions();
      toast.success("Official WhatsApp connected successfully.");
      finishConnectedFlow({
        sessionName: data.data?.sessionName,
        wabaId: data.data?.wabaId,
        phoneNumberId: data.data?.phoneNumberId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to connect official WhatsApp.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mobileCallbackProcessedRef.current) {
      return;
    }

    const callbackPayload = consumeCallbackPayload(WHATSAPP_MOBILE_CALLBACK_KEY);
    if (!callbackPayload) {
      return;
    }

    mobileCallbackProcessedRef.current = true;

    if (callbackPayload.error || !callbackPayload.code) {
      toast.error(callbackPayload.errorDescription || "WhatsApp connection was cancelled or blocked.");
      setLoading(false); // Reset loading on error
      return;
    }

    setLoading(true);
    void handleSignupCompletion(callbackPayload.code, null, getWhatsAppMobileRedirectUri());
  }, []); // Run once on mount

  const launchWhatsAppSignup = (forceNew: boolean = false) => {
    if (forceNew) {
      embeddedSignupMetaRef.current = {};
      localStorage.removeItem("active_wa_session_id");
      localStorage.removeItem("active_wp_db_id");
      setCurrentSession(null);
    }

    if (isMobile) {
      beginWhatsAppMobileOAuth();
      return;
    }

    if (!sdkReady || !window.FB) {
      toast.error("Facebook SDK is still loading. Please try again.");
      return;
    }

    toast.info("When the Meta Popup opens, please try to select an existing WhatsApp Business account if available.", {
      duration: 6000,
    });

    embeddedSignupMetaRef.current = {};
    setLoading(true);
    clearSignupPoll();

    // MOBILE FIX: Start polling for session completion in case postMessage fails
    const startTime = Date.now();
    const existingOfficialNames = new Set(
      sessionsRef.current
        .filter((session) => session.provider_type === "official" || String(session.name || "").startsWith("official_"))
        .map((session) => session.name)
    );

    pollIntervalRef.current = window.setInterval(async () => {
      // Stop polling after 5 minutes
      if (Date.now() - startTime > 5 * 60 * 1000) {
        clearSignupPoll();
        setLoading(false);
        return;
      }

      try {
        const token = localStorage.getItem("auth_token");
        if (!token) return;

        const res = await fetch(`${BACKEND_URL}/api/whatsapp/sessions`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (res.ok) {
          const sessionsData = await res.json();
          if (Array.isArray(sessionsData) && sessionsData.length > 0) {
            const detectedOfficial = sessionsData.find((session) =>
              (session.provider_type === "official" || String(session.name || "").startsWith("official_")) &&
              !existingOfficialNames.has(session.name)
            );

            if (detectedOfficial) {
              console.log("New session detected via polling!");
              await refreshSessions();
              clearSignupPoll();
              toast.success("WhatsApp connected successfully (detected via sync).");
              finishConnectedFlow({
                sessionName: detectedOfficial.name,
                wabaId: detectedOfficial.waba_id,
                phoneNumberId: detectedOfficial.phone_number_id,
              });
            }
          }
        }
      } catch (e) {
        // Silent poll error
      }
    }, 5000);

    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          // MOBILE RECOVERY: If stuck in loading but no code, show reset option after timeout
          setTimeout(() => {
            if (loadingRef.current) {
               setLoading(false);
               clearSignupPoll();
               toast.error("Facebook connection timed out or was blocked by the app. Try using 'Desktop Site' mode if this persists.");
            }
          }, 8000);
          return;
        }

        void (async () => {
          const signupMeta = await waitForEmbeddedSignupMeta();
          await handleSignupCompletion(code, signupMeta);
          clearSignupPoll();
        })();
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        // MOBILE OPTIMIZATION: Use 'rerequest' and 'popup' to force browser behavior
        auth_type: 'rerequest',
        display: 'popup',
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
          <div className="rounded-[28px] border border-white/5 bg-[#121212] p-5 text-white">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-primary text-black hover:bg-primary/90">
                    <Facebook className="mr-1 h-3.5 w-3.5" />
                    Meta Connected
                  </Badge>
                  <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                    Coexistence Ready
                  </Badge>
                </div>
                <div>
                  <p className="text-xl font-semibold">Official WhatsApp Business number connected</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Your mobile app and Cloud API chatbot will work simultaneously with the same number. You can reconnect or disconnect your session here.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-3 text-sm text-white min-w-[200px]">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Active Session</p>
                  <p className="mt-1 break-all font-medium">{officialSession?.name || "official_session"}</p>
                </div>
                <Button 
                  onClick={() => launchWhatsAppSignup(true)}
                  disabled={loading || (!isMobile && !sdkReady)}
                  variant="outline" 
                  className="w-full border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/40 rounded-xl"
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Connect Another Number
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            <div className="rounded-3xl border border-white/10 bg-[#121212] p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Connection</p>
              <p className="font-semibold text-primary">Live</p>
              <p className="mt-1 text-xs text-slate-400">Webhook, token, and session linked.</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#121212] p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Phone ID</p>
              <p className="font-mono break-all text-white">{wabaInfo?.phoneNumberId || "Pending sync"}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#121212] p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">WABA ID</p>
              <p className="font-mono break-all text-white">{wabaInfo?.wabaId || "Pending sync"}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-[#121212] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <MessageSquare className="h-4 w-4 text-primary" />
                Chatbot Control
              </div>
              <p className="mt-2 text-xs text-slate-400">Manage reply behavior, live bot, orders, and prompts.</p>
              <Button onClick={() => navigate("/dashboard/whatsapp/control")} className="mt-4 w-full bg-primary text-black hover:bg-primary/90">
                Manage Chatbot
              </Button>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#121212] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Settings2 className="h-4 w-4 text-primary" />
                AI Setup
              </div>
              <p className="mt-2 text-xs text-slate-400">Update prompts, models, delay, order email, and memory limits.</p>
              <Button onClick={() => navigate("/dashboard/whatsapp/settings")} variant="outline" className="mt-4 w-full border-white/10 hover:bg-white/5 text-white">
                Open Settings
              </Button>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#121212] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Link2 className="h-4 w-4 text-primary" />
                Connection Actions
              </div>
              <p className="mt-2 text-xs text-slate-400">Repair webhook issues, reconnect if the mobile app disconnects, or perform a clean disconnect.</p>
              <div className="mt-4 grid gap-2">
                <Button
                  onClick={handleRepairWebhook}
                  disabled={repairing || loading || disconnecting}
                  variant="outline"
                  className="w-full rounded-xl border-white/10 hover:bg-white/5 text-white"
                >
                  {repairing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {repairing ? "Repairing..." : "Repair Webhook"}
                </Button>
                <Button
                  onClick={() => launchWhatsAppSignup()}
                  disabled={loading || (!isMobile && !sdkReady) || disconnecting || repairing}
                  className="w-full rounded-xl bg-primary text-black hover:bg-primary/90"
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

          <div className="rounded-3xl border border-white/10 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
              <div className="space-y-1 text-sm text-slate-400">
                <p className="font-medium text-white">Coexistence note</p>
                <p>By selecting an existing WhatsApp Business App number in the Meta popup, you can use the app and the bot simultaneously on the same number.</p>
                <p>If the number becomes unlinked from Meta, simply complete the connection flow again to refresh the session.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 text-sm ${
            usesLocalBackend
              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
              : "border-primary/20 bg-primary/5 text-primary"
          }`}>
            <p className="font-medium">Webhook setup check</p>
            <p className="mt-2 break-all">
              Callback URL: <span className="font-mono">{officialWebhookUrl}</span>
            </p>
            <p className="mt-2 text-xs leading-5">
              {usesLocalBackend
                ? "Your frontend is currently using a localhost backend. Meta cannot send webhooks to localhost, so the chatbot will not receive incoming messages. Please use a public HTTPS backend URL."
                : "This public callback URL must be set in Meta Developers > WhatsApp > Webhooks, and the `messages` field must be subscribed."}
            </p>
          </div>

          <div className="rounded-[28px] border border-white/5 bg-[#121212] p-5 md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-primary text-black">Official Integration</Badge>
                  <Badge variant="outline" className="border-white/10 text-white">Meta Business Suite</Badge>
                </div>
                <h3 className="text-2xl font-bold text-white">Connect your WhatsApp Business Account</h3>
                <p className="text-slate-400">
                  Follow the official Meta onboarding process to connect your WhatsApp Business number. This allows you to use the AI chatbot while keeping your mobile app active.
                </p>
              </div>
              <Button 
                size="lg" 
                onClick={() => launchWhatsAppSignup()} 
                disabled={loading || (!isMobile && !sdkReady)}
                className="h-14 px-8 rounded-2xl text-lg font-semibold shadow-lg shadow-primary/20 bg-primary text-black hover:bg-primary/90"
              >
                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Facebook className="mr-2 h-5 w-5" />}
                {loading ? "Connecting..." : "Connect with Facebook"}
              </Button>
              {loading && (
                <button 
                  onClick={() => { setLoading(false); window.location.reload(); }}
                  className="mt-2 text-xs text-slate-500 underline hover:text-slate-300"
                >
                  Stuck? Click to reset and try again
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
