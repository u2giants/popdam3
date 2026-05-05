import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/TermsOfServicePage";
import SettingsPage from "./pages/SettingsPage";
import DownloadsPage from "./pages/DownloadsPage";
import SetupPage from "./pages/SetupPage";
import AiTaggingFailuresPage from "./pages/AiTaggingFailuresPage";
import AiTaggingDetailPage from "./pages/AiTaggingDetailPage";
import ScanDiagnosticsPage from "./pages/ScanDiagnosticsPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import NotFound from "./pages/NotFound";
import PopSGLibraryPage from "./pages/popsg/PopSGLibraryPage";
import PopSGSettingsPage from "./pages/popsg/PopSGSettingsPage";
import FileBrowserPage from "./pages/FileBrowserPage";
import { IS_POPSG } from "@/lib/app-mode";

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
      <BrowserRouter>
        <AuthProvider>
          <ImpersonationProvider>
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/terms" element={<TermsOfServicePage />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/library" element={IS_POPSG ? <PopSGLibraryPage /> : <Index />} />
                <Route path="/files" element={<FileBrowserPage />} />
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
          </ImpersonationProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
