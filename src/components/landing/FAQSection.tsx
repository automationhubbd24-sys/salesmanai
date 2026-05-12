import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, HelpCircle } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

const FAQSection = () => {
  const { t } = useLanguage();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      question: t("How does the AI recognize my products?", "এআই কীভাবে আমার প্রোডাক্টগুলো চেনে?"),
      answer: t(
        "Our AI uses advanced computer vision to analyze images sent by customers. It cross-references these with your product database to identify items, prices, and stock levels automatically.",
        "আমাদের এআই অ্যাডভান্সড কম্পিউটার ভিশন ব্যবহার করে কাস্টমারদের পাঠানো ছবি অ্যানালাইসিস করে। এটি আপনার প্রোডাক্ট ডাটাবেসের সাথে মিলিয়ে স্বয়ংক্রিয়ভাবে আইটেম, দাম এবং স্টকের তথ্য বের করে ফেলে।"
      ),
    },
    {
      question: t("Can I integrate it with my Facebook Page?", "আমি কি এটা আমার ফেসবুক পেজের সাথে ইন্টিগ্রেট করতে পারব?"),
      answer: t(
        "Yes! Integration is seamless. You can connect your Facebook Page, Instagram Business account, and WhatsApp Business API in just a few clicks.",
        "হ্যাঁ! ইন্টিগ্রেশন খুবই সহজ। আপনি মাত্র কয়েক ক্লিকেই আপনার ফেসবুক পেজ, ইনস্টাগ্রাম বিজনেস অ্যাকাউন্ট এবং হোয়াটসঅ্যাপ বিজনেস এপিআই কানেক্ট করতে পারবেন।"
      ),
    },
    {
      question: t("What happens if the AI can't answer a question?", "এআই যদি কোনো প্রশ্নের উত্তর দিতে না পারে তবে কী হবে?"),
      answer: t(
        "If the AI encounters a complex query it can't handle, it gracefully notifies you and allows a human agent to take over the conversation instantly.",
        "যদি এআই কোনো জটিল প্রশ্ন পায় যা সে সমাধান করতে পারছে না, তবে সে আপনাকে জানিয়ে দেবে এবং একজন হিউম্যান এজেন্ট সাথে সাথেই সেই চ্যাটটি নিজের নিয়ন্ত্রণে নিতে পারবেন।"
      ),
    },
    {
      question: t("Is my data and my customers' data secure?", "আমার এবং আমার কাস্টমারদের ডাটা কি সুরক্ষিত?"),
      answer: t(
        "Absolutely. We use enterprise-grade encryption and follow strict data privacy protocols to ensure all conversations and business data remain private and secure.",
        "অবশ্যই। আমরা এন্টারপ্রাইজ-গ্রেড এনক্রিপশন ব্যবহার করি এবং কঠোর ডাটা প্রাইভেসি প্রোটোকল অনুসরণ করি যাতে আপনার সব কথোপকথন এবং বিজনেস ডাটা ব্যক্তিগত ও সুরক্ষিত থাকে।"
      ),
    },
    {
      question: t("Do I need technical skills to set it up?", "এটি সেটআপ করার জন্য কি আমার টেকনিক্যাল স্কিল প্রয়োজন?"),
      answer: t(
        "No technical skills required. Our user-friendly dashboard guides you through the process, and our support team is always ready to help if you need assistance.",
        "কোনো টেকনিক্যাল স্কিলের প্রয়োজন নেই। আমাদের ইউজার-ফ্রেন্ডলি ড্যাশবোর্ড আপনাকে পুরো প্রসেসটি বুঝিয়ে দেবে, আর কোনো সাহায্যের প্রয়োজন হলে আমাদের সাপোর্ট টিম সবসময় প্রস্তুত আছে।"
      ),
    },
  ];

  return (
    <section id="faq" className="py-24 bg-[#000000] relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/5 border border-purple-500/10 text-purple-400/80 text-xs font-bold mb-6 uppercase tracking-wider"
          >
            <HelpCircle className="w-3 h-3" />
            {t("FAQ", "সাধারণ জিজ্ঞাসা")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-black text-white mb-6"
          >
            {t("Common questions", "সাধারণ কিছু")} <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400/80 to-pink-400/80">
              {t("answered", "প্রশ্ন ও উত্তর")}
            </span>
          </motion.h2>
        </div>

        <div className="max-w-3xl mx-auto space-y-4">
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className={`w-full p-6 rounded-2xl border transition-all duration-300 flex items-start gap-4 text-left ${
                  openIndex === index 
                    ? "bg-white/[0.03] border-white/10" 
                    : "bg-white/[0.01] border-white/5 hover:border-white/10"
                }`}
              >
                <div className={`mt-1 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                  openIndex === index ? "bg-indigo-500/80 text-white" : "bg-white/5 text-slate-500 group-hover:text-white"
                }`}>
                  {openIndex === index ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </div>
                <div className="flex-1">
                  <h3 className={`text-lg font-bold transition-colors ${
                    openIndex === index ? "text-white" : "text-slate-400 group-hover:text-white"
                  }`}>
                    {faq.question}
                  </h3>
                  <AnimatePresence>
                    {openIndex === index && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <p className="pt-4 text-slate-500 leading-relaxed">
                          {faq.answer}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQSection;
