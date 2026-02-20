import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";
import { ArrowLeft, Mail, Lock, MessageCircle, Zap, Shield, Users } from "lucide-react";
import { toast } from "sonner";
import logoImage from "@/assets/logo.png";
import { useLanguage } from "@/contexts/LanguageContext";
import { BACKEND_URL } from "@/config";

const Login = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

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
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
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
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6">
            <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span>{t("Return to Home", "হোমে ফিরে যান")}</span>
            </Link>
          </div>

          <div className="mb-10">
            <Logo size="lg" accentColor="#00ff88" />
            <h2 className="mt-8 text-3xl font-bold text-white">{t("Welcome back", "আবার স্বাগতম")}</h2>
            <p className="mt-3 text-base text-gray-400">
              {t("Sign in to your account to continue managing your chatbots", "আপনার চ্যাটবট পরিচালনা চালিয়ে যেতে আপনার অ্যাকাউন্টে সাইন ইন করুন")}
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">
                  {t("Password", "পাসওয়ার্ড")}
                </Label>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <Input
                  id="password"
                  type="password"
                  placeholder={t("Enter your password", "আপনার পাসওয়ার্ড লিখুন")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-12 pr-12 text-base bg-[#0f0f0f] border border-gray-800 focus-visible:ring-[#00ff88]"
                />
              </div>
            </div>

            <Button type="submit" className="h-12 w-full rounded-full bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:bg-[#00f07f] transition-all hover:scale-[1.01] active:scale-95" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  {t("Signing in...", "সাইন ইন করা হচ্ছে...")}
                </span>
              ) : (
                t("Sign In", "সাইন ইন করুন")
              )}
            </Button>
          </form>

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-[#0b0b0b] px-4 text-gray-400">{t("New to SalesmanAI?", "SalesmanAI-তে নতুন?")}</span>
              </div>
            </div>
            
            <div className="mt-6 text-center">
              <Link to="/register" className="text-base font-semibold text-[#00ff88] transition-opacity hover:opacity-80">
                {t("Create a free account →", "একটি ফ্রি অ্যাকাউন্ট তৈরি করুন →")}
              </Link>
            </div>
          </div>

          {/* Trust badges */}
          <div className="mt-10 flex items-center justify-center gap-6 border-t border-border pt-8">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-4 w-4" />
              <span>{t("Secure Login", "নিরাপদ লগইন")}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="h-4 w-4" />
              <span>{t("Fast & Reliable", "দ্রুত এবং নির্ভরযোগ্য")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
