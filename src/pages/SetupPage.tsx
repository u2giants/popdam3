import { Wand2 } from "lucide-react";

export default function SetupPage() {
  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Wand2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Setup Wizard</h1>
      </div>
      <p className="text-muted-foreground">
        Step-by-step Bridge Agent deployment wizard will appear here.
      </p>
    </div>
  );
}
