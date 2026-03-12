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
  const { language, setLanguage, t } = useLanguage();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
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

  const navPos = isOpen ? "left-0 right-0 mx-auto" : "left-1/2 -translate-x-1/2";

  return (
    <nav className={`fixed top-4 ${navPos} z-50 w-[95%] max-w-7xl transition-all duration-500`}>
      <div className={cn(
        "relative flex h-20 items-center justify-between px-8 rounded-2xl border border-white/5 transition-all duration-500",
        scrolled ? "bg-black/80 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)]" : "bg-black/40 backdrop-blur-md"
      )}>
        <Link to="/" className="flex items-center group relative z-50">
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
              onClick={() => scrollToSection('pricing-by-system')}
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
            <Link to="/login">{t("Get Started", "শুরু করুন")}</Link>
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="lg:hidden text-white p-2"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Navigation */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm lg:hidden z-40"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 60 }}
              className="fixed top-20 right-4 left-auto w-[85%] max-w-sm bg-[#0b0b0b]/90 border border-white/10 rounded-2xl p-4 lg:hidden z-50 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            >
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => scrollToSection('services')}
                  className="text-left text-slate-300 text-[13px] font-bold p-3 hover:bg-white/5 rounded-xl transition-all"
                >
                  {t("Solutions", "সলিউশনস")}
                </button>
                <button 
                  onClick={() => scrollToSection('detailed')}
                  className="text-left text-slate-300 text-[13px] font-bold p-3 hover:bg-white/5 rounded-xl transition-all"
                >
                  {t("Features", "ফিচারসমূহ")}
                </button>
                <button 
                  onClick={() => scrollToSection('pricing-by-system')}
                  className="text-left text-slate-300 text-[13px] font-bold p-3 hover:bg-white/5 rounded-xl transition-all"
                >
                  {t("Pricing", "প্রাইসিং")}
                </button>
                <button 
                  onClick={() => scrollToSection('footer')}
                  className="text-left text-slate-300 text-[13px] font-bold p-3 hover:bg-white/5 rounded-xl transition-all"
                >
                  {t("Contacts", "যোগাযোগ")}
                </button>
                <button 
                  onClick={() => scrollToSection('how')}
                  className="text-left text-slate-300 text-[13px] font-bold p-3 hover:bg-white/5 rounded-xl transition-all"
                >
                  {t("Resources", "রিসোর্স")}
                </button>
                <Button className="w-full h-11 bg-[#00ff88] hover:bg-[#00f07f] text-black rounded-full font-bold shadow-[0_8px_24px_rgba(0,255,136,0.2)] transition-all hover:scale-[1.01] active:scale-95 flex items-center justify-center gap-2 self-stretch" asChild>
                  <Link to="/login" onClick={() => setIsOpen(false)}>
                    {t("Get Started", "শুরু করুন")}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
