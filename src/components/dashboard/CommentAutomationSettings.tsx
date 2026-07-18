import { useEffect, useState } from "react";
import { Loader2, MessageCircle, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

type Platform = "messenger" | "instagram";

type Config = {
  enabled: boolean;
  public_reply_enabled: boolean;
  dm_enabled: boolean;
  ai_enabled: boolean;
  public_reply_template: string;
  dm_system_prompt: string;
  trigger_keywords: string[];
  cooldown_hours: number;
};

type Mapping = { id?: number; post_id: string; caption?: string; media_url?: string; product_ids: string[]; is_active?: boolean };

const defaultConfig: Config = {
  enabled: false,
  public_reply_enabled: true,
  dm_enabled: true,
  ai_enabled: true,
  public_reply_template: "বিস্তারিত জানতে আপনার inbox দেখুন।",
  dm_system_prompt: "You are a sales assistant. Use mapped post/product context as source of truth and reply privately with exact product details in Bangla.",
  trigger_keywords: ["price", "dam", "দাম", "কত", "details", "order", "অর্ডার", "inbox"],
  cooldown_hours: 24,
};

export function CommentAutomationSettings({ platform, resourceId }: { platform: Platform; resourceId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mapping, setMapping] = useState<Mapping>({ post_id: "", caption: "", media_url: "", product_ids: [] });

  const base = `${BACKEND_URL}/api/${platform}`;
  const authHeaders = () => {
    const token = localStorage.getItem("auth_token");
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };

  const load = async () => {
    if (!resourceId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [configResponse, mappingsResponse] = await Promise.all([
        fetch(`${base}/comment-automation/${resourceId}`, { headers: authHeaders() }),
        fetch(`${base}/post-mappings/${resourceId}`, { headers: authHeaders() }),
      ]);
      if (configResponse.ok) setConfig({ ...defaultConfig, ...(await configResponse.json()) });
      if (mappingsResponse.ok) setMappings(await mappingsResponse.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Comment automation load করা যায়নি");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [platform, resourceId]);

  const saveConfig = async () => {
    if (!resourceId) return;
    setSaving(true);
    try {
      const response = await fetch(`${base}/comment-automation/${resourceId}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(config) });
      if (!response.ok) throw new Error("Comment automation settings save করা যায়নি");
      setConfig({ ...defaultConfig, ...(await response.json()) });
      toast.success("Comment automation settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Comment automation settings save করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  const saveMapping = async () => {
    if (!resourceId || !mapping.post_id.trim()) return;
    try {
      const response = await fetch(`${base}/post-mappings/${resourceId}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(mapping) });
      if (!response.ok) throw new Error("Post mapping save করা যায়নি");
      setMapping({ post_id: "", caption: "", media_url: "", product_ids: [] });
      toast.success("Post product mapping saved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Post mapping save করা যায়নি");
    }
  };

  if (!resourceId) return null;
  if (loading) return <Card><CardContent className="flex justify-center py-8"><Loader2 className="animate-spin" /></CardContent></Card>;

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle className="text-pink-500" />Comment Reply + Auto DM</CardTitle><CardDescription>Post ID-এর সাথে Product ID map করলে AI বুঝবে কোন post-এ কোন product, দাম/ডিটেইলস কী। Public comment-এ inbox বলবে, DM-এ full details যাবে।</CardDescription></CardHeader>
    <CardContent className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2"><div className="flex items-center justify-between rounded-lg border p-4"><div><Label>Enable Automation</Label><p className="text-sm text-muted-foreground">Comment এলে public reply + DM flow চালু হবে।</p></div><Switch checked={config.enabled} onCheckedChange={enabled => setConfig({ ...config, enabled })} /></div><div className="flex items-center justify-between rounded-lg border p-4"><div><Label>Use AI for DM</Label><p className="text-sm text-muted-foreground">Mapped product context দিয়ে AI private DM লিখবে।</p></div><Switch checked={config.ai_enabled} onCheckedChange={ai_enabled => setConfig({ ...config, ai_enabled })} /></div><div className="flex items-center justify-between rounded-lg border p-4"><div><Label>Public Reply</Label><p className="text-sm text-muted-foreground">Comment reply-তে inbox দেখতে বলবে।</p></div><Switch checked={config.public_reply_enabled} onCheckedChange={public_reply_enabled => setConfig({ ...config, public_reply_enabled })} /></div><div className="flex items-center justify-between rounded-lg border p-4"><div><Label>Private DM</Label><p className="text-sm text-muted-foreground">Commenter-কে details inbox করবে।</p></div><Switch checked={config.dm_enabled} onCheckedChange={dm_enabled => setConfig({ ...config, dm_enabled })} /></div></div>
      <div><Label>Public Reply Template</Label><Input value={config.public_reply_template} onChange={event => setConfig({ ...config, public_reply_template: event.target.value })} /></div>
      <div><Label>Comment DM System Prompt</Label><Textarea className="min-h-36" value={config.dm_system_prompt} onChange={event => setConfig({ ...config, dm_system_prompt: event.target.value })} /></div>
      <div className="grid gap-4 md:grid-cols-2"><div><Label>Trigger Keywords</Label><Input value={config.trigger_keywords.join(", ")} onChange={event => setConfig({ ...config, trigger_keywords: event.target.value.split(",").map(item => item.trim()).filter(Boolean) })} /></div><div><Label>Cooldown Hours</Label><Input type="number" value={config.cooldown_hours} onChange={event => setConfig({ ...config, cooldown_hours: Number(event.target.value) })} /></div></div>
      <Button onClick={() => void saveConfig()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Comment Settings</Button>
      <div className="rounded-lg border p-4"><h3 className="mb-3 font-semibold">Post to Product Mapping</h3><div className="grid gap-3 md:grid-cols-2"><div><Label>Post / Media ID</Label><Input value={mapping.post_id} onChange={event => setMapping({ ...mapping, post_id: event.target.value })} placeholder="Facebook post ID or Instagram media ID" /></div><div><Label>Product IDs</Label><Input value={mapping.product_ids.join(", ")} onChange={event => setMapping({ ...mapping, product_ids: event.target.value.split(",").map(item => item.trim()).filter(Boolean) })} placeholder="12, 15, 20" /></div><div className="md:col-span-2"><Label>Caption / Context</Label><Textarea value={mapping.caption} onChange={event => setMapping({ ...mapping, caption: event.target.value })} placeholder="এই post-এর product/campaign context" /></div></div><Button className="mt-3" variant="outline" onClick={() => void saveMapping()}><Plus className="mr-2 h-4 w-4" />Save Mapping</Button></div>
      <div className="space-y-2">{mappings.map(item => <div key={item.id || item.post_id} className="rounded-md border p-3 text-sm"><div className="font-medium">Post: {item.post_id}</div><div className="text-muted-foreground">Products: {item.product_ids?.join(", ") || "No product"}</div>{item.caption && <div className="mt-1 line-clamp-2">{item.caption}</div>}</div>)}</div>
    </CardContent>
  </Card>;
}
