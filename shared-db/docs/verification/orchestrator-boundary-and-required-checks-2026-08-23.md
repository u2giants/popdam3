# Verification — Step 1: orchestrator boundary and the two required-check gaps

**Plan:** [`plan_multi_agent_database_coordination_hardening.md`](../../plan_multi_agent_database_coordination_hardening.md) Step 1
**Tracking issue:** [#1366](https://github.com/u2giants/shared-db/issues/1366)
**Date:** 2026-08-23
**Work class:** repository maintenance. No database, migration, or secret was changed.

## Outcome summary

| Sub-step | State | Evidence |
|---|---|---|
| Orchestrator boundary enforced in code | ✅ done | `NON_STRUCTURAL_EXITS`, live `--queue-audit` output below |
| Boundary recorded in durable docs | ✅ done | `AGENTS.md` §0.0-C and §12.1 item 16; `docs/agents/section-4-anti-collision-rules.md` |
| Curated Master Data deliberately unchanged | ✅ done | `curated-master-data` still `fork`; live audit still shows `FORK` |
| `strict: false` history reconciled | ✅ done | `AGENTS.md` §12.1 item 17; `docs/owner-rulings.md`; `plan_orchestrator-workflow-gaps.md` |
| Misleading collision comments corrected | ✅ done | `.github/workflows/pr-object-collision.yml`; `scripts/check-pr-object-collisions.mjs` |
| `update-required-checks` CLI built and tested | ✅ done | 22 tests; live dry run below |
| **Two contexts made required on `main`** | ⛔ **NOT DONE** | Blocked — see "Blocked sub-step" |

## Orchestrator boundary — what changed

`NON_STRUCTURAL_EXITS` in `scripts/manage-migration-author-lanes.mjs` previously mapped
`repo-maintenance`, `documentation`, and `security-settings` to `fork`, the same exit used for
curated Master Data. `fork` means "the orchestrator hands this out", which is why an orchestrator
session accepted a repository-maintenance planning task and triggered Albert's 2026-08-21 ruling.

Each work type now names its destination:

| work type | exit | who does it |
|---|---|---|
| `structural` | `accept` | this orchestrator, via a migration-author lane |
| `curated-master-data` | `fork` | a fresh session dispatched by this orchestrator, under §6.4 |
| `application-data`, `source-data` | `reject` | the owning application repository |
| `repo-maintenance`, `documentation` | `repo-session` | a separately started repository session |
| `security-settings` | `return-to-owner` | Albert |

`--queue-audit` now prints two separate lists. The second one exists so these rows stay visible to
an audit without reading as a worklist.

**Curated Master Data was deliberately left on `fork`.** The 2026-08-21 ruling was about
repository-maintenance work; it did not change Master Data routing, and §6.4 still governs it here.
A code comment and a test both record that, so a later session cannot "tidy" it away.

### Live evidence — `node scripts/manage-migration-author-lanes.mjs --queue-audit` (2026-08-23)

```text
NOT ORCHESTRATOR WORK: these open issues fail the shape test (AGENTS.md 0.0-C). Reject or fork each one; never work it here.
  #933 FORK — work_type curated-master-data, route curated-master-data-governance
  #640 FORK — work_type curated-master-data, route curated-master-data-governance
  #562 FORK — work_type curated-master-data, route curated-master-data-governance
  #505 FORK — work_type curated-master-data, route curated-master-data-governance
OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION: listed for audit visibility only (owner ruling 2026-08-21, issue #1366). The orchestrator does structure/schema only. Do NOT work these and do NOT dispatch them; a separately started session owns them.
  #1366 REPO-SESSION — work_type repo-maintenance, route repo-maintenance
  #1363 REPO-SESSION — work_type documentation, route repo-maintenance
  #1358 REPO-SESSION — work_type repo-maintenance, route repo-maintenance
  ...
  #1291 REPO-SESSION — work_type documentation, route owner-only [blocked on owner decision]
```

Issue #1366 — this plan's own tracker — is correctly reported as outside the orchestrator.

## `strict: false` — history preserved, current state corrected

`required_status_checks.strict` is `false` by Albert's 2026-08-19 ruling in issue #1286: strict
mode restarted the full check suite on every open branch after every unrelated merge, costing
roughly 50 minutes a day.

Three documents still told a reader the opposite, and two code comments credited strict mode with
providing the sibling-collision re-check. That wording is what made the first draft of this plan
propose reversing the ruling. All five now state the same thing:

- The collision check is a **detector**.
- The **gate** for a migration PR is `guarded-migration-merge.yml`, which re-runs collision and
  lease validation on a head containing current `main` while holding the merge lock.
- A PR with no migrations is auto-authorized by `migration-author-lease.yml`.
- `strict: false` is an owner ruling, not drift.

The 2026-08-06 account in `docs/owner-rulings.md` is retained verbatim as quoted history; only its
present-tense instruction was superseded.

## `scripts/update-required-checks.mjs`

Adding a required context by hand means PUTting the whole branch-protection object back, which
deletes every field omitted from the request — including, by default, re-enabling `strict`. This
CLI exists so that cannot happen:

- uses the **narrow** `required_status_checks` endpoint, never the full protection object;
- reads live, forms an exact **set union**, and proves the result is a superset before writing;
- echoes the live `strict` value and has no way to change it;
- refuses removals and treats a near-miss name as an addition, so a rename cannot happen silently;
- **dry run by default**; `--apply` is opt-in;
- fails closed (exit 2) on an unreadable, malformed, or empty live document — "I could not read it"
  is never treated as "there is nothing there";
- reads back after writing and exits 1 if a context was lost, an addition is missing, or `strict`
  moved.

22 unit tests cover each of those, including the readback refusals.

### Live dry run (2026-08-23) — nothing written

```text
Required status checks — u2giants/shared-db@main
  mode: DRY RUN (nothing will be written)

  strict: false  (PRESERVED EXACTLY — issue #1286 owner ruling; this tool never changes it)

  currently required (9):
    = Promotion contract tests (offline)
    = Cross-PR object collision
    = Tools offline tests
    = SQL migration guards
    = Domain ownership
    = Intake pointer guard
    = Handoff contract
    = Migration author lease
    = Migration guarded merge authorization

  ADDING (2):
    + Orchestrator marker guard
    + Cancelled work guard

  resulting list (11): no context removed, no context renamed.
```

Both guards were confirmed safe to require first: each triggers on `pull_request` with **no
`paths:` filter**, so neither can leave a pull request permanently pending, and both passed on
PR #1378.

## Blocked sub-step — the two contexts are NOT yet required

`--apply` was refused by the local AI session's own permission layer, not by GitHub. Live
protection therefore still lists **nine** contexts, and `Orchestrator marker guard` and
`Cancelled work guard` remain advisory.

This is the only incomplete part of Step 1. Nothing else depends on it, and Step 2 may proceed.

To complete it, run from a session permitted to make the call:

```bash
node scripts/update-required-checks.mjs --add "Orchestrator marker guard" --add "Cancelled work guard" --apply
```

Expected result: exit 0, `READBACK OK — 11 contexts required, strict: false`. Then update this
document and the plan's STATUS row. If the readback reports a lost context or a changed `strict`,
restore it immediately from the nine-context list above.

## Tests

```bash
node --test scripts/*.test.mjs      # 526 pass, 0 fail
```

`scripts/manage-migration-author-lanes.test.mjs` gained three tests that pin the ruling itself:
the three repo work types must map outside orchestrator action, `curated-master-data` must stay
`fork`, and every known work type must have an exit — so adding one forces a routing decision
rather than defaulting.

## Limitations

- The two contexts are not yet required. Until then, a red `Orchestrator marker guard` or
  `Cancelled work guard` does not block a merge.
- This step changes routing and documentation. It does not yet distinguish readers from writers in
  claims (Step 2) or prove dependency success (Step 3).
- The live audit reads GitHub at a moment in time. Re-run it rather than quoting these lines.
