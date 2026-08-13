import { useEffect, useState } from "react";
import { Bot, Hand, Image, LayoutTemplate, Loader2, MessageCircle, Mic, PackageSearch, ReplyAll, Save, Sparkles, StopCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";

const defaults = {
  reply_message: false, swipe_reply: false, image_detection: false, image_send: false,
  template: false, order_tracking: false, audio_detection: false, block_emoji: "", unblock_emoji: "",
};

type Config = typeof defaults;

export default function InstagramControlPage() {
  const [config, setConfig] = useState<Config>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const accountId = localStorage.getItem("active_ig_account_id");
  const databaseId = localStorage.getItem("active_ig_db_id");

  useEffect(() => {
    const load = async () => {
      if (!databaseId) { setLoading(false); return; }
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) throw new Error("Instagram settings load করা যায়নি");
        setConfig({ ...defaults, ...await response.json() });
      } catch (error) { toast.error(error instanceof Error ? error.message : "Instagram settings load করা যায়নি"); }
      finally { setLoading(false); }
    };
    void load();
  }, [databaseId]);

  const save = async () => {
    if (!databaseId) return;
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, { method: "PUT", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(config) });
      if (!response.ok) throw new Error("Instagram settings save করা যায়নি");
      toast.success("Instagram bot controls saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Instagram settings save করা যায়নি"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!accountId) return <div className="flex min-h-[360px] flex-col items-center justify-center gap-3"><Bot className="h-14 w-14 text-muted-foreground" /><h2 className="text-2xl font-bold">No Instagram Account Connected</h2><p className="text-muted-foreground">Integration থেকে একটি Instagram account select করুন।</p><Button asChild><a href="/dashboard/instagram/integration">Go to Instagram Integration</a></Button></div>;

  const items = [
    ["reply_message", "Reply Message", "নতুন Instagram DM-এ স্বয়ংক্রিয় reply পাঠাবে।", MessageCircle],
    ["swipe_reply", "Swipe Reply", "Reply context ব্যবহার করে সঠিক উত্তর দেবে।", ReplyAll],
    ["image_detection", "Image Detection", "আসা ছবির তথ্য AI দিয়ে analyse করবে।", Image],
    ["image_send", "Image Send", "Bot image response পাঠাতে পারবে।", Sparkles],
    ["template", "Template", "Structured message template ব্যবহার করবে।", LayoutTemplate],
    ["order_tracking", "Order Tracking", "Instagram DM থেকে order track করবে।", PackageSearch],
    ["audio_detection", "Audio Detection", "Voice message transcription চালু করবে।", Mic],
  ] as const;
  const toggle = (key: keyof Config, value: boolean) => setConfig(current => ({ ...current, [key]: value }));

  return <div className="space-y-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-3xl font-bold">Instagram Bot Control</h1><p className="mt-1 text-muted-foreground">আপনার Instagram automation features control করুন।</p></div><Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Changes</Button></div><div className="grid gap-4 md:grid-cols-2">{items.map(([key, title, description, Icon]) => <Card key={key}><CardContent className="flex items-center justify-between gap-4 p-5"><div className="flex items-center gap-4"><div className="rounded-xl bg-pink-500/10 p-3 text-pink-500"><Icon className="h-5 w-5" /></div><div><Label className="text-base font-medium">{title}</Label><p className="text-sm text-muted-foreground">{description}</p></div></div><Switch checked={config[key]} onCheckedChange={checked => toggle(key, checked)} /></CardContent></Card>)}</div><Card><CardHeader><CardTitle className="flex items-center gap-2"><Hand className="h-5 w-5 text-pink-500" />Human Handover Settings</CardTitle><CardDescription>Agent-এর জন্য AI pause ও resume emoji ঠিক করুন।</CardDescription></CardHeader><CardContent className="grid gap-5 md:grid-cols-2"><div className="space-y-2"><Label className="flex items-center gap-2"><StopCircle className="h-4 w-4 text-destructive" />Block Emoji</Label><Input value={config.block_emoji} onChange={event => setConfig(current => ({ ...current, block_emoji: event.target.value }))} placeholder="e.g. 🛑" /><p className="text-xs text-muted-foreground">এই emoji পাঠালে AI reply বন্ধ হবে।</p></div><div className="space-y-2"><Label className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Unblock Emoji</Label><Input value={config.unblock_emoji} onChange={event => setConfig(current => ({ ...current, unblock_emoji: event.target.value }))} placeholder="e.g. ✅" /><p className="text-xs text-muted-foreground">এই emoji পাঠালে AI reply আবার চালু হবে।</p></div></CardContent></Card></div>;
}
