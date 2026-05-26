import React from "react";
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
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <Smartphone className="text-primary h-8 w-8" />
            WhatsApp Official Manager
          </h1>
          <p className="text-gray-400 mt-2 font-medium">
            Connect Meta official WhatsApp, keep coexistence support, and run your chatbot without QR sessions.
          </p>
          <div className="mt-2">
            <WorkspaceSwitcher platform="whatsapp" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-400">
            Integration Fee: Free
          </Badge>
          <Button onClick={() => refreshSessions()} variant="outline" size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="bg-[#0f0f0f]/80 border border-white/10 rounded-2xl">
        <CardHeader>
          <CardTitle className="text-white">Connect Official WhatsApp</CardTitle>
          <CardDescription>
            Only Meta official Cloud API is enabled here. QR-based third-party session onboarding has been removed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-slate-300 space-y-1">
            <p>No dashboard integration fee for session setup.</p>
            <p>Your users can connect existing WhatsApp Business App numbers through coexistence.</p>
            <p>Meta template and bulk messaging charges may still apply outside free support windows.</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
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
          <Card className="bg-[#0f0f0f]/80 border border-dashed border-white/10 rounded-2xl">
            <CardContent className="py-12 text-center space-y-3">
              <CheckCircle2 className="mx-auto h-10 w-10 text-slate-500" />
              <div>
                <p className="text-white font-semibold">No official WhatsApp connected yet</p>
                <p className="text-sm text-slate-400">Use the official Meta flow above to connect your first chatbot number.</p>
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
