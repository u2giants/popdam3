import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAdminApi } from "@/hooks/useAdminApi";

export type GridAiField = { key: string; label: string };
export type GridAiPlan = { field: string; value: string | number | boolean | null; summary: string };

type Props = { pageName: string; selectedRowCount: number; fields: GridAiField[]; onApply: (plan: GridAiPlan) => Promise<void> };

export function GridAiHelperDialog({ pageName, selectedRowCount, fields, onApply }: Props) {
  const { call } = useAdminApi();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState<GridAiPlan | null>(null);
  const [working, setWorking] = useState(false);

  const propose = async () => {
    setWorking(true);
    try {
      const result = await call("plan-grid-bulk-edit", { page: pageName, instruction, fields });
      setPlan(result.plan as GridAiPlan);
    } catch (error) {
      toast.error("AI helper could not prepare the change", { description: (error as Error).message });
    } finally { setWorking(false); }
  };

  const apply = async () => {
    if (!plan) return;
    setWorking(true);
    try {
      await onApply(plan);
      toast.success(`Updated ${selectedRowCount.toLocaleString()} selected rows`);
      setOpen(false); setInstruction(""); setPlan(null);
    } catch (error) {
      toast.error("Bulk update stopped", { description: (error as Error).message });
    } finally { setWorking(false); }
  };

  return <>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} className="h-8">
      <Sparkles className="mr-1 h-3.5 w-3.5" /> AI helper
    </Button>
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setPlan(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>AI bulk update</DialogTitle>
          <DialogDescription>Select grid rows, describe one value change, then review it before saving. Uses GPT-5.6 Luna with medium reasoning.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm font-medium">{selectedRowCount.toLocaleString()} rows selected</div>
          <Textarea value={instruction} onChange={(event) => { setInstruction(event.target.value); setPlan(null); }} placeholder="Example: Set Production Status to Approved" rows={4} />
          {plan && <div className="rounded-md border bg-muted/40 p-3 text-sm"><div className="font-medium">Preview</div><div className="mt-1">{plan.summary}</div><div className="mt-1 text-muted-foreground">Only the selected rows will change.</div></div>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          {!plan
            ? <Button type="button" onClick={propose} disabled={working || !instruction.trim() || selectedRowCount === 0}>{working ? "Preparing…" : "Preview change"}</Button>
            : <Button type="button" onClick={apply} disabled={working || selectedRowCount === 0}>{working ? "Updating…" : `Confirm ${selectedRowCount.toLocaleString()} rows`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
