---
issue: 107
status: BLOCKED
owner: zcode-chat-unknown@hetz
---

# PopSG #107 → shared-db #4437 — stage 1 proven to preview, PR parked, successor resume path

Supersedes `HANDOFF.d/20261025T2355Z`'s file and `HANDOFF.d/20261026T0525Z-hetz-zcode-popsg-107-4437.md`
(https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/20261026T0525Z-hetz-zcode-popsg-107-4437.md).
Facts checked 2026-10-26 ~11:35 AM EST unless noted.

## 1. What this session did

Resumed claim #4771 (PopSG semantic search stage 1), hardened the stage-1
migration until it actually applies, took the governed review, fixed every
finding, proved the change on preview, and shipped the worker-side coverage
meter. Stage 1 is NOT merged: the round-2 reviewer draw is blocked by a
shared-db tooling defect, and per the handover rules the claim was natively
released with `--park`.

## 2. Exact state of every artifact (verified at write time)

- **Migration** `20261025180137_popsg_semantic_search_foundation.sql` — on
  branch `zcode/popsg-4437-semantic-search` (kept), carried by **PR
  popcre/shared-db#4772, now CLOSED (parked, reopenable)** with a resume note:
  https://github.com/popcre/shared-db/pull/4772. Version reservation
  `refs/db-claims/20261025180137` exists and is NOT retired — a successor can
  revive the work; the version stays permanently reserved.
- **Claim #4771** — CLOSED by explicit owner-confirmed release
  (`--release-claim --confirm-finished --park`), owner `zcode-chat-unknown@hetz`.
- **Preview** — migration APPLIED clean (run 40343408828; dry-run 40342634199)
  including the ~217k-row content-identity backfill and every in-migration
  verification. Production: **nothing applied**.
- **Worker wiring** — MERGED: popdam3 PR #507 (`sg-embed-search` operation,
  coverage meter via `get_sg_search_embedding_status`; UI registry synced).
- **Contract test** `supabase/tests/popsg_semantic_search_foundation_contracts.sql`
  (contracts 1–11) plus the corrected contract 16 in
  `popsg_bounded_crawl_and_search_contracts.sql` — all green in CI runs
  40323517786 / 40326035704 / 40329171968.
- **Work contract evidence**: generation 6 (live pair `.agent/work/4437/6/`,
  ref `refs/db-contracts/4437/6`); generations 1–5 are superseded but published.
- **Issue #4437 scope** currently lists the stage-1 object set (11 objects);
  stage 2's PR will need it moved to `function public.search_style_guide_library_v2`
  (audit comments on the issue explain the lockstep requirement).

## 3. The blocker — shared-db #4797

https://github.com/popcre/shared-db/issues/4797 — the paid-review budget proof
refuses BOTH legal branch topologies after main changed the stored-hash
baseline beyond pins: a rebase orphans the round-1 paid start
("first-parent ancestry unavailable"); a merge fails the canonical stored-hash
bridge ("stored hash conflict changes other bytes"). Also recorded as reviewer
incident 20261026T144004Z-hetz-deepseek-4178583 (synced). The reviewer itself
is healthy; round 1 (deepseek, seq 7159) returned a well-formed REJECT whose
findings are all fixed on the current head.

## 4. Resume path (exact, in order)

1. Wait for / fix #4797 (a successor session owns it; the issue has the full
   reproduction).
2. Reopen PR #4772 and re-claim the 11 stage-1 objects (the PR park note lists
   them) — fresh claim under issue #4437, new worktree, same version via
   recovery or a reissued version per the lane rules.
3. If main moved again, merge main into the branch (NOT rebase — see §5) and
   re-record the detector baseline hash per the #4761 precedent.
4. Re-run the CI matrix. GitHub pull_request events were frozen repo-wide from
   2026-10-26T04:30Z; the repo's dispatch recovery (`gh workflow run
   database-contract-tests.yml --ref <branch>` etc.) works and is how every
   green run on this PR was produced. Check events first; use dispatch only if
   still frozen. `Migration Author Lease` needs a fresh `--check-in-author` at
   the exact head before its job runs.
5. Draw the reviewer: `--assign-reviewer --issue 4437 --pr 4772 --head-sha <head>
   --admit-issue 4437` with `SHARED_DB_AUTHOR_ENGINE=zcode`; run the governed
   review (runner needs `AI_DEEPSEEK_CALLER`/`AI_IMPLEMENTER_ENGINE=zcode`, a
   clean worktree, and no leftover `.agent/work/4437/{1..5}` dirs).
6. APPROVE → guarded merge → automatic production promotion → verify.
7. Stage 2: regenerate from the recipe in the 0525Z handoff §6 (three-arm
   union, `operator(extensions.<=>)`, ANN limit 2000, ef_search 100, floor on
   semantic candidates only, drop the 15-arg overload, pin
   `statement_timeout='30s'`; verify md5 `1dfc9194a2288feb3a0feace89487f78`).
   A copy sits on hetz at `/worksp/popdam/.ai/popsg-4437/stage2-migration-draft.sql`
   (machine-local convenience only — regenerate per the recipe if absent).
   Stage 2 updates `popsg_search_style_guide_library_v2_contracts.sql` (it pins
   the 15-arg signature).
8. Worker GPU loop (claiming via `claim_sg_search_embedding_documents`) is the
   remaining app-side piece for coverage; the query tower service
   (apps/text-embed) already exists.
9. Acceptance drills + live proof stay on u2giants/popdam3#107.

## 5. What we tried that did NOT work (do not repeat)

- Trusting a green draft PR: the stage-1 migration never replayed from empty —
  CI only WARNED until a contract test made it fatal.
- `pg_get_function_identity_arguments` never renders typmod; schema-qualifies
  only when the schema is off search_path. ON CONFLICT SET must use the insert
  alias. Unqualified `digest(` under `search_path='public'` fails at runtime.
- Rebase after a paid review start: breaks the budget walk. Merge instead —
  but see #4797 for the merge's own wall.
- `--release-failed-reviewer` requires certifying no-verdict/no-artifact —
  false after a real REJECT; never sign it.
- Editing `scripts/test_production_catalog_verification.py` with text-mode
  python rewrites its CRLF wholesale; edit bytes. Any edit to
  `production_catalog_verification.py` needs the detector baseline hash
  re-recorded (`docs/verification/throughput-guard-truth-baseline-20260828.json`).
- The evidence pair must be the TAIL commit, its completion's head must contain
  the current merge base, and contract db_writes must equal the issue scope AND
  the PR's parsed objects exactly.
- `gh pr checks` lies during the event freeze; use
  `gh api /commits/<sha>/check-runs`.

## 6. Facts that may already be stale

Main tip was 31ce85a4 (checked ~11:30 AM EST; PR #4799 merged at 10:55 AM).
GitHub pull_request events frozen since 04:30Z — may have recovered. The
19 pre-existing worker-suite test failures in popdam3 exist on main without
this session's changes (verified by stash).

## Secrets

Swept, nothing new: the only credential-shaped value this session created was
a throwaway docker Postgres test password; 1Password items were only read by
the predecessor session.

— Posted by ZCode chat unknown on hetz
