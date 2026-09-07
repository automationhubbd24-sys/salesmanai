import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

type Platform = "messenger" | "instagram";
type Config = {
  enabled: boolean;
  system_prompt: string;
};
type Mapping = {
  id?: number;
  post_id: string;
  caption?: string;
  media_url?: string;
  product_ids: string[];
  is_active?: boolean;
};
type Decision = {
  action?: string;
  reason?: string;
  reaction?: string;
  delete_comment?: boolean;
};
type AutomationEvent = {
  id: number | string;
  post_id?: string;
  comment_id: string;
  comment_text?: string;
  product_ids?: string[];
  public_reply_status?: string;
  dm_status?: string;
  reaction_status?: string;
  reaction_type?: string;
  decision?: Decision;
  error_message?: string | null;
  created_at: string;
};

const defaultConfig: Config = {
  enabled: false,
  system_prompt: "You are a social media comment automation assistant. Read the customer comment and the post/product context. Decide whether to reply publicly, send a private DM, react, delete, or skip. Use Bangla for customer-facing text. Never invent product price, stock, or features.",
};

function AuditStatus({ label, value }: { label: string; value?: string }) {
  const normalized = value || "pending";
  const variant = normalized === "sent" ? "default" : normalized === "deleted" || normalized === "failed" ? "destructive" : "secondary";
  return <Badge variant={variant} className="font-normal">{label}: {normalized}</Badge>;
}

