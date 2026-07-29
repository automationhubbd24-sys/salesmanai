import { useEffect, useState } from "react";
import { CheckCircle2, Database, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

export default function InstagramDatabasePage() {
  const [databaseId, setDatabaseId] = useState(localStorage.getItem("active_ig_db_id") || "");
  const [connected, setConnected] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const connect = async (id = databaseId) => {
    if (!id) { toast.error("Database ID দিন"); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/config/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Instagram database পাওয়া যায়নি");
      const data = await response.json(); setConnected(data); setDatabaseId(id); localStorage.setItem("active_ig_db_id", id);
      if (data.page_id) localStorage.setItem("active_ig_account_id", data.page_id);
      window.dispatchEvent(new Event("instagram-account-changed")); toast.success("Instagram database connected");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Instagram database connect করা যায়নি"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (databaseId) void connect(databaseId); }, []);
  const disconnect = () => { localStorage.removeItem("active_ig_db_id"); localStorage.removeItem("active_ig_account_id"); setDatabaseId(""); setConnected(null); window.dispatchEvent(new Event("instagram-account-changed")); toast.success("Instagram database disconnected"); };

  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Instagram Database Connect</h1><p className="mt-1 text-muted-foreground">আপনার Instagram automation database connect করুন।</p></div><Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="text-pink-500" />Connection Status</CardTitle><CardDescription>{connected ? "Instagram database connected আছে" : "কোনো Instagram database connected নেই"}</CardDescription></CardHeader><CardContent>{connected ? <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-emerald-500"><CheckCircle2 /> Connected: {connected.page_id || databaseId}</div><Button variant="destructive" onClick={disconnect}>Disconnect</Button></div> : <div className="flex items-center gap-2 text-muted-foreground"><XCircle /> Disconnected</div>}</CardContent></Card><Card><CardHeader><CardTitle>Connect Database</CardTitle><CardDescription>Instagram integration থেকে পাওয়া database ID ব্যবহার করুন।</CardDescription></CardHeader><CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="flex-1"><Label>Database ID</Label><Input value={databaseId} onChange={event => setDatabaseId(event.target.value)} placeholder="Database ID" /></div><Button onClick={() => void connect()} disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect</Button></CardContent></Card></div>;
}
