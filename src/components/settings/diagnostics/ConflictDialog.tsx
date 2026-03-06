import { useAdminApi } from "@/hooks/useAdminApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { OperationState } from "@/hooks/usePersistentOperation";
import { OP_NAMES } from "./types";

export interface ConflictState {
  isOpen: boolean;
  newOpKey: string;
  newOpName: string;
  activeOpKey: string;
  activeOpName: string;
  onStart: () => void;
  onQueue: () => void;
}

interface ConflictDialogProps {
  state: ConflictState | null;
  onClose: () => void;
}

export function ConflictDialog({ state, onClose }: ConflictDialogProps) {
  const { call } = useAdminApi();

  return (
    <Dialog open={state?.isOpen ?? false} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Operation Conflict</DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">{state?.activeOpName}</span> is currently running in the background. Only one bulk operation can run at a time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="default"
            onClick={async () => {
              if (!state) return;
              try {
                const res = await call("get-config", { keys: ["BULK_OPERATIONS"] });
                const ops = (res?.config?.BULK_OPERATIONS?.value ?? res?.config?.BULK_OPERATIONS) as Record<string, OperationState>;
                if (ops[state.activeOpKey]) {
                  ops[state.activeOpKey] = {
                    ...ops[state.activeOpKey],
                    status: "interrupted",
                    interruption_reason_code: "user_stop",
                    error: `Paused to run ${state.newOpName}`,
                    updated_at: new Date().toISOString(),
                  };
                  await call("set-config", { entries: { BULK_OPERATIONS: ops } });
                }
              } catch { /* best effort */ }
              state.onStart();
              onClose();
            }}
          >
            Pause Active & Start New
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              state?.onQueue();
              toast.success(`${state?.newOpName} added to queue`);
              onClose();
            }}
          >
            Add to Queue
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
