---
issue: 5986
status: OPEN
owner: claude/observer-skip-stale-cert
---

# HANDOFF — #5986 release observer aborts on stale current-live certificate

## Goal
Unblock popcre/designflow-frontend #558 and popcre/designflow-tracking #189. Both are red on
`database/production-ready` for requirement work issue #3869 / source PR #4735.

## State (2026-11-09 10:55 AM EST)
- Root cause: in `scripts/designflow-db-release.mjs` (`currentLiveEvidence`,
  `staleCertificateRecoveryCommand`), the code compared every recovery run's
  `CURRENT_LIVE_TRUSTED_PATHS` with current main through `content()`. An older run
  at 0cbc97f6 lacks `scripts/lib/production-apply-artifact-name.mjs`, so `content()`
  threw and aborted the scan. The fresh recovery certificate (run 42636707689,
  head 685de4314, green) was never used. Failing observer run: 42637565705.
- Fix: new exported `trustedPathsMatch()` treats a certificate missing a path as
  stale (skip). A path missing on main still throws. Test added. 53/53 pass locally.
- PR https://github.com/popcre/shared-db/pull/5987 (branch `claude/observer-skip-stale-cert`),
  checks running. It also adds the "Common `database/production-ready` blocks"
  section in `docs/designflow-db-release.md`.

## Next steps
1. Land #5987 (guarded flow per `docs/agents/merge-protocol.md`). Fix any red check.
2. After it merges, run `gh workflow run 393353405 -R popcre/shared-db` (DesignFlow database
   release readiness). Confirm frontend and tracking report `ready`, and that the
   `database/production-ready` status is success on their develop/main heads.
3. REQUIRED: `scripts/designflow-db-release.mjs` IS in `CURRENT_LIVE_TRUSTED_PATHS`, so merging #5987 makes every certificate stale. Run the current-live recovery command the observer prints in its step summary (or the one in `docs/designflow-db-release.md`), then rerun step 2.
4. Albert's message for Uma: `message-for-uma.md` in the originating worktree
   (untracked, not committed). Send it only after step 2 is green.
5. Delete this file once frontend and tracking are green.

## Risks
Confirmed: merging #5987 invalidates existing certificates (see step 3). One recovery run is expected.
