import { useNavigate } from "react-router-dom";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import WhatsAppOfficialIntegration from "@/components/dashboard/whatsapp/WhatsAppOfficialIntegration";
import { BACKEND_URL } from "@/config";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

type SessionWithMeta = {
  name: string;
  status?: string;
  db_status?: string;
  subscription_status?: string;
  provider_type?: string;
  wp_db_id?: number;
  waba_id?: string;
  phone_number_id?: string;
  is_shared?: boolean;
};

export default function SessionManager() {
  const navigate = useNavigate();
  const { sessions, currentSession, refreshSessions, loading, setCurrentSession } = useWhatsApp();

  const officialSessions = (sessions as SessionWithMeta[]).filter(
    (session) => session.provider_type === "official" || session.name.startsWith("official_")
  );

  const selectSession = (session: SessionWithMeta) => {
    setCurrentSession(session);
    toast.success(`${session.name} is now active for your WhatsApp integration.`);
  };

  const handleManage = (session: SessionWithMeta) => {
    selectSession(session);
    navigate("/dashboard/whatsapp/control");
  };

  const handleReconnectHelp = (session: SessionWithMeta) => {
    selectSession(session);
    document.getElementById("whatsapp-connect-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.info("Uporer Reconnect button diye abar Meta signup flow complete korun.");
  };

  const scrollToConnectCard = () => {
    document.getElementById("whatsapp-connect-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDisconnect = async (session: SessionWithMeta) => {
    if (!window.confirm(`Apni ki ${session.name} disconnect korte chan? Ete bot reply off hoye jabe.`)) {
      return;
    }

    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again");
      }

      const response = await fetch(`${BACKEND_URL}/api/whatsapp/official/${encodeURIComponent(session.name)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Failed to disconnect WhatsApp");
      }

      if (currentSession?.name === session.name) {
        localStorage.removeItem("active_wa_session_id");
        localStorage.removeItem("active_wp_db_id");
        setCurrentSession(null);
      }

      await refreshSessions();
      toast.success(`${session.name} disconnected successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to disconnect WhatsApp.";
      toast.error(message);
    }
  };

  const getStatusMeta = (session: SessionWithMeta) => {
    const status = String(session.status || session.db_status || "").toUpperCase();
    const hasOfficialCredentials = !!session.phone_number_id;
    const subscriptionStatus = String(session.subscription_status || "").toLowerCase();
    const hasUsablePlan = ["active", "trial", "active_trial", "active_paid", "none"].includes(subscriptionStatus);
    const isHealthyOfficialConnection = hasOfficialCredentials && hasUsablePlan;
    const needsReconnect = !isHealthyOfficialConnection && !!status && !["WORKING", "ACTIVE", "CONNECTED"].includes(status);

    if (needsReconnect) {
      return {
        label: "Reconnect Needed",
        className: "bg-amber-500/15 text-amber-300 hover:bg-amber-500/15",
      };
    }

    return {
      label: currentSession?.name === session.name ? "Active" : "Connected",
      className:
        currentSession?.name === session.name
          ? "bg-green-600 text-white hover:bg-green-600"
          : "bg-slate-700 text-slate-100 hover:bg-slate-700",
    };
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <WorkspaceSwitcher platform="whatsapp" />
        </div>

        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <Button variant="outline" onClick={() => refreshSessions()} className="w-full sm:w-auto border-white/10 bg-black/20">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={scrollToConnectCard} className="w-full sm:w-auto bg-[#1877F2] hover:bg-[#166fe5]">
            <Smartphone className="mr-2 h-4 w-4" />
            {officialSessions.length > 0 ? "Connect Another Number" : "Connect WhatsApp"}
          </Button>
        </div>
      </div>

      <Card id="whatsapp-connect-card" className="rounded-3xl border border-white/10 bg-[#0b1220]/90 shadow-[0_18px_60px_rgba(2,6,23,0.28)]">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-white">Connect WhatsApp</CardTitle>
              <CardDescription className="mt-1">
                Facebook-style official onboarding, reconnect, disconnect, and active number management ek jaygay.
              </CardDescription>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">Official</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4 md:p-5">
            <WhatsAppOfficialIntegration />
          </div>
          {loading ? (
            <div className="rounded-3xl border border-white/10 bg-[#0f0f0f]/80 px-4 py-10 text-center text-slate-400">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mt-3">Loading official WhatsApp connection...</p>
            </div>
          ) : officialSessions.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-[#0f0f0f]/80 px-4 py-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-slate-900/80">
                <CheckCircle2 className="h-7 w-7 text-slate-500" />
              </div>
              <p className="mt-4 text-white font-semibold">No official WhatsApp number connected yet</p>
              <p className="mx-auto mt-1 max-w-xl text-sm text-slate-400">Uporer button diye official Meta flow complete korun.</p>
            </div>
          ) : (
            <div className="space-y-3 rounded-3xl border border-white/10 bg-[#0f0f0f]/75 p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Active Official Numbers</p>
                  <p className="text-xs text-slate-400">Ei card thekei manage, reconnect, ar disconnect korte parben.</p>
                </div>
                <Badge variant="secondary" className="bg-slate-800 text-slate-200">
                  {officialSessions.length} Connected
                </Badge>
              </div>
              {officialSessions.map((session) => {
                const isActive = currentSession?.name === session.name;
                const statusMeta = getStatusMeta(session);
                const hasPhoneId = !!session.phone_number_id;

                return (
                  <div
                    key={session.name}
                    className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 transition-colors hover:border-green-500/30"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-white break-all">{session.name}</p>
                          <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                          {session.is_shared ? (
                            <Badge variant="outline" className="border-white/10 text-slate-300">
                              Shared
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-slate-400">
                          {statusMeta.label === "Reconnect Needed"
                            ? "Number disconnected hole reconnect diye abar connect korun."
                            : isActive
                              ? "Ei official number-ta ekhon active workspace hisebe selected."
                              : "Manage e click korle ei number-er control, settings, conversion, order tracking open hobe."}
                        </p>
                        <div className="flex flex-col gap-1 text-xs text-slate-500 md:flex-row md:flex-wrap md:gap-4">
                          <span className="font-mono">{hasPhoneId ? `Phone ID: ${session.phone_number_id}` : "Phone ID: Pending sync"}</span>
                          {session.waba_id ? <span className="font-mono">WABA: {session.waba_id}</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="min-w-[140px] border-white/10" onClick={() => handleReconnectHelp(session)}>
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Reconnect
                        </Button>
                        <Button className="min-w-[140px] bg-[#1877F2] hover:bg-[#166fe5]" onClick={() => handleManage(session)}>
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Manage
                        </Button>
                        <Button variant="destructive" className="min-w-[140px]" onClick={() => handleDisconnect(session)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Disconnect
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
