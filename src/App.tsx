import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/terms" element={<TermsOfServicePage />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<Index />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/ai-tagging-failures" element={<AiTaggingFailuresPage />} />
                <Route path="/settings/ai-tagging-detail" element={<AiTaggingDetailPage />} />
                <Route path="/settings/scan-diagnostics" element={<ScanDiagnosticsPage />} />
                <Route path="/downloads" element={<DownloadsPage />} />
                <Route path="/setup" element={<SetupPage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
