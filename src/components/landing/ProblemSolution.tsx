import { motion } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import { XCircle, CheckCircle2, AlertCircle } from "lucide-react";

const ProblemSolution = () => {
  const { t } = useLanguage();

  const problems = [
    {
      title: t("Missed Messages", "মেসেজ মিস হওয়া"),
      desc: t("Customers buy from competitors who reply instantly.", "কাস্টমাররা তাদের থেকেই কেনে যারা সাথে সাথে রিপ্লাই দেয়।"),
      icon: XCircle,
      color: "text-red-400"
    },
    {
      title: t("Late Replies", "দেরিতে রিপ্লাই"),
      desc: t("Your inbox fills with unread messages while you sleep.", "আপনি যখন ঘুমান, আপনার ইনবক্স না পড়া মেসেজে ভরে যায়।"),
      icon: AlertCircle,
      color: "text-orange-400"
    },
    {
      title: t("Repetitive Tasks", "একই কাজ বারবার"),
      desc: t("Spending hours answering the same price questions.", "একই দামের প্রশ্নের উত্তর দিতে ঘন্টার পর ঘন্টা সময় নষ্ট।"),
      icon: XCircle,
      color: "text-red-400"
    }
  ];

  return (
    <section id="problem-solution" className="py-24 bg-background relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-20">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-black tracking-tighter text-foreground mb-6"
          >
            {t("Why businesses are losing", "কেন ব্যবসাগুলো হারাচ্ছে")}<br />
            <span className="text-red-500/80">{t("Sales every single day", "প্রতিদিন সেলস")}</span>
          </motion.h2>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-20">
          {problems.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="bg-card/30 border border-border/20 rounded-[2rem] p-8 backdrop-blur-xl"
            >
              <item.icon className={`w-12 h-12 ${item.color} opacity-80 mb-6`} />
              <h3 className="text-xl font-bold text-foreground mb-4">{item.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="bg-gradient-to-br from-indigo-900/20 to-purple-900/20 rounded-[3rem] p-1 md:p-1.5 shadow-[0_0_80px_rgba(79,70,229,0.05)]"
        >
          <div className="bg-card rounded-[2.8rem] p-8 md:p-16 flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1">
              <h3 className="text-2xl md:text-4xl font-black text-white mb-6 leading-tight">
                Salesman<span className="text-[#A855F7]">Chatbot</span> {t("is your superhuman", "আপনার সুপারহিউম্যান")}<br />
                <span className="text-indigo-400/80">{t("Sales Agent that never sleeps", "সেলস এজেন্ট যে কখনো ঘুমায় না")}</span>
              </h3>
              <ul className="space-y-4">
                {[
                  t("Replies instantly to every customer", "প্রতিটি কাস্টমারকে সাথে সাথে রিপ্লাই দেয়"),
                  t("Works on Facebook, Instagram, and WhatsApp", "ফেসবুক, ইনস্টাগ্রাম এবং হোয়াটসঅ্যাপে কাজ করে"),
                  t("Recognizes products and prices automatically", "অটোমেটিকভাবে প্রোডাক্ট এবং দাম চিনতে পারে")
                ].map((text, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-400 font-medium">
                    <CheckCircle2 className="w-5 h-5 text-indigo-400/60" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex-1 relative">
               <div className="absolute inset-0 bg-indigo-500/10 blur-[100px] rounded-full animate-pulse" />
               <div className="relative bg-[#000000] border border-white/5 rounded-2xl p-6 shadow-2xl">
                  <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-600/80 flex items-center justify-center text-white font-bold">AI</div>
                    <div>
                      <div className="text-xs font-bold text-white">Salesman AI</div>
                      <div className="text-[10px] text-emerald-500/80 flex items-center gap-1">
                        <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                        Online
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="bg-white/5 rounded-xl p-3 max-w-[80%]">
                      <div className="text-[10px] text-slate-500 mb-1">Customer</div>
                      <div className="text-xs text-white/80">How much for the iPhone 15?</div>
                    </div>
                    <div className="bg-indigo-600/20 rounded-xl p-3 max-w-[80%] ml-auto border border-indigo-500/20">
                      <div className="text-[10px] text-indigo-400/80 mb-1">Salesman AI</div>
                      <div className="text-xs text-white/90 italic">Recognizing product...</div>
                    </div>
                  </div>
               </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default ProblemSolution;
