import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { LanguageProvider } from "./contexts/LanguageContext";

// Import Pages directly to avoid lazy loading issues
import Index from "./pages/Index";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import Pricing from "./pages/Pricing";
import BrandingPreview from "./pages/BrandingPreview";
import FacebookMessengerCallbackPage from "./pages/auth/FacebookMessengerCallbackPage";
import FacebookWhatsAppCallbackPage from "./pages/auth/FacebookWhatsAppCallbackPage";
import FacebookInstagramCallbackPage from "./pages/auth/FacebookInstagramCallbackPage";

// Import Dashboard components directly
import { DashboardLayout } from "./layouts/DashboardLayout";
import DashboardHome from "./pages/dashboard/DashboardHome";
import IntegrationPage from "./pages/dashboard/IntegrationPage";
import WhatsAppDatabasePage from "./pages/dashboard/whatsapp/WhatsAppDatabasePage";
import WhatsAppControlPage from "./pages/dashboard/whatsapp/WhatsAppControlPage";
import ProductsPage from "./pages/dashboard/ProductsPage";
import AdsPage from "./pages/dashboard/AdsPage";
import ResellerPage from "./pages/dashboard/ResellerPage";
import ProfilePage from "./pages/dashboard/ProfilePage";
import PaymentPage from "./pages/dashboard/PaymentPage";
import AdminPage from "./pages/dashboard/AdminPage";
import PlatformSelection from "./pages/dashboard/PlatformSelection";
import SettingsPage from "./pages/dashboard/SettingsPage";
import WhatsAppOrderTrackingPage from "./pages/dashboard/whatsapp/WhatsAppOrderTrackingPage";
import SessionManager from "./pages/dashboard/whatsapp/SessionManager";
import WhatsAppSettingsPage from "./pages/dashboard/whatsapp/WhatsAppSettingsPage";
import WhatsAppConversionPage from "./pages/dashboard/whatsapp/WhatsAppConversionPage";
import MessengerIntegrationPage from "./pages/dashboard/messenger/MessengerIntegrationPage";
import MessengerControlPage from "./pages/dashboard/messenger/MessengerControlPage";
import MessengerOrderTrackingPage from "./pages/dashboard/messenger/MessengerOrderTrackingPage";
import MessengerSettingsPage from "./pages/dashboard/messenger/MessengerSettingsPage";
import MessengerDatabasePage from "./pages/dashboard/messenger/MessengerDatabasePage";
import MessengerConversionPage from "./pages/dashboard/messenger/MessengerConversionPage";
import InstagramIntegrationPage from "./pages/dashboard/instagram/InstagramIntegrationPage";
import InstagramControlPage from "./pages/dashboard/instagram/InstagramControlPage";
import InstagramOrderTrackingPage from "./pages/dashboard/instagram/InstagramOrderTrackingPage";
import InstagramSettingsPage from "./pages/dashboard/instagram/InstagramSettingsPage";
import InstagramDatabasePage from "./pages/dashboard/instagram/InstagramDatabasePage";
import InstagramConversionPage from "./pages/dashboard/instagram/InstagramConversionPage";
import CommentAutomationPage from "./pages/dashboard/CommentAutomationPage";
import ApiManagementPage from "./pages/dashboard/ApiManagementPage";
import DeveloperPage from "./pages/dashboard/DeveloperPage";
import ApiDocsPage from "./pages/dashboard/ApiDocsPage";
import ShopifyPage from "./pages/dashboard/ShopifyPage";
import TeamManagementPage from "./pages/dashboard/TeamManagementPage";
import BusinessProfilesPage from "./pages/dashboard/BusinessProfilesPage";

