---
summary: Issues #819 and #849 plan: make PopDAM's review-fixer caller workflow pass its inputs and closed-issue events correctly, add its contract test, and finish the missing-PDF report and tag-vocabulary doc leftovers. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #819 or #849, editing .github/workflows/review-fixer.yml, scripts/list-missing-pdfs.sql, or the MODEL_RULES filler list
---

# Plan: Review-fixer caller workflow and review leftovers (u2giants/popdam3#819, #849)

Handoff registration: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md)

Two review-finding issues on the same caller workflow, planned together:
**#819** (review of merged PR #818, "remove push and delete triggers from review-fixer") and
**#849** (review of merged PR #848, "review-fixer fork guard, narrower push filter, doc truthfulness" —
the PR that implemented the now-closed #707 plan `docs/plans/issue-707-review-finding-leftovers.md`).

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1 Job gate admits closed review-finding issues | ⬜ open | — |
| 2 `issue` input precedence | ⬜ open | — |
| 3 `runner_labels` input honoured | ⬜ open | — |
| 4 Fork guard uses `full_name` | ⬜ open | — |
| 5 Workflow contract test | ⬜ open | — |
| 6 Missing-PDF report shows both kinds and both error channels | ⬜ open | — |
| 7 Quirk + index command cover `.ai` | ⬜ open | — |
| 8 `art` filler wording in MODEL_RULES | ⬜ open | — |
| 9 Report tests + stale plan note | ⬜ open | — |
| 10 Live proof | ⬜ open | — |

Fresh session starts at step 1 (planned 2026-11-25; nothing implemented). #819 finding 4 (removed
push/delete triggers) is **resolved upstream**: the callee `popcre/ai-devops/.github/workflows/review-fixer.yml`
(main, 2026-11-25) states retirement uses `pull_request_target`, finding-closed events and the
two-hourly schedule, and itself dropped push/delete — so no trigger is restored; step 1 makes the
closed-event route actually reach the callee.

## 1. Ultimate goal

When the advisory AI reviewer files a finding on a PopDAM pull request, the automatic fixer must
run for it, and when the finding is closed the fixer must tidy up any stale fix branch — reliably
and only for this repository's own branches. Separately, the tool the team uses to find artwork
records whose PDF or Illustrator file moved must list **every** such record with its real error,
and the AI-tagging rulebook must not contradict itself about the word `art`.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, branch `main`) is POP Creations' internal Digital Asset Manager.
Its CI includes `.github/workflows/review-fixer.yml`, a thin **caller** of the reusable workflow
`popcre/ai-devops/.github/workflows/review-fixer.yml@main` (the **callee**), which runs a headless
coding agent on a self-hosted runner labelled `ai-devops-linux` to fix `review-finding` issues on
`review-fix/<issue>` branches, or close them. Reviews and fixes are advice only (owner ruling
2026-10-29). `scripts/list-missing-pdfs.sql` is a read-only report run against the shared Supabase
database; `docs/KNOWN_QUIRKS.md` ("PDFs missing at their recorded path", ~line 669) gives the
operator procedure; `docs/MODEL_RULES.md` is the model/tagging rulebook.

## 3. What triggered this work

#819 findings (PR #818, head `8448ea4d`), confirmed by the fixer, left for an engineer because the
fixer never edits workflows:
1. The caller declares a `workflow_call` input `runner_labels` but passes a hard-coded value.
2. `issues: types: [labeled, closed]` is dead for `closed`: the job `if` requires
   `github.event.label.name == 'review-finding'`, which is null on a `closed` event.
3. `issue: ${{ github.event.issue.number || inputs.issue }}` lets the triggering event override an
   explicit input.
4. Removing push/delete triggers — resolved upstream (see STATUS note).
5. No regression test for the caller's contract.

#849 findings (PR #848, head `09cac911`):
1. Fork guard uses `head.repo.fork == false` instead of the locked
   `head.repo.full_name == github.repository` (null/deleted head repo case).
2-4. `scripts/list-missing-pdfs.sql` filters `file_type = 'pdf'` (hides `.ai` rows: 60 of 493 on
   2026-11-04), keeps one `coalesce(...) as error` column (shows the wrong channel), and has no
   `file_type` column / ordering.
5. `docs/KNOWN_QUIRKS.md` says PDFs only and its `find` indexes only `*.pdf`.
6. `docs/MODEL_RULES.md:60` lists `art` as filler while `:61` makes `art` a controlled label.
7. Planned tests were not added.

The fixer's own run claimed local fixes for 2-6 but published nothing (`fixer-failed`); main is unchanged.

## 4. Scope

