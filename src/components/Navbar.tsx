import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, ChevronDown, Globe, Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);

    // Check login status
    const token = localStorage.getItem("auth_token");
    setIsLoggedIn(!!token);

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    if (location.pathname !== "/") {
      window.location.href = `/#${id}`;
      return;
    }
    const element = document.getElementById(id);
    if (element) {
      const offset = 100; // Account for fixed navbar
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = element.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
      setIsOpen(false);
    }
  };

  const features = [
    { title: t("AI Agent", "এআই এজেন্ট"), desc: t("Automated customer service", "স্বয়ংক্রিয় গ্রাহক সেবা"), link: "/dashboard/whatsapp/control" },
    { title: t("Automation", "অটোমেশন"), desc: t("Save time with chat", "সময় বাঁচানো চ্যাট"), link: "/dashboard/whatsapp/settings" },
    { title: t("Lead Generation", "লিড জেনারেশন"), desc: t("Capture leads easily", "লিড ক্যাপচার করুন"), link: "/dashboard/whatsapp/database" },
    { title: t("Sales Tools", "সেলস টুলস"), desc: t("Order automation", "অর্ডার অটোমেশন"), link: "/dashboard/whatsapp/orders" },
  ];

  const integrations = [
    { title: t("Facebook Messenger", "ফেসবুক মেসেঞ্জার"), desc: t("Sell on Messenger", "মেসেঞ্জারে বিক্রি"), link: "/dashboard/messenger" },
    { title: t("WhatsApp", "হোয়াটসঅ্যাপ"), desc: t("AI Chat Support", "এআই চ্যাট সাপোর্ট"), link: "/dashboard/whatsapp" },
    { title: t("Instagram", "ইনস্টাগ্রাম"), desc: t("DM Automation", "ডিএম অটোমেশন"), link: "/dashboard/messenger/settings" },
  ];

  const accentColor = location.pathname === "/" ? "#00ff88" : "#A855F7";

  return (
    <nav className={cn(
      "fixed top-0 left-0 right-0 z-[100] transition-all duration-500 px-3 pt-3 sm:px-4 md:px-6 md:pt-6",
      scrolled ? "translate-y-0" : "translate-y-0"
    )}>
      <div className={cn(
        "mx-auto max-w-7xl flex items-center justify-between gap-2 px-3 sm:px-5 md:px-8 h-14 sm:h-16 md:h-20 rounded-2xl border border-white/10 transition-all duration-500",
        scrolled ? "bg-black/90 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-white/15" : "bg-black/70 backdrop-blur-xl"
      )}>
        <Link to="/" className="flex items-center group relative z-50 scale-[0.78] sm:scale-90 md:scale-100 origin-left min-w-0">
          <Logo size="md" accentColor={accentColor} />
          {/* Logo Glow */}
          <div
            className="absolute -inset-6 blur-[40px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
            style={{ backgroundColor: accentColor, opacity: 0.2 }}
          />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-8 lg:flex">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => scrollToSection('services')}
              className="text-[13px] font-bold text-slate-300 hover:text-white transition-colors px-4 py-2"
            >
              {t("Solutions", "সলিউশনস")}
            </button>
            
            <NavigationMenu className="max-w-none">
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger 
                    onClick={() => scrollToSection('detailed')}
                    className="bg-transparent text-slate-300 hover:text-white transition-colors font-bold text-[13px] hover:bg-white/5 px-4 rounded-xl h-10 data-[state=open]:bg-white/5"
                  >
                    {t("Features", "ফিচারসমূহ")}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[550px] gap-4 p-8 bg-[#000000]/95 backdrop-blur-2xl border border-white/5 rounded-[2.5rem] shadow-[0_20px_80px_rgba(0,0,0,0.5)]">
                      <div className="grid grid-cols-2 gap-4">
                        {features.map((item) => (
                          <Link
                            key={item.title}
                            to={item.link}
                            className="group block rounded-[1.5rem] p-5 hover:bg-white/5 border border-transparent hover:border-white/5 transition-all"
                          >
                            <div className="flex items-center gap-3 mb-1">
                              <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-all">
                                <Zap className="w-4 h-4" />
                              </div>
                              <div className="font-black text-white uppercase tracking-tight text-[13px]">{item.title}</div>
                            </div>
                            <div className="text-[11px] text-slate-500 font-bold leading-relaxed ml-11">{item.desc}</div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>

            <button 
              onClick={() => scrollToSection('pricing')}
              className="text-[13px] font-bold text-slate-300 hover:text-white transition-colors px-4 py-2"
            >
              {t("Pricing", "প্রাইসিং")}
            </button>

            <button 
              onClick={() => scrollToSection('footer')}
              className="text-[13px] font-bold text-slate-300 hover:text-white transition-colors px-4 py-2"
            >
              {t("Contacts", "যোগাযোগ")}
            </button>

            <NavigationMenu className="max-w-none">
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger 
                    onClick={() => scrollToSection('how')}
                    className="bg-transparent text-slate-300 hover:text-white transition-colors font-bold text-[13px] hover:bg-white/5 px-4 rounded-xl h-10 data-[state=open]:bg-white/5"
                  >
                    {t("Resources", "রিসোর্স")}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[200px] gap-2 p-4 bg-[#000000]/95 backdrop-blur-2xl border border-white/5 rounded-2xl shadow-[0_20px_80px_rgba(0,0,0,0.5)]">
                      <Link to="/dashboard/api" className="block p-3 text-sm font-bold text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all">
                        Developer API
                      </Link>
                      <button 
                        onClick={() => scrollToSection('faq')}
                        className="w-full text-left block p-3 text-sm font-bold text-slate-300 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                      >
                        Help Center (FAQ)
                      </button>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>
        </div>

        <div className="hidden items-center gap-4 lg:flex">
          <Button 
            className="h-11 px-6 text-sm font-bold bg-[#00ff88] hover:bg-[#00f07f] text-black rounded-full shadow-[0_10px_30px_rgba(0,255,136,0.25)] transition-all hover:scale-105 active:scale-95"
            asChild
          >
            <Link to={isLoggedIn ? "/dashboard/whatsapp/control" : "/register"}>
              {isLoggedIn ? t("Dashboard", "ড্যাশবোর্ড") : t("Get Started", "শুরু করুন")}
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-2 lg:hidden shrink-0">
          <Button
            className="h-10 px-4 text-xs sm:text-sm font-black bg-[#00ff88] hover:bg-[#00f07f] text-black rounded-full shadow-[0_10px_30px_rgba(0,255,136,0.25)] active:scale-95"
            asChild
          >
            <Link to={isLoggedIn ? "/dashboard/whatsapp/control" : "/register"}>
              {isLoggedIn ? t("Dashboard", "ড্যাশবোর্ড") : t("Get", "শুরু")}
            </Link>
          </Button>

          {/* Mobile Menu Button */}
          <button
            className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white/10 border border-white/15 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-all active:scale-90 hover:bg-white/15"
            onClick={() => setIsOpen(!isOpen)}
            aria-label={isOpen ? "Close menu" : "Open menu"}
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: "100%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-[120] bg-black/95 backdrop-blur-3xl lg:hidden h-[100dvh] w-screen overflow-hidden"
          >
            <div className="flex flex-col h-full p-4 sm:p-6 md:p-10">
              <div className="flex items-center justify-between mb-6 sm:mb-10">
                <Logo size="md" accentColor={accentColor} />
                <button
                  className="w-11 h-11 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white transition-all active:scale-90"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex flex-col gap-1 sm:gap-2 overflow-y-auto custom-scrollbar flex-1 pb-6">
                <div className="text-[10px] font-black text-[#00ff88] uppercase tracking-[0.3em] mb-3 sm:mb-4 px-4 py-1 bg-[#00ff88]/5 rounded-full w-fit">Navigation</div>
                {[
                  { label: t("Solutions", "সলিউশনস"), id: 'services' },
                  { label: t("Features", "ফিচারসমূহ"), id: 'detailed' },
                  { label: t("Pricing", "প্রাইসিং"), id: 'pricing' },
                  { label: t("Contacts", "যোগাযোগ"), id: 'footer' },
                  { label: t("Resources", "রিসোর্স"), id: 'how' },
                ].map((item, idx) => (
                  <motion.button
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + idx * 0.05 }}
                    key={item.id}
                    onClick={() => scrollToSection(item.id)}
                    className="w-full text-left text-white text-2xl sm:text-3xl font-black py-4 sm:py-5 px-4 hover:bg-[#00ff88]/10 rounded-[1.5rem] transition-all active:scale-95 flex items-center justify-between group"
                  >
                    <span className="group-hover:translate-x-3 transition-transform duration-500">{item.label}</span>
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-[#00ff88] group-hover:text-black transition-all duration-500">
                        <ArrowRight className="w-5 h-5" />
                    </div>
                  </motion.button>
                ))}
              </div>

              <div className="pt-5 sm:pt-8 border-t border-white/10 space-y-5 sm:space-y-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center justify-between px-4">
                  <div className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Switch Language</div>
                  <div className="flex gap-2 p-1 bg-white/5 rounded-2xl border border-white/5">
                    <button 
                      onClick={() => setLanguage('en')}
                      className={cn(
                        "h-10 px-6 rounded-xl font-black text-xs transition-all duration-300",
                        language === 'en' ? "bg-[#00ff88] text-black shadow-[0_5px_20px_rgba(0,255,136,0.3)]" : "text-white/40"
                      )}
                    >
                      EN
                    </button>
                    <button 
                      onClick={() => setLanguage('bn')}
                      className={cn(
                        "h-10 px-6 rounded-xl font-black text-xs transition-all duration-300",
                        language === 'bn' ? "bg-[#00ff88] text-black shadow-[0_5px_20px_rgba(0,255,136,0.3)]" : "text-white/40"
                      )}
                    >
                      BN
                    </button>
                  </div>
                </div>

                <Button 
                  className="w-full h-16 bg-[#00ff88] hover:bg-[#00f07f] text-black rounded-3xl font-black text-xl shadow-[0_20px_50px_rgba(0,255,136,0.3)] transition-all active:scale-95 flex items-center justify-center gap-4 group" 
                  asChild
                >
                  <Link to={isLoggedIn ? "/dashboard/whatsapp/control" : "/register"} onClick={() => setIsOpen(false)}>
                    {isLoggedIn ? t("Dashboard", "ড্যাশবোর্ড") : t("Get Started", "শুরু করুন")}
                    <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
                  </Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
