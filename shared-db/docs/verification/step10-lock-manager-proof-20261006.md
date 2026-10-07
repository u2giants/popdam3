# Step 10 lock-manager proof — compatibility matrix and unified production freshness

Date: 2026-10-06
Issue: popcre/shared-db#3781 (Step 10) — **OPEN**; this document is policy-level proof only
Worktree: `.ai/worktrees/step10-locks-mimo` (branch `mimo/3781-step10-locks`)

## What was proven (POLICY-LEVEL, not live queue proof)

Everything below is proven against pure policy functions and an in-memory
fake-lock io. It is **not** live queue proof. `acquireExclusive` call-site
wiring and real live proof remain on #3781; that issue stays **OPEN**. Step 10
is **not complete**.

### 1. Lock-manager compatibility-matrix assertions

`scripts/lib/lanes/exclusive-policy.mjs` owns pure, fail-closed assertions over
the acceptance matrix in `scripts/target-queue-identity.mjs`:

- `assertExclusivePairCompatibility(left, right, plan)` runs
  `evaluatePairCompatibility` and throws `LaneError` on every non-ALLOW
  decision (same role, same target, freeze, shared evidence, lock order).
- `EXCLUSIVE_LOCK_ORDER` is `['merge', 'production', 'preview']`.
  preview / preview-recovery / preview-rehearsal share one exclusive ref
  (`refs/db-coordination/preview`) and map to one pair kind, so they are one
  exclusive lane.
- `compatibilityMatrixCases()` emits the full fixture list the tests walk,
  including a real preview-recovery vs preview fixture routed through
  `pairKindForExclusiveKind` (same-ref `FORBID_SAME_ROLE`).
- `assertExclusiveAcquisitionPolicy` is fully fail-closed: production
  freshness inputs (dispatchMainSha, currentMainSha, changedPaths) are
  required together — missing or partial inputs refuse, never silently defer.
  `heldKinds` is required on every call (use `[]` when none are held) so the
  pair matrix always runs. A missing, null or unreadable promotion freeze is
  live and blocks merge; only an explicit `expired: true` freeze releases it.

### 2. Unified production freshness

`evaluateProductionFreshness` (in `scripts/target-queue-identity.mjs`) now
classifies drift with `isProductionInertPath` imported from
`scripts/check-main-tip-freshness.mjs` — the single path-classification source
of truth. Substantive = not production-inert. Production-inert drift (Markdown
documentation, `.agent/` evidence pairs, test-only scripts) is fresh and may
reuse a promotion manifest; substantive drift (`.mjs` gate code, `.sql`
migrations, `.yml` workflows, config, `.json` data) never is. An empty
changed-path list on a moved tip still refuses. Exact tip / same SHA is still
fresh + reuseManifest.

#### Why this widens the old docs-only manifest rule (deliberate)

Production-inert (tests + `.agent/` evidence) is **the same rule**
`check-main-tip-freshness --production` already uses for tip checks.
`evaluateProductionFreshness` adopts that rule so tip-check and manifest-reuse
share one policy instead of drifting apart. This deliberately widens the old
docs-only manifest rule to match production-inert reasoning: no production
step runs a test or reads `.agent/`, so drift confined to those paths cannot
change what a production apply does. Fail-closed stays exactly as strict on
substantive paths (scripts, SQL, workflows, config, data). The two gates now
share one policy; `classifyMainTip` with `production=true` already called the
same helper.

### 3. Fake-lock / sandbox proof (POLICY-LEVEL only)

A tiny in-memory io mimicking `EXCLUSIVE_REFS` proves, **at policy level only**:

- **Preview recovery does not postpone approved production.** Holding
  `preview-recovery` occupies `refs/db-coordination/preview`; the production
  ref stays free and `assertExclusiveAcquisitionPolicy('production', …,
  { heldKinds: [{ kind: 'preview-recovery' }] })` allows the acquisition.
  Same for `preview-rehearsal`.
- **Same-target / same-ref races still refuse.** A second create on an occupied
  ref returns false; `preview-recovery` vs `preview` (one ref) is
  `FORBID_SAME_ROLE` both through `pairKindForExclusiveKind` fixtures and
  through `assertExclusiveAcquisitionPolicy`.
- **Merge/production freeze and cross-ref interlocks still refuse.** Production
  is refused while the merge ref is held; merge is refused while the production
  ref is held; merge is refused under a live, unreadable, or unknown
  (missing/null) promotion freeze. These interlocks are encoded in
  `assertExclusiveAcquisitionPolicy` because the pure matrix ALLOWs
  merge+production without freeze when locks are disjoint, and the live lock
  manager is stricter.

**This is not live queue proof.** The fake-lock io is in-memory. Real proof
against GitHub refs, and `acquireExclusive` call-site wiring, remain on #3781
(issue stays OPEN).

## Call-site wiring status

`assertExclusiveAcquisitionPolicy` is exported from
`scripts/lib/lanes/exclusive-policy.mjs` and re-exported from
`scripts/lib/lanes/exclusive-locks.mjs`. Wiring it into the `acquireExclusive`
call sites **waits on contested PRs** that own
`scripts/manage-migration-author-lanes.mjs` and its tests: **#3622, #3666,
#3627, #3636, #3626**. The production exact-current-main-SHA check inside
`acquireExclusive` stays in place until those land. **#3781 stays OPEN** until
that wiring and live proof are done. Step 10 is not complete.

## Test evidence

```
node --test scripts/target-queue-identity.test.mjs \
  scripts/check-main-tip-freshness.test.mjs \
  scripts/lib/lanes/exclusive-policy.test.mjs
# 99 pass, 0 fail

node --test scripts/lib/exclusive-lease.test.mjs
# 26 pass, 0 fail

node --test scripts/orchestrator-flow/evidence-bundle.test.mjs
# 6 pass, 0 fail
```

No file outside the contract `allowed_paths` was changed beyond the policy and
proof files this revision requires. Locks, freeze, exact-head approval and
required checks are unweakened.
