import { useCallback, useEffect, useRef, useState } from "react";
import { useInstagram } from "@/context/InstagramContext";
import { BACKEND_URL, MANAGED_SECRET_KEY } from "@/config";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, Bot, Sparkles, Key, Check, Image, Clock, Infinity as InfinityIcon, Loader2, Star, Tags, Plus, Trash2, ShieldAlert, ZapOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

const formSchema = z.object({
  provider: z.string().min(1, "Please select a provider"),
  api_key: z.string().optional(),
  chatmodel: z.string().min(1, "Model name is required"),
  text_prompt: z.string().optional(),
  base_url: z.string().optional(),
});

const MANAGED_MODEL = import.meta.env.VITE_MANAGED_MODEL || "salesmanchatbot-pro";
const PRO_PLUS_MANAGED_MODEL = "salesmanchatbot-pro-plus";

type PromptProduct = {
  id: string | number;
  name?: string | null;
  price?: number | null;
  currency?: string | null;
};

export default function InstagramSettingsPage() {
  const { currentAccount, loading: accountLoading } = useInstagram();
  const [loading, setLoading] = useState(true);
  const [dbId, setDbId] = useState<string | null>(null);
  const [mode, setMode] = useState<"own" | "managed" | null>(null);
  const [activeMode, setActiveMode] = useState<"own" | "managed" | null>(null);
  const [proPlusMode, setProPlusMode] = useState(false);
  const [activeProPlusMode, setActiveProPlusMode] = useState(false);

  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("text");
  const [initialTextPrompt, setInitialTextPrompt] = useState("");
  const [initialImagePrompt, setInitialImagePrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);

  // Optimization
  const [optimizing, setOptimizing] = useState(false);

  // Products
  const [productList, setProductList] = useState<PromptProduct[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Behavior Settings
  const [wait, setWait] = useState<number>(8);
  const [historyLimit, setHistoryLimit] = useState<number>(10);
  const [behaviorSaving, setBehaviorSaving] = useState<boolean>(false);
  const [temperature, setTemperature] = useState<number>(0.5);
  const [topP, setTopP] = useState<number>(0.9);

  const textPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const imagePromptRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: "openrouter",
      api_key: "",
      chatmodel: "openrouter/auto",
      text_prompt: "",
      base_url: "",
    },
  });

  const numberValue = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const fetchConfig = useCallback(async (configId: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setLoading(false);
        toast.error("Please login again");
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/instagram/config/${configId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error("Failed to load Instagram config");
      }

      const dbRow = await res.json();

      setDbId(dbRow.id);
      setInitialTextPrompt(dbRow.text_prompt || "");
      setInitialImagePrompt(dbRow.image_prompt || "");

      const dbApiKey = dbRow.api_key || "";
      let isManaged = false;
      const cheapEngine = dbRow.cheap_engine !== undefined ? dbRow.cheap_engine : null;

      if (cheapEngine === false) {
        isManaged = false;
      } else if (cheapEngine === true) {
        isManaged = true;
      } else {
        isManaged = dbApiKey === MANAGED_SECRET_KEY || (!dbApiKey);
      }

      setMode(isManaged ? "managed" : "own");
      setActiveMode(isManaged ? "managed" : "own");
      const isProPlusActive = Boolean(dbRow.pro_plus_mode);
      setProPlusMode(isManaged ? isProPlusActive : false);
      setActiveProPlusMode(isManaged ? isProPlusActive : false);

      const rawModel = dbRow.chat_model || dbRow.chatmodel || "openrouter/auto";
      const displayModel = rawModel.replace(":free", "");

      form.reset({
        provider: dbRow.ai || dbRow.ai_provider || dbRow.provider || "openrouter",
        api_key: isManaged ? "" : dbApiKey,
        chatmodel: displayModel,
        text_prompt: dbRow.text_prompt || "",
        base_url: dbRow.custom_base_url || "",
      });

      setWait(dbRow.wait !== undefined && dbRow.wait !== null ? Number(dbRow.wait) : 8);
      setHistoryLimit(dbRow.check_conversion ?? 10);
      setTemperature(dbRow.temperature !== undefined && dbRow.temperature !== null ? Number(dbRow.temperature) : 0.5);
      setTopP(dbRow.top_p !== undefined && dbRow.top_p !== null ? Number(dbRow.top_p) : 0.9);

    } catch (error) {
      console.error("Error fetching config:", error);
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    const accountDbId = (currentAccount as any)?.ig_db_id;
    const storedId = localStorage.getItem("active_ig_db_id");
    const resolvedId = accountDbId || dbId || storedId;

    const effectiveId = (currentAccount?.db_id || currentAccount?.id || null);

    if (effectiveId) {
      setDbId(String(effectiveId));
      fetchConfig(String(effectiveId));
    } else {
      setLoading(false);
    }
  }, [currentAccount, fetchConfig]);

  const databaseId = currentAccount?.db_id || currentAccount?.id || dbId;

  const fetchProductsForPrompt = async () => {
    const accountName = String(currentAccount?.name || localStorage.getItem("active_ig_account") || "");
    if (!accountName) return;
    setProductLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const params = new URLSearchParams();
      params.set("page_id", accountName);
      params.set("limit", "50");
      params.set("strict", "1");

      const url = `${BACKEND_URL}/api/products?${params.toString()}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });

      let items: PromptProduct[] = [];
      if (res.ok) {
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          items = data.data;
        } else if (Array.isArray(data)) {
          items = data;
        }
      }
      setProductList(items);
    } catch (error) {
      console.error("Failed to load products for prompt (Non-fatal):", error);
      setProductList([]);
    } finally {
      setProductLoading(false);
    }
  };

  const handleOpenPrompt = (tab: "text" | "image") => {
    setActiveTab(tab);
    setIsPromptOpen(true);
    fetchProductsForPrompt();
  };

  const handleInsertProductIntoPrompt = (product: PromptProduct) => {
    const name = product?.name || "Unnamed Product";
    const line = `\n##PRODUCT "${name}"`;

    if (textPromptRef.current) {
      const textarea = textPromptRef.current;
      const currentValue = textarea.value || "";
      const start = textarea.selectionStart ?? currentValue.length;
      const end = textarea.selectionEnd ?? currentValue.length;
      const before = currentValue.slice(0, start);
      const after = currentValue.slice(end);
      const nextValue = before + line + after;

      textarea.value = nextValue;

      const cursor = start + line.length;
      requestAnimationFrame(() => {
        textarea.selectionStart = cursor;
        textarea.selectionEnd = cursor;
        textarea.focus();
      });
    }
  };

  const handleSavePrompt = async () => {
    if (!databaseId) return;
    setPromptSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("Please login again");

      let body: any = {};
      let currentText = "";
      let currentImage = "";

      if (activeTab === "text") {
        currentText = textPromptRef.current?.value || "";
        body.text_prompt = currentText;
      } else {
        currentImage = imagePromptRef.current?.value || "";
        body.image_prompt = currentImage;
      }

      const res = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save prompt");
      }

      if (activeTab === "text") {
        form.setValue('text_prompt', currentText);
        setInitialTextPrompt(currentText);
        toast.success("System prompt updated!");
      } else {
        setInitialImagePrompt(currentImage);
        toast.success("Image prompt updated!");
      }

      setIsPromptOpen(false);
    } catch (error: any) {
      console.error("Error saving prompt:", error);
      toast.error(error.message);
    } finally {
      setPromptSaving(false);
    }
  };

  const optimizePrompt = async () => {
    const currentValue = textPromptRef.current?.value || initialTextPrompt;
    if (!currentValue.trim()) {
      toast.error("Please write a system prompt first");
      return;
    }
    setOptimizing(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("Please login again");
      const res = await fetch(`${BACKEND_URL}/api/ai/optimize-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ promptText: currentValue }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.optimizedPrompt) throw new Error(data.error || "Prompt optimize failed");
      if (textPromptRef.current) {
        textPromptRef.current.value = data.optimizedPrompt;
      }
      toast.success("Prompt optimized! Review before saving.");
    } catch (error: any) {
      toast.error(error.message || "Prompt optimize failed");
    } finally {
      setOptimizing(false);
    }
  };

  const handleSaveBehavior = async () => {
    if (!databaseId) return;
    setBehaviorSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("Please login again");

      const res = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          wait: wait,
          check_conversion: historyLimit,
          temperature: temperature,
          top_p: topP
        })
      });

      if (!res.ok) throw new Error("Failed to save behavior settings");

      toast.success("Behavior settings saved!");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBehaviorSaving(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!databaseId) return;
    setLoading(true);

    if (mode === "managed") {
      values.provider = "salesmanchatbot";
      values.api_key = MANAGED_SECRET_KEY;
      values.chatmodel = proPlusMode ? PRO_PLUS_MANAGED_MODEL : MANAGED_MODEL;
    } else {
      if (!values.api_key) {
        toast.error("API Key is required for own provider");
        setLoading(false);
        return;
      }
      if (values.api_key === MANAGED_SECRET_KEY) {
        toast.error("Invalid API Key. Please use your own key.");
        setLoading(false);
        return;
      }
    }

    try {
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("Please login again");

      const payload: any = {
        text_prompt: values.text_prompt,
        ai: values.provider,
        provider: values.provider,
        api_key: values.api_key,
        chat_model: values.chatmodel,
        vision_model: null,
        voice_model: values.chatmodel,
        custom_base_url: values.provider === 'custom' ? values.base_url : null,
        cheap_engine: mode === "managed",
        pro_plus_mode: mode === "managed" ? proPlusMode : false
      };

      console.log("Saving Instagram AI settings:", payload);

      const resUpdate = await fetch(`${BACKEND_URL}/api/instagram/config/${databaseId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!resUpdate.ok) {
        const body = await resUpdate.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to save configuration (HTTP ${resUpdate.status})`);
      }

      setActiveMode(mode);
      setActiveProPlusMode(mode === "managed" ? proPlusMode : false);

      form.reset({
        ...values,
        api_key: mode === "managed" ? "" : values.api_key,
      });

      toast.success("AI Configuration Saved");
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  if (accountLoading || loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentAccount || !databaseId) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <Bot className="h-14 w-14 text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Instagram Account Connected</h2>
        <p className="text-muted-foreground">
          AI settings configure করতে আগে একটি account select করুন।
        </p>
        <Button asChild>
          <a href="/dashboard/instagram/integration">Go to Instagram Integration</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 -m-4 p-4 md:-m-6 md:p-6 lg:-m-6 lg:p-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Instagram AI Intelligence</h1>
          <p className="mt-1 text-muted-foreground">
            Connect your preferred AI brain for {currentAccount.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => handleOpenPrompt("text")}>
            <Bot className="mr-2 h-4 w-4" />
            Edit System Prompt
          </Button>
          <Button variant="outline" onClick={() => handleOpenPrompt("image")}>
            <Image className="mr-2 h-4 w-4" />
            Edit Image Prompt
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card className="bg-background border-border">
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              AI Provider Configuration
              {activeMode && (
                <Badge
                  variant="outline"
                  className={
                    activeMode === 'managed'
                      ? 'bg-primary/10 text-primary border-primary/60'
                      : 'border-border text-muted-foreground'
                  }
                >
                  Status: {activeMode === 'managed' ? (activeProPlusMode ? PRO_PLUS_MANAGED_MODEL : "User Cloud API") : "Own API"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Select an AI provider and enter your API Key.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground animate-pulse">Detecting AI Configuration...</p>
              </div>
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-border bg-secondary/40 p-3">
                  <RadioGroup
                    value={mode || ""}
                    onValueChange={(v) => {
                      if (v) setMode(v as "own" | "managed");
                    }}
                    className="grid grid-cols-2 gap-4"
                  >
                    <div>
                      <RadioGroupItem value="own" id="ig-own" className="peer sr-only" />
                      <Label
                        htmlFor="ig-own"
                        className="flex h-full min-h-[80px] flex-col items-start justify-center gap-1 rounded-lg border border-border bg-secondary/60 p-3 text-sm transition-all hover:border-primary/50 hover:bg-primary/5 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:text-primary cursor-pointer"
                      >
                        <Key className="mb-1 h-5 w-5 transition-colors peer-data-[state=checked]:text-primary" />
                        <span className="font-semibold">Use Own API</span>
                        <span className="text-[11px] text-muted-foreground peer-data-[state=checked]:text-primary">
                          Use your own API Key (Gemini, GPT)
                        </span>
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem value="managed" id="ig-managed" className="peer sr-only" />
                      <Label
                        htmlFor="ig-managed"
                        className="flex h-full min-h-[80px] flex-col items-start justify-center gap-1 rounded-lg border border-border bg-secondary/60 p-3 text-sm transition-all hover:border-primary/50 hover:bg-primary/5 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:text-primary cursor-pointer"
                      >
                        <Sparkles className="mb-1 h-5 w-5 transition-colors peer-data-[state=checked]:text-primary" />
                        <span className="font-semibold">User Cloud API</span>
                        <span className="text-[11px] text-muted-foreground peer-data-[state=checked]:text-primary">
                          Hassle-free, High Speed Engine
                        </span>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                    {mode === "own" ? (
                      <>
                        <FormField
                          control={form.control}
                          name="provider"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>AI Provider</FormLabel>
                              <Select
                                onValueChange={(val) => {
                                  field.onChange(val);
                                  if (val === "salesmanchatbot") {
                                    form.setValue("chatmodel", "salesmanchatbot-pro");
                                  }
                                }}
                                value={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select a provider" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="salesmanchatbot">SalesmanChatbot 2.0</SelectItem>
                                  <SelectItem value="openai">OpenAI (GPT-4)</SelectItem>
                                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                                  <SelectItem value="gemini">Google Gemini</SelectItem>
                                  <SelectItem value="mistral">Mistral Cloud</SelectItem>
                                  <SelectItem value="openrouter">OpenRouter (Recommended)</SelectItem>
                                  <SelectItem value="custom">Custom Provider</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                Choose the AI service that powers your bot.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {form.watch("provider") === "custom" && (
                          <FormField
                            control={form.control}
                            name="base_url"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Base URL</FormLabel>
                                <FormControl>
                                  <Input placeholder="https://api.example.com/v1" {...field} />
                                </FormControl>
                                <FormDescription>
                                  Enter the custom API Base URL.
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        <FormField
                          control={form.control}
                          name="api_key"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>API Key</FormLabel>
                              <FormControl>
                                <Input placeholder="sk-..." type="password" {...field} />
                              </FormControl>
                              <FormDescription>
                                {form.watch("provider") === "salesmanchatbot"
                                  ? "Enter your SalesmanChatbot 2.0 API Key from the Developer API page."
                                  : "Your secret API key from the provider dashboard. Saved key আবার দেখানো নাও যেতে পারে।"}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="chatmodel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Model Name</FormLabel>
                              <FormControl>
                                {form.watch("provider") === "salesmanchatbot" ? (
                                  <Select onValueChange={field.onChange} value={field.value || "salesmanchatbot-pro"}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select Model" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="salesmanchatbot-pro">SalesmanChatbot 2.0 Pro (Fast &amp; Accurate)</SelectItem>
                                      <SelectItem value="salesmanchatbot-flash">SalesmanChatbot 2.0 Flash (Ultra Fast)</SelectItem>
                                      <SelectItem value="salesmanchatbot-lite">SalesmanChatbot 2.0 Lite (Simple Tasks)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input placeholder="e.g. gpt-4-turbo" {...field} />
                                )}
                              </FormControl>
                              <FormDescription>
                                {form.watch("provider") === "salesmanchatbot"
                                  ? "Choose your preferred SalesmanChatbot 2.0 model."
                                  : "Specific model ID to use (e.g., gpt-4, claude-3-opus)."}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                      </>
                    ) : (
                      <div className="space-y-6">
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4 dark:border-emerald-800/30 dark:bg-emerald-900/10 shadow-sm transition-all hover:shadow-md">
                          <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-emerald-500/20 bg-secondary/40 p-3">
                            <div>
                              <div className="text-sm font-semibold">Switch Pro Plus Mode</div>
                              <p className="text-xs text-muted-foreground">
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge
                                variant="outline"
                                className={proPlusMode ? "border-primary/60 text-primary" : "border-border text-muted-foreground"}
                              >
                                {proPlusMode ? PRO_PLUS_MANAGED_MODEL : "Standard Cloud"}
                              </Badge>
                              <Switch checked={proPlusMode} onCheckedChange={setProPlusMode} />
                            </div>
                          </div>
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-4">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
                                <Sparkles className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                              </div>
                              <div>
                                <h3 className="font-bold text-emerald-900 dark:text-emerald-100">User Cloud API</h3>
                                <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                                  {proPlusMode ? "SalesmanChatbot Pro Plus routing with smart fallback." : "High-speed engine. No setup required."}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end pt-4">
                      <Button
                        type="submit"
                        size="lg"
                        disabled={loading}
                        className="bg-primary hover:bg-primary/90 w-full md:w-auto"
                      >
                        {loading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        Save Configuration
                      </Button>
                    </div>
                  </form>
                </Form>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-background border-border">
          <CardHeader>
            <CardTitle>Response Behavior</CardTitle>
            <CardDescription>Control how and when the AI replies.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex flex-col space-y-2">
                <Label>Smart Reply Delay <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(Recommended: 5 sec)</span></Label>
                <div className="flex items-center space-x-4">
                  <Input
                    type="number"
                    value={wait}
                    onChange={(e) => setWait(numberValue(e.target.value, 0))}
                    min={0}
                    max={60}
                    className="w-24 font-mono"
                  />
                  <span className="text-sm text-muted-foreground">seconds</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Wait {wait} seconds to detect multiple messages or human intervention before replying.
                </p>
              </div>

              <div className="flex flex-col space-y-2">
                <Label>Memory Context Limit <span className="text-muted-foreground font-normal ml-2">(Max previous messages)</span></Label>
                <div className="flex items-center space-x-4">
                  <Input
                    type="number"
                    value={historyLimit}
                    onChange={(e) => setHistoryLimit(numberValue(e.target.value, 10))}
                    min={1}
                    max={50}
                    className="w-24 font-mono"
                  />
                  <span className="text-sm text-muted-foreground">messages</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Controls how many previous messages the AI remembers for context. (Default: 10)
                </p>
              </div>

              <div className="flex flex-col space-y-2">
                <Label>AI Creativity (Temperature) <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(0.0–1.0)</span></Label>
                <div className="flex items-center space-x-4">
                  <Input
                    type="text"
                    value={temperature}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || val === "." || /^[0-9]*\.?[0-9]*$/.test(val)) {
                        setTemperature(val as any);
                      }
                    }}
                    onBlur={(e) => {
                      const raw = parseFloat(e.target.value) || 0.7;
                      const clamped = Math.max(0, Math.min(1.0, raw));
                      setTemperature(clamped);
                    }}
                    className="w-24 font-mono"
                    placeholder="0.7"
                  />
                  <span className="text-sm text-muted-foreground">level</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Lower = Precise/Robotic. Higher = Creative/Human-like. (Recommended: 0.7)
                </p>
              </div>

              <div className="flex flex-col space-y-2">
                <Label>AI Diversity (Top P) <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(0.0–1.0)</span></Label>
                <div className="flex items-center space-x-4">
                  <Input
                    type="text"
                    value={topP}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || val === "." || /^[0-9]*\.?[0-9]*$/.test(val)) {
                        setTopP(val as any);
                      }
                    }}
                    onBlur={(e) => {
                      const raw = parseFloat(e.target.value) || 0.9;
                      const clamped = Math.max(0, Math.min(1.0, raw));
                      setTopP(clamped);
                    }}
                    className="w-24 font-mono"
                    placeholder="0.9"
                  />
                  <span className="text-sm text-muted-foreground">level</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Controls the diversity of the AI's response. (Recommended: 0.9)
                </p>
              </div>

              <div className="pt-4">
                <Button
                  onClick={handleSaveBehavior}
                  disabled={behaviorSaving}
                  className="w-full md:w-auto"
                  variant="secondary"
                >
                  {behaviorSaving ? "Saving..." : "Update Behavior"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isPromptOpen} onOpenChange={setIsPromptOpen}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Edit AI Instructions</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Define your AI's persona and how it handles images.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 py-4 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="bg-secondary border-border">
                <TabsTrigger value="text">System Prompt (Text)</TabsTrigger>
                <TabsTrigger value="image">Image Detection Prompt</TabsTrigger>
              </TabsList>

              <TabsContent value="text" className="mt-4 h-full">
                <div className="flex flex-col h-full gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        Products shortcut
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Search product..."
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          className="h-7 max-w-[180px] text-xs bg-secondary/60 border-border"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={optimizePrompt}
                          disabled={optimizing || promptSaving}
                          className="h-7 px-3 text-xs"
                        >
                          {optimizing ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="mr-1 h-3 w-3" />
                          )}
                          Optimize Prompt
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto border border-border rounded-md bg-secondary/40 p-2">
                      {productLoading && (
                        <span className="text-xs text-muted-foreground">
                          Loading products...
                        </span>
                      )}
                      {!productLoading && productList.length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          No products found. Add products first.
                        </span>
                      )}
                      {!productLoading &&
                        productList
                          .filter((p) => {
                            if (!productSearch.trim()) return true;
                            const q = productSearch.toLowerCase();
                            return (
                              (p.name && p.name.toLowerCase().includes(q)) ||
                              (String(p.price || "").toLowerCase().includes(q))
                            );
                          })
                          .map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleInsertProductIntoPrompt(p)}
                              className="text-xs px-2 py-1 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/15 hover:border-primary transition-colors text-foreground"
                            >
                              {p.name || "Untitled"}
                            </button>
                          ))}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col">
                    <Textarea
                      ref={textPromptRef}
                      defaultValue={initialTextPrompt}
                      className="w-full flex-1 h-full font-mono text-sm leading-relaxed p-4 resize-none bg-background border-border"
                      placeholder="You are a helpful assistant..."
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="image" className="flex-1 mt-4 h-full">
                <div className="space-y-2 h-full flex flex-col">
                  <div className="bg-secondary/40 p-4 rounded-lg text-sm text-muted-foreground border border-border">
                    <p className="font-semibold mb-1 text-foreground">How Image Detection Works:</p>
                    <p>When a user sends an image, the AI will first "see" it using this prompt. The result is then passed to the main chat AI.</p>
                    <p className="mt-2 italic">Example: "Analyze this image. If it's a product, identify the name, price, and color. If it's a payment screenshot, extract the transaction ID."</p>
                  </div>
                  <Textarea
                    ref={imagePromptRef}
                    defaultValue={initialImagePrompt}
                    className="w-full flex-1 font-mono text-sm leading-relaxed p-4 resize-none bg-background border-border"
                    placeholder="Describe how the AI should analyze images..."
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter className="flex justify-between items-center sm:justify-between w-full">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsPromptOpen(false)} disabled={promptSaving}>
                Cancel
              </Button>
            </div>
            <Button onClick={handleSavePrompt} disabled={promptSaving || optimizing}>
              {promptSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Prompts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
