import { useState } from "react";
import { toast } from "sonner";
import type { ScopedTagAction } from "@/components/library/ScopedTagSections";
import { useAdminApi } from "@/hooks/useAdminApi";

export function useScopedTagMutation({
  assetId,
  styleGroupId,
  onSuccess,
}: {
  assetId: string | undefined;
  styleGroupId: string | null | undefined;
  onSuccess: (assetId: string) => void;
}) {
  const { call: adminApi } = useAdminApi();
  const [tagBusy, setTagBusy] = useState(false);

  const handleTagAction: ScopedTagAction = async ({ scope, tag, action }) => {
    if (!assetId) return;
    setTagBusy(true);
    try {
      const payload: Record<string, unknown> = { scope, tag };
      if (scope === "asset") payload.asset_id = assetId;
      else payload.style_group_id = styleGroupId;

      if (action === "add") await adminApi("add-scoped-tag", payload);
      else if (action === "remove") await adminApi("remove-scoped-tag", payload);
      else await adminApi("review-scoped-tag", { ...payload, decision: action });

      onSuccess(assetId);
    } catch (e: unknown) {
      toast.error("Could not update tags", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTagBusy(false);
    }
  };

  return { tagBusy, handleTagAction };
}
