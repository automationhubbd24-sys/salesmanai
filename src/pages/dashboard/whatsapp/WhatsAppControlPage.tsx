import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bot,
  MessageSquare,
  Loader2,
  Save,
  Image,
  MessageCircle,
  Lock,
  PackageSearch,
  ReplyAll,
  Mic,
  Upload,
  Users,
  MessageSquareText,
  Hand,
  StopCircle,
  RefreshCcw,
  ChevronLeft,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { BACKEND_URL } from "@/config";
import { useWhatsApp } from "@/context/WhatsAppContext";

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
  image_prompt: string;
  [key: string]: boolean | string | number | undefined;
}

export default function WhatsAppControlPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { currentSession, loading: contextLoading } = useWhatsApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(true);
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
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
    image_prompt: "",
  });

  const activeDbId =
    (currentSession as any)?.wp_db_id ||
    (typeof window !== "undefined" ? Number(localStorage.getItem("active_wp_db_id") || 0) : 0) ||
    null;
  const activeSessionName =
    currentSession?.name ||
    (typeof window !== "undefined" ? localStorage.getItem("active_wp_session_id") : null) ||
    null;

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
      if (!token) {
        toast.error(t("Please login again", "অনুগ্রহ করে আবার লগইন করুন"));
        setLoading(false);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to load config (${res.status})`);
      }

      const row: any = await res.json();
      setVerified(row.verified !== false);

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
        image_prompt: row.image_prompt ?? "",
      });
    } catch (error) {
      console.error("Error fetching config:", error);
      toast.error(t("Failed to load configuration", "কনফিগারেশন লোড করতে ব্যর্থ হয়েছে"));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeDbId) return;
    setSaving(true);
    try {
      const validColumns = [
        "reply_message",
        "swipe_reply",
        "image_detection",
        "image_send",
        "order_tracking",
        "audio_detection",
        "file_upload",
        "group_reply",
        "lock_emojis",
        "unlock_emojis",
      ];
      const updates: any = {};
      validColumns.forEach((key) => {
        updates[key] = config[key];
      });

      const token = localStorage.getItem("auth_token");
      if (!token) {
        throw new Error(t("Please login again", "অনুগ্রহ করে আবার লগইন করুন"));
      }

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/config/${activeDbId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed with status ${res.status}`);
      }

      toast.success(t("Settings saved successfully", "সেটিংস সফলভাবে সংরক্ষিত হয়েছে"));
      await fetchConfig(activeDbId.toString());
    } catch (error: any) {
      const message =
        error.message || (typeof error === "string" ? error : "Unknown error");
      toast.error(t("Failed to save settings: ", "সেটিংস সংরক্ষণ করতে ব্যর্থ হয়েছে: ") + message);
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading || contextLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeDbId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Bot className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">{t("No WhatsApp Connected", "কোন অফিসিয়াল হোয়াটসঅ্যাপ সংযুক্ত নেই")}</h2>
        <p className="text-muted-foreground">{t("Please connect an official WhatsApp number to manage bot controls.", "বট কন্ট্রোল পরিচালনা করতে আগে অফিসিয়াল হোয়াটসঅ্যাপ নম্বর connect করুন।")}</p>
        <Button asChild>
          <Link to="/dashboard/whatsapp/sessions">{t("Go to WhatsApp", "হোয়াটসঅ্যাপে যান")}</Link>
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
              {t("Your session has expired or is unverified. Please reactivate your account to access bot controls.", "আপনার সেশন শেষ হয়ে গেছে বা এটি যাচাই করা হয়নি। বট কন্ট্রোল অ্যাক্সেস করতে অনুগ্রহ করে আপনার অ্যাকাউন্ট পুনরায় সক্রিয় করুন।")}
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
          <h2 className="text-3xl font-bold text-foreground tracking-tight">{t("Bot Control", "বট কন্ট্রোল")}</h2>
          <p className="text-muted-foreground mt-1">
            {t("Manage your automation features.", "আপনার অটোমেশন ফিচারগুলো পরিচালনা করুন।")}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ChevronLeft size={16} />
            {t("Back", "পিছনে")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            size="lg"
            className="shadow-lg flex-1 sm:flex-none"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {t("Save Changes", "পরিবর্তন সংরক্ষণ করুন")}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Session Status */}
        {expiryDays !== null && (
          <Card className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-emerald-500/20">
            <CardContent className="p-6 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${expiryDays < 3 ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"}`}>
                  <Activity size={24} />
                </div>
                <div className="space-y-1">
                  <Label className="text-lg font-semibold">{t("Session Status", "সেশনের স্থিতি")}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t("{days} days remaining in your active plan.", "{days} দিন আপনার সক্রিয় প্ল্যানে বাকি আছে।").replace("{days}", expiryDays.toString())}
                  </p>
                </div>
              </div>
              <div className="text-sm font-semibold px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {t("{days} Days Left", "{days} দিন বাকি").replace("{days}", expiryDays.toString())}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Feature Controls Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ControlCard
            icon={MessageCircle}
            title={t("Reply Message", "রিপ্লাই মেসেজ")}
            description={t("Auto-reply to incoming texts.", "আগত টেক্সটগুলোতে অটো-রিপ্লাই দিন।")}
            checked={config.reply_message}
            onCheckedChange={(c) => setConfig({ ...config, reply_message: c })}
          />
          <ControlCard
            icon={ReplyAll}
            title={t("Swipe Reply", "সোয়াইপ রিপ্লাই")}
            description={t("Enable swipe-to-reply context.", "সোয়াইপ-টু-রিপ্লাই কনটেক্সট সক্রিয় করুন।")}
            checked={config.swipe_reply}
            onCheckedChange={(c) => setConfig({ ...config, swipe_reply: c })}
          />
          <ControlCard
            icon={Image}
            title={t("Image Detection", "ছবি শনাক্তকরণ")}
            description={t("Analyze received images.", "প্রাপ্ত ছবিগুলো বিশ্লেষণ করুন।")}
            checked={config.image_detection}
            onCheckedChange={(c) => setConfig({ ...config, image_detection: c })}
          />
          <ControlCard
            icon={Image}
            title={t("Image Send", "ছবি পাঠানো")}
            description={t("Allow bot to send images.", "বটকে ছবি পাঠানোর অনুমতি দিন।")}
            checked={config.image_send}
            onCheckedChange={(c) => setConfig({ ...config, image_send: c })}
          />
          <ControlCard
            icon={PackageSearch}
            title={t("Order Tracking", "অর্ডার ট্র্যাকিং")}
            description={t("Automated order status checks.", "অটোমেটেড অর্ডার স্ট্যাটাস চেক।")}
            checked={config.order_tracking}
            onCheckedChange={(c) => setConfig({ ...config, order_tracking: c })}
          />
          <ControlCard
            icon={MessageSquare}
            title={t("Group Reply", "গ্রুপ রিপ্লাই")}
            description={t("Reply to WhatsApp group chats", "হোয়াটসঅ্যাপ গ্রুপ চ্যাটে রিপ্লাই দিন")}
            checked={config.group_reply}
            onCheckedChange={(c) => setConfig({ ...config, group_reply: c })}
          />
          <ControlCard
            icon={Mic}
            title={t("Audio Detection", "অডিও শনাক্তকরণ")}
            description={t("Transcribe and process audio messages.", "অডিও মেসেজগুলো ট্রান্সক্রাইব এবং প্রসেস করুন।")}
            checked={config.audio_detection}
            onCheckedChange={(c) => setConfig({ ...config, audio_detection: c })}
          />
          <ControlCard
            icon={Upload}
            title={t("Direct File Upload", "সরাসরি ফাইল আপলোড")}
            description={t("Allow users to upload files directly.", "ব্যবহারকারীদের সরাসরি ফাইল আপলোড করতে দিন।")}
            checked={config.file_upload}
            onCheckedChange={(c) => setConfig({ ...config, file_upload: c })}
          />
        </div>

        {/* Human Handover */}
        <Card className="bg-background border-border">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Hand size={24} />
              </div>
              <div>
                <CardTitle>{t("Human Handover Settings", "হিউম্যান হ্যান্ডওভার সেটিংস")}</CardTitle>
                <CardDescription>{t("Configure how and when the AI should pause for a human agent.", "এআই কখন এবং কীভাবে একজন হিউম্যান এজেন্টের জন্য থামবে তা কনফিগার করুন।")}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <StopCircle className="w-4 h-4 text-red-500" />
                {t("Lock Emoji", "লক ইমোজি")}
              </Label>
              <Input
                placeholder="e.g. 🛑,🔒,⛔"
                value={config.lock_emojis}
                onChange={(e) => setConfig({ ...config, lock_emojis: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t("AI stops if this emoji is found in recent messages.", "সাম্প্রতিক মেসেজগুলোতে এই ইমোজি পাওয়া গেলে এআই থেমে যাবে।")}
              </p>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <RefreshCcw className="w-4 h-4 text-green-500" />
                {t("Unlock Emoji", "আনলক ইমোজি")}
              </Label>
              <Input
                placeholder="e.g. 🟢,🔓,✅"
                value={config.unlock_emojis}
                onChange={(e) => setConfig({ ...config, unlock_emojis: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t("AI resumes if this emoji is sent after a block.", "ব্লক হওয়ার পর এই ইমোজি পাঠানো হলে এআই পুনরায় শুরু হবে।")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
