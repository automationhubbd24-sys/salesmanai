import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { WhatsAppProvider } from "@/context/WhatsAppContext";
import { MessengerProvider } from "@/context/MessengerContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/integration": "Integration",
  "/dashboard/database": "Database Connect",
  "/dashboard/control": "Control Page",
  "/dashboard/settings": "AI Settings",
  "/dashboard/orders": "Order Tracking",
  "/dashboard/products": "Product Entry",
  "/dashboard/ads": "Ads Library",
  "/dashboard/reseller": "Reseller",
  "/dashboard/profile": "Profile",
  "/dashboard/payment": "Payment / Topup",
  "/dashboard/admin": "Admin Control",
};

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pathParts = location.pathname.split('/');
  const platform = ['whatsapp', 'messenger', 'instagram'].includes(pathParts[2]) ? pathParts[2] : null;

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate("/login");
      }
      setLoading(false);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!session) {
          // Clean up sensitive local storage on session end
          localStorage.removeItem("active_fb_page_id");
          localStorage.removeItem("active_fb_db_id");
          localStorage.removeItem("active_wp_db_id");
          localStorage.removeItem("active_wa_session_id");
          localStorage.removeItem("supabase.auth.token");
          navigate("/login");
        }
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  // Hidden Admin Control - Ctrl + F5
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "F5") {
        e.preventDefault();
        navigate("/dashboard/abcadmin");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  useEffect(() => {
    document.body.classList.add("dashboard-theme");
    return () => {
      document.body.classList.remove("dashboard-theme");
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex w-full dashboard-theme">
        {/* Sidebar Skeleton */}
        <div className="hidden lg:block w-64 h-screen border-r border-sidebar-border p-4 space-y-4 bg-sidebar">
          <Skeleton className="h-8 w-32 mb-8 bg-sidebar-accent/50" /> {/* Logo */}
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full bg-sidebar-accent/30" />
            ))}
          </div>
        </div>
        
        {/* Content Skeleton */}
        <div className="flex-1 flex flex-col min-h-screen">
          <div className="h-16 border-b flex items-center px-6 gap-4 bg-card">
            <Skeleton className="h-8 w-48" /> {/* Title */}
            <div className="ml-auto flex gap-2">
                <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          </div>
          <div className="p-6 space-y-6">
            <Skeleton className="h-32 w-full" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <Skeleton className="h-32 w-full" />
                 <Skeleton className="h-32 w-full" />
                 <Skeleton className="h-32 w-full" />
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // Smart title lookup handling platform routes
  let currentTitle = pageTitles[location.pathname];
  if (!currentTitle && platform) {
     // Try to find generic title by removing platform from path
     // e.g. /dashboard/whatsapp/control -> /dashboard/control
     const genericPath = location.pathname.replace(`/${platform}`, '');
     currentTitle = pageTitles[genericPath];
  }
  
  if (!currentTitle) currentTitle = "Dashboard";

  const LayoutContent = (
    <TooltipProvider>
      <div className="min-h-screen bg-background flex w-full dashboard-theme">
        {/* Desktop Sidebar */}
        <div className="hidden lg:block">
          <DashboardSidebar />
        </div>

        {/* Mobile Sidebar */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="p-0 w-64 [&>button]:hidden">
            <DashboardSidebar isMobile={true} onLinkClick={() => setMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
          <DashboardHeader
            title={currentTitle}
            onMenuClick={() => setMobileMenuOpen(true)}
          />
          <main className="flex-1 p-4 lg:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );

  if (platform === 'whatsapp') {
    return (
      <WhatsAppProvider>
        {LayoutContent}
      </WhatsAppProvider>
    );
  }

  if (platform === 'messenger') {
    return (
      <MessengerProvider>
        {LayoutContent}
      </MessengerProvider>
    );
  }

  return LayoutContent;
}
