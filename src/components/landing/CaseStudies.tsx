import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowUpRight, Zap } from "lucide-react";

const CaseStudies = () => {
  const { t } = useLanguage();

  const cases = [
    {
      company: "TV Hut",
      category: t("Electronics", "ইলেক্ট্রনিক্স"),
      result: "80% AI Automation",
      image: "https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&q=80&w=800",
      desc: t("Streamlined customer queries and accelerated lead-to-purchase flow with 25% order increase.", "কাস্টমার কুয়েরি সহজ করেছে এবং ২৫% অর্ডার বৃদ্ধির সাথে লিড থেকে কেনাকাটার গতি বাড়িয়েছে।")
    },
    {
      company: "Jatra Biroti",
      category: t("Restaurant", "রেস্টুরেন্ট"),
      result: "86% FAQ Handled",
      image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=800",
      desc: t("Effortless FAQ handling with 10s avg response time, keeping guest communication smooth.", "১০ সেকেন্ড গড় রেসপন্স টাইম সহ সহজ এফএকিউ হ্যান্ডলিং, যা যোগাযোগ রাখে নিরবচ্ছিন্ন।")
    },
    {
      company: "Matita Resort",
      category: t("Resort", "রিসোর্ট"),
      result: "94% AI Automation",
      image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&q=80&w=800",
      desc: t("Reduced booking time by 60% and managed guest queries seamlessly.", "বুকিং টাইম ৬০% কমিয়ে এনেছে এবং গেস্টদের কুয়েরি নিরবচ্ছিন্নভাবে ম্যানেজ করেছে।")
    }
  ];

  return (
    <section className="py-8 bg-background relative overflow-hidden">
      {/* Background Glows (Gaming Vibe) */}
      <div className="absolute top-1/2 right-[-10%] -translate-y-1/2 w-[50%] h-[70%] bg-indigo-600/5 blur-[180px] rounded-full pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[60%] bg-purple-600/5 blur-[150px] rounded-full pointer-events-none animate-pulse" style={{ animationDelay: '1.5s' }} />
      
      {/* Grid Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.01] pointer-events-none" 
        style={{ 
          backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
          backgroundSize: '80px 80px'
        }} 
      />

      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-12">
          <div className="max-w-4xl">
            <motion.h2
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="mb-8 text-3xl md:text-5xl font-black tracking-tighter text-white leading-[1.1]"
            >
              {t("Real Results for", "আসল ফলাফল")}<br />
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                {t("Real Businesses", "আসল ব্যবসার জন্য")}
              </span>
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="text-base md:text-lg text-slate-400 font-medium max-w-2xl leading-relaxed"
            >
              {t("See how Bangladeshi businesses are scaling with our AI agents.", "দেখুন কীভাবে বাংলাদেশি ব্যবসাগুলো আমাদের এআই এজেন্টের মাধ্যমে স্কেল করছে।")}
            </motion.p>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <Link to="/register" className="flex items-center gap-6 font-black text-white hover:text-indigo-400 transition-all group text-xs uppercase tracking-[0.3em] bg-white/5 px-10 py-6 rounded-[2rem] border border-white/10 hover:border-indigo-500/50 backdrop-blur-3xl shadow-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative z-10">{t("View all success stories", "সব সাকসেস স্টোরি দেখুন")}</span>
              <ArrowUpRight className="h-6 w-6 relative z-10 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
            </Link>
          </motion.div>
        </div>

        <div className="grid gap-12 md:grid-cols-3">
          {cases.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2, duration: 0.8 }}
              className="group cursor-pointer relative"
            >
              <div className="relative mb-10 overflow-hidden rounded-[3.5rem] aspect-[4/5.5] border border-white/5 shadow-2xl transition-all duration-700 group-hover:border-indigo-500/30 group-hover:shadow-[0_40px_100px_rgba(0,0,0,0.6)]">
                <img
                  src={item.image}
                  alt={item.company}
                  className="h-full w-full object-cover transition-transform duration-[1.5s] group-hover:scale-110 grayscale-[100%] group-hover:grayscale-0 group-hover:brightness-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/40 to-transparent opacity-90 group-hover:opacity-70 transition-opacity duration-700" />
                
                {/* Glossy Reflection (Gaming Style) */}
                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                
                {/* Floating Corner Tag */}
                <div className="absolute top-8 left-8">
                  <div className="px-5 py-2.5 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-xl text-[10px] font-black uppercase tracking-[0.2em] text-white/80 shadow-2xl">
                    {item.category}
                  </div>
                </div>

                <div className="absolute bottom-12 left-12 right-12 z-10">
                  <h3 className="text-2xl md:text-3xl font-black text-white mb-4 tracking-tighter leading-none group-hover:text-indigo-400 transition-colors">{item.company}</h3>
                  <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 backdrop-blur-xl shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                    <Zap className="w-5 h-5 text-indigo-400 fill-indigo-400/20" />
                    <span className="text-indigo-400 font-black text-xl tracking-tighter leading-none">
                      {item.result}
                    </span>
                  </div>
                </div>
              </div>
              <div className="px-8 relative">
                {/* Accent Line */}
                <div className="absolute left-0 top-0 w-1 h-full bg-gradient-to-b from-indigo-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <p className="text-slate-400 font-medium text-base leading-relaxed group-hover:text-slate-200 transition-colors duration-500">
                  {item.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CaseStudies;
