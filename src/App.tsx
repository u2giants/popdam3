import { Suspense, lazy } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import LoginPage from "./pages/LoginPage";
import { IS_POPSG } from "@/lib/app-mode";
const Index = lazy(() => import("./pages/Index"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage"));
const SetupPage = lazy(() => import("./pages/SetupPage"));
const AiTaggingFailuresPage = lazy(() => import("./pages/AiTaggingFailuresPage"));
const AiTaggingDetailPage = lazy(() => import("./pages/AiTaggingDetailPage"));
const ScanDiagnosticsPage = lazy(() => import("./pages/ScanDiagnosticsPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PopSGLibraryPage = lazy(() => import("./pages/popsg/PopSGLibraryPage"));
const PopSGSettingsPage = lazy(() => import("./pages/popsg/PopSGSettingsPage"));
const FileBrowserPage = lazy(() => import("./pages/FileBrowserPage"));
const StylesPage = lazy(() => import("./pages/StylesPage"));
const OrdersPage = lazy(() => import("./pages/OrdersPage"));
const SellThroughExportPage = lazy(() => import("./pages/SellThroughExportPage"));
const PropertyReconciliationVisualPage = lazy(
  () => import("@/features/popsg-property-reconciliation/PropertyReconciliationVisualPage"),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
});

// v2.1 – public landing page + legal routes (force deploy)
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <ImpersonationProvider>
            <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/terms" element={<TermsOfServicePage />} />
              {import.meta.env.DEV && (
                <Route path="/__visual/property-reconciliation" element={<PropertyReconciliationVisualPage />} />
              )}
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/library" element={IS_POPSG ? <PopSGLibraryPage /> : <Index />} />
                <Route path="/files" element={<FileBrowserPage />} />
                {!IS_POPSG && <Route path="/sell-through" element={<SellThroughExportPage />} />}
                {!IS_POPSG && <Route path="/orders" element={<OrdersPage />} />}
                <Route path="/styles" element={<StylesPage />} />
                <Route path="/settings" element={IS_POPSG ? <PopSGSettingsPage /> : <SettingsPage />} />
                {!IS_POPSG && (
                  <>
                    <Route path="/settings/ai-tagging-failures" element={<AiTaggingFailuresPage />} />
                    <Route path="/settings/ai-tagging-detail" element={<AiTaggingDetailPage />} />
                    <Route path="/settings/scan-diagnostics" element={<ScanDiagnosticsPage />} />
                    <Route path="/downloads" element={<DownloadsPage />} />
                    <Route path="/setup" element={<SetupPage />} />
                  </>
                )}
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </ImpersonationProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
