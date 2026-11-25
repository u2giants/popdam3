---
summary: Issues #976 and #977 plan: repair quirk links left dangling by the docs overhaul and clear the weekly documentation keeper's faults, including the outdated toolkit pin that rejects decision records. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #976 or #977, editing .github/workflows/doc-health.yml, or fixing doc-health faults
---

# Plan: Documentation health — dangling quirk links and keeper faults (u2giants/popdam3#976, #977)

Handoff registration: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md)

**#976** is the review finding on merged PR #975 ("full documentation overhaul — generated index,
headers, slim router"). **#977** "Documentation health" is the standing issue the weekly keeper
(`.github/workflows/doc-health.yml`) rewrites each run and closes itself when a run is clean. Both are
documentation upkeep from the same overhaul, so one plan.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1 Bump the keeper's toolkit pin | ⬜ open | — |
| 2 Repoint `KNOWN_QUIRKS #51` / `#75` links | ⬜ open | — |
| 3 Fix "AGENTS.md (this file)" in agents-reference | ⬜ open | — |
| 4 Fix `plan_shared_data_no_copies.md` header + link | ⬜ open | — |
| 5 Successor review of the 31-day handoff | ⬜ open | — |
| 6 Regenerate index; keeper run clean | ⬜ open | — |

Fresh session starts at step 1 (planned 2026-11-25). Keeper last run (issue body): Wednesday
November 25, 2026 2:49 PM EST, 32 faults. A local run of the current toolkit on `787c20b8` shows only
4 — the other 28 (`kind 'decision' is not one of …`) come from the keeper's old pinned toolkit.

## 1. Ultimate goal

Every pointer in the docs and code comments must lead a reader to the explanation it promises, so
nobody re-introduces a fixed bug (like hash-only file moves or slow row counts) because the warning's
link was dead; and the weekly documentation check must report only real problems, then close itself.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, `main`) — POP Creations' Digital Asset Manager. Its docs: router
`AGENTS.md`, generated `docs/INDEX.md` (from four-key headers: `summary`, `kind`, `status`,
`read-when`), `docs/agents-reference.md`, deep dives in `docs/`, quirk registry `docs/KNOWN_QUIRKS.md`
with fixed entries moved to `docs/archive/quirks-fixed-history.md`. Tool: `ai-doc-health` from
`popcre/ai-devops` (rules `docs/doc-health.md` there; config `.doc-health.json` here). The keeper
workflow checks out `popcre/ai-devops` at `env.DOC_HEALTH_TOOLKIT_REF` (`doc-health.yml:35`).

## 3. What triggered this work

#976 findings (PR #975, head `9c179699`): quirk #51 (quick_hash flip-flap / move-detection guard) and
#75 (8-second signed-in timeout; never rows + exact count together) moved to the archive, leaving
dangling "`docs/KNOWN_QUIRKS.md` #51/#75" pointers; `docs/agents-reference.md:26` says "`AGENTS.md`
(this file)". #977 lists faults each week.

## 4. Scope

In: the pointers in §5, `docs/agents-reference.md:26`, `plan_shared_data_no_copies.md` header and a
link to it, `.github/workflows/doc-health.yml:35`, the old handoff's successor review, index regeneration.
NOT in this plan: rewriting quirk content; moving more quirks; changing `.doc-health.json` thresholds;
editing `docs/archive/` content; other sessions' handoffs beyond the successor review.

## 5. Current state (origin/main `787c20b8`, 2026-11-25)

