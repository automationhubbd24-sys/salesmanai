import { motion } from "framer-motion";
import { Check, ArrowRight, Zap, Star, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";

const PricingSection = () => {
  const { t } = useLanguage();

  const plans = [
    {
      name: t("Starter", "স্টার্টার"),
      price: "400",
      unit: t("Messages", "মেসেজ"),
      description: t("1,000 messages, no expiry — use anytime", "১,০০০ মেসেজ, কোনো মেয়াদ নেই — যেকোনো সময়ে ব্যবহার করুন"),
      features: [
        t("1,000 AI Messages", "১,০০০ এআই মেসেজ"),
        t("Standard AI Reasoning", "স্ট্যান্ডার্ড এআই রিজনিং"),
        t("Basic Image Support", "বেসিক ইমেজ সাপোর্ট"),
        t("Email Support", "ইমেইল সাপোর্ট"),
        t("Facebook Integration", "ফেসবুক ইন্টিগ্রেশন"),
      ],
      icon: Bot,
      color: "blue",
      popular: false,
    },
    {
      name: t("Pro", "প্রো"),
      price: "1,500",
      unit: t("Messages", "মেসেজ"),
      description: t("5,000 messages, no expiry — use anytime", "৫,০০০ মেসেজ, কোনো মেয়াদ নেই — যেকোনো সময়ে ব্যবহার করুন"),
      features: [
        t("5,000 AI Messages", "৫,০০০ এআই মেসেজ"),
        t("Ultra-Fast Response Time", "আল্ট্রা-ফাস্ট রেসপন্স টাইম"),
        t("Advanced Image Recognition", "অ্যাডভান্সড ইমেজ রিকগনিশন"),
        t("Priority Support", "প্রায়োরিটি সাপোর্ট"),
        t("WhatsApp & IG Integration", "হোয়াটসঅ্যাপ ও ইনস্টাগ্রাম ইন্টিগ্রেশন"),
      ],
      icon: Zap,
      color: "indigo",
      popular: true,
    },
    {
      name: t("Enterprise", "এন্টারপ্রাইজ"),
      price: "2,500",
      unit: t("Messages / 30 days", "মেসেজ / ৩০ দিন"),
      description: t("10,000 messages, valid for 30 days", "১০,০০০ মেসেজ, ৩০ দিনের জন্য বৈধ"),
      features: [
        t("10,000 AI Messages", "১০,০০০ এআই মেসেজ"),
        t("30-Day Validity", "৩০ দিনের বৈধতা"),
        t("Highest Accuracy Model", "সবচেয়ে সঠিক এআই মডেল"),
        t("Complex Task Handling", "জটিল কাজ হ্যান্ডলিং"),
        t("Dedicated Account Manager", "ডেডিকেটেড অ্যাকাউন্ট ম্যানেজার"),
        t("Custom API Solutions", "কাস্টম এপিআই সলিউশন"),
      ],
      icon: Star,
      color: "purple",
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="relative py-24 overflow-hidden bg-background">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-indigo-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="container relative z-10 mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold mb-6 uppercase tracking-wider"
          >
            <Zap className="w-3 h-3" />
            {t("Transparent Pricing", "স্বচ্ছ প্রাইসিং")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-black text-white mb-6 tracking-tight"
          >
            {t("Cloud API", "ক্লাউড এপিআই")} <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
              {t("Pricing Plans", "প্রাইসিং প্ল্যান")}
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-slate-400 text-lg font-medium"
          >
            {t(
              "No hidden costs. Pay only for what you use. Start for free and upgrade as you grow.",
              "কোনো লুকানো খরচ নেই। যতটুকু ব্যবহার করবেন ততটুকুই পেমেন্ট করবেন। ফ্রিতে শুরু করুন এবং প্রয়োজন অনুযায়ী আপগ্রেড করুন।"
            )}
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className={`relative flex flex-col p-8 rounded-[2.5rem] border backdrop-blur-3xl transition-all duration-500 hover:-translate-y-2 ${
                plan.popular 
                  ? "bg-indigo-500/[0.02] border-indigo-500/20 shadow-[0_20px_50px_rgba(79,70,229,0.05)]" 
                  : "bg-white/[0.005] border-white/5 hover:border-white/10"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-indigo-500 text-white px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/25">
                  {t("Most Popular", "সবচেয়ে জনপ্রিয়")}
                </div>
              )}

              <div className="mb-8">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 ${
                  plan.color === 'blue' ? 'bg-blue-500/10 text-blue-400' :
                  plan.color === 'indigo' ? 'bg-indigo-500/10 text-indigo-400' :
                  'bg-purple-500/10 text-purple-400'
                }`}>
                  <plan.icon className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black text-white mb-2">{plan.name}</h3>
                <p className="text-slate-400 text-sm font-medium leading-relaxed">
                  {plan.description}
                </p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black text-white">৳{plan.price}</span>
                  <span className="text-slate-500 text-sm font-bold uppercase tracking-wider">{plan.unit}</span>
                </div>
              </div>

              <div className="space-y-4 mb-10 flex-1">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-3 group">
                    <div className="mt-1 rounded-full bg-indigo-500/10 p-0.5 group-hover:bg-indigo-500/20 transition-colors">
                      <Check className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <span className="text-slate-400 text-sm font-medium leading-tight">{feature}</span>
                  </div>
                ))}
              </div>

              <Button
                variant={plan.popular ? "hero" : "outline"}
                className={`w-full h-12 rounded-xl font-bold transition-all duration-300 ${
                  plan.popular 
                    ? "bg-indigo-500 hover:bg-indigo-600 border-none shadow-lg shadow-indigo-500/20" 
                    : "bg-white/5 border-white/10 hover:bg-white/10 text-white"
                }`}
                asChild
              >
                <Link to="/login">
                  {t("Get Started", "শুরু করুন")}
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Link>
              </Button>
            </motion.div>
          ))}
        </div>

        {/* Free Trial Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 max-w-4xl mx-auto p-6 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent border border-white/5 flex flex-col md:flex-row items-center justify-between gap-6"
        >
          <div className="flex items-center gap-4 text-center md:text-left">
            <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h4 className="text-white font-bold mb-1">
                {t("Start with 20 free requests", "২০টি ফ্রি রিকোয়েস্ট দিয়ে শুরু করুন")}
              </h4>
              <p className="text-slate-400 text-sm">
                {t("No credit card required. Test all engines and see the results for yourself.", "কোনো ক্রেডিট কার্ডের প্রয়োজন নেই। সব ইঞ্জিন পরীক্ষা করুন এবং ফলাফল দেখুন।")}
              </p>
            </div>
          </div>
          <Button variant="link" className="text-indigo-400 font-black hover:text-indigo-300" asChild>
            <Link to="/login" className="flex items-center gap-2">
              {t("Try for free", "ফ্রিতে ট্রাই করুন")}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
};

const Sparkles = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="M5 3v4"/><path d="M3 5h4"/><path d="M21 17v4"/><path d="M19 19h4"/>
  </svg>
);

export default PricingSection;
