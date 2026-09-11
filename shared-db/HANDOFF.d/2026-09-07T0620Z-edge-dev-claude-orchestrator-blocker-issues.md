---
issue: 2494
status: BLOCKED
owner: claude/handover-orch-6172c135
---

# Orchestrator session closeout — top-5 blocking issues

Session `local_6172c135-431f-44c1-9b85-50bc744d7131`, marker issue #2472, machine edge-dev.
Every fact below was re-verified against `origin/main` at **2026-09-07T06:16Z**.

## 1. What this session was asked to do

Run a governed shared-db orchestrator session and resolve the five open GitHub issues
that block the most other issues. Later in the session Albert also asked to put Kimi K3
back in the reviewer rotation and to open an ai-devops issue about reviewer concurrency
(both done), then issued a CONDITIONAL wrap-up: "only when all tasks are complete, don't
start any new tasks."

## 2. What was actually done

All five blockers are landed. `origin/main` is now `88b17b817c276980b7f971639385133f38546111`.

| Issue | PR | Merge SHA | Migration |
|---|---|---|---|
| #2408 | (earlier) | — | 20260906035323 — **merged, NOT promoted to production** |
| #2355 | #2415 | (merged earlier in session) | 20260906222338 |
| #2334 | #2409 | `842699455afa6938932fd9adc4add2c472883325` | 20260907030418 |
| #2419 | #2474 | `f4b3fe6835ba42ac91e8c5201650c0abb8f65b68` | 20260907031246 |
| #2335 | #2490 | `88b17b817c276980b7f971639385133f38546111` | 20260907051735 |

For each: two independent governed reviewer APPROVEs bound to the exact head, guarded
merge via `guarded-migration-merge.yml`, immutable completion record via `--complete-work`,
claim released, issue closed. Claims released: #2405 (#2334), #2473 (#2419), #2489 (#2335).

Also this session: PR #2484 merged, retiring `codex-gpt-5.6-sol` from the reviewer pool
(pool is now five: grok-4.6, glm-5.3, kimi-k3, muse-spark-1.2-contributor, gemini-3.8-flash-high).
Issue #2486 closed (already fixed on main by #2430). ai-devops issue #304 opened for
reviewer concurrency.

## 3. Preview and production

**Nothing was applied to preview or to production by this session.** No data rows were
written to the shared preview project.

