import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChevronDown,
  ExternalLink,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  SlidersHorizontal,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

type Platform = "messenger" | "instagram";
type Config = {
  enabled: boolean;
  system_prompt: string;
  hide_keywords: string[];
  hide_ai_instruction: string;
  hide_ai_enabled: boolean;
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
  hide_keywords?: string[];
  hide_ai_instruction?: string;
  hide_ai_enabled?: boolean;
  hide_match_mode?: string;
  post_created_at?: string;
};
type Decision = {
  action?: string;
  reason?: string;
  auto_like?: boolean;
  auto_reply?: boolean;
  auto_hidden?: boolean;
  auto_comment?: boolean;
  hide_reason?: string;
  hide_matched_keywords?: string[];
  hide_mode?: string;
  hide_ai_reason?: string;
  repeat_comment?: boolean;
  repeat_count?: number;
  first_repeat_comment_id?: string;
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
  hide_keywords: [],
  hide_ai_instruction: "",
  hide_ai_enabled: false,
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
    hide_keywords: [],
    hide_ai_instruction: "",
    hide_ai_enabled: true,
    hide_match_mode: "llm_prompt",
  };
}

function normalizeKeywords(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return list.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeMapping(item: Mapping): Mapping {
  return {
    ...item,
    product_ids: Array.isArray(item.product_ids) ? item.product_ids : [],
    is_active: item.is_active !== false,
    hide_keywords: normalizeKeywords(item.hide_keywords),
    hide_ai_instruction: item.hide_ai_instruction || "",
    hide_ai_enabled: true,
    hide_match_mode: "llm_prompt",
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

function HideRulesCard({ mapping, onChange }: { mapping: Mapping; onChange: (patch: Partial<Mapping>) => void }) {
  const disabled = !mapping.auto_hidden;
  return (
    <Card className="border-amber-500/20 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI Hide Rules</CardTitle>
        <CardDescription>Hide ON korle AI ei instruction bujhe comment hide korbe. Keyword match-er upor depend korbe na.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleRow label="Hide Comments" description="Ei post-er comment hide decision AI nibe" checked={Boolean(mapping.auto_hidden)} onChange={(value) => onChange({ auto_hidden: value, hide_ai_enabled: true, hide_match_mode: "llm_prompt" })} />
        {disabled ? <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">AI hide use korte hole first Hide Comments enable korun.</p> : null}
        <div className={disabled ? "pointer-events-none space-y-2 opacity-50" : "space-y-2"}>
          <Label>Hide Instruction</Label>
          <Textarea className="min-h-28" value={mapping.hide_ai_instruction || ""} onChange={(event) => onChange({ hide_ai_instruction: event.target.value, hide_ai_enabled: true, hide_match_mode: "llm_prompt" })} placeholder="Example: Hide abusive, vulgar, spam, scam, competitor promotion, or harmful comments. Obfuscated words like f u c k / f.u.c.k / slang also hide korbe. Normal customer question hide korbe na." />
          <p className="text-xs text-muted-foreground">AI exact keyword charao meaning, slang, spelling variation, dotted/spaced profanity bujhe decision nibe.</p>
        </div>
      </CardContent>
    </Card>
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
  const [searchQuery, setSearchQuery] = useState("");
  const [postFilter, setPostFilter] = useState<"all" | "active" | "paused">("all");
  const [showAddPost, setShowAddPost] = useState(false);
  const [openPostId, setOpenPostId] = useState<string | null>(null);
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
          hide_keywords: normalizeKeywords(responseConfig.hide_keywords),
          hide_ai_instruction: responseConfig.hide_ai_instruction || "",
          hide_ai_enabled: Boolean(responseConfig.hide_ai_enabled),
        });
      }
      if (mappingsResponse.ok) {
        const data = await mappingsResponse.json();
        setMappings(Array.isArray(data) ? data.map(normalizeMapping) : []);
      }
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
        body: JSON.stringify({ ...nextConfig, hide_ai_enabled: true }),
      });
      if (!response.ok) throw new Error("Comment automation settings save করা যায়নি");
      const savedConfig = await response.json();
      setConfig({
        enabled: Boolean(savedConfig.enabled),
        system_prompt: savedConfig.system_prompt || defaultConfig.system_prompt,
        hide_keywords: normalizeKeywords(savedConfig.hide_keywords),
        hide_ai_instruction: savedConfig.hide_ai_instruction || "",
        hide_ai_enabled: Boolean(savedConfig.hide_ai_enabled),
      });
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
        body: JSON.stringify(normalizeMapping(mapping)),
      });
      if (!response.ok) throw new Error("Post settings save করা যায়নি");
      const saved = normalizeMapping(await response.json());
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

  const updateProducts = (mapping: Mapping, value: string): Mapping => ({
    ...mapping,
    product_ids: value.split(",").map((item) => item.trim()).filter(Boolean),
  });

  const activePosts = mappings.filter((item) => item.is_active !== false).length;
  const enabledRuleCount = (mapping: Mapping) => [
    mapping.auto_like,
    mapping.auto_like_children_comment,
    mapping.auto_reply,
    mapping.auto_reply_children_comment,
    mapping.auto_hidden,
    mapping.auto_comment,
  ].filter(Boolean).length;
  const filteredMappings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return mappings.filter((item) => {
      const matchesQuery = !query || [item.post_id, item.caption, item.product_ids?.join(","), item.hide_keywords?.join(",")].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesFilter = postFilter === "all" || (postFilter === "active" ? item.is_active !== false : item.is_active === false);
      return matchesQuery && matchesFilter;
    });
  }, [mappings, postFilter, searchQuery]);

  if (!resourceId) return <Card><CardContent className="py-12 text-center text-muted-foreground">একটি {platform === "instagram" ? "Instagram account" : "Messenger page"} select করুন।</CardContent></Card>;
  if (loading) return <Card><CardContent className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" /></CardContent></Card>;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-[#0f0f0f] p-4 shadow-[0_0_45px_rgba(0,255,136,0.08)] sm:p-6">
        <div className="absolute inset-0 bg-gradient-to-br from-[#00ff88]/10 via-transparent to-transparent" />
        <div className="relative space-y-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-xl bg-primary p-2 text-black"><MessageCircle className="h-5 w-5" /></div>
                <Badge variant={config.enabled ? "default" : "secondary"}>{config.enabled ? "Active" : "Paused"}</Badge>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Comment Automation</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Fast mobile-first controls for likes, replies, hidden comments, and child-comment automation.</p>
            </div>
            <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 sm:w-auto">
              <div><p className="text-sm font-medium">Automation Status</p><p className="text-xs text-muted-foreground">Enable or pause all actions</p></div>
              <Switch checked={config.enabled} onCheckedChange={(enabled) => setConfig({ ...config, enabled })} aria-label="Enable comment automation" />
              <Button onClick={() => void saveConfig()} disabled={saving} className="shrink-0 bg-primary text-black hover:bg-primary/90">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:max-w-md">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><p className="text-lg font-bold">{mappings.length}</p><p className="text-xs text-muted-foreground">Posts</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><p className="text-lg font-bold">{activePosts}</p><p className="text-xs text-muted-foreground">Active</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><p className="text-lg font-bold">{auditEvents.length}</p><p className="text-xs text-muted-foreground">Events</p></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-primary/10 bg-card/95">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />Global AI Prompt</CardTitle>
            <CardDescription>Default instruction used before generating public comment replies.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="comment-automation-system-prompt">System prompt</Label>
              <Textarea id="comment-automation-system-prompt" className="mt-1 min-h-32 text-sm leading-6" value={config.system_prompt} onChange={(event) => setConfig({ ...config, system_prompt: event.target.value })} />
            </div>
            <Button onClick={() => void saveConfig()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save global prompt</Button>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader>
            <CardTitle>Global AI Hide Policy</CardTitle>
            <CardDescription>Common instruction for all posts where Hide Comments is enabled. AI will judge meaning, slang, and obfuscated words.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Global Hide Instruction</Label>
              <Textarea className="mt-1 min-h-32" value={config.hide_ai_instruction} onChange={(event) => setConfig({ ...config, hide_ai_instruction: event.target.value, hide_ai_enabled: true })} placeholder="Example: Hide fake negative reviews, false product-not-working claims, abusive/vulgar comments, competitor spam, scam, or market-down comments. Understand Bangla/Banglish/slang/obfuscated words. Do not hide normal customer questions." />
              <p className="mt-1 text-xs text-muted-foreground">Post-er Hide Comments ON thakle ei policy apply hobe. Keyword list lage na.</p>
            </div>
            <Button onClick={() => void saveConfig({ ...config, hide_ai_enabled: true })} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save hide policy</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Facebook Posts</CardTitle>
            <CardDescription>Sync page posts and configure automation rules for each post.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void syncPosts()} disabled={syncing || platform !== "messenger"}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sync posts
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search posts, captions, keywords, or product IDs" />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex">
              {(["all", "active", "paused"] as const).map((filter) => <Button key={filter} variant={postFilter === filter ? "default" : "outline"} size="sm" onClick={() => setPostFilter(filter)} className="capitalize">{filter}</Button>)}
            </div>
            <Button variant="outline" onClick={() => setShowAddPost((value) => !value)}>
              <Plus className="mr-2 h-4 w-4" />Add Post
            </Button>
          </div>

          {showAddPost ? <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <h3 className="font-semibold">Add Post Manually</h3>
                <p className="text-sm text-muted-foreground">Add a Facebook post ID and define its automation settings.</p>
              </div>
              <Badge variant="outline">Post Rules</Badge>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div><Label>Post / media ID</Label><Input className="mt-1" value={newMapping.post_id} onChange={(event) => setNewMapping({ ...newMapping, post_id: event.target.value })} placeholder={platform === "instagram" ? "Instagram media ID" : "Facebook post ID"} /></div>
              <div><Label>Product IDs</Label><Input className="mt-1" value={newMapping.product_ids.join(", ")} onChange={(event) => setNewMapping(updateProducts(newMapping, event.target.value))} placeholder="12, 15, 20" /></div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <ToggleRow label="Auto Like" description="Like top-level comments automatically" checked={Boolean(newMapping.auto_like)} onChange={(value) => setNewMapping({ ...newMapping, auto_like: value })} />
              <ToggleRow label="Like Child Comments" description="Like replies under existing comments" checked={Boolean(newMapping.auto_like_children_comment)} onChange={(value) => setNewMapping({ ...newMapping, auto_like_children_comment: value })} />
              <ToggleRow label="Auto Reply" description="Reply to top-level comments with AI" checked={Boolean(newMapping.auto_reply)} onChange={(value) => setNewMapping({ ...newMapping, auto_reply: value })} />
              <ToggleRow label="Reply Child Comments" description="Reply to nested comment threads" checked={Boolean(newMapping.auto_reply_children_comment)} onChange={(value) => setNewMapping({ ...newMapping, auto_reply_children_comment: value })} />
              <ToggleRow label="Auto Comment" description="Enable post-level comment actions" checked={Boolean(newMapping.auto_comment)} onChange={(value) => setNewMapping({ ...newMapping, auto_comment: value })} />
            </div>
            <div className="mt-4"><HideRulesCard mapping={newMapping} onChange={(patch) => setNewMapping({ ...newMapping, ...patch })} /></div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Card className="border-white/10 bg-background/60">
                <CardHeader className="pb-3"><CardTitle className="text-base">Post Context</CardTitle><CardDescription>Post caption or product context for AI replies.</CardDescription></CardHeader>
                <CardContent><Textarea className="min-h-28" value={newMapping.caption} onChange={(event) => setNewMapping({ ...newMapping, caption: event.target.value })} /></CardContent>
              </Card>
              <Card className="border-white/10 bg-background/60">
                <CardHeader className="pb-3"><CardTitle className="text-base">Comment Reply Prompt</CardTitle><CardDescription>Instruction used when generating replies for this post.</CardDescription></CardHeader>
                <CardContent><Textarea className="min-h-28" value={newMapping.prompt_comment} onChange={(event) => setNewMapping({ ...newMapping, prompt_comment: event.target.value })} /></CardContent>
              </Card>
            </div>
            <Button className="mt-4 bg-primary text-black hover:bg-primary/90" onClick={() => void saveMapping(newMapping, true)} disabled={savingPostId === newMapping.post_id}>
              {savingPostId === newMapping.post_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save post + toggles
            </Button>
          </div> : null}

          <Separator />

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{filteredMappings.length} of {mappings.length} posts</span>
            <span>{activePosts} active</span>
          </div>

          <div className="grid gap-3">
            {filteredMappings.length === 0 ? <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">No posts match your search or filter.</div> : filteredMappings.map((item) => {
              const open = openPostId === item.post_id;
              const ruleCount = enabledRuleCount(item);
              return (
              <Card key={item.id || item.post_id} className="overflow-hidden border-white/10 bg-card/95">
                <Collapsible open={open} onOpenChange={(nextOpen) => setOpenPostId(nextOpen ? item.post_id : null)}>
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex gap-3">
                      {item.media_url ? <img src={item.media_url} alt="Post media" className="h-16 w-16 shrink-0 rounded-2xl object-cover sm:h-20 sm:w-20" /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-[10px] text-muted-foreground sm:h-20 sm:w-20">No image</div>}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="max-w-[190px] truncate text-sm font-semibold sm:max-w-md">{item.post_id}</p>
                              <Badge variant={item.is_active === false ? "secondary" : "default"}>{item.is_active === false ? "Paused" : "Active"}</Badge>
                              {ruleCount > 0 ? <Badge variant="outline">{ruleCount} rules</Badge> : null}
                            </div>
                            {item.post_created_at ? <p className="mt-1 text-xs text-muted-foreground">{new Date(item.post_created_at).toLocaleString()}</p> : null}
                            {item.caption ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground sm:text-sm">{item.caption}</p> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {item.permalink_url ? <Button variant="ghost" size="icon" asChild><a href={item.permalink_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button> : null}
                            <CollapsibleTrigger asChild><Button variant="ghost" size="icon"><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2 sm:hidden">
                          <div className="rounded-xl border bg-muted/20 p-2 text-center"><p className="mb-1 text-[10px] text-muted-foreground">Like</p><Switch checked={Boolean(item.auto_like)} onCheckedChange={(value) => updateMapping(item.post_id, { auto_like: value })} aria-label="Auto like" /></div>
                          <div className="rounded-xl border bg-muted/20 p-2 text-center"><p className="mb-1 text-[10px] text-muted-foreground">Reply</p><Switch checked={Boolean(item.auto_reply)} onCheckedChange={(value) => updateMapping(item.post_id, { auto_reply: value })} aria-label="Auto reply" /></div>
                          <div className="rounded-xl border bg-muted/20 p-2 text-center"><p className="mb-1 text-[10px] text-muted-foreground">Hide</p><Switch checked={Boolean(item.auto_hidden)} onCheckedChange={(value) => updateMapping(item.post_id, { auto_hidden: value })} aria-label="Hide comments" /></div>
                          <Button size="sm" onClick={() => void saveMapping(item)} disabled={savingPostId === item.post_id} className="h-full bg-primary text-black hover:bg-primary/90">{savingPostId === item.post_id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
                        </div>
                      </div>
                    </div>
                    <CollapsibleContent className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
                        <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                          <div>
                            <h4 className="flex items-center gap-2 font-semibold"><SlidersHorizontal className="h-4 w-4 text-primary" />Automation Rules</h4>
                            <p className="text-xs text-muted-foreground">Choose which actions should run for this post.</p>
                          </div>
                          <Button onClick={() => void saveMapping(item)} disabled={savingPostId === item.post_id} className="bg-primary text-black hover:bg-primary/90">
                            {savingPostId === item.post_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Rules
                          </Button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          <ToggleRow label="Auto Like" description="Like top-level comments automatically" checked={Boolean(item.auto_like)} onChange={(value) => updateMapping(item.post_id, { auto_like: value })} />
                          <ToggleRow label="Like Child Comments" description="Like replies under existing comments" checked={Boolean(item.auto_like_children_comment)} onChange={(value) => updateMapping(item.post_id, { auto_like_children_comment: value })} />
                          <ToggleRow label="Auto Reply" description="Reply to top-level comments with AI" checked={Boolean(item.auto_reply)} onChange={(value) => updateMapping(item.post_id, { auto_reply: value })} />
                          <ToggleRow label="Reply Child Comments" description="Reply to nested comment threads" checked={Boolean(item.auto_reply_children_comment)} onChange={(value) => updateMapping(item.post_id, { auto_reply_children_comment: value })} />
                          <ToggleRow label="Auto Comment" description="Enable post-level comment actions" checked={Boolean(item.auto_comment)} onChange={(value) => updateMapping(item.post_id, { auto_comment: value })} />
                        </div>
                      </div>

                      <HideRulesCard mapping={item} onChange={(patch) => updateMapping(item.post_id, patch)} />

                      <div className="grid gap-4 md:grid-cols-2">
                        <div><Label>Product IDs</Label><Input className="mt-1" value={item.product_ids?.join(", ") || ""} onChange={(event) => updateMapping(item.post_id, updateProducts(item, event.target.value))} /></div>
                        <div><Label>Post Active</Label><div className="mt-3"><Switch checked={item.is_active !== false} onCheckedChange={(value) => updateMapping(item.post_id, { is_active: value })} /></div></div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <Card className="border-white/10 bg-background/60">
                          <CardHeader className="pb-3"><CardTitle className="text-base">Post Context</CardTitle><CardDescription>Post caption or product details used by the AI.</CardDescription></CardHeader>
                          <CardContent><Textarea className="min-h-28" value={item.caption || ""} onChange={(event) => updateMapping(item.post_id, { caption: event.target.value })} /></CardContent>
                        </Card>
                        <Card className="border-white/10 bg-background/60">
                          <CardHeader className="pb-3"><CardTitle className="text-base">Comment Reply Prompt</CardTitle><CardDescription>Custom reply instruction for this post.</CardDescription></CardHeader>
                          <CardContent><Textarea className="min-h-28" value={item.prompt_comment || defaultPromptComment} onChange={(event) => updateMapping(item.post_id, { prompt_comment: event.target.value })} /></CardContent>
                        </Card>
                      </div>
                      <div className="flex justify-between gap-3">
                        <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void deleteMapping(item.post_id)} disabled={deletingPostId === item.post_id}>{deletingPostId === item.post_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete</Button>
                        <Button onClick={() => void saveMapping(item)} disabled={savingPostId === item.post_id} className="bg-primary text-black hover:bg-primary/90">{savingPostId === item.post_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save All</Button>
                      </div>
                    </CollapsibleContent>
                  </CardContent>
                </Collapsible>
              </Card>
            );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" />Automation Activity</CardTitle><CardDescription>Recent comment actions and delivery status.</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => void loadAuditEvents()} disabled={auditLoading}>{auditLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button>
        </CardHeader>
        <CardContent>
          {auditEvents.length === 0 ? <div className="rounded-xl border border-dashed py-7 text-center text-sm text-muted-foreground">এখনও দেখানোর মতো কোনো automation event নেই।</div> : <div className="space-y-3">{auditEvents.slice(0, 10).map((event) => <div key={event.id} className="rounded-xl border bg-muted/30 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0"><p className="truncate font-medium">{event.comment_text || "Comment text পাওয়া যায়নি"}</p><p className="mt-1 text-xs text-muted-foreground">Comment: {event.comment_id}{event.post_id ? ` · Post: ${event.post_id}` : ""}</p>{event.decision?.reason ? <p className="mt-1 text-xs text-muted-foreground">Reason: {event.decision.reason}</p> : null}{event.decision?.hide_reason ? <p className="mt-1 text-xs text-muted-foreground">Hide reason: {event.decision.hide_reason}{event.decision.repeat_comment ? ` · Repeat: ${event.decision.repeat_count || 2} times` : ""}{event.decision.hide_matched_keywords?.length ? ` · Matched: ${event.decision.hide_matched_keywords.join(", ")}` : ""}</p> : null}</div><span className="shrink-0 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span></div><div className="mt-3 flex flex-wrap gap-2"><AuditStatus label="Action" value={event.decision?.action} /><AuditStatus label="Reply" value={event.public_reply_status} /><AuditStatus label={event.reaction_type ? `Like (${event.reaction_type})` : "Like"} value={event.reaction_status} /><AuditStatus label="Hide" value={event.moderation_status} />{event.error_message ? <Badge variant="destructive" className="font-normal">Error: {event.error_message}</Badge> : null}</div></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
