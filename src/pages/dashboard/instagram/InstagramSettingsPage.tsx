import { useEffect, useState } from "react";
import { Bot, Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BACKEND_URL } from "@/config";
import { toast } from "sonner";
import { CommentAutomationSettings } from "@/components/dashboard/CommentAutomationSettings";

const defaultConfig = {
  provider: "gemini",
  api_key: "",
  chat_model: "",
  text_prompt: "You are a helpful Instagram sales assistant.",
  wait: 5,
};

export default function InstagramSettingsPage() {
  const accountId = localStorage.getItem("active_ig_account_id");
  const databaseId = localStorage.getItem("active_ig_db_id");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(defaultConfig);

  useEffect(() => {
    const load = async () => {
      if (!databaseId) {
        setLoading(false);
        return;
      }
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error("Instagram AI settings load করা যায়নি");
        const data = await response.json();
        setConfig({ ...defaultConfig, ...data, provider: data.ai || data.provider || defaultConfig.provider });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Instagram AI settings load করা যায়নি");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [databaseId]);

  const save = async () => {
    if (!databaseId) return;
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error("Instagram AI settings save করা যায়নি");
      toast.success("Instagram AI settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Instagram AI settings save করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!accountId) return <div className="flex min-h-[360px] flex-col items-center justify-center gap-3"><Bot className="h-14 w-14 text-muted-foreground" /><h2 className="text-2xl font-bold">No Instagram Account Connected</h2><Button asChild><a href="/dashboard/instagram/integration">Go to Instagram Integration</a></Button></div>;

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold">Instagram AI Settings</h1><p className="mt-1 text-muted-foreground">Instagram DM automation-এর AI behavior configure করুন।</p></div><Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="text-pink-500" />AI Configuration</CardTitle><CardDescription>নিজের AI provider ও prompt ব্যবহার করুন।</CardDescription></CardHeader><CardContent className="space-y-4"><div><Label>AI Provider</Label><Input value={config.provider} onChange={event => setConfig({ ...config, provider: event.target.value })} placeholder="gemini, openai, openrouter" /></div><div><Label>API Key</Label><Input type="password" value={config.api_key} onChange={event => setConfig({ ...config, api_key: event.target.value })} placeholder="API key" /></div><div><Label>Model</Label><Input value={config.chat_model} onChange={event => setConfig({ ...config, chat_model: event.target.value })} placeholder="gemini-2.0-flash" /></div><div><Label>Reply Delay (seconds)</Label><Input type="number" min="0" value={config.wait} onChange={event => setConfig({ ...config, wait: Number(event.target.value) })} /></div><div><Label>System Prompt</Label><Textarea value={config.text_prompt} onChange={event => setConfig({ ...config, text_prompt: event.target.value })} className="min-h-48" /></div></CardContent></Card>
    <CommentAutomationSettings platform="instagram" resourceId={accountId} />
  </div>;
}
