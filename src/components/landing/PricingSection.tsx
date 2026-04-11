import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ArrowRight, Zap, Star, Bot, Sparkles, Infinity as InfinityIcon, ShieldCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";

const PricingSection = () => {
  const { t } = useLanguage();
  const [billingCycle, setBillingCycle] = useState<"monthly" | "permanent">("monthly");

  const monthlyPlans = [
    {
      name: t("Starter", "স্টার্টার"),
      price: "1,000",
      unit: t("/ month", "/ মাস"),
      description: t("Perfect for small businesses starting their automation journey.", "অটোমেশন শুরু করা ছোট ব্যবসার জন্য উপযুক্ত।"),
      features: [
        t("500 Daily Message Limit", "প্রতিদিন ৫০০ মেসেজ লিমিট"),
        t("15,000 Monthly Messages", "মাসে ১৫,০০০ মেসেজ"),
        t("3,000 Bonus Messages", "৩,০০০ বোনাস মেসেজ"),
        t("Standard AI Response", "স্ট্যান্ডার্ড এআই রেসপন্স"),
        t("WhatsApp & Messenger", "হোয়াটসঅ্যাপ ও মেসেঞ্জার"),
      ],
      icon: Bot,
      color: "blue",
      popular: false,
    },
    {
      name: t("Pro Plan", "প্রো প্ল্যান"),
      price: "3,000",
      unit: t("/ month", "/ মাস"),
      description: t("Advanced features for growing businesses with higher traffic.", "বেশি ট্রাফিক সহ ক্রমবর্ধমান ব্যবসার জন্য উন্নত ফিচার।"),
      features: [
        t("2,000 Daily Message Limit", "প্রতিদিন ২,০০০ মেসেজ লিমিট"),
        t("60,000 Monthly Messages", "মাসে ৬০,০০০ মেসেজ"),
        t("20,000 Bonus Messages", "২০,০০০ বোনাস মেসেজ"),
        t("Fast AI Response Time", "ফাস্ট এআই রেসপন্স টাইম"),
        t("Priority Support", "প্রায়োরিটি সাপোর্ট"),
      ],
      icon: Zap,
      color: "indigo",
      popular: true,
    },
    {
      name: t("Enterprise", "এন্টারপ্রাইজ"),
      price: "7,500",
      unit: t("/ month", "/ মাস"),
      description: t("Scale your business with maximum capacity and dedicated support.", "সর্বোচ্চ ক্ষমতা এবং ডেডিকেটেড সাপোর্ট দিয়ে আপনার ব্যবসাকে স্কেল করুন।"),
      features: [
        t("5,000 Daily Message Limit", "প্রতিদিন ৫,০০০ মেসেজ লিমিট"),
        t("1.5 Lakh Monthly Messages", "মাসে ১.৫ লাখ মেসেজ"),
        t("30,000 Bonus Messages", "৩০,০০০ বোনাস মেসেজ"),
        t("Dedicated Account Manager", "ডেডিকেটেড অ্যাকাউন্ট ম্যানেজার"),
        t("Custom Solutions", "কাস্টম সলিউশনস"),
      ],
      icon: Star,
      color: "purple",
      popular: false,
    },
  ];

  const permanentPlans = [
    {
      name: t("Basic Credits", "বেসিক ক্রেডিট"),
      price: "150",
      unit: t("/ 1K msg", "/ ১কে মেসেজ"),
      description: t("Pay as you go. No time limit, credits stay until used.", "যতটুকু ব্যবহার করবেন ততটুকুই পে করবেন। কোনো মেয়াদ নেই।"),
      features: [
        t("1,000 AI Messages", "১,০০০ এআই মেসেজ"),
        t("No Expiry Date", "কোনো মেয়াদ নেই"),
        t("WhatsApp & Messenger", "হোয়াটসঅ্যাপ ও মেসেঞ্জার"),
        t("Shared Account Balance", "শেয়ার্ড অ্যাকাউন্ট ব্যালেন্স"),
        t("All AI Models Included", "সব এআই মডেল অন্তর্ভুক্ত"),
      ],
      icon: InfinityIcon,
      color: "green",
      popular: false,
    },
    {
      name: t("Value Pack", "ভ্যালু প্যাক"),
      price: "700",
      unit: t("/ 5K msg", "/ ৫কে মেসেজ"),
      description: t("Great value for consistent messaging without monthly commitment.", "মান্থলি ঝামেলা ছাড়া নিয়মিত মেসেজিংয়ের জন্য সেরা ভ্যালু।"),
      features: [
        t("5,000 AI Messages", "৫,০০০ এআই মেসেজ"),
        t("No Expiry Date", "কোনো মেয়াদ নেই"),
        t("Priority Support", "প্রায়োরিটি সাপোর্ট"),
        t("Advanced Features", "অ্যাডভান্সড ফিচারসমূহ"),
      ],
      icon: ShieldCheck,
      color: "indigo",
      popular: true,
    },
    {
      name: t("Bulk Saver", "বাল্ক সেভার"),
      price: "1,350",
      unit: t("/ 10K msg", "/ ১০কে মেসেজ"),
      description: t("Best for high-volume users who want total control.", "টোটাল কন্ট্রোল চাওয়া হাই-ভলিউম ইউজারদের জন্য সেরা।"),
      features: [
        t("10,000 AI Messages", "১০,০০০ এআই মেসেজ"),
        t("No Expiry Date", "কোনো মেয়াদ নেই"),
        t("VIP Account Support", "ভিআইপি অ্যাকাউন্ট সাপোর্ট"),
        t("Custom Branding", "কাস্টম ব্র্যান্ডিং"),
      ],
      icon: Zap,
      color: "purple",
      popular: false,
    },
  ];

  const currentPlans = billingCycle === "monthly" ? monthlyPlans : permanentPlans;

  return (
    <section id="pricing" className="relative py-24 overflow-hidden bg-background">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#00ff88]/5 blur-[120px] rounded-full" />
      </div>

      <div className="container relative z-10 mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#00ff88]/10 border border-[#00ff88]/20 text-[#00ff88] text-xs font-black mb-8 uppercase tracking-[0.2em]"
          >
            <Zap className="w-3 h-3" />
            {t("Professional Pricing", "প্রফেশনাল প্রাইসিং")}
          </motion.div>
          
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-black text-white mb-8 tracking-tight"
          >
            {t("Choose Your", "বেছে নিন আপনার")} <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00ff88] to-emerald-400">
              {t("Growth Strategy", "গ্রোথ স্ট্র্যাটেজি")}
            </span>
          </motion.h2>

          {/* Pricing Toggle */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="flex items-center justify-center gap-4 mt-12 p-1.5 bg-white/5 border border-white/10 rounded-2xl w-fit mx-auto backdrop-blur-md"
          >
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all ${
                billingCycle === "monthly" 
                ? "bg-[#00ff88] text-black shadow-[0_8px_20px_rgba(0,255,136,0.2)]" 
                : "text-gray-400 hover:text-white"
              }`}
            >
              <Clock className="w-4 h-4" />
              {t("Monthly Package", "মান্থলি প্যাকেজ")}
            </button>
            <button
              onClick={() => setBillingCycle("permanent")}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all ${
                billingCycle === "permanent" 
                ? "bg-[#00ff88] text-black shadow-[0_8px_20px_rgba(0,255,136,0.2)]" 
                : "text-gray-400 hover:text-white"
              }`}
            >
              <InfinityIcon className="w-4 h-4" />
              {t("Permanent Package", "পারমানেন্ট প্যাকেজ")}
            </button>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {currentPlans.map((plan, index) => (
              <motion.div
                key={`${billingCycle}-${index}`}
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -30, scale: 0.95 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                className={`relative flex flex-col p-8 rounded-[2.5rem] border backdrop-blur-3xl transition-all duration-500 hover:-translate-y-2 group ${
                  plan.popular 
                    ? "bg-[#00ff88]/[0.03] border-[#00ff88]/30 shadow-[0_20px_50px_rgba(0,255,136,0.05)]" 
                    : "bg-white/[0.01] border-white/10 hover:border-white/20"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#00ff88] text-black px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-[#00ff88]/25">
                    {t("Best Value", "সেরা ভ্যালু")}
                  </div>
                )}

                <div className="mb-8">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 transition-transform group-hover:scale-110 duration-300 ${
                    plan.color === 'blue' ? 'bg-blue-500/10 text-blue-400' :
                    plan.color === 'indigo' ? 'bg-indigo-500/10 text-indigo-400' :
                    plan.color === 'green' ? 'bg-emerald-500/10 text-emerald-400' :
                    'bg-purple-500/10 text-purple-400'
                  }`}>
                    <plan.icon className="w-7 h-7" />
                  </div>
                  <h3 className="text-2xl font-black text-white mb-3">{plan.name}</h3>
                  <p className="text-gray-500 text-sm font-bold leading-relaxed">
                    {plan.description}
                  </p>
                </div>

                <div className="mb-10">
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black text-white">৳{plan.price}</span>
                    <span className="text-gray-500 text-xs font-black uppercase tracking-widest">{plan.unit}</span>
                  </div>
                </div>

                <div className="space-y-4 mb-12 flex-1">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3">
                      <div className="mt-1 rounded-full bg-[#00ff88]/10 p-0.5">
                        <Check className="w-3.5 h-3.5 text-[#00ff88]" />
                      </div>
                      <span className="text-gray-400 text-[13px] font-bold leading-tight">{feature}</span>
                    </div>
                  ))}
                </div>

                <Button
                  variant={plan.popular ? "default" : "outline"}
                  className={`w-full h-14 rounded-2xl font-black text-sm uppercase tracking-widest transition-all duration-300 ${
                    plan.popular 
                      ? "bg-[#00ff88] hover:bg-[#00f07f] text-black shadow-lg shadow-[#00ff88]/20" 
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
          </AnimatePresence>
        </div>

        {/* Free Credits Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-20 max-w-5xl mx-auto p-10 rounded-[2.5rem] bg-gradient-to-r from-[#00ff88]/10 via-emerald-500/5 to-transparent border border-white/5 flex flex-col md:flex-row items-center justify-between gap-8 backdrop-blur-sm"
        >
          <div className="flex items-center gap-6 text-center md:text-left">
            <div className="w-16 h-16 rounded-2xl bg-[#00ff88]/20 flex items-center justify-center flex-shrink-0 animate-bounce">
              <Sparkles className="w-8 h-8 text-[#00ff88]" />
            </div>
            <div>
              <h4 className="text-2xl font-black text-white mb-2">
                {t("New Integration Bonus", "নতুন ইন্টিগ্রেশন বোনাস")}
              </h4>
              <p className="text-gray-400 text-base font-bold">
                {t("Get 100 free replies for every new WhatsApp or Messenger integration.", "প্রতিটি নতুন হোয়াটসঅ্যাপ বা মেসেঞ্জার ইন্টিগ্রেশনে ১০০টি ফ্রি রিপ্লাই পান।")}
              </p>
            </div>
          </div>
          <Button className="bg-white/5 hover:bg-white/10 text-[#00ff88] border border-[#00ff88]/20 h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs" asChild>
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

export default PricingSection;

