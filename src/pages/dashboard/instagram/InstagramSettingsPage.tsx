import { useEffect, useState } from "react";
import { Bot, Image, KeyRound, Loader2, Save, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useInstagram } from "@/context/InstagramContext";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";

const defaultConfig = {
  provider: "gemini", api_key: "", chat_model: "gemini-2.0-flash", text_prompt: "You are a helpful Instagram sales assistant.",
  image_prompt: "", wait: 5, check_conversion: 20, temperature: 0.7, top_p: 0.9,
};
type Config = typeof defaultConfig;

const numberValue = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export default function InstagramSettingsPage() {
  const { currentAccount, loading: accountLoading } = useInstagram();
  const [loading, setLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("text");
  const [draftTextPrompt, setDraftTextPrompt] = useState("");
  const [draftImagePrompt, setDraftImagePrompt] = useState("");
  const [config, setConfig] = useState<Config>(defaultConfig);
  const databaseId = currentAccount?.db_id || currentAccount?.id || null;

  useEffect(() => {
    const load = async () => {
      if (!databaseId) {
        setConfig(defaultConfig);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error("Instagram AI settings load করা যায়নি");
        const data = await response.json();
        setConfig({
          provider: data.ai || data.provider || defaultConfig.provider,
          api_key: data.api_key || "",
          chat_model: data.chat_model || defaultConfig.chat_model,
          text_prompt: data.text_prompt || defaultConfig.text_prompt,
          image_prompt: data.image_prompt || "",
          wait: numberValue(data.wait, defaultConfig.wait),
          check_conversion: numberValue(data.check_conversion, defaultConfig.check_conversion),
          temperature: numberValue(data.temperature, defaultConfig.temperature),
          top_p: numberValue(data.top_p, defaultConfig.top_p),
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Instagram AI settings load করা যায়নি");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [databaseId]);

  const update = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(current => ({ ...current, [key]: value }));
  const headers = () => {
    const token = localStorage.getItem("auth_token");
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };

  const saveProviderConfig = async () => {
    if (!databaseId) return;
    setConfigSaving(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ provider: config.provider, api_key: config.api_key, chat_model: config.chat_model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Instagram AI settings save করা যায়নি");
      setConfig(current => ({ ...current, provider: data.ai || current.provider }));
      toast.success("AI provider configuration saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Instagram AI settings save করা যায়নি");
    } finally {
      setConfigSaving(false);
    }
  };

  const openPromptDialog = (tab: "text" | "image") => {
    setDraftTextPrompt(config.text_prompt);
    setDraftImagePrompt(config.image_prompt);
    setActiveTab(tab);
    setPromptOpen(true);
  };

  const savePrompts = async () => {
    if (!databaseId) return;
    setPromptSaving(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ text_prompt: draftTextPrompt, image_prompt: draftImagePrompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prompts save করা যায়নি");
      setConfig(current => ({ ...current, text_prompt: draftTextPrompt, image_prompt: draftImagePrompt }));
      setPromptOpen(false);
      toast.success("Prompts saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Prompts save করা যায়নি");
    } finally {
      setPromptSaving(false);
    }
  };

  const optimizePrompt = async () => {
    if (!draftTextPrompt.trim()) {
      toast.error("আগে একটি system prompt লিখুন");
      return;
    }
    setOptimizing(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/optimize-prompt`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ promptText: draftTextPrompt }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.optimizedPrompt) throw new Error(data.error || "Prompt optimize করা যায়নি");
      setDraftTextPrompt(data.optimizedPrompt);
      toast.success("Prompt optimized হয়েছে। Save করার আগে review করুন।");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Prompt optimize করা যায়নি");
    } finally {
      setOptimizing(false);
    }
  };

  const saveBehavior = async () => {
    if (!databaseId) return;
    setBehaviorSaving(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          wait: config.wait,
          check_conversion: config.check_conversion,
          temperature: config.temperature,
          top_p: config.top_p,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Behavior settings save করা যায়নি");
      toast.success("Behavior settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Behavior settings save করা যায়নি");
    } finally {
      setBehaviorSaving(false);
    }
  };

  if (accountLoading || loading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-pink-500" /></div>;
  if (!currentAccount || !databaseId) return <div className="flex min-h-[360px] flex-col items-center justify-center gap-3"><Bot className="h-14 w-14 text-muted-foreground" /><h2 className="text-2xl font-bold">No Instagram Account Connected</h2><p className="text-muted-foreground">AI settings configure করতে আগে একটি account select করুন।</p><Button asChild><a href="/dashboard/instagram/integration">Go to Instagram Integration</a></Button></div>;

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-3xl font-bold">Instagram AI Intelligence</h1><p className="mt-1 text-muted-foreground">{currentAccount.name}-এর DM automation-এর AI behavior configure করুন।</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => openPromptDialog("text")}><Bot className="mr-2 h-4 w-4" />Edit System Prompt</Button><Button variant="outline" onClick={() => openPromptDialog("image")}><Image className="mr-2 h-4 w-4" />Edit Image Prompt</Button></div>
    </div>

    <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col">
        <DialogHeader><DialogTitle>Edit AI Instructions</DialogTitle><DialogDescription>Text ও image message-এর জন্য AI instructions review ও update করুন।</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 py-4"><Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col"><TabsList><TabsTrigger value="text">System Prompt (Text)</TabsTrigger><TabsTrigger value="image">Image Detection Prompt</TabsTrigger></TabsList><TabsContent value="text" className="mt-4 min-h-0 flex-1"><div className="flex h-full flex-col gap-3"><div className="flex justify-end"><Button type="button" variant="secondary" onClick={() => void optimizePrompt()} disabled={optimizing || promptSaving}>{optimizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Optimize Prompt</Button></div><Textarea value={draftTextPrompt} onChange={event => setDraftTextPrompt(event.target.value)} className="min-h-0 flex-1 resize-none font-mono text-sm leading-relaxed" placeholder="You are a helpful Instagram sales assistant..." /></div></TabsContent><TabsContent value="image" className="mt-4 min-h-0 flex-1"><div className="flex h-full flex-col gap-3"><div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">Incoming image কীভাবে analyze ও reply করবে তা লিখুন।</div><Textarea value={draftImagePrompt} onChange={event => setDraftImagePrompt(event.target.value)} className="min-h-0 flex-1 resize-none font-mono text-sm leading-relaxed" placeholder="Describe how the AI should analyze images..." /></div></TabsContent></Tabs></div>
        <DialogFooter className="flex w-full justify-end gap-2 sm:justify-end"><Button variant="outline" onClick={() => setPromptOpen(false)} disabled={promptSaving}>Cancel</Button><Button onClick={() => void savePrompts()} disabled={promptSaving || optimizing}>{promptSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Prompts</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="text-pink-500" />AI Provider Configuration</CardTitle><CardDescription>নিজের AI provider, model ও secret key ব্যবহার করুন।</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>AI Provider</Label><Select value={config.provider} onValueChange={value => update("provider", value)}><SelectTrigger><SelectValue placeholder="Provider নির্বাচন করুন" /></SelectTrigger><SelectContent><SelectItem value="gemini">Google Gemini</SelectItem><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="openrouter">OpenRouter</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="custom">Custom / Compatible API</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Model</Label><Input value={config.chat_model} onChange={event => update("chat_model", event.target.value)} placeholder="gemini-2.0-flash" /></div><div className="space-y-2 md:col-span-2"><Label className="flex items-center gap-2"><KeyRound className="h-4 w-4" />API Key</Label><Input type="password" autoComplete="new-password" value={config.api_key} onChange={event => update("api_key", event.target.value)} placeholder="নিজের provider API key দিন" /><p className="text-xs text-muted-foreground">Security-এর জন্য saved key আবার দেখানো নাও যেতে পারে। খালি রাখলে বর্তমান key অপরিবর্তিত থাকবে।</p></div></div><div className="flex justify-end"><Button onClick={() => void saveProviderConfig()} disabled={configSaving}>{configSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Configuration</Button></div></CardContent></Card>

    <Card><CardHeader><CardTitle>Response Behavior</CardTitle><CardDescription>Reply timing, context ও AI response-এর style নির্ধারণ করুন।</CardDescription></CardHeader><CardContent className="space-y-6"><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Reply Delay (seconds)</Label><Input type="number" min="0" max="60" value={config.wait} onChange={event => update("wait", Math.max(0, Math.min(60, Number(event.target.value) || 0)))} /></div><div className="space-y-2"><Label>Messages in Memory</Label><Input type="number" min="1" max="50" value={config.check_conversion} onChange={event => update("check_conversion", Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></div><div className="space-y-2"><Label>AI Creativity (Temperature)</Label><Input type="number" min="0" max="1" step="0.1" value={config.temperature} onChange={event => update("temperature", Math.max(0, Math.min(1, Number(event.target.value) || 0)))} /></div><div className="space-y-2"><Label>AI Diversity (Top P)</Label><Input type="number" min="0" max="1" step="0.1" value={config.top_p} onChange={event => update("top_p", Math.max(0, Math.min(1, Number(event.target.value) || 0)))} /></div></div><div className="flex justify-end"><Button variant="secondary" onClick={() => void saveBehavior()} disabled={behaviorSaving}>{behaviorSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Behavior</Button></div></CardContent></Card>
  </div>;
}
