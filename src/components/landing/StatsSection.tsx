import { motion } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";

const StatsSection = () => {
  const { t } = useLanguage();
  
  const stats = [
    { label: t("AI Automation Rate", "এআই অটোমেশন রেট"), value: "80%+" },
    { label: t("Response Time", "রেসপন্স টাইম"), value: "< 10s" },
    { label: t("Sales Increase", "সেলস বৃদ্ধি"), value: "32%+" },
    { label: t("Support Cost Reduced", "সাপোর্ট খরচ কমেছে"), value: "50%" },
  ];

  return (
    <section className="py-20 bg-[#000000] relative overflow-hidden">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="text-center"
            >
              <div className="text-3xl md:text-5xl font-black text-white mb-2 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-slate-400 text-sm font-medium uppercase tracking-wider">
                {stat.label}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
