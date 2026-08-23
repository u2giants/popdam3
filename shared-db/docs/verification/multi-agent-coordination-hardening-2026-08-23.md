# Verification — provider-neutral multi-agent database coordination hardening

**Plan:** [`plan_multi_agent_database_coordination_hardening.md`](../../plan_multi_agent_database_coordination_hardening.md)
**Tracking issue:** [#1366](https://github.com/u2giants/shared-db/issues/1366)
**Date:** 2026-08-23
**Work class:** repository maintenance. **No database, migration, or secret was changed by any step.**

## What shipped

| Step | Merged as | What it does |
|---|---|---|
| 1 | `039531f`, `49a04d5` | Orchestrator restricted to structure/schema; two guards made required |
| 2 | `a1d6bbb` | Read/write claims and the conflict matrix |
| 3 | `f8c8598` | Dependencies must prove success, not merely be closed |
| 4+5 | `05b621e` | Work contracts pinned to git refs; coordination event trace; 30 scenarios |
| 6 | `df1f1eb` | Generation-fenced leases, run-liveness recovery, apply-lane advisory lock |
| 8A+9 | this PR | Compatibility audit, activation gates, this document |

Steps 7 and 8B (the Supabase per-PR branch pilot) were **deferred** on 2026-08-23 to a
follow-up issue: they prevent no failure mode in the plan's §1 and were the only thing that
could hold #1366 open indefinitely.

## Live branch protection (read back 2026-08-23)

```bash
gh api repos/u2giants/shared-db/branches/main/protection
```

| field | value |
|---|---|
| `required_status_checks.contexts` | **11** — nine originals plus `Orchestrator marker guard` and `Cancelled work guard` |
| `required_status_checks.strict` | **`false`** — preserved, per Albert's 2026-08-19 ruling in issue #1286 |
| `enforce_admins` | `true` — unchanged |
| `allow_force_pushes` / `allow_deletions` | `false` / `false` — unchanged |

No context was removed or renamed and no unrelated protection field moved.

## Tests

```bash
node --test scripts/*.test.mjs scripts/lib/*.test.mjs   # 712+ pass, 0 fail
python -m unittest scripts.test_production_business_risk_gate   # 104 pass
node scripts/check-cancelled-work.mjs                   # exit 0
node scripts/check-handoff-contract.mjs                 # exit 0
bash scripts/check-sql.sh                               # static checks pass
```

New suites are wired into the `Migration author lease` CI job, which already owns the
functions they exercise.

## Step 8A — the compatibility audit, and why enforcement is NOT switched on

Measured against live GitHub on 2026-08-23:

| measure | count |
|---|---|
| open pull requests | 4 |
| open pull requests carrying a contract | **0** |
| open claims | 1 |
| open claims using legacy `objects:` | **1** |
| open work issues using legacy `objects:` | **29** |
| open work issues using `writes:`/`reads:` | 0 |
| open work issues whose scope will not parse | 2 |

**Neither gate is met, so neither switch was flipped.** That is the honest outcome, not a
shortfall:

- **Contract enforcement stays report-only.** Enforcing now would fail every open pull
  request that predates contracts. A guard that fails everything on day one gets disabled,
  and a disabled guard protects nothing. Report-only still **fails** on a malformed contract
  or a report that contradicts its contract; it only tolerates their absence.
- **The `objects:` alias stays.** Retiring it with 1 claim and 29 issues still using it would
  strand real work. It now emits a visible deprecation warning, because a silent alias never
  gets migrated — nothing ever reminds anyone it exists.

The exact conditions for flipping each switch are recorded in
`config/agent-work-contract-activation.json` so a later session does not have to re-derive
them.

Note the direction of the legacy reading: a legacy `objects:` claim is interpreted as a
**write**. Anything weaker would let a new writer start against work already in flight.

## What is enforced today

- The orchestrator cannot be handed repository-maintenance work; `--queue-audit` lists it
  under `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION` for visibility only.
- Two readers of one table run in parallel; any writer against it serialises, **in both
  directions**.
- A dependency releases downstream work only on a typed `merged` or `owner-ruling-recorded`
  record whose evidence re-derives against `main`. Missing issues, cycles, self-dependencies
  and unsuccessful outcomes all block and say why.
- Exclusive stages carry a monotonic generation; a recovered lane fences its previous holder
  out, and every side effect asserts ownership immediately beforehand.
- A crashed job's lane can be recovered — only after its recorded run is conclusively
  finished on a live query, no later attempt or run is active, and ten minutes have passed.
- Two live applies cannot overlap on one target.

## Limitations, stated plainly

These are real and were deliberately not papered over.

1. **Contract authority proves ordering, not identity.** Every session in this repository
   authenticates as the same GitHub identity, so pinning a contract to a create-if-absent ref
   prevents it being **widened or backdated** — it does not prove who published it. A worker
   can create the next generation itself. Restricting `--publish-contract` to a distinct
   workflow token would close this, at the cost of moving every dispatch into a
   `workflow_dispatch` run. Not done; recorded.

2. **"Branch absent at `base_sha`" does not prove work began after publication.** An agent
   can commit locally, publish, then push, and commit timestamps are author-controlled.

3. **The apply-lane advisory lock does not close the dying-backend window.** It prevents two
   *live* applies overlapping. A lock held on the applier's own connection is released the
   instant that connection dies — exactly when the race opens. The window is **bounded by the
   10-minute recovery grace, not eliminated.** Closing it needs a session-pinned applier
   around `supabase db push`, which is a larger change and has not been made.

4. **Static SQL analysis cannot prove a read list complete.** It finds objects a migration
   names; it cannot see a view depending on a dropped column or an application reading an
   altered value. Indirect and semantic reads must be declared by hand, and the parser will
   never claim the list is complete.

5. **Dependencies closed before 2026-08-23 are grandfathered.** They could not have carried a
   completion record. They are accepted and reported so they stay countable. The cutoff never
   rescues a record that says the work did not succeed, and must never be moved forward.

6. **Neither activation gate is met** — see the audit above.

## What was rejected during implementation, and why

Recorded so it is not re-proposed:

- **Heartbeat-renewed leases.** Renewal moves the ref sha that `releaseOwnedRef` and every
  calling workflow use as the release key, so the first heartbeat would have made lanes
  permanently unreleasable. A heartbeat writing outside `MUTEX_REF` could also overwrite an
  incremented generation. Liveness is a live GitHub run query instead.
- **Issue comments as contract authority.** Comments are editable, and one shared identity
  means a comment naming a dispatcher proves nothing.
- **JSON Schema draft 2020-12 validators.** No root `package.json`; a partial hand-rolled
  implementation claiming to be a standard is worse than an honest bespoke one.
- **Moving curated Master Data off the orchestrator.** The 2026-08-21 ruling did not cover
  it. A test now pins that.
- **Restoring `strict: true`.** Two code comments credited strict mode with a safety job it
  does not do; both were corrected, because that text is what made the plan's first draft
  propose reversing issue #1286.

## Reruns

Every claim above is reproducible:

```bash
node --test scripts/*.test.mjs scripts/lib/*.test.mjs
node scripts/manage-migration-author-lanes.mjs --queue-audit
gh api repos/u2giants/shared-db/branches/main/protection
node scripts/update-required-checks.mjs --add "Orchestrator marker guard" --add "Cancelled work guard"
```

The last one is a dry run and writes nothing; it should report both contexts already present.
