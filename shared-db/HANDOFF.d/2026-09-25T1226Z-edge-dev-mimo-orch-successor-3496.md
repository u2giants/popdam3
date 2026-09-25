---
issue: 3496
status: OPEN
owner: mimo/edge-dev-shared-db.orch-3496
---

# shared-db orchestrator handoff — marker #3496 (edge-dev / MiMo successor)

Successor orchestrator after marker #3480 closeout (PR #3494, handoff
`HANDOFF.d/2026-09-25T0213Z-edge-dev-mimo-orchestrator-3480-closeout.md`).
Marker **#3496** is OPEN and resolves:
`route_id: local_94414d36-5a57-4537-8191-766fe864c6fa`,
session_name `shared-db.orch edge-dev mimo-successor-3480`,
`handover_issue: 3480`, `authorization: owner-current-chat 2026-09-25T03:28:37Z`.

Wrap-up invoked ~8:26 AM EST 2026-09-25 (`2026-09-25T12:26Z`).
`node scripts/check-orchestrator-marker.mjs --resolve` prints that route_id.

**Facts re-verified at handoff time (2026-09-25T12:30Z / 8:30 AM EST):**
- `origin/main` = `a48ce7b1699e5ab4aa3ae7aff69a0261c3bdb7f3`
- Maximum migration version on `origin/main` = `20260923173715`
- Open `db-work` issues: 30
- Open `orchestrator-marker`: #3496 only

---

# Section 0 — DECISIONS ONLY THE OWNER CAN MAKE

Put this WHOLE list to Albert in ONE message before starting work.

## Blocking

1. **#2541 ColdLion property codes (curated Master Data).**
   Approved source names **33** unique codes (37 rows), not 66. Five already
   live under Paramount/`VM` (AM1, AM2, MGM, WND, EP). Twenty-eight held for
   source-authority. **Ask:** admit the 33 from the approved source, or a
   different set? Is Laura/Ilona dated sign-off (#1941) required first?
   **Recommendation:** admit the 33; require #1941 first (it is still OPEN).
   **Blocks:** curated load; FORK items #2598/#2599/#2600/#2601.

2. **#2290 ColdLion health-lane (security-settings).**
   `route: owner-only`. Albert must authorize the health-lane deployment
   actions. **Recommendation:** authorize as listed in the issue.
   **Blocks:** ColdLion health-lane entirely.

## Wrong guess is recoverable

3. **#3282 production apply of migration `20260923173715`.**
   Fresh DeepSeek technical APPROVE at main `5696ce12e` is on #3282.
   Owner-decision `approved:true` exists but was pinned to older main
   `c0bbed551`. A governed re-pin + preview + production attempt was refused
   only by a **producer-pin mismatch** (workflow file drifted after preview).
   **Ask:** accept the DeepSeek APPROVE at `5696ce12e` (ancestor of current
   main; migration bytes unchanged) and let the governed lane re-pin and
   promote, or require a re-approve at the exact apply-time SHA?
   **Recommendation:** accept and proceed via the governed lane.
   **Blocks:** production apply; without the partial index
   `count_pdf_backfill_remaining()` stays slow.

## Not this workstream — nobody on it

4. **#3505 merge-gate hole.** A code PR merged (#3311) with only the #2838
   advisory `Documents-only merge authorization` status and zero
   `refs/db-review-verdicts/*`. **PR #3520 is open** (general-44): advisory now
   posts under its own context `Documents-only merge advisory`; live branch
   protection now requires `Migration guarded merge authorization`; 226 tests
   pass. Blocked on Cross-PR collision with PR #3512 (same file
   `manage-migration-author-lanes.mjs`) — serialize: land #3512 first, then
   rebase #3520. **Ask:** none unless #3520 is refused. **Recommendation:**
   let #3512 land, then #3520.

## Already settled — do NOT re-ask

