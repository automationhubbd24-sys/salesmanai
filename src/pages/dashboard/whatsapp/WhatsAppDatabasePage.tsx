import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, CheckCircle, Loader2, Link2, MessageSquare, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import { useWhatsApp } from "@/context/WhatsAppContext";

interface WhatsAppDbConfig {
  id: number;
  session?: string;
  session_name?: string;
  verified?: boolean;
  provider_type?: string;
  status?: string;
  subscription_status?: string;
  phone_number_id?: string;
  waba_id?: string;
}

export default function DatabasePage() {
  const { currentSession, refreshSessions } = useWhatsApp();
  const [loading, setLoading] = useState(false);
  const [connectedDb, setConnectedDb] = useState<WhatsAppDbConfig | null>(null);
  const activeDbId = (currentSession as any)?.wp_db_id
    || (typeof window !== "undefined" ? Number(localStorage.getItem("active_wp_db_id") || 0) : 0)
    || 0;
  const activeSessionName = currentSession?.name
    || (typeof window !== "undefined" ? localStorage.getItem("active_wa_session_id") : null)
    || "";

  useEffect(() => {
    if (activeDbId > 0) {
      void fetchDatabase(String(activeDbId));
      return;
    }
    setConnectedDb(null);
  }, [activeDbId, currentSession]);

  const fetchDatabase = async (id: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        toast.error("Please login again");
        setConnectedDb(null);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${id}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.error || "Database not found";
        throw new Error(message);
      }

      const data: WhatsAppDbConfig = await res.json();

      if (data) {
        setConnectedDb(data);
      } else {
        toast.error("Official WhatsApp row not found");
        setConnectedDb(null);
      }
    } catch (error) {
      console.error("Error fetching DB:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Official WhatsApp row not found or connection failed";
      toast.error(message);
      setConnectedDb(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Official Connection Info</h2>
        <p className="text-muted-foreground">
          Official WhatsApp Cloud API row auto-create hoy. Eikhane current connection-er DB details dekhano hocche.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <div className="mt-2 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold gap-2 bg-background/40">
                  {connectedDb ? (
                    <span className="inline-flex items-center gap-1 text-[#00ff88]">
                      <CheckCircle className="h-4 w-4" />
                      <span>Official Connected</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400">Not Selected</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#00ff88]/10 border border-[#00ff88]/40">
                <Database className="h-5 w-5 text-[#00ff88]" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        {connectedDb && (
          <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 md:col-span-2">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Session</p>
                  <p className="text-xl font-bold text-foreground truncate max-w-[200px] md:max-w-md">
                    {connectedDb.session || connectedDb.session_name || activeSessionName || "-"}
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <div className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold border ${
                      connectedDb.verified !== false
                        ? "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/50"
                        : "bg-destructive/10 text-destructive border-destructive/40"
                    }`}>
                      <CheckCircle className="h-3 w-3" />
                      <span>{connectedDb.verified !== false ? "Verified / Active" : "Needs Review"}</span>
                    </div>
                    <Badge variant="outline" className="border-white/10 text-slate-300">
                      {connectedDb.provider_type || "official"}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 border border-primary/40">
                  <Database className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{connectedDb ? "Connection Details" : "No Official Connection Selected"}</CardTitle>
              <CardDescription>
                {connectedDb
                  ? "Official WhatsApp row-ta automatic create/update hoy signup completion-er por."
                  : "Session page theke official WhatsApp select korle ekhane DB row details dekhabe."}
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => { void refreshSessions(); if (activeDbId > 0) void fetchDatabase(String(activeDbId)); }} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading official connection info...
            </div>
          ) : !connectedDb ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/50 p-6 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
                <Smartphone className="h-6 w-6 text-slate-400" />
              </div>
              <div>
                <p className="font-semibold text-white">No official WhatsApp connection selected</p>
                <p className="mt-1 text-sm text-slate-400">Sessions page theke official number select ba reconnect korun.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button asChild>
                  <Link to="/dashboard/whatsapp/sessions">Go to Sessions</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/dashboard/whatsapp/control">Open Bot Control</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border border-white/10 bg-slate-950/60">
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-2 text-white">
                    <Database className="h-4 w-4 text-emerald-300" />
                    <span className="font-medium">DB Mapping</span>
                  </div>
                  <div className="space-y-2 text-sm text-slate-300">
                    <p>Row ID: <span className="font-mono">{connectedDb.id}</span></p>
                    <p>Session: <span className="font-mono break-all">{connectedDb.session_name || connectedDb.session || activeSessionName || "-"}</span></p>
                    <p>Status: <span className="font-mono">{connectedDb.status || "WORKING"}</span></p>
                    <p>Plan: <span className="font-mono">{connectedDb.subscription_status || "active"}</span></p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-white/10 bg-slate-950/60">
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-2 text-white">
                    <Link2 className="h-4 w-4 text-sky-300" />
                    <span className="font-medium">Official Asset IDs</span>
                  </div>
                  <div className="space-y-2 text-sm text-slate-300">
                    <p>Phone ID: <span className="font-mono break-all">{connectedDb.phone_number_id || (currentSession as any)?.phone_number_id || "Pending sync"}</span></p>
                    <p>WABA ID: <span className="font-mono break-all">{connectedDb.waba_id || (currentSession as any)?.waba_id || "Pending sync"}</span></p>
                    <p>Provider: <span className="font-mono">{connectedDb.provider_type || "official"}</span></p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-white/10 bg-slate-950/60 md:col-span-2">
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-medium text-white">Official Flow Note</p>
                      <p className="mt-1 text-sm text-slate-400">
                        Ekhane alada database connect korar dorkar nei. Meta Embedded Signup complete hole official WhatsApp row automatic save hoy, ar control/settings/order tracking ei row-er sathei linked thake.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button variant="outline" asChild>
                        <Link to="/dashboard/whatsapp/settings">
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Open Settings
                        </Link>
                      </Button>
                      <Button asChild>
                        <Link to="/dashboard/whatsapp/control">Open Control</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
