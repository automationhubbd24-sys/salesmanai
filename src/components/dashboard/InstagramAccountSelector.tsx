import { useEffect, useState } from "react";
import { Instagram, PlusCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BACKEND_URL } from "@/config";

type Account = { page_id: string; name: string; db_id?: number; id?: number };

export function InstagramAccountSelector() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState(localStorage.getItem("active_ig_account_id") || "");

  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/pages`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) return;
      const data: Account[] = await response.json();
      setAccounts(data);
      if (!activeId && data[0]) selectAccount(data[0]);
    };
    void load();
  }, []);

  const selectAccount = (account: Account) => {
    setActiveId(account.page_id);
    localStorage.setItem("active_ig_account_id", account.page_id);
    localStorage.setItem("active_ig_db_id", String(account.db_id || account.id || ""));
    window.dispatchEvent(new Event("instagram-account-changed"));
  };

  if (!accounts.length) return <div className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground" onClick={() => navigate("/dashboard/instagram/integration")}><PlusCircle size={16} /><span>Connect Instagram</span></div>;

  return <div className="mb-4 px-2"><label className="mb-1.5 block px-1 text-xs font-medium text-muted-foreground">Active Instagram Account</label><Select value={activeId} onValueChange={value => { if (value === "add_new") { navigate("/dashboard/instagram/integration"); return; } const account = accounts.find(item => item.page_id === value); if (account) selectAccount(account); }}><SelectTrigger className="h-9 w-full border-sidebar-border bg-sidebar-accent text-sidebar-foreground"><div className="flex items-center gap-2 overflow-hidden"><Instagram size={14} className="shrink-0 text-pink-500" /><SelectValue placeholder="Select Instagram account" /></div></SelectTrigger><SelectContent>{accounts.map(account => <SelectItem key={account.page_id} value={account.page_id}>{account.name}</SelectItem>)}<SelectItem value="add_new"><span className="flex items-center gap-2"><PlusCircle size={14} />Connect New</span></SelectItem></SelectContent></Select></div>;
}