export function CommentAutomationSettings({ platform, resourceId }: { platform: Platform; resourceId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mapping, setMapping] = useState<Mapping>({ post_id: "", caption: "", media_url: "", product_ids: [] });
  const [auditEvents, setAuditEvents] = useState<AutomationEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const base = `${BACKEND_URL}/api/${platform}`;
  const headers = () => {
    const token = localStorage.getItem("auth_token");
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };

  const load = async () => {
    if (!resourceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [configResponse, mappingsResponse] = await Promise.all([
        fetch(`${base}/comment-automation/${resourceId}`, { headers: headers() }),
        fetch(`${base}/post-mappings/${resourceId}`, { headers: headers() }),
      ]);
      if (configResponse.ok) {
        const responseConfig = await configResponse.json();
        setConfig({
          enabled: Boolean(responseConfig.enabled),
          system_prompt: responseConfig.system_prompt || defaultConfig.system_prompt,
        });
      }
      if (mappingsResponse.ok) setMappings(await mappingsResponse.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Comment automation load করা যায়নি");
    } finally {
      setLoading(false);
    }
  };

  const loadAuditEvents = async () => {
    if (!resourceId) return;
    setAuditLoading(true);
    try {
      const response = await fetch(`${base}/comment-automation/${resourceId}/events`, { headers: headers() });
      if (response.status === 404) {
        setAuditEvents([]);
        return;
      }
      if (!response.ok) throw new Error("Automation audit load করা যায়নি");
      const data = await response.json();
      setAuditEvents(Array.isArray(data) ? data : Array.isArray(data.events) ? data.events : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Automation audit load করা যায়নি");
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadAuditEvents();
  }, [platform, resourceId]);

  const saveConfig = async () => {
    if (!resourceId) return;
    setSaving(true);
    try {
      const response = await fetch(`${base}/comment-automation/${resourceId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ enabled: config.enabled, system_prompt: config.system_prompt }),
      });
      if (!response.ok) throw new Error("Comment automation settings save করা যায়নি");
      const savedConfig = await response.json();
      setConfig({ enabled: Boolean(savedConfig.enabled), system_prompt: savedConfig.system_prompt || defaultConfig.system_prompt });
      toast.success("Comment automation settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Comment automation settings save করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  const saveMapping = async () => {
    if (!resourceId || !mapping.post_id.trim()) {
      toast.error("Post / Media ID দিন");
      return;
    }
    try {
      const response = await fetch(`${base}/post-mappings/${resourceId}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(mapping),
      });
      if (!response.ok) throw new Error("Post mapping save করা যায়নি");
      setMapping({ post_id: "", caption: "", media_url: "", product_ids: [] });
      toast.success("Post mapping saved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Post mapping save করা যায়নি");
    }
  };

  const deleteMapping = async (postId: string) => {
    if (!resourceId) return;
    setDeletingPostId(postId);
    try {
      const response = await fetch(`${base}/post-mappings/${resourceId}/${encodeURIComponent(postId)}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!response.ok) throw new Error("Post mapping delete করা যায়নি");
      setMappings((current) => current.filter((item) => item.post_id !== postId));
      toast.success("Post mapping deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Post mapping delete করা যায়নি");
    } finally {
      setDeletingPostId(null);
    }
  };

  const updateMappingProducts = (value: string) => {
    setMapping({ ...mapping, product_ids: value.split(",").map((item) => item.trim()).filter(Boolean) });
  };

  if (!resourceId) return <Card><CardContent className="py-12 text-center text-muted-foreground">একটি {platform === "instagram" ? "Instagram account" : "Messenger page"} select করুন।</CardContent></Card>;
  if (loading) return <Card><CardContent className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" /></CardContent></Card>;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[#0f0f0f] p-6 shadow-[0_0_45px_rgba(0,255,136,0.08)]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#00ff88]/10 via-transparent to-transparent" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-xl bg-primary p-2 text-black"><MessageCircle className="h-5 w-5" /></div>
              <Badge variant={config.enabled ? "default" : "secondary"}>{config.enabled ? "Active" : "Paused"}</Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Comment Automation</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">System prompt অনুযায়ী AI নিজে reply, DM, reaction, delete অথবা skip সিদ্ধান্ত নেবে।</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-right"><p className="text-sm font-medium">Master enable</p><p className="text-xs text-muted-foreground">সব automation চালু বা বন্ধ করুন</p></div>
            <Switch checked={config.enabled} onCheckedChange={(enabled) => setConfig({ ...config, enabled })} aria-label="Enable comment automation" />
            <Button onClick={() => void saveConfig()} disabled={saving} size="lg" className="shrink-0 bg-primary text-black hover:bg-primary/90">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save
            </Button>
          </div>
        </div>
      </div>

      <Card className="border-primary/10 bg-card/95">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />Comment Automation System Prompt</CardTitle>
          <CardDescription>এই prompt-ই AI-এর একমাত্র automation rulebook। আলাদা keyword, cooldown বা fixed reply rule নেই।</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="comment-automation-system-prompt">System prompt</Label>
            <Textarea id="comment-automation-system-prompt" className="mt-1 min-h-72 text-sm leading-6" value={config.system_prompt} onChange={(event) => setConfig({ ...config, system_prompt: event.target.value })} />
          </div>
          <div className="grid gap-3 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground md:grid-cols-2">
            <p><Check className="mr-1 inline h-4 w-4 text-emerald-500" />আপনার prompt-এ কখন <strong>public reply</strong>, <strong>DM</strong>, <strong>reaction</strong>, <strong>delete</strong> অথবা <strong>skip</strong> করতে হবে লিখুন।</p>
            <p><Check className="mr-1 inline h-4 w-4 text-emerald-500" />AI শুধু mapped product তথ্য ব্যবহার করবে; price, stock বা feature অনুমান করতে পারবে না।</p>
          </div>
          <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
            Example: “দাম বা order সম্পর্কিত প্রশ্নে ভদ্রভাবে public reply দিন এবং বিস্তারিত DM করুন। abusive বা spam comment delete করুন। সাধারণ প্রশংসার comment-এ LOVE react দিন, দরকার হলে ছোট thank-you reply দিন। অনিশ্চিত হলে skip করুন।”
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" />Automation event audit</CardTitle><CardDescription>AI কী সিদ্ধান্ত নিয়েছে এবং কোন Meta action সফল হয়েছে দেখুন।</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => void loadAuditEvents()} disabled={auditLoading}>{auditLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button>
        </CardHeader>
        <CardContent>
          {auditEvents.length === 0 ? <div className="rounded-xl border border-dashed py-7 text-center text-sm text-muted-foreground">এখনও দেখানোর মতো কোনো automation event নেই।</div> : <div className="space-y-3">{auditEvents.slice(0, 10).map((event) => <div key={event.id} className="rounded-xl border bg-muted/30 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0"><p className="truncate font-medium">{event.comment_text || "Comment text পাওয়া যায়নি"}</p><p className="mt-1 text-xs text-muted-foreground">Comment: {event.comment_id}{event.post_id ? ` · Post: ${event.post_id}` : ""}</p>{event.product_ids?.length ? <p className="mt-1 text-xs text-muted-foreground">Products: {event.product_ids.join(", ")}</p> : null}{event.decision?.reason ? <p className="mt-1 text-xs text-muted-foreground">AI reason: {event.decision.reason}</p> : null}</div><span className="shrink-0 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span></div><div className="mt-3 flex flex-wrap gap-2"><AuditStatus label="Action" value={event.decision?.action} /><AuditStatus label="Reply" value={event.public_reply_status} /><AuditStatus label="DM" value={event.dm_status} /><AuditStatus label={event.reaction_type ? `React (${event.reaction_type})` : "React"} value={event.reaction_status} />{event.error_message ? <Badge variant="destructive" className="font-normal">Error: {event.error_message}</Badge> : null}</div></div>)}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Post & product mapping</CardTitle><CardDescription>এখানেই AI জানবে কোন post-এ কোন product আছে। Product IDs comma দিয়ে লিখুন।</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div><Label>Post / media ID <span className="text-destructive">*</span></Label><Input className="mt-1" value={mapping.post_id} onChange={(event) => setMapping({ ...mapping, post_id: event.target.value })} placeholder={platform === "instagram" ? "Instagram media ID" : "Facebook post ID"} /></div>
            <div><Label>Product IDs</Label><Input className="mt-1" value={mapping.product_ids.join(", ")} onChange={(event) => updateMappingProducts(event.target.value)} placeholder="12, 15, 20" /></div>
            <div><Label>Post caption / context</Label><Textarea className="mt-1" value={mapping.caption} onChange={(event) => setMapping({ ...mapping, caption: event.target.value })} placeholder="যেমন: Red Panjabi Eid offer post — price 1200" /></div>
            <div><Label>Media URL <span className="text-muted-foreground">(optional)</span></Label><Input className="mt-1" value={mapping.media_url} onChange={(event) => setMapping({ ...mapping, media_url: event.target.value })} placeholder="https://..." /></div>
          </div>
          <Button variant="outline" onClick={() => void saveMapping()}><Plus className="mr-2 h-4 w-4" />Add mapping</Button>
          <Separator />
          <div className="space-y-2">
            {mappings.length === 0 ? <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">No mappings yet. Add a post and its product IDs above.</div> : mappings.map((item) => <div key={item.id || item.post_id} className="flex items-start justify-between gap-3 rounded-xl border p-4"><div className="min-w-0"><p className="font-medium">{item.post_id}</p><p className="mt-1 text-xs text-muted-foreground">Products: {item.product_ids?.join(", ") || "No product linked"}</p>{item.caption && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.caption}</p>}</div><Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => void deleteMapping(item.post_id)} disabled={deletingPostId === item.post_id} aria-label={`${item.post_id} mapping delete করুন`}>{deletingPostId === item.post_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button></div>)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
