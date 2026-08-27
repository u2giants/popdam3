---
issue: 1665
status: OPEN
owner: codex/orchestrator-1649-closeout
---

# Orchestrator #1649 closeout

Checked live at **2026-08-27 15:47 UTC** unless a later time is stated. GitHub and database state can change after that timestamp; re-derive it before acting.

## 0. Decisions only the owner can make

### Blocking

1. **#1646 production promotion.** Migration `20260827095753` has a successful bounded production dry-run but was not applied because this session did not receive explicit authorization for that exact CRM customer-domain clearing change. Recommendation: authorize only after the successor re-derives current `main`, review evidence, and the single-version dry-run. This blocks #1646 production completion. The issue carries `needs-albert`.
2. **Pre-existing owner-decision issues #1609 and #1353.** Both remain open and now carry `needs-albert`. They were not worked in this session. Recommendation: answer them in their own issue context; #1353 is security-settings work outside the orchestrator.

### Already settled — do not re-ask

- 2026-08-27: contract assertions and direct captured OPA assertions are independently authoritative within what each explicitly asserts; disagreement fails closed. DCP/ASGARD Creative placement, normalized names, core ownership, source labels, and landing families never establish ownership (#1658).
- 2026-08-27: `mgCategory` is derived only from division-qualified MG01 and only for items created on or after 2025-05-14 until a separate, fully verified historical reclassification retires the cutoff (#1662).
- 2026-08-27: Kimi was excluded only for the remainder of the outgoing chat session after exhausting usage. No repository-wide rotation change was authorized or made.

The successor should put the complete blocking list above to Albert in one message, not one item at a time.

## 1. What this application is

`u2giants/shared-db` is POP Creations' canonical, public repository for the structure and cross-application contracts of the shared Supabase database used by CRM, DAM, PM/PIM, DB Data Admin, and DesignFlow PLM. Structural changes are isolated by exact object claims and migration versions, reviewed, rehearsed on the protected preview project, merged through a guarded workflow, and promoted to production through evidence-bound workflows. GitHub issues labelled `db-work` are the queue.

This session was the sole orchestrator identified by marker #1649 and route id `01a042f6-5d3d-76d1-8571-1fdd64dae010`. Its job was coordination, dispatch, review, preview/merge/production gates, and truthful queue state—not authoring schema in the orchestrator checkout.

## 2. What we set out to do, and why

The session opened to coordinate the live queue, then prioritized:

1. finish #1607, DesignFlow Sample Tracking Flow 4 remote requests/reservations, through production;
2. recover three expired-but-preserved author lanes (#1452, #1259, #1467);
3. author urgent #1658, the assertion-specific contract/OPA authority correction for DCP Creative presentation;
4. author #1645, effective PopDAM tag/identity filters with facet-count parity;
5. accept but not start #1662 after Albert ordered this broken session to stop taking new work; and
6. leave every unfinished gate in a live issue before closing marker #1649.

## 3. Current state — what is true now

### Moving facts

- `origin/main`: `62dbb874dba80654df90c167908fe3d0a5610d43` at 2026-08-27 15:47 UTC.
- Highest migration on that checkout: `20260827114625`.
- No `author-acquisition`, preview, merge, or production coordination ref was present at the final sweep.
- No GitHub Actions run was in progress at the final sweep.
- Every worktree named below remains intentionally present. Do not clean it until its PR is merged or its protected review artifacts are preserved.

### Finished: #1607

- Issue #1607 is closed with an immutable successful completion record.
- PR #1623 merged as `62dbb874dba80654df90c167908fe3d0a5610d43`.
- Migration `20260827114625` replaced the backdated original version through governed supersession.
- Preview apply run `33074895745` succeeded.
- Guarded merge run `33075056310` succeeded.
- Production review run `33075354282`, bounded dry-run `33075396028`, and production apply `33075591451` succeeded.
- The production workflow re-read the ledger, ran catalog verification, saved evidence, and released its lock. This is production-live, not merely merged.

### Open work, exact state and order

1. **#1658 / claim #1659 / PR #1660 / migration `20260827134155`.** Branch `codex/issue-1658-opa-authority-1649`, head `d15a69a825cbf0d365b1ffac825a2db4c22db63b`. All checks green. Governed Muse sequence 416 APPROVED with no Critical/High/Medium findings after Kimi sequence 415 exhausted quota and returned no verdict. No preview, merge, or production. Next gate: preview dry-run/apply, guarded merge, production evidence/dry-run/apply, direct aggregate verification, then report the final private-loader contract to source task `01a03a84-ce14-74d3-bdfe-de69a894d32b`.
2. **#1645 / claim #1656 / PR #1664 / migration `20260827130826`.** Branch `codex/issue-1645-effective-filters-1649`, repaired head `45fa192b633e9b6e489b43de24e6c36d76ab1d6e`. All checks green after the stale taxonomy fixture repair. No independent review or preview. Next gate: exact-head reviewer, then protected preview with cold `authenticated` EXPLAIN/timing under eight seconds before merge.
3. **#1452 / claim #1584 / PR #1587 / migration `20260827132637`.** Branch `codex/issue-1452-notification-index-1579`, head `d0f1c099b7b5b4afb414fbd87a8a917b0368f8be`. All checks green. GLM 5.3 sequence 414 APPROVED. Preview runs `33088584680` and `33089486247` both failed before database access while acquiring the coordination ref; no preview write occurred. Next gate: diagnose live GitHub ref API health, retry bounded preview, then guarded merge.
4. **#1259 / claim #1581 / PR #1586 / migration `20260827133720`.** Branch `codex/issue-1259-fr-hardening-1579`, head `d6f9eb072cc3cdef3c48019c615e4e14023495de`. All checks green. Grok 4.6 sequence 413 APPROVED with no High/Medium findings; one nonblocking test-counter nit is in the review artifact. No preview/merge/production. Next gate: preview, guarded merge, then promotion evidence.
5. **#1467 / claim #1580 / PR #1585 / migration `20260827132608`.** Branch `codex/issue-1467-drop-normalization-index-1579`, head `9cc3f4c735ca2778e074f0e3872e9c8924b527d4`. All checks green. Reviewer assignment repeatedly hung; no reviewer verdict exists. Orphaned coordination locks were recovered, and the last attempt was interrupted with no lock remaining. Next gate: fresh governed reviewer assignment, then preview and merge.
6. **#1646 / migration `20260827095753`.** Authoring PR #1615 was already merged before this closeout. Production review run `33067637247` and dry-run `33067674685` had succeeded at the then-current main; current main has advanced, so the successor must regenerate evidence. No production apply occurred. Issue #1646 carries `needs-albert`.
7. **#1662.** Open, queue-validated, unclaimed, and untouched. It writes only `function api.resolve_item_mg_category`; it must implement the settled division-qualified MG01 rule and temporary 2025-05-14 cutoff. The outgoing session deliberately did not claim it after Albert said to take no new work.

### Preview state

This session applied only #1607 migration `20260827114625` to preview, through run `33074895745`. The later #1452 preview attempts never acquired the lane and never reached Supabase. No preview data rows were written. Preview was not independently ledger-audited during the final minutes, so do not call the entire shared preview project “clean”; re-read its ledger before the next rehearsal.

### Worktree and untracked-artifact ownership

- `C:\repos\shared-db-worktrees\issue-1607-1602`: merged/finished code; protected `.ai/review-1607-*` artifacts remain. Safe to clean only through the cleanup skill after marker closure and GitHub merge verification.
- `C:\repos\shared-db-worktrees\issue-1658-1649`: live/resumable; untracked contract logs, PR-body/contract scratch files, and Kimi review artifact are protected evidence.
- `C:\repos\shared-db-worktrees\issue-1645-effective-filters-1649`: live/resumable; untracked `.ai/run-33086245969/` is failed-run evidence.
- `C:\repos\shared-db-worktrees\issue-1452-1579`: live/resumable and clean.
- `C:\repos\shared-db-worktrees\issue-1259-1579`: live/resumable; untracked Grok review artifact is protected evidence.
- `C:\repos\shared-db-worktrees\issue-1467-1579`: live/resumable; untracked attempted-review artifact is protected evidence and does not imply a verdict.
- `C:\repos\shared-db-worktrees\issue-1646-prod-1649`: clean; keep until production decision is resolved.
- The root checkout contained many pre-existing untracked `.ai`, `.agents`, and `tmp` artifacts owned by earlier sessions. They were not modified or deleted. This handover's temporary `.ai/handover-issue-body.md` was removed before commit.

## 4. Everything we tried that did not work

1. #1607's first preview attempt pre-acquired the preview lock outside the workflow; the workflow correctly refused its own second acquisition. The external lock was released and the workflow rerun without pre-acquisition.
2. #1607's original migration version became backdated when main advanced. A historical exception was not used; governed version supersession produced `20260827114625` and retained the old reservation.
3. Early #1607 reviews initially missed a real two-client pack race. Muse's challenge caused the missing concurrency proof and reserve-replay-after-pack coverage to be added before preview.
4. Three lanes from orchestrator #1579 looked populated but were expired claims with no live workers. They were recovered against their existing worktrees/PRs rather than discarded.
5. #1645's first design considered a live view while the issue claimed a table. The parser proved those are different exact objects. The final physical-table footprint was enumerated and the issue/claim expanded before authoring.
6. #1645's first ephemeral test inserted synthetic taxonomy into retired public mirrors; current foreign keys correctly target `core`. The fixture was repaired to use `core.licensor` and `core.property`; exact-head CI is now green.
7. #1658's issue body was accidentally collapsed into one line by a PowerShell-to-`gh api` edit, making the scope unparsable. It was restored from a file with valid newlines. The first policy names were also expressed in invalid shorthand; the exact form is `policy "name" on schema.table`.
8. Kimi sequence 415 on #1658 exhausted usage and produced no verdict. The governed manager recorded the terminal failure and assigned Muse sequence 416, which approved. The session-level “do not use Kimi” instruction arrived after Kimi had already run; no later Kimi invocation occurred.
9. Reviewer assignment frequently hit GitHub secondary rate limits or left a hung `author-acquisition` ref. Only proven-orphaned refs were recovered through workflow `recover-author-mutex.yml`; local bypass was refused by design.
10. #1452 preview run `33088584680` waited behind a reviewer-assignment ref and failed with HTTP 422 before database access. After guarded recovery, retry `33089486247` failed with HTTP 404 during ref acquisition, again before database access. Repeating retries without first checking GitHub ref health is not useful.
11. #1467 reviewer assignment hung twice. The final local process was interrupted and the ref was absent afterward. No reviewer was invoked and no verdict should be inferred from the untracked scratch artifact.

## 5. Root causes and key findings

- A claim occupying one of five database author lanes is not evidence that a worker is live. Always verify the lease, PR activity, and actual task/process state.
- Reviewer assignment, preview, merge, and production all serialize through GitHub-backed coordination. Starting them concurrently creates avoidable ref contention.
- The #1658 authority contract is assertion-specific: an approved exact DCP identity resolution may carry an explicit signed-contract studio assertion and approved member rows keyed only by stable OPA `licensed_property_id`. The API evaluates explicit contract authority and direct latest-approved OPA scope independently; one source may place, agreement may place, disagreement produces `contract_opa_conflict`, and candidate-only mappings cannot place.
- Private generator commit `fdf31e6` reported aggregate-only candidate counts: 325 DCP identities, 144 name-similarity review candidates, 181 with no name candidate, zero approved mappings. Those are candidates only. No licensed names were copied into this public repo or outside-review prompts.
- #1645 needs preview-scale performance evidence, not only passing correctness tests. The acceptance ceiling is cold execution under eight seconds as `authenticated` with headroom.
- The root checkout is shared and dirty with other sessions' untracked artifacts. Never broad-stage or clean it.

## 6. Exact next steps

1. Open a fresh orchestrator session and create its own marker/route id. Run `node scripts/check-orchestrator-marker.mjs --resolve`; success means exactly its marker resolves. Do not reuse marker #1649's route id.
2. Fetch `origin/main`, re-read all seven outstanding issues and five open PR heads, and run `node scripts/manage-migration-author-lanes.mjs --queue-audit`. Success means live facts match or the handoff is corrected from GitHub evidence.
3. Resume #1658 first because it has priority 2000 and is approved. Re-derive exact head, acquire preview only through the workflow, dry-run/apply only `20260827134155`, guarded-merge PR #1660, then regenerate production review/dry-run/apply evidence against the new main. Success means direct production queries prove the tables, policies, function behavior, conflict fail-closed behavior, and private-loader contract.
4. Review #1645 exact head `45fa192b...`; if approved, preview migration `20260827130826` and run cold `authenticated` performance proof on production-scale fixtures before merge. Success means correctness parity and all measured paths under eight seconds with stated headroom.
5. Retry #1452 preview only after confirming no coordination ref and healthy GitHub ref create/delete calls. Do not pre-acquire the preview lock. Success means the preview workflow artifact proves only `20260827132637` was rehearsed.
6. Preview and merge approved #1259 at unchanged exact head. Success means preview evidence names only `20260827133720`, then guarded merge succeeds.
7. Obtain a fresh governed review for #1467. Do not trust the untracked attempted-review file. Success means a durable PR verdict tied to `9cc3f4c...`; then preview only `20260827132608` and merge.
8. Ask Albert once for #1646 production authorization together with pre-existing #1609/#1353 decisions. If authorized, regenerate current-main immutable evidence and single-version dry-run before apply. Success means production ledger and direct API behavior prove `20260827095753`.
9. Claim #1662 only after a lane is lawfully released. Success means the exact function contract and boundary tests are reviewed, previewed, and merged without writing item rows.
10. After each merge, publish the immutable completion record, close its work issue, release its claim through the manager, and refill from the live queue. Success means no finished claim occupies a lane.

## 7. Constraints and gotchas in force

- One live orchestrator only. Every successor opens a new marker with a new route id.
- Five database author lanes are governance capacity, not five Codex worker slots.
- Do not treat a reserved lane as active work without live evidence.
- Exact object claims bind; expand through the manager before writing another object.
- Never reuse or manually rename a migration version; use governed supersession.
- Workflows own preview/merge/production locks. Do not pre-acquire them externally.
- Production writes require exact current-chat authorization for the exact change and target.
- No licensed rows, names, paths, or private authority references may enter public issues, commits, logs, or outside reviewer prompts.
- Kimi's 25-hour removal request was narrowed by Albert to this outgoing session only. A successor must follow the repository rotation unless Albert gives a new instruction.
- Preserve unrelated dirty work and protected `.ai` review evidence. Use `cleanup-worktree`; never force-remove worktrees.

## 8. Access and environment

- Machine: `edge-dev` (Windows), repository `C:\repos\shared-db`.
- GitHub CLI was authenticated as `u2giants` and could read/write issues, PRs, refs, and workflows.
- Shared preview project ref observed in workflow logs: `mvpkijzfmfcxhnzqogzs`; production ref: `qsllyeztdwjgirsysgai`. Re-prove immediately before every database write.
- Supabase credentials remain in protected GitHub Actions secrets / 1Password vault `vibe_coding`; no values belong in this file.
- Review wrappers available included GLM 5.3, Grok 4.6, Muse, and Kimi. Kimi exhausted usage during sequence 415.
- Secrets sweep: repository diffs and this session's untracked files were checked; no new credential, token, connection string, or `.env` was introduced. Nothing needed storing or rotating.

## 9. Open questions and risks

- #1646 remains the only session-created item requiring Albert's exact production authorization.
- GitHub ref creation returned both secondary-rate-limit failures and transient HTTP 404/422 responses. The successor must inspect live health rather than loop retries.
- Preview's whole ledger was not re-read at final closeout. The facts above describe only this session's known writes; re-derive before rehearsal.
- `origin/main`, PR heads, check results, and maximum migration version are moving facts and must be refreshed.
- #1658's Low review notes were nonblocking: source-system labels are not enum-constrained, protected aggregate cost may need observation, and existing Marvel mappings remain intentionally preserved but unused by the new authority path.
- #1259's reviewer noted two string guards do not increment a displayed test counter; separate behavioral suites cover the behavior.

## Part B — per-agent state

### Agent: issue_1607_fix / `C:\repos\shared-db-worktrees\issue-1607-1602`
- **Asked to do:** repair #1607's idempotency defect and complete exact concurrency coverage.
- **Actually did:** fixed reserve replay after pack, added genuine two-client pack/retry tests, updated to current main, and produced PR #1623 head `708f077...`; final result merged and production-live.
- **Found:** the old pack path overwrote the reservation operation hash; green unit tests had missed the real pack race.
- **PR / branch:** merged PR #1623; `codex/issue-1607-flow4-remote-request-1602`.
- **Worktree:** finished; safe to clean through the cleanup skill after verifying GitHub merge and preserving review artifacts.
- **Deliberately did not do:** preview/merge/production itself; those stayed coordinator-owned.

### Agent: issue_1646_prod / `C:\repos\shared-db-worktrees\issue-1646-prod-1649`
- **Asked to do:** regenerate production evidence and dry-run for CRM customer clearing.
- **Actually did:** successful review run `33067637247` and dry-run `33067674685` at the then-current main.
- **Found:** production lacked only `20260827095753` in its bounded set.
- **PR / branch:** underlying author PR #1615 was already merged; local branch `codex/issue-1646-prod-1649`.
- **Worktree:** clean but keep; production decision unresolved.
- **Deliberately did not do:** production apply because exact authorization was absent.

### Agent: issue_1645_author / `C:\repos\shared-db-worktrees\issue-1645-effective-filters-1649`
- **Asked to do:** design and author effective tag/identity filtering and facet parity.
- **Actually did:** enumerated the physical projection footprint, paused until claim expansion, then authored PR #1664 migration `20260827130826` and focused contract test.
- **Found:** a live view would not match the claimed table object; a maintained table needs three parent-table triggers, one sync function, two indexes, and Licensing-read RLS.
- **PR / branch:** open PR #1664; `codex/issue-1645-effective-filters-1649`.
- **Worktree:** live/resumable.
- **Deliberately did not do:** preview, merge, production, or app wiring.

### Agent: repair_1664 / same #1645 worktree
- **Asked to do:** repair the exact-head ephemeral failure.
- **Actually did:** changed the synthetic taxonomy fixture from retired public mirrors to authoritative `core` tables; pushed head `45fa192...`; all checks green.
- **Found:** the application schema was correct; the test fixture was stale.
- **PR / branch:** open PR #1664, same branch.
- **Worktree:** live/resumable; failed-run artifact retained.
- **Deliberately did not do:** independent review or preview.

### Agent: recover_1452 / `C:\repos\shared-db-worktrees\issue-1452-1579`
- **Asked to do:** recover the expired #1452 claim/PR.
- **Actually did:** renewed claim #1584, governed-superseded the backdated migration to `20260827132637`, merged current main, and produced green head `d0f1c099...`.
- **Found:** original author work was sound but abandoned behind an expired lease.
- **PR / branch:** open PR #1587; `codex/issue-1452-notification-index-1579`.
- **Worktree:** live/resumable and clean.
- **Deliberately did not do:** review, preview, merge, production.

### Agent: review_1452 and review_1452_retry
- **Asked to do:** obtain an exact-head governed review.
- **Actually did:** first attempt hit GitHub rate limiting/lock contention; retry obtained GLM 5.3 sequence 414 APPROVE and posted durable evidence on PR #1587.
- **Found:** no blocker; two optional notes about a tiebreaker and metadata comment.
- **PR / branch:** PR #1587, no edits.
- **Worktree:** reviewer scratch only; code worktree remains live.
- **Deliberately did not do:** preview/merge/production.

### Agent: recover_1259 / `C:\repos\shared-db-worktrees\issue-1259-1579`
- **Asked to do:** recover expired #1259 claim/PR.
- **Actually did:** renewed claim #1581, superseded to migration `20260827133720`, updated from main, and produced green head `d6f9eb0...`.
- **Found:** reviewer assignment could leave a hung coordination lock.
- **PR / branch:** open PR #1586; `codex/issue-1259-fr-hardening-1579`.
- **Worktree:** live/resumable with protected review artifact.
- **Deliberately did not do:** preview/merge/production.

### Agent: review_1259
- **Asked to do:** exact-head independent review.
- **Actually did:** Grok 4.6 sequence 413 APPROVED at `d6f9eb0...`; durable evidence retained.
- **Found:** no High/Medium defects; one nonblocking counter-display nit.
- **PR / branch:** PR #1586, no edits.
- **Worktree:** reviewer artifact protected.
- **Deliberately did not do:** edit, preview, merge, production.

### Agent: recover_1467 / `C:\repos\shared-db-worktrees\issue-1467-1579`
- **Asked to do:** recover expired #1467 claim/PR.
- **Actually did:** renewed claim #1580, superseded to `20260827132608`, updated from main, and produced green head `9cc3f4c...`.
- **Found:** no authoring defect.
- **PR / branch:** open PR #1585; `codex/issue-1467-drop-normalization-index-1579`.
- **Worktree:** live/resumable.
- **Deliberately did not do:** review/preview/merge/production.

### Agent: review_1467_now
- **Asked to do:** obtain governed exact-head review without Kimi.
- **Actually did:** verified the unchanged green head, but assignment hung twice; no reviewer/verdict.
- **Found:** reviewer-assignment refs can remain after local timeout and must be guarded-recovered.
- **PR / branch:** PR #1585, no edits.
- **Worktree:** live/resumable; attempted-review scratch file is not evidence of a verdict.
- **Deliberately did not do:** fabricate a provider failure, bypass assignment, preview, merge, or production.

### Agent: issue_1658_author / `C:\repos\shared-db-worktrees\issue-1658-1649`
- **Asked to do:** urgent assertion-specific contract/OPA authority correction with candidate separation and private-loader contract.
- **Actually did:** authored migration `20260827134155`, sanitized tests, business rule update, two tables, API replacement, and exact RLS policies; PR #1660 head `d15a69a...` is green.
- **Found:** contract and OPA evidence must be evaluated independently; candidate similarity cannot establish ownership.
- **PR / branch:** open PR #1660; `codex/issue-1658-opa-authority-1649`.
- **Worktree:** live/resumable with protected contract/review artifacts.
- **Deliberately did not do:** publish licensed identities, preview, merge, or production.

### Agent: review_1658
- **Asked to do:** exact-head authority/privacy/security review.
- **Actually did:** recorded Kimi quota failure at sequence 415, then Muse sequence 416 APPROVE with no Critical/High/Medium findings; durable verdict posted on PR #1660.
- **Found:** three Low/nonblocking observations recorded in §9.
- **PR / branch:** PR #1660, no edits.
- **Worktree:** detached review worktree can be cleaned later through the cleanup skill.
- **Deliberately did not do:** edit, preview, merge, production, or disclose licensed rows.

## Documentation and secrets pass

- **Secrets sweep:** passed; no new secret was created, exposed, or left in this session's diff/untracked files. No 1Password write was needed.
- **Docs pass:** the only durable closeout document needed is this handoff. #1658's business-rule correction is already in its work PR. No other live documentation was found to be newly false because of this session.
- **Queue seed:** every unfinished session item has an open `db-work` issue (#1658, #1645, #1452, #1259, #1467, #1662, #1646), and umbrella issue #1665 points here. `needs-albert` is applied to #1646 and pre-existing owner-decision issues #1609/#1353.

## Self-audit

1. **Fresh-developer continuation:** yes. Sections 1–3 establish purpose, exact state, SHAs, versions, environments, and ownership; §6 gives ordered executable gates.
2. **Equivalent session knowledge:** yes. Failed attempts are in §4, non-obvious findings in §5, safety constraints in §7, and each sub-agent is separated in Part B.
3. **All execution dimensions present:** yes. Goals (§2), current state/evidence (§3), failures (§4), findings (§5), next actions (§6), constraints (§7), access/secrets (§8), and risks (§9) are explicit.
4. **Owner-only decisions complete:** yes. A line-by-line sweep of §§1–9 and Part B found #1646 as this session's only new owner gate; pre-existing #1609/#1353 are also promoted to §0. Settled decisions are listed so they are not re-asked.
