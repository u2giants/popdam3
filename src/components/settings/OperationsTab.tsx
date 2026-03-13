import { useState, useCallback, useEffect } from "react";
import { Wrench, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminApi } from "@/hooks/useAdminApi";
import type { OperationState } from "@/hooks/usePersistentOperation";
import type { RequestOpFn } from "./diagnostics/types";
import { OP_NAMES, getLane } from "./diagnostics/types";
import { ActionsSection } from "./diagnostics/ActionsSection";
import { StyleGroupsSection } from "./diagnostics/StyleGroupsSection";
import { ConflictDialog, type ConflictState } from "./diagnostics/ConflictDialog";
import { QueueManagerDialog } from "./diagnostics/QueueManagerDialog";

export default function OperationsTab() {
  const { call } = useAdminApi();
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [queuedItems, setQueuedItems] = useState<[string, OperationState][]>([]);

  const requestOp: RequestOpFn = useCallback(async (opKey, opName, startFn, queueFn) => {
    try {
      const res = await call("get-config", { keys: ["BULK_OPERATIONS"] });
      const ops = (res?.config?.BULK_OPERATIONS?.value ?? res?.config?.BULK_OPERATIONS) as Record<string, OperationState> | undefined;
      const myLane = getLane(opKey);
      const activeEntry = ops
        ? Object.entries(ops).find(([k, op]) => op.status === "running" && k !== opKey && getLane(k) === myLane)
        : null;
      if (activeEntry) {
        setConflictState({
          isOpen: true,
          newOpKey: opKey,
          newOpName: opName,
          activeOpKey: activeEntry[0],
          activeOpName: OP_NAMES[activeEntry[0]] || activeEntry[0],
          onStart: startFn,
          onQueue: queueFn,
        });
      } else {
        startFn();
      }
    } catch {
      startFn();
    }
  }, [call]);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await call("get-config", { keys: ["BULK_OPERATIONS"] });
        if (!mounted) return;
        const ops = (res?.config?.BULK_OPERATIONS?.value ?? res?.config?.BULK_OPERATIONS) as Record<string, OperationState> | undefined;
        if (ops) {
          const items = Object.entries(ops)
            .filter(([_, op]) => op.status === "queued")
            .sort((a, b) => (a[1].queue_position || 0) - (b[1].queue_position || 0));
          setQueuedItems(items);
        } else {
          setQueuedItems([]);
        }
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="h-5 w-5" /> Bulk Operations
        </h2>
        {queuedItems.length > 0 && (
          <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={() => setShowQueue(true)}>
            <ListOrdered className="h-3.5 w-3.5" /> Queue ({queuedItems.length})
          </Button>
        )}
      </div>

      <ActionsSection onRefresh={() => {}} requestOp={requestOp} />
      <StyleGroupsSection requestOp={requestOp} />

      <ConflictDialog state={conflictState} onClose={() => setConflictState(null)} />
      <QueueManagerDialog
        open={showQueue}
        onOpenChange={setShowQueue}
        queuedItems={queuedItems}
        onQueueChange={setQueuedItems}
      />
    </div>
  );
}
