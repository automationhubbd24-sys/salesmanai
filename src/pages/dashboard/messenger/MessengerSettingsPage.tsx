import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_URL, MANAGED_SECRET_KEY } from "@/config";
import { secureFetch } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, Bot, Lock, Sparkles, Key, Check, Image, Clock, Infinity as InfinityIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const formSchema = z.object({
  provider: z.string().min(1, "Please select a provider"),
  api_key: z.string().optional(),
  chatmodel: z.string().min(1, "Model name is required"),
  text_prompt: z.string().optional(),
  base_url: z.string().optional(),
}).refine(data => {
    // If we can access mode here it would be great, but we can't easily.
    // We'll handle validation logic loosely here and rely on component state or just let it pass if empty for now
    // and validate in onSubmit or ensure it's filled.
    return true;
});

const MANAGED_MODEL = import.meta.env.VITE_MANAGED_MODEL || "salesmanchatbot-pro";
const PRO_PLUS_MANAGED_MODEL = "salesmanchatbot-pro-plus";

type PromptProduct = {
  id: string | number;
  name?: string | null;
  price?: number | null;
  currency?: string | null;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function MessengerSettingsPage() {
  const isInstagram = window.location.pathname.includes("/dashboard/instagram");
  const platformName = isInstagram ? "Instagram" : "Messenger";
  const accountLabel = isInstagram ? "Instagram Account" : "Facebook Page";
  const integrationPath = isInstagram ? "/dashboard/instagram/integration" : "/dashboard/messenger/integration";
  const [loading, setLoading] = useState(true);
  const [dbId, setDbId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const [mode, setMode] = useState<"own" | "managed" | null>(null);
  const [activeMode, setActiveMode] = useState<"own" | "managed" | null>(null);
  const [proPlusMode, setProPlusMode] = useState(false);
  const [activeProPlusMode, setActiveProPlusMode] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("5000");
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [planActive, setPlanActive] = useState(false);
  const [messageCredit, setMessageCredit] = useState(0);
  const [isOwner, setIsOwner] = useState(true);
  
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("text");
  const [initialTextPrompt, setInitialTextPrompt] = useState("");
  const [initialImagePrompt, setInitialImagePrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  
  // New State for Behavior Settings
  const [wait, setWait] = useState<number>(8);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [memoryLimit, setMemoryLimit] = useState<number>(20);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [topP, setTopP] = useState<number>(0.9);

  // Smart Order Reminder Settings
  const [orderReminderEnabled, setOrderReminderEnabled] = useState<boolean>(false);
  const [orderReminderDelay, setOrderReminderDelay] = useState<number>(4);
  const [orderReminderMessage, setOrderReminderMessage] = useState<string>("স্যার, আপনি [PRODUCT] টি নিতে চেয়েছিলেন, আপনি কি অর্ডারটি কনফার্ম করতে চান?");
  
  // New State for Optimization
  const [optimizing, setOptimizing] = useState(false);

  const [productList, setProductList] = useState<PromptProduct[]>([]);
  const [productLoading, setProductLoading] = useState(false);

  const textPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const imagePromptRef = useRef<HTMLTextAreaElement | null>(null);

  const [productSearch, setProductSearch] = useState("");
  
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleApplyCoupon = () => {
    // Simple validation for demo - in production this would verify with backend
    if (couponCode.toUpperCase() === "FREE500" || couponCode.toUpperCase() === "START500") {
        setAppliedCoupon(couponCode.toUpperCase());
        setSelectedPlan("500_free");
        toast.success("Coupon applied! 500 Free Messages unlocked.");
    } else {
        toast.error("Invalid coupon code. Try 'FREE500'");
    }
  };
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
        provider: "openrouter",
        api_key: "",
        chatmodel: "openrouter/auto",
        text_prompt: `You are a helpful assistant for an ${accountLabel}.`,
      },
  });

  const fetchConfig = useCallback(async (id: string, pId: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        if (isMountedRef.current) setLoading(false);
        toast.error("Please login again");
        return;
      }

      const teamOwner = localStorage.getItem("active_team_owner");
      const headers: Record<string, string> = { 
        Authorization: `Bearer ${token}` 
      };
      
      if (teamOwner) {
        headers['x-team-owner'] = teamOwner;
      }

      const resConfig = await fetch(`${BACKEND_URL}/api/messenger/config/${id}`, {
                headers: headers,
                cache: 'no-store'
            });

      if (!resConfig.ok) {
        const body = await resConfig.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load DB config");
      }

      const dbRow: any = await resConfig.json();

      const resPage = await fetch(`${BACKEND_URL}/api/messenger/pages`, {
                headers: headers,
                cache: 'no-store'
            });

      if (!resPage.ok) {
        const body = await resPage.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load page config");
      }

      const pages = await resPage.json();
      const pageRow: any = Array.isArray(pages)
        ? pages.find((p: any) => String(p.page_id) === String(pId))
        : null;

      if (!dbRow || !pageRow) {
        if (isMountedRef.current) setLoading(false);
        return;
      }

      if (isMountedRef.current) {
          setVerified(dbRow.verified !== false);
          setInitialTextPrompt(dbRow.text_prompt || "");
          setInitialImagePrompt(dbRow.image_prompt || "");

          setIsOwner(!dbRow.is_shared);

          const dbApiKey = dbRow.api_key || pageRow.api_key || "";
          const dbModel = dbRow.chat_model || dbRow.chatmodel || pageRow.chat_model || "";

          const currentCredit = Number(pageRow.message_credit || 0);

          const isActive =
            pageRow.subscription_status === "active" || currentCredit > 0;
          setPlanActive(isActive);
          setMessageCredit(currentCredit);

          let isManaged = false;
          const cheapEngine = dbRow.cheap_engine !== undefined ? dbRow.cheap_engine : pageRow.cheap_engine;
          
          // Robust Managed Mode Detection
          if (cheapEngine === true || cheapEngine === 'true') {
            isManaged = true;
          } else if (cheapEngine === false || cheapEngine === 'false') {
            isManaged = false;
          } else {
            // Fallback to model/key check
            isManaged = dbModel.includes("salesmanchatbot") || dbApiKey === MANAGED_SECRET_KEY || (isActive && !dbApiKey);
          }

          console.log(`[Mode Detection] isManaged: ${isManaged}, cheapEngine: ${cheapEngine}, model: ${dbModel}`);

          setMode(isManaged ? "managed" : "own");
          setActiveMode(isManaged ? "managed" : "own");
          const isProPlusActive = Boolean(dbRow.pro_plus_mode ?? pageRow.pro_plus_mode);
          setProPlusMode(isManaged ? isProPlusActive : false);
          setActiveProPlusMode(isManaged ? isProPlusActive : false);

          const rawModel = dbModel || "openrouter/auto";
          const displayModel = rawModel.replace(":free", "");

          form.reset({
            provider: dbRow.ai || dbRow.ai_provider || pageRow.ai || "openrouter",
            api_key: isManaged ? "" : dbApiKey,
            chatmodel: displayModel,
            text_prompt: dbRow.text_prompt || "",
            base_url: dbRow.custom_base_url || pageRow.custom_base_url || "",
          });

          setWait(dbRow.wait !== undefined && dbRow.wait !== null ? Number(dbRow.wait) : 8);
          setMemoryLimit(dbRow.check_conversion || 20);
          setTemperature(dbRow.temperature !== undefined && dbRow.temperature !== null ? Number(dbRow.temperature) : 0.7);
          setTopP(dbRow.top_p !== undefined && dbRow.top_p !== null ? Number(dbRow.top_p) : 0.9);
          
          setOrderReminderEnabled(Boolean(dbRow.order_reminder_enabled));
          setOrderReminderDelay(dbRow.order_reminder_delay_hours || 4);
          setOrderReminderMessage(dbRow.order_reminder_message || "স্যার, আপনি [PRODUCT] টি নিতে চেয়েছিলেন, আপনি কি অর্ডারটি কনফার্ম করতে চান?");

          // Fetch centralized credits (sync across all platforms)
          await fetchUserBalance();
      }
    } catch (error) {
      console.error("Error fetching config:", error);
      toast.error("Failed to load AI settings");
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    const checkConnection = () => {
      const storedDbId = localStorage.getItem("active_fb_db_id");
      const storedPageId = localStorage.getItem("active_fb_page_id");
      
      if (storedDbId && storedPageId) {
        setDbId(storedDbId);
        setPageId(storedPageId);
        fetchConfig(storedDbId, storedPageId);
      } else {
        setDbId(null);
        setPageId(null);
        fetchUserBalance().finally(() => {
            if (isMountedRef.current) setLoading(false);
        });
      }
    };

    checkConnection();

    const handleStorageChange = () => checkConnection();
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("db-connection-changed", handleStorageChange);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("db-connection-changed", handleStorageChange);
    };
  }, [fetchConfig]);

  const fetchProductsForPrompt = async () => {
    if (!pageId) return;
    setProductLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        toast.error("Please login again");
        return;
      }

      const params = new URLSearchParams();
      params.set("page_id", pageId);
      params.set("limit", "50");
      params.set("strict", "1");

      const mode = localStorage.getItem("messenger_view_mode");
      const teamOwner = localStorage.getItem("active_team_owner");
      
      if (mode === "team" && teamOwner) {
        params.set("team_owner", teamOwner);
      }

      const url = `${BACKEND_URL}/api/products?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error("Failed to load products");
      }

      const data = await res.json();
      let items: PromptProduct[] = [];
      if (data.data && Array.isArray(data.data)) {
        items = data.data as PromptProduct[];
      } else if (Array.isArray(data)) {
        items = data as PromptProduct[];
      }
      setProductList(items);
    } catch (error) {
      console.error("Failed to load products for prompt:", error);
      toast.error("Products load korte parlam na");
    } finally {
      setProductLoading(false);
    }
  };

  const handleOpenPrompt = (tab: "text" | "image") => {
    setActiveTab(tab);
    setIsPromptOpen(true);
    if (!productList.length && pageId) {
      fetchProductsForPrompt();
    }
  };

  const handleInsertProductIntoPrompt = (product: PromptProduct) => {
    const name = product?.name || "Unnamed Product";
    // User requested to remove price from shortcut insertion
    // LLM will fetch details via tool call based on product name
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

  const boldProductsInPrompt = (text: string): string => {
    return text;
  };

  const handleSavePrompt = async () => {
    if (!dbId) return;
    setPromptSaving(true);
    try {
        const token = localStorage.getItem("auth_token");
        if (!token) {
          throw new Error("Please login again");
        }

        let body: any = {};
        let processedPrompt = "";
        let currentImage = "";

        if (activeTab === "text") {
          const currentText = textPromptRef.current?.value || "";
          processedPrompt = boldProductsInPrompt(currentText);
          if (textPromptRef.current) {
            textPromptRef.current.value = processedPrompt;
          }
          body.text_prompt = processedPrompt;
        } else {
          currentImage = imagePromptRef.current?.value || "";
          body.image_prompt = currentImage;
        }

        const res = await fetch(`${BACKEND_URL}/api/messenger/config/${dbId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const message = body.error || `Failed with status ${res.status}`;
            throw new Error(message);
        }
        
        if (activeTab === "text") {
          form.setValue('text_prompt', processedPrompt);
          setInitialTextPrompt(processedPrompt);
          toast.success("System prompt updated successfully!");

          if (pageId) {
            fetch(`${BACKEND_URL}/api/ai/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: pageId, promptText: processedPrompt })
            }).then(() => console.log("RAG Ingestion Triggered"))
              .catch(err => console.error("RAG Ingestion Failed", err));
          }
        } else {
          setInitialImagePrompt(currentImage);
          toast.success("Image prompt updated successfully!");
        }

        setIsPromptOpen(false);
    } catch (error: any) {
        console.error("Error saving prompt:", error);
        toast.error("Failed to save prompt: " + error.message);
    } finally {
        setPromptSaving(false);
    }
  };

  const handleSaveBehavior = async () => {
    if (!dbId) return;
    setBehaviorSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again");
      }

      const res = await fetch(`${BACKEND_URL}/api/messenger/config/${dbId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          wait: wait,
          check_conversion: memoryLimit,
          temperature: temperature,
          top_p: topP,
          order_reminder_enabled: orderReminderEnabled,
          order_reminder_delay_hours: orderReminderDelay,
          order_reminder_message: orderReminderMessage
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.error || `Failed with status ${res.status}`;
        throw new Error(message);
      }

      toast.success("Behavior settings saved!");
    } catch (error: any) {
      console.error("Error saving behavior:", error);
      toast.error("Failed to save behavior: " + error.message);
    } finally {
      setBehaviorSaving(false);
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
            setInitialTextPrompt(data.optimizedPrompt);
            toast.success("Prompt optimized successfully! Please review before saving.");
        } else {
            throw new Error(data.error || "Unknown error");
        }
    } catch (error: any) {
        console.error("Optimization failed:", error);
        toast.error("Optimization failed: " + error.message);
    } finally {
        setOptimizing(false);
    }
  };

  const [userBalance, setUserBalance] = useState(0);
  const [purchasing, setPurchasing] = useState(false);
  const [detailedCredits, setDetailedCredits] = useState<{
    daily_limit: number;
    daily_used: number;
    bonus_credit: number;
    permanent_credit: number;
    subscription_plan: string;
    monthly_expires_at?: string | null;
    is_team_view?: boolean;
  } | null>(null);

  const [isTeamView, setIsTeamView] = useState(false);
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
      
      const teamMode = localStorage.getItem("messenger_view_mode");
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
        setMessageCredit(Number(data.message_credit) || 0);
        setIsTeamView(Boolean(data.is_team_view));
        
        const plan = data.subscription_plan || 'none';
        
        // Sync selectedPlan with active plan for UI consistency
        if (plan === 'starter') setSelectedPlan('m1000');
        else if (plan === 'pro') setSelectedPlan('m3000');
        else if (plan === 'enterprise') setSelectedPlan('m7500');
        else if (plan === 'none' && data.message_credit > 0) setSelectedPlan('500_free');

        setDetailedCredits({
          daily_limit: Number(data.daily_limit) || 0,
          daily_used: Number(data.daily_used) || 0,
          bonus_credit: Number(data.bonus_credit) || 0,
          permanent_credit: Number(data.permanent_credit) || 0,
          subscription_plan: plan,
          monthly_expires_at: data.monthly_expires_at || null,
          is_team_view: data.is_team_view
        });
      }
    } catch (e) {
      console.error("Failed to fetch balance:", e);
    }
  };

  // fetchUserBalance is now called inside fetchConfig or the connection effect
  /*
  useEffect(() => {
    fetchUserBalance();
  }, []);
  */

  const handlePurchaseCredits = async () => {
    if (!pageId) return;
    
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

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!dbId || !pageId) return;
    setLoading(true);

    if (mode === "managed") {
        values.provider = proPlusMode ? "salesmanchatbot" : "gemini";
        values.api_key = MANAGED_SECRET_KEY;
        values.chatmodel = proPlusMode ? PRO_PLUS_MANAGED_MODEL : MANAGED_MODEL;
    } else {
        if (!values.api_key) {
            toast.error("API Key is required for own provider");
            setLoading(false);
            return;
        }
        // Strict Isolation: Ensure user's API key is not the managed one
        if (values.api_key === MANAGED_SECRET_KEY) {
            toast.error("Invalid API Key. Please use your own key.");
            setLoading(false);
            return;
        }
    }

    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error("Please login again");
      }

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

      const resUpdate = await fetch(`${BACKEND_URL}/api/messenger/config/${dbId}`, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!resUpdate.ok) {
        const body = await resUpdate.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save settings");
      }

      setActiveMode(mode); // Update active mode indicator
      setActiveProPlusMode(mode === "managed" ? proPlusMode : false);
      toast.success("AI settings saved successfully");
      
    } catch (error: any) {
        console.error("Save settings error:", error);
        toast.error("Failed to save settings: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
     return (
        <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
        </div>
     );
  }

  if (!dbId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Bot className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">No {accountLabel} Connected</h2>
        <p className="text-muted-foreground">Please connect to an {accountLabel} to manage AI settings.</p>
        <Button asChild>
            <Link to={integrationPath}>Go to Accounts</Link>
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
              Your session has expired or is unverified. Please reactivate your account to access AI settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 -m-4 md:-m-6 lg:-m-6 p-4 md:p-6 lg:p-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">{platformName} AI Intelligence</h2>
           <p className="text-muted-foreground mt-1">
             Connect your preferred AI brain for your {accountLabel}.
           </p>
        </div>
        <div className="flex gap-2">
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

      {/* System Prompt Full Screen Dialog */}
      <Dialog open={isPromptOpen} onOpenChange={setIsPromptOpen}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Edit AI Instructions</DialogTitle>
                <DialogDescription>
                    Define your AI's persona and how it handles images.
                </DialogDescription>
            </DialogHeader>
            <div className="flex-1 py-4 overflow-hidden">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                    <TabsList>
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
                                className="h-7 max-w-[180px] text-xs"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto border border-border rounded-md bg-secondary p-2">
                              {productLoading && (
                                <span className="text-xs text-muted-foreground">
                                  Loading products...
                                </span>
                              )}
                              {!productLoading && productList.length === 0 && (
                                <span className="text-xs text-muted-foreground">
                                  No products found. Add products first from Global Products.
                                </span>
                              )}
                              {!productLoading &&
                                productList
                                  .filter((p) => {
                                    if (!productSearch.trim()) return true;
                                    const q = productSearch.toLowerCase();
                                    return (
                                      (p.name && p.name.toLowerCase().includes(q)) ||
                                      (p.price !== null &&
                                        p.price !== undefined &&
                                        String(p.price).toLowerCase().includes(q)) ||
                                      (p.currency && p.currency.toLowerCase().includes(q))
                                    );
                                  })
                                  .map((p) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => handleInsertProductIntoPrompt(p)}
                                      className="text-xs px-2 py-1 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/15 hover:border-primary transition-colors"
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
                              className="w-full flex-1 h-full font-mono text-sm leading-relaxed p-4 resize-none"
                              placeholder="You are a helpful assistant..."
                            />
                          </div>
                        </div>
                    </TabsContent>
                    
                    <TabsContent value="image" className="flex-1 mt-4 h-full">
                         <div className="space-y-2 h-full flex flex-col">
                            <div className="bg-muted/50 p-4 rounded-lg text-sm text-muted-foreground">
                                <p className="font-semibold mb-1">How Image Detection Works:</p>
                                <p>When a user sends an image, the AI will first "see" it using this prompt. The result is then passed to the main chat AI.</p>
                                <p className="mt-2 italic">Example: "Analyze this image. If it's a product, identify the name, price, and color. If it's a payment screenshot, extract the transaction ID."</p>
                            </div>
                            <Textarea 
                                ref={imagePromptRef}
                                defaultValue={initialImagePrompt}
                                className="w-full flex-1 font-mono text-sm leading-relaxed p-4 resize-none"
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
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />
                        ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Auto-Format for Zero Cost
                    </Button>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsPromptOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSavePrompt} disabled={promptSaving || optimizing}>
                        {promptSaving ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Prompts
                    </Button>
                </div>
            </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <RadioGroupItem value="own" id="own" className="peer sr-only" />
                    <Label
                      htmlFor="own"
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
                    <RadioGroupItem value="managed" id="managed" className="peer sr-only" />
                    <Label
                      htmlFor="managed"
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
                        {/* Compact Managed Mode Banner */}
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
                                                    {selectedPlan === '500_free' && "Free Credits"}
                                                    {(selectedPlan === '1000' || selectedPlan === 'm1000' || selectedPlan === 'starter') && "Starter Plan"}
                                                    {(selectedPlan === '5000' || selectedPlan === 'm3000' || selectedPlan === 'pro') && (detailedCredits?.daily_limit > 0 ? "Pro Plan" : "Free Credits")}
                                                    {(selectedPlan === '10000' || selectedPlan === 'm7500' || selectedPlan === 'enterprise') && (detailedCredits?.daily_limit > 0 ? "Enterprise Plan" : "Free Credits")}
                                                    {selectedPlan === 'p150' && "Basic Pack"}
                                                    {selectedPlan === 'p700' && "Value Pack"}
                                                    {selectedPlan === 'p1350' && "Bulk Saver"}
                                                    {(!selectedPlan || selectedPlan === 'none') && detailedCredits?.subscription_plan !== 'none' && (
                                                      <span className="capitalize">{detailedCredits?.subscription_plan} Plan</span>
                                                    )}
                                                    {(!selectedPlan || selectedPlan === 'none') && detailedCredits?.subscription_plan === 'none' && (detailedCredits?.permanent_credit > 0 || messageCredit > 0) && (
                                                      <span>Permanent Packages</span>
                                                    )}
                                                    {(!selectedPlan || selectedPlan === 'none') && detailedCredits?.subscription_plan === 'none' && detailedCredits?.permanent_credit === 0 && messageCredit <= 100 && (
                                                      <span>Free Credits</span>
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
                                                        {messageCredit.toLocaleString()} <span className="text-[10px] uppercase opacity-60">Credits</span>
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

                        {/* Pricing Modal */}
                        <Dialog open={isPricingOpen} onOpenChange={setIsPricingOpen}>
                            <DialogContent className="max-w-4xl bg-card border-border text-foreground">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-black text-primary">Select Your AI Plan</DialogTitle>
                                    <DialogDescription className="text-muted-foreground">
                                        Choose the message capacity that fits your needs. Starter/Pro have no expiry; Enterprise is valid for 30 days.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6">
                                    {/* Monthly Packages */}
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

                                    {/* Permanent Packages */}
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

                                {/* Coupon Section in Modal */}
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
                                             className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all border-[#00ff88] bg-[#00ff88]/10 animate-in fade-in zoom-in duration-300`}
                                             onClick={() => setSelectedPlan('500_free')}
                                         >
                                             <div className="flex flex-col items-center justify-center space-y-2">
                                                 <Badge className="bg-[#00ff88] text-black font-black mb-2">Coupon Applied</Badge>
                                                 <h3 className="font-bold text-xl text-[#00ff88]">Trial Pack</h3>
                                                 <div className="text-4xl font-black text-white">FREE</div>
                                                 <p className="text-sm text-gray-400 font-medium">500 Messages Credit</p>
                                                 {selectedPlan === '500_free' && <div className="absolute top-3 right-3 text-[#00ff88]"><Check className="h-7 w-7" /></div>}
                                             </div>
                                         </div>
                                     )}
                                </div>

                                <DialogFooter className="mt-6">
                                    <Button variant="ghost" onClick={() => setIsPricingOpen(false)} className="text-gray-400 hover:text-white" disabled={purchasing}>Cancel</Button>
                                    <Button onClick={handlePurchaseCredits} disabled={purchasing} className="bg-[#00ff88] text-black font-black px-8 hover:bg-[#00e67a] shadow-[0_10px_30px_rgba(0,255,136,0.25)]">
                                        {purchasing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                        Confirm & Pay
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}

                <div className="flex justify-end">
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

        {/* Semantic Cache Controls - Removed from User View (Admin Only) */}
        {/*
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardHeader>
            <CardTitle>Semantic Caching (Enterprise)</CardTitle>
            <CardDescription>
              Speed up responses and save costs by reusing previous AI answers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5">
                <div className="space-y-1">
                  <Label className="text-base">Enable Semantic Cache</Label>
                  <p className="text-xs text-muted-foreground">Automatically reply to repeated questions from the database.</p>
                </div>
                <Switch 
                  checked={semanticCacheEnabled}
                  onCheckedChange={setSemanticCacheEnabled}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4 p-4 rounded-xl border border-white/5 bg-white/5">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Similarity Threshold</Label>
                    <Badge variant="outline" className="font-mono text-[#00ff88]">{semanticThreshold}</Badge>
                  </div>
                  <Slider 
                    value={[semanticThreshold]} 
                    min={0.50} 
                    max={0.99} 
                    step={0.01} 
                    onValueChange={(val) => setSemanticThreshold(val[0])}
                    className="py-4"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-widest">
                    <span>Loose (0.50)</span>
                    <span>Strict (0.99)</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                    <span className="text-amber-500 font-bold">Note:</span> Higher values are safer but trigger less often. Recommended: 0.96.
                  </p>
                </div>

                <div className="space-y-4 p-4 rounded-xl border border-white/5 bg-white/5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="text-sm font-semibold">Use Embedding (Beta)</Label>
                      <p className="text-xs text-muted-foreground">Use vector embeddings for higher precision.</p>
                    </div>
                    <Switch 
                      checked={embedEnabled}
                      onCheckedChange={setEmbedEnabled}
                    />
                  </div>
                  <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-400">
                    Embeddings provide better semantic understanding but may slightly increase latency on first lookup.
                  </div>
                </div>
              </div>

              <Button 
                onClick={handleSaveBehavior} 
                disabled={behaviorSaving}
                className="w-full md:w-auto"
                variant="secondary"
              >
                {behaviorSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="mr-2 h-4 w-4" />}
                Update Cache Settings
              </Button>
            </div>
          </CardContent>
        </Card>
        */}

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
                                onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setWait(Number.isNaN(val) ? 0 : Math.max(0, Math.min(60, val)));
                                }} 
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
                        <Label>Old Messages in Memory <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(1–50)</span></Label>
                        <div className="flex items-center space-x-4">
                            <Input 
                                type="number" 
                                value={memoryLimit} 
                                onChange={(e) => {
                                    const raw = Number(e.target.value) || 1;
                                    const clamped = Math.max(1, Math.min(50, raw));
                                    setMemoryLimit(clamped);
                                }} 
                                min={1} 
                                max={50}
                                className="w-24 font-mono"
                            />
                            <span className="text-sm text-muted-foreground">messages</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Controls how many recent messages (1–50) the AI uses as memory context.
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
                                    // Allow empty or decimal point while typing
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

                    <div className="border-t border-border pt-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label className="text-base">Smart Order Reminder</Label>
                                <p className="text-sm text-muted-foreground">
                                    Automatically follow up with customers who started an order but didn't finish.
                                </p>
                            </div>
                            <Switch 
                                checked={orderReminderEnabled}
                                onCheckedChange={setOrderReminderEnabled}
                            />
                        </div>

                        {orderReminderEnabled && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="space-y-1.5">
                                    <Label>Reminder Delay <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(1–20 hours)</span></Label>
                                    <div className="flex items-center space-x-4">
                                        <Input 
                                            type="number" 
                                            value={orderReminderDelay} 
                                            onChange={(e) => {
                                                const raw = Number(e.target.value) || 1;
                                                const clamped = Math.max(1, Math.min(20, raw));
                                                setOrderReminderDelay(clamped);
                                            }} 
                                            min={1} 
                                            max={20}
                                            className="w-24 font-mono"
                                        />
                                        <span className="text-sm text-muted-foreground">hours of inactivity</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        System will wait this long before sending the first reminder. (Max 24h window applies).
                                    </p>
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="reminder-msg">Reminder Message Template</Label>
                                    <Textarea 
                                        id="reminder-msg"
                                        placeholder="Hello [NAME], you forgot to complete your order for [PRODUCT]..."
                                        value={orderReminderMessage}
                                        onChange={(e) => setOrderReminderMessage(e.target.value)}
                                        className="min-h-[80px]"
                                    />
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                        <Sparkles className="w-3 h-3" />
                                        AI will automatically rewrite this for each customer to keep reminders varied.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={handleSaveBehavior} disabled={behaviorSaving} variant="secondary">
                            {behaviorSaving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="mr-2 h-4 w-4" />
                                    Save Behavior
                                </>
                            )}
                        </Button>
                    </div>
                    
                    
                </div>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
