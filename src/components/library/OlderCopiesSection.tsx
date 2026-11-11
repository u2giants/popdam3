/**
 * Admin-only "Older copies" (u2giants/popdam3#963): lists distinct versions of
 * this file in the NAS snapshots — following renames and moves — and restores
 * one BESIDE the current file. Never overwrites.
 */
import { useState } from "react";
import { format } from "date-fns";
import { Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export interface SnapshotVersion {
  source_path: string;
  size: number;
  mtime: string;
  first_snapshot: string;
  last_snapshot: string;
  first_taken_at: string;
  last_taken_at: string;
  snapshot_count: number;
}

type State =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "listed"; versions: SnapshotVersion[] }
  | { kind: "restoring" }
  | { kind: "restored"; path: string }
  | { kind: "error"; message: string };

const POLL_MS = 2000;
const TIMEOUT_MS = 60_000;

const fmtSize = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fmtDay = (iso: string) => format(new Date(iso), "MMM d, yyyy");
const folderOf = (p: string) => p.slice(0, p.lastIndexOf("/"));

export default function OlderCopiesSection({ assetId, relativePath }: { assetId: string; relativePath: string }) {
  const { isAdmin } = useIsAdmin();
  if (!isAdmin) return null;
  return <OlderCopiesInner assetId={assetId} relativePath={relativePath} />;
}

function OlderCopiesInner({ assetId, relativePath }: { assetId: string; relativePath: string }) {
  const { call } = useAdminApi();
  const { bridgeStatus } = useAgentStatus();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [confirm, setConfirm] = useState<SnapshotVersion | null>(null);

  async function poll(action: string, requestId: string) {
    const until = Date.now() + TIMEOUT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const { result } = await call<{ result: Record<string, unknown> | null }>(action, { request_id: requestId });
      if (result) return result;
    }
    throw new Error("The NAS helper did not answer within 60 seconds");
  }

  async function find() {
    setState({ kind: "searching" });
    try {
      const { request_id } = await call<{ request_id: string }>("request-snapshot-versions", { asset_id: assetId });
      const r = await poll("get-snapshot-versions-result", request_id);
      if (!r.ok) throw new Error(String(r.error ?? "Search failed"));
      setState({ kind: "listed", versions: (r.versions as SnapshotVersion[]) ?? [] });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  async function restore(v: SnapshotVersion) {
    setConfirm(null);
    setState({ kind: "restoring" });
    try {
      const { request_id } = await call<{ request_id: string }>("request-snapshot-restore", {
        asset_id: assetId, snapshot: v.last_snapshot, source_path: v.source_path,
      });
      const r = await poll("get-snapshot-restore-result", request_id);
      if (!r.ok) throw new Error(String(r.error ?? "Restore failed"));
      setState({ kind: "restored", path: String(r.restored_relative_path) });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  const offline = bridgeStatus !== "online";
  const busy = state.kind === "searching" || state.kind === "restoring";
  const muted = { color: "var(--pd-fg-subtle)" };

  return (
    <section className="space-y-2" data-testid="older-copies">
      <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--pd-fg-muted)" }}>
        <Archive className="h-3.5 w-3.5" /> Older copies
      </h4>
      {offline && <p className="text-[11px]" style={muted}>The NAS helper is offline, so snapshots cannot be read right now.</p>}
      <Button size="sm" variant="outline" disabled={offline || busy} onClick={find}>
        {state.kind === "searching" ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Searching snapshots…</> : "Find older copies"}
      </Button>

      {state.kind === "listed" && state.versions.length === 0 && (
        <p className="text-[11px]" style={muted}>No older copies of this file were found in the snapshots.</p>
      )}
      {state.kind === "listed" && state.versions.length === 1 && state.versions[0].source_path === relativePath && (
        <p className="text-[11px]" style={muted}>This file is unchanged in every snapshot that has it.</p>
      )}
      {state.kind === "listed" && state.versions.length > 0 && (
        <div className="space-y-1.5">
          {[...state.versions].reverse().map((v) => (
            <div key={`${v.source_path}|${v.first_snapshot}`} className="rounded p-2 space-y-0.5" style={{ background: "var(--pd-surface-2)" }}>
              <p className="text-[11px]" style={{ color: "var(--pd-fg-muted)" }}>
                {fmtDay(v.first_taken_at)}{v.first_snapshot !== v.last_snapshot ? ` – ${fmtDay(v.last_taken_at)}` : ""}
                {" · "}{fmtSize(v.size)}{" · modified "}{format(new Date(v.mtime), "MMM d, yyyy HH:mm")}
              </p>
              {folderOf(v.source_path) !== folderOf(relativePath) && (
                <p className="text-[10px] font-mono break-all" style={muted}>was in: {folderOf(v.source_path)}</p>
              )}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => setConfirm(v)}>
                Restore beside current file
              </Button>
            </div>
          ))}
        </div>
      )}
      {state.kind === "restoring" && (
        <p className="text-[11px] flex items-center gap-1" style={muted}><Loader2 className="h-3 w-3 animate-spin" />Restoring…</p>
      )}
      {state.kind === "restored" && (
        <p className="text-[11px] break-all" style={{ color: "var(--pd-fg-muted)" }}>
          Restored as <span className="font-mono">{state.path.slice(state.path.lastIndexOf("/") + 1)}</span>, beside the current file. The current file was not changed.
        </p>
      )}
      {state.kind === "error" && <p className="text-[11px] text-destructive break-all">{state.message}</p>}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this older copy?</DialogTitle>
            <DialogDescription>
              {confirm && `The copy from ${fmtDay(confirm.last_taken_at)} will be saved next to the current file with "(restored …)" added to its name. The current file is not changed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => confirm && restore(confirm)}>Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
