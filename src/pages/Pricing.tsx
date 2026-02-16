import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { Check, Zap, MessageCircle, Bot, Smartphone, Star, ShieldCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const Pricing = () => {
  const { t } = useLanguage();

  const aiPlans = [
    {
      name: t("Lite Engine", "লাইট ইঞ্জিন"),
      price: "40",
      unit: t("BDT / 1M Tokens", "টাকা / ১এম টোকেন"),
      description: t("Cost-effective AI for simple tasks.", "সহজ কাজের জন্য সাশ্রয়ী এআই।"),
      features: [
        t("Unlimited Input Tokens", "আনলিমিটেড ইনপুট টোকেন"),
        t("Basic AI Responses", "বেসিক এআই রেসপন্স"),
        t("Standard Speed", "স্ট্যান্ডার্ড স্পিড"),
        t("Email Support", "ইমেইল সাপোর্ট"),
      ],
      icon: Bot,
      popular: false,
    },
    {
      name: t("Flash Engine", "ফ্ল্যাশ ইঞ্জিন"),
      price: "100",
      unit: t("BDT / 1M Tokens", "টাকা / ১এম টোকেন"),
      description: t("Fast and efficient for high-volume chat.", "বেশি চ্যাটের জন্য দ্রুত এবং দক্ষ।"),
      features: [
        t("Max 14K Tokens/Request", "সর্বোচ্চ ১৪কে টোকেন/রিকোয়েস্ট"),
        t("Ultra-Fast Response", "আল্ট্রা-ফাস্ট রেসপন্স"),
        t("Advanced Reasoning", "অ্যাডভান্সড রিজনিং"),
        t("Priority Support", "প্রায়োরিটি সাপোর্ট"),
      ],
      icon: Zap,
      popular: true,
    },
    {
      name: t("Pro Engine", "প্রো ইঞ্জিন"),
      price: "150",
      unit: t("BDT / 1M Tokens", "টাকা / ১এম টোকেন"),
      description: t("Ultimate power for professional business.", "প্রফেশনাল ব্যবসার জন্য সর্বোচ্চ ক্ষমতা।"),
      features: [
        t("Unlimited Input/Output", "আনলিমিটেড ইনপুট/আউটপুট"),
        t("Most Accurate AI", "সবচেয়ে সঠিক এআই"),
        t("Complex Task Handling", "জটিল কাজ হ্যান্ডলিং"),
        t("Dedicated Support", "ডেডিকেটেড সাপোর্ট"),
      ],
      icon: Star,
      popular: false,
    },
  ];

  const cloudApi = [
    { msgs: "1,000", price: "400" },
    { msgs: "5,000", price: "1,500" },
    { msgs: "10,000", price: "2,500" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <section className="relative overflow-hidden pt-32 pb-20">
        <div className="absolute inset-0 bg-primary/5 -z-10" />
        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="text-4xl font-bold mb-6 md:text-5xl">
              {t("Simple & Transparent Pricing", "সহজ এবং স্বচ্ছ প্রাইসিং")}
            </h1>
            <p className="text-xl text-muted-foreground">
              {t("Choose the perfect plan for your business needs. No hidden costs.", "আপনার ব্যবসার প্রয়োজনের জন্য সঠিক প্ল্যানটি বেছে নিন। কোনো লুকানো খরচ নেই।")}
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3 mb-20">
            {aiPlans.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col p-8 rounded-2xl border bg-card transition-all hover:shadow-xl ${
                  plan.popular ? "border-primary shadow-lg scale-105 z-10" : "border-border"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-medium">
                    {t("Most Popular", "সবচেয়ে জনপ্রিয়")}
                  </div>
                )}
                <div className="mb-6">
                  <div className={`inline-flex p-3 rounded-lg mb-4 ${plan.popular ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <plan.icon size={24} />
                  </div>
                  <h3 className="text-2xl font-bold">{plan.name}</h3>
                  <p className="text-muted-foreground mt-2">{plan.description}</p>
                </div>
                <div className="mb-8">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground ml-2">{plan.unit}</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm">
                      <Check className="h-4 w-4 text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant={plan.popular ? "hero" : "outline"} className="w-full" asChild>
                  <Link to="/login">
                    {t("Get Started", "শুরু করুন")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>

          <div className="grid gap-12 lg:grid-cols-2">
            {/* Cloud API Section */}
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <Smartphone className="text-primary" />
                {t("Cloud API Message Bundles", "ক্লাউড এপিআই মেসেজ বান্ডেল")}
              </h2>
              <div className="space-y-4">
                {cloudApi.map((bundle) => (
                  <div key={bundle.msgs} className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border">
                    <div className="font-semibold text-lg">{bundle.msgs} {t("Messages", "মেসেজ")}</div>
                    <div className="text-2xl font-bold text-primary">{bundle.price} <span className="text-sm font-normal text-muted-foreground">BDT</span></div>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-sm text-muted-foreground">
                {t("Perfect for businesses with high message volume on WhatsApp Cloud API.", "হোয়াটসঅ্যাপ ক্লাউড এপিআই-তে উচ্চ মেসেজ ভলিউম সহ ব্যবসার জন্য উপযুক্ত।")}
              </p>
            </div>

            {/* Platform Comparison */}
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <ShieldCheck className="text-primary" />
                {t("Platform Benefits", "প্ল্যাটফর্মের সুবিধাসমূহ")}
              </h2>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <MessageCircle className="text-blue-500" />
                    {t("Messenger", "মেসেঞ্জার")}
                  </div>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-green-500" />
                      {t("100% Free Integration", "১০০% ফ্রি ইন্টিগ্রেশন")}
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-green-500" />
                      {t("Auto-Reply & Comments", "অটো-রিপ্লাই ও কমেন্টস")}
                    </li>
                  </ul>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <Smartphone className="text-green-500" />
                    {t("WhatsApp", "হোয়াটসঅ্যাপ")}
                  </div>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-green-500" />
                      {t("WaHub Integration", "WaHub ইন্টিগ্রেশন")}
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-green-500" />
                      {t("Premium Features", "প্রিমিয়াম ফিচারসমূহ")}
                    </li>
                  </ul>
                </div>
              </div>
              <div className="mt-8 p-4 rounded-xl bg-primary/5 border border-primary/20">
                <div className="font-semibold text-primary mb-1">{t("Trial Offer", "ট্রায়াল অফার")}</div>
                <p className="text-sm text-muted-foreground">
                  {t("Every new user gets 20 free requests to test our AI engines. No credit card required.", "প্রতিটি নতুন ব্যবহারকারী আমাদের এআই ইঞ্জিন পরীক্ষা করার জন্য ২০টি ফ্রি রিকোয়েস্ট পাবেন। কোনো ক্রেডিট কার্ডের প্রয়োজন নেই।")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Pricing;