In: `.github/workflows/review-fixer.yml` (caller only), a new test file, `scripts/list-missing-pdfs.sql`,
`docs/KNOWN_QUIRKS.md` (that quirk only), `docs/MODEL_RULES.md:60`, a one-line note in
`docs/plans/issue-707-review-finding-leftovers.md` §6.2 that push was later removed upstream.

NOT in this plan: any change in `popcre/ai-devops` (the callee); the `shared-db/` vendored mirror
(read-only); running the repoint procedure itself; changing tag vocabulary in
`supabase/functions/_shared/tag-asset-contract.js`.

## 5. Current state (origin/main `787c20b8`, 2026-11-25)

`.github/workflows/review-fixer.yml`:
- `:10-15` triggers: `pull_request_target [synchronize, closed]`, `issues [labeled, closed]`, schedule `17 */2 * * *`, `workflow_dispatch(issue)`, `workflow_call(issue, runner_labels default '["self-hosted", "ai-devops-linux"]')`.
- `:41-43` job `if`: `(github.event_name != 'issues' || github.event.label.name == 'review-finding') && (github.event_name != 'pull_request_target' || github.event.pull_request.head.repo.fork == false)`.
- `:46` `issue: ${{ github.event.issue.number || inputs.issue }}`; `:47` hard-coded `runner_labels: '["self-hosted", "Linux", "X64", "ai-devops-linux"]'`.
- Callee `prepare` job gate already admits `closed` and `labeled` with `review-finding`/`ci-red`; it uses `fromJSON(inputs.runner_labels || '["self-hosted", "ai-devops-linux"]')`.

`scripts/list-missing-pdfs.sql` (13 lines): selects `coalesce(s.indra_rescan_error, s.extraction_error) as error`; `where coalesce(a.is_deleted,false)=false and a.file_type='pdf' and (s.indra_rescan_error ilike 'ENOENT%' or s.extraction_error ilike 'ENOENT%') order by a.relative_path`.

`docs/KNOWN_QUIRKS.md:669` — "PDFs only; it filters `file_type = 'pdf'` … `.ai` rows … this repoint workflow does not touch", `find … -iname '*.pdf'`.

`docs/MODEL_RULES.md:60` — "Avoid filler such as `image`, `design`, `art`, `asset`, `colorful`, and `product` by themselves." `:61` — "Standalone art is `art`".

No test file for the caller exists in `src/test/` or `scripts/tests/`.

## 6. Key findings

- The closed-event route matters now: the callee retires stale fix PRs on finding-closed events, and the caller currently blocks every one of them.
- Two reviewers disagreed on `.ai` rows: #676 (review of PR #675) asked for a PDF-only filter; the #707 plan LOCKED keeping `.ai` rows with a `file_type` column; #848 shipped PDF-only. `.ai` files go through the same `pdf_text_samples` pipeline (shared-db migration `20260515132158_extend_pdf_backfill_to_ai_files.sql`), so a moved `.ai` file is the same problem. Showing both with a type column satisfies both concerns.

## 7. Approaches rejected

