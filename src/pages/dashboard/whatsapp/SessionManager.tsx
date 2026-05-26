import { Link } from "react-router-dom";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import WhatsAppOfficialIntegration from "@/components/dashboard/whatsapp/WhatsAppOfficialIntegration";
import {
  CheckCircle2,
  ClipboardList,
  Database,
  Loader2,
  MessageSquare,
  RefreshCw,
  Settings,
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
  const { sessions, currentSession, refreshSessions, loading, setCurrentSession } = useWhatsApp();

  const officialSessions = (sessions as SessionWithMeta[]).filter(
    (session) => session.provider_type === "official" || session.name.startsWith("official_")
  );

  const selectSession = (session: SessionWithMeta) => {
    setCurrentSession(session);
    toast.success(`${session.name} is now active for your chatbot dashboard.`);
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
                WhatsApp Official Manager
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-300 md:text-base">
                Connect Meta official WhatsApp, keep coexistence support, and run your chatbot without QR sessions or third-party pairing flow.
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
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Connection Model</p>
              <p className="mt-2 text-lg font-semibold text-white">Official Only</p>
              <p className="mt-1 text-sm text-slate-400">Legacy QR onboarding is removed from this page.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coexistence</p>
              <p className="mt-2 text-lg font-semibold text-white">Supported</p>
              <p className="mt-1 text-sm text-slate-400">Existing WhatsApp Business App numbers can stay active.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Connected Accounts</p>
              <p className="mt-2 text-lg font-semibold text-white">{officialSessions.length}</p>
              <p className="mt-1 text-sm text-slate-400">Use one active connection for bot, settings, and orders.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-white/10 bg-[#0b1220]/90 shadow-[0_18px_60px_rgba(2,6,23,0.28)]">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-white">Connect Official WhatsApp</CardTitle>
              <CardDescription className="mt-1">
                Only Meta official Cloud API is enabled here. The design below guides users through the stable onboarding path.
              </CardDescription>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              Recommended
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-slate-300">
              No dashboard integration fee for session setup.
            </div>
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-slate-300">
              Users can connect an existing WhatsApp Business App number via coexistence.
            </div>
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-slate-300">
              Meta template and bulk messaging charges may still apply outside support windows.
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-4 md:p-5">
            <WhatsAppOfficialIntegration />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Connected Official Accounts</h2>
            <p className="text-sm text-slate-400">Use one connection at a time for settings, database, control, and orders.</p>
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
                <p className="text-white font-semibold">No official WhatsApp connected yet</p>
                <p className="mx-auto mt-1 max-w-xl text-sm text-slate-400">
                  Use the official Meta onboarding flow above to connect your first chatbot number. After connection, settings, database, and order tools will activate automatically.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {officialSessions.map((session) => {
              const isActive = currentSession?.name === session.name;

              return (
                <Card
                  key={session.name}
                  className="bg-[#0f0f0f]/80 border border-white/10 hover:border-green-500/30 transition-colors rounded-2xl"
                >
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-white text-lg break-all">{session.name}</CardTitle>
                        <CardDescription className="mt-1">
                          {session.is_shared ? "Shared team connection" : "Personal official connection"}
                        </CardDescription>
                      </div>
                      <Badge className={isActive ? "bg-green-600 text-white" : "bg-slate-700 text-slate-100"}>
                        {isActive ? "Active" : "Connected"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-900/70 px-3 py-2 border border-white/5">
                        <p className="text-slate-500 mb-1">WABA ID</p>
                        <p className="font-mono break-all text-slate-200">{session.waba_id || "Pending sync"}</p>
                      </div>
                      <div className="rounded-lg bg-slate-900/70 px-3 py-2 border border-white/5">
                        <p className="text-slate-500 mb-1">Phone Number ID</p>
                        <p className="font-mono break-all text-slate-200">{session.phone_number_id || "Pending sync"}</p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => selectSession(session)}>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      {isActive ? "Active For Chatbot" : "Use For Chatbot"}
                    </Button>

                    <div className="grid grid-cols-3 gap-2">
                      <Button variant="outline" asChild className="border-white/10">
                        <Link to="/dashboard/whatsapp/control" onClick={() => selectSession(session)}>
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Control
                        </Link>
                      </Button>
                      <Button variant="outline" asChild className="border-white/10">
                        <Link to="/dashboard/whatsapp/database" onClick={() => selectSession(session)}>
                          <Database className="mr-2 h-4 w-4" />
                          Database
                        </Link>
                      </Button>
                      <Button variant="outline" asChild className="border-white/10">
                        <Link to="/dashboard/whatsapp/settings" onClick={() => selectSession(session)}>
                          <Settings className="mr-2 h-4 w-4" />
                          Settings
                        </Link>
                      </Button>
                    </div>

                    <Button variant="secondary" asChild className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100">
                      <Link to="/dashboard/whatsapp/orders" onClick={() => selectSession(session)}>
                        <ClipboardList className="mr-2 h-4 w-4" />
                        Open Orders
                      </Link>
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
