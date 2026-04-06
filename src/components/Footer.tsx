import { Link, useLocation } from "react-router-dom";
import Logo from "@/components/Logo";
import { Facebook, Instagram, Linkedin, Twitter, MessageCircle, Send, Globe, Shield, Zap, Disc as Discord } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { motion } from "framer-motion";

const Footer = () => {
  const { t } = useLanguage();
  const location = useLocation();
  const accentColor = location.pathname === "/" ? "#00ff88" : "#A855F7";
  
  const footerLinks = {
    [t("Product", "প্রোডাক্ট")]: [
      { name: t("Features", "ফিচারসমূহ"), href: "/#features" },
      { name: t("How it Works", "এটি কীভাবে কাজ করে"), href: "/#how-it-works" },
      { name: t("Pricing", "প্রাইসিং"), href: "/#pricing" },
      { name: t("Integrations", "ইন্টিগ্রেশন"), href: "/dashboard" },
      { name: t("Developer API", "ডেভেলপার এপিআই"), href: "/dashboard/api" },
    ],
    [t("Support", "সাপোর্ট")]: [
      { name: t("Help Center", "হেল্প সেন্টার"), href: "/login" },
      { name: t("Community", "কমিউনিটি"), href: "https://facebook.com" },
      { name: t("Contact Us", "যোগাযোগ করুন"), href: "/login" },
      { name: t("Video Tutorials", "ভিডিও টিউটোরিয়াল"), href: "https://youtube.com" },
    ],
    [t("Company", "কোম্পানি")]: [
      { name: t("About Us", "আমাদের সম্পর্কে"), href: "/login" },
      { name: t("Success Stories", "সফলতার গল্প"), href: "/#case-studies" },
      { name: t("Blog", "ব্লগ"), href: "/login" },
      { name: t("Careers", "ক্যারিয়ার"), href: "/login" },
    ],
    [t("Legal", "লিগ্যাল")]: [
      { name: t("Privacy Policy", "প্রাইভেসি পলিসি"), href: "/privacy-policy" },
      { name: t("Terms of Service", "টার্মস অফ সার্ভিস"), href: "/terms-of-service" },
      { name: t("Cookie Policy", "কুকি পলিসি"), href: "/privacy-policy" },
    ],
  };

  return (
    <footer id="footer" className="border-t border-white/5 bg-[#000000] relative overflow-hidden pt-12 pb-12">
      {/* Background Glows (Gaming Vibe) */}
      <div className="absolute top-0 right-[-10%] w-[40%] h-[60%] bg-indigo-600/5 blur-[150px] rounded-full pointer-events-none animate-pulse" />
      <div className="absolute bottom-0 left-[-10%] w-[40%] h-[60%] bg-purple-600/5 blur-[150px] rounded-full pointer-events-none animate-pulse" style={{ animationDelay: '2s' }} />
      
      {/* Animated Grid Overlay */}
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4f46e5 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="container relative z-10 mx-auto px-4">
        {/* Pre-footer CTA removed as requested */}

        <div className="grid gap-16 md:grid-cols-2 lg:grid-cols-6">
          {/* Logo & Description */}
          <div className="lg:col-span-2">
            <Link to="/" className="inline-block group mb-8">
              <div className="relative">
                <Logo animated={true} accentColor={accentColor} />
              </div>
            </Link>
            <p className="text-lg text-slate-500 font-medium leading-relaxed max-w-sm mb-10">
              {t("Next-gen AI sales infrastructure for modern businesses. Scaling conversations, driving revenue.", "আধুনিক ব্যবসার জন্য নেক্সট-জেন এআই সেলস ইনফ্রাস্ট্রাকচার।")}
            </p>
            <div className="flex gap-4">
              {[
                { Icon: MessageCircle, href: "https://wa.me/8801956871403", bg: "bg-[#25D366]", hoverBg: "hover:bg-[#22c35e]" },
                { Icon: Discord, href: "https://discord.gg/KEDXD7Ma4S", bg: "bg-[#5865F2]", hoverBg: "hover:bg-[#4c56e6]" }
              ].map(({ Icon, href, bg, hoverBg }, i) => (
                <motion.a
                  key={i}
                  href={href}
                  whileHover={{ y: -5, scale: 1.08 }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-12 h-12 rounded-2xl ${bg} ${hoverBg} text-white flex items-center justify-center transition-all shadow-[0_10px_20px_rgba(0,0,0,0.35)]`}
                >
                  <Icon className="h-5 w-5" />
                </motion.a>
              ))}
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="mb-8 font-black text-white uppercase tracking-[0.2em] text-[10px]">{title}</h4>
              <ul className="space-y-5">
                {links.map((link) => (
                  <li key={link.name}>
                    <Link
                      to={link.href}
                      className="text-[13px] text-slate-500 font-bold transition-all hover:text-indigo-400 hover:translate-x-1 inline-block"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Footer */}
        <div className="mt-32 pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-8">
            <p className="text-xs text-slate-600 font-bold">© {new Date().getFullYear()} SalesmanChatbot.</p>
            <div className="flex gap-6">
              <Link to="/privacy-policy" className="text-[10px] text-slate-600 font-black uppercase tracking-widest hover:text-white transition-colors">{t("Privacy", "প্রাইভেসি")}</Link>
              <Link to="/terms-of-service" className="text-[10px] text-slate-600 font-black uppercase tracking-widest hover:text-white transition-colors">{t("Terms", "শর্তাবলী")}</Link>
            </div>
          </div>
          
          <div className="flex items-center gap-8 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all duration-700">
            <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 tracking-widest">
              <Shield className="w-3.5 h-3.5 text-emerald-500" /> SOC2 COMPLIANT
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 tracking-widest">
              <Zap className="w-3.5 h-3.5 text-yellow-500" /> SSL SECURED
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
