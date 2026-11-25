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
  | { kind: "listed"; versions: MergedVersion[] }
  | { kind: "restoring" }
  | { kind: "restored"; path: string }
  | { kind: "error"; message: string };

const POLL_MS = 2000;
const TIMEOUT_MS = 60_000;

const fmtSize = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fmtDay = (iso: string) => format(new Date(iso), "MMM d, yyyy");
const fmtSaved = (iso: string) => format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
const folderOf = (p: string) => p.slice(0, p.lastIndexOf("/"));

/** One version of the file's content, however many snapshots or folders it appeared in. */
export interface MergedVersion extends SnapshotVersion {
  /** Folders this content sat in, oldest first. */
  folders: string[];
}

/**
 * The helper splits a version whenever the folder changes (e.g. a folder rename).
 * To the user that is still the same file, so merge neighbouring entries whose
 * size and saved time match. The newest snapshot/path is kept for restoring.
 */
export function mergeVersions(versions: SnapshotVersion[]): MergedVersion[] {
  const sorted = [...versions].sort((a, b) => a.first_taken_at.localeCompare(b.first_taken_at));
  const out: MergedVersion[] = [];
  for (const v of sorted) {
    const prev = out[out.length - 1];
    const folder = folderOf(v.source_path);
    if (prev && prev.size === v.size && new Date(prev.mtime).getTime() === new Date(v.mtime).getTime()) {
      if (v.last_taken_at >= prev.last_taken_at) {
        prev.last_snapshot = v.last_snapshot;
        prev.last_taken_at = v.last_taken_at;
        prev.source_path = v.source_path;
      }
      prev.snapshot_count += v.snapshot_count;
      if (!prev.folders.includes(folder)) prev.folders.push(folder);
    } else {
      out.push({ ...v, folders: [folder] });
    }
  }
  return out;
}

/** Same size and saved time (to the second) as the file on the server now. */
const sameAsCurrent = (v: SnapshotVersion, size?: number | null, modifiedAt?: string | null) =>
  size != null && !!modifiedAt && v.size === size &&
  Math.abs(new Date(v.mtime).getTime() - new Date(modifiedAt).getTime()) < 2000;

interface Props {
  assetId: string;
  relativePath: string;
  /** Current file size and saved time, used to label the version that matches today's file. */
  fileSize?: number | null;
  modifiedAt?: string | null;
}

export default function OlderCopiesSection(props: Props) {
  const { isAdmin } = useIsAdmin();
  if (!isAdmin) return null;
  return <OlderCopiesInner {...props} />;
}

function OlderCopiesInner({ assetId, relativePath, fileSize, modifiedAt }: Props) {
  const { call } = useAdminApi();
  const { bridgeStatus } = useAgentStatus();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [confirm, setConfirm] = useState<MergedVersion | null>(null);

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
      setState({ kind: "listed", versions: mergeVersions((r.versions as SnapshotVersion[]) ?? []) });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  async function restore(v: MergedVersion) {
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
      {state.kind === "listed" && state.versions.length > 0 && (
        <p className="text-[11px]" style={muted}>
          {state.versions.length === 1
            ? "The snapshots hold only one version of this file."
            : `The snapshots hold ${state.versions.length} different versions of this file, newest first.`}
        </p>
      )}
      {state.kind === "listed" && state.versions.length > 0 && (
        <div className="space-y-1.5">
          {[...state.versions].reverse().map((v) => {
            const current = sameAsCurrent(v, fileSize, modifiedAt);
            const oldFolders = v.folders.filter((f) => f !== folderOf(relativePath));
            const sameDay = fmtDay(v.first_taken_at) === fmtDay(v.last_taken_at);
            return (
              <div key={`${v.source_path}|${v.first_snapshot}`} className="rounded p-2 space-y-0.5" style={{ background: "var(--pd-surface-2)" }}>
                <p className="text-[11px] font-medium" style={{ color: "var(--pd-fg-muted)" }}>
                  Saved {fmtSaved(v.mtime)} · {fmtSize(v.size)}
                  {current && <span className="font-normal" style={muted}> · same as the current file</span>}
                </p>
                <p className="text-[11px]" style={muted}>
                  {sameDay
                    ? `Kept in the snapshot of ${fmtDay(v.first_taken_at)}`
                    : `Kept in snapshots from ${fmtDay(v.first_taken_at)} to ${fmtDay(v.last_taken_at)}`}
                </p>
                {oldFolders.map((f) => (
                  <p key={f} className="text-[10px] font-mono break-all" style={muted}>was in: {f}</p>
                ))}
                {!current && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => setConfirm(v)}>
                    Restore beside current file
                  </Button>
                )}
              </div>
            );
          })}
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
              {confirm && `The version saved ${fmtSaved(confirm.mtime)} will be saved next to the current file with "(restored …)" added to its name. The current file is not changed.`}
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
