import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Plug,
  Database,
  Settings,
  Package,
  Megaphone,
  Users,
  User,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sparkles,
  ArrowLeft,
  ShoppingBag,
  MessageSquare,
  Key,
  FileText
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { SessionSelector } from "./SessionSelector";
import { PageSelector } from "@/components/dashboard/PageSelector";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function DashboardSidebar({ isMobile, onLinkClick }: { isMobile?: boolean; onLinkClick?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Force expanded state on mobile
  const isCollapsed = isMobile ? false : collapsed;

  const pathParts = location.pathname.split('/');
  const platform = ['whatsapp', 'messenger', 'instagram'].includes(pathParts[2]) ? pathParts[2] : null;

  const getMenuItems = () => {
    // Define Global Tools
    const globalTools = [
      { title: "Product Entry", icon: Package, path: platform ? `/dashboard/${platform}/products` : "/dashboard/products" },
      { title: "Ads Library", icon: Megaphone, path: platform ? `/dashboard/${platform}/ads` : "/dashboard/ads" },
      { title: "Reseller", icon: Users, path: platform ? `/dashboard/${platform}/reseller` : "/dashboard/reseller" },
      { title: "Payment / Topup", icon: CreditCard, path: platform ? `/dashboard/${platform}/payment` : "/dashboard/payment" },
      { title: "Developer API", icon: Key, path: "/dashboard/api" },
    ];

    if (!platform) {
      return {
        switchItem: null,
        sections: [
          { title: null, items: [{ title: "Select Platform", icon: LayoutDashboard, path: "/dashboard" }] },
          { title: "Global Tools", items: globalTools },
          { title: null, items: [{ title: "Profile", icon: User, path: "/dashboard/profile" }] }
        ]
      };
    }

    const base = `/dashboard/${platform}`;
    
    // Platform Specific Items
    const platformItems = [
      { title: "Dashboard", icon: LayoutDashboard, path: base },
      { title: platform === 'whatsapp' ? "Sessions" : "Integration", icon: Plug, path: platform === 'whatsapp' ? `${base}/sessions` : `${base}/integration` },
      { title: "Database Connect", icon: Database, path: `${base}/database` },
      { title: "Control Page", icon: Settings, path: `${base}/control` },
    ];

    if (['whatsapp', 'messenger'].includes(platform)) {
      platformItems.push({ title: "AI Settings", icon: Sparkles, path: `${base}/settings` });
      platformItems.push({ title: "Order Tracking", icon: ShoppingBag, path: `${base}/orders` });
      if (platform === 'messenger') {
        platformItems.push({ title: "Conversion", icon: MessageSquare, path: `${base}/conversion` });
      }
    }

    const switchItem = { title: "Switch Platform", icon: ArrowLeft, path: "/dashboard" };

    return {
      switchItem,
      sections: [
        { title: "Platform Menu", items: platformItems },
        { title: "Global Tools", items: globalTools },
        { title: null, items: [{ title: "Profile", icon: User, path: `${base}/profile` }] }
      ]
    };
  };

  const menu = getMenuItems();

  const handleLogout = async () => {
    // Clear all local storage keys to prevent session leakage
    localStorage.removeItem("active_fb_page_id");
    localStorage.removeItem("active_fb_db_id");
    localStorage.removeItem("active_wp_db_id");
    localStorage.removeItem("active_wa_session_id");
    localStorage.removeItem("supabase.auth.token"); // Just in case, though signOut handles it

    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    navigate("/login");
  };

  return (
    <aside
      className={cn(
        "h-screen bg-background border-r border-white/10 flex flex-col transition-all duration-300 sticky top-0",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="p-4 border-b border-white/10 bg-transparent flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex flex-col gap-1 -ml-3">
            <Link to="/dashboard" className="flex items-center gap-2" onClick={onLinkClick}>
              <Logo showText={true} animated={true} size="sm" accentColor="#00ff88" className="scale-[0.85]" />
            </Link>
          </div>
        )}
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="text-[#00ff88] hover:bg-[#00ff88]/10"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </Button>
        )}
      </div>

      {isMobile && onLinkClick && (
        <div className="px-4 pt-2 pb-1">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[#00ff88]/25" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onLinkClick}
              className="h-auto px-3 py-1 rounded-full border border-[#00ff88]/30 text-[#00ff88] text-[11px] font-medium hover:bg-[#00ff88]/10"
            >
              <ArrowLeft className="w-3 h-3 mr-1" />
              Hide
            </Button>
            <div className="h-px flex-1 bg-[#00ff88]/25" />
          </div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {platform && !isCollapsed && (
          <div className="mb-4 relative z-10">
             {platform === 'whatsapp' && (
                <>
                  <WorkspaceSwitcher platform="whatsapp" />
                  <SessionSelector />
                </>
             )}
             {platform === 'messenger' && (
                <>
                  <WorkspaceSwitcher platform="messenger" />
                  <PageSelector />
                </>
             )}
          </div>
        )}

        <ul className="space-y-1 rounded-xl p-2 bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.15)]">
          {/* Switch Platform (Highlighted) */}
          {menu.switchItem && (
            <li key={menu.switchItem.path} className="mb-2">
              {isCollapsed ? (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link
                      to={menu.switchItem.path}
                      onClick={onLinkClick}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sidebar-foreground border border-white/10 bg-[#0f0f0f] hover:bg-[#00ff88]/10 hover:text-[#00ff88] hover:border-[#00ff88]/40 hover:shadow-[0_8px_24px_rgba(0,255,136,0.15)]",
                        isCollapsed && "justify-center px-2"
                      )}
                    >
                      <menu.switchItem.icon size={20} className="shrink-0 text-[#00ff88]" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {menu.switchItem.title}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  to={menu.switchItem.path}
                  onClick={onLinkClick}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sidebar-foreground border border-white/10 bg-[#0f0f0f] hover:bg-[#00ff88]/10 hover:text-[#00ff88] hover:border-[#00ff88]/40 hover:shadow-[0_8px_24px_rgba(0,255,136,0.15)]"
                  )}
                >
                  <menu.switchItem.icon size={20} className="shrink-0 text-[#00ff88]" />
                  <span className="text-sm font-medium">{menu.switchItem.title}</span>
                </Link>
              )}
            </li>
          )}

          {/* Sections */}
          {menu.sections.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              {section.title && (
                 <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider mt-4 text-[#00ff88]">
                   {!isCollapsed && section.title}
                 </div>
              )}
              
              {section.items.map((item) => {
                const isActive = location.pathname === item.path;
                
                if (isCollapsed) {
                  return (
                    <li key={item.path} className="mb-1">
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.path}
                            onClick={onLinkClick}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 justify-center px-2 border border-transparent",
                              isActive
                                ? "bg-[#0f0f0f]/90 text-sidebar-foreground border-[#00ff88]/60 shadow-[0_8px_24px_rgba(0,255,136,0.15)]"
                                : "text-sidebar-foreground hover:bg-[#00ff88]/10 hover:text-[#00ff88]"
                            )}
                          >
                            <item.icon size={20} className={cn("shrink-0", isActive && "text-[#00ff88]")} />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {item.title}
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  );
                }

                return (
                  <li key={item.path} className="mb-1">
                    <Link
                      to={item.path}
                      onClick={onLinkClick}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 border border-transparent",
                        isActive
                          ? "bg-[#0f0f0f]/90 text-sidebar-foreground border-[#00ff88]/60 shadow-[0_8px_24px_rgba(0,255,136,0.15)]"
                          : "text-sidebar-foreground hover:bg-[#00ff88]/10 hover:text-[#00ff88]"
                      )}
                    >
                      <item.icon size={20} className={cn("shrink-0", isActive && "text-[#00ff88]")} />
                      <span className="text-sm font-medium">{item.title}</span>
                    </Link>
                  </li>
                );
              })}
              
              {/* Separator between sections */}
              {sectionIndex < menu.sections.length - 1 && (
                 <div className="my-2 border-t border-white/10 mx-2" />
              )}
            </div>
          ))}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-2 border-t border-sidebar-border">
        {isCollapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="w-full text-sidebar-foreground hover:bg-[#00ff88]/10 hover:text-[#00ff88] justify-center"
              >
                <LogOut size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Logout</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            onClick={handleLogout}
            className="w-full text-sidebar-foreground hover:bg-[#00ff88]/10 hover:text-[#00ff88] justify-start gap-3"
          >
            <LogOut size={20} />
            <span>Logout</span>
          </Button>
        )}
      </div>
    </aside>
  );
}
