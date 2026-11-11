/** Heartbeat entry points for snapshot listing/restore (popdam3#963). Logic: snapshot-tools.ts. */
import * as api from "../api-client.js";
import { config } from "../config.js";
import { logger } from "../common/logger.js";
import { listSnapshotVersions, restoreFromSnapshot, type RestoreRequest } from "./snapshot-tools.js";

export async function handleSnapshotVersions(cmd: { request_id: string; candidates: string[] }) {
  logger.info("Snapshot versions requested", { requestId: cmd.request_id, candidates: cmd.candidates.length });
  try {
    const versions = await listSnapshotVersions(config.nasContainerMountRoot, cmd.candidates);
    await api.reportSnapshotVersions(cmd.request_id, { ok: true, versions });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    logger.warn("Snapshot versions failed", { error: msg });
    await api.reportSnapshotVersions(cmd.request_id, { ok: false, error: msg, versions: [] });
  }
}

export async function handleSnapshotRestore(cmd: { request_id: string } & RestoreRequest) {
  logger.info("Snapshot restore requested", { requestId: cmd.request_id, snapshot: cmd.snapshot });
  try {
    const r = await restoreFromSnapshot(config.nasContainerMountRoot, cmd);
    await api.reportSnapshotRestore(cmd.request_id, { ok: true, ...r });
    logger.info("Snapshot restore completed", r as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    logger.warn("Snapshot restore failed", { error: msg });
    await api.reportSnapshotRestore(cmd.request_id, { ok: false, error: msg });
  }
}
