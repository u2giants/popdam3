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
| **Two contexts made required on `main`** | ✅ done | Applied 2026-08-23, owner-approved. Live readback below: 11 contexts, `strict: false`. |

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

## Applying the two contexts — including the bug the first attempt exposed

The first `--apply` was refused by the AI session's own permission layer, not by GitHub. Albert
approved it explicitly, and the retry then failed against the real API:

```text
apply FAILED: GitHub command failed: gh: Invalid request.
For 'links/1/schema', nil is not an object. (HTTP 422)
```

**Cause: a defect in this tool, not in GitHub.** `applyUnion` sends the request body with
`--input -`, which reads standard input, but the `gh()` helper dropped its `input` argument and set
stdin to `'ignore'`. `gh` therefore sent an EMPTY body.

**Why 22 passing tests did not catch it.** The fake transport recorded `options.input` and asserted
on it directly. It never went near a real subprocess, so a helper that discarded `input` satisfied
every assertion. A mocked transport can prove the *shape* of a call; it cannot prove the real
process contract. Two regression tests now probe the real helper's spawn options: one asserts the
body is forwarded and stdin is not `'ignore'`, the other asserts stdin is still ignored when there
is no body.

**The fail-closed design worked.** A live readback immediately after the failure showed nine
contexts and `strict: false` — the rejected write changed nothing, and the tool refused to report
success. That is the behaviour the exit-code rules were written for.

### Applied, and independently verified (2026-08-23)

Tool output:

```text
READBACK OK — 11 contexts required, strict: false
```

Independent read of the FULL protection object, not just the narrow endpoint the tool writes:

```bash
gh api repos/u2giants/shared-db/branches/main/protection
```

```json
{
  "contexts": ["Promotion contract tests (offline)", "Cross-PR object collision",
    "Tools offline tests", "SQL migration guards", "Domain ownership", "Intake pointer guard",
    "Handoff contract", "Migration author lease", "Migration guarded merge authorization",
    "Orchestrator marker guard", "Cancelled work guard"],
  "count": 11, "strict": false,
  "enforce_admins": true, "force_push": false, "deletions": false
}
```

All nine original contexts survive, both intended contexts are present, and `strict`,
`enforce_admins`, force-push and deletion settings are unchanged. **Step 1 is complete.**

## Tests

```bash
node --test scripts/*.test.mjs      # 531 pass, 0 fail (includes the 2 new regression tests)
```

`scripts/manage-migration-author-lanes.test.mjs` gained three tests that pin the ruling itself:
the three repo work types must map outside orchestrator action, `curated-master-data` must stay
`fork`, and every known work type must have an exit — so adding one forces a routing decision
rather than defaulting.

## Limitations

- This step changes routing and documentation. It does not yet distinguish readers from writers in
  claims (Step 2) or prove dependency success (Step 3).
- The live audit reads GitHub at a moment in time. Re-run it rather than quoting these lines.
