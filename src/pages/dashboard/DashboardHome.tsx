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
import { supabase } from "@/integrations/supabase/client";

export default function DashboardHome() {
  const { platform } = useParams();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [stats, setStats] = useState({
    sessions: 0,
    messages: 0,
    active: false
  });

  const isWhatsApp = platform === 'whatsapp';
  const platformName = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Platform';

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email);
        
        if (isWhatsApp) {
          // Fetch simple stats for WhatsApp (Only user's sessions)
          const { count: sessionCount } = await supabase
            .from('whatsapp_message_database')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);
            
          setStats(prev => ({ ...prev, sessions: sessionCount || 0 }));
        } else if (platform === 'messenger') {
            // Fetch connected pages for Messenger
            let targetEmail = user.email;
            
            // Check if team member
            const { data: teamData } = await (supabase
                .from('team_members') as any)
                .select('owner_email')
                .eq('member_email', user.email)
                .maybeSingle();

            if (teamData) {
                targetEmail = teamData.owner_email;
            }

            const { count: pageCount } = await supabase
                .from('page_access_token_message')
                .select('*', { count: 'exact', head: true })
                .eq('email', targetEmail)
                .in('subscription_status', ['active', 'trial']);
            
            setStats(prev => ({ ...prev, sessions: pageCount || 0 }));
        }
      }
    }
    getUser();
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
          
          {/* Locked Ads Library */}
          <div className="group relative cursor-not-allowed">
            <Card className="h-full opacity-70 bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
                  <Megaphone className="h-5 w-5" />
                  Ads Library
                  <Lock className="h-4 w-4 ml-auto" />
                </CardTitle>
                <CardDescription>Manage your ad campaigns</CardDescription>
              </CardHeader>
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 backdrop-blur-sm rounded-lg">
                <span className="font-semibold text-sm bg-primary/10 text-primary px-3 py-1 rounded-full">Coming Soon</span>
              </div>
            </Card>
          </div>

          {/* Locked Reseller */}
          <div className="group relative cursor-not-allowed">
            <Card className="h-full opacity-70 bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
                  <Users className="h-5 w-5" />
                  Reseller
                  <Lock className="h-4 w-4 ml-auto" />
                </CardTitle>
                <CardDescription>Manage reseller accounts</CardDescription>
              </CardHeader>
               <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 backdrop-blur-sm rounded-lg">
                <span className="font-semibold text-sm bg-primary/10 text-primary px-3 py-1 rounded-full">Coming Soon</span>
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
