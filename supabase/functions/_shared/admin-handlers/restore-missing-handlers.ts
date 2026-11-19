/**
 * Extracted admin-api handler that restores records the missing-file step hid
 * in error (#1198, owner ruling 2026-11-19: artwork deleted from the NAS must
 * not disappear from PopDAM).
 *
 * Restores one record only when every guard holds:
 *  - it is hidden and was hidden by the missing-file step (marker row
 *    `retired-missing-from-nas` in asset_path_history — the marker rows stay,
 *    so the restore stays reversible through them);
 *  - no live record holds the same file at another path (findSurvivingCopy),
 *    so a restore can never create a second live record for the same file;
 *  - no earlier id in the same request shares its identity (same reason).
 *
 * Writes in chunks of 10 (per-row search-index triggers make bigger UPDATEs
 * time out), ledger row first with compensation delete on failure — the same
 * discipline as retire-missing-chunks. The ledger row is
 * `restored-no-surviving-copy`; re-hiding the restore is flipping is_deleted
 * back for records whose last ledger row says that.
 */
import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { RETIRED_MISSING_MARKER, type RetirementIdentity } from "../stale-asset-retirement.ts";
import { findSurvivingCopy } from "../surviving-copy.ts";

export const RESTORED_LEDGER = "restored-no-surviving-copy";
const MAX_IDS = 200;
const RESTORE_CHUNK = 10;

export async function handleRestoreMissingAssets(body: Record<string, unknown>) {
  const ids = body.asset_ids;
  if (!Array.isArray(ids) || ids.length === 0) return err("asset_ids must be a non-empty array");
  if (ids.length > MAX_IDS) return err(`asset_ids exceeds maximum batch size of ${MAX_IDS}`);
  if (!ids.every((id) => typeof id === "string")) return err("each asset id must be a string");
  const db = serviceClient();

  const { data: rows, error: readError } = await db
    .from("assets")
    .select("id, relative_path, filename, file_size, quick_hash, is_deleted")
    .in("id", ids as string[]);
  if (readError) return err(readError.message, 500);

  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  const candidates: RetirementIdentity[] = [];
  const seenTriples = new Set<string>();
  const found = new Set<string>();
  for (const row of (rows ?? []) as RetirementIdentity[]) {
    found.add(row.id);
    if (!row.is_deleted) {
      skip("not_hidden");
      continue;
    }
    const { data: marker, error: markerError } = await db
      .from("asset_path_history")
      .select("id")
      .eq("asset_id", row.id)
      .eq("new_relative_path", RETIRED_MISSING_MARKER)
      .limit(1);
    if (markerError) return err(markerError.message, 500);
    if (!marker?.length) {
      skip("no_marker");
      continue;
    }
    const survivor = await findSurvivingCopy(db, row);
    if (survivor) {
      skip("surviving_copy");
      continue;
    }
    const triple = row.filename && row.file_size && row.quick_hash
      ? `${row.filename}\0${row.file_size}\0${row.quick_hash}`
      : null;
    if (triple) {
      if (seenTriples.has(triple)) {
        skip("duplicate_in_request");
        continue;
      }
      seenTriples.add(triple);
    }
    candidates.push(row);
  }
  for (const id of ids as string[]) if (!found.has(id)) skip("not_found");

  let restored = 0;
  for (let i = 0; i < candidates.length; i += RESTORE_CHUNK) {
    const chunk = candidates.slice(i, i + RESTORE_CHUNK);
    const { data: ledger, error: ledgerError } = await db
      .from("asset_path_history")
      .insert(chunk.map((r) => ({
        asset_id: r.id,
        old_relative_path: RETIRED_MISSING_MARKER,
        new_relative_path: RESTORED_LEDGER,
      })))
      .select("id");
    if (ledgerError) return json({ ok: true, restored, skipped, partial: true, error: ledgerError.message });
    const { data: updated, error: updateError } = await db
      .from("assets")
      .update({ is_deleted: false })
      .in("id", chunk.map((r) => r.id))
      .eq("is_deleted", true)
      .select("id");
    if (updateError || (updated ?? []).length !== chunk.length) {
      const ledgerIds = ((ledger ?? []) as Array<{ id: string }>).map((l) => l.id);
      if (ledgerIds.length) await db.from("asset_path_history").delete().in("id", ledgerIds);
      return json({ ok: true, restored, skipped, partial: true, error: updateError?.message ?? "restore mismatch" });
    }
    restored += (updated as Array<{ id: string }>).length;
  }
  console.log(`[restore-missing-assets] restored ${restored}, skipped ${JSON.stringify(skipped)}`);
  return json({ ok: true, restored, skipped });
}
