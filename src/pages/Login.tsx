import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import Logo from "@/components/Logo";
import { ArrowLeft, Mail, Lock, MessageCircle, Zap, Shield, Users, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import logoImage from "@/assets/logo.png";
import { useLanguage } from "@/contexts/LanguageContext";
import { BACKEND_URL } from "@/config";

const Login = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedEmail = localStorage.getItem("remembered_email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error(t("Please enter your email", "অনুগ্রহ করে আপনার ইমেইল দিন"));
      return;
    }
    if (!password) {
      toast.error(t("Please enter your password", "অনুগ্রহ করে আপনার পাসওয়ার্ড দিন"));
      return;
    }
    setLoading(true);
    try {
      if (rememberMe) {
        localStorage.setItem("remembered_email", email);
      } else {
        localStorage.removeItem("remembered_email");
      }

      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) {
        throw new Error(body.error || t("Invalid email or password", "ইমেইল বা পাসওয়ার্ড সঠিক নয়"));
      }
      localStorage.setItem("auth_token", body.token);
      if (body.user) {
        localStorage.setItem("auth_user", JSON.stringify(body.user));
        if (body.user.email) {
          localStorage.setItem("auth_email", body.user.email);
        } else {
          localStorage.setItem("auth_email", email);
        }
        if (body.user.id) {
          localStorage.setItem("auth_user_id", String(body.user.id));
        }
      } else {
        localStorage.setItem("auth_email", email);
      }
      toast.success(t("Login successful!", "লগইন সফল হয়েছে!"));
      navigate("/dashboard");
    } catch (error: any) {
      toast.error(error.message || t("An error occurred during login", "লগইন করার সময় একটি সমস্যা হয়েছে"));
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: MessageCircle, text: t("WhatsApp, Messenger & Instagram", "হোয়াটসঅ্যাপ, মেসেঞ্জার এবং ইনস্টাগ্রাম") },
    { icon: Zap, text: t("AI-Powered Automation", "এআই চালিত অটোমেশন") },
    { icon: Shield, text: t("Secure & Reliable", "নিরাপদ এবং নির্ভরযোগ্য") },
    { icon: Users, text: t("24/7 Customer Support", "২৪/৭ কাস্টমার সাপোর্ট") },
  ];

  return (
    <div className="flex min-h-screen bg-[#0b0b0b] text-white">
      {/* Left Panel - Decorative */}
      <div className="relative hidden w-0 flex-1 lg:block">
        <div className="absolute inset-0 bg-[#0b0b0b]">
          {/* Animated background elements */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-[#00ff88]/10 blur-3xl animate-pulse" />
            <div className="absolute -bottom-32 -right-32 h-[500px] w-[500px] rounded-full bg-[#00ff88]/8 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
            <div className="absolute left-1/2 top-1/3 h-64 w-64 rounded-full bg-[#00ff88]/6 blur-2xl animate-pulse" style={{ animationDelay: "2s" }} />
          </div>
          
          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#00ff88 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          
          <div className="relative flex h-full flex-col items-center justify-center p-12">
            {/* Logo */}
            <div className="mb-12">
              <img src={logoImage} alt="SalesmanAI" className="h-24 w-24 animate-pulse" />
            </div>
            
            <div className="max-w-lg text-center">
              <h3 className="mb-6 text-4xl font-bold text-white">
                {t("Transform Your Business", "আপনার ব্যবসাকে রূপান্তর করুন")}
              </h3>
              <p className="mb-12 text-xl text-gray-400">
                {t("AI-powered chatbot automation for your social media platforms. Boost sales and customer engagement effortlessly.", "আপনার সোশ্যাল মিডিয়া প্ল্যাটফর্মের জন্য এআই-চালিত চ্যাটবট অটোমেশন। অনায়াসে সেলস এবং কাস্টমার এনগেজমেন্ট বাড়ান।")}
              </p>
              
              {/* Features */}
              <div className="grid grid-cols-2 gap-4">
                {features.map((feature, index) => (
                  <div 
                    key={index}
                    className="flex items-center gap-3 rounded-xl bg-primary-foreground/10 p-4 backdrop-blur-sm transition-all hover:bg-primary-foreground/15"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-foreground/20">
                      <feature.icon className="h-5 w-5 text-[#00ff88]" />
                    </div>
                    <span className="text-sm font-medium text-gray-300">{feature.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex flex-1 flex-col justify-center px-6 py-8 sm:px-12 lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center justify-between lg:block">
            <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground bg-white/5 px-3 py-1.5 rounded-full border border-white/10 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{t("Home", "হোম")}</span>
            </Link>
            <div className="lg:hidden">
              <Logo size="sm" accentColor="#00ff88" />
            </div>
          </div>

          <div className="mb-8 sm:mb-10 text-center lg:text-left">
            <div className="hidden lg:block mb-8">
              <Logo size="lg" accentColor="#00ff88" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">{t("Welcome back", "আবার স্বাগতম")}</h2>
            <p className="mt-3 text-sm sm:text-base text-gray-400 leading-relaxed">
              {t("Sign in to your account to continue managing your chatbots", "আপনার চ্যাটবট পরিচালনা চালিয়ে যেতে আপনার অ্যাকাউন্টে সাইন ইন করুন")}
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5 sm:space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-black uppercase tracking-widest text-gray-500 ml-1">{t("Email Address", "ইমেইল ঠিকানা")}</Label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-[#00ff88] transition-colors">
                  <Mail className="h-5 w-5" />
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 pl-12 text-base bg-[#0f0f0f] border-gray-800 focus-visible:ring-[#00ff88] rounded-2xl transition-all"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-black uppercase tracking-widest text-gray-500 ml-1">
                  {t("Password", "পাসওয়ার্ড")}
                </Label>
                <Link to="/forgot-password" className="text-[10px] font-bold text-[#00ff88] hover:underline">
                  {t("Forgot Password?", "পাসওয়ার্ড ভুলে গেছেন?")}
                </Link>
              </div>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-[#00ff88] transition-colors">
                  <Lock className="h-5 w-5" />
                </div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("Enter your password", "আপনার পাসওয়ার্ড লিখুন")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 pl-12 pr-12 text-base bg-[#0f0f0f] border-gray-800 focus-visible:ring-[#00ff88] rounded-2xl transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#00ff88] transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="remember" 
                  checked={rememberMe} 
                  onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  className="border-gray-700 data-[state=checked]:bg-[#00ff88] data-[state=checked]:text-black"
                />
                <label
                  htmlFor="remember"
                  className="text-xs font-bold text-gray-400 cursor-pointer select-none"
                >
                  {t("Remember me", "মনে রাখুন")}
                </label>
              </div>
            </div>

            <Button type="submit" className="h-14 w-full rounded-2xl bg-[#00ff88] text-black font-black text-lg shadow-[0_12px_40px_rgba(0,255,136,0.25)] hover:bg-[#00f07f] transition-all active:scale-95 mt-2" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="h-5 w-5 animate-spin rounded-full border-3 border-black/20 border-t-black" />
                  {t("Signing in...", "সাইন ইন করা হচ্ছে...")}
                </span>
              ) : (
                t("Sign In", "সাইন ইন করুন")
              )}
            </Button>
          </form>

          <div className="mt-10">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/5" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em] font-black">
                <span className="bg-[#0b0b0b] px-4 text-gray-600">{t("Or Continue With", "অথবা চালিয়ে যান")}</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-12 rounded-xl border-white/5 bg-white/5 hover:bg-white/10 hover:border-[#00ff88]/30 transition-all font-bold text-xs gap-2">
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google
              </Button>
              <Button variant="outline" className="h-12 rounded-xl border-white/5 bg-white/5 hover:bg-white/10 hover:border-[#1877F2]/30 transition-all font-bold text-xs gap-2">
                <svg className="h-4 w-4 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                Facebook
              </Button>
            </div>

            <div className="mt-10">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/5" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-widest font-bold">
                  <span className="bg-[#0b0b0b] px-4 text-gray-500">{t("New here?", "নতুন?")}</span>
                </div>
              </div>
              
              <div className="mt-8 text-center">
                <Link to="/register" className="inline-flex h-12 items-center justify-center px-8 rounded-2xl border border-white/5 bg-white/5 text-sm font-bold text-[#00ff88] transition-all hover:bg-white/10 active:scale-95">
                  {t("Create a free account", "ফ্রি অ্যাকাউন্ট তৈরি করুন")}
                </Link>
              </div>
            </div>

            {/* Trust badges */}
            <div className="mt-12 flex items-center justify-center gap-8 border-t border-white/5 pt-10 opacity-50">
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-[#00ff88]" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">{t("Secure", "নিরাপদ")}</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-[#00ff88]" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">{t("Fast", "দ্রুত")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
