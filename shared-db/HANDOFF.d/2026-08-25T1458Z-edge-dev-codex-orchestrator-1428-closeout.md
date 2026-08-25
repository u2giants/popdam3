---
issue: 1521
status: OPEN
owner: codex/orchestrator-1428-closeout
---

# Orchestrator #1428 closeout — production releases, Sample Tracking unblock, and remaining structural queue

This is the Path B handoff for the sole `u2giants/shared-db` orchestrator that ran under marker #1428 on EDGE-DEV. Live facts below were re-derived from GitHub, the production Supabase catalog, workflow artifacts, Git worktree state, and the queue manager on 2026-08-25. `COORDINATOR_INTAKE.md` is retired and was not changed.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this entire list to Albert in one message before attempting any owner-gated action. None of the immediate structural releases #1242, #1492, #1498, or #1523 is waiting on a new owner decision.

### Blocking owner decisions already carrying `needs-albert`

1. **#1352 / #1353 — DesignFlow production cutover and non-production isolation.** Structure work alone does not authorize copying real rows, changing production secrets, or redirecting Cloud Run services. Recommendation: authorize only a freshly rehearsed list of exact resources and actions after the owning application/infrastructure session proves rollback. This blocks the live DesignFlow cutover, not current shared-db migrations.
2. **#778 — orphan Supabase `designflow` schema removal.** The issue is marked ready but destructive production removal still needs the exact backup/removal decision in a current chat. Recommendation: approve only after a fresh read-only dependency and backup proof. This blocks that schema retirement only.

### Labels/questions that appear stale and should be reconciled before re-asking

3. **#1204 — ColdLion phases 2–6.** Its own body records full owner authorization and says nothing is needed from Albert to begin, yet it still carries `needs-albert`/owner-decision state. Recommendation: re-derive the current phase status, remove the stale owner block if the authorization still covers it, and keep the seven-year backfill as its separate operational job. Do not make Albert repeat an already recorded approval.
4. **#1238 — Universe A retirement.** Prior rulings already say keep `core.licensor` and that the remaining property/character retirement gates are technical. Recommendation: re-check whether any genuine owner choice remains; if none, remove `needs-albert` and continue only after live dependency proof.
5. **#1291 — consolidated older owner queue.** Its three questions may have been answered or superseded since 2026-08-20. Recommendation: a repo-maintenance session should reconcile the current issue bodies and present only genuinely unanswered items in one message.

### Already settled — do not re-ask

- 2026-08-13: the shared-db orchestrator governs database structure, not ordinary application rows; curated external Master Data remains the narrow exception.
- 2026-08-21: repo-maintenance and documentation are not structural-orchestrator assignments.
- 2026-08-25: #1459's three-stage Paramount supersession route was killed; PR #1491 was closed unmerged, and the governed Paramount production route completed under #679.
- 2026-08-25: production issue #679 recorded a successful new Paramount capture. A later merged document saying no capture ran is stale and is tracked by #1522; do not rerun the capture.
- 2026-08-25: #1502 was explicitly authorized through production and is complete; DesignFlow Sample Tracking #157 may continue its controlled production proof.

## 1. What this application is

`u2giants/shared-db` is POP Creations' governed source of truth for the shape of the shared Supabase/Postgres database used by CRM, DAM, PM/PIM, DB Data Admin, licensed-source pipelines, and DesignFlow. One orchestrator owns structural coordination at a time. Authors work in isolated branches/worktrees; preview, guarded merge, and production are serialized and evidence-bound.

The public repository must never contain licensed source rows or credentials. Ordinary application data writes remain with the owning application session. Structural objects—schemas, tables, columns, functions, triggers, policies, indexes, constraints, migrations, and shared contracts—start here.

Production Supabase was re-proved during this session as `https://qsllyeztdwjgirsysgai.supabase.co`; preview is project ref `mvpkijzfmfcxhnzqogzs`. GitHub is the source of truth for code, reviews, workflow runs, and claims.

## 2. What we set out to do this session, and why

