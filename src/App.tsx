import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Suspense, lazy } from "react";
import { LanguageProvider } from "./contexts/LanguageContext";
import { Loader2 } from "lucide-react";

// Lazy Load Pages
const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Register = lazy(() => import("./pages/Register"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const Pricing = lazy(() => import("./pages/Pricing"));
const BrandingPreview = lazy(() => import("./pages/BrandingPreview"));

// Lazy Load Dashboard
const DashboardLayout = lazy(() => import("./layouts/DashboardLayout").then(module => ({ default: module.DashboardLayout })));
const DashboardHome = lazy(() => import("./pages/dashboard/DashboardHome"));
const IntegrationPage = lazy(() => import("./pages/dashboard/IntegrationPage"));
const WhatsAppDatabasePage = lazy(() => import("./pages/dashboard/whatsapp/WhatsAppDatabasePage"));
const WhatsAppControlPage = lazy(() => import("./pages/dashboard/whatsapp/WhatsAppControlPage"));
const ProductsPage = lazy(() => import("./pages/dashboard/ProductsPage"));
const AdsPage = lazy(() => import("./pages/dashboard/AdsPage"));
const ResellerPage = lazy(() => import("./pages/dashboard/ResellerPage"));
const ProfilePage = lazy(() => import("./pages/dashboard/ProfilePage"));
const PaymentPage = lazy(() => import("./pages/dashboard/PaymentPage"));
const AdminPage = lazy(() => import("./pages/dashboard/AdminPage"));
const PlatformSelection = lazy(() => import("./pages/dashboard/PlatformSelection"));
const SettingsPage = lazy(() => import("./pages/dashboard/SettingsPage"));
const WhatsAppOrderTrackingPage = lazy(() => import("./pages/dashboard/whatsapp/WhatsAppOrderTrackingPage"));
const SessionManager = lazy(() => import("./pages/dashboard/whatsapp/SessionManager"));
const WhatsAppSettingsPage = lazy(() => import("./pages/dashboard/whatsapp/WhatsAppSettingsPage"));
const WhatsAppConversionPage = lazy(() => import("./pages/dashboard/whatsapp/WhatsAppConversionPage"));
const MessengerIntegrationPage = lazy(() => import("./pages/dashboard/messenger/MessengerIntegrationPage"));
const MessengerControlPage = lazy(() => import("./pages/dashboard/messenger/MessengerControlPage"));
const MessengerOrderTrackingPage = lazy(() => import("./pages/dashboard/messenger/MessengerOrderTrackingPage"));
const MessengerSettingsPage = lazy(() => import("./pages/dashboard/messenger/MessengerSettingsPage"));
const MessengerDatabasePage = lazy(() => import("./pages/dashboard/messenger/MessengerDatabasePage"));
const MessengerConversionPage = lazy(() => import("./pages/dashboard/messenger/MessengerConversionPage"));
const ApiManagementPage = lazy(() => import("./pages/dashboard/ApiManagementPage"));
const DeveloperPage = lazy(() => import("./pages/dashboard/DeveloperPage"));
const ApiDocsPage = lazy(() => import("./pages/dashboard/ApiDocsPage"));

const queryClient = new QueryClient();

const LoadingScreen = () => (
  <div className="min-h-screen bg-[#0b0b0b] flex items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-[#00ff88]" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<LoadingScreen />}>
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

                  {/* WhatsApp Routes */}
                  <Route path="whatsapp" element={<Outlet />}>
                    <Route index element={<DashboardHome />} />
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
                    <Route path="integration" element={<MessengerIntegrationPage />} />
                    <Route path="control" element={<MessengerControlPage />} />
                    <Route path="orders" element={<MessengerOrderTrackingPage />} />
                    <Route path="conversion" element={<MessengerConversionPage />} />
                    <Route path="database" element={<MessengerDatabasePage />} />
                    <Route path="settings" element={<MessengerSettingsPage />} />
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
                  </Route>
                </Route>
                
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
