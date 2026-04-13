import { motion } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import { 
  Languages, 
  MessageCircle,
  Smartphone,
  Zap,
  Camera,
  Globe,
  Facebook,
  Instagram,
  CheckCircle2,
  Search,
  MessageSquare
} from "lucide-react";

const FeatureGrid = () => {
  const { t } = useLanguage();

  const features = [
    {
      title: t("Image Recognition", "ইমেজ রিকগনিশন"),
      desc: t("The only AI that recognizes product images and replies with exact item, price, and options.", "একমাত্র এআই যা প্রোডাক্টের ছবি চিনতে পারে এবং সঠিক আইটেম, দাম এবং অপশন সহ রিপ্লাই দেয়।"),
      icon: Camera,
      className: "md:col-span-2 md:row-span-2 border-indigo-500/20 hover:border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.05)]",
      iconColor: "text-indigo-400",
      glowColor: "bg-indigo-500/20",
      preview: (
        <div className="relative w-full h-48 md:h-64 mt-4 mb-8 bg-card/40 rounded-2xl border border-border overflow-hidden flex items-center justify-center group-hover:border-indigo-500/30 transition-colors">
          <div className="absolute inset-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60')] bg-cover bg-center" />
          {/* Scanning Line */}
          <motion.div 
            animate={{ top: ['0%', '100%'] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="absolute left-0 w-full h-0.5 bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,1)] z-10"
          />
          {/* Detection Labels */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            className="absolute top-1/4 right-1/4 bg-indigo-600/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-indigo-400/50 shadow-2xl z-20"
          >
            <div className="text-[10px] font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-indigo-300" /> Detected: Smart Watch
            </div>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className="absolute bottom-1/3 left-1/4 bg-muted/20 backdrop-blur-md px-3 py-1.5 rounded-lg border border-border shadow-2xl z-20"
          >
            <div className="text-[10px] font-bold text-foreground uppercase tracking-wider">Price: $199.00</div>
          </motion.div>
        </div>
      )
    },
    {
      title: t("Multi Lingual", "মাল্টি-লিঙ্গুয়াল"),
      desc: t("Fluent in Bangla, English, and Banglish naturally.", "বাংলা, ইংরেজি এবং বাংলিশে প্রাকৃতিকভাবে পারদর্শী।"),
      icon: Languages,
      className: "border-purple-500/20 hover:border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.05)]",
      iconColor: "text-purple-400",
      glowColor: "bg-purple-500/20",
      preview: (
        <div className="relative h-32 w-full mt-4 mb-6 overflow-hidden flex flex-col gap-2">
          <motion.div 
            animate={{ x: [-20, 0], opacity: [0, 1] }}
            className="self-start bg-purple-600/20 border border-purple-500/30 px-3 py-1.5 rounded-2xl rounded-tl-none text-[10px] text-purple-200 font-bold"
          >
            How can I help you today?
          </motion.div>
          <motion.div 
            animate={{ x: [20, 0], opacity: [0, 1] }}
            transition={{ delay: 0.5 }}
            className="self-end bg-muted/20 border border-border px-3 py-1.5 rounded-2xl rounded-tr-none text-[10px] text-foreground font-bold"
          >
            এই ঘড়িটার দাম কত?
          </motion.div>
          <motion.div 
            animate={{ x: [-20, 0], opacity: [0, 1] }}
            transition={{ delay: 1 }}
            className="self-start bg-purple-600/20 border border-purple-500/30 px-3 py-1.5 rounded-2xl rounded-tl-none text-[10px] text-purple-200 font-bold"
          >
            এটির দাম ১৯৯ ডলার।
          </motion.div>
        </div>
      )
    },
    {
      title: t("All-in-One Inbox", "অল-ইন-ওয়ান ইনবক্স"),
      desc: t("Manage Facebook, Instagram, and WhatsApp from one dashboard.", "ফেসবুক, ইনস্টাগ্রাম এবং হোয়াটসঅ্যাপ এক ড্যাশবোর্ড থেকে ম্যানেজ করুন।"),
      icon: MessageCircle,
      className: "border-emerald-500/20 hover:border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.05)]",
      iconColor: "text-emerald-400",
      glowColor: "bg-emerald-500/20",
      preview: (
        <div className="relative h-32 w-full mt-4 mb-6 flex items-center justify-around">
          {[
            { icon: Facebook, color: "text-blue-500", bg: "bg-blue-500/10", label: "99+" },
            { icon: Instagram, color: "text-pink-500", bg: "bg-pink-500/10", label: "24" },
            { icon: MessageCircle, color: "text-green-500", bg: "bg-green-500/10", label: "12" }
          ].map((platform, i) => (
            <motion.div 
              key={i}
              whileHover={{ scale: 1.1, rotate: 5 }}
              className={`relative p-4 rounded-2xl ${platform.bg} border border-border`}
            >
              <platform.icon className={`w-6 h-6 ${platform.color}`} />
              <div className="absolute -top-2 -right-2 bg-red-500 text-[8px] font-black text-white px-1.5 py-0.5 rounded-full border-2 border-border">
                {platform.label}
              </div>
            </motion.div>
          ))}
        </div>
      )
    },
    {
      title: t("Mobile App Support", "মোবাইল অ্যাপ সাপোর্ট"),
      desc: t("Manage chats, track orders, and check analytics from anywhere.", "যেকোনো জায়গা থেকে চ্যাট ম্যানেজ করুন, অর্ডার ট্র্যাক করুন এবং অ্যানালিটিক্স চেক করুন।"),
      icon: Smartphone,
      className: "md:col-span-3 border-blue-500/20 hover:border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.05)]",
      iconColor: "text-blue-400",
      glowColor: "bg-blue-500/20",
      preview: (
        <div className="relative w-full h-48 mt-4 mb-8 flex items-center justify-center">
          {/* Mobile Frame */}
          <div className="w-32 h-56 bg-black rounded-[2rem] border-4 border-border shadow-2xl relative overflow-hidden transform -rotate-12 group-hover:-rotate-6 transition-transform duration-500">
            <div className="absolute top-0 left-0 w-full h-4 bg-muted/20 flex items-center justify-center">
              <div className="w-8 h-1 bg-muted/40 rounded-full" />
            </div>
            <div className="p-3 pt-6 space-y-2">
              <div className="h-2 w-12 bg-blue-500/20 rounded" />
              <div className="h-8 w-full bg-muted/20 rounded-lg border border-border" />
              <div className="h-8 w-full bg-muted/20 rounded-lg border border-border" />
              <div className="h-2 w-8 bg-blue-500/20 rounded self-end" />
            </div>
          </div>
          {/* Secondary Mobile Frame */}
          <div className="w-28 h-48 bg-black rounded-[1.5rem] border-4 border-border shadow-2xl relative overflow-hidden transform rotate-12 -ml-8 group-hover:rotate-6 transition-transform duration-500">
            <div className="p-2 pt-4 space-y-2">
              <div className="h-1.5 w-8 bg-purple-500/20 rounded" />
              <div className="h-16 w-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-lg" />
            </div>
          </div>
        </div>
      )
    },
  ];

  return (
    <section id="features" className="py-24 bg-background relative overflow-hidden">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 z-0 opacity-[0.03] bg-grid-pattern" />
      
      {/* Background Glows */}
      <div className="absolute top-0 left-[-10%] w-[50%] h-[50%] bg-indigo-600/5 blur-[150px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-[-10%] w-[50%] h-[50%] bg-purple-600/5 blur-[150px] rounded-full pointer-events-none" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="mb-16 flex flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-6 py-2.5 text-[10px] font-black tracking-[0.3em] text-muted-foreground mb-8 uppercase backdrop-blur-xl"
          >
            <Zap className="w-4 h-4 text-purple-500 fill-purple-500" /> {t("Superpowers", "সুপারপাওয়ার")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl lg:text-6xl font-black tracking-tighter text-foreground leading-[1.1] mb-8"
          >
            {t("Engineered for", "তৈরি করা হয়েছে")}<br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              {t("Exponential Growth", "দ্রুত বৃদ্ধির জন্য")}
            </span>
          </motion.h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.8 }}
              className={`group relative overflow-hidden rounded-[2rem] border border-border bg-card p-8 md:p-10 backdrop-blur-3xl transition-all duration-500 hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col ${feature.className}`}
            >
              {/* Corner Accents */}
              <div className="absolute top-6 left-6 w-6 h-6 border-t border-l border-border/30 group-hover:border-border transition-colors" />
              <div className="absolute bottom-6 right-6 w-6 h-6 border-b border-r border-border/30 group-hover:border-border transition-colors" />
              
              <div className="relative z-10 h-full flex flex-col">
                {/* Icon Container */}
                <div className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/20 border border-border transition-all duration-500 group-hover:scale-110 group-hover:bg-muted/30 ${feature.iconColor} shadow-2xl relative`}>
                  <div className={`absolute inset-0 opacity-10 blur-xl ${feature.glowColor}`} />
                  <feature.icon className="h-6 w-6 relative z-10" />
                </div>

                <div className="flex-1">
                  <h3 className="mb-2 text-xl font-black text-foreground tracking-tight transition-colors duration-300">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground font-medium text-sm leading-relaxed transition-colors duration-300 max-w-[280px]">
                    {feature.desc}
                  </p>
                </div>

                {/* Preview Element */}
                {feature.preview}
              </div>
              
              {/* Subtle Gradient Hover Effect */}
              <div className={`absolute inset-0 bg-gradient-to-br from-background/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeatureGrid;
