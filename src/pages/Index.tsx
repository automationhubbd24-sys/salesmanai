import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import HeroSection from "@/components/landing/HeroSection";
import FeatureGrid from "@/components/landing/FeatureGrid";
import HowItWorks from "@/components/landing/HowItWorks";
import TestimonialsSection from "@/components/landing/TestimonialsSection";
import FAQSection from "@/components/landing/FAQSection";
import StatsSection from "@/components/landing/StatsSection";
import CaseStudies from "@/components/landing/CaseStudies";
import PricingSection from "@/components/landing/PricingSection";
import { useLanguage } from "@/contexts/LanguageContext";
import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import SEO from "@/components/SEO";

const Index = () => {
  const { t } = useLanguage();
  const [supportOpen, setSupportOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-[#00ff88] selection:text-black relative overflow-x-hidden scroll-smooth">
      <SEO
        title="SalesmanChatbot — Automate Sales & Support with AI Agents"
        description="SalesmanChatbot helps business owners automate chat, orders, and growth with modern AI and automation tools."
      />
      <Navbar />

      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-10 z-[60]">
        {supportOpen ? (
          <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-[280px] sm:w-[240px]">
            <div className="flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">Get Support</div>
              <button
                onClick={() => setSupportOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white flex items-center justify-center transition-all"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="mt-3 flex items-center gap-4 justify-around">
              <a
                href="https://wa.me/8801956871403"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 group"
              >
                <div className="w-14 h-14 rounded-full bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/20 flex items-center justify-center transition-all group-hover:scale-110">
                  <img
                    src="https://cdn-icons-png.flaticon.com/512/733/733585.png"
                    alt="WhatsApp"
                    className="w-8 h-8"
                    width="32"
                    height="32"
                    loading="lazy"
                  />
                </div>
                <span className="text-[10px] font-bold text-gray-400">WhatsApp</span>
              </a>
              <a
                href="https://discord.gg/KEDXD7Ma4S"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 group"
              >
                <div className="w-14 h-14 rounded-full bg-[#5865F2]/10 hover:bg-[#5865F2]/20 border border-[#5865F2]/20 flex items-center justify-center transition-all group-hover:scale-110">
                  <img
                    src="https://cdn-icons-png.flaticon.com/512/5968/5968756.png"
                    alt="Discord"
                    className="w-8 h-8"
                    width="32"
                    height="32"
                    loading="lazy"
                  />
                </div>
                <span className="text-[10px] font-bold text-gray-400">Discord</span>
              </a>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setSupportOpen(true)}
            className="flex items-center justify-center rounded-full bg-[#00ff88] text-black w-14 h-14 shadow-[0_12px_30px_rgba(0,255,136,0.25)] hover:shadow-[0_14px_36px_rgba(0,255,136,0.35)] transition-transform hover:scale-[1.05] active:scale-95"
            aria-label="Get Support"
          >
            <MessageCircle className="w-6 h-6" />
          </button>
        )}
      </div>

      <main className="relative">
        <HeroSection />
        <StatsSection />
        <FeatureGrid />
        <HowItWorks />
        <CaseStudies />
        <TestimonialsSection />
        <PricingSection />
        <FAQSection />

        <section id="cta" className="py-24 px-4 text-center bg-[#050505] relative overflow-hidden border-t border-white/5">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#00ff88]/5 blur-[120px] rounded-full pointer-events-none" />
          <div className="max-w-3xl mx-auto relative z-10">
            <h2 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-6">
              {t("Automate. Convert. Grow.", "অটোমেট। কনভার্ট। গ্রো।")}
            </h2>
            <p className="mt-6 text-lg text-slate-400 font-medium">
              {t("Join hundreds of businesses scaling with SalesmanChatbot today.", "আজই যোগ দিন শত শত উদ্যোক্তাদের সাথে যারা সেলসম্যানচ্যাটবট ব্যবহার করছেন।")}
            </p>
            <div className="mt-12">
              <Link to="/register" className="inline-flex h-16 px-12 items-center justify-center rounded-[2rem] bg-[#00ff88] text-black font-black text-lg shadow-[0_20px_40px_rgba(0,255,136,0.2)] hover:shadow-[0_25px_50px_rgba(0,255,136,0.3)] transition-all hover:scale-105 active:scale-95 uppercase tracking-widest">
                {t("Get Started Now", "এখনই শুরু করুন")}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
