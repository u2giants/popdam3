/**
 * Check-in receipt verifier.
 *
 * Seafile-sourced check-ins reach the NYC Synology via an extra hop
 * (designer → Seafile → Synology), so the helper's HTTP upload returning does
 * not prove the fully-synced file has landed intact. helper-api parks those
 * check-ins in 'verifying' (lock held) until this agent — running ON the
 * Synology — confirms the on-disk file is present, complete, and matches what
 * the helper uploaded.
 *
 * To keep Synology load low, verification is a SIZE check plus a QUICK-HASH
 * (SHA-256 of first 64KB + last 64KB + size) — a ~128KB read, not a full-file
 * read. An incomplete/truncated upload (the failure mode that matters here)
 * always shows up as a wrong size and/or wrong tail bytes, so this catches it.
 *
 * Runs opportunistically on each heartbeat. A small (size, mtime) cache means a
 * file that is present-but-not-yet-matching is never re-hashed until it actually
 * changes, so a stuck check-in can't drive repeated full reads.
 */

import { join } from "node:path";
import { stat } from "node:fs/promises";
import * as api from "./api-client.js";
import { computeQuickHash } from "./hasher.js";
import { logger } from "./logger.js";

let running = false;

// checkout_id → fingerprint of the on-disk file at the last hash attempt, plus
// whether that attempt matched. Lets us skip re-hashing an unchanged file.
interface SeenState { size: number; mtimeMs: number; matched: boolean }
const seen = new Map<string, SeenState>();

export async function verifyPendingCheckins(mountRoot: string): Promise<void> {
  if (running) return; // never overlap passes
  running = true;
  try {
    const items = await api.claimCheckinVerifications();
    if (items.length === 0) {
      seen.clear(); // nothing pending — drop any stale fingerprints
      return;
    }
    logger.info("Check-in verification: claimed pending verifications", { count: items.length });

    const cleanRoot = mountRoot.replace(/\/+$/, "");
    const activeIds = new Set<string>();

    for (const item of items) {
      activeIds.add(item.checkout_id);
      try {
        if (!item.relative_path) {
          await api.reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "not_ready",
            detail: "Asset has no relative_path on record — cannot locate file",
          });
          continue;
        }
        if (!item.expected_hash || item.expected_size == null) {
          await api.reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "not_ready",
            detail: "No expected hash/size recorded for this check-in",
          });
          continue;
        }

        const absPath = join(cleanRoot, item.relative_path);

        // Past the resolve deadline: classify what is sitting at the master path
        // and hand off a terminal 'resolved' outcome so the server releases the
        // lock with the right diagnostics. No destructive disk actions here.
        if (item.resolve_due) {
          await resolveStuck(item, absPath);
          seen.delete(item.checkout_id);
          continue;
        }

        let size: number;
        let mtimeMs: number;
        try {
          const s = await stat(absPath);
          size = s.size;
          mtimeMs = s.mtimeMs;
        } catch {
          // Not on disk yet — still syncing from Seafile. Cheap stat only.
          seen.delete(item.checkout_id);
          await api.reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "not_ready",
            detail: "File has not arrived on the Synology yet",
          });
          continue;
        }

        if (size !== item.expected_size) {
          // Present but wrong size — partial/in-progress sync. Stat only, no hash.
          seen.set(item.checkout_id, { size, mtimeMs, matched: false });
          await api.reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "not_ready",
            detail: `Size ${size} of expected ${item.expected_size} bytes — still syncing`,
          });
          continue;
        }

        // Size matches. Skip re-hashing if the file is byte-for-byte unchanged
        // since a previous (failed) attempt — re-reading it would give the same
        // result and just burn I/O.
        const prev = seen.get(item.checkout_id);
        if (prev && prev.size === size && prev.mtimeMs === mtimeMs && !prev.matched) {
          await api.reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "mismatch",
            detail: "On-disk file unchanged and still does not match the uploaded file",
          });
          continue;
        }

        const { quick_hash } = await computeQuickHash(absPath);
        if (quick_hash === item.expected_hash) {
          seen.delete(item.checkout_id);
          await api.reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "verified",
            final_hash: quick_hash,
            final_size: size,
          });
          logger.info("Check-in verified — file received intact", {
            checkout_id: item.checkout_id,
            path: item.relative_path,
          });
        } else {
          seen.set(item.checkout_id, { size, mtimeMs, matched: false });
          await api.reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "mismatch",
            detail: "On-disk quick-hash does not match the uploaded file",
          });
          logger.warn("Check-in hash mismatch", {
            checkout_id: item.checkout_id,
            path: item.relative_path,
          });
        }
      } catch (e) {
        logger.warn("Check-in verification: item failed (will retry next pass)", {
          checkout_id: item.checkout_id,
          error: (e as Error).message,
        });
        await api
          .reportCheckinVerification({
            checkout_id: item.checkout_id,
            outcome: "not_ready",
            detail: `Verification error: ${(e as Error).message}`.slice(0, 500),
          })
          .catch(() => {/* best-effort */});
      }
    }

    // Forget fingerprints for checkouts no longer pending (completed/discarded).
    for (const id of seen.keys()) {
      if (!activeIds.has(id)) seen.delete(id);
    }
  } catch (e) {
    logger.warn("Check-in verification pass failed", { error: (e as Error).message });
  } finally {
    running = false;
  }
}

/**
 * Terminal classification of a stuck check-in past its resolve deadline. Reports
 * exactly one outcome and performs NO destructive disk action:
 *   - on-disk matches the uploaded file  → 'verified' (it arrived, just late)
 *   - on-disk matches the original master → 'resolved' / matches_original
 *   - file absent                         → 'resolved' / missing
 *   - anything else                       → 'resolved' / foreign
 */
async function resolveStuck(
  item: api.CheckinVerificationItem,
  absPath: string,
): Promise<void> {
  let size: number;
  try {
    const s = await stat(absPath);
    size = s.size;
  } catch {
    await api.reportCheckinVerification({
      checkout_id: item.checkout_id,
      outcome: "resolved",
      disk_state: "missing",
    });
    logger.warn("Check-in auto-resolved: file never arrived", {
      checkout_id: item.checkout_id,
      path: item.relative_path,
    });
    return;
  }

  let quickHash: string | null = null;
  try {
    quickHash = (await computeQuickHash(absPath)).quick_hash;
  } catch {
    /* unreadable — fall through to foreign */
  }

  if (quickHash && item.expected_hash && quickHash === item.expected_hash) {
    // It actually landed (very late). Honour it rather than failing the check-in.
    await api.reportCheckinVerification({
      checkout_id: item.checkout_id,
      outcome: "verified",
      final_hash: quickHash,
      final_size: size,
    });
    logger.info("Check-in verified at resolve time (late arrival)", {
      checkout_id: item.checkout_id,
      path: item.relative_path,
    });
    return;
  }

  const matchesOriginal =
    quickHash != null &&
    item.original_hash != null &&
    quickHash === item.original_hash &&
    (item.original_size == null || size === item.original_size);

  const diskState = matchesOriginal ? "matches_original" : "foreign";
  await api.reportCheckinVerification({
    checkout_id: item.checkout_id,
    outcome: "resolved",
    disk_state: diskState,
  });
  logger.warn("Check-in auto-resolved", {
    checkout_id: item.checkout_id,
    path: item.relative_path,
    disk_state: diskState,
  });
}
