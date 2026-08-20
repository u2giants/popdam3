import { useState, useEffect } from "react";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { OperationState } from "@/hooks/usePersistentOperation";
import { OP_NAMES } from "./types";

interface QueueManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queuedItems: [string, OperationState][];
  onQueueChange: (items: [string, OperationState][]) => void;
}

export function QueueManagerDialog({ open, onOpenChange, queuedItems, onQueueChange }: QueueManagerDialogProps) {
  const { call } = useAdminApi();

  const handleReorderQueue = async (index: number, direction: -1 | 1) => {
    if (index + direction < 0 || index + direction >= queuedItems.length) return;
    const items = [...queuedItems];
    const tempPos = items[index][1].queue_position;
    items[index][1].queue_position = items[index + direction][1].queue_position;
    items[index + direction][1].queue_position = tempPos;

    try {
      for (const [key, op] of [items[index], items[index + direction]]) {
        await call("update-bulk-op", { op_key: key, op_state: op, expected_revision: op.state_revision });
      }
      onQueueChange(items.sort((a, b) => (a[1].queue_position || 0) - (b[1].queue_position || 0)));
    } catch { toast.error("Failed to reorder queue"); }
  };

  const handleRemoveFromQueue = async (opKey: string) => {
    try {
      const existing = queuedItems.find(([key]) => key === opKey)?.[1];
      await call("update-bulk-op", { op_key: opKey, op_state: { status: "idle" }, expected_revision: existing?.state_revision });
      onQueueChange(queuedItems.filter(([k]) => k !== opKey));
    } catch { toast.error("Failed to remove queued operation"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Operation Queue</DialogTitle>
          <DialogDescription>
            Operations will run automatically in order when the worker is free. Drag to reorder.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {queuedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">The queue is empty.</p>
          ) : (
            queuedItems.map(([key, op], index) => (
              <div key={key} className="flex items-center justify-between border border-border rounded-md p-3">
                <div>
                  <span className="font-medium text-sm">{OP_NAMES[key] || key}</span>
                  <span className="text-xs text-muted-foreground ml-2">#{index + 1}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} title={index === 0 ? "Already at the top of the queue" : undefined} onClick={() => handleReorderQueue(index, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === queuedItems.length - 1} title={index === queuedItems.length - 1 ? "Already at the bottom of the queue" : undefined} onClick={() => handleReorderQueue(index, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemoveFromQueue(key)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
