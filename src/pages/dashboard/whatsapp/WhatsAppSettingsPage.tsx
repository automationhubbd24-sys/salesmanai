import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { BACKEND_URL, MANAGED_SECRET_KEY } from "@/config";
import { secureFetch } from "@/lib/api";
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

export default function WhatsAppSettingsPage() {
  const { currentSession } = useWhatsApp();
  const { id } = useParams();
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
  
  // Pricing & Credits
  const [selectedPlan, setSelectedPlan] = useState("5000");
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);

  // Behavior Settings
  const [wait, setWait] = useState<number>(8);
  const [historyLimit, setHistoryLimit] = useState<number>(10);
  const [behaviorSaving, setBehaviorSaving] = useState<boolean>(false);
  const [temperature, setTemperature] = useState<number>(0.5);
  const [topP, setTopP] = useState<number>(0.9);
  
  // Optimization
  const [optimizing, setOptimizing] = useState(false);
  
  // Products
  const [productList, setProductList] = useState<PromptProduct[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Labels
  const [isLabelDialogOpen, setIsLabelDialogOpen] = useState(false);
  const [labels, setLabels] = useState<any[]>([]);
  const [labelActions, setLabelActions] = useState<any[]>([]);
  const [labelLoading, setLabelLoading] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelAction, setNewLabelAction] = useState<'stop' | 'continue'>('stop');

  // Credits (Shared)
  const [messageCredit, setMessageCredit] = useState(0);
  const [planActive, setPlanActive] = useState(false);
  const [isOwner, setIsOwner] = useState(true);

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

  const handleApplyCoupon = () => {
    if (couponCode.toUpperCase() === "FREE500" || couponCode.toUpperCase() === "START500") {
        setAppliedCoupon(couponCode.toUpperCase());
        setSelectedPlan("500_free");
        toast.success("Coupon applied! 500 Free Messages unlocked.");
    } else {
        toast.error("Invalid coupon code. Try 'FREE500'");
    }
  };

  const [userBalance, setUserBalance] = useState(0);
  const [purchasing, setPurchasing] = useState(false);
  const [detailedCredits, setDetailedCredits] = useState<any>(null);
  const [isTeamView, setIsTeamView] = useState(false);
  const dailyRemaining = Math.max(
    0,
    Number(detailedCredits?.daily_limit || 0) - Number(detailedCredits?.daily_used || 0)
  );
  const bonusCredit = Number(detailedCredits?.bonus_credit || 0);
  const permanentCredit = Number(detailedCredits?.permanent_credit || 0);
  const totalRemainingCredits = Math.max(0, messageCredit) + dailyRemaining + bonusCredit + permanentCredit;
  const getSubscriptionExpiryMeta = () => {
    if (!detailedCredits?.monthly_expires_at) return null;
    const expires = new Date(detailedCredits.monthly_expires_at);
    const now = new Date();
    const diffTime = expires.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      return {
        text: `আর ${diffDays} দিন বাকি`,
        className: "text-[11px] text-green-600 dark:text-green-400 font-bold"
      };
    }
    if (diffDays === 0) {
      return {
        text: "আজ expire হবে",
        className: "text-[11px] text-yellow-500 font-bold"
      };
    }
    return {
      text: "Expired",
      className: "text-[11px] text-red-500 font-bold"
    };
  };

  const fetchUserBalance = async () => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const headers: Record<string, string> = { 
        Authorization: `Bearer ${token}` 
      };
      
      const teamMode = localStorage.getItem("whatsapp_view_mode");
      const teamOwner = localStorage.getItem("active_team_owner");
      if (teamMode === "team" && teamOwner) {
        headers['x-team-owner'] = teamOwner;
      }

      const res = await secureFetch(`${BACKEND_URL}/api/auth/payments/me`, {
        headers: headers,
      });
      if (res.ok) {
        const data = await res.json();
        setUserBalance(Number(data.balance) || 0);
        const plan = data.subscription_plan || 'none';
        setIsTeamView(Boolean(data.is_team_view));
        setDetailedCredits({
            daily_limit: data.daily_limit || 0,
            daily_used: data.daily_used || 0,
            bonus_credit: data.bonus_credit || 0,
            permanent_credit: data.permanent_credit || 0,
            subscription_plan: plan,
            monthly_expires_at: data.monthly_expires_at || null,
            is_team_view: data.is_team_view
        });
        setMessageCredit(data.message_credit || 0);
        setPlanActive(plan !== 'none');
        
        if (plan === 'starter') setSelectedPlan('m1000');
        else if (plan === 'pro') setSelectedPlan('m3000');
        else if (plan === 'enterprise') setSelectedPlan('m7500');
        else if (plan === 'none' && data.message_credit > 0) setSelectedPlan('500_free');
      }
    } catch (e) {
      console.error("Failed to fetch balance:", e);
    }
  };

  const handlePurchaseCredits = async () => {
    const monthlyPlans = new Set(['m1000', 'm3000', 'm7500']);
    const creditPacks: Record<string, { price: number, credits: number }> = {
      'p300': { price: 300, credits: 1000 },
      'p1200': { price: 1200, credits: 5000 },
      'p2000': { price: 2000, credits: 10000 },
      '500_free': { price: 0, credits: 500 }
    };

    setPurchasing(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("Please login again");

      if (monthlyPlans.has(selectedPlan)) {
        const planPrices: Record<string, number> = { m1000: 1000, m3000: 3000, m7500: 7500 };
        const cost = planPrices[selectedPlan];
        if (userBalance < cost) {
          toast.error(`Insufficient balance. Current balance: ৳${userBalance}. Please top up first.`);
          setTimeout(() => { window.location.href = "/dashboard/payment"; }, 2000);
          return;
        }
        const res = await fetch(`${BACKEND_URL}/api/auth/payments/buy-plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ plan_id: selectedPlan })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Plan purchase failed");
        toast.success("Plan activated successfully");
        setUserBalance(Number(data.balance) || 0);
        setDetailedCredits({
            daily_limit: data.daily_limit || 0,
            daily_used: data.daily_used || 0,
            bonus_credit: data.bonus_credit || 0,
            permanent_credit: data.permanent_credit || 0,
            subscription_plan: data.subscription_plan || 'none',
            monthly_expires_at: data.monthly_expires_at || null
        });
        setMessageCredit(data.message_credit || 0);
        setPlanActive(data.subscription_plan !== 'none');
        setIsPricingOpen(false);
      } else {
        const pack = creditPacks[selectedPlan];
        if (!pack) { toast.error("Please select a valid plan"); return; }
        if (userBalance < pack.price) {
          toast.error(`Insufficient balance. Current balance: ৳${userBalance}. Please top up first.`);
          setTimeout(() => { window.location.href = "/dashboard/payment"; }, 2000);
          return;
        }
        const res = await fetch(`${BACKEND_URL}/api/auth/payments/buy-credits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ plan_id: selectedPlan, amount: pack.credits })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Purchase failed");
        toast.success(`Successfully purchased ${pack.credits} credits!`);
        setUserBalance(Number(data.balance) || 0);
        setDetailedCredits({
            daily_limit: data.daily_limit || 0,
            daily_used: data.daily_used || 0,
            bonus_credit: data.bonus_credit || 0,
            permanent_credit: data.permanent_credit || 0,
            subscription_plan: data.subscription_plan || 'none',
            monthly_expires_at: data.monthly_expires_at || null
        });
        setMessageCredit(data.message_credit || 0);
        setIsPricingOpen(false);
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setPurchasing(false);
    }
  };

  const fetchConfig = useCallback(async (configId: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setLoading(false);
        toast.error("Please login again");
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${configId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error("Failed to load WhatsApp config");
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
        provider: dbRow.ai || dbRow.ai_provider || "openrouter",
        api_key: isManaged ? "" : dbApiKey,
        chatmodel: displayModel,
        text_prompt: dbRow.text_prompt || "",
        base_url: dbRow.custom_base_url || "",
      });

      setWait(dbRow.wait !== undefined && dbRow.wait !== null ? Number(dbRow.wait) : 8);
      setHistoryLimit(dbRow.check_conversion ?? 10);
      setTemperature(dbRow.temperature !== undefined && dbRow.temperature !== null ? Number(dbRow.temperature) : 0.5);
      setTopP(dbRow.top_p !== undefined && dbRow.top_p !== null ? Number(dbRow.top_p) : 0.9);

      await fetchUserBalance();
      setIsOwner(true); 

    } catch (error) {
      console.error("Error fetching config:", error);
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    const sessionDbId = (currentSession as any)?.wp_db_id;
    const storedId = localStorage.getItem("active_wp_db_id");
    const resolvedId = id || (sessionDbId ? String(sessionDbId) : storedId);

    if (resolvedId) {
      setDbId(resolvedId);
      fetchConfig(resolvedId);
    } else {
      fetchUserBalance().finally(() => setLoading(false));
    }
  }, [id, fetchConfig, currentSession]);

  const fetchProductsForPrompt = async () => {
    const sessionName = String(currentSession?.name || localStorage.getItem("active_wa_session_id") || "");
    if (!sessionName) {
      toast.error("Active session missing. Please select a session.");
      return;
    }
    setProductLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        toast.error("Please login again");
        return;
      }
      
      const params = new URLSearchParams();
      params.set("page_id", sessionName);
      params.set("limit", "50");
      params.set("strict", "1");

      const mode = localStorage.getItem("whatsapp_view_mode");
      const teamOwner = localStorage.getItem("active_team_owner");
      if (mode === "team" && teamOwner) {
        params.set("team_owner", teamOwner);
      }

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
      } else {
          console.warn("Products endpoint returned non-200. Assuming empty list.");
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

  useEffect(() => {
    if (isLabelDialogOpen) {
      fetchLabelsAndActions();
    }
  }, [isLabelDialogOpen]);

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
    if (!dbId) return;
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

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${dbId}`, {
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

  const handleSaveBehavior = async () => {
    if (!dbId) return;
    setBehaviorSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("Please login again");

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${dbId}`, {
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

  const fetchLabelsAndActions = async () => {
    const sessionName = String(currentSession?.name || localStorage.getItem("active_wa_session_id") || "");
    if (!sessionName) return;
    
    setLabelLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${BACKEND_URL}/api/whatsapp/labels/${sessionName}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLabels(data || []);
      }
      
      if (dbId) {
        const resConfig = await fetch(`${BACKEND_URL}/api/whatsapp/config/${dbId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resConfig.ok) {
          const config = await resConfig.json();
          setLabelActions(config.label_actions || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch labels", e);
    } finally {
      setLabelLoading(false);
    }
  };

  const handleUpsertLabelAction = async (labelName: string, action: 'stop' | 'continue') => {
    if (!dbId) return;
    try {
      const token = localStorage.getItem("auth_token");
      const newActions = [...labelActions];
      const idx = newActions.findIndex(a => a.label_name.toLowerCase() === labelName.toLowerCase());
      
      if (idx > -1) {
        newActions[idx].ai_action = action;
      } else {
        newActions.push({ id: Date.now(), label_name: labelName, ai_action: action });
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${dbId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ label_actions: newActions })
      });

      if (res.ok) {
        setLabelActions(newActions);
        toast.success("Label action updated");
      }
    } catch (e) {
      toast.error("Failed to update label action");
    }
  };

  const handleDeleteLabelAction = async (actionId: any) => {
    if (!dbId) return;
    try {
      const token = localStorage.getItem("auth_token");
      const newActions = labelActions.filter(a => a.id !== actionId);

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${dbId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ label_actions: newActions })
      });

      if (res.ok) {
        setLabelActions(newActions);
        toast.success("Label action removed");
      }
    } catch (e) {
      toast.error("Failed to delete label action");
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!dbId) return;
    setLoading(true);

    if (mode === "managed") {
        values.provider = "salesmanchatbot"; 
        values.api_key = MANAGED_SECRET_KEY;
        values.chatmodel = proPlusMode ? PRO_PLUS_MANAGED_MODEL : "salesmanchatbot-pro";
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

      const teamOwner = localStorage.getItem("active_team_owner");
      const headers: Record<string, string> = { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}` 
      };
      
      if (teamOwner) {
        headers['x-team-owner'] = teamOwner;
      }

      const payload: any = {
        text_prompt: values.text_prompt,
        ai: values.provider,
        api_key: values.api_key,
        chat_model: values.chatmodel,
        vision_model: null,
        voice_model: values.chatmodel,
        custom_base_url: values.provider === 'custom' ? values.base_url : null,
        cheap_engine: mode === "managed",
        pro_plus_mode: mode === "managed" ? proPlusMode : false
      };

      console.log("Saving AI settings:", payload);

      const resUpdate = await fetch(`${BACKEND_URL}/api/whatsapp/config/${dbId}`, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!resUpdate.ok) {
        const body = await resUpdate.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save settings");
      }

      setActiveMode(mode);
      setActiveProPlusMode(mode === "managed" ? proPlusMode : false);
      toast.success("AI settings saved successfully");
    } catch (error: any) {
      console.error("Save settings error:", error);
      toast.error("Failed to save settings: " + error.message);
    } finally {
      setLoading(false);
    }
  };


  const handleOptimizePrompt = async () => {
    const currentText = textPromptRef.current?.value || "";
    if (!currentText || currentText.length < 10) {
        toast.error("Please enter some prompt text to optimize.");
        return;
    }

    setOptimizing(true);
      try {
        const response = await fetch(`${BACKEND_URL}/api/ai/optimize-prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ promptText: currentText })
        });

        const data = await response.json();
        if (data.success && data.optimizedPrompt && textPromptRef.current) {
            textPromptRef.current.value = data.optimizedPrompt;
            toast.success("Prompt optimized! Review before saving.");
        } else {
            throw new Error(data.error || "Unknown error");
        }
    } catch (error: any) {
      toast.error("Optimization failed: " + error.message);
    } finally {
        setOptimizing(false);
    }
  };

  return (
    <div className="space-y-8 -m-4 md:-m-6 lg:-m-6 p-4 md:p-6 lg:p-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">WhatsApp AI Intelligence</h2>
           <p className="text-muted-foreground mt-1">
             Connect your preferred AI brain for WhatsApp.
           </p>
        </div>
        <div className="flex gap-2">
            <Button 
                onClick={() => setIsLabelDialogOpen(true)} 
                variant="outline"
                className="border-primary/30 hover:border-primary hover:bg-primary/5 transition-all shadow-sm"
            >
                <Tags className="mr-2 h-4 w-4 text-primary" />
                Label & List Management
            </Button>
            <Button 
                onClick={() => handleOpenPrompt("text")} 
                variant="outline"
            >
                <Bot className="mr-2 h-4 w-4" />
                Edit System Prompt
            </Button>
            <Button 
                onClick={() => handleOpenPrompt("image")} 
                variant="outline"
            >
                <Image className="mr-2 h-4 w-4" />
                Edit Image Prompt
            </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card className="bg-background border-border">
          <CardHeader>
            <CardTitle className="flex justify-between items-center flex-wrap gap-2">
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
                    <div className="mb-4 rounded-xl border border-border bg-secondary/30 p-3">
                        <RadioGroup 
                            value={mode || ""} 
                            onValueChange={(v) => {
                                if (v) setMode(v as "own" | "managed");
                            }} 
                            className="grid grid-cols-2 gap-4"
                        >
                  <div>
                    <RadioGroupItem value="own" id="own" className="peer sr-only" />
                    <Label
                      htmlFor="own"
                      className="flex h-full min-h-[80px] flex-col items-start justify-center gap-1 rounded-lg border border-border bg-secondary/40 p-3 text-sm transition-all hover:border-primary/50 hover:bg-primary/5 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:text-primary cursor-pointer"
                    >
                      <Key className="mb-1 h-5 w-5 transition-colors peer-data-[state=checked]:text-primary" />
                      <span className="font-semibold">Use Own API</span>
                      <span className="text-[11px] text-muted-foreground peer-data-[state=checked]:text-primary">
                        Use your own API Key (Gemini, GPT)
                      </span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="managed" id="managed" className="peer sr-only" />
                    <Label
                      htmlFor="managed"
                      className="flex h-full min-h-[80px] flex-col items-start justify-center gap-1 rounded-lg border border-border bg-secondary/40 p-3 text-sm transition-all hover:border-primary/50 hover:bg-primary/5 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:text-primary cursor-pointer"
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
                            : "Your secret API key from the provider dashboard."}
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
                                <SelectItem value="salesmanchatbot-pro">SalesmanChatbot 2.0 Pro (Fast & Accurate)</SelectItem>
                                <SelectItem value="salesmanchatbot-flash">SalesmanChatbot 2.0 Flash (Ultra Fast)</SelectItem>
                                <SelectItem value="salesmanchatbot-lite">SalesmanChatbot 2.0 Lite (Simple Tasks)</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input placeholder="e.g. gpt-4o, claude-3-sonnet" {...field} />
                          )}
                        </FormControl>
                        <FormDescription>
                           Enter the specific model ID (e.g., openai/gpt-4o for OpenRouter)
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
                                        Enabling this uses AI Studio endpoints for smart text, audio, and image fallbacks.
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

                                {(detailedCredits?.subscription_plan !== 'none' || detailedCredits?.permanent_credit > 0 || messageCredit > 0) ? (
                                    <div className="flex items-center gap-4 rounded-xl bg-gradient-to-br from-secondary/80 to-purple-500/5 p-4 shadow-lg border border-border dark:from-purple-900/20 dark:to-purple-950/20 dark:border-purple-800/30">
                                        <div className="text-right flex-1">
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-2">Current Status</p>
                                            <div className="text-base font-black text-foreground leading-none tracking-tight flex items-center justify-end gap-2">
                                                <Sparkles className="h-4 w-4 text-[#00ff88]" />
                                                {isTeamView ? (
                                                  <span className="text-amber-500 font-bold">Managed by Owner</span>
                                                ) : (
                                                  <>
                                                    {(selectedPlan === '500_free' || (detailedCredits?.daily_limit === 0 && messageCredit <= 100)) && "Free Credits"}
                                                    {(selectedPlan === '1000' || selectedPlan === 'm1000' || selectedPlan === 'starter') && "Starter Plan"}
                                                    {(selectedPlan === '5000' || selectedPlan === 'm3000' || selectedPlan === 'pro') && (detailedCredits?.daily_limit > 0 ? "Pro Plan" : "Free Credits")}
                                                    {(selectedPlan === '10000' || selectedPlan === 'm7500' || selectedPlan === 'enterprise') && (detailedCredits?.daily_limit > 0 ? "Enterprise Plan" : "Free Credits")}
                                                    {selectedPlan === 'p300' && "Basic Pack"}
                                                    {selectedPlan === 'p1200' && "Value Pack"}
                                                    {selectedPlan === 'p2000' && "Bulk Saver"}
                                                    {(!selectedPlan || selectedPlan === 'none') && detailedCredits?.subscription_plan !== 'none' && (
                                                      <span className="capitalize">{detailedCredits?.subscription_plan} Plan</span>
                                                    )}
                                                    {(!selectedPlan || selectedPlan === 'none') && detailedCredits?.subscription_plan === 'none' && (detailedCredits?.permanent_credit > 0 || messageCredit > 0) && (
                                                      <span>Permanent Packages</span>
                                                    )}
                                                  </>
                                                )}
                                            </div>
                                            {!isTeamView && getSubscriptionExpiryMeta() && (
                                                <div className="mt-2 flex justify-end">
                                                    <div className="rounded-md bg-green-500/10 border border-green-500/20 px-2 py-1">
                                                        <span className={getSubscriptionExpiryMeta()?.className}>
                                                            {getSubscriptionExpiryMeta()?.text}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            <div className="mt-3 space-y-2">
                                                <div className="flex items-center justify-end gap-2">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-[#00ff88] shadow-[0_0_8px_rgba(0,255,136,0.5)] animate-pulse" />
                                                    <span className="text-sm font-black text-[#00ff88]">
                                                        {totalRemainingCredits.toLocaleString()} <span className="text-[10px] uppercase opacity-60">Credits</span>
                                                    </span>
                                                </div>
                                                
                                                {detailedCredits && detailedCredits.daily_limit > 0 && (
                                                    <div className="flex flex-col items-end gap-1">
                                                        <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-600 dark:text-blue-400 font-bold">
                                                            Daily: {detailedCredits.daily_used.toLocaleString()} / {detailedCredits.daily_limit.toLocaleString()}
                                                        </div>
                                                        <div className="w-24 h-1 bg-secondary rounded-full overflow-hidden">
                                                            <div 
                                                                className="h-full bg-blue-500 transition-all duration-500" 
                                                                style={{ width: `${Math.min(100, (detailedCredits.daily_used / detailedCredits.daily_limit) * 100)}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex flex-wrap justify-end gap-2 mt-2">
                                                    {detailedCredits?.bonus_credit > 0 && (
                                                        <div className="px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[12px] text-amber-600 dark:text-amber-500 font-black shadow-sm">
                                                            BONUS: {detailedCredits.bonus_credit.toLocaleString()}
                                                        </div>
                                                    )}
                                                    {detailedCredits?.permanent_credit > 0 && (
                                                        <div className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[12px] text-emerald-600 dark:text-emerald-500 font-black shadow-sm">
                                                            PERMANENT: {detailedCredits.permanent_credit.toLocaleString()}
                                                        </div>
                                                    )}
                                                    {messageCredit > 0 && (
                                                        <div className="px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-[12px] text-blue-600 dark:text-blue-500 font-black shadow-sm">
                                                            FREE: {messageCredit.toLocaleString()}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {!isTeamView && (
                                          <Button 
                                              type="button" 
                                              variant="outline"  
                                              size="sm"
                                              onClick={() => setIsPricingOpen(true)} 
                                              className="border-border hover:bg-secondary text-foreground font-black h-10 text-[11px] shadow-sm px-4 rounded-xl ml-2"
                                          >
                                              Upgrade
                                          </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between p-3 rounded-xl border border-dashed border-purple-200 bg-purple-50/20 dark:border-purple-800/30 dark:bg-purple-900/10">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-purple-100 dark:bg-purple-900/50 p-1.5 rounded-lg">
                                                    <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                                </div>
                                                <div>
                                                    <h3 className="text-xs font-bold text-purple-900 dark:text-purple-100">
                                                      {isTeamView ? "Managed by Owner" : "No Active Plan"}
                                                    </h3>
                                                    <p className="text-[10px] text-muted-foreground">
                                                      {isTeamView ? "Using owner's shared credit pool." : "Unlock AI by choosing a plan."}
                                                    </p>
                                                </div>
                                            </div>
                                            {!isTeamView && (
                                              <Button 
                                                  type="button" 
                                                  size="sm"
                                                  onClick={() => setIsPricingOpen(true)} 
                                                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold h-8 text-[11px] px-4 rounded-lg shadow-sm"
                                              >
                                                  View Plans
                                              </Button>
                                            )}
                                        </div>
                                )}
                            </div>
                        </div>

                        <Dialog open={isPricingOpen} onOpenChange={setIsPricingOpen}>
                            <DialogContent className="max-w-4xl bg-card border-border text-foreground">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-black text-primary">Select Your AI Plan</DialogTitle>
                                    <DialogDescription className="text-muted-foreground">
                                        Choose the message capacity that fits your needs. Starter/Pro have no expiry; Enterprise is valid for 30 days.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6">
                                    <div className="space-y-4">
                                        <h4 className="text-primary font-black uppercase tracking-widest text-xs flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            Monthly Packages
                                        </h4>
                                        <div className="space-y-3">
                                            {[
                                                { id: 'm1000', name: 'Starter', price: '1,000', msg: '500 Daily Messages', bonus: '3,000 Bonus' },
                                                 { id: 'm3000', name: 'Pro Plan', price: '3,000', msg: '2,000 Daily Messages', bonus: '20,000 Bonus', popular: true },
                                                 { id: 'm7500', name: 'Enterprise', price: '7,500', msg: '5,000 Daily Messages', bonus: '30,000 Bonus' }
                                            ].map((plan) => (
                                                <div 
                                                    key={plan.id}
                                                    className={`cursor-pointer relative rounded-2xl border-2 p-4 transition-all hover:border-primary/60 ${selectedPlan === plan.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50'}`}
                                                    onClick={() => setSelectedPlan(plan.id)}
                                                >
                                                    <div className="flex justify-between items-center">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="font-bold text-lg">{plan.name}</h3>
                                                                {plan.popular && <Badge className="bg-primary text-primary-foreground text-[8px] h-4">POPULAR</Badge>}
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">{plan.msg} • {plan.bonus}</p>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-xl font-black text-primary">৳{plan.price}</div>
                                                            <p className="text-[10px] text-muted-foreground">/ month</p>
                                                        </div>
                                                    </div>
                                                    {selectedPlan === plan.id && <div className="absolute -right-2 -top-2 bg-primary rounded-full p-1 text-primary-foreground shadow-lg"><Check className="h-3 w-3" /></div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h4 className="text-emerald-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                                            <InfinityIcon className="h-4 w-4" />
                                            Permanent Packages
                                        </h4>
                                        <div className="space-y-3">
                                            {[
                                                { id: 'p300', name: 'Basic Pack', price: '300', msg: '1,000 Messages' },
                                                { id: 'p1200', name: 'Value Pack', price: '1,200', msg: '5,000 Messages', popular: true },
                                                { id: 'p2000', name: 'Bulk Saver', price: '2,000', msg: '10,000 Messages' }
                                            ].map((plan) => (
                                                <div 
                                                    key={plan.id}
                                                    className={`cursor-pointer relative rounded-2xl border-2 p-4 transition-all hover:border-emerald-500/60 ${selectedPlan === plan.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-border bg-secondary/50'}`}
                                                    onClick={() => setSelectedPlan(plan.id)}
                                                >
                                                    <div className="flex justify-between items-center">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="font-bold text-lg">{plan.name}</h3>
                                                                {plan.popular && <Badge className="bg-emerald-500 text-white text-[8px] h-4">BEST VALUE</Badge>}
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">{plan.msg}</p>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-xl font-black text-emerald-500">৳{plan.price}</div>
                                                            <p className="text-[10px] text-muted-foreground">No Expiry</p>
                                                        </div>
                                                    </div>
                                                    {selectedPlan === plan.id && <div className="absolute -right-2 -top-2 bg-emerald-500 rounded-full p-1 text-white shadow-lg"><Check className="h-3 w-3" /></div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4 pt-6 border-t border-dashed border-border">
                                     <div className="flex items-end gap-3">
                                         <div className="grid gap-2 flex-1 max-w-xs">
                                             <Label htmlFor="coupon" className="text-muted-foreground font-bold uppercase tracking-wider text-xs">Have a Coupon?</Label>
                                             <Input 
                                                 id="coupon" 
                                                 placeholder="ENTER CODE (E.G. FREE500)" 
                                                 value={couponCode}
                                                 onChange={(e) => setCouponCode(e.target.value)}
                                                 disabled={!!appliedCoupon}
                                                 className="uppercase bg-secondary border-border focus:border-primary/60 font-mono text-foreground"
                                             />
                                         </div>
                                         <Button 
                                             type="button" 
                                             onClick={handleApplyCoupon}
                                             disabled={!!appliedCoupon || !couponCode}
                                             className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                                         >
                                             {appliedCoupon ? "Applied" : "Apply Code"}
                                         </Button>
                                     </div>
 
                                     {appliedCoupon && (
                                         <div 
                                             className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all border-primary bg-primary/10 animate-in fade-in zoom-in duration-300`}
                                             onClick={() => setSelectedPlan('500_free')}
                                         >
                                             <div className="flex flex-col items-center justify-center space-y-2">
                                                 <Badge className="bg-primary text-primary-foreground font-black mb-2">Coupon Applied</Badge>
                                                 <h3 className="font-bold text-xl text-primary">Trial Pack</h3>
                                                 <div className="text-4xl font-black text-foreground">FREE</div>
                                                 <p className="text-sm text-muted-foreground font-medium">500 Messages Credit</p>
                                                 {selectedPlan === '500_free' && <div className="absolute top-3 right-3 text-primary"><Check className="h-7 w-7" /></div>}
                                             </div>
                                         </div>
                                     )}
                                </div>

                                <DialogFooter className="mt-6">
                                    <Button variant="ghost" onClick={() => setIsPricingOpen(false)} className="text-muted-foreground hover:text-foreground" disabled={purchasing}>Cancel</Button>
                                    <Button onClick={handlePurchaseCredits} disabled={purchasing} className="bg-primary text-primary-foreground font-black px-8 hover:bg-primary/90">
                                        {purchasing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                        Confirm & Pay
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}

                <div className="flex justify-end pt-4">
                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={loading} 
                    className="bg-primary hover:bg-primary/90 w-full md:w-auto"
                  >
                    <Save className="mr-2 h-4 w-4" />
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
                                onChange={(e) => setWait(Number(e.target.value) || 0)} 
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
                                onChange={(e) => setHistoryLimit(Number(e.target.value) || 10)} 
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
                              <Input
                                placeholder="Search product..."
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                                className="h-7 max-w-[180px] text-xs bg-secondary/60 border-border"
                              />
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
                    <Button 
                        variant="secondary" 
                        onClick={handleOptimizePrompt} 
                        disabled={optimizing || promptSaving}
                    >
                        {optimizing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Auto-Format Prompt
                    </Button>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsPromptOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSavePrompt} disabled={promptSaving || optimizing}>
                        {promptSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Prompts
                    </Button>
                </div>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isLabelDialogOpen} onOpenChange={setIsLabelDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Tags className="h-6 w-6 text-primary" />
              WhatsApp Label & Action Management
            </DialogTitle>
            <DialogDescription>
              Configure how the AI should behave when specific WhatsApp labels are applied to a chat.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-4 space-y-6">
            {/* Action Summary/Instruction */}
            <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl flex gap-4 items-start text-sm">
              <ShieldAlert className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-primary">How Label Actions Work:</p>
                <p className="text-muted-foreground mt-1">
                  When a label is added to a contact (manually or by AI), the system checks these rules. 
                  If set to <strong>"Stop AI (Handover)"</strong>, the bot will immediately pause for that customer.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Current Labels from WhatsApp */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    WhatsApp Labels
                  </h4>
                  <Button variant="ghost" size="sm" onClick={fetchLabelsAndActions} disabled={labelLoading} className="h-8 text-xs">
                    <RefreshCw className={`mr-1 h-3 w-3 ${labelLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                <div className="border border-border rounded-xl bg-secondary/20 p-4 min-h-[200px] max-h-[400px] overflow-y-auto space-y-2">
                  {labelLoading ? (
                    <div className="flex justify-center items-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : labels.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground italic">
                      No labels found in your WhatsApp.
                    </div>
                  ) : (
                    labels.map((label) => {
                      const existingAction = labelActions.find(a => a.label_name.toLowerCase() === label.name.toLowerCase());
                      return (
                        <div key={label.id} className="flex items-center justify-between p-3 bg-card border border-border rounded-lg shadow-sm hover:shadow-md transition-all">
                          <div className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full shadow-[0_0_5px_rgba(0,0,0,0.1)]" style={{ backgroundColor: label.colorHex || '#ccc' }} />
                            <span className="font-medium">{label.name}</span>
                          </div>
                          {existingAction ? (
                             <Badge variant="outline" className={existingAction.ai_action === 'stop' ? "bg-red-500/10 text-red-500 border-red-500/30" : "bg-green-500/10 text-green-500 border-green-500/30"}>
                               {existingAction.ai_action === 'stop' ? 'AI Stopped' : 'AI Active'}
                             </Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleUpsertLabelAction(label.name, 'stop')} className="h-7 text-[10px] uppercase font-bold px-2">
                              Assign Action
                            </Button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Label Rules (Actions) */}
              <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      Behavior Rules
                    </h4>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-[10px] uppercase font-bold">
                          <Plus className="mr-1 h-3 w-3" />
                          Manual Add
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[425px] bg-card border-border">
                        <DialogHeader>
                          <DialogTitle>Add Manual Label</DialogTitle>
                          <DialogDescription>
                            Manually add a label name to define its behavior rules.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                          <div className="grid gap-2">
                            <Label htmlFor="labelName">Label Name</Label>
                            <Input
                              id="labelName"
                              placeholder="e.g. Paid Customer"
                              value={newLabelName}
                              onChange={(e) => setNewLabelName(e.target.value)}
                            />
                          </div>
                          <div className="flex items-center justify-between rounded-lg border p-3">
                            <div className="space-y-0.5">
                              <Label>AI Action</Label>
                              <div className="text-[11px] text-muted-foreground">
                                {newLabelAction === 'stop' ? 'Bot will stop for this label' : 'Bot will continue talking'}
                              </div>
                            </div>
                            <Switch
                              checked={newLabelAction === 'stop'}
                              onCheckedChange={(checked) => setNewLabelAction(checked ? 'stop' : 'continue')}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button 
                            disabled={!newLabelName.trim()} 
                            onClick={() => {
                              handleUpsertLabelAction(newLabelName, newLabelAction);
                              setNewLabelName("");
                              toast.success("Manual label added");
                            }}
                          >
                            Add Rule
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                <div className="border border-border rounded-xl bg-secondary/10 p-4 min-h-[200px] max-h-[400px] overflow-y-auto space-y-3">
                  {labelActions.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground italic">
                      Define how AI should react to labels.
                    </div>
                  ) : (
                    labelActions.map((action) => (
                      <Card key={action.id} className="p-3 border border-border/60 shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-black text-xs uppercase tracking-wider text-primary">{action.label_name}</span>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteLabelAction(action.id)} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                           <div className="flex items-center gap-2">
                              {action.ai_action === 'stop' ? <ZapOff className="h-4 w-4 text-red-500" /> : <Bot className="h-4 w-4 text-green-500" />}
                              <span className="text-xs font-medium">{action.ai_action === 'stop' ? 'Stop AI' : 'Keep AI Active'}</span>
                           </div>
                           <Switch 
                              checked={action.ai_action === 'stop'} 
                              onCheckedChange={(checked) => handleUpsertLabelAction(action.label_name, checked ? 'stop' : 'continue')}
                           />
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setIsLabelDialogOpen(false)}>Close Manager</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