Albert asked the orchestrator to complete #1418, #1428, #679, #1427, and #1433 through production, then continue everything open, followed by #1459, #1276, and #1451. During that work, DesignFlow delegated urgent structural defect #1502 because the production trigger rejected canonical `Ningbo` returns and blocked Sample Tracking #157.

The session's business outcome was to ship several previously blocked database contracts, preserve capability while repairing production defects, unblock DesignFlow's controlled proof, and leave every unfinished structural or documentation obligation visible as a GitHub issue rather than hidden in chat or a handoff paragraph.

## 3. Current state — what is true right now

### Moving facts at closeout

- `origin/main` at the initial closeout sweep (2026-08-25 14:58 UTC): `4e3edc55206b19146f9611c0f3e428bb5e04115a`.
- Maximum migration on that exact `main`: `20260825133251`.
- Open structural author claims: #1503 for #1498/version `20260825120441`; #1513 for #1492/version `20260825135237`.
- No current preview, merge, or production workflow was running when closeout began. Three old August 6 workflow runs remain queued in GitHub; they are historical platform debris, not this session's work.
- Queue audit is intentionally non-clean: #1242 is immediately dispatchable; #1492/#1498 occupy claims; multiple older dependency closures lack immutable completion records. Do not call the queue empty.
- Handover issue: #1521. Documentation race: #1522. #1439 production successor: #1523.

Re-fetch and re-run the audit before acting; these facts move within minutes.

### Completed and production-verified in or during this orchestrator session

| Issue | Result and exact evidence |
|---|---|
| #1418 | PR #1421 merged at `2731b108e464bfcb558986fc911669e5d2de2959`; migration `20260824135515`; production run `32793586633`; JSON-null loader repair live. |
| #1276 | PR #1468 merged at `24c65ea91a4a61dd9d39e06c00cb145dc28ce283`; migration `20260825035129`; preview `32807538604`; production `32807730254`. Database now deliberately requires the twelve-count Sega contract. |
| #1451 | PR #1478 merged at `b4e8dcf17310cf754bd799b01e14a8df1f9da0b2`; migration `20260825041105`; preview `32809943610`; production `32810266265`; no licensed rows loaded. |
| #1427 | Recovery A PR #1476/version `20260825041343`, production `32811015949`; Recovery B PR #1482/version `20260825082910`, production `32827618163`, durable verification `32833236435`. PopDAM AI metadata/tag/character search capability is active. |
| #1433 | PR #1509 merged at `f4cecd5cabf4f624b905961a8489196173d1b2ef`; preview-ledger support/docs reconciliation complete; issue closed. |
| #1321 | Guard PRs #1499 and #1500 merged at `aa48bad3613923a3ec8eaa0e9ea28495b5fb6765` and `e78f02f8b1c6cbb165d655ae72deffe42dbcf5ed`; required checks passed and preview was safely reconciled. |
| #1502 | PR #1512 merged at `f995c10fcda4c0818dc2ab26776a9d34e2bed388`; migration `20260825133251`; preview `32854869380`; production `32855291432`. Live function contains exact `IS DISTINCT FROM 'Ningbo'`, not lowercase and no `lower()` bypass; trigger remains enabled on `dflow.sample_movement`. DesignFlow #157 notified. |
| #679 | Governed Paramount schema promotion run `32851388854` completed. A fresh production capture `d4d678ae-44c4-4edb-a5ea-edde413dc0fc` finalized at `2026-08-25T14:26:05.985Z`; aggregate receipt: 33,862 assets, 7 metadata elements, 207,522 metadata values, 55/55 finalization and 70/70 loader tests, private receipt commit `055012e`. No licensed rows were posted publicly. |
| #1459 | Owner rejected the unsafe supersession chain; PR #1491 closed unmerged, claim #1489 released, issue closed as superseded by #679's completed route. |

### Merged/previewed but not production-complete

