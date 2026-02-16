import { motion } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import { UserPlus, Settings, Zap } from "lucide-react";

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
    <section className="py-24 bg-[#000000] relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-black tracking-tighter text-white mb-6"
          >
            {t("Start in 3 Simple Steps", "৩টি সহজ ধাপে শুরু করুন")}
          </motion.h2>
        </div>

        <div className="grid md:grid-cols-3 gap-12">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2 }}
              className="relative text-center group"
            >
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-12 left-1/2 w-full h-[2px] bg-gradient-to-r from-indigo-500/50 to-transparent z-0" />
              )}
              <div className="relative z-10 mb-8 mx-auto w-24 h-24 rounded-[2rem] bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all duration-500 group-hover:scale-110 group-hover:rotate-12 shadow-2xl">
                <step.icon className="w-10 h-10" />
                <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black text-xs">
                  {index + 1}
                </div>
              </div>
              <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-indigo-400 transition-colors">{step.title}</h3>
              <p className="text-slate-400 font-medium leading-relaxed max-w-xs mx-auto">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
