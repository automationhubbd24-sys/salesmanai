import { useEffect, useState } from "react";
import { CheckCircle2, Database, Loader2, LogOut, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInstagram } from "@/context/InstagramContext";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

export default function InstagramDatabasePage() {
  const { accounts, currentAccount, setCurrentAccount, loading: accountsLoading } = useInstagram();
  const [searchId, setSearchId] = useState("");
  const [connectedDb, setConnectedDb] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDatabase = async (id: string, shouldSelect = true) => {
    if (!id) { toast.error("Database ID দিন"); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/config/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Instagram database পাওয়া যায়নি বা access নেই");
      const data = await response.json();
      setConnectedDb(data); setSearchId(id);
      const account = accounts.find(item => item.page_id === data.page_id) || { page_id: data.page_id, name: currentAccount?.name || "Instagram Account", db_id: Number(id) };
      if (shouldSelect && account.page_id) setCurrentAccount(account);
      toast.success("Instagram database connected");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Instagram database connect করা যায়নি"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (currentAccount?.db_id || currentAccount?.id) {
      const id = String(currentAccount.db_id || currentAccount.id);
      setSearchId(id); void fetchDatabase(id, false);
    } else { setConnectedDb(null); setSearchId(""); }
  }, [currentAccount?.page_id]);

  const disconnect = () => { setCurrentAccount(null); setConnectedDb(null); setSearchId(""); toast.success("Instagram database disconnected"); };
  const connectedPageId = String(connectedDb?.page_id || currentAccount?.page_id || "");

  if (accountsLoading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Instagram Database Connect</h1><p className="mt-1 text-muted-foreground">Instagram account-এর automation database নির্বাচন ও যাচাই করুন।</p></div><div className="grid gap-4 md:grid-cols-3"><Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">Status</p><div className="mt-2 flex items-center gap-2 font-semibold">{connectedDb ? <><CheckCircle2 className="h-4 w-4 text-emerald-500" />Connected</> : <><XCircle className="h-4 w-4 text-muted-foreground" />Disconnected</>}</div></div><Database className="h-9 w-9 rounded-full bg-pink-500/10 p-2 text-pink-500" /></CardContent></Card>{connectedDb && <Card className="md:col-span-2"><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">Active Instagram Account</p><p className="text-lg font-bold">{currentAccount?.name || connectedPageId}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{connectedPageId}</p></div><CheckCircle2 className="h-8 w-8 text-emerald-500" /></CardContent></Card>}</div><Card><CardHeader><CardTitle>{connectedDb ? "Database Details" : "Connect Database"}</CardTitle><CardDescription>{connectedDb ? `Connected database ID: ${String(connectedDb.id || searchId)}` : "Integration থেকে পাওয়া Instagram database ID দিন।"}</CardDescription></CardHeader><CardContent><div className="flex flex-col items-end gap-4 sm:flex-row"><div className="w-full flex-1 space-y-2"><Label htmlFor="instagram-db-id">Database ID</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="instagram-db-id" className="pl-9" value={searchId} onChange={event => setSearchId(event.target.value)} placeholder="e.g. 123456" disabled={Boolean(connectedDb)} /></div></div>{connectedDb ? <Button variant="destructive" onClick={disconnect}><LogOut className="mr-2 h-4 w-4" />Disconnect</Button> : <Button onClick={() => void fetchDatabase(searchId)} disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}Connect</Button>}</div></CardContent></Card></div>;
}