`20260906035323` (issue #2408) sits merged on main and unpromoted. That is the single
remaining item and it needs Albert — see section 7.

## 4. Half-finished or abandoned

Nothing. Every branch this session opened is merged and its worktree retired.

## 5. What this session owns

Nothing live. All four author worktrees and all seventeen review worktrees were removed
after their PRs were confirmed MERGED via `gh pr view`; the four local branches were
deleted. `.claude/worktrees/lane-main` remains — it is a clean checkout of current main
created because **session worktrees carry a stale copy of the lane governor script**, see
section 8. The next orchestrator may keep or remove it.

The nine other open PRs (#2452, #2447, #2425, #2278, #2264, #2260, #2245, #2237, #2205)
belong to OTHER sessions. This session did not touch them.

## 6. What was about to happen next

Nothing further in scope. The wrap-up scope freeze was in force from the moment Albert
invoked it, so everything found after that point was written into an issue rather than
worked on.

## 7. Blocked on

**Albert, one question:** may the merged database change `20260906035323` be applied to
the live shared database? AI sessions are read-only for production unless he names the
exact database and action in chat. Tracked as **#2494** (`needs-albert`).

## 8. What did NOT work — mandatory

- **`--assign-reviewer` drew the RETIRED `codex-gpt-5.6-sol`.** The cause was that this
  session's own worktree held a copy of `scripts/manage-migration-author-lanes.mjs` that
  predated the #2484 merge. A stale local copy silently reintroduces retired reviewers.
  Fix: run every lane and governed-review command from a worktree created at current main
  (`lane-main`). **Do this from the start of the next session.**
- **The freshness-versus-verdict conflict cost more than anything else.** Every merge to
  main makes every other open PR stale; `gh pr update-branch` then moves the head and
  voids every durable verdict, forcing a complete re-review. PR #2490 was reviewed and
  approved twice for this reason (once at `7bc2eec8`, again at `194b4f45`). Run the last
  three steps — update branch, review, merge — back to back, one PR at a time.
- **`--release-claim` takes the claim number POSITIONALLY.** `--release-claim 2489 --owner
  "<exact owner>" --confirm-finished`. Passing `--claim-number` gives
  `REFUSED: unknown argument`. Success prints NOTHING; verify with `gh issue view`.
- **The lease check reads the CLAIM issue's `writes:` list, not the work issue's.** PR
  #2490 failed "migration writes undeclared objects" for three indexes and two policies.
  Editing issue #2335 changed nothing. The correct fix is
  `--expand-active-claim-from-pr --issue --claim-number --pr --owner --branch --worktree
  --head-sha`, which reads the objects out of the PR itself. Never hand-edit a claim block.
- **grok-4.6 produced no verdict on the 1798-line #2409 migration** (third occurrence).
  Released as `turn_limit_cancelled` and replaced. Filed as **#2492**.
- **"RECOVERY REQUIRED" on `refs/db-coordination/author-acquisition` is a known false
  alarm** from eventual consistency. Verify with `git ls-remote origin
  refs/db-coordination/author-acquisition` — empty means released. Do NOT invoke
  `recover-author-mutex.yml` on this alone.
- **There is no sidecar generator.** `scripts/production-verification-sidecars/*.json` is
  maintained by hand: marker line ranges and the LF-normalised `migration_sha256` must be
  recomputed whenever the migration changes, and the file path must be appended to
  `PREVIEW_PRODUCER_PATHS` in `scripts/production_business_risk_gate.py` or
  `test_every_verification_sidecar_is_an_individually_pinned_producer` fails.
- **Both merge dispatches for #2490 were refused once each** for main having moved past
  the dispatched commit. The refusal names the current tip; re-dispatch after
  `gh pr update-branch` and a fresh review.

## 9. Facts that may already be stale

- `origin/main` = `88b17b817c276980b7f971639385133f38546111`, read 06:16Z.
- Maximum migration version = `20260907051735`, read 06:16Z.
- Nine other open PRs, listed above, read 06:16Z.
- The reviewer pool of five and the `RETIRED_REVIEWERS` list, read from the merged lane
  script at 05:30Z.
- `--queue-audit` output from earlier in the session: `REFILL REQUIRED NOW: #1671, #2045,
  #2432, #2434`; expired author leases on claims #2443, #2451, #2418 (all other sessions');
  #2290 RETURN-TO-OWNER; #1941 FORK curated-master-data. **Re-run `--queue-audit` rather
  than trusting this list.**

## Sub-agent blocks

### Agent: issue-2355-character-alias (worktree retired)
- **Asked to do:** author migration 20260906222338 for issue #2355, character alias and source provenance.
- **Actually did:** authored the migration and its 900-line contract test file; landed as PR #2415.
- **Found:** the shared normalizer in `20260731150000_popsg_property_resolution_contracts.sql` is immutable and could be relied on.
- **PR / branch:** #2415 MERGED; branch deleted.
- **Worktree:** finished, removed.
- **Deliberately did NOT do:** did not touch the pre-existing global unique key importers depend on.

### Agent: issue-2334-canonical-bridges (worktree retired)
- **Asked to do:** author migration 20260907030418 for issue #2334, canonical licensing relationship bridges.
- **Actually did:** authored the migration, the contract tests, and the sidecar. After Kimi returned REVISE, scoped `core.require_support_edge_licensor_matches_endpoints()` to return early on an UPDATE whose two endpoints and `licensor_id` are all unchanged, mirroring `core.guard_taxonomy_source_ref_identity()`, and added five regression tests as section 6d. Then rebound the sidecar (markers 210/320/333/446, review 3 range 415-425 to 424-459, hash `c9cbe49c...`).
- **Found:** the unscoped guard made a stale assertion permanently un-withdrawable — a genuine HIGH defect the first review round caught.
- **PR / branch:** #2409 MERGED as `8426994...`; branch deleted.
- **Worktree:** finished, removed.
- **Deliberately did NOT do:** left endpoint re-parenting unguarded (a Low finding: re-licensing an endpoint later leaves old support rows under the old licensor). Not filed as an issue — raise it if it recurs.

### Agent: issue-2419-style-group-reconciler (worktree retired)
- **Asked to do:** author migration 20260907031246 for issue #2419, style group drift reconciler.
- **Actually did:** authored the migration and `supabase/tests/style_group_drift_reconciler_contracts.sql`; landed first time with two APPROVEs (kimi, muse) and no revision round.
- **PR / branch:** #2474 MERGED as `f4b3fe68...`; branch deleted.
- **Worktree:** finished, removed.
- **Deliberately did NOT do:** nothing withheld.

### Agent: issue-2335-source-authority (worktree retired)
- **Asked to do:** author migration 20260907051735 for issue #2335, licensing source authority and relationship decisions.
- **Actually did:** authored a 914-line migration (three columns on `plm.source_resolution`, new tables `plm.licensing_source_scope` and `plm.licensing_relationship_resolution`, three indexes, two authenticated-read policies, a new 12-argument setter), a 581-line contract test, and the sidecar; then registered the sidecar in `PREVIEW_PRODUCER_PATHS` after the risk-gate test failed.
- **Found:** `plm.source_resolution_target_missing()` and the `api.source_resolution` view do not understand the new entity kinds, so a matched licensor/franchise decision still reads `target_missing = true`.
- **PR / branch:** #2490 MERGED as `88b17b81...`; branch deleted.
- **Worktree:** finished, removed.
- **Deliberately did NOT do:** left `source_resolution_target_missing()` and the view alone because they were outside the object claim, and pinned the current behaviour with a test so the successor gets a FAILING test rather than a silent change; left the frozen 10-argument setter in place beside the new 12-argument one. Both filed as **#2493**.

## Queue seeded this session

- **#2491** — preview apply evidence never matches an already-applied version.
- **#2492** — grok-4.6 produces no verdict on large migrations.
- **#2493** — successor to #2335: `target_missing` and the `source_resolution` view.
- **#2494** — OWNER DECISION: promote `20260906035323` to production.
- **ai-devops#304** — allow a reviewer to run more than one job at a time on different topics.
- Already open and still outstanding: #1671, #2045, #2432, #2434 (refill), #1941 (FORK, curated-master-data), #2290 (RETURN-TO-OWNER, security settings).

## Secrets sweep

Swept the session — chat, the diff, and every scratch file. **Nothing new.** No credential
appeared, none was written to a file, and nothing needed storing in `vibe_coding`.

## Documentation pass

Nothing outside this handover is stale. The lane governor, `AGENTS.md`, and the
orchestrator skill all still state true things; the corrections this session learned are
mechanical usage facts recorded in section 8 above and in the four seeded issues.
