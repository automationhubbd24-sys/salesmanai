import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";
import { Lock, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { BACKEND_URL } from "@/config";

const ResetPassword = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setVerified(false);
    const emailParam = searchParams.get("email");
    if (emailParam) {
      setEmail(emailParam);
    }
  }, [searchParams]);

  const handleSendCode = async () => {
    if (!email) {
      toast.error(t("Please enter your email", "অনুগ্রহ করে আপনার ইমেইল দিন"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/password/reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = body.error || body.message || t("Failed to send reset code", "রিসেট কোড পাঠাতে ব্যর্থ");
        toast.error(msg);
      } else {
        toast.success(t("Password reset code sent to your email", "পাসওয়ার্ড রিসেট কোড আপনার ইমেইলে পাঠানো হয়েছে"));
      }
    } catch (err: any) {
      toast.error(err.message || t("Failed to send reset code", "রিসেট কোড পাঠাতে ব্যর্থ"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || otp.length < 6) {
      toast.error(t("Enter email and 6-digit code", "ইমেইল ও ৬ ডিজিট কোড দিন"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/password/reset/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otp }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = body.error || body.message || t("Verification failed", "যাচাই ব্যর্থ");
        toast.error(msg);
      } else {
        setVerified(true);
        toast.success(t("Code verified", "কোড যাচাই হয়েছে"));
      }
    } catch (err: any) {
      toast.error(err.message || t("Failed to verify code", "কোড যাচাই করতে ব্যর্থ"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(t("Password must be at least 6 characters", "পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("Passwords do not match", "পাসওয়ার্ড মিলছে না"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/password/reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otp, password }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = body.error || body.message || t("Failed to update password", "পাসওয়ার্ড আপডেট করতে ব্যর্থ");
        toast.error(msg);
      } else {
        toast.success(t("Password updated. Please sign in.", "পাসওয়ার্ড আপডেট হয়েছে। অনুগ্রহ করে সাইন ইন করুন।"));
        navigate("/login");
      }
    } catch (err: any) {
      toast.error(err.message || t("Failed to update password", "পাসওয়ার্ড আপডেট করতে ব্যর্থ"));
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
            <h2 className="mt-6 text-3xl font-bold">
              {t("Set a new password", "নতুন পাসওয়ার্ড সেট করুন")}
            </h2>
            <p className="mt-2 text-sm text-gray-400">
              {verified ? t("Enter and confirm your new password.", "আপনার নতুন পাসওয়ার্ড লিখুন এবং নিশ্চিত করুন।") : t("Enter your email and the code you received.", "আপনার ইমেইল এবং প্রাপ্ত কোড লিখুন।")}
            </p>
          </div>
          {!verified ? (
            <form onSubmit={handleVerify} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">{t("Email Address", "ইমেইল ঠিকানা")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 text-base bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                  required
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={loading}
                  className="text-sm font-semibold text-[#00ff88] transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  {t("Send / Resend code", "কোড পাঠান / পুনরায় পাঠান")}
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="otp" className="text-sm font-medium">{t("6-digit Code", "৬ ডিজিট কোড")}</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="______"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="h-12 text-center tracking-widest text-base bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                  required
                />
              </div>
              <Button
                type="submit"
                className="h-12 w-full rounded-full bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:bg-[#00f07f] transition-all hover:scale-[1.01] active:scale-95"
                disabled={loading}
              >
                {loading ? t("Verifying...", "যাচাই হচ্ছে...") : t("Verify Code", "কোড যাচাই করুন")}
              </Button>
              <div className="mt-2 text-center">
                <Link to="/forgot-password" className="text-sm font-semibold text-[#00ff88] transition-opacity hover:opacity-80">
                  {t("Resend reset link →", "রিসেট লিংক আবার পাঠান →")}
                </Link>
              </div>
            </form>
          ) : (
          <form onSubmit={handleReset} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">{t("New Password", "নতুন পাসওয়ার্ড")}</Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  placeholder={t("Enter new password", "নতুন পাসওয়ার্ড লিখুন")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-12 pr-12 text-base bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-white"
                >
                  {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm" className="text-sm font-medium">{t("Confirm Password", "পাসওয়ার্ড নিশ্চিত করুন")}</Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <Input
                  id="confirm"
                  type={show ? "text" : "password"}
                  placeholder={t("Confirm new password", "নতুন পাসওয়ার্ড নিশ্চিত করুন")}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
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
              {loading ? t("Updating...", "আপডেট হচ্ছে...") : t("Update Password", "পাসওয়ার্ড আপডেট করুন")}
            </Button>
          </form>
          )}
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

export default ResetPassword;
