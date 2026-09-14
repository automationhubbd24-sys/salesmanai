import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  ExternalLink,
  Loader2,
  MessageCircle,
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
  permalink_url?: string;
  product_ids: string[];
  is_active?: boolean;
  auto_like?: boolean;
  auto_like_children_comment?: boolean;
  auto_reply?: boolean;
  auto_reply_children_comment?: boolean;
  auto_hidden?: boolean;
  auto_comment?: boolean;
  prompt_comment?: string;
  post_created_at?: string;
};
type Decision = {
  action?: string;
  reason?: string;
  auto_like?: boolean;
  auto_reply?: boolean;
  auto_hidden?: boolean;
  auto_comment?: boolean;
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
  moderation_status?: string;
  decision?: Decision;
  error_message?: string | null;
  created_at: string;
};

const defaultConfig: Config = {
  enabled: false,
  system_prompt: "You are a social media comment automation assistant. Use Bangla for customer-facing text. Never invent product price, stock, or features.",
};

const defaultPromptComment = "Customer comment er upor base kore short, helpful Bangla reply dao. Post context/product info thakle sudhu oi information use korbe. Unknown hole polite vabe inbox korte bolo.";

function emptyMapping(): Mapping {
  return {
    post_id: "",
    caption: "",
    media_url: "",
    permalink_url: "",
    product_ids: [],
    is_active: true,
    auto_like: false,
    auto_like_children_comment: false,
    auto_reply: false,
    auto_reply_children_comment: false,
    auto_hidden: false,
    auto_comment: false,
    prompt_comment: defaultPromptComment,
  };
}

