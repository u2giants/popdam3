import { useState, useEffect } from "react";
import { Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { externalSupabase } from "@/lib/external-supabase";
import { CURRENT_APP, IS_POPSG } from "@/lib/app-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, Shield } from "lucide-react";
import { redirectToAuthentik } from "@/lib/authentik";
import { toast } from "sonner";

const SHOW_AUTHENTIK_SSO = false;

export default function LoginPage() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  // Detect OAuth errors returned in URL hash or query params after redirect
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);

    // Supabase returns errors in the hash fragment: #error=...&error_description=...
    if (hash) {
      const hashParams = new URLSearchParams(hash.replace("#", ""));
      const hashError = hashParams.get("error_description") || hashParams.get("error");
      if (hashError) {
        setError(decodeURIComponent(hashError));
        // Clean the URL without triggering navigation
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }
    }

    // Also check query params (some error flows use ?error=..., including Authentik callback errors)
    const queryError = params.get("error_description") || params.get("error");
    if (queryError) {
      setError(decodeURIComponent(queryError));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [location]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/library" replace />;
  }

  const handleAuthentikSignIn = async () => {
    setError(null);
    try {
      await redirectToAuthentik();
    } catch (e: any) {
      setError(e.message || "Sign-in failed");
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const { error } = await externalSupabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message || "Google sign-in failed");
    }
  };

  const handleMicrosoftSignIn = async () => {
    setError(null);
    const { error } = await externalSupabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        // profile → display name; User.Read → Microsoft Graph profile photo
        scopes: "openid profile email offline_access User.Read",
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      setError(error.message || "Microsoft sign-in failed");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isSignUp) {
        const { error } = await externalSupabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast("Check your email", {
          description: "A confirmation link has been sent to your email address.",
        });
      } else {
        const { error } = await externalSupabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary">{CURRENT_APP.name}</h1>
          <p className="text-sm text-muted-foreground">{CURRENT_APP.tagline}</p>
        </div>

        <Card className="border-border/50">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">{isSignUp ? "Create account" : "Sign in"}</CardTitle>
            <CardDescription>
              {isSignUp
                ? "Sign up with your invited email"
                : "Sign in to access your assets"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {SHOW_AUTHENTIK_SSO && (
              <>
                {/* Authentik SSO (legacy company AD path; hidden while Microsoft is primary) */}
                <Button
                  variant="default"
                  className="w-full"
                  onClick={handleAuthentikSignIn}
                  type="button"
                  aria-label="Sign in with company account"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  Sign in with company account
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>
              </>
            )}

            {/* Google OAuth */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              type="button"
              aria-label="Sign in with Google"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Button>

            {/* Microsoft OAuth */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleMicrosoftSignIn}
              type="button"
              aria-label="Sign in with Microsoft"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Continue with Microsoft
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Email/Password */}
            <form onSubmit={handleEmailAuth} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {!isSignUp && (
                    <Link
                      to="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSignUp ? "Sign up" : "Sign in"}
              </Button>
            </form>

            <div className="text-center text-sm">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
              >
                {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Invitation notice */}
        <div className="space-y-2 text-center text-xs text-muted-foreground">
          <p>Access is by invitation only. Contact your administrator for access.</p>
          {!IS_POPSG && (
            <p className="space-x-4">
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
              <a href="/terms" className="text-primary hover:underline">Terms of Service</a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
