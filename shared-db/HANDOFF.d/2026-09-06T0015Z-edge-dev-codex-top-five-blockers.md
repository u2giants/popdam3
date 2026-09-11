---
issue: 770
status: OPEN
owner: codex/top-five-blockers
---

# Session handoff — top five shared-db blockers

> Contract header names #770; this file also covers #1031 and #1090. (#771 and #810 are closed.)

## 0. Owner decisions required

- #770 still needs Albert's explicit authorization for the aggregate-only duplicate check and the protected, read-only Cloud SQL to preview scratch-schema rehearsal described in its latest comment. This authorizes no production write or cutover.
- #1031 still needs Albert to send the two privacy-safe vendor observations and comment `sent YYYY-MM-DD` on the issue. No examples, keys, or internal names may be included.

## 1. Repository and operating scope

`u2giants/shared-db` is the governed source of truth for shared database structure. Structural work runs through the live orchestrator, isolated worktrees, exact-head review, guarded merge, preview, production, and live evidence. This session did not perform schema or production writes.

## 2. Objective and ranking

The requested top five non-orchestrator GitHub issues were #771, #770, #810, #1031, and #1090. #771 was the only issue with an open blocker relationship; the other four were the oldest zero-blocker ties after the transitive ranking. The goal was to advance all five through production or live acceptance.

## 3. Current verified state

- **#771 — CLOSED 2026-09-05.** Locked preview rehearsal passed: 1,006,439 rows, 97/97 main steps, 10/10 sequence plans, constraints/FKs/hashes passed, 512.5 MiB scratch, and scratch schemas/locks were removed.
- **#810 — CLOSED 2026-09-05.** #2331 reached production and closed. Live build `2936cb4` passed the authenticated two-tab DAM test: edit and restore both returned 204 and propagated automatically; the marker was absent afterward and the original empty value was restored. Evidence: `https://github.com/u2giants/shared-db/issues/810#issuecomment-5550693290`.
- **#1031 — OPEN.** Private capture and PR #2328 are complete and merged (`3d282d55`); 451 weekly windows, 2,406 requests/pages, and 207,423 retained rows. Only the vendor courtesy note and sent-date comment remain.
- **#1090 — OPEN.** Plan PR #2337 merged (`12e79fac`). Successor #2333 is production-complete and CLOSED (`373e1b15`, migration `20260905083426`). #2334 is substantively unblocked but still machine-marked `status: blocked`; the live orchestrator marker #2330 was reminded at `https://github.com/u2giants/shared-db/issues/2330#issuecomment-5554423900`. No claim or PR exists for #2334 yet.
- **#770 — OPEN.** Prerequisites #1315 and #778 are complete. Preview `mvpkijzfmfcxhnzqogzs` is the only configured nonproduction target and is shared; no approved production-row copy exists without the owner authorization above.

## 4. Work attempted and failed

- Repeated live checks confirmed that #2334 remains open with zero comments and stale `status: blocked`; no duplicate reminder or structural work was performed.
- The closeout template `templates/system/handoff-standard.md` was not present in this checkout, so this handoff follows the existing repository handoff structure and includes the required evidence-backed audit below.
- The canonical checkout is dirty and 239 commits behind `origin/main`; unrelated `.mcp.json`, `.codex/`, and existing handoff files were preserved.

## 5. Root causes and findings

- #770 is blocked by missing owner authority, not by missing technical destination.
- #1031 is blocked only by the owner's external vendor courtesy action.
- #1090's successor chain is governed correctly, but #2334's machine-readable dependency status was not refreshed after #2333's production completion.
- #810 required both schema publication and authenticated business-flow proof; both are now complete.

## 6. Exact next steps

1. Re-resolve marker #2330 before any dispatch.
2. Have the orchestrator reclassify #2334 from blocked to ready only after its own overlap/dependency audit, then claim and dispatch it in an isolated worktree.
3. For #770, after Albert's two-part authorization, re-prove Cloud SQL and preview targets immediately before each read/write, use a dated locked scratch schema, keep exports protected, publish only sanitized counts/timings/sizes/hashes, tear down, and prove absence.
4. For #1031, wait for the privacy-safe vendor email and sent-date comment; then verify all other gates and close the issue if complete.
5. Continue #1090 successors serially through exact-head review, guarded merge, production apply, and live catalog evidence; do not start later successors out of order.
6. Never copy licensed rows or secrets into public issues, prompts, logs, commits, or pull requests.

## 7. Constraints and gotchas

- Never hand-delete author/reviewer refs or bypass the orchestrator.
- Never edit an applied migration; use a new forward migration.
- Preview is shared mutable infrastructure. Prove the target immediately before every write.
- Production apply requires current exact-head evidence and direct ledger/catalog readback.
- Ordinary application data remains outside this repository's structural orchestrator; curated Master Data remains separately gated.

## 8. Access, branches, and secrets

- GitHub CLI was authenticated and read-only issue/PR evidence was collected.
- No credentials, tokens, connection strings, licensed rows, or new secrets were printed or stored.
- No branch, commit, PR, migration, preview write, or production write was created by this closeout session.
- Existing dirty files belong to other work and were not changed.

## 9. Risks and open questions

- #770 cannot proceed until Albert authorizes both exact operations; do not infer permission from the existing preview rehearsal.
- #1031 cannot close until Albert records the vendor send date.
- #1090 cannot be called complete while successors, curated review, capture/weekly evidence, consumer cutover, compatibility retirement, and sustained monitoring remain open.
- The repository is behind `origin/main`; any successor must start from current upstream in an isolated worktree.

## Part B — evidence-backed self-audit

1. **Can a fresh developer continue without asking a question?** Yes: §§3 and 6 name the verified state, exact blockers, routing marker, and ordered next actions; the only owner decisions are explicitly isolated in §0.
2. **Are failed approaches and non-obvious facts preserved?** Yes: §4 records the missing template, stale #2334 status, dirty/behind checkout, and the deliberate decision not to duplicate reminders or perform structural work.
3. **Are safety and verification gates explicit?** Yes: §§1, 6, 7, and 8 require live target proof, protected scratch handling, exact-head review, production ledger/catalog readback, and secret/licensed-data protection.