- `doc-health.yml:35` `DOC_HEALTH_TOOLKIT_REF: 97292fe727755841523a75a7b6a5cc3585245225` (the first
  ai-doc-health commit, #2472/#2473). `popcre/ai-devops` `8dfe276b` (#2726) added the `decision`
  kind; its main is `f1c4a1cc` on 2026-11-25.
- Pointers to `KNOWN_QUIRKS.md #51` (now `docs/archive/quirks-fixed-history.md` heading
  "## 51. `quick_hash` Collisions …", line 76): `docs/WORKER_LOGIC.md:187`, `docs/idiosyncrasies.md:245`,
  `docs/ONBOARDING.md:404`, `docs/PROJECT_BIBLE.md:182`, `supabase/functions/_shared/file-identity.ts:7`.
  (The `agent-api/index.ts:1117` comment cited by the review no longer exists.)
- Pointer to `#75` (archive line 384, "## 75. Signed-in Requests Die at 8 Seconds …"): `docs/ORDER_LIST.md:397`.
- `docs/agents-reference.md:26` — "- `AGENTS.md` (this file)".
- Local `ai-doc-health --repo .` (current toolkit) faults: `plan_shared_data_no_copies.md` summary >160
  chars and unreachable; `docs/INDEX.md` stale; `HANDOFF.d/2026-10-25T1537Z-edge-dev-mimo-ai-model-catalog-live-proof.md` 31 days old.
- `HANDOFF.d/2026-11-22T0211Z-…-scan-closeout-followups.md:189` also links #51 — another session's
  write-once handoff; do not edit.

## 6. Key findings

- The 28 `decision`-kind faults are a stale pin, not bad headers: the local current toolkit accepts them.
- Repointing to the archive keeps the history the warnings rely on; the archive is excluded from
  doc-health but remains a real file, so links resolve.

## 7. Approaches rejected

- **Change decision headers to another kind** — rejected: `decision` is the documented kind (ai-devops
  `docs/doc-health.md:61,73`).
- **Move #51/#75 back into KNOWN_QUIRKS** — rejected: #975 deliberately archived fixed entries.
- **Pin the keeper to `main` instead of a SHA** — rejected: the pin is intentional (reviewed as safe in
  #975); bump it to a specific SHA.
- **Close #977 by hand** — rejected: it closes itself on a clean run; a manual close reopens next week.

## 8. Design decisions

- LOCKED: links become `docs/archive/quirks-fixed-history.md` "#51" / "#75" (with the heading text).
- LOCKED: toolkit pin = the full SHA of `popcre/ai-devops` main at implementation time (≥ `8dfe276b`).
- OPEN: the old handoff — if its work is finished, set its status closed per handoff rules (the
  `handoff-writer` skill's successor-review procedure); if not, write a successor note. Judge by reading it
  against the issue it names.
- OPEN: where to link `plan_shared_data_no_copies.md` from — the AGENTS.md documentation map or
  `docs/agents-reference.md` → Pending work (prefer agents-reference; AGENTS.md is size-capped).

## 9. Steps

1. **Toolkit pin** — `helper-ok`. Replace the SHA at `doc-health.yml:35` with
   `gh api repos/popcre/ai-devops/commits/main -q .sha`. Stop-and-ask: the new toolkit reports new fault
   types locally. Gate: `/c/repos/ai-devops/bin/ai-doc-health --repo .` (or the toolkit at that SHA) runs
   and the PR's doc-health comment lists no `decision` faults.
2. **Quirk links** — `helper-ok`. Edit every pointer in §5 (5 for #51, 1 for #75) to
   "`docs/archive/quirks-fixed-history.md` #51" / "#75". Gate:
   `grep -rn "KNOWN_QUIRKS[^ ]* *#\(51\|75\)\b\|KNOWN_QUIRKS.md\` #\(51\|75\)" --include=*.md --include=*.ts . | grep -v "archive\|HANDOFF.d\|node_modules\|shared-db/"` is empty.
3. **agents-reference** — `helper-ok`. Change `:26` to "- `AGENTS.md` (the router)". Gate: grep "this file" no longer on `:26`.
4. **Plan header + link** — `helper-ok`. Shorten the `summary` of `plan_shared_data_no_copies.md` to
   ≤160 characters keeping its meaning; add a link per §8 OPEN. Gate: those two faults disappear locally.
5. **Old handoff** — `lead-only` (judgment). Per §8. Gate: `handoff-old` fault gone locally.
6. **Index + clean run** — `lead-only`. Run `ai-doc-health --repo . --fix-index` last (after rebasing on
   `main`, since other sessions add plans), commit `docs/INDEX.md`. After merge, dispatch the keeper
   (`gh workflow run doc-health.yml -R u2giants/popdam3`) and confirm #977 closes (or shows only faults
   from commits after this PR — then fix those in the same session). Gate: run id + #977 state in STATUS.

Order: 1-4 parallel → 5 → 6. One PR.

## 10. Tests required

No code behaviour changes. Checks: local `ai-doc-health --repo .` returns 0 faults; the PR's advisory
doc-health job; `npm run lint` (the `.ts` comment edit).

## 11. Constraints and gotchas

- Branch + PR; AI merges after required checks; doc-health is advisory and never blocks; no wait over 30
  minutes; never ask Albert to approve.
- Never edit another session's `HANDOFF.d/` file except the successor-review status change the handoff
  rules allow; never edit `docs/archive/` or `shared-db/`.
- Every new Markdown file needs the four-key header.

## 12. Access and environment

`gh` as `u2giants`; `ai-doc-health` at `C:\repos\ai-devops\bin\ai-doc-health` (Windows) or the toolkit
checkout on other machines.

## 13. Definition of done, risks, open questions

Done: rows 1-6 cite artifacts; PR merged; keeper run clean and #977 auto-closed; #976 closed with
evidence. Risk: other sessions keep adding faults — fix new ones found in step 6, or leave them to the
keeper (it reopens #977 automatically). Open: §8 OPEN items.

## Self-audit

1. Executable without questions? Yes — §5 lists each line, §9 gates.
2. Background/rejected paths? Yes — §6 (stale pin), §7.
3. Goal steers? Yes — §1.

## Lead launch prompt

```
Read docs/plans/issue-976-977-documentation-health.md in u2giants/popdam3 (STATUS first) and AGENTS.md.
You are the lead: hand steps 1-4 to your helper; do 5 and 6 yourself.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol,
GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes or
posts; bring stop-and-ask triggers to you; take a step back after 30 minutes stuck.
Verify every gate, open one PR, merge when required checks pass (reviews advisory), dispatch the keeper,
update STATUS, close #976 with evidence and confirm #977 closed itself.
```
