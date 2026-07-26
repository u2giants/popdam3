// Deterministic Phase 6 schedule → job mapping.
// Must match the exact cron strings in
// .github/workflows/coldlion-licensor-property-phase6-parallel.yml
// and the workflow's github.event.schedule case dispatch.
// Never use wall-clock date/hour for lane selection.

export const PHASE6_SCHEDULE_JOBS = Object.freeze({
  "30 3 * * *": "designflow",
  "0 4 * * *": "coldlion",
  "0 5 * * *": "compare",
  "15 */6 * * *": "health",
});

export function jobForSchedule(cronExpression) {
  const key = String(cronExpression ?? "").trim();
  const job = PHASE6_SCHEDULE_JOBS[key];
  if (!job) {
    const err = new Error(
      `Unknown Phase 6 schedule expression (refusing ambiguous lane): ${key || "(empty)"}`,
    );
    err.code = "UNKNOWN_SCHEDULE";
    throw err;
  }
  return job;
}

export function assertScheduleMapComplete(cronList) {
  const expected = Object.keys(PHASE6_SCHEDULE_JOBS).sort();
  const got = [...cronList].map((c) => String(c).trim()).sort();
  if (JSON.stringify(expected) !== JSON.stringify(got)) {
    throw new Error(
      `Schedule map mismatch: expected ${expected.join(", ")} got ${got.join(", ")}`,
    );
  }
}
