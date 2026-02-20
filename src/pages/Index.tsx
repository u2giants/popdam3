import { Database, Shield, Palette } from "lucide-react";

const Index = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6 max-w-lg px-6">
        <h1 className="text-4xl font-bold text-primary tracking-tight">
          PopDAM
        </h1>
        <p className="text-lg text-muted-foreground">
          Design Asset Manager — Phase 1 Complete
        </p>
        <div className="grid grid-cols-3 gap-4 pt-4">
          <div className="flex flex-col items-center gap-2 rounded-lg bg-card p-4 border border-border">
            <Palette className="h-6 w-6 text-primary" />
            <span className="text-xs text-muted-foreground">Theme</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-lg bg-card p-4 border border-border">
            <Database className="h-6 w-6 text-success" />
            <span className="text-xs text-muted-foreground">Database</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-lg bg-card p-4 border border-border">
            <Shield className="h-6 w-6 text-info" />
            <span className="text-xs text-muted-foreground">RLS</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