1. **#1242 — open and next in the serialized production lane.** PR #1493 merged at `1ac0e6b2d379e373c5024c8c106e7fb0355dd4e9`. Preview run `32853494539` applied migration `20260825130924`; artifact id `9565243180`, digest `sha256:ebf92135b5f47cb35352933fc2217801161a852c29310de8ff7122912ea319ca`. The production ledger does not contain the version. The clean author worktree is `C:\repos\shared-db-worktrees\issue-1242-drop-nbcu-right`.
2. **#1439 successor #1523 — merged and previewed, hidden by the closed source issue.** PR #1495 merged at `ec6d7b450bc7f57cb45248651776c34ea09f4812`; migration `20260825123952`; preview run `32849250515`; guarded merge `32849382713`. A live production-ledger query during closeout showed this version absent. #1523 is the required open production successor.

### Authored but not previewed or merged

1. **#1492 / PR #1515.** Migration `20260825135237`, claim #1513, head `4d457f9d9623d90be1a92a0fa0e61a8ba4392d1f`. It adds nullable reviewed one-to-one bridges from `dflow.users`, `dflow."Roles"`, and `dflow.comments` to `app.profile`, `app.role`, and `app.comment`, with no backfill, inference, mirroring, or authority switch. All CI and ephemeral DB tests passed; Muse seq336 approved that exact head. However `main` advanced after authoring, so the approval is stale for promotion. Rebase/supersede according to current version order, rerun CI, assign a fresh exact-head reviewer, then preview/merge/production. Worktree is live and has one untracked review prompt: `C:\repos\shared-db-worktrees\issue-1492-identity-comments-contract\.ai\issue-1492-grok-review.md`.
2. **#1498 / PR #1504.** Migration `20260825120441`, claim #1503, head `8b6a2aa1e7664e2a3a5b2d0dd7af83d6dfe3d67b`. CI and ephemeral DB tests passed. Grok reviewer assignment seq325 timed out after 900 seconds with no verdict and no artifact; its paid-session lock was retained for human reconciliation. Do not treat silence as approval and do not clear/bypass the reviewer evidence. Current `main` is far ahead, so after the reviewer lock is reconciled the branch will also need exact-current-main refresh and a new exact-head review. Worktree is clean and protected.

### Documentation/repository work outside the structural orchestrator

- **#1522:** correct the race in PR #1519, which merged six minutes after #679's successful capture evidence but says no capture occurred. Do not rerun the capture; correct only the stale public status and contradictory later #679 comment.
- **#1379 / #1358:** DB Data Admin Universe B application work remains an open PR and is repo-maintenance/application scope, not a structural-orchestrator assignment.
- **#1521:** this handoff's tracking issue; retire this file only after a successor has carried or completed every obligation.
- **#1496:** closed as an exact duplicate of #1492 so the same six-object scope cannot dispatch twice.
- **Stale handoff retirement:** predecessor orchestrator file `2026-08-24T2355Z-edge-dev-claude-orchestrator-1419-closeout.md` was deleted only after its unfinished obligations were re-derived and carried into current issues/this handoff. Closed #1184's stale planning handoff was also retired: its durable plan remains under `docs/`, while surviving actions remain independently queued by #1204, #1031, and #1322. The prior committed versions remain retrievable.

### Preview's actual state

