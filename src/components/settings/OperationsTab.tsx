import { useState, useCallback, useEffect } from "react";
import { ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminApi } from "@/hooks/useAdminApi";
import type { OperationState } from "@/hooks/usePersistentOperation";
import type { RequestOpFn } from "./diagnostics/types";
import { OP_NAMES, getLane, OP_CONFLICTS } from "./diagnostics/types";
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
      const myCrossConflicts = OP_CONFLICTS[opKey] ?? [];

      // 1. Same-lane conflict: another op in this lane is running or queued.
      const sameLaneEntry = ops
        ? Object.entries(ops).find(([k, op]) =>
            k !== opKey &&
            getLane(k) === myLane &&
            (op.status === "running" || op.status === "queued"),
          )
        : null;

      // 2. Cross-lane conflict: an op in a different lane that cannot run
      //    alongside this one is currently running or queued.
      const crossLaneEntry = ops
        ? Object.entries(ops).find(([k, op]) =>
            myCrossConflicts.includes(k) &&
            (op.status === "running" || op.status === "queued"),
          )
        : null;

      const activeEntry = sameLaneEntry ?? crossLaneEntry;
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

  const [subTab, setSubTab] = useState<"bulk" | "maintenance">("bulk");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border-b border-border pb-2">
          {[
            { id: "bulk" as const, label: "Bulk Jobs" },
            { id: "maintenance" as const, label: "Maintenance" },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${subTab === id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {queuedItems.length > 0 && (
          <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={() => setShowQueue(true)}>
            <ListOrdered className="h-3.5 w-3.5" /> Queue ({queuedItems.length})
          </Button>
        )}
      </div>

      {subTab === "bulk" && <StyleGroupsSection requestOp={requestOp} />}
      {subTab === "maintenance" && <ActionsSection onRefresh={() => {}} requestOp={requestOp} />}

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
