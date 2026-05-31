import { useEffect, useRef, useState } from "react";
import { BACKEND_URL } from "@/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Bot, MessageSquare, Loader2, Save, Image, Sparkles, MessageCircle, Lock, PackageSearch, ReplyAll, LayoutTemplate, Hand, StopCircle, CheckCircle2, RefreshCcw, Edit, Mic, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useMessenger } from "@/context/MessengerContext";

export default function MessengerControlPage() {
  const { currentPage, loading: contextLoading } = useMessenger();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(true);
  const navigate = useNavigate();
  
  // Prompt State
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [tempPrompt, setTempPrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  const [config, setConfig] = useState({
    reply_message: false,
    swipe_reply: false,
    image_detection: false,
    image_send: false,
    template: false,
    order_tracking: false,
    audio_detection: false,
    block_emoji: '',
    unblock_emoji: '',
    check_conversion: 10,
    text_prompt: '',
  });

  const activeDbId = currentPage?.db_id || null;
  const activePageId = currentPage?.page_id || null;

  useEffect(() => {
    if (activeDbId) {
      fetchConfig(activeDbId.toString());
    } else if (!contextLoading) {
      setLoading(false);
    }
  }, [activeDbId, contextLoading]);

  const fetchConfig = async (id: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");

      const res = await fetch(`${BACKEND_URL}/api/messenger/config/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        throw new Error(`Failed to load configuration (${res.status})`);
      }

      const row: any = await res.json();

      setVerified(row.verified !== false); 
      setConfig({
        reply_message: row.reply_message ?? false,
        swipe_reply: row.swipe_reply ?? false,
        image_detection: row.image_detection ?? false,
        image_send: row.image_send ?? false,
        template: row.template ?? false,
        order_tracking: row.order_tracking ?? false,
        audio_detection: row.audio_detection ?? false,
        block_emoji: row.block_emoji ?? '',
        unblock_emoji: row.unblock_emoji ?? '',
        check_conversion: row.check_conversion ?? 10,
        text_prompt: row.text_prompt ?? '',
      });
      setTempPrompt(row.text_prompt ?? '');
    } catch (error) {
      console.error('Error fetching config:', error);
      toast.error("Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeDbId) return;
    setSaving(true);
    try {
      const payload = { ...config };
      const token = localStorage.getItem("auth_token");

      const res = await fetch(`${BACKEND_URL}/api/messenger/config/${activeDbId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Failed with status ${res.status}`;
        throw new Error(msg);
      }

      toast.success("Settings saved successfully");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to save settings: " + message);
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!activeDbId) return;
    setPromptSaving(true);
    try {
        const token = localStorage.getItem("auth_token");

        const res = await fetch(`${BACKEND_URL}/api/messenger/config/${activeDbId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ text_prompt: tempPrompt })
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const message = body.error || `Failed with status ${res.status}`;
            throw new Error(message);
        }
        
        // Update local config state
        setConfig(prev => ({ ...prev, text_prompt: tempPrompt }));
        
        toast.success("System prompt updated successfully!");
        
        // Auto-Trigger RAG Ingestion in Background
        if (activePageId) {
            fetch(`${BACKEND_URL}/api/ai/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: activePageId, promptText: tempPrompt })
            }).then(() => console.log("RAG Ingestion Triggered"))
              .catch(err => console.error("RAG Ingestion Failed", err));
        }

        setIsPromptOpen(false);
    } catch (error: any) {
      console.error("Error saving prompt:", error);
      toast.error("Failed to save prompt: " + error.message);
    } finally {
      setPromptSaving(false);
    }
  };

  const handleOptimizePrompt = async () => {
    if (!tempPrompt) return;
    setOptimizing(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/optimize-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText: tempPrompt })
      });
        
      const data = await response.json();
      if (data.success && data.optimizedPrompt) {
          setTempPrompt(data.optimizedPrompt);
          toast.success("Prompt optimized successfully!");
      } else {
          throw new Error(data.error || "Optimization failed");
      }
    } catch (error: any) {
      console.error("Optimization error:", error);
      toast.error("Failed to optimize: " + error.message);
    } finally {
      setOptimizing(false);
    }
  };

  if (loading || contextLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!activeDbId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Bot className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Page Connected</h2>
        <p className="text-muted-foreground">Please select a Facebook page to manage.</p>
        <Button asChild>
            <Link to="/dashboard/messenger/integration">Go to Pages</Link>
        </Button>
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
        <div className="max-w-md w-full text-center space-y-6 p-8 rounded-xl border bg-card shadow-2xl">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
            <Lock className="w-8 h-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-destructive">Account Locked</h2>
            <p className="text-muted-foreground">
              Your session has expired or is unverified. Please reactivate your account to access bot controls.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const ControlCard = ({
    icon: Icon,
    title,
    description,
    checked,
    onCheckedChange,
  }: {
    icon: any;
    title: string;
    description: string;
    checked: boolean;
    onCheckedChange: (c: boolean) => void;
  }) => (
    <Card className="bg-background border-border hover:border-primary/50 transition-colors duration-200">
      <CardContent className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Icon size={22} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-base font-medium cursor-pointer">{title}</Label>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </CardContent>
    </Card>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-foreground tracking-tight">Messenger Bot Control</h2>
          <p className="text-muted-foreground mt-1">
            Manage your Facebook Messenger automation features.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-2">
            <ChevronLeft size={16} />
            Back
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-lg flex-1 sm:flex-none">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ControlCard
            icon={MessageCircle}
            title="Reply Message"
            description="Auto-reply to incoming texts."
            checked={config.reply_message}
            onCheckedChange={(c) => setConfig({ ...config, reply_message: c })}
          />
          <ControlCard
            icon={ReplyAll}
            title="Swipe Reply"
            description="Enable swipe-to-reply context."
            checked={config.swipe_reply}
            onCheckedChange={(c) => setConfig({ ...config, swipe_reply: c })}
          />
          <ControlCard
            icon={Image}
            title="Image Detection"
            description="Analyze received images with AI."
            checked={config.image_detection}
            onCheckedChange={(c) => setConfig({ ...config, image_detection: c })}
          />
          <ControlCard
            icon={Sparkles}
            title="Image Send"
            description="Allow bot to send generated images."
            checked={config.image_send}
            onCheckedChange={(c) => setConfig({ ...config, image_send: c })}
          />
          <ControlCard
            icon={LayoutTemplate}
            title="Template"
            description="Use templates for structured messages."
            checked={config.template}
            onCheckedChange={(c) => setConfig({ ...config, template: c })}
          />
          <ControlCard
            icon={PackageSearch}
            title="Order Tracking"
            description="Track and manage orders automatically."
            checked={config.order_tracking}
            onCheckedChange={(c) => setConfig({ ...config, order_tracking: c })}
          />
          <ControlCard
            icon={Mic}
            title="Audio Detection"
            description="Enable voice message transcription."
            checked={config.audio_detection}
            onCheckedChange={(c) => setConfig({ ...config, audio_detection: c })}
          />
        </div>

        {/* Human Handover / Block Logic Section */}
        <Card className="bg-background border-border">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Hand size={24} />
              </div>
              <div>
                <CardTitle>Human Handover Settings</CardTitle>
                <CardDescription>Configure how and when the AI should pause for a human agent.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <StopCircle className="w-4 h-4 text-red-500" />
                Block Emoji
              </Label>
              <Input
                placeholder="e.g. 🛑"
                value={config.block_emoji}
                onChange={(e) => setConfig({ ...config, block_emoji: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Admin sending this emoji will permanently pause the AI.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Unblock Emoji
              </Label>
              <Input
                placeholder="e.g. ✅"
                value={config.unblock_emoji}
                onChange={(e) => setConfig({ ...config, unblock_emoji: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Admin sending this emoji will resume the AI.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
