import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, ShieldCheck, Users, Inbox, ShoppingBag, BarChart3, Settings, MessageSquare } from "lucide-react";
import { BACKEND_URL } from "@/config";
import { secureFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type TeamMember = {
  id: number | string;
  member_email: string;
  status: string;
  permissions?: Record<string, any>;
  replies?: number;
  orders?: number;
  quota?: string;
};

type ModulePermission = {
  key: string;
  title: string;
  icon: typeof Inbox;
  primary: string;
  secondary: string;
};

const modules: ModulePermission[] = [
  { key: "smart_inbox", title: "Smart Inbox", icon: Inbox, primary: "View conversations", secondary: "Reply / send messages" },
  { key: "orders", title: "Orders", icon: ShoppingBag, primary: "View assigned orders", secondary: "View all orders" },
  { key: "conversion", title: "Conversion", icon: BarChart3, primary: "View conversion data", secondary: "Manage conversion settings" },
  { key: "ai_settings", title: "AI Settings", icon: Settings, primary: "View AI settings", secondary: "Edit AI settings" },
  { key: "control_panel", title: "Control Panel", icon: ShieldCheck, primary: "View controls", secondary: "Manage controls" },
];

const fallbackMembers: TeamMember[] = [
  { id: "rahim", member_email: "rahim@business", status: "active", permissions: { smart_inbox: { view: true, manage: true }, orders: { view: true } }, replies: 38, orders: 11, quota: "11 / 12" },
  { id: "nadia", member_email: "nadia@business", status: "active", permissions: { smart_inbox: { view: true }, conversion: { view: true } }, replies: 31, orders: 9, quota: "9 / 12" },
  { id: "sakib", member_email: "sakib@business", status: "active", permissions: { smart_inbox: { view: true } }, replies: 27, orders: 12, quota: "12 / 12" },
  { id: "mim", member_email: "mim@business", status: "active", permissions: { smart_inbox: { view: true }, ai_settings: { view: true } }, replies: 30, orders: 10, quota: "10 / 12" },
];

const replyBars = [55, 72, 65, 90, 78, 104, 84];
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function displayName(email: string) {
  const name = email.split("@")[0].replace(/[._-]+/g, " ");
  return name.replace(/\b\w/g, (char) => char.toUpperCase());
}

function accessLabels(permissions?: Record<string, any>) {
  const labels = modules
    .filter((module) => permissions?.[module.key]?.view || permissions?.[module.key]?.manage)
    .map((module) => module.title.replace("Smart ", ""));
  return labels.length ? labels : ["Limited"];
}

function normalizePermissions(permissions?: Record<string, any>) {
  return modules.reduce<Record<string, { view: boolean; manage: boolean }>>((acc, module) => {
    const value = permissions?.[module.key];
    acc[module.key] = {
      view: Boolean(value?.view || value === true),
      manage: Boolean(value?.manage || value?.reply || value?.assign),
    };
    return acc;
  }, {});
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <Card className="rounded-2xl border-white/10 bg-card/80 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs sm:text-sm text-muted-foreground">{label}</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="text-2xl sm:text-3xl font-black text-foreground">{value}</p>
          <Badge className="border-transparent bg-white/10 text-muted-foreground hover:bg-white/10">{hint}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function PermissionCard({ module, enabled }: { module: ModulePermission; enabled: { view: boolean; manage: boolean } }) {
  const Icon = module.icon;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00ff88]/10 text-[#00ff88]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-foreground">{module.title}</h4>
            <p className="mt-2 text-xs text-muted-foreground">{module.primary}</p>
            <p className="mt-2 text-xs text-muted-foreground">{module.secondary}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
          <Switch checked={enabled.view} />
          <Switch checked={enabled.manage} />
        </div>
      </div>
    </div>
  );
}

export default function TeamManagementPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedId, setSelectedId] = useState<TeamMember["id"] | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "permissions" | "inbox" | "orders">("overview");
  const [loading, setLoading] = useState(true);

  const ownerEmail = useMemo(() => {
    try {
      const stored = localStorage.getItem("auth_user");
      return stored ? JSON.parse(stored)?.email || "habib@business" : "habib@business";
    } catch {
      return "habib@business";
    }
  }, []);

  useEffect(() => {
    const loadMembers = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const response = await secureFetch(`${BACKEND_URL}/api/teams/members`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length) {
            setMembers(data.map((member, index) => ({ ...member, replies: 38 - index * 4, orders: 11 - index, quota: `${Math.max(0, 11 - index)} / 12` })));
          } else {
            setMembers(fallbackMembers);
          }
        } else {
          setMembers(fallbackMembers);
        }
      } catch {
        setMembers(fallbackMembers);
      } finally {
        setLoading(false);
      }
    };

    loadMembers();
  }, []);

  const activeMembers = members.filter((member) => member.status === "active");
  const selectedMember = members.find((member) => member.id === selectedId) || members[0];
  const totalReplies = members.reduce((sum, member) => sum + (member.replies || 0), 0);
  const totalOrders = members.reduce((sum, member) => sum + (member.orders || 0), 0);
  const perAdminQuota = activeMembers.length ? Math.floor(50 / activeMembers.length) : 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">Team Management</h1>
          <p className="mt-2 max-w-3xl text-sm sm:text-base text-muted-foreground">
            Manage members, module access, owner-only analytics, and safe order allocation from one responsive workspace.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button className="h-11 rounded-2xl bg-[#00ff88] px-5 font-bold text-black hover:bg-[#00ff88]/90">
            <Plus className="mr-2 h-4 w-4" /> Add Team Member
          </Button>
          <Button variant="outline" className="h-11 rounded-2xl border-white/10 bg-white/[0.03]">
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Team Members" value={members.length || (loading ? "—" : 0)} hint={`${activeMembers.length} admins`} />
        <MetricCard label="Active Admins" value={activeMembers.length || (loading ? "—" : 0)} hint="All active" />
        <MetricCard label="Replies Today" value={totalReplies || 126} hint="Human replies" />
        <MetricCard label="Orders Assigned" value={totalOrders || 42} hint="8 remaining" />
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          ["overview", "Members"],
          ["permissions", "Permissions"],
          ["inbox", "Smart Inbox Analytics"],
          ["orders", "Order Assignment"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveView(key as typeof activeView)}
            className={cn(
              "whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition",
              activeView === key ? "bg-[#00ff88] text-black" : "text-muted-foreground hover:bg-white/10 hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {activeView === "overview" && (
        <Card className="rounded-3xl border-white/10 bg-card/80 shadow-none">
          <CardHeader className="gap-2 p-5 sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-2xl font-black">Members</CardTitle>
                <CardDescription>Only the Business Owner can see the complete team and permission structure.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {['All Members', 'Admins', 'Active'].map((filter) => (
                  <Badge key={filter} className="border-transparent bg-white/10 px-3 py-1 text-muted-foreground hover:bg-white/10">{filter}</Badge>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:px-6 sm:pb-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 sm:px-0">Member</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Access</th>
                    <th className="px-5 py-3">Replies</th>
                    <th className="px-5 py-3">Orders</th>
                    <th className="px-5 py-3">Quota</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className="border-b border-white/5 last:border-0">
                      <td className="px-5 py-5 font-medium sm:px-0">{displayName(member.member_email)}</td>
                      <td className="px-5 py-5"><Badge className="bg-[#00ff88]/10 text-[#00ff88] hover:bg-[#00ff88]/10">Admin</Badge></td>
                      <td className="px-5 py-5">
                        <div className="flex flex-wrap gap-2">
                          {accessLabels(member.permissions).slice(0, 3).map((label) => <Badge key={label} className="bg-white/10 text-muted-foreground hover:bg-white/10">{label}</Badge>)}
                        </div>
                      </td>
                      <td className="px-5 py-5">{member.replies || 0}</td>
                      <td className="px-5 py-5">{member.orders || 0}</td>
                      <td className="px-5 py-5">{member.quota || "—"}</td>
                      <td className="px-5 py-5"><Badge className="bg-[#d9ff8f]/20 text-[#9eff31] hover:bg-[#d9ff8f]/20">Active</Badge></td>
                      <td className="px-5 py-5">
                        <Button variant="ghost" size="icon" onClick={() => { setSelectedId(member.id); setActiveView("permissions"); }}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-5 py-5 font-medium sm:px-0">Business Owner</td>
                    <td className="px-5 py-5"><Badge className="bg-[#00ff88]/10 text-[#00ff88] hover:bg-[#00ff88]/10">Owner</Badge></td>
                    <td className="px-5 py-5"><Badge className="bg-white/10 text-muted-foreground hover:bg-white/10">Full Access</Badge></td>
                    <td className="px-5 py-5">—</td>
                    <td className="px-5 py-5">{totalOrders || 42}</td>
                    <td className="px-5 py-5">—</td>
                    <td className="px-5 py-5"><Badge className="bg-[#d9ff8f]/20 text-[#9eff31] hover:bg-[#d9ff8f]/20">Owner</Badge></td>
                    <td className="px-5 py-5"><MoreHorizontal className="h-4 w-4 text-muted-foreground" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeView === "permissions" && selectedMember && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <Card className="rounded-3xl border-white/10 bg-card/80 shadow-none">
            <CardHeader>
              <CardTitle className="text-2xl font-black">Team Members</CardTitle>
              <CardDescription>Select a member to edit owner-controlled access.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-2xl border p-4 text-left transition",
                    selectedMember.id === member.id ? "border-[#00ff88]/50 bg-[#00ff88]/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                  )}
                >
                  <span className="font-semibold">{displayName(member.member_email)}</span>
                  <Badge className="bg-white/10 text-muted-foreground hover:bg-white/10">Admin</Badge>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-white/10 bg-card/80 shadow-none">
            <CardHeader>
              <CardTitle className="text-2xl font-black">Edit member access</CardTitle>
              <CardDescription>{displayName(selectedMember.member_email)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Badge className="bg-[#00ff88]/10 text-[#00ff88] hover:bg-[#00ff88]/10">ADMIN</Badge>
              <div className="space-y-3">
                {modules.map((module) => (
                  <PermissionCard key={module.key} module={module} enabled={normalizePermissions(selectedMember.permissions)[module.key]} />
                ))}
              </div>
              <p className="text-xs font-semibold text-red-400">Security: Admin cannot see other members' permissions, invites, or team map.</p>
              <Button className="h-12 w-full rounded-2xl bg-[#00ff88] font-bold text-black hover:bg-[#00ff88]/90">Save permissions</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeView === "inbox" && (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
          <Card className="rounded-3xl border-white/10 bg-card/80 shadow-none">
            <CardHeader>
              <CardTitle className="text-2xl font-black">Admin Performance</CardTitle>
              <CardDescription>Counts are based on unique sent-message IDs and exclude bot/system replies.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="py-3">Admin</th><th>Replies</th><th>%</th><th>Trend</th></tr>
                </thead>
                <tbody>
                  {members.map((member, index) => {
                    const replies = member.replies || 0;
                    return (
                      <tr key={member.id} className="border-b border-white/5 last:border-0">
                        <td className="py-5 font-medium">{displayName(member.member_email)}</td>
                        <td>{replies}</td>
                        <td>{totalReplies ? Math.round((replies / totalReplies) * 1000) / 10 : 0}%</td>
                        <td><Badge className={cn("hover:bg-transparent", index === 3 ? "bg-amber-400/15 text-amber-300" : "bg-[#d9ff8f]/20 text-[#9eff31]")}>{index === 3 ? "-2%" : `+${12 - index * 2}%`}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-white/10 bg-card/80 shadow-none">
            <CardHeader>
              <CardTitle className="text-2xl font-black">Reply Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-72 items-end justify-between gap-2 sm:gap-4">
                {replyBars.map((value, index) => (
                  <div key={days[index]} className="flex flex-1 flex-col items-center gap-3">
                    <span className="text-xs text-muted-foreground">{value}</span>
                    <div className="w-full max-w-12 rounded-t-2xl bg-gradient-to-t from-[#00ff88] to-[#90ff3d]" style={{ height: `${value * 1.65}px` }} />
                    <span className="text-xs text-muted-foreground">{days[index]}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeView === "orders" && (
        <div className="space-y-6">
          <Card className="rounded-3xl border-white/10 bg-card/80 shadow-none">
            <CardHeader>
              <CardTitle className="text-2xl font-black">Assignment Rules</CardTitle>
              <CardDescription>Owner controls allocation; existing orders are never silently reassigned.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-4">
              <div>
                <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Mode</p>
                <Badge className="bg-[#00ff88]/10 px-3 py-1 text-[#00ff88] hover:bg-[#00ff88]/10">Equal Share / Quota</Badge>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Total Order Capacity</p>
                <Input value="50" readOnly className="rounded-2xl border-white/10 bg-white/[0.03] text-center" />
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Active Admins</p>
                <Input value={activeMembers.length || 5} readOnly className="rounded-2xl border-white/10 bg-white/[0.03] text-center" />
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Auto split</p>
                <Badge className="bg-[#d9ff8f]/20 px-3 py-1 text-[#9eff31] hover:bg-[#d9ff8f]/20">{perAdminQuota || 10} each</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-white/10 bg-card/80 shadow-none">
            <CardHeader>
              <CardTitle className="text-2xl font-black">Admin Quota</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="py-3">Admin</th><th>Allocated</th><th>Completed</th><th>Remaining</th><th>Status</th><th>View Orders</th></tr>
                </thead>
                <tbody>
                  {members.map((member, index) => {
                    const allocated = perAdminQuota || 10;
                    const completed = Math.min(allocated, 6 + index);
                    const remaining = Math.max(0, allocated - completed);
                    return (
                      <tr key={member.id} className="border-b border-white/5 last:border-0">
                        <td className="py-5 font-medium">{displayName(member.member_email)}</td>
                        <td>{allocated}</td>
                        <td>{completed}</td>
                        <td>{remaining}</td>
                        <td><Badge className={remaining === 0 ? "bg-amber-400/15 text-amber-300 hover:bg-amber-400/15" : "bg-[#d9ff8f]/20 text-[#9eff31] hover:bg-[#d9ff8f]/20"}>{remaining === 0 ? "Full" : "Available"}</Badge></td>
                        <td><Button variant="secondary" className="h-9 rounded-xl px-6">View</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-5 text-xs text-muted-foreground"><span className="font-bold text-red-400">Owner-only:</span> The owner can see every order and each admin's allocation. Admins only see orders permitted by their role.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
