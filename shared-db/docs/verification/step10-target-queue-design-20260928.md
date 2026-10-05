# Step 10 design — preview/production target queues with intact interlocks

Issue: [#3781](https://github.com/popcre/shared-db/issues/3781) (non-orchestrator work)
Parent: [#3306](https://github.com/popcre/shared-db/issues/3306) (non-orchestrator work)
Status date: 2026-09-28

## Scope of this change

Design + pure decision module + sandbox/fake-lock tests only. This change does
**not** take shared workflow or lock-manager files:

- `.github/workflows/shared-supabase-migrations.yml` — owned by PR #3736
- `scripts/manage-migration-author-lanes.mjs` — owned by open PRs (#3727, #3757, …)
- `scripts/orchestrator-flow/runner-lanes.mjs` — owned by PR #3748

Wiring into those surfaces waits for accepted current main and sequential
release, per #3781.

## Decisions owned by `scripts/target-queue-identity.mjs`

1. **Trusted target identity.** Database identity comes only from a closed
   catalog. Untrusted workflow input (dispatch payload, PR text, free-form
   strings) can name a catalog entry (targetId, projectRef, or alias) but can
   never invent a name for the same database. Duplicate project refs refuse at
   catalog build time.

2. **Target-qualified concurrency groups.**
   `shared-supabase-migrations-{role}-{targetId}` for mutations;
   `shared-supabase-migrations-pr-{ref}` for PR validations. The group is
   derived only from role + trusted catalog entry.

3. **Compatibility matrix** (`evaluatePairCompatibility`):
   - preview/preview same role → FORBID_SAME_ROLE
   - production/production → FORBID_SAME_ROLE
   - merge/production during protected freeze → FORBID_FREEZE
   - same physical database under two roles → FORBID_SAME_TARGET
   - both writers of a shared evidence ref → FORBID_SHARED_EVIDENCE
   - overlapping exclusive locks or wrong lock order → FORBID_LOCK_ORDER
   - otherwise distinct targets with disjoint evidence → ALLOW

4. **Unified production freshness.** One policy for workflow tip checks and
   `acquireExclusive('production')`: exact tip, or documentation-only
   (`.md`/`.markdown`, never `.github/`) drift. Substantive/unknown drift
   invalidates freshness and promotion reuse. Empty changed-path list after
   main moved refuses.

5. **Promotion manifest binding.** Digest of exact selected migration
   `version:bytesSha256`, producer id/sha256, policy id/sha256, sorted
   dependencies. Reuse only if the digests still match **and** freshness is
   inert. Never “same migration filenames”.

## Rollback

Revert this module and its tests. No workflow, lock, or production behaviour
changed here. Never roll back applied migrations.

## Follow-ups (wired 2026-10-02)

- `shared-supabase-migrations.yml` concurrency is now target-qualified for
  `workflow_dispatch` (`shared-supabase-migrations-{preview|production}`).
  PR / merge_group runs stay per-ref. Exclusive locks, freeze interlocks and
  exact-head approval are unchanged.
- Still open: point `acquireExclusive('production')` freshness at
  `evaluateProductionFreshness`; land the matrix as lock-manager assertions once
  `manage-migration-author-lanes.mjs` / `runner-lanes` release.
