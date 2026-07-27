import { useState } from "react";
import { PropertyReconciliationPanel } from "./PropertyReconciliationPanel";
import type { ReconciliationRole } from "./contract";

export default function PropertyReconciliationVisualPage() {
  const [role, setRole] = useState<ReconciliationRole>("administrator");
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between rounded-md border bg-card p-3">
          <div>
            <p className="text-sm font-semibold">PSG-3 visual proof harness</p>
            <p className="text-xs text-muted-foreground">Development only. No Supabase client or write adapter is mounted.</p>
          </div>
          <select aria-label="Visual proof role" value={role} onChange={(event) => setRole(event.target.value as ReconciliationRole)} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="administrator">Administrator</option>
            <option value="designer">Designer</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <PropertyReconciliationPanel role={role} />
      </div>
    </main>
  );
}
