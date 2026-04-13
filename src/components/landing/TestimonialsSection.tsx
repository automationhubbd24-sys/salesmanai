import { motion } from "framer-motion";
import { Star, Quote, User } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const TestimonialsSection = () => {
  const { t } = useLanguage();

  const testimonials = [
    {
      name: t("Rahat Ahmed", "রাহাত আহমেদ"),
      role: t("Owner, Gadget Hub", "মালিক, গ্যাজেট হাব"),
      content: t(
        "SalesmanChatbot has completely changed how we handle customer queries. The image recognition is like magic—it identifies products and tells the price instantly!",
        "সেলসসম্যানচ্যাটবট আমাদের কাস্টমার কোয়েরি হ্যান্ডেল করার ধরন পুরোপুরি বদলে দিয়েছে। এর ইমেজ রিকগনিশন ম্যাজিকের মতো কাজ করে—সাথে সাথে প্রোডাক্ট চিনে দাম বলে দেয়!"
      ),
      rating: 5,
    },
    {
      name: t("Sumaiya Akter", "সুমাইয়া আক্তার"),
      role: t("Founder, Modish Fashion", "ফাউন্ডার, মোডিশ ফ্যাশন"),
      content: t(
        "Earlier, I used to miss sales at night. Now, the AI handles everything while I sleep. My sales have increased by 40% since I started using it.",
        "আগে রাতে অনেক সেল মিস হতো। এখন আমি যখন ঘুমাই, এআই সবকিছু সামলায়। এটি ব্যবহার শুরু করার পর থেকে আমার সেল ৪০% বেড়ে গেছে।"
      ),
      rating: 5,
    },
    {
      name: t("Tanvir Hossain", "তানভীর হোসেন"),
      role: t("Manager, Tech Solutions", "ম্যানেজার, টেক সলিউশনস"),
      content: t(
        "The integration was so easy! Within 10 minutes, our Facebook page was automated. Highly recommended for any business in Bangladesh.",
        "ইন্টিগ্রেশন ছিল খুবই সহজ! ১০ মিনিটের মধ্যেই আমাদের ফেসবুক পেজ অটোমেটেড হয়ে গেছে। বাংলাদেশের যেকোনো ব্যবসার জন্য এটি হাইলি রিকমেন্ডেড।"
      ),
      rating: 5,
    },
  ];

  return (
    <section className="py-24 bg-background relative overflow-hidden">
      {/* Glow Effects */}
      <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-blue-500/5 blur-[100px] rounded-full" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-indigo-500/5 blur-[100px] rounded-full" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold mb-6 uppercase tracking-wider"
          >
            <Star className="w-3 h-3 fill-current" />
            {t("Testimonials", "গ্রাহকদের মতামত")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-black text-white mb-6"
          >
            {t("Loved by", "পছন্দ করেছেন")} <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              {t("hundreds of businesses", "শত শত উদ্যোক্তা")}
            </span>
          </motion.h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative p-8 rounded-3xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col"
            >
              <div className="absolute top-6 right-8 text-white/5">
                <Quote className="w-12 h-12" />
              </div>
              
              <div className="flex gap-1 mb-6">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                ))}
              </div>

              <p className="text-slate-300 text-lg font-medium leading-relaxed mb-8 flex-1 italic">
                "{testimonial.content}"
              </p>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                  <User className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h4 className="text-white font-black text-sm uppercase tracking-wider">{testimonial.name}</h4>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-0.5">{testimonial.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