import SmartInbox from "./pages/dashboard/SmartInbox";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} forcedTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/register" element={<Register />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-of-service" element={<TermsOfService />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/branding-preview" element={<BrandingPreview />} />
              <Route path="/auth/facebook/messenger/callback" element={<FacebookMessengerCallbackPage />} />
              <Route path="/auth/facebook/whatsapp/callback" element={<FacebookWhatsAppCallbackPage />} />
              <Route path="/auth/facebook/instagram/callback" element={<FacebookInstagramCallbackPage />} />
              <Route path="/developer-preview" element={<DeveloperPage />} />
              
              {/* Dashboard Routes */}
              <Route path="/dashboard" element={<DashboardLayout />}>
                <Route index element={<PlatformSelection />} />
                <Route path="abcadmin" element={<AdminPage />} />
                <Route path="api-management" element={<ApiManagementPage />} />
                <Route path="api" element={<DeveloperPage />} />
                <Route path="api-docs" element={<ApiDocsPage />} />
                
                {/* Global Tools Routes (Direct access) */}
                <Route path="integration" element={<IntegrationPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="ads" element={<AdsPage />} />
                <Route path="reseller" element={<ResellerPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="payment" element={<PaymentPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="shopify" element={<ShopifyPage />} />
                <Route path="team-management" element={<TeamManagementPage />} />

                {/* WhatsApp Routes */}
                <Route path="whatsapp" element={<Outlet />}>
                  <Route index element={<DashboardHome />} />
                  <Route path="smart-inbox" element={<SmartInbox />} />
                  <Route path="sessions" element={<SessionManager />} />
                  <Route path="control" element={<WhatsAppControlPage />} />
                  <Route path="orders" element={<WhatsAppOrderTrackingPage />} />
                  <Route path="conversion" element={<WhatsAppConversionPage />} />
                  <Route path="database" element={<WhatsAppDatabasePage />} />
                  <Route path="settings" element={<WhatsAppSettingsPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="ads" element={<AdsPage />} />
                  <Route path="reseller" element={<ResellerPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="payment" element={<PaymentPage />} />
                </Route>

                {/* Messenger Routes */}
                <Route path="messenger" element={<Outlet />}>
                  <Route index element={<DashboardHome />} />
                  <Route path="smart-inbox" element={<SmartInbox />} />
                  <Route path="integration" element={<MessengerIntegrationPage />} />
                  <Route path="control" element={<MessengerControlPage />} />
                  <Route path="orders" element={<MessengerOrderTrackingPage />} />
                  <Route path="conversion" element={<MessengerConversionPage />} />
                  <Route path="database" element={<MessengerDatabasePage />} />
                  <Route path="settings" element={<MessengerSettingsPage />} />
                  <Route path="comment-automation" element={<CommentAutomationPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="ads" element={<AdsPage />} />
                  <Route path="reseller" element={<ResellerPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="payment" element={<PaymentPage />} />
                  <Route path="business-profiles" element={<BusinessProfilesPage />} />
                </Route>

                {/* Instagram Routes */}
                <Route path="instagram" element={<Outlet />}>
                  <Route index element={<DashboardHome />} />
                  <Route path="smart-inbox" element={<SmartInbox />} />
                  <Route path="integration" element={<InstagramIntegrationPage />} />
                  <Route path="control" element={<InstagramControlPage />} />
                  <Route path="orders" element={<InstagramOrderTrackingPage />} />
                  <Route path="conversion" element={<InstagramConversionPage />} />
                  <Route path="database" element={<InstagramDatabasePage />} />
                  <Route path="settings" element={<InstagramSettingsPage />} />
                  <Route path="comment-automation" element={<CommentAutomationPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="ads" element={<AdsPage />} />
                  <Route path="reseller" element={<ResellerPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="payment" element={<PaymentPage />} />
                </Route>

                {/* Platform Specific Routes (Fallback) */}
                <Route path=":platform" element={<Outlet />}>
                  <Route index element={<DashboardHome />} />
                  <Route path="integration" element={<IntegrationPage />} />
                  <Route path="sessions" element={<SessionManager />} />
                  <Route path="database" element={<WhatsAppDatabasePage />} />
                  <Route path="control" element={<WhatsAppControlPage />} />
                  <Route path="settings" element={<WhatsAppSettingsPage />} />
                  <Route path="orders" element={<WhatsAppOrderTrackingPage />} />
                  <Route path="conversion" element={<WhatsAppConversionPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="ads" element={<AdsPage />} />
                  <Route path="reseller" element={<ResellerPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="payment" element={<PaymentPage />} />
                  <Route path="business-profiles" element={<BusinessProfilesPage />} />
                </Route>
              </Route>
              
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
