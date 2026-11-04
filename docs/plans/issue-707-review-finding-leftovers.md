# Plan: Small leftovers from closed review findings (u2giants/popdam3#707)
Issue: https://github.com/u2giants/popdam3/issues/707
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Worktree + branch | ⬜ open | |
| 2 | Fork guard on the review-fixer caller job | ⬜ open | absent: `.github/workflows/review-fixer.yml:31` has no head-repo condition |
| 3 | Decide the push filter (keep `'**'` with written reason, or narrow) | ⬜ open | still `branches: ['**']` at `:10-11`; see §6.2 for why narrowing is unsafe |
| 4 | Confirm `review-fixer-state.py` handling of PR-controlled data (ai-devops side) | ⬜ open | handled on `popcre/ai-devops` `tools/ci/review-fixer-state.py` (§6.3); needs only the written confirmation on #707 |
| 5 | Fix `scripts/list-missing-pdfs.sql` (OR the two error columns, nullable `is_deleted`, show `file_type`) | ⬜ open | script unchanged since #675; live count 2026-11-04: 433 pdf + 60 ai rows |
| 6 | Clarify `docs/KNOWN_QUIRKS.md` quirk 81 "never reset `PDF_BACKFILL`" sentence | ⬜ open | now at line 1311 (issue says 1309) |
| 7 | Update `docs/MODEL_RULES.md:52-53`: tag range and filler list (`:52`), controlled vocabulary (`:53`) | ⬜ open | `:52` says 6-18, contract says 4-18; `:53` still lists `professional photography`, `straight view`, `design asset` |
| 8 | Tests (§10), PR, CI, merge | ⬜ open | |
| 9 | Live proof on #707, close | ⬜ open | `- [ ] live proof` stays on #707 |

**Where a fresh session starts:** Step 1. All three checklist items on #707 are still open on `main` (tip `4409e2d3`, 2026-11-04). Nothing here depends on PR #713.

---

## 1. The ultimate goal

