import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";
import { Mail, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { BACKEND_URL } from "@/config";

const ForgotPassword = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error(t("Please enter your email", "অনুগ্রহ করে আপনার ইমেইল দিন"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/password/reset/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.error || t("Failed to send reset code", "রিসেট কোড পাঠানো যায়নি"));
      }
      toast.success(
        t(
          "Password reset code sent to your email.",
          "পাসওয়ার্ড রিসেট কোড আপনার ইমেইলে পাঠানো হয়েছে।"
        )
      );
      navigate(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      toast.error(
        err.message ||
          t("Failed to send reset code", "রিসেট কোড পাঠাতে ব্যর্থ")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0b0b0b] text-white">
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6">
            <Link to="/" className="inline-flex items-center gap-2 text-gray-500 transition-colors hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              <span>{t("Return to Home", "হোমে ফিরে যান")}</span>
            </Link>
          </div>
          <div className="mb-8">
            <Logo size="lg" accentColor="#00ff88" />
            <h2 className="mt-6 text-3xl font-bold">{
              t("Reset your password", "আপনার পাসওয়ার্ড রিসেট করুন")
            }</h2>
            <p className="mt-2 text-sm text-gray-400">
              {t("Enter your account email and we'll send you a reset link.", "আপনার অ্যাকাউন্ট ইমেইল দিন, আমরা একটি রিসেট লিংক পাঠাব।")}
            </p>
          </div>
          <form onSubmit={handleSendReset} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">{t("Email Address", "ইমেইল ঠিকানা")}</Label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 pl-12 text-base bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                  required
                />
              </div>
            </div>
            <Button
              type="submit"
              className="h-12 w-full rounded-full bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:bg-[#00f07f] transition-all hover:scale-[1.01] active:scale-95"
              disabled={loading}
            >
              {loading ? t("Sending...", "পাঠানো হচ্ছে...") : t("Send Reset Link", "রিসেট লিংক পাঠান")}
            </Button>
          </form>
          <div className="mt-8 text-center">
            <Link to="/login" className="text-sm font-semibold text-[#00ff88] transition-opacity hover:opacity-80">
              {t("Back to Sign In →", "সাইন ইন এ ফিরে যান →")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
