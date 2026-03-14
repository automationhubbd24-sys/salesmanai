import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Zap,
  MessageSquare,
  Smartphone,
  Globe,
  CheckCircle2,
  Star,
  MessageCircle,
  Disc as Discord,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const Index = () => {
  const { t } = useLanguage();
  const [supportOpen, setSupportOpen] = useState(false);

  useEffect(() => {
    document.title = "Automation Hub BD — Automate Growth with AI Chatbots";
    const metaDesc = document.querySelector('meta[name="description"]') || document.createElement('meta');
    metaDesc.setAttribute('name', 'description');
    metaDesc.setAttribute('content', 'Automation Hub BD helps business owners automate chat, orders, and growth with modern AI and automation tools.');
    document.head.appendChild(metaDesc);
    const metaOg = document.querySelector('meta[property="og:title"]') || document.createElement('meta');
    metaOg.setAttribute('property', 'og:title');
    metaOg.setAttribute('content', 'Automation Hub BD');
    document.head.appendChild(metaOg);
    const metaViewport = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
    metaViewport.setAttribute('name', 'viewport');
    metaViewport.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
    document.head.appendChild(metaViewport);
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white selection:bg-[#00ff88] selection:text-black relative overflow-x-hidden scroll-smooth">
      <Navbar />

      <div className="fixed bottom-6 right-10 z-[60]">
        {supportOpen ? (
          <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-[240px]">
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
            <div className="mt-3 flex items-center gap-3">
              <a
                href="https://wa.me/8801956871403"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/512/733/733585.png"
                  alt="WhatsApp"
                  className="w-7 h-7"
                />
              </a>
              <a
                href="https://discord.gg/KEDXD7Ma4S"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/512/5968/5968756.png"
                  alt="Discord"
                  className="w-7 h-7"
                />
              </a>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setSupportOpen(true)}
            className="flex items-center justify-center rounded-full bg-[#00ff88] text-black w-12 h-12 shadow-[0_12px_30px_rgba(0,255,136,0.25)] hover:shadow-[0_14px_36px_rgba(0,255,136,0.35)] transition-transform hover:scale-[1.03] active:scale-95"
            aria-label="Get Support"
          >
            <MessageCircle className="w-5 h-5" />
          </button>
        )}
      </div>

      <main className="relative">
        <section id="hero" className="pt-28 pb-16 px-4 md:pt-36 md:pb-20">
          <div className="max-w-6xl mx-auto text-center">
            <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight">
              {t("Automation Hub BD", "অটোমেশন হাব বিডি")}
            </h1>
            <p className="mt-4 text-sm md:text-base text-gray-400 max-w-2xl mx-auto">
              {t(
                "Automate sales and support using WhatsApp, Messenger and an OpenAI‑compatible API.",
                "WhatsApp, Messenger এবং OpenAI‑compatible API দিয়ে সহজভাবে সেলস ও সাপোর্ট অটোমেট করুন।"
              )}
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/login"
                className="inline-flex h-11 px-6 items-center justify-center rounded-xl bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:shadow-[0_12px_36px_rgba(0,255,136,0.35)] transition-transform hover:scale-[1.02] active:scale-95"
              >
                Get Started
              </Link>
              <a
                href="https://webhook.salesmanchatbot.online/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 px-6 items-center justify-center rounded-xl border border-gray-700 text-white hover:border-[#00ff88] hover:text-[#00ff88] transition-colors"
              >
                See Demo
              </a>
            </div>
          </div>
        </section>

        <section id="services" className="py-14 px-4">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { Icon: MessageSquare, title: t("WhatsApp Automation", "WhatsApp অটোমেশন"), desc: t("Sessions, webhooks, auto‑reply, handover locks.", "Session, webhook, auto‑reply, handover lock — সব এক জায়গায়।") },
                { Icon: Smartphone, title: t("Messenger Automation", "Messenger অটোমেশন"), desc: t("Facebook/Instagram pages, team sharing.", "Facebook/Instagram pages, team sharing, পরিষ্কার অপারেশন।") },
                { Icon: Globe, title: t("OpenAI‑Compatible API", "OpenAI‑Compatible API"), desc: t("OpenAI-style endpoint with streaming and model routes.", "OpenAI style endpoint, streaming, model routes — ডেভ‑ফ্রেন্ডলি।") },
                { Icon: Zap, title: t("Products & WooCommerce", "প্রোডাক্টস ও WooCommerce"), desc: t("Catalog CRUD, import, search in chat.", "Catalog CRUD, import, search — চ্যাটে দ্রুত উত্তর ও অর্ডার।") },
              ].map((item, i) => (
                <div key={i} className="group rounded-2xl border border-gray-800 bg-[#101010] p-6 hover:border-[#00ff88] transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-[#00ff88]/15 text-[#00ff88] flex items-center justify-center mb-4">
                    <item.Icon className="w-5 h-5" />
                  </div>
                  <div className="font-bold">{item.title}</div>
                  <div className="mt-2 text-sm text-gray-400">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="detailed" className="py-14 px-4">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: t("WhatsApp Automation", "WhatsApp অটোমেশন"),
                desc: t(
                  "Create/start/stop sessions, QR or pairing, webhooks to auto-reply, handover locks to control admin vs AI.",
                  "Session create/start/stop, QR বা pairing, webhook‑এ auto‑reply, handover lock দিয়ে admin vs AI নিয়ন্ত্রণ।"
                ),
                points: [
                  t("Session lifecycle with WAHA", "WAHA দিয়ে session lifecycle"),
                  t("Echo guard and backlog filtering", "Echo guard ও backlog filtering"),
                  t("Contacts, labels, locks", "Contacts, labels, locks")
                ]
              },
              {
                title: t("OpenAI‑Compatible API", "OpenAI‑Compatible API"),
                desc: t(
                  "OpenAI-style /v1/chat/completions, streaming responses, token-based usage and pricing.",
                  "OpenAI‑style /v1/chat/completions, streaming response, token‑ভিত্তিক usage ও pricing।"
                ),
                points: [
                  t("Lite & Pro engines (Groq/OpenRouter)", "Lite ও Pro engine (Groq/OpenRouter)"),
                  t("Vision and audio support", "Vision ও audio সাপোর্ট"),
                  t("Usage analytics and balance deduction", "Usage analytics ও balance deduction")
                ]
              },
              {
                title: t("Product Catalog & WooCommerce", "প্রোডাক্ট ক্যাটালগ ও WooCommerce"),
                desc: t(
                  "Manage catalog with image upload, import from WooCommerce, and answer product queries in chat.",
                  "ইমেজ আপলোডসহ ক্যাটালগ ম্যানেজ, WooCommerce থেকে ইম্পোর্ট, আর চ্যাটে প্রোডাক্ট‑সম্পর্কিত উত্তর।"
                ),
                points: [
                  t("CRUD with search", "CRUD ও সার্চ"),
                  t("Access gating via credits/sessions/pages", "Credits/sessions/pages দিয়ে access gating"),
                  t("Chat‑ready responses", "চ্যাট‑রেডি উত্তর")
                ]
              }
            ].map((f, i) => (
              <div key={i} className="rounded-2xl border border-gray-800 bg-[#101010] p-6">
                <div className="font-bold">{f.title}</div>
                <div className="mt-2 text-sm text-gray-400">{f.desc}</div>
                <div className="mt-4 space-y-2">
                  {f.points.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />
                      <span className="text-sm text-gray-300">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="py-14 px-4">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { step: "01", title: "Connect", desc: "Link your pages and WhatsApp in minutes." },
              { step: "02", title: "Automate", desc: "Turn on chatflows, order capture, follow‑ups." },
              { step: "03", title: "Grow", desc: "Track conversions and scale confidently." },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl border border-gray-800 bg-[#101010] p-6">
                <div className="text-[#00ff88] font-black text-sm">{s.step}</div>
                <div className="mt-2 font-bold">{s.title}</div>
                <div className="mt-2 text-sm text-gray-400">{s.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="benefits" className="py-14 px-4">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              {[
                "Respond 24/7 — never miss a lead",
                "Reduce support load up to 60%",
                "Capture orders directly in chat",
                "Increase conversion with follow‑ups",
                "Simple setup, zero code",
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#00ff88]" />
                  <span className="text-sm text-gray-300">{b}</span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-gray-800 bg-[#101010] p-6">
              <div className="font-bold">Built for Business Owners</div>
              <div className="mt-2 text-sm text-gray-400">Clean interface, premium feel, and conversion‑first UX.</div>
            </div>
          </div>
        </section>

        <section id="testimonials" className="py-14 px-4">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: "Retail Founder", text: "Order automation boosted our conversions without extra staff." },
              { name: "DTC Brand", text: "WhatsApp + Messenger unified inbox saved serious time." },
              { name: "SME Owner", text: "Setup took minutes. The green UI looks premium and converts." },
            ].map((tItem, i) => (
              <div key={i} className="rounded-2xl border border-gray-800 bg-[#101010] p-6">
                <div className="flex items-center gap-2 text-[#00ff88]">
                  <Star className="w-4 h-4" />
                  <Star className="w-4 h-4" />
                  <Star className="w-4 h-4" />
                  <Star className="w-4 h-4" />
                </div>
                <div className="mt-3 text-sm text-gray-300">{tItem.text}</div>
                <div className="mt-2 text-xs text-gray-500">{tItem.name}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing plans removed */}

        <section id="pricing-by-system" className="py-14 px-4">
          <div className="max-w-6xl mx-auto">
            <div className="mb-8 text-center">
              <h3 className="text-2xl md:text-3xl font-black tracking-tight">
                {t("Pricing by System", "সিস্টেমভিত্তিক প্রাইসিং")}
              </h3>
              <p className="mt-2 text-sm text-gray-400">
                {t("Clear breakdown for WhatsApp, Messenger and API usage.", "WhatsApp, Messenger এবং API ব্যবহারের স্পষ্ট ব্রেকডাউন।")}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="group rounded-2xl border border-gray-800 bg-gradient-to-br from-[#0f1f17] to-[#101010] p-6 flex flex-col shadow-sm hover:border-[#00ff88] hover:shadow-[0_8px_30px_rgba(0,255,136,0.12)] transition-all min-h-[520px]">
                <div className="font-bold">{t("WhatsApp", "WhatsApp")}</div>
                <div className="mt-2 text-sm text-gray-400">{t("Sessions + Messages", "সেশন + মেসেজ")}</div>
                <div className="mt-4 rounded-2xl border border-gray-800 bg-[#0d0d0d]">
                  <div className="grid grid-cols-[1fr,auto] gap-3 p-4 text-xs text-gray-400">
                    <div>{t("Resource", "রিসোর্স")}</div>
                    <div>{t("Price", "প্রাইস")}</div>
                  </div>
                  <div className="px-4 pb-4 space-y-6">
                    <div className="space-y-2">
                      <div className="text-xs font-black uppercase tracking-widest text-gray-400">{t("Session Fees", "সেশন ফি")}</div>
                      <div className="divide-y divide-gray-800 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr,auto] items-center p-3 bg-[#0b0b0b]">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("WEBJS Engine — 2d", "WEBJS ইঞ্জিন — ২ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳200</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("WEBJS Engine — 30d", "WEBJS ইঞ্জিন — ৩০ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳2000</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("WEBJS Engine — 60d", "WEBJS ইঞ্জিন — ৬০ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳3500</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("WEBJS Engine — 90d", "WEBJS ইঞ্জিন — ৯০ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳4000</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3 bg-[#0b0b0b]">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("NOWEB Engine — 2d", "NOWEB ইঞ্জিন — ২ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳100</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("NOWEB Engine — 30d", "NOWEB ইঞ্জিন — ৩০ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳500</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("NOWEB Engine — 60d", "NOWEB ইঞ্জিন — ৬০ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳900</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("NOWEB Engine — 90d", "NOWEB ইঞ্জিন — ৯০ দিন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳1500</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-black uppercase tracking-widest text-gray-400">{t("Messages", "মেসেজ")}</div>
                      <div className="divide-y divide-gray-800 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr,auto] items-center p-3 bg-[#0b0b0b]">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>1k {t("messages", "মেসেজ")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳400</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>5k {t("messages", "মেসেজ")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳1,500</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>10k {t("messages", "মেসেজ")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳2,500</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">{t("Usage billed from API balance", "ইউসেজ API ব্যালেন্স থেকে কাটে")}</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {[t("Webhook automation with echo guard", "Webhook অটোমেশন ও echo guard"), t("Handover locks and team sharing", "Handover lock ও team sharing"), t("QR or pairing code setup", "QR বা pairing code সেটআপ")].map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />
                      <span className="text-sm text-gray-300">{p}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto pt-6">
                  <a href="/login" className="inline-flex h-11 px-6 items-center justify-center rounded-xl bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:shadow-[0_12px_36px_rgba(0,255,136,0.35)] transition-transform hover:scale-[1.02] active:scale-95 w-full">Choose Plan</a>
                </div>
              </div>

              <div className="group rounded-2xl border border-gray-800 bg-gradient-to-br from-[#0f1f17] to-[#101010] p-6 flex flex-col shadow-sm hover:border-[#00ff88] hover:shadow-[0_8px_30px_rgba(0,255,136,0.12)] transition-all min-h-[520px]">
                <div className="font-bold">{t("Messenger", "Messenger")}</div>
                <div className="mt-4 rounded-2xl border border-gray-800 bg-[#0d0d0d]">
                  <div className="grid grid-cols-[1fr,auto] gap-3 p-4 text-xs text-gray-400">
                    <div>{t("Resource", "রিসোর্স")}</div>
                    <div>{t("Price", "প্রাইস")}</div>
                  </div>
                  <div className="px-4 pb-4 space-y-2">
                    <div className="text-xs font-black uppercase tracking-widest text-gray-400">{t("Messages", "মেসেজ")}</div>
                    <div className="divide-y divide-gray-800 rounded-lg overflow-hidden">
                      <div className="grid grid-cols-[1fr,auto] items-center p-3 bg-[#0b0b0b]">
                        <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>1k {t("messages", "মেসেজ")}</span></div>
                        <div className="font-mono text-[#00ff88]">৳400</div>
                      </div>
                      <div className="grid grid-cols-[1fr,auto] items-center p-3">
                        <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>5k {t("messages", "মেসেজ")}</span></div>
                        <div className="font-mono text-[#00ff88]">৳1,500</div>
                      </div>
                      <div className="grid grid-cols-[1fr,auto] items-center p-3">
                        <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>10k {t("messages", "মেসেজ")}</span></div>
                        <div className="font-mono text-[#00ff88]">৳2,500</div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">{t("No session fee. Usage billed via API balance.", "সেশন ফি নেই। ইউসেজ API ব্যালেন্স থেকে কাটে।")}</div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {[t("Unified pages with team sharing", "Team sharing সহ unified pages"), t("Webhook events and clean operations", "Webhook events ও পরিষ্কার অপারেশন")].map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />
                      <span className="text-sm text-gray-300">{p}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto pt-6">
                  <a href="/login" className="inline-flex h-11 px-6 items-center justify-center rounded-xl bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:shadow-[0_12px_36px_rgba(0,255,136,0.35)] transition-transform hover:scale-[1.02] active:scale-95 w-full">Choose Plan</a>
                </div>
              </div>

              <div className="group rounded-2xl border border-gray-800 bg-gradient-to-br from-[#0f1f17] to-[#101010] p-6 flex flex-col shadow-sm hover:border-[#00ff88] hover:shadow-[0_8px_30px_rgba(0,255,136,0.12)] transition-all min-h-[520px]">
                <div className="font-bold">{t("API Usage (OpenAI‑compatible)", "API ইউসেজ (OpenAI‑compatible)")}</div>
                <div className="mt-4 rounded-2xl border border-gray-800 bg-[#0d0d0d]">
                  <div className="grid grid-cols-[1fr,auto] gap-3 p-4 text-xs text-gray-400">
                    <div>{t("Resource", "রিসোর্স")}</div>
                    <div>{t("Price", "প্রাইস")}</div>
                  </div>
                  <div className="px-4 pb-4 space-y-6">
                    <div className="space-y-2">
                      <div className="text-xs font-black uppercase tracking-widest text-gray-400">{t("Tokens (per 1M)", "টোকেন (প্রতি ১এম)")}</div>
                      <div className="divide-y divide-gray-800 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr,auto] items-center p-3 bg-[#0b0b0b]">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("Lite — 1M tokens", "Lite — ১এম টোকেন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳40</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("Flash — 1M tokens", "Flash — ১এম টোকেন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳100</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>{t("Pro — 1M tokens", "Pro — ১এম টোকেন")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳250</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-black uppercase tracking-widest text-gray-400">{t("Message Bundles", "মেসেজ বান্ডেল")}</div>
                      <div className="divide-y divide-gray-800 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr,auto] items-center p-3 bg-[#0b0b0b]">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>1k {t("messages", "মেসেজ")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳400</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>5k {t("messages", "মেসেজ")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳1,500</div>
                        </div>
                        <div className="grid grid-cols-[1fr,auto] items-center p-3">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#00ff88]" /><span>10k {t("messages", "মেসেজ")}</span></div>
                          <div className="font-mono text-[#00ff88]">৳2,500</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {[
                    t("Streaming responses and model routes", "Streaming response ও model routes"),
                    t("Vision and audio support", "Vision ও audio সাপোর্ট"),
                    t("Usage analytics and balance deduction", "Usage analytics ও balance deduction")
                  ].map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />
                      <span className="text-sm text-gray-300">{p}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto pt-6">
                  <a href="/login" className="inline-flex h-11 px-6 items-center justify-center rounded-xl bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:shadow-[0_12px_36px_rgba(0,255,136,0.35)] transition-transform hover:scale-[1.02] active:scale-95 w-full">Choose Plan</a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="support" className="py-14 px-4">
          <div className="max-w-6xl mx-auto text-center">
            <h3 className="text-2xl md:text-3xl font-black tracking-tight">Get Support</h3>
            <p className="mt-2 text-sm text-gray-400">WhatsApp or Discord — reach us instantly.</p>
            <div className="mt-6 flex items-center justify-center gap-6">
              <a
                href="https://wa.me/8801956871403"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/512/733/733585.png"
                  alt="WhatsApp"
                  className="w-7 h-7"
                />
              </a>
              <a
                href="https://discord.gg/KEDXD7Ma4S"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/512/5968/5968756.png"
                  alt="Discord"
                  className="w-7 h-7"
                />
              </a>
            </div>
          </div>
        </section>

        <section id="cta" className="py-16 px-4 text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-black tracking-tight">Automate. Convert. Grow.</h2>
            <p className="mt-3 text-sm md:text-base text-gray-400">Start free and see the impact in days — not months.</p>
            <a href="/login" className="mt-8 inline-flex h-12 px-8 items-center justify-center rounded-xl bg-[#00ff88] text-black font-bold shadow-[0_10px_30px_rgba(0,255,136,0.25)] hover:shadow-[0_12px_36px_rgba(0,255,136,0.35)] transition-transform hover:scale-[1.02] active:scale-95">
              Get Started
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
