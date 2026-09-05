import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Inbox, MoreHorizontal, Plus, Settings, ShieldCheck, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";
import { secureFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Permissions = Record<string, unknown>;
type TeamMember = { id: number | string; member_email: string; status: string; permissions?: Permissions; role?: string };
type Period = "today" | "7d" | "30d";
type ModulePermission = { key: string; title: string; icon: typeof Inbox; primary: string; secondary: string; primaryAction: string; action: string };
type Analytics = Record<string, unknown>;
type QuotaRow = Record<string, unknown>;

const modules: ModulePermission[] = [
  { key: "smart_inbox", title: "Smart Inbox", icon: Inbox, primary: "View conversations", secondary: "Reply / send messages", primaryAction: "view", action: "reply" },
  { key: "orders", title: "Orders", icon: ShoppingBag, primary: "View assigned orders", secondary: "View all orders", primaryAction: "view_assigned", action: "assign" },
  { key: "conversion", title: "Conversion", icon: BarChart3, primary: "View conversion data", secondary: "Manage conversion settings", primaryAction: "view", action: "manage" },
  { key: "ai_settings", title: "AI Settings", icon: Settings, primary: "View AI settings", secondary: "Edit AI settings", primaryAction: "view", action: "manage" },
  { key: "control_panel", title: "Control Panel", icon: ShieldCheck, primary: "View controls", secondary: "Manage controls", primaryAction: "view", action: "manage" },
];

const displayName = (email: string) => email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const apiHeaders = (json = false): HeadersInit => ({ Authorization: `Bearer ${localStorage.getItem("auth_token") || ""}`, ...(json ? { "Content-Type": "application/json" } : {}) });
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const valueText = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
const toRows = (value: unknown): QuotaRow[] => Array.isArray(value) ? value.filter((item): item is QuotaRow => !!item && typeof item === "object") : [];

function moduleAccess(permissions: Permissions | undefined, module: ModulePermission) {
  const value = permissions?.[module.key];
  const access = asRecord(value);
  return { view: value === true || Boolean(access[module.primaryAction] || access.view), manage: Boolean(access[module.action] || access.manage || access.reply || access.assign) };
}

function permissionPayload(permissions: Permissions): Permissions {
  return Object.fromEntries(modules.map((module) => {
    const value = permissions[module.key];
    const access = asRecord(value);
    const primaryEnabled = value === true || Boolean(access[module.primaryAction] || access.view);
    const secondaryEnabled = Boolean(access[module.action] || access.manage || access.reply || access.assign);
    return [module.key, { [module.primaryAction]: primaryEnabled, [module.action]: secondaryEnabled }];
  }));
}

function allocationPayload(allocation: Record<string, unknown>) {
  const batchSize = Number(allocation.batch_size);
  return { ...allocation, batch_size: Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 1, overflow: Boolean(allocation.overflow) };
}

function accessLabels(permissions: Permissions | undefined) {
  return modules.filter((module) => {
    const access = moduleAccess(permissions, module);
    return access.view || access.manage;
  }).map((module) => module.title.replace("Smart ", ""));
}

function apiError(data: unknown, fallback: string) {
  const message = asRecord(data).error;
  return typeof message === "string" ? message : fallback;
}

function PermissionCard({ module, access, onChange }: { module: ModulePermission; access: { view: boolean; manage: boolean }; onChange: (field: "view" | "manage", value: boolean) => void }) {
  const Icon = module.icon;
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 sm:px-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#00ff88]/10 text-[#00ff88]"><Icon className="h-4 w-4" /></div><div className="min-w-0"><h4 className="font-bold leading-tight">{module.title}</h4><p className="mt-1 text-xs text-muted-foreground">{module.primary} · {module.secondary}</p></div></div>
      <div className="flex shrink-0 items-center gap-4 self-end sm:self-auto"><label className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span>View</span><Switch checked={access.view} onCheckedChange={(checked) => onChange("view", checked)} /></label><label className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span>Manage</span><Switch checked={access.manage} onCheckedChange={(checked) => onChange("manage", checked)} /></label></div>
    </div>
  </div>;
}

export default function TeamManagementPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [allocation, setAllocation] = useState<Record<string, unknown> | null>(null);
  const [allocationDraft, setAllocationDraft] = useState<Record<string, unknown>>({});
  const [quotaRows, setQuotaRows] = useState<QuotaRow[]>([]);
  const [period, setPeriod] = useState<Period>("today");
  const [activeView, setActiveView] = useState<"overview" | "permissions" | "inbox" | "orders">("overview");
  const [selectedId, setSelectedId] = useState<TeamMember["id"] | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<Permissions>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [savingAllocation, setSavingAllocation] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPermissions, setNewPermissions] = useState<Permissions>({});
  const [adding, setAdding] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [membersResponse, analyticsResponse, allocationResponse, quotaResponse] = await Promise.all([
        secureFetch(`${BACKEND_URL}/api/teams/members`, { headers: apiHeaders() }),
        secureFetch(`${BACKEND_URL}/api/teams/analytics?period=${period}`, { headers: apiHeaders() }),
        secureFetch(`${BACKEND_URL}/api/teams/order-allocation`, { headers: apiHeaders() }),
        secureFetch(`${BACKEND_URL}/api/teams/order-quota`, { headers: apiHeaders() }),
      ]);
      const responses = [membersResponse, analyticsResponse, allocationResponse, quotaResponse];
      if (responses.some((response) => !response.ok)) throw new Error("Unable to load team management data.");
      const [memberData, analyticsData, allocationData, quotaData] = await Promise.all(responses.map((response) => response.json()));
      setMembers(Array.isArray(memberData) ? memberData as TeamMember[] : []);
      setAnalytics(asRecord(analyticsData) as Analytics);
      const nextAllocation = asRecord(allocationData);
      setAllocation(nextAllocation);
      setAllocationDraft(nextAllocation);
      setQuotaRows(toRows(Array.isArray(quotaData) ? quotaData : asRecord(quotaData).members ?? asRecord(quotaData).quotas));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load team management data.");
      setMembers([]); setAnalytics(null); setAllocation(null); setQuotaRows([]);
    } finally { setLoading(false); }
  }, [period]);

  useEffect(() => { void loadData(); }, [loadData]);

  const selectedMember = useMemo(() => members.find((member) => member.id === selectedId) ?? null, [members, selectedId]);
  const kpis = useMemo(() => toRows(analytics?.kpis ?? analytics?.metrics), [analytics]);
  const performance = useMemo(() => toRows(analytics?.members ?? analytics?.performance), [analytics]);
  const activity = useMemo(() => toRows(analytics?.activity ?? analytics?.reply_activity ?? analytics?.series), [analytics]);
  const permissionChanged = selectedMember ? JSON.stringify(draftPermissions) !== JSON.stringify(selectedMember.permissions ?? {}) : false;
  const allocationChanged = JSON.stringify(allocationDraft) !== JSON.stringify(allocation ?? {});

  const selectMember = (member: TeamMember) => { setSelectedId(member.id); setDraftPermissions(member.permissions ?? {}); };
  const setPermission = (target: "draft" | "new", module: ModulePermission, field: "view" | "manage", checked: boolean) => {
    const update = (current: Permissions) => ({ ...current, [module.key]: { ...asRecord(current[module.key]), [field === "manage" ? module.action : module.primaryAction]: checked } });
    target === "draft" ? setDraftPermissions(update) : setNewPermissions(update);
  };

  const savePermissions = async () => {
    if (!selectedMember || !permissionChanged) return;
    setSavingPermissions(true);
    try {
      const response = await secureFetch(`${BACKEND_URL}/api/teams/members/${selectedMember.id}`, { method: "PUT", headers: apiHeaders(true), body: JSON.stringify({ permissions: permissionPayload(draftPermissions) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(data, "Unable to save permissions."));
      setMembers((current) => current.map((member) => member.id === selectedMember.id ? { ...member, ...asRecord(data), permissions: draftPermissions } : member));
      toast.success("Permissions saved.");
    } catch (saveError) { toast.error(saveError instanceof Error ? saveError.message : "Unable to save permissions."); }
    finally { setSavingPermissions(false); }
  };

  const saveAllocation = async () => {
    if (!allocationChanged) return;
    setSavingAllocation(true);
    try {
      const response = await secureFetch(`${BACKEND_URL}/api/teams/order-allocation`, { method: "PUT", headers: apiHeaders(true), body: JSON.stringify(allocationPayload(allocationDraft)) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(data, "Unable to save allocation settings."));
      const updatedAllocation = asRecord(data);
      setAllocation(updatedAllocation); setAllocationDraft(updatedAllocation);
      toast.success("Order allocation saved.");
      await loadData();
    } catch (saveError) { toast.error(saveError instanceof Error ? saveError.message : "Unable to save allocation settings."); }
    finally { setSavingAllocation(false); }
  };

  const addMember = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) { toast.error("Enter a member email address."); return; }
    setAdding(true);
    try {
      const response = await secureFetch(`${BACKEND_URL}/api/teams/members`, { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ member_email: email, permissions: permissionPayload(newPermissions) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(data, "Unable to add team member."));
      toast.success("Team member added."); setAddOpen(false); setNewEmail(""); setNewPermissions({}); await loadData();
    } catch (addError) { toast.error(addError instanceof Error ? addError.message : "Unable to add team member."); }
    finally { setAdding(false); }
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground">Loading team management data…</div>;
  if (error) return <Card className="mx-auto max-w-xl rounded-3xl"><CardHeader><CardTitle>Unable to load team management</CardTitle><CardDescription>{error}</CardDescription></CardHeader><CardContent><Button onClick={() => void loadData()}>Retry</Button></CardContent></Card>;

  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-8">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Team Management</h1><p className="mt-2 text-muted-foreground">Manage members, access, analytics, and order allocation.</p></div><Button onClick={() => setAddOpen(true)} className="h-11 rounded-2xl bg-[#00ff88] px-5 font-bold text-black hover:bg-[#00ff88]/90"><Plus className="mr-2 h-4 w-4" />Add Team Member</Button></div>

    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-2">{[["overview", "Members"], ["permissions", "Permissions"], ["inbox", "Analytics"], ["orders", "Order Assignment"]].map(([key, label]) => <button key={key} type="button" onClick={() => setActiveView(key as typeof activeView)} className={cn("rounded-xl px-4 py-2 text-sm font-bold", activeView === key ? "bg-[#00ff88] text-black" : "text-muted-foreground hover:bg-white/10")}>{label}</button>)}</div><div className="flex gap-1 rounded-xl border border-white/10 p-1">{(["today", "7d", "30d"] as Period[]).map((item) => <Button key={item} variant="ghost" size="sm" onClick={() => setPeriod(item)} className={cn(period === item && "bg-white/10")}>{item === "today" ? "Today" : item}</Button>)}</div></div>

    {kpis.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{kpis.map((kpi, index) => <Card key={String(kpi.id ?? kpi.label ?? index)} className="rounded-2xl border-white/10 bg-card/80"><CardContent className="p-5"><p className="text-sm text-muted-foreground">{valueText(kpi.label ?? kpi.name)}</p><p className="mt-4 text-3xl font-black">{valueText(kpi.value)}</p>{kpi.hint !== undefined && <p className="mt-2 text-xs text-muted-foreground">{valueText(kpi.hint)}</p>}</CardContent></Card>)}</div>}

    {activeView === "overview" && <Card className="rounded-3xl border-white/10 bg-card/80"><CardHeader><CardTitle className="text-2xl font-black">Members</CardTitle><CardDescription>Team members returned by your workspace API.</CardDescription></CardHeader><CardContent className="overflow-x-auto">{members.length === 0 ? <p className="py-10 text-center text-muted-foreground">No team members yet.</p> : <table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase text-muted-foreground"><tr><th className="py-3">Member</th><th>Role</th><th>Access</th><th>Status</th><th /></tr></thead><tbody>{members.map((member) => <tr key={member.id} className="border-b border-white/5 last:border-0"><td className="py-5 font-medium">{displayName(member.member_email)}</td><td><Badge className="bg-white/10 text-muted-foreground hover:bg-white/10">{valueText(member.role)}</Badge></td><td><div className="flex flex-wrap gap-2">{accessLabels(member.permissions).map((label) => <Badge key={label} className="bg-white/10 text-muted-foreground hover:bg-white/10">{label}</Badge>)}</div></td><td><Badge className="bg-[#d9ff8f]/20 text-[#9eff31] hover:bg-[#d9ff8f]/20">{valueText(member.status)}</Badge></td><td><Button variant="ghost" size="icon" onClick={() => { selectMember(member); setActiveView("permissions"); }} aria-label={`Edit ${member.member_email}`}><MoreHorizontal className="h-4 w-4" /></Button></td></tr>)}</tbody></table>}</CardContent></Card>}

    {activeView === "permissions" && <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"><Card className="rounded-3xl border-white/10 bg-card/80"><CardHeader><CardTitle>Team Members</CardTitle><CardDescription>Select a member to edit their access.</CardDescription></CardHeader><CardContent className="space-y-3">{members.length === 0 ? <p className="text-muted-foreground">No members available.</p> : members.map((member) => <button key={member.id} type="button" onClick={() => selectMember(member)} className={cn("flex w-full items-center justify-between rounded-2xl border p-4 text-left", selectedMember?.id === member.id ? "border-[#00ff88]/50 bg-[#00ff88]/10" : "border-white/10 bg-white/[0.03]")}><span className="font-semibold">{displayName(member.member_email)}</span><Badge className="bg-white/10 text-muted-foreground hover:bg-white/10">{valueText(member.role)}</Badge></button>)}</CardContent></Card><Card className="rounded-3xl border-white/10 bg-card/80"><CardHeader><CardTitle>Edit member access</CardTitle><CardDescription>{selectedMember ? selectedMember.member_email : "Select a member to begin."}</CardDescription></CardHeader>{selectedMember && <CardContent className="space-y-4"><div className="space-y-3">{modules.map((module) => <PermissionCard key={module.key} module={module} access={moduleAccess(draftPermissions, module)} onChange={(field, checked) => setPermission("draft", module, field, checked)} />)}</div><Button disabled={!permissionChanged || savingPermissions} onClick={() => void savePermissions()} className="h-12 w-full rounded-2xl bg-[#00ff88] font-bold text-black hover:bg-[#00ff88]/90">{savingPermissions ? "Saving…" : "Save permissions"}</Button></CardContent>}</Card></div>}

    {activeView === "inbox" && <div className="grid gap-6 xl:grid-cols-2"><Card className="rounded-3xl border-white/10 bg-card/80"><CardHeader><CardTitle>Team performance</CardTitle><CardDescription>Analytics for the selected period.</CardDescription></CardHeader><CardContent className="overflow-x-auto">{performance.length === 0 ? <p className="py-10 text-center text-muted-foreground">No performance analytics are available for this period.</p> : <table className="w-full text-left text-sm"><thead className="border-b border-white/10"><tr>{Object.keys(performance[0]).map((key) => <th key={key} className="py-3 pr-5 text-xs uppercase text-muted-foreground">{key.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{performance.map((row, index) => <tr key={String(row.id ?? index)} className="border-b border-white/5">{Object.keys(performance[0]).map((key) => <td key={key} className="py-4 pr-5">{valueText(row[key])}</td>)}</tr>)}</tbody></table>}</CardContent></Card><Card className="rounded-3xl border-white/10 bg-card/80"><CardHeader><CardTitle>Reply activity</CardTitle></CardHeader><CardContent>{activity.length === 0 ? <p className="py-10 text-center text-muted-foreground">No reply activity is available for this period.</p> : <div className="space-y-3">{activity.map((point, index) => <div key={String(point.id ?? point.label ?? index)} className="rounded-xl border border-white/10 p-3 text-sm">{Object.entries(point).map(([key, value]) => <span key={key} className="mr-4"><span className="text-muted-foreground">{key.replace(/_/g, " ")}: </span>{valueText(value)}</span>)}</div>)}</div>}</CardContent></Card></div>}

    {activeView === "orders" && <div className="space-y-6"><Card className="rounded-3xl border-white/10 bg-card/80"><CardHeader><CardTitle>Assignment rules</CardTitle><CardDescription>Current allocation configuration returned by the API.</CardDescription></CardHeader><CardContent>{allocation && Object.keys(allocation).length > 0 ? <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(allocationDraft).filter(([, value]) => typeof value !== "object").map(([key, value]) => key === "overflow" ? <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold uppercase text-muted-foreground">{key.replace(/_/g, " ")}<Switch checked={Boolean(value)} onCheckedChange={(checked) => setAllocationDraft((current) => ({ ...current, overflow: checked }))} /></label> : <label key={key} className="text-xs font-bold uppercase text-muted-foreground">{key.replace(/_/g, " ")}<Input type={key === "batch_size" ? "number" : "text"} min={key === "batch_size" ? 1 : undefined} step={key === "batch_size" ? 1 : undefined} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onChange={(event) => setAllocationDraft((current) => ({ ...current, [key]: key === "batch_size" ? Math.max(1, Math.trunc(event.target.valueAsNumber || 1)) : event.target.value }))} className="mt-2 rounded-xl border-white/10 bg-white/[0.03] normal-case text-foreground" /></label>)}</div><Button disabled={!allocationChanged || savingAllocation} onClick={() => void saveAllocation()} className="bg-[#00ff88] text-black hover:bg-[#00ff88]/90">{savingAllocation ? "Saving…" : "Save allocation"}</Button></div> : <p className="text-muted-foreground">No allocation configuration is available.</p>}</CardContent></Card><Card className="rounded-3xl border-white/10 bg-card/80"><CardHeader><CardTitle>Admin quota</CardTitle></CardHeader><CardContent className="overflow-x-auto">{quotaRows.length === 0 ? <p className="py-10 text-center text-muted-foreground">No quota records are available.</p> : <table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-white/10"><tr>{Object.keys(quotaRows[0]).map((key) => <th key={key} className="py-3 pr-5 text-xs uppercase text-muted-foreground">{key.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{quotaRows.map((row, index) => <tr key={String(row.id ?? index)} className="border-b border-white/5">{Object.keys(quotaRows[0]).map((key) => <td key={key} className="py-4 pr-5">{valueText(row[key])}</td>)}</tr>)}</tbody></table>}</CardContent></Card></div>}

    <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-3xl border-white/10 bg-card p-5 sm:p-6"><DialogHeader className="space-y-2"><DialogTitle className="text-2xl font-black">Add team member</DialogTitle><DialogDescription>Choose access before adding this member to your workspace.</DialogDescription></DialogHeader><div className="space-y-2"><label htmlFor="team-member-email" className="text-sm font-bold">Email Address</label><Input id="team-member-email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="member@company.com" aria-describedby="team-member-email-help" className="h-11 rounded-xl border-white/10 bg-white/[0.03]" /><p id="team-member-email-help" className="text-xs leading-relaxed text-muted-foreground">Enter the email address of the person you want to add to this workspace.</p></div><div className="border-t border-white/10 pt-5"><div className="mb-3"><h3 className="font-bold">Module Access &amp; Permissions</h3><p className="mt-1 text-xs text-muted-foreground">Enable only the access this team member needs.</p></div><div className="space-y-2">{modules.map((module) => <PermissionCard key={module.key} module={module} access={moduleAccess(newPermissions, module)} onChange={(field, checked) => setPermission("new", module, field, checked)} />)}</div></div><DialogFooter className="gap-2 border-t border-white/10 pt-5 sm:gap-0"><Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>Cancel</Button><Button onClick={() => void addMember()} disabled={adding} className="bg-[#00ff88] text-black hover:bg-[#00ff88]/90">{adding ? "Adding…" : "Add member"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
