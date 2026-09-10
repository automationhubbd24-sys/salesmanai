import { Instagram, PlusCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInstagram } from "@/context/InstagramContext";

export function InstagramAccountSelector() {
  const navigate = useNavigate();
  const { accounts, currentAccount, setCurrentAccount } = useInstagram();

  if (!accounts.length) return <div className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground" onClick={() => navigate("/dashboard/instagram/integration")}><PlusCircle size={16} /><span>Connect Instagram</span></div>;

  return <div className="mb-4 px-2"><label className="mb-1.5 block px-1 text-xs font-medium text-muted-foreground">Active Instagram Account</label><Select value={currentAccount?.page_id || ""} onValueChange={value => { if (value === "add_new") { navigate("/dashboard/instagram/integration"); return; } const account = accounts.find(item => item.page_id === value); if (account) setCurrentAccount(account); }}><SelectTrigger className="h-9 w-full border-sidebar-border bg-sidebar-accent text-sidebar-foreground"><div className="flex items-center gap-2 overflow-hidden"><Instagram size={14} className="shrink-0 text-pink-500" /><SelectValue placeholder="Select Instagram account" /></div></SelectTrigger><SelectContent>{accounts.map(account => <SelectItem key={account.page_id} value={account.page_id}>{account.name}</SelectItem>)}<SelectItem value="add_new"><span className="flex items-center gap-2"><PlusCircle size={14} />Connect New</span></SelectItem></SelectContent></Select></div>;
}