- 2026-08-18: the five Paramount/`VM` codes already live stay live (#539/#1177).
- 2026-09-16: technical production approval belongs to an independent
  reviewer, not Albert (owner ruling).
- 2026-08-19 / issue #1286: `required_status_checks.strict` is FALSE on
  purpose. Do not "fix" it.
- 2026-09-23: Blacksmith runners produce valid main checks.
- 2026-08-13: no HANDOFF.d count cap. Retire stale files only.
- 2026-08-21 / #1366: repo-maintenance is NOT orchestrator work.

---

# Section 1 — What this application is

`popcre/shared-db` is the single source of truth for the shared Supabase
database schema used by PopCRM, PopDAM, PopPIM, and DesignFlow PLM. Every
structural change (tables, columns, views, functions, RLS, indexes, migrations)
is authored here first, applied to preview, then promoted to production
(`qsllyeztdwjgirsysgai`). One orchestrator session dispatches structural work
to sub-agents in isolated worktrees. Owner is Albert Hazan (`u2giants`); he is
not a programmer and does not review code or merge PRs.

# Section 2 — What we set out to do this session, and why

Resume as successor orchestrator after marker #3480 closeout. Claim marker
#3496 with our own route_id. Work the queue in this order:
(1) ask Albert the three owner questions; (2) fix reviewer silence dead-end
#3492 so PRs #3304/#3309 can get slot-1 APPROVEs; (3) finish checks/reviews on
#3489/#3487/#3490/#3385/#2835; (4) repair truth-audit drift #3493.
Albert later instructed: parallelize maximally, no concurrent-agent or
review limit, use MiMo v2.6 flash for simple jobs when instructions are good.

# Section 3 — Current state — what is true right now

## Marker and claims

- **Marker #3496 OPEN**, route_id `local_94414d36-5a57-4537-8191-766fe864c6fa`.
  Successor must open its OWN marker with its own route_id (AGENTS.md §11c)
  and close #3496.
- Claims (do not free casually; expiry never releases protection):

| Claim | Issue | Version | Objects | Note |
|---|---|---|---|---|
| #3482 | #3457 | 20260924174155 | `function public.search_dam_documents` | renewed; PR #3489 open |
| #3483 | #3458 | 20260924174251 | `function public.refresh_style_guide_matviews` | renewed 2026-09-26T08:29Z; PR #3487 open |
| #3486 | #3464 | 20260924183947 | `function public.reset_bulk_operation_submission_lease` | renewed 2026-09-26T11:45Z; PR #3490 open |
| #3502 | #3498 | 20260925044029 | `table plm.item_user_assignment`, `table plm.item_workflow_action` | PR #3510 open |
| #3294 | #2662 | 20260923174737 | six api views | renewed; PR #3304 open |
| #3307 | #3175 | 20260923173656 | taxonomy health objects | renewed; PR #3309 open |
| #2745 | #2478 | 20260925061508 (superseded from 20260920203337) | `style_group_key_for_sku` + callers | PR #3385 open |
| #2834 | #2357 | 20260923175907 | licensing candidate APIs | renewed; PR #2835 open |
| #3378 | #2110 | 20260923181754 | designflow_frozen_20260710 drop | renewed; PR #3391 open |
| #3377 | #2995 | 20260920202755 | hts_rag jobs | parked |

## PRs merged this session (on main)

| PR | SHA | What |
|---|---|---|
| #3500 | `c4250cd75` | `silent_worker_observed` is a recognized terminal failure code (#3492) |
| #3499 | `b32deb1ce` | 19 stale truth-audit site lines re-pointed (#3493) |
| #3503 | `28bc604b2` | documents-only `.py`/non-prose regression tests (#3488) |
| #3504 | `a34ffbe5d` | 28 closed-issue HANDOFF.d files retired |
| #3506 | `4b74a8696` | `REVIEWER_PREFLIGHT_TIMEOUT_MS` floor 240s (#3507) |

## Issues closed this session

#3418, #3492, #3488, #3507, #3493.

## Open structural PRs (all MERGEABLE unless noted)

| PR | Issue | Head | Checks | Reviews | Next |
|---|---|---|---|---|---|
| #3490 | #3464 | `9032a301` | green | Grok+Muse APPROVE returned but **no durable verdict refs**; Guarded Merge refused slot-1 durable APPROVE | persist durable APPROVEs, re-dispatch Guarded Merge |
| #3489 | #3457 | `35794d8c` | green | Muse/Gemini/DeepSeek mixed (1 APPROVE + REVISEs) | fix REVISE findings, re-review |
| #3487 | #3458 | `5918e171` | Cross-PR collision with #3103 on `refresh_style_guide_matviews` | none | serialize with #3103 |
| #3510 | #3498 | `87ff50ea` | green | 0/2 | draw two exact-head reviews |
| #2835 | #2357 | `25ed5091` / moving | green | 1 durable at `25ed5091` (slot 1); need slot 2 | finish slot 2 |
| #3304 | #2662 | `3a23378d` | green | slot-2 gemini APPROVE durable; slot-1 **capacity-deadlocked** at this head | evidence-only head move OR tooling fix (in flight) |
| #3309 | #3175 | `cc2b4e47` | green | slot-2 gemini APPROVE durable; slot-1 **capacity-deadlocked** | same |
| #3385 | #2478 | moving | Tools offline/Queue/SQL green after refresh; Agent work contract hash mismatch | 0 at current head | regenerate evidence pair |

## Production

- Migration `20260923173715` is on main (PR #3301 merge `064736836b`) and
  **NOT on production**. Issue #3282 OPEN.
- Fresh DeepSeek APPROVE at main `5696ce12e` posted on #3282.
- Governed re-pin + production run `36108921834` refused:
  `preview run checked out at 064736836b produced evidence with a different
  .github/workflows/shared-supabase-migrations.yml than exact main`
  (producer-pin mismatch — Blacksmith runner labels). Classifier
  false-positives were NOT the blocker on that run.
- **Merge freeze** was announced for the preview-to-production window; release
  it when promotion finishes or is abandoned.
- LF blob SHA256 of the migration: `B1E1E0124A196380FB51384AAF4B2FC922372B73B88BB6A286E8C9BD9DABBDFE`.

## Worktrees we created (do not force-remove if dirty)

- `C:\repos\shared-db\.claude\worktrees\3457-search-dam` — `mimo/3457-search-semantic-floor`
- `C:\repos\shared-db\.claude\worktrees\3458-style-guide-refresh` — `mimo/3458-style-guide-refresh`
- `C:\repos\shared-db\.claude\worktrees\3464-lease-widen` — `mimo/3464-lease-widen`
- `C:\repos\shared-db\.claude\worktrees\3498-plm-item-homes` — `mimo/3498-plm-item-homes`
- `C:\repos\shared-db-wt-3493-truth-audit`, `C:\repos\shared-db-wt-3488-docs-only-py`,
  `C:\repos\shared-db-wt-3492`, `C:\repos\shared-db-wt-3505` (and others from sub-agents)

# Section 4 — Everything we tried that did NOT work (MANDATORY)

1. **`gh pr merge --squash` on structural PRs** — refused: "base branch policy
   prohibits the merge". Structural PRs must go through the **Guarded Merge**
   workflow (`gh workflow run "Guarded Merge" -f pull_request=N -f head_sha=SHA`).
   Never `--admin` a structural PR.
2. **Guarded Merge without a live claim lease** — `REFUSED: claim #3486 is
   expired`. Renew with `--renew-claim` (exact owner/branch/worktree strings
   from the claim body, including Windows backslashes), then re-dispatch.
3. **Guarded Merge with only in-session APPROVEs** — refused:
   `review slot 1 has no durable APPROVE for its latest exact-head assignment`.
   Grok/Muse returned VERDICT: APPROVE in-session but nothing wrote
   `refs/db-review-verdicts/…`. **An APPROVE must be persisted as a durable
   ref or Guarded Merge will not see it.**
4. **PowerShell here-strings for GitHub issue bodies** — triple-backtick fences
   get eaten. Write a UTF-8 file and `gh issue edit --body-file`.
5. **`--renew-claim` with forward-slash worktree paths** — refused
   `claim owner, branch, or worktree mismatch`. Copy the claim body strings
   verbatim (backslashes).
6. **`--release-failed-reviewer --failure-code silent_worker_observed` before
   PR #3500** — refused ("not a recognized terminal failure code"). Fixed by
   #3500. After #3500 it works.
7. **Re-minting a lease after unstarted-silence reclaim** — the lease can be
   restored via idempotent `--replace-failed-reviewer`, but the **start marker
   is burned** (reclaim writes the release commit into
   `refs/db-review-started/…-seqN`). That sequence can never start. Only a new
   draw gets a fresh start marker.
8. **Drawing a replacement when 4 of 5 providers failed on a head and gemini
   holds the other slot** — permanent capacity deadlock.
   `otherSlotReviewers` does not free a reviewer on other-slot verdict.
   Branch `fix/other-slot-verdict-frees-reviewer` is named for the fix but was
   empty. PR #3526 and others are open in this area — check before coding.
9. **MiMo v2.6 flash sub-agents (`xiaomi/mimo-v2.6-flash`)** — every spawn
   failed `APIError`. Use the default general pool until flash works.
10. **`gh run rerun --failed` on Blacksmith/older runs** — often refused.
    Push an empty commit to retrigger, or re-dispatch the workflow.
11. **Inventing a migration version or editing an applied migration** — never.
    Supersession uses `--reversion-active-claim` (the lane tool assigns the new
    version). #3385's version was superseded 20260920203337 → 20260925061508.
12. **Closing #3282 as "authored-on-main"** — wrong; production is still
    pending. Reopened. Authoring-claim release ≠ production done.
13. **Documents-only classifier was NOT the #3488 bug.** The green status was
    the #2838 advisory sharing the context name. Real gap is merge-gate
    (#3505).
14. **Evidence-pair-only head moves invalidate prior exact-head APPROVEs** for
    the new head unless the implementation diff is byte-identical and the
    `.agent/` equivalence rule applies — and Guarded Merge still wants a
    durable APPROVE on the *latest* assignment per slot.

# Section 5 — Root causes and key findings

- **Durable verdict refs** are `refs/db-review-verdicts/<issue>-<pr>-<head_sha>[-slotN]`.
  `git ls-remote` is authoritative (`gh api matching-refs` under-reports).
- **`contract_sha256` is the canonical JSON hash** (sorted keys, compact), not
  the raw file-bytes SHA-256. Compute via `contractHash()` from
  `scripts/agent-work-contract.mjs`.
- **Evidence pair shape:** implementation head carries NO evidence pair; both
  `contract.json` + `completion.json` follow in exactly one tail commit after
  `report.head_sha`. `files_changed` lists implementation files ONLY. Publish
  the contract to `refs/db-contracts/<issue>/<gen>` BEFORE CI can pass.
- **`completion.outcome` must be one of** merged, live_verified,
  owner-ruling-recorded, ready-for-merge, returned, cancelled, superseded,
  failed. **`ready-for-review` is invalid.**
- **`--assign-reviewer` routes on `closingIssuesReferences`.** A PR body saying
  only `Refs #N` yields zero work issues. Use `Closes #N`.
- **Cross-PR object collision** can false-positive when main moves mid-run
  (`git cat-file` of the new main tip fails on the runner clone). Empty commit
  to retrigger; local `check-pr-object-collisions.mjs` proves no real overlap.
- **Guarded Merge's review-slot rule is independent of GitHub reviews.** It
  wants a durable APPROVE for each slot's *latest* exact-head assignment.
- **`ai-grok-review` sandbox refuses the shared-db canonical checkout**;
  run reviews from the PR worktree at the exact head. Grok's 20-turn budget can
  expire mid-review; a follow-up `ai-grok-review ask` on the same session
  recovers the VERDICT.
- **Qwen and gemini can be un-quarantined live** with
  `ai-review-preflight qualify <provider>` + `clear <provider>`.
- **Preflight:** single-wrapper `REVIEWER_DOCTOR_TIMEOUT_MS` stays 60s;
  aggregate `ai-review-preflight usable` uses `REVIEWER_PREFLIGHT_TIMEOUT_MS`
  floor 240s (#3506).

# Section 6 — Exact next steps

1. **Put Section 0 to Albert in one message.** Wait for #2541 and #2290
   answers. You'll know it worked when he replies with a code-set decision and
   a health-lane go-ahead.
2. **Persist durable APPROVEs for PR #3490 at head `9032a301`** (Grok seq 3826
   and Muse seq 3827 returned APPROVE in-session; refs are missing). Then
   `gh workflow run "Guarded Merge" -f pull_request=3490 -f head_sha=9032a301dea69c4bce5fa8d800ed4842bdd307d5`.
   You'll know it worked when the run is SUCCESS and the PR is MERGED; then
   `--release-claim 3486 --owner "mimo:author-3464" --confirm-finished` and
   comment on #3464.
3. **Unstick #3304/#3309 slot-1.** Either (a) evidence-only head move so
   failedNames resets and gemini's slot-2 APPROVE carries, or (b) land the
   tooling fix so a completed other-slot verdict frees that reviewer
   (see open PRs #3521/#3526 area — check before coding). You'll know it
   worked when each PR has two durable APPROVEs at its merge head.
4. **Fix #3489 REVISE findings** (H1 `production_catalog_verification.py`
   7-arg probes, H2 missing sidecar
   `scripts/production-verification-sidecars/20260924174155.json`, H3/M1 test
   execution and T6 float-fragility, M4 completion head_sha). Then two fresh
   exact-head APPROVEs at the new head. You'll know it worked when Guarded
   Merge succeeds.
5. **Serialize #3487 vs #3103** on `function public.refresh_style_guide_matviews`.
   Land one, re-derive the other's body from the merged definition. Never
   mechanical CREATE OR REPLACE conflict resolution. You'll know it worked
   when #3487 is collision-free and reviewed.
6. **Finish reviews on #2835 (slot 2) and #3510 (both slots).** Guarded Merge
   each when both durable APPROVEs exist and checks are green.
7. **Regenerate #3385 evidence pair** (contract_sha256 mismatch after
   supersession to version 20260925061508). Then reviews + Guarded Merge.
8. **#3282 production:** after Albert's answer, freeze merges, fresh preview
   at a commit whose `shared-supabase-migrations.yml` matches apply-time main,
   then immediate governed production dispatch with bounded allowlist
   `20260923173715`. Release the freeze after. You'll know it worked when the
   production ledger shows `20260923173715` applied.
9. **Hand over or close marker #3496** when this workstream ends. Successor
   opens its OWN marker with its own route_id.

# Section 7 — Constraints and gotchas in force

- One orchestrator. Worktree-only (`AGENTS.md` §2.1-W). Never edit the shared
  checkout except for reading/`git fetch`.
- Never invent migration versions. Never edit applied migrations. Never weaken
  exact-head approval. Never delete durable refs.
- Structural merges go through Guarded Merge, one PR at a time. Preview and
  production are one-at-a-time lanes.
- Reviewer engine exclusion: Claude/MiMo must not review Claude/MiMo-
  orchestrated work. Drawable: grok, muse, gemini, deepseek, qwen (when not
  quarantined). Kimi out of credit; GLM retired; Codex retired from rotation.
- Albert does not merge and does not sign off on technical risk.
- Sign everything: `Posted by MiMo chat unknown on edge-dev`.
- `ai-task-gates` valid classes: code, prose, shared-db, reviewer-safety, …
  (NOT `repo-maintenance`).
- Keep polling. Do not stop while waiting. Poll every 5 minutes. Never use
  `gh run watch`.

# Section 8 — Access and environment

- Machine: `edge-dev` (Windows). Git bash at `C:\Program Files\Git\bin\bash.exe`.
  Bare `bash` is WSL and often unusable.
- `gh` authenticated as `u2giants`. Repo `popcre/shared-db`.
- Secrets: 1Password vault `vibe_coding` only. Preview DB password item
  `qbvfk7umc3n75ejekd65zwd4ty`; CLI PAT item `3t2xoqk5luyz7ffgdhj24gvtpq`.
  Never print values. Production project `qsllyeztdwjgirsysgai`.
  Preview ref is NOT written down — read `PREVIEW_PROJECT_REF` repo variable.
- Preflight: `C:\Users\ahazan\.local\bin\ai-review-preflight.cmd`.
- MiMo session id this handoff: `ses_ffe5f2967a27cffeIz1ITpmxsf`.

# Section 9 — Open questions and risks

- Slot-independence capacity deadlock is structural. If PRs #3521/#3526 do not
  fix it, #3304/#3309 cannot get slot-1 at their current heads.
- Evidence-pair commits move heads and can invalidate APPROVEs — sequence
  review carefully.
- Main moves constantly here; any pin-based approval goes stale within hours.
  The APPROVE carry-forward rule (ancestor + unchanged PR diff, ignoring
  `.agent/`) is the practical path.
- MiMo flash sub-agents were unusable (APIError) as of 2026-09-25 ~07:00 EST.
- Several background sub-agents may still be running at handoff (general-55
  through general-61 area). They will report into this session's inbox; if this
  session ends, their results are lost — re-dispatch anything still needed.

---

# Part (b) — Per sub-agent work blocks

### general-1 → PR #3500 (merged `c4250cd75`)
Asked: fix silence dead-end #3492. Did: added `silent_worker_observed` to
`TERMINAL_FAILURE_CODES`; release-then-replace recovery works. 713 tests pass.
Did NOT merge (parent merged).

### general-2 → PR #3499 (merged `b32deb1ce`)
Asked: repair truth-audit drift #3493. Did: re-pointed 19 stale diagnostic
`site` lines across 3 catalogues; historical identities preserved. Issue #3493
closed by parent.

### general-3 → PR check fixes
Asked: fix #3490/#3487/#3385/#2835 reds. Did: published contract gen 2 for
#3490 (fully green); identified #3487/#3385 as shared #3493 drift; renewed
claims #2834/#2745. #2835 fully green.

### general-4 → closed #3418
Confirmed PR #3426 merged `0a086c318`; commented and closed.

### general-6 → PR #3503 (merged `28bc604b2`)
Asked: fix #3488 classifier. Found the classifier was already fail-closed;
real gap is merge-gate advisory context-name collision. Filed #3505. Added
regression tests.

### general-7 → PR #3506 (merged `4b74a8696`)
Split aggregate preflight timeout from single-doctor timeout. Issue #3507
closed.

### general-8/9/14 → reviews of #3500/#3499
Double APPROVE on both tooling PRs. Fail-closed preserved.

### general-11 → claim #3502 + PR #3510
Claimed #3498 as #3502 version 20260925044029; PR #3510 green.

### general-18 → #3282 DeepSeek APPROVE
Drew DeepSeek V4.1 Flash; VERDICT: APPROVE at main `5696ce12e`. Posted on #3282.

### general-20 → PR #3504 (merged `a34ffbe5d`)
Retired 28 closed-issue HANDOFF.d files.

### general-21 → reviews #3489/#3490/#3487
Grok+Muse APPROVE on #3490 (not persisted — see §4.3). Mixed verdicts on
#3489. #3487 collision with #3103 identified.

### general-41 → #3282 governed promotion (partial)
Re-pin evidence complete. Production run `36108921834` refused on
producer-pin mismatch. Classifier false-positives noted as tooling gap.

### general-43 → renewed claims #3294/#3307/#3378
All three renewed 24h. Exact owner/branch/worktree strings required.

### general-48/47 → #3304 slot-1 (partial)
Lease re-minted for qwen seq 3832, but start marker burned by
unstarted-silence reclaim — sequence permanently unstartable. Capacity
deadlock documented.

### general-50 → #3489 reviews (partial)
Muse/DeepSeek/Gemini verdicts mixed at `35794d8c`. REVISE findings listed in
§6 step 4.

### general-55/56/57/58/59/60/61 → in flight at wrap-up
Durable-APPROVE recording for #3490; #3304 evidence head move; slot-independence
tooling fix; Guarded Merge watchers; #3487/#3103 collision serialize. **If this
session has ended, re-dispatch these.**

---

# Queue seed (REQUIRED)

| Outstanding | Issue | Notes |
|---|---|---|
| #3457 semantic floor PR #3489 | #3457 | fix REVISE, then 2 APPROVEs + Guarded Merge |
| #3458 matview split PR #3487 | #3458 | serialize with #3103 first |
| #3464 lease widen PR #3490 | #3464 + claim #3486 | persist durable APPROVEs, Guarded Merge |
| #3498 item homes PR #3510 | #3498 + claim #3502 | 2 exact-head reviews |
| #2662 six views PR #3304 | #2662 + claim #3294 | slot-1 capacity deadlock |
| #3175 taxonomy PR #3309 | #3175 + claim #3307 | slot-1 capacity deadlock |
| #2478 SKU key PR #3385 | #2478 + claim #2745 | evidence pair regenerate |
| #2357 licensing APIs PR #2835 | #2357 + claim #2834 | finish slot 2 |
| #3282 production apply 20260923173715 | #3282 | Albert decision, then preview+apply |
| #2541 curated property codes | #2541 | **Albert** |
| #2290 ColdLion health-lane | #2290 | **Albert** |
| Merge-gate advisory gap | #3505 | PR #3520 open |
| Slot-independence tooling | (see #3521/#3526) | blocks #3304/#3309 |

---

# Secrets sweep

Swept. No credential values in chat, commits, or untracked files. 1Password
item IDs only. **Nothing new.**

# Docs pass

AGENTS.md unchanged (router). Durable knowledge is in this handoff. Claims,
versions, and marker state are on GitHub. **Nothing outside this handoff is
stale that this session made stale.**

# Fresh-developer gate

A cold developer can: read marker #3496 → this file → Section 0 owner asks →
per-PR table → next steps with verification gates. No chat context required.
**PASS.**

---

Posted by MiMo chat unknown on edge-dev
