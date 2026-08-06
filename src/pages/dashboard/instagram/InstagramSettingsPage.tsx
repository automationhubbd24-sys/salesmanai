import { useEffect, useRef, useState } from "react";
import { Bot, Image, Loader2, Save, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

const defaultConfig = {
  provider: "gemini", api_key: "", chat_model: "", text_prompt: "You are a helpful Instagram sales assistant.",
  image_prompt: "", wait: 5, check_conversion: 20, temperature: 0.7, top_p: 0.9,
};

type Config = typeof defaultConfig;

export default function InstagramSettingsPage() {
  const accountId = localStorage.getItem("active_ig_account_id");
  const databaseId = localStorage.getItem("active_ig_db_id");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [config, setConfig] = useState<Config>(defaultConfig);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const load = async () => {
      if (!databaseId) { setLoading(false); return; }
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) throw new Error("Instagram AI settings load করা যায়নি");
        const data = await response.json();
        setConfig({ ...defaultConfig, ...data, provider: data.ai || data.provider || defaultConfig.provider });
      } catch (error) { toast.error(error instanceof Error ? error.message : "Instagram AI settings load করা যায়নি"); }
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
      if (!response.ok) throw new Error("Instagram AI settings save করা যায়নি");
      toast.success("Instagram AI settings saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Instagram AI settings save করা যায়নি"); }
    finally { setSaving(false); }
  };

  const optimizePrompt = async () => {
    if (!config.text_prompt.trim()) return;
    setOptimizing(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/optimize-prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptText: config.text_prompt }) });
      const data = await response.json();
      if (!data.success || !data.optimizedPrompt) throw new Error(data.error || "Optimization failed");
      setConfig(current => ({ ...current, text_prompt: data.optimizedPrompt }));
      toast.success("Prompt optimized হয়েছে। Save করে পরিবর্তনটি চালু করুন।");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Prompt optimize করা যায়নি"); }
    finally { setOptimizing(false); }
  };

  if (loading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!accountId) return <div className="flex min-h-[360px] flex-col items-center justify-center gap-3"><Bot className="h-14 w-14 text-muted-foreground" /><h2 className="text-2xl font-bold">No Instagram Account Connected</h2><Button asChild><a href="/dashboard/instagram/integration">Go to Instagram Integration</a></Button></div>;

  const update = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(current => ({ ...current, [key]: value }));
  return <div className="space-y-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-3xl font-bold">Instagram AI Intelligence</h1><p className="mt-1 text-muted-foreground">Instagram DM automation-এর AI behavior configure করুন।</p></div><Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Configuration</Button></div><Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="text-pink-500" />AI Provider Configuration</CardTitle><CardDescription>নিজের AI provider ও API key ব্যবহার করুন।</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div><Label>AI Provider</Label><Input value={config.provider} onChange={event => update("provider", event.target.value)} placeholder="gemini, openai, openrouter" /></div><div><Label>Model</Label><Input value={config.chat_model} onChange={event => update("chat_model", event.target.value)} placeholder="gemini-2.0-flash" /></div><div className="md:col-span-2"><Label>API Key</Label><Input type="password" value={config.api_key} onChange={event => update("api_key", event.target.value)} placeholder="API key" /></div></CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-pink-500" />AI Instructions</CardTitle><CardDescription>Text ও image message কীভাবে handle করবে তা নির্ধারণ করুন।</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><div className="flex items-center justify-between gap-3"><Label>System Prompt</Label><Button variant="outline" size="sm" onClick={() => void optimizePrompt()} disabled={optimizing}>{optimizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Optimize Prompt</Button></div><Textarea ref={promptRef} value={config.text_prompt} onChange={event => update("text_prompt", event.target.value)} className="min-h-48 font-mono" /></div><div className="space-y-2"><Label className="flex items-center gap-2"><Image className="h-4 w-4" />Image Detection Prompt</Label><Textarea value={config.image_prompt} onChange={event => update("image_prompt", event.target.value)} className="min-h-28" placeholder="Describe how the AI should analyze incoming images..." /></div></CardContent></Card><Card><CardHeader><CardTitle>Response Behavior</CardTitle><CardDescription>Reply timing, context ও AI response-এর style নির্ধারণ করুন।</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div><Label>Reply Delay (seconds)</Label><Input type="number" min="0" max="60" value={config.wait} onChange={event => update("wait", Math.max(0, Math.min(60, Number(event.target.value) || 0)))} /></div><div><Label>Messages in Memory</Label><Input type="number" min="1" max="50" value={config.check_conversion} onChange={event => update("check_conversion", Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></div><div><Label>AI Creativity (0–1)</Label><Input type="number" min="0" max="1" step="0.1" value={config.temperature} onChange={event => update("temperature", Math.max(0, Math.min(1, Number(event.target.value) || 0)))} /></div><div><Label>AI Diversity / Top P (0–1)</Label><Input type="number" min="0" max="1" step="0.1" value={config.top_p} onChange={event => update("top_p", Math.max(0, Math.min(1, Number(event.target.value) || 0)))} /></div></CardContent></Card></div>;
}
