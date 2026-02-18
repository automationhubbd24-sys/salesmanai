import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Database, Search, CheckCircle, XCircle, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";

interface WhatsAppDbConfig {
  id: number;
  session?: string;
  session_name?: string;
  verified?: boolean;
}

export default function DatabasePage() {
  const [searchId, setSearchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectedDb, setConnectedDb] = useState<WhatsAppDbConfig | null>(null);

  useEffect(() => {
    // Check if already connected
    const checkConnection = () => {
      const storedId = localStorage.getItem("active_wp_db_id");
      if (storedId) {
        setSearchId(storedId);
        fetchDatabase(storedId);
      } else {
        setConnectedDb(null);
        setSearchId("");
      }
    };

    checkConnection();

    // Listen for storage changes (from other tabs or same tab custom event)
    window.addEventListener("storage", checkConnection);
    window.addEventListener("db-connection-changed", checkConnection);

    return () => {
      window.removeEventListener("storage", checkConnection);
      window.removeEventListener("db-connection-changed", checkConnection);
    };
  }, []);

  const fetchDatabase = async (id: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        toast.error("Please login again");
        setConnectedDb(null);
        localStorage.removeItem("active_wp_db_id");
        return;
      }

      const res = await fetch(`${BACKEND_URL}/whatsapp/config/${id}`, {
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
        localStorage.setItem("active_wp_db_id", id);
      } else {
        toast.error("Database not found");
        localStorage.removeItem("active_wp_db_id");
        setConnectedDb(null);
      }
    } catch (error) {
      console.error("Error fetching DB:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Database ID not found or connection failed";
      toast.error(message);
      if (localStorage.getItem("active_wp_db_id") === id) {
        localStorage.removeItem("active_wp_db_id");
        setConnectedDb(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    if (!searchId || searchId.length < 6) {
      toast.error("Please enter a valid 6-digit ID");
      return;
    }
    fetchDatabase(searchId);
  };

  const handleDisconnect = () => {
    localStorage.removeItem("active_wp_db_id");
    setConnectedDb(null);
    setSearchId("");
    toast.info("Disconnected from database");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Database Connect</h2>
        <p className="text-muted-foreground">
          Connect to your WhatsApp Message Database using your unique ID.
        </p>
      </div>

      {/* Connection Status Card */}
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
                      <span>Connected</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <XCircle className="h-4 w-4" />
                      <span>Disconnected</span>
                    </span>
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
                      {connectedDb.session || connectedDb.session_name || "-"}
                    </p>
                    <div className="flex gap-2 mt-1">
                        <div className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold border ${
                          connectedDb.verified
                            ? "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/50"
                            : "bg-destructive/10 text-destructive border-destructive/40"
                        }`}>
                          {connectedDb.verified ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          <span>{connectedDb.verified ? "Verified" : "Unverified / Expired"}</span>
                        </div>
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

      {/* Connect Form */}
      <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
        <CardHeader>
          <CardTitle>{connectedDb ? "Database Details" : "Connect to Database"}</CardTitle>
          <CardDescription>
            {connectedDb 
                ? `Connected to ID: ${connectedDb.id}` 
                : "Enter the 6-digit Database ID provided during session creation."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1 w-full">
              <Label htmlFor="db-id">Database ID</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                    id="db-id" 
                    placeholder="e.g. 123456" 
                    className="pl-9" 
                    value={searchId}
                    onChange={(e) => setSearchId(e.target.value)}
                    disabled={!!connectedDb}
                />
              </div>
            </div>
            
            {connectedDb ? (
                <Button variant="destructive" onClick={handleDisconnect} className="w-full md:w-auto">
                    <LogOut className="mr-2 h-4 w-4" />
                    Disconnect
                </Button>
            ) : (
                <Button onClick={handleConnect} disabled={loading} className="w-full md:w-auto min-w-[120px]">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                    Connect
                </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
