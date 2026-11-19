import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBulkOperationWaiter } from "@/hooks/useBulkOperationWaiter";

export function useSingleAssetTagging(onCompleted: (assetId: string) => void) {
  const [aiTagging, setAiTagging] = useState(false);
  const waitForBulkOperation = useBulkOperationWaiter();
  const run = async (assetId: string) => {
    setAiTagging(true);
    try {
      const opKey = `ai-tag-single-${assetId}`;
      const now = new Date().toISOString();
      const { error } = await supabase.rpc("update_bulk_operation", {
        p_op_key: opKey,
        p_op_state: {
          status: "running",
          cursor: 0,
          params: { type: "bulk-ai-tag-all", asset_ids: [assetId], total: 1 },
          started_at: now,
          updated_at: now,
          progress: { tagged: 0, skipped: 0, failed: 0, total: 1 },
        },
      });
      if (error) throw error;

      const outcome = await waitForBulkOperation(opKey);
      if (outcome.status === "aborted") return; // panel unmounted mid-poll
      if (outcome.status === "completed") {
        // Keep the completed operation record. Replacing it with {status:"idle"}
        // can erase a protected provider-job pointer and is refused by the
        // restart-safety database contract.
        onCompleted(assetId);
        toast("AI tagging complete");
        return;
      }
      if (outcome.status === "failed") throw new Error(outcome.error || "AI tagging failed");
      toast("AI tagging is still running — check back shortly");
    } catch (e: any) {
      toast.error("AI tagging failed", { description: e.message });
    } finally {
      setAiTagging(false);
    }
  };

  return { aiTagging, run };
}
