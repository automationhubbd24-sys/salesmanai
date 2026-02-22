import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bot, MessageSquare, Loader2, Save, Image, MessageCircle, Lock, PackageSearch, ReplyAll, Mic, Upload, Users, MessageSquareText, Hand, StopCircle, RefreshCcw, ChevronLeft, Activity } from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { BACKEND_URL } from "@/config";

interface WhatsAppConfig {
  reply_message: boolean;
  swipe_reply: boolean;
  image_detection: boolean;
  image_send: boolean;
  order_tracking: boolean;
  audio_detection: boolean;
  file_upload: boolean;
  group_reply: boolean;
  lock_emojis: string;
  unlock_emojis: string;
  check_conversion: number; // Added check_conversion
  image_prompt: string;
  [key: string]: boolean | string | number | undefined; // Allow index access for updates
}

export default function WhatsAppControlPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dbId, setDbId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [config, setConfig] = useState<WhatsAppConfig>({
    reply_message: false,
    swipe_reply: false,
    image_detection: false,
    image_send: false,
    order_tracking: false,
    audio_detection: false,
    file_upload: false,
    group_reply: false,
    lock_emojis: "",
    unlock_emojis: "",
    check_conversion: 20, // Default 20
    image_prompt: ""
  });
  const [stats, setStats] = useState({
    todayTokens: 0,
    yesterdayTokens: 0,
    todayBotReplies: 0,
    yesterdayBotReplies: 0,
    todayCustomers: 0,
    yesterdayCustomers: 0
  });
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const showLegacyMetrics = false;

  useEffect(() => {
    const checkConnection = () => {
      const storedDbId = localStorage.getItem("active_wp_db_id");
      if (storedDbId) {
        setDbId(storedDbId);
        fetchConfig(storedDbId);
      } else {
        setDbId(null);
        setLoading(false);
      }
    };

    checkConnection();

    window.addEventListener("storage", checkConnection);
    window.addEventListener("db-connection-changed", checkConnection);

    return () => {
      window.removeEventListener("storage", checkConnection);
      window.removeEventListener("db-connection-changed", checkConnection);
    };
  }, []);

  const fetchConfig = async (id: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        toast.error(t("Please login again", "অনুগ্রহ করে আবার লগইন করুন"));
        setLoading(false);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error(`Failed to load config (${res.status})`);
      }

      const row: any = await res.json();

      setVerified(row.verified !== false); 
      setSessionName(row.session_name || null);
      setAvailableColumns(Object.keys(row || {}));
      
      if (row.expires_at) {
        const expires = new Date(row.expires_at);
        const now = new Date();
        const diffTime = expires.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        setExpiryDays(diffDays > 0 ? diffDays : 0);
      }

      setConfig({
        reply_message: row.reply_message ?? false,
        swipe_reply: row.swipe_reply ?? false,
        image_detection: row.image_detection ?? false,
        image_send: row.image_send ?? false,
        order_tracking: row.order_tracking ?? false,
        audio_detection: row.audio_detection ?? false,
        file_upload: row.file_upload ?? false,
        group_reply: row.group_reply ?? false,
        lock_emojis: row.lock_emojis ?? "",
        unlock_emojis: row.unlock_emojis ?? "",
        check_conversion: row.check_conversion ?? 20,
        image_prompt: row.image_prompt ?? ""
      });

      if (row.session_name) {
        fetchMetrics(row.session_name);
        fetchRecent(row.session_name);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
      toast.error(t("Failed to load configuration", "কনফিগারেশন লোড করতে ব্যর্থ হয়েছে"));
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async (sName: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const params = new URLSearchParams();
      params.set("session_name", sName);

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/stats?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return;

      const data = await res.json();
      const allTimeReplies = Number(data.allTimeBotReplies) || 0;
      const allTimeTokens = Number(data.allTimeTokenCount) || 0;

      setStats({
        todayTokens: allTimeTokens,
        yesterdayTokens: 0,
        todayBotReplies: allTimeReplies,
        yesterdayBotReplies: 0,
        todayCustomers: 0,
        yesterdayCustomers: 0,
      });
    } catch (e) {
      console.error('Metrics error', e);
    }
  };

  const fetchRecent = async (sName: string) => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const now = Date.now();
      const from = now - 24 * 60 * 60 * 1000;

      const params = new URLSearchParams();
      params.set("session_name", sName);
      params.set("from", String(from));
      params.set("to", String(now));

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return;

      const data = await res.json();
      setRecentChats(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Recent fetch error', e);
    }
  };

  const handleSave = async () => {
    if (!dbId) return;
    setSaving(true);
    try {
      const validColumns = [
        'reply_message', 'swipe_reply', 'image_detection', 'image_send', 
        'order_tracking', 'audio_detection', 'file_upload', 'group_reply',
        'lock_emojis', 'unlock_emojis', 'check_conversion'
      ];

      const updates: any = {};
      validColumns.forEach(key => {
        updates[key] = config[key];
      });

      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error(t("Please login again", "অনুগ্রহ করে আবার লগইন করুন"));
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${dbId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Failed with status ${res.status}`;
        throw new Error(msg);
      }

      toast.success(t("Settings saved successfully", "সেটিংস সফলভাবে সংরক্ষিত হয়েছে"));
      
      await fetchConfig(dbId);
      
      if (sessionName) {
        fetchMetrics(sessionName);
        fetchRecent(sessionName);
      }
    } catch (error: any) {
      const message = error.message || (typeof error === 'string' ? error : "Unknown error");
      toast.error(t("Failed to save settings: ", "সেটিংস সংরক্ষণ করতে ব্যর্থ হয়েছে: ") + message);
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!dbId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Bot className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">{t("No Database Connected", "কোন ডাটাবেস সংযুক্ত নেই")}</h2>
        <p className="text-muted-foreground">{t("Please connect to a database to manage bot controls.", "বট কন্ট্রোল পরিচালনা করতে অনুগ্রহ করে একটি ডাটাবেস সংযুক্ত করুন।")}</p>
        <Button asChild>
            <Link to="/dashboard/whatsapp/database">{t("Go to Database", "ডাটাবেসে যান")}</Link>
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
            <h2 className="text-2xl font-bold text-destructive">{t("Account Locked", "অ্যাকাউন্ট লক করা")}</h2>
            <p className="text-muted-foreground">
              {t("Your session has expired or is unverified. Please reactivate your account to access bot controls.", "আপনার সেশন শেষ হয়ে গেছে বা এটি যাচাই করা হয়নি। বট কন্ট্রোল অ্যাক্সেস করতে অনুগ্রহ করে আপনার অ্যাকাউন্ট পুনরায় সক্রিয় করুন।")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-foreground tracking-tight">{t("Bot Control", "বট কন্ট্রোল")}</h2>
          <p className="text-muted-foreground">
            {t("Manage your automation features.", "আপনার অটোমেশন ফিচারগুলো পরিচালনা করুন।")}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-2">
            <ChevronLeft size={16} />
            {t("Back", "পিছনে")}
          </Button>
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-lg flex-1 md:flex-none">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {t("Save Changes", "পরিবর্তন সংরক্ষণ করুন")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Expiry Card */}
        {expiryDays !== null && (
          <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 col-span-1 lg:col-span-2">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${expiryDays < 3 ? 'bg-red-500/10 text-red-400 border border-red-500/40' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/40'} shadow-[0_0_25px_rgba(16,185,129,0.35)]`}>
                   <Activity size={24} />
                </div>
                <div className="space-y-1">
                  <Label className="text-lg font-semibold">{t("Session Status", "সেশনের স্থিতি")}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t("{days} days remaining in your active plan.", "{days} দিন আপনার সক্রিয় প্ল্যানে বাকি আছে।").replace("{days}", expiryDays.toString())}
                  </p>
                </div>
              </div>
              <Button variant="outline" className="cursor-default hover:bg-transparent">
                {t("{days} Days Left", "{days} দিন বাকি").replace("{days}", expiryDays.toString())}
              </Button>
            </CardContent>
          </Card>
        )}

        {showLegacyMetrics && (
          <>
            <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" /> Bot Replies</CardTitle>
                <CardDescription>Today vs Yesterday</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Today</div>
                    <div className="text-2xl font-bold">{stats.todayBotReplies}</div>
                  </div>
                  <div className="space-y-1 text-right">
                    <div className="text-sm text-muted-foreground">Yesterday</div>
                    <div className="text-2xl font-bold">{stats.yesterdayBotReplies}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" /> Tokens Used</CardTitle>
                <CardDescription>Today vs Yesterday</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Today</div>
                    <div className="text-2xl font-bold">{stats.todayTokens}</div>
                  </div>
                  <div className="space-y-1 text-right">
                    <div className="text-sm text-muted-foreground">Yesterday</div>
                    <div className="text-2xl font-bold">{stats.yesterdayTokens}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Unique Customers</CardTitle>
                <CardDescription>Today vs Yesterday</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Today</div>
                    <div className="text-2xl font-bold">{stats.todayCustomers}</div>
                  </div>
                  <div className="space-y-1 text-right">
                    <div className="text-sm text-muted-foreground">Yesterday</div>
                    <div className="text-2xl font-bold">{stats.yesterdayCustomers}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
        
        {/* Reply Message */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <MessageCircle size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Reply Message", "রিপ্লাই মেসেজ")}</Label>
                <p className="text-sm text-muted-foreground">{t("Auto-reply to incoming texts.", "আগত টেক্সটগুলোতে অটো-রিপ্লাই দিন।")}</p>
              </div>
            </div>
            <Switch 
              checked={config.reply_message}
              onCheckedChange={(c) => setConfig({...config, reply_message: c})}
            />
          </CardContent>
        </Card>

        {/* Swipe Reply */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <ReplyAll size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Swipe Reply", "সোয়াইপ রিপ্লাই")}</Label>
                <p className="text-sm text-muted-foreground">{t("Enable swipe-to-reply context.", "সোয়াইপ-টু-রিপ্লাই কনটেক্সট সক্রিয় করুন।")}</p>
              </div>
            </div>
            <Switch 
              checked={config.swipe_reply}
              onCheckedChange={(c) => setConfig({...config, swipe_reply: c})}
            />
          </CardContent>
        </Card>

        {/* Image Detection */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <Image size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Image Detection", "ছবি শনাক্তকরণ")}</Label>
                <p className="text-sm text-muted-foreground">{t("Analyze received images.", "প্রাপ্ত ছবিগুলো বিশ্লেষণ করুন।")}</p>
              </div>
            </div>
            <Switch 
              checked={config.image_detection}
              onCheckedChange={(c) => setConfig({...config, image_detection: c})}
            />
          </CardContent>
        </Card>

        {/* Image Send */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <Image size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Image Send", "ছবি পাঠানো")}</Label>
                <p className="text-sm text-muted-foreground">{t("Allow bot to send images.", "বটকে ছবি পাঠানোর অনুমতি দিন।")}</p>
              </div>
            </div>
            <Switch 
              checked={config.image_send}
              onCheckedChange={(c) => setConfig({...config, image_send: c})}
            />
          </CardContent>
        </Card>

        {/* Order Tracking */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <PackageSearch size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Order Tracking", "অর্ডার ট্র্যাকিং")}</Label>
                <p className="text-sm text-muted-foreground">{t("Automated order status checks.", "অটোমেটেড অর্ডার স্ট্যাটাস চেক।")}</p>
              </div>
            </div>
            <Switch 
              checked={config.order_tracking}
              onCheckedChange={(c) => setConfig({...config, order_tracking: c})}
            />
          </CardContent>
        </Card>

        {/* Group Reply */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <MessageSquare size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Group Reply", "গ্রুপ রিপ্লাই")}</Label>
                <p className="text-sm text-muted-foreground">{t("Reply to WhatsApp group chats", "হোয়াটসঅ্যাপ গ্রুপ চ্যাটে রিপ্লাই দিন")}</p>
              </div>
            </div>
            <Switch 
              checked={config.group_reply}
              onCheckedChange={(c) => setConfig({...config, group_reply: c})}
            />
          </CardContent>
        </Card>

        {/* Audio Detection */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <Mic size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Audio Detection", "অডিও শনাক্তকরণ")}</Label>
                <p className="text-sm text-muted-foreground">{t("Transcribe and process audio messages.", "অডিও মেসেজগুলো ট্রান্সক্রাইব এবং প্রসেস করুন।")}</p>
              </div>
            </div>
            <Switch 
              checked={config.audio_detection}
              onCheckedChange={(c) => setConfig({...config, audio_detection: c})}
            />
          </CardContent>
        </Card>

        {/* Direct File Upload */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <Upload size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">{t("Direct File Upload", "সরাসরি ফাইল আপলোড")}</Label>
                <p className="text-sm text-muted-foreground">{t("Allow users to upload files directly.", "ব্যবহারকারীদের সরাসরি ফাইল আপলোড করতে দিন।")}</p>
              </div>
            </div>
            <Switch 
              checked={config.file_upload}
              onCheckedChange={(c) => setConfig({...config, file_upload: c})}
            />
          </CardContent>
        </Card>

        {/* Human Handover / Block Logic Section */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 col-span-1 lg:col-span-2">
            <CardHeader>
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                        <Hand size={24} />
                    </div>
                    <div>
                        <CardTitle>{t("Human Handover Settings", "হিউম্যান হ্যান্ডওভার সেটিংস")}</CardTitle>
                        <CardDescription>{t("Configure how and when the AI should pause for a human agent.", "এআই কখন এবং কীভাবে একজন হিউম্যান এজেন্টের জন্য থামবে তা কনফিগার করুন।")}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-3">
                
                <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                        <StopCircle className="w-4 h-4 text-red-500" />
                        {t("Lock Emoji", "লক ইমোজি")}
                    </Label>
                    <Input 
                        placeholder="e.g. 🛑,🔒,⛔" 
                        value={config.lock_emojis}
                        onChange={(e) => setConfig({...config, lock_emojis: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t("AI stops if this emoji is found in recent messages.", "সাম্প্রতিক মেসেজগুলোতে এই ইমোজি পাওয়া গেলে এআই থেমে যাবে।")}
                    </p>
                </div>

                <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                        <RefreshCcw className="w-4 h-4 text-green-500" />
                        {t("Unlock Emoji", "আনলক ইমোজি")}
                    </Label>
                    <Input 
                        placeholder="e.g. 🟢,🔓,✅" 
                        value={config.unlock_emojis}
                        onChange={(e) => setConfig({...config, unlock_emojis: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t("AI resumes if this emoji is sent after a block.", "ব্লক হওয়ার পর এই ইমোজি পাঠানো হলে এআই পুনরায় শুরু হবে।")}
                    </p>
                </div>

                <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-blue-500" />
                        {t("Check Conversion Limit", "চেক কনভার্সন লিমিট")}
                    </Label>
                    <Input 
                        type="number" 
                        min={10}
                        max={50}
                        value={config.check_conversion} 
                        onChange={(e) => {
                            const raw = parseInt(e.target.value || "10", 10);
                            const clamped = Math.max(10, Math.min(50, isNaN(raw) ? 10 : raw));
                            setConfig({...config, check_conversion: clamped});
                        }}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t("How many recent messages (10–50) will be used as AI memory.", "সর্বশেষ কতগুলো মেসেজ (১০–৫০) এআই মেমরি হিসেবে ব্যবহার করবে।")}
                    </p>
                </div>

            </CardContent>
        </Card>

      </div>
    </div>
  );
}
