---
issue: 3179
status: OPEN
owner: successor of the #3179 source-data session (this workstream)
---

# #3179 ColdLion /prepackDetail landing — completion evidence and the one outstanding witness

Written by the delegated source-data session that executed #3179 end to end
(ZCode GLM 5.3, machine `edge-dev`, closed 2026-09-18T12:31Z). This is a
non-orchestrator source-data workstream: it changes rows and loader code, not
database structure. The originating session owns closure of #3179; this file
exists because one sub-criterion (the schedule-event witness) cannot be
verified until the next 05:20 UTC scheduled run.

## 1. What this session was doing, and why

Executed shared-db issue #3179 completely: extend the existing ColdLion landing
loader for `/prepackDetail`, add offline tests, open and merge the PRs, run the
sanctioned production backfill, reconcile API and landed counts, and witness
one successful scheduled refresh — without closing #3179 (originating session
owns closure), preserving privacy, and proving the production target before
every write.

## 2. What was actually done (all merged via Guarded Merge with exact-head governed reviews)

| PR | Merge commit | Merged (UTC) | Reviewer / APPROVE head |
|---|---|---|---|
| #3220 loader + 33 tests + 2 workflows | f06a85c3 | 2026-09-17T19:18:44Z | muse @ 9b5a0184 |
| #3225 daily-refresh pacing `--pause-ms 1000` | 644fe066 | 2026-09-17T23:52:04Z | glm @ ee60b98a |
| #3231 identity refusals name both codes | 959100b6 | 2026-09-17T23:07:51Z | grok @ 3111ec8c |
| #3236 guard folds case on prepack key | 056434a9 | 2026-09-18T01:15:22Z | grok @ c0a1c666 |
| #3246 per-key case-folded coverage + drift dedup | 56dc09ba | 2026-09-18T02:49:17Z | grok @ 0270aada |

Routing issues opened and closed by these PRs: #3222, #3224, #3229, #3235,
#3245. Work-contract pairs published at refs/db-contracts/{3179,3224,3229,3235,3245}/*.

Files on `main` (live at handover time): `tools/coldlion-landing/lib/prepack-detail.mjs`,
`tools/coldlion-landing/sync-prepack-detail.mjs`, `tools/coldlion-landing-prepack.test.mjs` (37 tests),
`.github/workflows/coldlion-prepack-backfill.yml`, the prepack step in
`.github/workflows/coldlion-landing-sync.yml`, README section.

## 3. Production state (data rows, written only through the sanctioned workflows)

Backfill COMPLETE — every bounded run proved its target first
(`target postgres at 2600:1f18:…` in each log):

- run 35264306654: 900 keys, 3,589 rows inserted
- run 35266106746: 900 keys, 3,545 rows inserted (resumed exactly at 900)
- run 35300869249: final 777 keys, 2,977 inserted + 4 unchanged
- Total: 2,577/2,577 harvested keys covered, 10,111 rows landed, **0 zero-row keys**

Reconciliation (read-only, run 35306114032, 2026-09-18T05:09Z):
`landed_rows 10111 · landed_distinct_prepack_codes 2575 · harvested_keys 2577 ·
covered_keys 2577 · pending_keys 0 · exclusions 0`. The 2,575-vs-2,577 delta is
the two drifted spellings collapsing onto their canonical landing key, by design.

Idempotence witnessed live (2026-09-18T06:40Z, workflow full refresh):
`landed run 28cc9f0a…: inserted 0, updated 0, unchanged 10111` — no collapse, nothing rewritten.

Preview: nothing was written to preview by this session.

## 4. What is outstanding (the reason this file exists)