Three advisory AI reviews (#606, #676, #693) were closed with their main findings fixed, but each left one or two small items behind. This plan clears them so the automatic fixer cannot be started by an outsider's pull request, so the operator script and runbook for missing PDFs say what they actually do, and so the tagging documentation matches the words the tagger really uses. When done, #707's three checkboxes are ticked with evidence and nothing else on the issue remains.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Example: if narrowing the workflow's push trigger would stop the fixer retiring stale fix PRs (its job), do not narrow it; write down why and tick the item on that basis.

## 2. What this application is

PopDAM is POP Creations' digital asset manager (https://dam.designflow.app) plus PopSG (https://sg.designflow.app), repo `u2giants/popdam3`, branch `main`, developed on the production VPS `hetz`. Relevant parts for this plan: GitHub Actions in `.github/workflows/` (the `review-fixer` caller delegates to the reusable workflow in `popcre/ai-devops`, checked out locally at `/worksp/ai-devops`); the Railway worker's tagging code in `apps/worker/src/handlers/`; the Supabase project `qsllyeztdwjgirsysgai` where `public.pdf_text_samples` and `public.assets` live; operator docs in `docs/`. Read `AGENTS.md` first.

## 3. What triggered this work

- **#606** (review of PR #605, closed): the caller workflow added `push: ['**']`, `delete`, and `pull_request_target` triggers; the reviewer asked for a fork guard, a narrower push filter / concurrency, and evidence that the callee never acts on PR-controlled data.
- **#676** (review of PR #675, closed): `scripts/list-missing-pdfs.sql` under-reports (coalesce of two independent error columns), includes `.ai` rows under a "missing PDFs" name, and drops `is_deleted IS NULL` rows; `docs/KNOWN_QUIRKS.md` quirk 81's last sentence about `PDF_BACKFILL` is ambiguous.
- **#693** (review of PR #691, closed): `docs/MODEL_RULES.md:52-53` still documents the old tag vocabulary.
Issue #707 (2026-11-04) collected these three leftovers.

## 4. Scope

**In:** the three checklist items exactly as written on #707, with tests and evidence.

**NOT in this plan:**
- Changing the callee workflow or `review-fixer-state.py` in `popcre/ai-devops`. That repo is read here only to confirm behaviour; any change there is its own ai-devops issue (and the Entire trial rules apply to public `popcre/ai-devops` tasks).
- Repointing or retiring any missing-PDF record (that is the operator procedure in quirk 81 and `HANDOFF.d/2026-11-03T2210Z-hetz-claude-missing-pdf-records.md`).
- Any change to tagging behaviour or `tag-asset-contract.js`; only the doc moves.
- Any `shared-db` change.
- The other #693 findings (`sheetTagValue` guard, `loadSheetFacts` validation, re-validation after `finishTagResult`, worker tests) — those were handled on #693 itself; if the implementer finds one unfixed, note it on #693, not here.

## 5. Current state of the code (verified 2026-11-04, worktree tip `01fcfc34` containing `origin/main` `4409e2d3`)

### Item 1 — review-fixer caller
`.github/workflows/review-fixer.yml` (44 lines):
- `:10-11` `push: branches: ['**']`; `:12` `delete:`; `:13-14` `pull_request_target: types: [synchronize, closed]`.
- `:31` `if: github.event_name != 'issues' || github.event.label.name == 'review-finding'` — no fork condition, no `concurrency:` block in the caller.
- `:32` `uses: popcre/ai-devops/.github/workflows/review-fixer.yml@main`, `:36-39` `issues: write`, `pull-requests: write`.
- The repo is public and `allow_forking: true` (`gh api repos/u2giants/popdam3`), so fork PRs can exist.

Callee, `/worksp/ai-devops/.github/workflows/review-fixer.yml` (last change to it and the state script: commit `c572801b`, 2026-11-04 12:08 AM EST): `prepare` job (`:44-66`) checks out `popcre/ai-devops@main` only, runs `tools/ci/review-fixer-state.py plan "$ISSUE"`; `fix` job (`:68-…`) has `concurrency: group: review-fixer-${{ github.repository }}-${{ matrix.key }}`, `cancel-in-progress: false` (`:80-82`). ai-devops issue #2171 (the retirement design) is CLOSED.

`/worksp/ai-devops/tools/ci/review-fixer-state.py` (447 lines):
- `:86-93` validates `owner` and `target_branch` against strict regexes before any git use.
- `:205-215` `current()`: rejects when the source PR head repo `full_name != self.repo` ("source branch is not in this repository").
- `:250` comment: the adapter it runs is "same-repository DEFAULT-branch code, never PR-head".
- `:338-365` event parsing: `push` only takes `ref` (tags ignored), `delete` only `ref`/`ref_type`, pull-request events read `head.repo` and treat a missing fork repo as "no same-repo target" (`:363`).
So PR-controlled strings (title, body, branch name) are never interpolated into a shell; branch names are validated; fork heads are refused before any action.

### Item 2 — missing-PDF script and quirk
`scripts/list-missing-pdfs.sql` (11 lines) on `main` is unchanged since PR #675: `coalesce(s.indra_rescan_error, s.extraction_error)` at `:5` and `:9`, `a.is_deleted = false` at `:8`, no `file_type` column or filter.
Live measurement 2026-11-04 (read-only, Supabase MCP, project `qsllyeztdwjgirsysgai`), using the OR form and `coalesce(a.is_deleted,false) = false`:
`pdf` 433 rows, `ai` 60 rows (493 total). The issue's "60 of 498" matches the `.ai` count; the 498 was the coalesce-form total.
`docs/KNOWN_QUIRKS.md` quirk 81 ("PDFs missing at their recorded path are mostly stale duplicate records (2026-11-03)") starts at `:1302`; the sentence to clarify is on `:1311` (not 1309 as the issue says — lines shifted): "A repointed record that has `indra_rescan_at` set needs it cleared to be read again during a rescan; never reset `PDF_BACKFILL`. Clear it before the run completes, because a completed run does not restart by itself."

### Item 3 — MODEL_RULES vocabulary
`docs/MODEL_RULES.md:53` ("Controlled image categories (added 2026-08-16)") still says `professional photography` + `straight view` / `close-up view` / `lifestyle / in-use image` / `person holding item / size scale image`, and `design asset` + `artwork`.
Canonical today: `supabase/functions/_shared/tag-asset-contract.js:166-179` — `product photography` + `front view` / `3/4 view` / `close-up` / `back view` / `side view`; `lifestyle photo`; `size scale image`; `product mockup`; `art`; `tech pack`; `licensing sheet`; `packaging design`; `embellishment placement design`; `freelancer illustration`; and the content-type mapping line `:179`. `apps/worker/src/handlers/tag-finish.ts:11-24` `LABEL_RENAMES` maps every old label to the new one (`design asset` → dropped). `:52` is also stale: it says "6-18" while the contract has `minItems: 4` (`tag-asset-contract.js:28`) and tells the model "Return 4-18" (`:163`); its filler list also names `art`, now a controlled label (`:178`). Issue #707 names both lines.

### Already landed on `main`
None of the three items. (All of #606's, #676's and #693's *other* findings were handled on those issues; not re-verified here, out of scope.)

## 6. Key findings

1. **Fork guard is cheap and correct.** The callee already refuses fork heads in `review-fixer-state.py:211-212`, but that runs *after* the job has started with write tokens on a self-hosted runner. A caller-side `if` stops the job before it starts: `github.event_name != 'pull_request_target' || github.event.pull_request.head.repo.full_name == github.repository`.
2. **Narrowing `push` by branch pattern would break retirement.** The fixer retires a `review-fix/<issue>` PR when the *source* PR's head moves (`state.py:215`, "source moved to …") or its branch is deleted. Source PRs live on arbitrary branch names (`claude/...`, `codex/...`, `review-fix/...`), so a pattern like `[main, 'review-fix/**']` would miss most of them. `pull_request_target: synchronize` covers open PRs, but `push` is still what reaches the callee for branches whose PR is closed and for the retire-on-delete path. Run pileup is bounded by the callee's per-target `concurrency` (`callee:80-82`). Recommendation (OPEN in §8): keep `'**'`, add a comment explaining this, and tick the item with that reasoning.
3. **PR-controlled data is handled on the callee side** (§5, four line refs). This item needs a written confirmation on #707, not a code change in this repo.
4. **The SQL script's three defects are real** (verified by reading `main`), and the `.ai` share is 60/493. Because `.ai` files also flow through `pdf_text_samples` (`supabase/migrations/20260515132158_extend_pdf_backfill_to_ai_files.sql`), the right fix is to *show* `file_type` and keep both kinds (the operator procedure handles both), while the file name and header say so.
5. **Quirk 81's last sentence conflates two objects**: `indra_rescan_at` (per-row rerun gate, cleared to re-read a repointed row) and `PDF_BACKFILL` (the `admin_config` run-control object; never reset mid-run). "Clear it" refers to `indra_rescan_at`, not `PDF_BACKFILL`.
6. `docs/MODEL_RULES.md` is routed from `AGENTS.md:142` as the model/tagging rulebook; a stale vocabulary there misleads anyone editing prompts. The 2026-08-16 date and the old labels are history worth keeping as one sentence ("renamed 2026-11 — see `LABEL_RENAMES`").

## 7. Approaches considered and rejected

- **Add `concurrency:` to the caller.** Rejected: a reusable-workflow *caller* job cannot set `concurrency` at the job level with `uses:` in the way a normal job can without cancelling the callee's own groups; the callee already serialises per target (`callee:80-82`). Adding a second group risks cancelling a legitimate sweep.
- **Switch `pull_request_target` to `pull_request`.** Rejected: the fixer needs base-repo write permissions to retire PRs; `pull_request` from a fork would run without them and the retire step would fail silently. The fork guard gives the same safety.
- **Add `and a.file_type = 'pdf'` to the script.** Rejected: hides 60 real missing `.ai` records the same procedure must handle. Show the column instead.
- **Delete the "never reset `PDF_BACKFILL`" sentence.** Rejected: the warning is correct; only its antecedent is unclear.
- **Rewrite all of `MODEL_RULES.md`.** Rejected: only `:53` is stale on this topic; keep the diff small.

## 8. Design decisions

- **LOCKED (2026-11-04):** fork guard goes in the caller job `if:` (Step 2) using `head.repo.full_name == github.repository`.
- **LOCKED:** no change in `popcre/ai-devops` from this plan.
- **LOCKED:** the SQL script keeps `.ai` rows and adds `a.file_type` as an output column; the comment header says "PDF and .ai records".
- **LOCKED:** `MODEL_RULES.md:53` is replaced by the current vocabulary with a one-sentence rename history.
- **OPEN (Step 3):** keep `push: branches: ['**']` (recommended, reason §6.2) vs narrow. Criterion: narrow only if the implementer can show from `review-fixer-state.py` that every retirement path is also reached by `pull_request_target` or `delete` for closed-PR branches. If not shown, keep `'**'` and comment it.
- **OPEN:** whether to rename the script to `list-missing-pdf-and-ai.sql`. Prefer not: quirk 81, the 2026-11-03 handoff and the issue all cite the current name.

## 9. The plan

**Step 1 — Worktree/branch.** `git worktree add ../popdam-707 -b claude/707-review-leftovers origin/main`. Gate: `git status` clean, commit identity verified (`git var GIT_COMMITTER_IDENT` shows Albert's noreply identity; worktrees do not inherit it).

**Step 2 — Fork guard.** Edit `.github/workflows/review-fixer.yml:31` to:
```
if: >-
  (github.event_name != 'issues' || github.event.label.name == 'review-finding') &&
  (github.event_name != 'pull_request_target' || github.event.pull_request.head.repo.full_name == github.repository)
```
Add a one-line comment above it: "Fork PRs never start the fixer; it carries base-repo write tokens on a self-hosted runner (#606)." Gate: `actionlint .github/workflows/review-fixer.yml` (if installed; else `npx -y @action-validator/cli`... if neither is available, rely on the CI "guard"/"verify" checks and the §10 test); the §10 workflow test passes.

**Step 3 — Push filter decision.** Apply §8 OPEN criterion. Default outcome: keep `'**'`, add the comment "Any branch may be a source PR head; retirement needs every push. Runs are serialised per target by the callee's concurrency group (#606)." Gate: comment present; the decision and the `state.py` line refs (§5) posted on #707 under the first checkbox.

**Step 4 — Confirm `review-fixer-state.py` handling.** No code. Post on #707 (signed): "PR-controlled data: branch names validated `state.py:86-93`; fork heads refused `:211-212`; never checks out PR head `:250`; events parsed field-by-field `:338-365` (ai-devops `c572801b`)." Gate: comment visible.

**Step 5 — SQL script.** Replace `scripts/list-missing-pdfs.sql` body with:
```
-- Read-only. PDF and .ai records whose file was not at the recorded path on
-- their last read (normal backfill OR Indra rescan). Save as CSV and compare
-- with an edgesynology1 file index; see docs/KNOWN_QUIRKS.md "PDFs missing at
-- their recorded path". `.ai` rows share pdf_text_samples (migration
-- 20260515132158) and follow the same procedure.
select a.id as asset_id, a.file_type, a.filename, a.relative_path, a.file_size,
       a.modified_at, a.quick_hash,
       s.extraction_error, s.indra_rescan_error
from public.pdf_text_samples s
join public.assets a on a.id = s.asset_id
where a.is_deleted is distinct from true
  and (s.extraction_error ilike 'ENOENT%' or s.indra_rescan_error ilike 'ENOENT%')
order by a.file_type, a.relative_path;
```
Gate: run it read-only through the Supabase MCP (`execute_sql`) — row count equals the sum of the per-type counts from the same session (on 2026-11-04 that was 493; it will drift as records are retired) and `file_type` shows both `pdf` and `ai`; §10 script test passes.

**Step 6 — Quirk 81 sentence.** Replace the last sentence of `docs/KNOWN_QUIRKS.md:1311` with: "A repointed record that has `indra_rescan_at` set is skipped by the next rescan; clear that row's `indra_rescan_at` before the run finishes, because a completed run does not restart by itself. `PDF_BACKFILL` in `admin_config` is the run's own control object (status, totals); pausing and resuming through the UI is fine, but never reset or edit it by hand to force a re-read." Also change "Run `scripts/list-missing-pdfs.sql`" in the same paragraph to "Run `scripts/list-missing-pdfs.sql` (lists PDF and `.ai` records)", and extend the paragraph's index command, which is `-iname '*.pdf'` only and so can never match the 60 `.ai` rows, to `\( -iname '*.pdf' -o -iname '*.ai' \)`. Gate also: `grep -n "iname '\*.ai'" docs/KNOWN_QUIRKS.md` finds it. Gate: `grep -n "never reset \`PDF_BACKFILL\`" docs/KNOWN_QUIRKS.md` empty; the new sentence present; `docs/WORKER_LOGIC.md:274` (the `indra_rescan_at` rule the reviewer cited) still agrees.

**Step 7 — MODEL_RULES vocabulary.** Replace `docs/MODEL_RULES.md:53` with a bullet that lists exactly the labels in `tag-asset-contract.js:166-179` ("Controlled asset types (renamed 2026-11, PR #691): product photography + front view / 3/4 view / close-up / back view / side view; lifestyle photo; size scale image; product mockup; art; tech pack; licensing sheet; packaging design; embellishment placement design; freelancer illustration. Old labels (`professional photography`, `straight view`, `design asset`, `artwork`, …) are mapped by `LABEL_RENAMES` in `apps/worker/src/handlers/tag-finish.ts`; never write them in prompts. Canonical wording: `supabase/functions/_shared/tag-asset-contract.js` and its identical Railway vendor mirror."). On `:52`, change "6-18" to the range `validateTagAssetData` actually enforces (expected 4-18; confirm in the code), and qualify `art` in the filler list so it does not contradict the controlled label. Gate: §10 vocabulary tests pass, including new "MODEL_RULES states the same tag range as the contract".

**Step 8 — Tests, PR, CI, merge.** Add §10 tests; `npm run lint && npm run typecheck && npm test` green locally; commit (stage only the files above); push; `gh pr create --base main` titled "Close #707 review-finding leftovers", signed with `$AI_GH_SIGNATURE`, ending with the attribution line in force; `bin/ai-pr-wait <pr>` in the background; merge. Gate: `gh pr view <pr> --json mergedAt` non-null. No deploy is affected except the workflow file (takes effect on merge); frontend/worker/edge builds publish unchanged code — confirm `publish-frontend.yml` is green for the merge SHA anyway.

**Step 9 — Live proof on #707.**
- Workflow: after merge, `gh run list --workflow review-fixer.yml --limit 3` shows runs still starting on `main` pushes (the guard did not break normal events); optionally open a throwaway PR from a branch in this repo and confirm a `synchronize` run starts; no fork PR exists to test the negative path — state that explicitly.
- Script: paste the Step 5 row count and the two `file_type` values.
- Docs: links to the merged lines.
Tick all three checkboxes and `- [ ] live proof`, close #707, signed.

## 10. Tests required

| File | Test name (behaviour) |
|---|---|
| `src/test/review-fixer-workflow.test.ts` (new; vitest `src` project reads the YAML as text) | "review-fixer caller refuses fork pull requests" (asserts the `head.repo.full_name == github.repository` condition is present in the job `if`); "review-fixer caller keeps review-finding label gate" (asserts the label condition is still present) |
| `src/test/missing-pdfs-script.test.ts` (new, text) | "lists both error channels with OR, not coalesce" (contains `or s.indra_rescan_error ilike 'ENOENT%'`, does not contain `coalesce(s.`); "keeps records whose is_deleted is null" (contains `is distinct from true`); "reports file_type so .ai rows are visible" (contains `a.file_type`) |
| `src/test/model-rules-vocabulary.test.ts` (new, text) | "MODEL_RULES uses the live controlled asset types" (contains `product photography`, `front view`, `lifestyle photo`, `size scale image`; does not contain `straight view` or `` `design asset` plus`` as a live instruction — allow the one history sentence by asserting the old labels appear only on a line containing `LABEL_RENAMES`); "every controlled label in MODEL_RULES exists in tag-asset-contract.js" (parse the bullet's labels and check each is a substring of the contract file); "MODEL_RULES states the same tag range as the contract" |
| Existing | root `npm run lint && npm run typecheck && npm test`; worker, windows-agent, root build in CI |

Adversarial cases (trust boundary = GitHub event data reaching a workflow with write tokens):
| Input | Hostile case | Test / evidence |
|---|---|---|
| `pull_request_target` from a fork | outsider opens/updates a PR to start the fixer | `review-fixer caller refuses fork pull requests` + `state.py:211-212` |
| PR branch name with shell metacharacters | `git` arg injection in the callee | `state.py:86-93` regex (ai-devops, cited on #707) |
| `push` with a tag ref | tag treated as a branch target | `state.py:341-344` returns empty matrix (cited) |
| Deleted fork repository on a PR event | `head.repo` is null | `state.py:363` (cited) |

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; the AI merges.
- No change under `/worksp/ai-devops` from this plan; reading it is fine. Public `popcre/ai-devops` work is governed by the Entire-trial rules in the global instructions.
- Production DB read-only: the SQL in Step 5 is a `select`; run it only through the read-only path. No `shared-db` change.
- `docs/KNOWN_QUIRKS.md` and `docs/MODEL_RULES.md` are routed from `AGENTS.md`; keep their headings intact so the router lines still match.
- Line numbers in this plan were true on 2026-11-04; re-grep before editing (`grep -n "never reset" docs/KNOWN_QUIRKS.md`, `grep -n "Controlled image categories" docs/MODEL_RULES.md`).
- Sign every GitHub post with `$AI_GH_SIGNATURE`; times in EST; secrets only from 1Password `vibe_coding`.
- Wait on CI with `bin/ai-pr-wait` in the background, never a sleep loop.

## 12. Access and environment

- Machine `hetz`; canonical repo `/worksp/popdam` (landing-only; use a worktree); ai-devops checkout `/worksp/ai-devops` (read only for this plan).
- `gh` authenticated as `u2giants`; `gh api repos/u2giants/popdam3` works.
- Supabase MCP `execute_sql` works read-only against `qsllyeztdwjgirsysgai` (used for the 2026-11-04 count).
- No test login needed. No deploy beyond the workflow file.
- CI: `.github/workflows/ci.yml`; the workflow file is also exercised by the `guard` / `verify` checks seen on PR #713.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Fork guard merged on `main`; push-filter decision and `state.py` confirmation posted on #707.
- [ ] `scripts/list-missing-pdfs.sql` fixed; quirk 81 sentence clarified; `MODEL_RULES.md:53` current.
- [ ] Three new test files green; CI green; PR merged; `review-fixer.yml` runs still start on `main` pushes after merge.
- [ ] All three #707 checkboxes and `- [ ] live proof` ticked with evidence; issue closed, signed.
- [ ] This plan's STATUS table updated by the executor.

Risks and rollback:
- A wrong `if:` expression silently disables the fixer for every event. Mitigation: Step 9 confirms a run starts on the merge push; rollback is a one-line revert.
- Text-contract tests are brittle to wording. Mitigation: assert on identifiers (`LABEL_RENAMES`, label strings, SQL fragments), not sentences.

Open questions: none business-meaning. The two engineering OPEN items are in §8 with criteria.

## Self-audit

1. **Could a brand-new session execute this without asking anything?** Yes: §5 pins every target line (and §11 says to re-grep), §9 gives the exact YAML, SQL and doc text to write, §10 names each test with its assertion, §12 says which tools are authenticated.
2. **Does it carry every piece of background and what was ruled out?** Yes: §3 explains where each leftover came from, §6 records why narrowing the push filter is unsafe and where the callee already handles PR data (with ai-devops line refs and commit), §7 lists five rejected alternatives, §8 marks locked vs open.
3. **Is the goal clear enough to steer by?** Yes: §1 states the three outcomes and the rule that a trigger change must never stop the fixer from doing its retirement job; a wrong step is resolved by that rule.
