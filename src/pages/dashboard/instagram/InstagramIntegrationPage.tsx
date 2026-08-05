import { useEffect, useState } from "react";
import { Facebook, Instagram, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type InstagramAccount = { page_id: string; name: string; id?: number; db_id?: number };

declare global {
  interface Window { fbAsyncInit: () => void; FB: any; }
}

export default function InstagramIntegrationPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/pages`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Instagram accounts load করা যায়নি");
      }
      setAccounts(await response.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Instagram accounts load করা যায়নি");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.fbAsyncInit = function () {
      window.FB.init({ appId: import.meta.env.VITE_FACEBOOK_APP_ID || "", cookie: true, xfbml: true, version: "v25.0" });
    };
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(script);
    }
    void loadAccounts();
  }, []);

  const handleAutoConnect = async () => {
    if (!window.FB) {
      toast.error("Meta SDK এখনো load হয়নি, একটু পরে আবার চেষ্টা করুন");
      return;
    }
    if (!import.meta.env.VITE_FACEBOOK_APP_ID) {
      toast.error("VITE_FACEBOOK_APP_ID সেট করা নেই");
      return;
    }

    setAutoConnecting(true);
    try {
      const loginResponse: any = await new Promise((resolve, reject) => {
        window.FB.login((response: any) => {
          if (response.authResponse?.accessToken) resolve(response);
          else reject(new Error("Meta login cancel হয়েছে বা permission দেওয়া হয়নি"));
        }, { scope: "email,public_profile,pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages,business_management" });
      });

      let finalToken = loginResponse.authResponse.accessToken;
      const exchangeResponse = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortLivedToken: finalToken }),
      });
      if (exchangeResponse.ok) {
        const exchangeData = await exchangeResponse.json();
        if (exchangeData.access_token) finalToken = exchangeData.access_token;
      }

      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/pages/auto-connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ accessToken: finalToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Instagram auto connect করা যায়নি");

      const connected = Array.isArray(data.connected) ? data.connected : [];
      if (connected.length === 0) {
        toast.warning("Linked Instagram Professional account পাওয়া যায়নি। Manual connect ব্যবহার করুন।");
      } else {
        const first = connected[0];
        localStorage.setItem("active_ig_account_id", first.page_id);
        localStorage.setItem("active_ig_db_id", String(first.db_id || ""));
        window.dispatchEvent(new Event("instagram-account-changed"));
        toast.success(`${connected.length} Instagram account auto connected`);
        await loadAccounts();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Instagram auto connect failed");
    } finally {
      setAutoConnecting(false);
    }
  };

  const saveAccount = async () => {
    if (!name.trim() || !accountId.trim() || !accessToken.trim()) {
      toast.error("Account name, Instagram account ID এবং access token দিন");
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const email = localStorage.getItem("auth_email");
      const response = await fetch(`${BACKEND_URL}/api/instagram/pages/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ page_id: accountId.trim(), name: name.trim(), page_access_token: accessToken.trim(), email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Instagram account connect করা যায়নি");
      localStorage.setItem("active_ig_account_id", accountId.trim());
      localStorage.setItem("active_ig_db_id", String(data.id || data.db_id || ""));
      window.dispatchEvent(new Event("instagram-account-changed"));
      toast.success("Instagram Professional account connected");
      setOpen(false); setName(""); setAccountId(""); setAccessToken("");
      await loadAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Instagram account connect করা যায়নি");
    } finally { setSaving(false); }
  };

  const selectAccount = (account: InstagramAccount) => {
    localStorage.setItem("active_ig_account_id", account.page_id);
    localStorage.setItem("active_ig_db_id", String(account.db_id || account.id || ""));
    window.dispatchEvent(new Event("instagram-account-changed"));
    navigate("/dashboard/instagram/control");
  };

  const removeAccount = async (account: InstagramAccount) => {
    if (!window.confirm(`${account.name} disconnect করতে চান?`)) return;
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/pages/${account.page_id}`, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Account disconnect করা যায়নি");
      if (localStorage.getItem("active_ig_account_id") === account.page_id) {
        localStorage.removeItem("active_ig_account_id"); localStorage.removeItem("active_ig_db_id");
      }
      toast.success("Instagram account disconnected"); await loadAccounts();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Account disconnect করা যায়নি"); }
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="flex items-center gap-3 text-3xl font-bold"><Instagram className="text-pink-500" />Instagram Integration</h1><p className="mt-1 text-muted-foreground">Meta login দিয়ে linked Instagram Professional accounts auto connect করুন, অথবা manual connect রাখুন।</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => void handleAutoConnect()} disabled={autoConnecting}>{autoConnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}Connect with Meta</Button><Button variant="outline" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Manual Connect</Button></div></div>
    <Card><CardHeader><CardTitle>Connected Instagram Accounts</CardTitle><CardDescription>Auto connect Messenger-এর মতো Meta OAuth ব্যবহার করে; manual connect fallback হিসেবেও থাকবে।</CardDescription></CardHeader><CardContent>{loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div> : accounts.length === 0 ? <div className="py-10 text-center text-muted-foreground">এখনও কোনো Instagram account connected নেই।</div> : <Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Instagram Account ID</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{accounts.map(account => <TableRow key={account.page_id}><TableCell className="font-medium">{account.name}</TableCell><TableCell className="font-mono text-xs">{account.page_id}</TableCell><TableCell className="flex justify-end gap-2"><Button size="sm" onClick={() => selectAccount(account)}><Settings2 className="mr-2 h-4 w-4" />Manage</Button><Button size="icon" variant="destructive" onClick={() => void removeAccount(account)}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Manual Instagram Connect</DialogTitle><DialogDescription>Auto connect কাজ না করলে Meta থেকে পাওয়া Instagram Business/Creator account ID এবং Page access token দিন।</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Account Name</Label><Input value={name} onChange={event => setName(event.target.value)} placeholder="My Instagram Shop" /></div><div><Label>Instagram Account ID</Label><Input value={accountId} onChange={event => setAccountId(event.target.value)} placeholder="1784..." /></div><div><Label>Page Access Token</Label><Input type="password" value={accessToken} onChange={event => setAccessToken(event.target.value)} placeholder="EAA..." /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void saveAccount()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
