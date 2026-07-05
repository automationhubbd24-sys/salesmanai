import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useParams } from "react-router-dom";
import {
  MessageSquare,
  Users,
  Settings,
  Plus,
  Zap,
  ExternalLink,
  Smartphone,
  Package,
  Megaphone,
  CreditCard,
  Lock
} from "lucide-react";
import { BACKEND_URL } from "@/config";

export default function DashboardHome() {
  const { platform } = useParams();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [subscription, setSubscription] = useState({
    plan: 'none',
    expires_at: null as string | null
  });
  const [stats, setStats] = useState({
    sessions: 0,
    messages: 0,
    active: false
  });

  const isWhatsApp = platform === 'whatsapp';
  const platformName = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Platform';

  const getPlanLabel = (plan: string) => {
    if (plan === 'm1000' || plan === 'starter') return 'Starter';
    if (plan === 'm3000' || plan === 'pro') return 'Pro';
    if (plan === 'm7500' || plan === 'enterprise') return 'Enterprise';
    return 'Inactive';
  };

  const getPlanExpiryText = () => {
    if (!subscription.expires_at) return null;
    const expires = new Date(subscription.expires_at);
    const now = new Date();
    const diffTime = expires.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0) return `${diffDays} দিন বাকি`;
    if (diffDays === 0) return 'আজ expire হবে';
    return 'Expired';
  };

  useEffect(() => {
    async function loadStats() {
      const token = localStorage.getItem("auth_token");
      const email = localStorage.getItem("auth_email");
      if (!token || !email) {
        return;
      }

      setUserEmail(email);

      // Load subscription info
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/payments/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setSubscription({
            plan: data.subscription_plan || 'none',
            expires_at: data.monthly_expires_at || null
          });
        }
      } catch (e) {
        console.error("Subscription fetch error", e);
      }

      try {
        if (isWhatsApp) {
          const res = await fetch(`${BACKEND_URL}/api/whatsapp/sessions`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (res.ok) {
            const data = await res.json();
            const mySessions = Array.isArray(data) ? data : [];
            setStats(prev => ({ ...prev, sessions: mySessions.length || 0 }));
          }
        } else if (platform === 'messenger') {
          const res = await fetch(`${BACKEND_URL}/api/messenger/pages`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (res.ok) {
            const data = await res.json();
            const pages = Array.isArray(data) ? data : [];
            const activePages = pages.filter((p: any) =>
              ['active', 'trial'].includes(p.subscription_status)
            );
            setStats(prev => ({ ...prev, sessions: activePages.length || 0 }));
          }
        }
      } catch (e) {
        console.error("Dashboard stats error", e);
      }
    }
    loadStats();
  }, [isWhatsApp, platform]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Welcome to {platformName} Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            {userEmail ? `Logged in as ${userEmail}` : 'Manage your automation empire'}
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary uppercase tracking-wider">
              {isWhatsApp ? 'Total Sessions' : 'Connected Pages'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{stats.sessions}</div>
            <p className="text-xs text-muted-foreground mt-1">Total {platformName} Sessions</p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary uppercase tracking-wider">
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
              <span className="text-2xl font-bold text-foreground">Operational</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">All systems normal</p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary uppercase tracking-wider">
              AI Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">Active</div>
            <p className="text-xs text-muted-foreground mt-1">Smart replies enabled</p>
          </CardContent>
        </Card>

        {/* Subscription Status Card */}
        <Card className={`bg-[#0f0f0f]/80 backdrop-blur-sm border ${subscription.plan !== 'none' ? 'border-green-500/30' : 'border-white/10'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary uppercase tracking-wider">
              Subscription
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {getPlanLabel(subscription.plan)}
            </div>
            {getPlanExpiryText() && <p className="text-xs text-green-400 mt-1">{getPlanExpiryText()}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions Grid */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link to={`/dashboard/${platform}/control`} className="group">
            <Card className="h-full hover:shadow-lg transition-all cursor-pointer bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 group-hover:border-[#00ff88]/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors">
                  <Settings className="h-5 w-5" />
                  Configure Bot
                </CardTitle>
                <CardDescription>
                  Toggle Auto-Reply, Media, and AI settings
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>

      {/* Global Tools Section */}
      <div>
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2 text-foreground">
          <Package className="h-6 w-6 text-primary" />
          Global Tools
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link to={`/dashboard/${platform}/products`} className="group">
            <Card className="h-full hover:shadow-lg transition-all cursor-pointer bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 group-hover:border-[#00ff88]/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors text-base">
                  <Package className="h-5 w-5" />
                  Product Entry
                </CardTitle>
                <CardDescription>Manage your product inventory</CardDescription>
              </CardHeader>
            </Card>
          </Link>
          
          <Link to={`/dashboard/${platform}/ads`} className="group">
            <Card className="h-full hover:shadow-lg transition-all cursor-pointer bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 group-hover:border-[#00ff88]/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors text-base">
                  <Megaphone className="h-5 w-5" />
                  Ads Library
                </CardTitle>
                <CardDescription>Manage your ad campaigns</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          {/* Locked Reseller - Enhanced Professional Design */}
          <div className="group relative">
            <Card className="h-full bg-gradient-to-br from-[#0f0f0f] to-[#1a1a1a] border border-white/5 opacity-80 transition-all duration-500 overflow-hidden">
              {/* Animated background glow on hover */}
              <div className="absolute -inset-px bg-gradient-to-r from-[#00ff88]/0 via-[#00ff88]/10 to-[#00ff88]/0 group-hover:via-[#00ff88]/20 opacity-0 group-hover:opacity-100 blur-sm transition-opacity" />
              
              <CardHeader className="relative z-10">
                <CardTitle className="flex items-center gap-3 text-base text-gray-400">
                  <div className="p-2 rounded-lg bg-white/5 border border-white/10 group-hover:border-[#00ff88]/30 transition-colors">
                    <Users className="h-5 w-5 text-gray-500 group-hover:text-[#00ff88]" />
                  </div>
                  <span className="group-hover:text-white transition-colors font-bold">Reseller Program</span>
                  <Lock className="h-3.5 w-3.5 ml-auto text-gray-600" />
                </CardTitle>
                <CardDescription className="text-gray-500 group-hover:text-gray-400 transition-colors mt-2">
                  Launch your own AI agency with our partner program.
                </CardDescription>
              </CardHeader>
              
              <div className="absolute bottom-4 left-4 relative z-10">
                <span className="inline-flex items-center rounded-full bg-[#00ff88]/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#00ff88] border border-[#00ff88]/20 shadow-[0_0_15px_rgba(0,255,136,0.1)]">
                  Coming Soon
                </span>
              </div>

              {/* Glass overlay on hover */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 backdrop-blur-[2px] flex items-center justify-center transition-all duration-500">
                <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                   <Button variant="outline" className="rounded-full border-[#00ff88] text-[#00ff88] bg-black/50 font-bold hover:bg-[#00ff88] hover:text-black">
                     Join Waitlist
                   </Button>
                </div>
              </div>
            </Card>
          </div>

          <Link to={`/dashboard/${platform}/payment`} className="group">
            <Card className="h-full hover:shadow-lg transition-all cursor-pointer bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 group-hover:border-[#00ff88]/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors text-base">
                  <CreditCard className="h-5 w-5" />
                  Payment / Topup
                </CardTitle>
                <CardDescription>Manage payments and billing</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
