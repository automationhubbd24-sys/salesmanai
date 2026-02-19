import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import Logo from "@/components/Logo";
import { Eye, EyeOff, ArrowLeft, Mail, Lock, User, Phone, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import logoImage from "@/assets/logo.png";
import { useLanguage } from "@/contexts/LanguageContext";
import { BACKEND_URL } from "@/config";

const Register = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (otpStep) {
      toast.info(
        t(
          "Please check your email and enter the verification code below",
          "অনুগ্রহ করে ইমেইলে পাঠানো ভেরিফিকেশন কোডটি নিচে দিন"
        )
      );
      return;
    }
    
    if (formData.password !== formData.confirmPassword) {
      toast.error(t("Passwords do not match", "পাসওয়ার্ড মিলছে না"));
      return;
    }

    if (formData.password.length < 6) {
      toast.error(t("Password must be at least 6 characters", "পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: formData.fullName,
          phone: formData.phone,
          email: formData.email,
          password: formData.password,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.error || t("Registration failed", "রেজিস্ট্রেশন ব্যর্থ হয়েছে"));
      }
      const otpRes = await fetch(`${BACKEND_URL}/api/auth/request-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
        }),
      });
      const otpBody = await otpRes.json().catch(() => ({}));
      if (!otpRes.ok || !otpBody.success) {
        throw new Error(
          otpBody.error ||
            t("Failed to send verification code", "ভেরিফিকেশন কোড পাঠানো যায়নি")
        );
      }
      toast.success(
        t(
          "Account created. We sent a verification code to your email.",
          "অ্যাকাউন্ট তৈরি হয়েছে। আপনার ইমেইলে একটি ভেরিফিকেশন কোড পাঠানো হয়েছে।"
        )
      );
      setOtpStep(true);
    } catch (error: any) {
      toast.error(
        error.message ||
          t("An error occurred during registration", "রেজিস্ট্রেশন করার সময় একটি সমস্যা হয়েছে")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) {
      toast.error(
        t("Please enter the verification code", "অনুগ্রহ করে ভেরিফিকেশন কোডটি লিখুন")
      );
      return;
    }
    setVerifyingOtp(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          code: otp,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) {
        throw new Error(
          body.error ||
            t(
              "Invalid or expired verification code",
              "ভেরিফিকেশন কোডটি সঠিক নয় বা মেয়াদ শেষ হয়ে গেছে"
            )
        );
      }
      localStorage.setItem("auth_token", body.token);
      if (body.user) {
        localStorage.setItem("auth_user", JSON.stringify(body.user));
        if (body.user.email) {
          localStorage.setItem("auth_email", body.user.email);
        }
        if (body.user.id) {
          localStorage.setItem("auth_user_id", String(body.user.id));
        }
      }
      toast.success(
        t("Email verified and login successful!", "ইমেইল ভেরিফাই হয়েছে এবং লগইন সফল হয়েছে!")
      );
      navigate("/dashboard");
    } catch (error: any) {
      toast.error(
        error.message ||
          t(
            "Failed to verify code. Please try again.",
            "কোড ভেরিফাই করতে ব্যর্থ হয়েছে। আবার চেষ্টা করুন।"
          )
      );
    } finally {
      setVerifyingOtp(false);
    }
  };

  const benefits = [
    t("Unlimited chatbot conversations", "আনলিমিটেড চ্যাটবট কনভারসেশন"),
    t("Multi-platform integration", "মাল্টি-প্ল্যাটফর্ম ইন্টিগ্রেশন"),
    t("Real-time analytics dashboard", "রিয়েল-টাইম অ্যানালিটিক্স ড্যাশবোর্ড"),
    t("24/7 automated responses", "২৪/৭ অটোমেটেড রেসপন্স"),
    t("Custom AI training", "কাস্টম এআই ট্রেনিং"),
    t("Priority support", "প্রায়োরিটি সাপোর্ট"),
  ];

  return (
    <div className="flex min-h-screen bg-[#0b0b0b] text-white">
      {/* Left Panel - Decorative */}
      <div className="relative hidden w-0 flex-1 lg:block">
        <div className="absolute inset-0 bg-[#0b0b0b]">
          {/* Animated background elements */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -right-20 -top-20 h-96 w-96 rounded-full bg-[#00ff88]/10 blur-3xl animate-pulse" />
            <div className="absolute -bottom-32 -left-32 h-[500px] w-[500px] rounded-full bg-[#00ff88]/8 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
            <div className="absolute right-1/3 top-1/4 h-64 w-64 rounded-full bg-[#00ff88]/6 blur-2xl animate-pulse" style={{ animationDelay: "2s" }} />
          </div>
          
          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#00ff88 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          
          <div className="relative flex h-full flex-col items-center justify-center p-12">
            {/* Logo */}
            <div className="mb-10">
              <img src={logoImage} alt="SalesmanAI" className="h-24 w-24 animate-pulse" />
            </div>
            
            <div className="max-w-lg text-center">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 backdrop-blur-sm">
                <Sparkles className="h-4 w-4 text-[#00ff88]" />
                <span className="text-sm font-medium text-gray-300">{t("Start Your Free Trial", "আপনার ফ্রি ট্রায়াল শুরু করুন")}</span>
              </div>
              
              <h3 className="mb-6 text-4xl font-bold text-white">
                {t("Join SalesmanAI Today", "আজই SalesmanAI-তে যোগ দিন")}
              </h3>
              <p className="mb-10 text-xl text-gray-400">
                {t("Create your account and start automating customer conversations with AI-powered chatbots.", "আপনার অ্যাকাউন্ট তৈরি করুন এবং এআই-চালিত চ্যাটবটের মাধ্যমে কাস্টমার কনভারসেশন অটোমেট করা শুরু করুন।")}
              </p>
              
              {/* Benefits list */}
              <div className="space-y-4 text-left">
                {benefits.map((benefit, index) => (
                  <div 
                    key={index}
                    className="flex items-center gap-3 rounded-lg bg-primary-foreground/10 px-4 py-3 backdrop-blur-sm transition-all hover:bg-primary-foreground/15"
                  >
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-400" />
                    <span className="text-base font-medium text-gray-300">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex flex-1 flex-col justify-center px-4 py-8 sm:px-6 lg:flex-none lg:px-16 xl:px-20">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6">
            <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span>{t("Return to Home", "হোমে ফিরে যান")}</span>
            </Link>
          </div>

          <div className="mb-8">
            <Logo size="lg" accentColor="#00ff88" />
            <h2 className="mt-6 text-3xl font-bold text-white">{t("Create Account", "অ্যাকাউন্ট তৈরি করুন")}</h2>
            <p className="mt-2 text-base text-gray-400">
              {t("Start your 14-day free trial • No credit card required", "আপনার ১৪ দিনের ফ্রি ট্রায়াল শুরু করুন • কোনো ক্রেডিট কার্ডের প্রয়োজন নেই")}
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-sm font-medium">{t("Full Name", "পুরো নাম")}</Label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    id="fullName"
                    name="fullName"
                    type="text"
                    placeholder={t("Your name", "আপনার নাম")}
                    value={formData.fullName}
                    onChange={handleChange}
                    className="h-11 pl-11 text-sm bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-medium">{t("Phone Number", "ফোন নম্বর")}</Label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="+880 1XXX"
                    value={formData.phone}
                    onChange={handleChange}
                    className="h-11 pl-11 text-sm bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">{t("Email Address", "ইমেইল ঠিকানা")}</Label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={handleChange}
                  className="h-11 pl-11 text-sm bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">{t("Password", "পাসওয়ার্ড")}</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("Create password", "পাসওয়ার্ড তৈরি করুন")}
                    value={formData.password}
                    onChange={handleChange}
                    className="h-11 pl-11 pr-11 text-sm bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium">{t("Confirm Password", "পাসওয়ার্ড নিশ্চিত করুন")}</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("Confirm password", "পাসওয়ার্ড নিশ্চিত করুন")}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className="h-11 pl-11 text-sm bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Button type="submit" className="h-12 w-full rounded-full bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:bg-[#00f07f] transition-all hover:scale-[1.01] active:scale-95" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    {t("Creating account...", "অ্যাকাউন্ট তৈরি হচ্ছে...")}
                  </span>
                ) : (
                  t("Create Free Account", "ফ্রি অ্যাকাউন্ট তৈরি করুন")
                )}
              </Button>
            </div>
          </form>

          <Dialog open={otpStep} onOpenChange={setOtpStep}>
            <DialogContent className="max-w-md bg-[#0f0f0f]/95 border border-white/10 backdrop-blur-md">
              <DialogHeader>
                <DialogTitle>{t("Verify your email", "আপনার ইমেইল ভেরিফাই করুন")}</DialogTitle>
                <DialogDescription>
                  {t(
                    "We sent a 6-digit verification code to your email. Enter it below to complete your registration.",
                    "আপনার ইমেইলে একটি ৬ সংখ্যার ভেরিফিকেশন কোড পাঠানো হয়েছে। রেজিস্ট্রেশন সম্পূর্ণ করতে নিচে কোডটি লিখুন।"
                  )}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleVerifyOtp} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-sm font-medium">
                    {t("Verification Code", "ভেরিফিকেশন কোড")}
                  </Label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    placeholder={t("Enter 6-digit code", "৬ ডিজিট কোড লিখুন")}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="h-11 text-sm bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88] text-center tracking-[0.4em]"
                    maxLength={6}
                  />
                </div>
                <Button
                  type="submit"
                  className="h-11 w-full rounded-full bg-[#00ff88] text-black font-semibold hover:bg-[#00f07f] transition-all hover:scale-[1.01] active:scale-95"
                  disabled={verifyingOtp}
                >
                  {verifyingOtp
                    ? t("Verifying code...", "কোড ভেরিফাই করা হচ্ছে...")
                    : t("Verify Email & Sign In", "ইমেইল ভেরিফাই করে সাইন ইন করুন")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <p className="mt-6 text-center text-xs text-gray-400">
            {t("By creating an account, you agree to our", "একটি অ্যাকাউন্ট তৈরি করার মাধ্যমে, আপনি আমাদের সাথে সম্মত হচ্ছেন")}{" "}
            <Link to="/terms" className="text-[#00ff88] hover:underline">{t("Terms of Service", "পরিষেবার শর্তাবলী")}</Link>
            {" "}{t("and", "এবং")}{" "}
            <Link to="/privacy" className="text-[#00ff88] hover:underline">{t("Privacy Policy", "গোপনীয়তা নীতি")}</Link>
          </p>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-[#0b0b0b] px-4 text-gray-400">{t("Already have an account?", "ইতিমধ্যে একটি অ্যাকাউন্ট আছে?")}</span>
              </div>
            </div>
            
            <div className="mt-4 text-center">
              <Link to="/login" className="text-base font-semibold text-[#00ff88] transition-opacity hover:opacity-80">
                {t("Sign in to your account →", "আপনার অ্যাকাউন্টে সাইন ইন করুন →")}
              </Link>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Register;