- **Restore push/delete triggers** — rejected: upstream removed them deliberately (popcre/ai-devops#2402 step 1.5).
- **Remove `closed` from the trigger list** — rejected: the callee uses it for retirement.
- **Remove the `workflow_call` block** — acceptable but rejected: callers may exist; honouring inputs is cheap.
- **PDF-only report** — rejected (§6).
- **Delete `art` from the controlled vocabulary** — rejected; the contract uses it. Fix the filler wording.

## 8. Design decisions

- LOCKED: job gate = `github.event_name != 'issues' || (github.event.action == 'labeled' && github.event.label.name == 'review-finding') || (github.event.action == 'closed' && contains(github.event.issue.labels.*.name, 'review-finding'))`, AND the fork guard.
- LOCKED: fork guard = `github.event_name != 'pull_request_target' || github.event.pull_request.head.repo.full_name == github.repository`.
- LOCKED: `issue: ${{ inputs.issue || github.event.issue.number }}`; `runner_labels: ${{ inputs.runner_labels || '["self-hosted", "Linux", "X64", "ai-devops-linux"]' }}`; caller input default changed to `'["self-hosted", "Linux", "X64", "ai-devops-linux"]'` so both agree.
- LOCKED (2026-11-25, this plan): the report lists PDF and `.ai` rows, columns `file_type`, `extraction_error`, `indra_rescan_error` (no `coalesce(s.`), ordered by `a.file_type, a.relative_path`; keep the file name.
- LOCKED: `MODEL_RULES.md:60` filler wording becomes "`art` by itself only when it is not the standalone-art category label".
- OPEN: test location — `src/test/review-fixer-workflow.test.ts` (Vitest, preferred) or `scripts/tests/*.test.mjs` (node:test).

## 9. Steps

1-4. **Caller workflow edits** — `lead-only` (security boundary: write tokens on a self-hosted runner). Apply the four LOCKED expressions of §8 to `.github/workflows/review-fixer.yml:28-47`. Gate: `actionlint .github/workflows/review-fixer.yml` (or `npx -y @action-validator/cli`) passes, and step 5's test passes.
5. **Contract test** — `helper-ok`. `src/test/review-fixer-workflow.test.ts` reads the YAML (use the `yaml` package if present in root deps, else regex) and asserts: triggers are exactly the §5 set; job `if` contains `github.event.action == 'closed'` and `contains(github.event.issue.labels.*.name, 'review-finding')`; contains `head.repo.full_name == github.repository`; does not contain `head.repo.fork`; `issue:` starts with `inputs.issue ||`; `runner_labels:` references `inputs.runner_labels`. Stop-and-ask: YAML parsing library missing. Gate: `npx vitest run src/test/review-fixer-workflow.test.ts` passes and fails when the gate line is reverted.
6. **Report SQL** — `helper-ok`. Rewrite `scripts/list-missing-pdfs.sql` per §8 (header comment: "PDF and .ai records … see docs/KNOWN_QUIRKS.md"). Stop-and-ask: you think a column is missing in `public.assets`. Gate: run it read-only through Supabase MCP `execute_sql` (a `select` only) on project `qsllyeztdwjgirsysgai` and record row counts per `file_type` in STATUS.
7. **Quirk procedure** — `helper-ok`. At `docs/KNOWN_QUIRKS.md:669` replace "PDFs only…does not touch" with "(lists PDF and `.ai` records)" and the find predicate with `\( -iname '*.pdf' -o -iname '*.ai' \)`. Gate: grep shows both patterns.
8. **MODEL_RULES** — `helper-ok`. Edit `:60` per §8. Gate: `:60` and `:61` no longer conflict.
9. **Tests + note** — `helper-ok`. Add `src/test/missing-pdfs-script.test.ts` asserting the SQL has no `file_type = 'pdf'`, no `coalesce(s.`, selects `a.file_type`, orders by `a.file_type, a.relative_path`, and uses `coalesce(a.is_deleted, false)`. Add a one-line dated note under §6.2 of `docs/plans/issue-707-review-finding-leftovers.md`. Gate: test passes.
10. **Live proof** — `lead-only`. After merge: find the next real `review-finding` issue closed by anyone and confirm a `review-fixer` run started for its `closed` event (`gh run list -w review-fixer -R u2giants/popdam3 --event issues`). Record run id on #819. If none occurs in the session, dispatch `workflow_dispatch` with `issue=<n>` and confirm it ran for that number (input precedence). Record on #849 the per-type counts from step 6.

Order: 1-4 lead → 5 → 6-9 parallel → one PR → 10.

## 10. Tests required

New: `src/test/review-fixer-workflow.test.ts`, `src/test/missing-pdfs-script.test.ts` (behaviours in §9). Green: `npm run lint`, `npm run typecheck`, `npm run test`.

## 11. Constraints and gotchas

- Branch + PR; the AI merges after required checks; reviews advisory, never waited on; no new required checks; no wait over 30 minutes; never ask Albert to approve.
- `pull_request_target` runs with base-repo tokens — the fork guard must not weaken.
- SQL is read-only: never run updates; database changes go only through `popcre/shared-db`.
- Do not edit `shared-db/` (vendored mirror).

## 12. Access and environment

`gh` as `u2giants`; Supabase MCP (read-only `execute_sql` select) for step 6; Node + `npm ci` at the root.

## 13. Definition of done, risks, open questions

Done: rows 1-10 cite artifacts; PR merged green; closed-event run observed; #819 and #849 closed with evidence. Risk: a wrong gate expression stops all fixer runs — the contract test and step 10 catch it; rollback = revert PR. Open: test location (§8).

## Self-audit

1. Executable without questions? Yes — §8 gives exact expressions; §9 gates.
2. Background/rejected paths? Yes — §3, §6 (the two-reviewer disagreement), §7.
3. Goal steers? Yes — §1.

## Lead launch prompt

```
Read docs/plans/issue-819-849-review-fixer-caller-and-leftovers.md in u2giants/popdam3 (STATUS first) and AGENTS.md.
You are the lead: do steps 1-4 and 10 yourself; hand 5, 6, 7, 8, 9 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol,
GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes or
posts; bring stop-and-ask triggers to you; take a step back after 30 minutes stuck.
Verify every gate, open one PR, merge when required checks pass (reviews advisory), do live proof,
update STATUS, close #819 and #849 with evidence.
```
