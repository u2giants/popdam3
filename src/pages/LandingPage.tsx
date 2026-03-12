import { useAuth } from "@/hooks/useAuth";
import { Navigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Shield, FolderSearch, Image } from "lucide-react";

export default function LandingPage() {
  const { user, loading } = useAuth();

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center justify-between">
        <span className="text-2xl font-bold text-primary">PopDAM</span>
        <Link to="/login">
          <Button variant="outline" size="sm">Sign In</Button>
        </Link>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-4xl px-6 py-20 text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Digital Asset Management
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground leading-relaxed">
          PopDAM provides digital asset management for licensed consumer-product art.
          Organize, search, and manage design files across your team — securely and efficiently.
        </p>
        <Link to="/login">
          <Button size="lg" className="mt-4">Get Started</Button>
        </Link>
      </main>

      {/* Features */}
      <section className="mx-auto max-w-4xl px-6 pb-20 grid gap-8 sm:grid-cols-3">
        <div className="rounded-lg border border-border/50 bg-card p-6 space-y-3">
          <FolderSearch className="h-8 w-8 text-primary" />
          <h3 className="font-semibold text-lg">Smart Organization</h3>
          <p className="text-sm text-muted-foreground">
            Automatically group assets by style, scan NAS folders, and track file moves.
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-6 space-y-3">
          <Image className="h-8 w-8 text-primary" />
          <h3 className="font-semibold text-lg">Visual Browsing</h3>
          <p className="text-sm text-muted-foreground">
            Browse thumbnails of PSD and AI files without needing the source applications.
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-6 space-y-3">
          <Shield className="h-8 w-8 text-primary" />
          <h3 className="font-semibold text-lg">Secure Access</h3>
          <p className="text-sm text-muted-foreground">
            Invitation-only access with role-based permissions and Google SSO.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 px-6 py-6 text-center text-sm text-muted-foreground space-x-6">
        <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
        <a href="/terms" className="text-primary hover:underline">Terms of Service</a>
        <span>Contact: u2giants@gmail.com</span>
      </footer>
    </div>
  );
}
