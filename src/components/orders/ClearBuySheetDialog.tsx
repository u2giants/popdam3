import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type Props = { open: boolean; onClose: () => void; onCleared: () => void };
type ClearPreview = {
  import_id: string; file_name: string; imported_at: string;
  lines_to_delete: number; lines_to_restore: number; orders_to_delete: number;
};

/** Undo the signed-in user's most recent buy-sheet (HFC) upload, so it can be imported again from scratch. */
export function ClearBuySheetDialog({ open, onClose, onCleared }: Props) {
  const [preview, setPreview] = useState<ClearPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (apply: boolean, importId?: string) => {
    const { data, error: rpcError } = await (supabase.rpc as any)("clear_dam_buy_sheet_import", {
      p_import_id: importId ?? null,
      p_apply: apply,
    });
    if (rpcError) throw rpcError;
    return data as ClearPreview | null;
  };

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    setBusy(true);
    call(false)
      .then((p) => (p?.import_id ? setPreview(p) : setError("You have no HFC upload to clear.")))
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setBusy(false));
  }, [open]);

  const clear = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await call(true, preview.import_id);
      toast.success(`Cleared ${preview.file_name}.`);
      onCleared();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clear my last HFC upload</DialogTitle>
          <DialogDescription>Removes what your most recent buy-sheet import added to OrderList, so you can import it again.</DialogDescription>
        </DialogHeader>
        {busy && !preview && <p className="text-sm text-muted-foreground">Checking…</p>}
        {preview && (
          <p className="text-sm">
            {preview.file_name}, uploaded {new Date(preview.imported_at).toLocaleString("en-US", { timeZone: "America/New_York" })} EST:{" "}
            {preview.lines_to_delete} lines removed, {preview.lines_to_restore} lines put back as they were, {preview.orders_to_delete} orders removed.
          </p>
        )}
        {error && <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={!preview || busy} onClick={() => void clear()}>Clear it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