**Witness one successful `schedule`-event refresh.** The refresh path completed
green through the workflow on `main` twice (landed runs 2026-09-18T04:30Z and
06:40Z), but both were `workflow_dispatch`; GitHub never created today's 05:20
UTC `schedule` run during an account-wide runner-starvation window (the same
outage starved two of this session's dispatches for 30+ minutes). Verify after
the next 05:20 UTC run:

    gh run list --repo u2giants/shared-db --workflow "ColdLion Landing Sync" \
      --json event,createdAt,conclusion

A `schedule` run created after 2026-09-18T05:20Z whose prepack step logs
`asked 2577 of 2577 … unchanged 10111` completes the criterion. Note the job
also carries the sibling #3180 `/proddetails` step, whose own reconcile has
been failing that job (8 refused keys — THEIR lane, not prepack; see 07:54Z
`reconciliation disagrees` in run 35312282365). A red job conclusion can be
green for prepack — read the prepack step lines, not just the job colour.

## 5. What the successor owns

- Issue #3179 (open; originating session owns closure) — with this file's
  evidence, the only unchecked box is §4.
- No branches, no worktrees, no open PRs from this session (all five branches
  local+remote deleted after proving MERGED; all worktrees removed; the
  `issue-2611-prepack-exclusion` worktree under `C:/repos/shared-db-worktrees/`
  is ANOTHER session's — untouched).

## 6. Exact next action

1. After the next 05:20 UTC scheduled run, run the command in §4 and read the
   prepack step lines.
2. On success: record the run URL as the final completion evidence on #3179 and
   close it (originating session, or successor with its consent per #3179's
   own wording).
3. If the scheduled run's prepack step fails, the enriched refusal names both
   codes — classify before fixing; the vendor drift class is documented in #3235.

## 7. Blocked on

Nothing for this workstream. (Unrelated: GitHub runner starvation delayed
scheduled/dispatched runs all morning on 2026-09-18; it also skipped the 05:20
schedule outright. If it recurs, it is a GitHub-side incident, not repo config.)

## 8. What we tried that did NOT work (mandatory)

- **Identity guard without case folding** (#3231's state): the final slice
  aborted on a real vendor cross-feed case drift (`asked PPk133, row answers
  PPK133`, run 35288752430). Fix: #3236.
- **Case-folded guard with the old cross-key coverage arithmetic**: aborted
  again because the harvest holds BOTH spellings as distinct keys answering one
  spelling (run 35294603177). Fix: #3246's per-key accounting + byte-identical
  row dedup.
- **Deduplication left to the projection stage**: two spellings returning the
  same row hit the projection's duplicate-natural-key refusal — dedup must
  happen in `collectPrepackDetail` before projection (pinned by test).
- **GLM reviewer wrapper without a warmed local service**: `ai-glm doctor`
  flapped (`health endpoint answers` FAIL; ~5 min via the cmd shim vs a 60 s
  preflight budget). Working remedy: `ai-glm server start`, then run the
  review with `REVIEWER_DOCTOR_TIMEOUT_MS=420000`. The qwen draw failure
  (`no reconciled state for qwen`) was the same slow-preflight class.
- **Grok wrapper session reuse (`ask`)**: refused with an unrecognized stderr;
  fresh `new` sessions worked every time.
- **Branch-only workflow dispatch**: `gh workflow run --ref <branch>` 404s for
  workflows not yet on the default branch — the dry-run had to wait for merge.
- **Merging while main moves**: three guarded merges were refused for a stale
  base under the sibling #3180/#3237/#3238 traffic; each time the remedy was
  merge-refresh + contract-pair regeneration + fresh exact-head review. Expect
  this on every code PR in this repo while sibling sessions are active.

## 9. Facts that may already be stale

- `main` was at `56dc09ba` (merge of #3246) at 2026-09-18T02:49Z; later
  commits landed (docs PRs #3237/#3238 and others) — re-derive from
  `git fetch origin` before relying on any SHA here.
- Population counts (2,577 keys / 10,111 rows / 0 zero-row) are the
  2026-09-18T05:09Z reconciliation; the daily refresh changes landed-state
  counts only when the vendor edits recipes.
- The harvest's source mix changes as sibling loaders land (prod_detail began
  contributing 1,933 keys between runs).
- PR/branch states above were verified at 2026-09-18T12:2xZ.
