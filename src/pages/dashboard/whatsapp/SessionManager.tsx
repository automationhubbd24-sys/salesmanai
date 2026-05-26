import { useNavigate } from "react-router-dom";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import WhatsAppOfficialIntegration from "@/components/dashboard/whatsapp/WhatsAppOfficialIntegration";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

type SessionWithMeta = {
  name: string;
  status?: string;
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

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="overflow-hidden rounded-3xl border border-emerald-500/10 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_rgba(2,6,23,0.96)_38%,_rgba(2,6,23,1)_100%)]">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Official WhatsApp Cloud API
              </div>
              <h1 className="mt-4 flex items-center gap-3 text-3xl font-black tracking-tight text-white md:text-4xl">
                <Smartphone className="h-8 w-8 text-primary" />
                WhatsApp Integration
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-300 md:text-base">
                Connect Meta official WhatsApp and manage one clean integration for bot, database, settings, and orders.
              </p>
              <div className="mt-4">
                <WorkspaceSwitcher platform="whatsapp" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="border-green-500/30 bg-green-500/10 px-3 py-1 text-green-400">
                Integration Fee: Free
              </Badge>
              <Button onClick={() => refreshSessions()} variant="outline" size="sm" className="border-white/10 bg-black/20">
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Flow</p>
              <p className="mt-2 text-lg font-semibold text-white">Official Only</p>
              <p className="mt-1 text-sm text-slate-400">Meta Cloud API only. Legacy QR flow stays hidden.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Style</p>
              <p className="mt-2 text-lg font-semibold text-white">Supported</p>
              <p className="mt-1 text-sm text-slate-400">Existing WhatsApp Business App numbers can stay active.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Connected</p>
              <p className="mt-2 text-lg font-semibold text-white">{officialSessions.length}</p>
              <p className="mt-1 text-sm text-slate-400">Use one active integration for bot, settings, and orders.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-white/10 bg-[#0b1220]/90 shadow-[0_18px_60px_rgba(2,6,23,0.28)]">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-white">Connect WhatsApp</CardTitle>
              <CardDescription className="mt-1">
                Facebook-style simple onboarding for Meta official WhatsApp.
              </CardDescription>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              Recommended
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-slate-300">
            Connect one official integration, then use `Manage` to control bot, database, settings, and orders from the same place.
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4 md:p-5">
            <WhatsAppOfficialIntegration />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Connected Integrations</h2>
            <p className="text-sm text-slate-400">Keep it simple. Pick one integration and manage everything from there.</p>
          </div>
          <Badge variant="secondary" className="bg-slate-800 text-slate-200">
            {officialSessions.length} Connected
          </Badge>
        </div>

        {loading ? (
          <Card className="bg-[#0f0f0f]/80 border border-white/10 rounded-2xl">
            <CardContent className="py-10 flex items-center justify-center text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading WhatsApp connections...
            </CardContent>
          </Card>
        ) : officialSessions.length === 0 ? (
          <Card className="rounded-3xl border border-dashed border-white/10 bg-[#0f0f0f]/80">
            <CardContent className="py-14 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-slate-900/80">
                <CheckCircle2 className="h-7 w-7 text-slate-500" />
              </div>
              <div>
                <p className="text-white font-semibold">No WhatsApp integration connected yet</p>
                <p className="mx-auto mt-1 max-w-xl text-sm text-slate-400">
                  Use the official Meta onboarding flow above to connect your first chatbot number. After connection, the `Manage` button opens your active bot workspace.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {officialSessions.map((session) => {
              const isActive = currentSession?.name === session.name;

              return (
                <Card
                  key={session.name}
                  className="bg-[#0f0f0f]/80 border border-white/10 hover:border-green-500/30 transition-colors rounded-2xl"
                >
                  <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-white break-all">{session.name}</p>
                        <Badge className={isActive ? "bg-green-600 text-white" : "bg-slate-700 text-slate-100"}>
                          {isActive ? "Active" : "Connected"}
                        </Badge>
                        {session.is_shared ? (
                          <Badge variant="outline" className="border-white/10 text-slate-300">
                            Shared
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-slate-400">
                        {isActive
                          ? "This integration is currently powering your bot workspace."
                          : "Set this as active and open the manage workspace."}
                      </p>
                      <div className="flex flex-col gap-1 text-xs text-slate-500 md:flex-row md:flex-wrap md:gap-4">
                        <span className="font-mono">WABA: {session.waba_id || "Pending sync"}</span>
                        <span className="font-mono">Phone ID: {session.phone_number_id || "Pending sync"}</span>
                      </div>
                    </div>

                    <Button className="min-w-[160px] bg-[#1877F2] hover:bg-[#166fe5]" onClick={() => handleManage(session)}>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Manage
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
