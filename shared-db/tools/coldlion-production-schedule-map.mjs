// Deterministic PRODUCTION schedule → job mapping for the recurring ColdLion
// Licensor/Property feed (accelerated plan Step 7A item 2).
//
// WHY THIS IS A SEPARATE MODULE FROM tools/phase6-schedule-map.mjs
// ---------------------------------------------------------------
// The preview Phase 6 lane and the production recurring lane are two different
// workflows with two different blast radii. If they shared one map, a delayed
// GitHub runner — or a copy-paste of a cron string from one workflow into the
// other — could resolve a PRODUCTION write job from a PREVIEW schedule entry, or
// the reverse. The plan therefore requires the maps to stay separate.
//
// Two independent protections make a cross-lane mistake impossible to express:
//   1. The cron STRINGS are disjoint from the preview map. A production cron can
//      never be a key in the preview map, and vice versa; both maps assert this.
//   2. Every production job name is resolved through jobForProductionSchedule,
//      which throws on anything not registered. There is NO wall-clock fallback
//      (no date +%H, no "if it's about 6am it must be the snapshot"). A delayed
//      runner that fires the 06:00 snapshot cron at 09:40 still gets `coldlion`,
//      because the decision is made from github.event.schedule, not the clock.
//
// The scheduled sequence is a daily full snapshot, then the approved promotion,
// then the comparison, plus hourly health. `readiness` is deliberately NOT on a
// schedule: it is an operator gate, run by workflow_dispatch.

import { PHASE6_SCHEDULE_JOBS } from "./phase6-schedule-map.mjs";

export const COLDLION_PRODUCTION_SCHEDULE_JOBS = Object.freeze({
  "0 6 * * *": "coldlion", // daily full ColdLion snapshot (mirror_only)
  "30 6 * * *": "promote", // approved source-owned promotion, after the snapshot
  "0 7 * * *": "compare", // daily ColdLion vs DesignFlow comparison
  "45 * * * *": "health", // hourly health (offset from the preview lane's :15)
});

/** Jobs reachable by workflow_dispatch. `readiness` is dispatch-only by design. */
export const COLDLION_PRODUCTION_DISPATCH_JOBS = Object.freeze([
  "coldlion",
  "promote",
  "compare",
  "health",
  "readiness",
]);

/** Jobs that WRITE to the database and therefore need full production authorization. */
export const COLDLION_PRODUCTION_WRITE_JOBS = Object.freeze(["coldlion", "promote"]);

export function jobForProductionSchedule(cronExpression) {
  const key = String(cronExpression ?? "").trim();
  const job = COLDLION_PRODUCTION_SCHEDULE_JOBS[key];
  if (!job) {
    const err = new Error(
      `Unknown ColdLion PRODUCTION schedule expression (refusing ambiguous lane, never falling back to wall clock): ${key || "(empty)"}`,
    );
    err.code = "UNKNOWN_PRODUCTION_SCHEDULE";
    throw err;
  }
  return job;
}

export function assertProductionScheduleMapComplete(cronList) {
  const expected = Object.keys(COLDLION_PRODUCTION_SCHEDULE_JOBS).sort();
  const got = [...cronList].map((c) => String(c).trim()).sort();
  if (JSON.stringify(expected) !== JSON.stringify(got)) {
    throw new Error(
      `Production schedule map mismatch: expected ${expected.join(", ")} got ${got.join(", ")}`,
    );
  }
}

/**
 * The preview and production cron key sets must never intersect. Called by the
 * tests and by the readiness evaluator's schedule-map check, so an overlap
 * introduced later fails a gate instead of quietly creating an ambiguous lane.
 */
export function assertPreviewAndProductionMapsDisjoint() {
  const previewKeys = new Set(Object.keys(PHASE6_SCHEDULE_JOBS));
  const overlap = Object.keys(COLDLION_PRODUCTION_SCHEDULE_JOBS).filter((k) =>
    previewKeys.has(k),
  );
  if (overlap.length > 0) {
    throw new Error(
      `Preview and production schedule maps overlap on: ${overlap.join(", ")} — a delayed runner could pick the wrong lane`,
    );
  }
  return true;
}