Preview is not clean and must not be described as clean. It contains, at minimum, successfully applied versions `20260825123952` (#1439/#1523), `20260825130924` (#1242), and `20260825133251` (#1502), plus earlier governed work and historical recovery state. Of those three, production currently contains only `20260825133251`. #1492 and #1498 have not touched preview.

Before every future rehearsal, run the live ledger/main drift machinery. Never infer absence from the catalog or reuse a preview artifact against a changed producer without the governed recovery proof.

### Queue and dependency state

- The GitHub `db-work` issues are the queue; the retired coordinator intake file is not.
- Immediate structural work: #1242, #1523, #1492, #1498.
- Older queue entries remain open and must be triaged by the next orchestrator according to live priority/claims. Queue audit reports dependency-not-proven cases including #1467→#1427, #1434→#1400, #1259→#1140, #1164→#1143, and #1143→#1140. Closure alone is not success; add only truthful completion records or create bounded successors.
- Curated Master Data forks and repo-session items printed by the audit are not structural author assignments.
- Every known unfinished item from this session has an open issue: #1242, #1492, #1498, #1522, #1523, and handoff #1521. Owner-routed items carry `needs-albert`.

### Worktrees and untracked state

- **Live/protected:** #1492 and #1498 worktrees above; their claims remain open.
- **Finished but retained:** #1242 (clean, merged but awaiting production), #1502 (merged/production complete but contains untracked Muse review evidence), #1459 (branch closed unmerged and contains four untracked review/body files). Do not force-remove dirty worktrees.
- **Primary checkout `C:\repos\shared-db`:** intentionally untouched for closeout because it was 31 commits behind at first sweep and contained many pre-existing untracked `.ai` completion/review artifacts from concurrent sessions. The closeout used isolated worktree `C:\repos\shared-db-worktrees\orchestrator-1428-closeout` at current `origin/main` and staged only its own handoff changes.
- Numerous older Claude/Codex worktrees remain. Existing cleanup issue #682 and the `cleanup-worktree` procedure own broad retirement; this closeout does not treat age or a closed chat as deletion proof.

## 4. Everything we tried that did NOT work

1. **Repeated main races on #1439 and #1242.** Exact-head branches repeatedly became stale while unrelated PRs merged, forcing timestamp/version supersession, rerun CI, and renewed exact-head review. Never merge or preview a stale head merely because its previous checks were green.
2. **Grok seq325 for #1498.** The wrapper consumed the full 900-second window and produced neither verdict nor artifact. A zero-byte/silent result is not a review. The durable paid-session lock remains and requires human reconciliation before replacement/continuation.
3. **The original #1459 three-stage replacement route.** It would have placed a byte-identical structural prerequisite above the repaired loader version and risked restoring an older function body. Independent review caught the inversion; Albert killed the route, PR #1491 closed unmerged, and #679 used the governed replacement window.
4. **Assuming closed #1439 meant production-complete.** Its immutable completion record proves merge only. A fresh production-ledger query found `20260825123952` absent. #1523 now prevents that work from disappearing.
5. **Assuming the latest merged Paramount document reflected the latest event.** #679's production capture completed while PR #1519 was in flight; the PR merged stale wording afterward. #1522 records the correction without repeating licensed evidence.
6. **Using the primary checkout for closeout.** It was far behind and full of untracked coordination artifacts belonging to several sessions. Rather than pull over or stage somebody else's files, closeout moved to a fresh isolated worktree.
7. **First duplicate-close command syntax.** `gh issue close --reason not-planned` was rejected because GitHub CLI expects `duplicate`, `completed`, or `not planned`. Retried safely with `--reason duplicate --duplicate-of 1492`; no state was lost.
8. **Initial live function substring check for #1502.** The first read-only predicate looked for `destination_factory_location <> ...`, while the actual function uses `IS DISTINCT FROM`. It returned false for both spellings and was not treated as proof. The corrected exact query verified canonical `Ningbo` true, lowercase false, and no normalization.
9. **Stale UI agent timers.** The desktop showed old elapsed timers after agents had completed. Live collaboration state, PRs, worktrees, and claims—not the timer display—were used to determine activity.

## 5. Root causes and key findings

- A closed structural issue may still be only merged, not production-applied. The completion schema's `merged` outcome releases code dependencies but does not prove production; always compare the migration ledger.
- Preview evidence is byte/producer/commit bound. Squash merges and later producer changes can make otherwise correct evidence unusable; use the current governed post-merge/historical recovery lane rather than weakening equality.
- Exact identity rules matter. #1502 was not a case-insensitive comparison request; canonical application/shipment vocabulary is `Ningbo`, and lowercase must remain invalid.
- Compatibility adoption must abstain from uncertain mappings. #1492 deliberately adds nullable reviewed bridges and retains `dflow` as the sole writable authority.
- External review silence is a failure state, not approval. Retained locks and exact-head assignments are durable coordination evidence.
- Concurrent documentation can become stale between authoring and merge. Event timestamps and live evidence outrank the newest-looking paragraph.
- `COORDINATOR_INTAKE.md` remains a retired pointer. GitHub issues with `db-work` labels are the only queue.

## 6. Exact next steps

1. **Start the successor orchestrator.** Confirm marker #1428 is closed, fetch `origin/main`, read this file and the current `AGENTS.md`, then open exactly one new marker. Run `node scripts/manage-migration-author-lanes.mjs --queue-audit`. **Worked when:** exactly one marker is open and the report records current main, maximum migration, claims, dispatchable work, and preview state.
2. **Promote #1242 first unless live collision/risk evidence changes priority.** At current `main`, mint immutable production review evidence for allowlist `20260825130924`, source PR #1493, preview run `32853494539`, and its exact digest. Dispatch the production workflow only after rechecking current main immediately before the run. **Worked when:** production ledger contains `20260825130924`, post-apply catalog verification passes, #1242 has a completion/production comment, and the issue closes.
3. **Promote #1523 (#1439's remaining release).** Validate whether preview run `32849250515` is acceptable under current producer rules; use governed recovery if required. Apply only `20260825123952`, verify the Factory/Artist bridge objects live, then complete/close #1523. **Worked when:** production ledger contains the version and the exact live objects/privileges match the migration.
4. **Refresh #1492.** Rebase from current main in its protected worktree; if version ordering requires it, use the manager's governed supersession path and never reuse `20260825135237`. Rerun CI/ephemeral DB, assign a fresh exact-head reviewer, then preview → guarded merge → production. **Worked when:** all gates bind one exact final head/version and #1492 closes with production proof.
5. **Reconcile #1498's reviewer lock before touching its branch.** Inspect the retained seq325 paid-session evidence through the reviewer procedure. If genuinely terminal with no verdict/artifact, record the allowed failure/replacement evidence; otherwise resume/finish the same reviewer. Refresh current main and obtain a new exact-head verdict before promotion. **Worked when:** a durable independent approval exists for the actual final head and no lock/evidence was erased.
6. **Run #1522 in a separate repo-maintenance session.** Correct PR #1519's stale no-capture statement and the later contradictory #679 comment using aggregate-only proof; do not reproduce licensed rows or rerun production capture. **Worked when:** public docs consistently say schema promotion and the first real capture completed, with the private receipt referenced only by commit.
7. **Reconcile owner-routed labels in one pass.** Present the genuinely open #1352/#1353/#778 choices together; verify whether #1204/#1238/#1291 still need Albert before re-asking. **Worked when:** each `needs-albert` label corresponds to a current unanswered decision, not historical wording.
8. **Retire worktrees only under `cleanup-worktree`.** Verify PR state, unique changes, dirty evidence, and claim ownership before removal. **Worked when:** no live/dirty worktree is deleted and every removed worktree's value is durable on GitHub.
9. **Retire this handoff under the successor rule.** Once every obligation above is completed or carried to a newer comprehensive handoff, delete this file in that successor's docs PR and close #1521. **Worked when:** no obligation exists only in deleted prose.

## 7. Constraints and gotchas in force

- One orchestrator marker at a time. The outgoing marker closes only after the handoff PR merges and every closeout gate passes.
- Structural work only. Repo-maintenance/documentation are separate sessions; curated Master Data uses its governed fork.
- Prove target immediately before every database write. Preview evidence is never production evidence.
- Never edit migration ledger rows manually, reuse a migration version, weaken producer equality, or bypass reviewer/claim locks.
- Do not pre-acquire preview/merge/production locks; governed workflows own them.
- Re-run exact-head CI/review after any rebase or version supersession.
- Preserve exact identity checks and one writable authority; no inference from names and no automatic bridge backfill.
- Licensed rows stay private. Issues, PRs, reviewers, and this handoff receive aggregates/contracts only.
- Never stage broadly in the dirty primary checkout. Stage only owned files from the isolated closeout branch.
- Never write into or delete `COORDINATOR_INTAKE.md`; the intake-pointer guard requires the retired pointer.
- Production infrastructure/data-copy/secret changes need exact current-chat authorization naming the resource/action.

## 8. Access and environment

- Machine: EDGE-DEV, Windows PowerShell.
- Canonical repo: `C:\repos\shared-db`; isolated closeout worktree: `C:\repos\shared-db-worktrees\orchestrator-1428-closeout`.
- GitHub CLI authenticated as `u2giants`; committer identity verified as `Albert Hazan <u2giants@users.noreply.github.com>`.
- Supabase MCP was production-bound and read-only for closeout verification; target URL re-proved as `https://qsllyeztdwjgirsysgai.supabase.co`.
- Governed GitHub workflows own preview/production writes and credentials. Secrets remain in 1Password vault `vibe_coding`; no values belong in commands, docs, or chat.
- Secrets sweep result: the closeout diff and owned issue-body files were scanned by path-only patterns; no credential, key, token, connection string, private-key block, or new secret was found. No 1Password write is required.
- Docs pass: this handoff is the primary durable session record. One newly stale document was found and queued as #1522. No other live document was knowingly changed by this closeout.

## 9. Open questions and risks

- Current main, max migration, claim leases, and PR heads will be stale quickly; re-derive before every action.
- #1242 and #1523 both have old preview evidence whose admissibility can change when producer scripts move. Let the gates decide; do not assume either recovery path.
- #1492's existing approval is exact-head evidence for a stale head and cannot authorize a rebased branch.
- #1498's paid reviewer lock is unresolved. Clearing it casually destroys the only durable evidence explaining why review is incomplete.
- Preview is ahead of production by at least #1242 and #1523 and contains historical recovery rows; an unrelated rehearsal can fail closed until it accounts for that state.
- The primary checkout and many old worktrees contain untracked reviewer/coordination artifacts. Broad cleanup or staging risks destroying another session's only evidence.
- #679 contains chronologically contradictory comments due the documentation race. The 14:28 successful capture evidence and private receipt are the operational truth; #1522 owns the correction.
- Queue audit is not fully audited because several older dependency closures lack completion records. Never fabricate completion merely to make the audit green.

# Part B — sub-agent state, separated by agent

### Agent: `/root/issue_1242_resume` — `C:\repos\shared-db-worktrees\issue-1242-drop-nbcu-right`

- **Asked to do:** resume structural issue #1242, refresh it through exact-current-main review, and carry it toward production.
- **Actually did:** produced final PR #1493 head `201b24e0b8f95f51bc8d25ac42208989cb9ee814`, migration `20260825130924`; GLM seq332 approved; all CI/ephemeral DB checks passed; preview run `32853494539` succeeded; guarded merge succeeded at `1ac0e6b2d379e373c5024c8c106e7fb0355dd4e9`.
- **Found:** production run `32855291432` did not include #1242; its artifact showed this version local-only. Preview artifact id/digest are recorded in §3.
- **PR / branch:** merged PR #1493, `codex/issue-1242-drop-nbcu-right`.
- **Worktree:** finished authoring and clean, but keep until production closeout because the issue remains open.
- **Deliberately did NOT do, and why:** did not race the orchestrator for the serialized production lane; no production write occurred.

### Agent: `/root/issue_1459_rebase` — `C:\repos\shared-db-worktrees\issue-1459-paramount-forward-repair`

- **Asked to do:** refresh #1459's Paramount prerequisite supersession route.
- **Actually did:** produced reviewed PR #1491 at head `ab1be09a00da8874d846cdc0e9bde2d2c07672d8`, reserved version `20260825102727`, and byte-identity evidence.
- **Found:** applying that version above `20260825094455` would overwrite the repaired loader with an older body; the route was unsafe in its proposed order.
- **PR / branch:** PR #1491 closed unmerged by owner ruling; claim #1489 released; branch `codex/issue-1459-paramount-forward-repair`.
- **Worktree:** finished but dirty with four untracked review/body files; preserve for deliberate cleanup.
- **Deliberately did NOT do, and why:** no preview/merge/production because the route would reintroduce the defect. #679 completed the approved replacement route instead.

### Agent: `/root/issue_1502_author` — first #1502, then successor #1492

- **Asked to do (#1502):** author the exact canonical `Ningbo` trigger-function repair without modifying application repos.
- **Actually did (#1502):** PR #1512, migration `20260825133251`, exact-head Muse approval and complete tests proving canonical success, lowercase rejection, and no partial movement. The orchestrator previewed, merged, promoted, live-verified, notified DesignFlow #157, and closed #1502.
- **Found (#1502):** the defect was one lowercase literal; exact vocabulary—not case-insensitive acceptance—was the safe repair.
- **PR / branch (#1502):** merged PR #1512, `codex/issue-1502-ningbo-return`; worktree finished but has one untracked Muse review file.
- **Asked to do (#1492):** fresh independent intake of the DesignFlow users/roles/comments bridge.
- **Actually did (#1492):** claim #1513, migration `20260825135237`, PR #1515 head `4d457f9d9623d90be1a92a0fa0e61a8ba4392d1f`; all CI and ephemeral DB green; Muse seq336 approved.
- **Found (#1492):** live mappings are incomplete/ambiguous, so the migration correctly adds nullable reviewed bridges with no data reconciliation. It also found #1496 was an exact duplicate; the orchestrator closed #1496 as duplicate.
- **PR / branch (#1492):** open PR #1515, `codex/issue-1492-identity-comments-contract`.
- **Worktree:** live/resumable with one untracked review prompt.
- **Deliberately did NOT do, and why:** no preview/merge/production for #1492 because main advanced and exact-head evidence became stale.

### Earlier #1439 structural author workstream — `C:\repos\shared-db-worktrees\issue-1439-factory-artist-bridge`

- **Asked to do:** bounded Factory/Artist identity compatibility for DesignFlow multi-schema adoption.
- **Actually did:** PR #1495, migration `20260825123952`, preview `32849250515`, guarded merge `32849382713`, merge SHA `ec6d7b450bc7f57cb45248651776c34ea09f4812`.
- **Found:** Factory can use `core.factory_source_ref` authority; Artist needs a nullable reviewed UUID bridge; users/roles/comments require the separate #1492 slice.
- **PR / branch:** merged PR #1495, `codex/issue-1439-factory-artist-bridge`.
- **Worktree:** finished authoring; production obligation transferred to #1523.
- **Deliberately did NOT do, and why:** no mapping backfill, mirroring, authority switch, or application-repo work. Production was not completed before #1439 closed, which the closeout detected and queued.

# Fresh-developer self-audit

1. **Yes — a brand-new developer can continue without questions.** §§1–3 define the system, targets, exact commits/versions/runs, queue, preview, claims, PRs, and worktree ownership; §6 gives ordered commands-by-outcome with a success gate for every step.
2. **Yes — the developer has the full non-obvious session knowledge.** §§4–5 preserve the failed approaches and root causes, including the #1459 inversion, #1498 silent reviewer, #1439 hidden production gap, and #679 documentation race; Part B separates each agent/worktree.
3. **Yes — execution details are complete.** §§3 and 6 distinguish merged, previewed, production-applied, and untouched states; §§7–9 cover safety constraints, access, secrets, concurrency, stale evidence, and risks. Every unfinished item has a live issue.
4. **Yes — section 0 contains every owner decision found by a line-by-line sweep of §§1–9 and Part B.** The only current owner-routed decisions are #1352/#1353/#778; potentially stale `needs-albert` items #1204/#1238/#1291 are surfaced with recommendations not to re-ask settled questions. The immediate #1242/#1523/#1492/#1498 work needs no new owner ruling.