function AuditStatus({ label, value }: { label: string; value?: string }) {
  const normalized = value || "pending";
  const variant = normalized === "sent" || normalized === "hidden" ? "default" : normalized === "failed" ? "destructive" : "secondary";
  return <Badge variant={variant} className="font-normal">{label}: {normalized}</Badge>;
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function CommentAutomationSettings({ platform, resourceId }: { platform: Platform; resourceId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [newMapping, setNewMapping] = useState<Mapping>(emptyMapping());
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

  const saveConfig = async (nextConfig = config) => {
    if (!resourceId) return;
    setSaving(true);
    try {
      const response = await fetch(`${base}/comment-automation/${resourceId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ enabled: nextConfig.enabled, system_prompt: nextConfig.system_prompt }),
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

  const syncPosts = async () => {
    if (!resourceId) return;
    if (platform !== "messenger") {
      toast.info("Post sync আপাতত Facebook page এর জন্য enabled");
      return;
    }
    setSyncing(true);
    try {
      const response = await fetch(`${base}/post-mappings/${resourceId}/sync`, {
        method: "POST",
        headers: headers(),
      });
      if (!response.ok) throw new Error("Page posts sync করা যায়নি");
      const data = await response.json();
      toast.success(`${data.synced || 0} ta post synced`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Page posts sync করা যায়নি");
    } finally {
      setSyncing(false);
    }
  };

  const saveMapping = async (mapping: Mapping, resetAfterSave = false) => {
    if (!resourceId || !mapping.post_id.trim()) {
      toast.error("Post / Media ID দিন");
      return;
    }
    setSavingPostId(mapping.post_id);
    try {
      const response = await fetch(`${base}/post-mappings/${resourceId}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(mapping),
      });
      if (!response.ok) throw new Error("Post settings save করা যায়নি");
      const saved = await response.json();
      setMappings((current) => {
        const exists = current.some((item) => item.post_id === saved.post_id);
        return exists ? current.map((item) => item.post_id === saved.post_id ? saved : item) : [saved, ...current];
      });
      if (resetAfterSave) setNewMapping(emptyMapping());
      toast.success("Post settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Post settings save করা যায়নি");
    } finally {
      setSavingPostId(null);
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
      if (!response.ok) throw new Error("Post settings delete করা যায়নি");
      setMappings((current) => current.filter((item) => item.post_id !== postId));
      toast.success("Post settings deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Post settings delete করা যায়নি");
    } finally {
      setDeletingPostId(null);
    }
  };

  const updateMapping = (postId: string, patch: Partial<Mapping>) => {
    setMappings((current) => current.map((item) => item.post_id === postId ? { ...item, ...patch } : item));
  };

  const updateAndSaveMapping = (mapping: Mapping, patch: Partial<Mapping>) => {
    const nextMapping = { ...mapping, ...patch };
    updateMapping(mapping.post_id, patch);
    void saveMapping(nextMapping);
  };

  const updateProducts = (mapping: Mapping, value: string): Mapping => ({
    ...mapping,
    product_ids: value.split(",").map((item) => item.trim()).filter(Boolean),
  });

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
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">n8n workflow-er moto post-wise true/false toggle diye auto like, reply, hide control korun.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-right"><p className="text-sm font-medium">Master enable</p><p className="text-xs text-muted-foreground">সব automation চালু বা বন্ধ</p></div>
            <Switch checked={config.enabled} onCheckedChange={(enabled) => {
              const nextConfig = { ...config, enabled };
              setConfig(nextConfig);
              void saveConfig(nextConfig);
            }} aria-label="Enable comment automation" />
            <Button onClick={() => void saveConfig()} disabled={saving} size="lg" className="shrink-0 bg-primary text-black hover:bg-primary/90">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save
            </Button>
          </div>
        </div>
      </div>

      <Card className="border-primary/10 bg-card/95">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />Global AI Prompt</CardTitle>
          <CardDescription>Eta global safety/system prompt. Proti post-er Prompt Comment alada set kora jabe.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="comment-automation-system-prompt">System prompt</Label>
            <Textarea id="comment-automation-system-prompt" className="mt-1 min-h-32 text-sm leading-6" value={config.system_prompt} onChange={(event) => setConfig({ ...config, system_prompt: event.target.value })} />
          </div>
          <Button onClick={() => void saveConfig()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save global prompt</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Page posts & automation toggles</CardTitle>
            <CardDescription>Post sync kore tarpor prottek post er jonno n8n Sheet-er true/false gula set korun.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void syncPosts()} disabled={syncing || platform !== "messenger"}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sync posts
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <h3 className="font-semibold">Manual post add + automation setup</h3>
                <p className="text-sm text-muted-foreground">Backend-er sob true/false setting ekhanei select kore post save korun.</p>
              </div>
              <Badge variant="outline">n8n Sheet controls</Badge>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div><Label>Post / media ID</Label><Input className="mt-1" value={newMapping.post_id} onChange={(event) => setNewMapping({ ...newMapping, post_id: event.target.value })} placeholder={platform === "instagram" ? "Instagram media ID" : "Facebook post ID"} /></div>
              <div><Label>Product IDs</Label><Input className="mt-1" value={newMapping.product_ids.join(", ")} onChange={(event) => setNewMapping(updateProducts(newMapping, event.target.value))} placeholder="12, 15, 20" /></div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <ToggleRow label="Auto Like" description="Top-level comment like korbe" checked={Boolean(newMapping.auto_like)} onChange={(value) => setNewMapping({ ...newMapping, auto_like: value })} />
              <ToggleRow label="Auto Like Children Comment" description="Reply/child comment-o like korbe" checked={Boolean(newMapping.auto_like_children_comment)} onChange={(value) => setNewMapping({ ...newMapping, auto_like_children_comment: value })} />
              <ToggleRow label="Auto Reply" description="Top-level comment e AI reply dibe" checked={Boolean(newMapping.auto_reply)} onChange={(value) => setNewMapping({ ...newMapping, auto_reply: value })} />
              <ToggleRow label="Auto Reply Children Comment" description="Reply/child comment e AI reply dibe" checked={Boolean(newMapping.auto_reply_children_comment)} onChange={(value) => setNewMapping({ ...newMapping, auto_reply_children_comment: value })} />
              <ToggleRow label="Auto Hidden" description="Comment hide kore dibe" checked={Boolean(newMapping.auto_hidden)} onChange={(value) => setNewMapping({ ...newMapping, auto_hidden: value })} />
              <ToggleRow label="Auto Comment" description="n8n sheet-er Auto Comment flag" checked={Boolean(newMapping.auto_comment)} onChange={(value) => setNewMapping({ ...newMapping, auto_comment: value })} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div><Label>Post caption / context</Label><Textarea className="mt-1" value={newMapping.caption} onChange={(event) => setNewMapping({ ...newMapping, caption: event.target.value })} /></div>
              <div><Label>Prompt Comment</Label><Textarea className="mt-1" value={newMapping.prompt_comment} onChange={(event) => setNewMapping({ ...newMapping, prompt_comment: event.target.value })} /></div>
            </div>
            <Button className="mt-4" onClick={() => void saveMapping(newMapping, true)} disabled={savingPostId === newMapping.post_id}>
              {savingPostId === newMapping.post_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Add post with settings
            </Button>
          </div>

          <Separator />

          <div className="grid gap-4">
            {mappings.length === 0 ? <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">No post found. Sync posts অথবা manual post add করুন।</div> : mappings.map((item) => (
              <Card key={item.id || item.post_id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-4 lg:flex-row">
                    {item.media_url ? <img src={item.media_url} alt="Post media" className="h-28 w-full rounded-xl object-cover lg:w-40" /> : <div className="flex h-28 w-full items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground lg:w-40">No image</div>}
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.post_id}</p>
                          {item.post_created_at ? <p className="text-xs text-muted-foreground">{new Date(item.post_created_at).toLocaleString()}</p> : null}
                          {item.caption ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.caption}</p> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {item.permalink_url ? <Button variant="ghost" size="icon" asChild><a href={item.permalink_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button> : null}
                          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => void deleteMapping(item.post_id)} disabled={deletingPostId === item.post_id}>{deletingPostId === item.post_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <ToggleRow label="Auto Like" description="Top-level comment like korbe" checked={Boolean(item.auto_like)} onChange={(value) => updateAndSaveMapping(item, { auto_like: value })} />
                        <ToggleRow label="Auto Like Children Comment" description="Reply/child comment-o like korbe" checked={Boolean(item.auto_like_children_comment)} onChange={(value) => updateAndSaveMapping(item, { auto_like_children_comment: value })} />
                        <ToggleRow label="Auto Reply" description="Top-level comment e AI reply dibe" checked={Boolean(item.auto_reply)} onChange={(value) => updateAndSaveMapping(item, { auto_reply: value })} />
                        <ToggleRow label="Auto Reply Children Comment" description="Reply/child comment e AI reply dibe" checked={Boolean(item.auto_reply_children_comment)} onChange={(value) => updateAndSaveMapping(item, { auto_reply_children_comment: value })} />
                        <ToggleRow label="Auto Hidden" description="Comment hide kore dibe" checked={Boolean(item.auto_hidden)} onChange={(value) => updateAndSaveMapping(item, { auto_hidden: value })} />
                        <ToggleRow label="Auto Comment" description="n8n sheet-er Auto Comment flag" checked={Boolean(item.auto_comment)} onChange={(value) => updateAndSaveMapping(item, { auto_comment: value })} />
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div><Label>Product IDs</Label><Input className="mt-1" value={item.product_ids?.join(", ") || ""} onChange={(event) => updateMapping(item.post_id, updateProducts(item, event.target.value))} /></div>
                        <div><Label>Active</Label><div className="mt-3"><Switch checked={item.is_active !== false} onCheckedChange={(value) => updateMapping(item.post_id, { is_active: value })} /></div></div>
                        <div><Label>Post context</Label><Textarea className="mt-1" value={item.caption || ""} onChange={(event) => updateMapping(item.post_id, { caption: event.target.value })} /></div>
                        <div><Label>Prompt Comment</Label><Textarea className="mt-1" value={item.prompt_comment || defaultPromptComment} onChange={(event) => updateMapping(item.post_id, { prompt_comment: event.target.value })} /></div>
                      </div>

                      <Button onClick={() => void saveMapping(item)} disabled={savingPostId === item.post_id}>
                        {savingPostId === item.post_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save this post
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" />Automation event audit</CardTitle><CardDescription>Kon comment e kon action hoyeche dekha jabe.</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => void loadAuditEvents()} disabled={auditLoading}>{auditLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button>
        </CardHeader>
        <CardContent>
          {auditEvents.length === 0 ? <div className="rounded-xl border border-dashed py-7 text-center text-sm text-muted-foreground">এখনও দেখানোর মতো কোনো automation event নেই।</div> : <div className="space-y-3">{auditEvents.slice(0, 10).map((event) => <div key={event.id} className="rounded-xl border bg-muted/30 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0"><p className="truncate font-medium">{event.comment_text || "Comment text পাওয়া যায়নি"}</p><p className="mt-1 text-xs text-muted-foreground">Comment: {event.comment_id}{event.post_id ? ` · Post: ${event.post_id}` : ""}</p>{event.decision?.reason ? <p className="mt-1 text-xs text-muted-foreground">Reason: {event.decision.reason}</p> : null}</div><span className="shrink-0 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span></div><div className="mt-3 flex flex-wrap gap-2"><AuditStatus label="Action" value={event.decision?.action} /><AuditStatus label="Reply" value={event.public_reply_status} /><AuditStatus label={event.reaction_type ? `Like (${event.reaction_type})` : "Like"} value={event.reaction_status} /><AuditStatus label="Hide" value={event.moderation_status} />{event.error_message ? <Badge variant="destructive" className="font-normal">Error: {event.error_message}</Badge> : null}</div></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
