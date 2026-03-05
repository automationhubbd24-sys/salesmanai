import { motion, useScroll, useTransform } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, MessageCircle, Zap, Shield, LayoutDashboard, Users, MessageSquare, BarChart3, Settings, Search, Filter, Bell, ChevronDown, CheckCircle2, Image, MoreVertical, Send, Phone, Video, Info, UserPlus, Star, Clock, Globe, Smartphone, Languages, Camera } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const HeroSection = () => {
  const { t } = useLanguage();
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 500], [0, 200]);
  const y2 = useTransform(scrollY, [0, 500], [0, -150]);
  const trustedPages = [
    "Dhaka Fashion House",
    "BD Tech Hub",
    "Chittagong Electronics",
    "Global Gadget Store",
    "NYC Streetwear",
    "London Watch Co",
    "Tokyo Smart Shop",
    "Sylhet Mart",
    "Bangla Beauty Care",
    "Barishal Foods"
  ];
  const marqueeItems = Array(12).fill(trustedPages).flat();
  const marqueeItemsRev = [...marqueeItems].reverse();

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-start overflow-hidden pt-32 md:pt-48 pb-20 bg-background">
      {/* LazyChat Style Background */}
      <div className="absolute inset-0 z-0">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.03]" />
        
        {/* Large Purple Glow at the bottom */}
        <div className="absolute bottom-[-20%] left-1/2 -translate-x-1/2 w-[120%] h-[80%] bg-purple-600/20 blur-[150px] rounded-[100%]" />
        
        {/* Subtle top glow */}
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[80%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-[100%]" />
      </div>

      <div className="container relative z-10 mx-auto px-4 flex flex-col items-center text-center">
        {/* WhatsApp Wahub API Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Link 
            to="/dashboard/whatsapp" 
            className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-xs md:text-sm font-medium text-slate-300 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold">whatsapp</span>
            <span>wahub api →</span>
          </Link>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mb-8 text-4xl font-black tracking-tight text-foreground md:text-6xl lg:text-7xl leading-[1.1] max-w-5xl font-sans"
        >
          {t("Your #1 AI Sales Agent on", "আপনার #১ এআই সেলস এজেন্ট")}{" "}
          <span className="text-[#00A3FF]">Facebook</span>,{" "}
          <span className="text-[#E052A0]">Instagram</span> &{" "}
          <span className="text-[#4ADE80]">WhatsApp</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mb-12 max-w-2xl text-base text-muted-foreground md:text-lg leading-relaxed font-medium"
        >
          {t("Let", "সেলসম্যান")} Salesman<span className="text-[#A855F7] font-bold">Chatbot</span> {t("talk to your customers, take orders, and close sales; so you can finally focus on growing your business.", "চ্যাটবটকে আপনার কাস্টমারদের সাথে কথা বলতে দিন, অর্ডার নিতে দিন এবং সেলস ক্লোজ করতে দিন; যাতে আপনি আপনার ব্যবসা বৃদ্ধিতে মনোযোগ দিতে পারেন।")}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="w-screen mb-16"
          style={{ marginLeft: "calc(50% - 50vw)", marginRight: "calc(50% - 50vw)" }}
        >
          <div className="mx-auto" style={{ maxWidth: "min(1950px, calc(120vw - 1rem))" }}>
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="text-center space-y-6">
              <div className="text-xs md:text-sm font-black uppercase tracking-widest text-slate-300">
                {t("Trusted by", "ভরসা করেন")}
              </div>
              <div className="space-y-3">
                <div className="overflow-hidden">
                  <motion.div
                    className="flex gap-3 md:gap-4 whitespace-nowrap"
                    animate={{ x: ["0%", "-50%"] }}
                    transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                  >
                    {[...marqueeItems, ...marqueeItems].map((name, i) => (
                      <span
                        key={`r1-${i}`}
                        className="px-3 md:px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs md:text-sm font-bold text-slate-200"
                      >
                        {name}
                      </span>
                    ))}
                  </motion.div>
                </div>
                <div className="overflow-hidden">
                  <motion.div
                    className="flex gap-3 md:gap-4 whitespace-nowrap"
                    animate={{ x: ["-50%", "0%"] }}
                    transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                  >
                    {[...marqueeItemsRev, ...marqueeItemsRev].map((name, i) => (
                      <span
                        key={`r2-${i}`}
                        className="px-3 md:px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs md:text-sm font-bold text-slate-200"
                      >
                        {name}
                      </span>
                    ))}
                  </motion.div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </motion.div>

        {/* Dashboard Preview Container */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="relative w-full max-w-6xl mx-auto px-4"
        >
          <div className="relative group">
          {/* Dashboard Glow */}
          <motion.div 
            animate={{ 
              opacity: [0, 1, 0],
              scale: [0.8, 1.2, 0.8],
            }}
            transition={{ 
              duration: 3, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            className="absolute -inset-20 bg-purple-600/40 blur-[120px] rounded-full" 
          />
          
          <div className="relative bg-card/30 border border-border rounded-3xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.2)] backdrop-blur-xl">
            {/* Top Bar */}
            <div className="h-14 bg-card/40 border-b border-border flex items-center px-4 md:px-6 justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-muted/20 px-3 py-1.5 rounded-lg border border-border">
                  <div className="w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
                    <Sparkles className="w-2.5 h-2.5 text-white" />
                  </div>
                  <span className="text-xs font-bold text-foreground">A Shopping Page</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </div>
              </div>
              
              <div className="flex items-center gap-4 md:gap-6">
                <div className="hidden md:flex items-center gap-3">
                  <div className="relative">
                    <Bell className="w-5 h-5 text-slate-400" />
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-purple-600 rounded-full text-[10px] flex items-center justify-center font-bold text-white">48</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-3 py-1 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] md:text-xs font-bold text-green-500">Available</span>
                  <ChevronDown className="w-3 h-3 text-green-500/50" />
                </div>
                <Button className="h-8 px-4 text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white rounded-lg" asChild>
                  <Link to="/login">{t("Get Started", "শুরু করুন")}</Link>
                </Button>
              </div>
            </div>

            {/* Dashboard Content */}
            <div className="flex h-[400px] md:h-[600px]">
              {/* Left Thin Sidebar */}
              <div className="w-14 md:w-16 border-r border-white/5 bg-white/[0.01] flex flex-col items-center py-6 gap-6">
                <div className="w-8 h-8 rounded-xl bg-purple-600 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="flex flex-col gap-6 mt-4">
                  <LayoutDashboard className="w-5 h-5 text-slate-400 hover:text-white transition-colors cursor-pointer" />
                  <Users className="w-5 h-5 text-slate-400 hover:text-white transition-colors cursor-pointer" />
                  <MessageSquare className="w-5 h-5 text-purple-500" />
                  <BarChart3 className="w-5 h-5 text-slate-400 hover:text-white transition-colors cursor-pointer" />
                  <Star className="w-5 h-5 text-slate-400 hover:text-white transition-colors cursor-pointer" />
                </div>
                <div className="mt-auto flex flex-col gap-6 mb-4">
                  <Settings className="w-5 h-5 text-slate-400 hover:text-white transition-colors cursor-pointer" />
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600" />
                </div>
              </div>

              {/* Middle Section: Chat Interface */}
              <div className="flex-1 flex flex-col md:flex-row min-w-0">
                {/* Contact List (Desktop Only) */}
                <div className="hidden lg:flex w-80 flex-col border-r border-white/5 bg-white/[0.01]">
                  <div className="p-4 border-b border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/10 border border-purple-500/20 rounded-lg text-xs font-bold text-purple-400">
                        All Contacts <span className="bg-purple-600/20 px-1.5 py-0.5 rounded ml-1">538</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-[10px] text-slate-500 font-bold uppercase">Order Requests <span className="ml-1">12</span></div>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input 
                        type="text" 
                        placeholder="Search" 
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500/50"
                      />
                      <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {[
                      { name: "Sajal Akand", msg: "Sajal, 01894927244, house 117b road 30 gul...", time: "5min ago", active: true, platform: "WA", labels: ["Priority", "Top Client", "High Prospect"] },
                      { name: "গোলাম রাব্বি", msg: "Etar ki ki model ase?", time: "20min ago", active: false, platform: "FB", labels: ["Risky", "Low Prospect"] },
                      { name: "Mostofa Ahmed", msg: "AI : Apnar order confirm korte ami apnar pr...", time: "40min ago", active: false, platform: "IG", labels: ["Priority", "Successful"] },
                      { name: "Habibullah Bahar", msg: "AI : SAIBEI F71 er kono model er infor...", time: "1hr ago", active: false, platform: "FB", labels: ["Priority", "Attention", "High Prospect"] }
                    ].map((contact, i) => (
                      <div key={i} className={`p-3 rounded-2xl flex gap-3 cursor-pointer transition-all ${contact.active ? 'bg-white/5 border border-white/10' : 'hover:bg-white/[0.02]'}`}>
                        <div className="relative">
                          <div className="w-10 h-10 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-400">
                            {contact.name.charAt(0)}
                          </div>
                          <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#0b0c10] flex items-center justify-center ${
                            contact.platform === 'WA' ? 'bg-green-500' : contact.platform === 'FB' ? 'bg-blue-500' : 'bg-pink-500'
                          }`}>
                            {contact.platform === 'WA' ? <Phone className="w-2 h-2 text-white" /> : <MessageSquare className="w-2 h-2 text-white" />}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-bold text-white truncate">{contact.name}</span>
                            <span className="text-[10px] text-slate-500">{contact.time}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mb-2">{contact.msg}</p>
                          <div className="flex flex-wrap gap-1">
                            {contact.labels.map((label, li) => (
                              <span key={li} className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
                                label === 'Priority' ? 'bg-purple-600/20 text-purple-400' :
                                label === 'Top Client' ? 'bg-blue-600/20 text-blue-400' :
                                label === 'High Prospect' ? 'bg-orange-600/20 text-orange-400' :
                                'bg-slate-600/20 text-slate-400'
                              }`}>
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                        {contact.active && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Main Chat Area */}
                <div className="flex-1 flex flex-col bg-white/[0.01]">
                  <div className="h-14 border-b border-white/5 px-3 sm:px-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-400">S</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">Sajal Akand</span>
                          <UserPlus className="w-3 h-3 text-slate-500" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          <span className="text-[10px] text-slate-500">Active now</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4">
                      <Phone className="w-4 h-4 text-slate-400 cursor-pointer" />
                      <Video className="w-4 h-4 text-slate-400 cursor-pointer" />
                      <div className="w-px h-4 bg-white/10" />
                      <MoreVertical className="w-4 h-4 text-slate-400 cursor-pointer" />
                    </div>
                  </div>

                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="flex flex-col gap-1 max-w-[80%]">
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-xs text-white">
                        Sajal, 01894927244, house 117b road 30 gul...
                      </div>
                      <span className="text-[10px] text-slate-500 ml-2">11:40am</span>
                    </div>

                    <div className="flex flex-col items-end gap-1 ml-auto max-w-[80%]">
                      <div className="bg-purple-600/20 border border-purple-500/30 rounded-2xl p-4 text-xs text-white relative">
                        <div className="flex items-center gap-2 mb-2 text-purple-400 font-bold italic">
                          <Sparkles className="w-3 h-3" /> AI Replied
                        </div>
                        আপনি The Neutral Edition - White Half Zip x Coffee Pant অর্ডার করতে চান, দয়া করে আপনার পুরো নাম, ফোন নম্বর, ডেলিভারি ঠিকানা এবং কতটি অর্ডার করবেন তা জানান
                      </div>
                      <span className="text-[10px] text-slate-500 mr-2">11:41am · Replied by Salesman AI ✨</span>
                    </div>

                    <div className="flex flex-col gap-1 max-w-[80%]">
                      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden max-w-[240px]">
                        <img src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=400" alt="Product" className="w-full aspect-square object-cover" />
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-xs text-white mt-1">
                        Eta order korbo
                      </div>
                      <span className="text-[10px] text-slate-500 ml-2">Thursday 11:40am</span>
                    </div>
                  </div>

                  {/* Input Area */}
                  <div className="p-4 bg-white/[0.02] border-t border-white/5">
                    <div className="bg-white/5 border border-white/10 rounded-2xl flex items-center p-2">
                      <div className="flex items-center gap-2 px-2 border-r border-white/10 mr-2">
                        <Image className="w-5 h-5 text-slate-500 cursor-pointer hover:text-white" />
                        <MessageSquare className="w-5 h-5 text-slate-500 cursor-pointer hover:text-white" />
                      </div>
                      <input 
                        type="text" 
                        placeholder="Type your message..." 
                        className="flex-1 bg-transparent border-none text-xs text-white focus:outline-none placeholder:text-slate-600"
                      />
                      <div className="w-8 h-8 rounded-xl bg-purple-600 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.4)] cursor-pointer hover:scale-105 transition-transform">
                        <Send className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Panel (Desktop Only) */}
                <div className="hidden xl:flex w-72 flex-col border-l border-white/5 bg-white/[0.01]">
                  <div className="p-4 space-y-6 overflow-y-auto custom-scrollbar">
                    {/* Order Actions */}
                    <div className="space-y-3">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Order Actions</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Link to="/dashboard/whatsapp/orders" className="bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-xl text-[10px] font-bold text-white transition-colors text-center">Manage Orders</Link>
                        <Link to="/dashboard/whatsapp/control" className="bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-xl text-[10px] font-bold text-white transition-colors text-center">Create Orders</Link>
                      </div>
                    </div>

                    {/* Panels */}
                    {[
                      { title: "Contact Details", icon: <ChevronDown className="w-3 h-3" /> },
                      { title: "Tags", icon: <UserPlus className="w-3 h-3" />, hasAdd: true },
                      { title: "Notes for the customer", icon: <ChevronDown className="w-3 h-3" />, count: 69 },
                      { title: "Conversation Summary", icon: <ChevronDown className="w-3 h-3" /> },
                      { title: "Activity List", icon: <Clock className="w-3 h-3" />, hasLink: "See all" },
                      { title: "Shared Files", icon: <Clock className="w-3 h-3" />, hasLink: "See all" }
                    ].map((panel, i) => (
                      <div key={i} className="border-t border-white/5 pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{panel.title}</span>
                            {panel.count && <span className="text-[8px] bg-purple-600/20 text-purple-400 px-1 rounded-full">{panel.count}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {panel.hasLink && <span className="text-[8px] text-purple-500 font-bold cursor-pointer">{panel.hasLink}</span>}
                            {panel.hasAdd && <UserPlus className="w-3 h-3 text-slate-500 cursor-pointer" />}
                            {panel.icon}
                          </div>
                        </div>
                        {panel.title === "Activity List" && (
                          <div className="space-y-3">
                            {[
                              { label: "Your details", desc: "Please provide your name and email", done: true },
                              { label: "Company details", desc: "A few details about your company", done: true },
                              { label: "Invite your team", desc: "Start collaborating with your team", done: true },
                              { label: "Add your socials", desc: "Share posts to your social accounts", done: false }
                            ].map((item, ii) => (
                              <div key={ii} className="flex gap-3">
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${item.done ? 'bg-purple-600 border-purple-600' : 'border-white/20'}`}>
                                  {item.done && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[10px] font-bold text-white">{item.label}</div>
                                  <div className="text-[8px] text-slate-500 truncate">{item.desc}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
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

export default HeroSection;
