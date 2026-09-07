import { motion } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import { UserPlus, Settings, Zap, Workflow } from "lucide-react";

const HowItWorks = () => {
  const { t } = useLanguage();

  const steps = [
    {
      title: t("Connect Accounts", "অ্যাকাউন্ট কানেক্ট করুন"),
      desc: t("Connect your Facebook, Instagram, or WhatsApp in one click.", "এক ক্লিকে আপনার ফেসবুক, ইনস্টাগ্রাম বা হোয়াটসঅ্যাপ কানেক্ট করুন।"),
      icon: UserPlus,
    },
    {
      title: t("Set Instructions", "নির্দেশনা দিন"),
      desc: t("Tell AI about your products and business tone.", "আপনার প্রোডাক্ট এবং ব্যবসার ধরন সম্পর্কে এআই-কে জানান।"),
      icon: Settings,
    },
    {
      title: t("Start Selling", "সেলস শুরু করুন"),
      desc: t("AI starts replying and taking orders automatically.", "এআই অটোমেটিকভাবে রিপ্লাই এবং অর্ডার নেওয়া শুরু করবে।"),
      icon: Zap,
    }
  ];

  return (
    <section id="how" className="py-24 bg-[#050505] relative overflow-hidden border-t border-white/5">
      {/* Animated Background Elements */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-600/5 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-slate-400 text-xs font-black uppercase tracking-[0.3em] mb-6 backdrop-blur-xl"
          >
            <Workflow className="w-4 h-4 text-[#00ff88]" />
            {t("How it works", "কার্যপদ্ধতি")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight"
          >
            {t("Three steps to", "তিনটি সহজ ধাপে")}<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00ff88] to-emerald-400">
              {t("Total Automation", "ফুল অটোমেশন")}
            </span>
          </motion.h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative max-w-6xl mx-auto">
          {/* Connection Lines (Desktop) */}
          <div className="hidden md:block absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-y-1/2 z-0" />
          
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2 }}
              className="relative z-10 flex flex-col items-center text-center group"
            >
              <div className="mb-8 relative">
                <div className="w-24 h-24 rounded-[2rem] bg-white/[0.03] border border-white/10 flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:bg-white/5 group-hover:border-[#00ff88]/30 relative overflow-hidden shadow-2xl">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#00ff88]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <step.icon className="w-10 h-10 text-white relative z-10" />
                  
                  {/* Step Number */}
                  <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[#00ff88] text-black text-xs font-black flex items-center justify-center shadow-lg">
                    {index + 1}
                  </div>
                </div>
              </div>
              <h3 className="text-xl font-black text-white mb-4 uppercase tracking-tight">{step.title}</h3>
              <p className="text-slate-400 font-medium text-sm leading-relaxed max-w-[250px]">
                {step.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
