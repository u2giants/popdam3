---
summary: Plan for #1310, #985, #1007, #1012 (and #1328 findings 4–6) — fix the folder-rename name rules and make the NAS rename tool safe for the remaining batches; must land before the next production batch. Read its STATUS first.
kind: plan
status: open
read-when: changing tools/folder-rename/ or supabase/functions/_shared/folder-rules/core.mjs, or before running any Phase 5 rename batch after the Desperate Signs pilot
---

# Plan: folder-rename name rules and rename tool fixes — u2giants/popdam3#1310, #985, #1007, #1012

Issues covered (all review findings on merged PRs of the folder-shortening project #963):
- https://github.com/u2giants/popdam3/issues/1310 — rename tool `execute.mjs` (PR #1308)
- https://github.com/u2giants/popdam3/issues/985 — name rules: dot, range, brackets, punctuation, tests (PR #983)
- https://github.com/u2giants/popdam3/issues/1007 — short owner names with `_finished`, test gap (PR #1005); its STATUS-paragraph finding is handled by [issue-1328 plan](issue-1328-folder-shortening-records-and-path-rules.md)
- https://github.com/u2giants/popdam3/issues/1012 — rescue branch makes `VW_finished`, no planner test (PR #1009)
- https://github.com/u2giants/popdam3/issues/1328 findings 4–6 only (ShareSync check, scan state, customer/program summary in the run log); the rest of #1328 is in the issue-1328 plan.

Parent plan (do not rewrite; read its STATUS and Phase 5 first): [`plan_folder_shortening_snapshot_restore.md`](../../plan_folder_shortening_snapshot_restore.md)
Phase 5 batch handoff (the session that runs the renames): [`HANDOFF.d/2026-11-25T1511Z-hetz-claude-folder-shortening-phase5-batches.md`](../../HANDOFF.d/2026-11-25T1511Z-hetz-claude-folder-shortening-phase5-batches.md)
Handoff for this plan: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md)
Written 2026-11-25 (3:55 PM EST) by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm findings on `main`; tell the Phase 5 session to hold batches | ⬜ open | |
| 2 | Run the folder-rename tests in CI | ⬜ open | |
| 3 | Rename tool: skip already-renamed rows; guard empty steps | ⬜ open | |
| 4 | Rename tool: quoting (label, `$$`, character counts) | ⬜ open | |
| 5 | Rename tool: checkout states, failure paths, clock | ⬜ open | |
| 6 | Rename tool: safe revert | ⬜ open | |
| 7 | Rename tool: ShareSync check, scan state, customer/program summary, log on failure | ⬜ open | |
| 8 | Rename tool tests against a temp folder and a stub database | ⬜ open | |
| 9 | Name rules: brackets, spaced ranges, space before dot | ⬜ open | |
| 10 | Name rules: punctuated customer names in child folders | ⬜ open | |
| 11 | Name rules: short owner names with `_finished`; rescue branch | ⬜ open | |
| 12 | Planner tests (engine level) | ⬜ open | |
| 13 | Regenerate the rename list; explain every changed row | ⬜ open | |
| 14 | PR, CI, merge; rehearsal re-run on preview | ⬜ open | |
| 15 | Comment on each issue; close the ones fully done | ⬜ open | |

**Where a fresh session starts:** step 1. Context cut point: after step 8 (tool done) — write a handoff, re-read steps 9–15 before continuing.

---

## 1. The ultimate goal

Designers can't open some files because the folder path is too long. Project #963 is shortening about 4,150 NAS folder names by rule. One customer (Desperate Signs) was renamed on 2026-11-24 as a pilot and it went well. About 4,100 renames are still to come, including the two top folders that every file sits under.

This plan makes sure the remaining renames **produce the names Albert agreed to, and cannot damage the drive or PopDAM's records**. That means no half-renamed batch, no folder nested inside another by mistake, no batch that aborts because it re-tries a folder already done, and names without junk like `(Feb )`.

**If a step conflicts with this goal, the goal wins — stop and flag it on #963.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) is POP Creations' library of design files kept on a Synology NAS. The NAS share is `mac` (`/volume1/mac`). **Writes only on `edgesynology1` (edge1)**; `edgesynology2` (edge2) is a one-way ShareSync copy. PopDAM stores every file's path in Supabase Postgres (project `qsllyeztdwjgirsysgai`; preview project `mvpkijzfmfcxhnzqogzs`) in `public.assets.relative_path`, plus folder paths in `public.style_groups.folder_path` and a few other tables (`PATH_COLUMNS`, `tools/folder-rename/execute.mjs:29-36`). A scanner on the NAS (the "bridge agent") walks the share every 2 hours.

The folder-shortening parts:
- **Name rules engine**: `supabase/functions/_shared/folder-rules/core.mjs` (358 lines) with `rules.json` beside it. A byte-identical copy of `rules.json` is in `tools/folder-rename/rules.json`. The engine is also used by the admin screen Settings → File Health → Folder Names (`guard.mjs`, plan issue-1015).
- **Planner**: `tools/folder-rename/plan.mjs` reads a folder listing and writes `verification/folder-shortening/old-to-new.csv` (the frozen list, 2026-11-13 edge2 listing, ~4,157 rows), `needs-attention.csv`, `summary.md`.
- **Rename tool**: `tools/folder-rename/execute.mjs` (280 lines). Takes rows from the CSV by `--match <old_path prefix>`, checks preconditions, takes a locked btrfs snapshot of `mac` via DSM, renames on edge1 over SSH (`mv -n`), inserts a row into `dam.folder_rename_log`, rewrites stored paths in one transaction per folder (`rewriteSql`), checks postconditions, writes `verification/folder-shortening/run-<label>-<id>.md`. `--revert <batch_id>` undoes a batch.
- `dam.folder_rename_log` and the path-attribute function `infer_path_attrs` live in shared-db (`popcre/shared-db`); stored stage/customer/program are recomputed by trigger when a path changes. Customer short folder names map back to the full customer name through `dam.customer_folder_alias` (shared-db PR #7022, live).

## 3. What triggered this work

Four advisory AI reviews (Muse, GLM, Antigravity) on merged PRs #983, #1005, #1009, #1308, plus #1328 on the pilot log PR #1326. The review fixer could not fix merged code and deferred all of them. The renames continue (Phase 5.4+), so the tool defects matter now.

## 4. Scope

In: every finding in the five issues above that is still present (§5), tests, CI wiring, regenerated list.

### NOT in this plan
- Running any production batch (that is the Phase 5 batch session's job; this plan only re-runs the rehearsal on preview).
- The admin Folder Names screen (issue-1015 plan) — but step 2's CI wiring also covers its `guard.test.mjs`.
- Plan STATUS wording and pilot records (issue-1328 plan).
- Changing Albert's naming rules. Every change here is a bug fix inside his rules.

## 5. Current state (verified on `main` @ `787c20b8`, 2026-11-25; tests `node --test tools/folder-rename/` 25 pass)

Rename tool (`tools/folder-rename/execute.mjs`):
- **R1 re-queue (#1310 f2)** — `run()` `:164` takes every CSV row under `--match`; `planSteps` (`:79-90`) remaps only the parent via `forwardMap`, never drops rows already in `dam.folder_rename_log`. A batch on `…/Concept Approved Designs` or the top folder `In Development` (step 5.6) would include rows already renamed and abort with "missing on disk". **This blocks the remaining batch order.** Empty steps can't happen today (`:166` throws on no rows; old≠new always) but there is no explicit guard before the SQL at `:183-185`, `:239-240`.
- **R2 label injection (#1310 f3)** — `snapshot()` `:139` puts the label raw inside `'snapinfo={"desc":"${label}","lock":true}'` in the SSH script.
- **R3 SQL quoting (#1310 f5)** — `rewriteSql` `:102-113` wraps the update in `do $$ … end $$;` (a name with `$$` breaks out) and uses JS `from.length` (UTF-16 units) in `left()/substr()` (Postgres counts code points).
- **R4 checkouts (#1310 f4)** — `:183` checks only `c.status = 'active'`; the one-active-per-asset index also treats `checkin_queued`, `uploading`, `verifying` as live.
- **R5 failure paths (#1310 f6)** — `:209` `ssh()` uses `execFileSync`, which throws on non-zero, so the friendly error at `:210` is unreachable; rollback `:219` is unverified and if it throws the database error is lost. `renamed_at` is the Node clock (`:211`), `reverted_at` is `now()` (`:262`); the table check `reverted_at >= renamed_at` can fail under clock skew.
- **R6 revert (#1310 f1)** — `revert()` `:251-267`: no preconditions (scan, checkouts, target free); `mv -n new old && [ -d old ]` (`:258`) nests the folder inside `old` if `old` exists and still says ok; `psql` has no rollback.
- **R7 run log (#1328 f4–6)** — no ShareSync idle check anywhere; scan state is checked (`:176-179`) but values not recorded and nothing reminds to turn scanning back on; no customer/program summary; `writeRunLog` (`:247`) only runs on success, so a stopped batch leaves no log file.
- **R8 tests (#1310 f7)** — `execute.test.mjs` has 4 pure tests; none for precondition abort, literal `%`/`_` prefix, or revert.
- **R9 CI** — `tools/**/*.test.mjs` is not run by CI: `vitest.config.ts` includes only `src/**`, `supabase/functions/**/*.test.ts`, `apps/**/src/**/*.vitest.ts`; `ci.yml:80` `node --test` lists only `scripts/…`.

Name rules (`core.mjs`; examples run through `planRenames` on 2026-11-25):
- **N1 brackets (#985 f3)** — `tidy` `:20-30` removes only empty `()`. CSV row 281 `Hobby Lobby Group 27 (Feb 2026)` → `Group 27 (Feb )`; children at rows ~3442-3444, 3941-3944, 4101 carry `(Feb )`.
- **N2 spaced range (#985 f2)** — `standaloneYears` `:95` now protects `2026-2027` (CSV row 364 keeps it) but `Wall 2026 - 2027` → `Wall - 2027`.
- **N3 space before dot (#985 f1)** — no longer triggered (`2026.merged` is kept whole by `:95`), but `tidy` still has no rule; add the guard and a test.
- **N4 punctuated customer names (#985 f4)** — customer folder alias match is normalized (`aliasFor` `:110-114`), but descendant stripping is literal (`stripTermsFor` `:136-140` → `stripTerms` `:33-40`). Results: `Ollie's/Ollies Fall Wall` and `POP Shelf/Popshelf Wall Art` unchanged; CSV row 104 `_FINISHED/Ollie's_finished` → `Ollie's` while the customer folder becomes `Ollies` (two spellings, against Albert's "one spelling everywhere", 2026-11-13); `_FINISHED/Ollie's_finished/Ollies Nick Clocks SS24` not shortened; `Hobby Lobby/HobbyLobby Wall Art` → `Hobby_Lobby Wall Art`.
- **N5 `_finished` short alias (#1007 f2, #1012 f1)** — the guard `:297` `!(p.applied.length === 1 && p.applied[0] === "customer_alias")` lets `["customer_alias","drop_finished_suffix"]` into the rescue branch: `_FINISHED/Variety Wholesalers_finished` → `VW_finished` (wrong; should be `VW`). Latent: no such folder in the 2026-11-13 list.
- **N6 tests (#985 f5, #1007 f1, #1012 f2)** — no tests for N1–N5; no test for `Concept Approved Designs` → `Concept_Approved` as the renamed folder (`plan.test.mjs:79` only uses it as a parent); idempotency test `plan.test.mjs:87-94` uses 7 Ross paths only; the VW test `:110` tests `aliasFor`, not the planner; the rescue branch `:296-301` has no test.
- **N7 generic names (#985 f6)** — `Ross Wall 2026` → `Ross/2026/Wall`, `Burlington Wall 2027` → `Wall`. This is Albert's rule (drop a year a higher folder shows; drop the customer name), decided 2026-11-13. Not a bug; the risk is only search/filter results, which step 7's customer/program summary and the parent plan's 5.7 search re-run check.

## 6. Key findings and root cause

- R1 is the important one: the tool was written for "one subtree per batch" and the pilot happened to rename a whole customer subtree at once. Any batch whose prefix contains already-renamed rows (Concept Approved stage folder, the two top folders) breaks. The log table already has the truth: a non-reverted log row whose `old_path` equals the CSV row's `old_path` (after mapping its parent through earlier renames) means "done".
- N1/N2/N4 rows are in the frozen CSV for folders **not yet renamed** (Hobby Lobby, Ollie's, Burlington…). Fixing the engine without regenerating the list would leave the bad names in the list the tool executes.
- Desperate Signs rows (batch `6859574e-0221-4e07-8c79-d278c5c7b948`) are already on disk; their CSV rows must stay exactly as executed.

## 7. Approaches considered and REJECTED

- **Hand-editing the bad rows in `old-to-new.csv`**: drifts from the engine the Folder Names screen uses; the next regeneration would bring them back.
- **Keeping `(Feb 2026)` years always**: contradicts Albert's "drop a year shown by a higher folder". Removing the year and the leftover space (`(Feb)`) follows the rule; if the bracket becomes empty it is dropped (already the behaviour).
- **Server-side rename service instead of the CLI tool**: far bigger; the CLI with `op run` is the agreed design (parent plan §8).
- **Dropping `mv -n` for `rename(2)` via a helper binary on the NAS**: no binaries are installed on the NAS by policy; `mv -n` + explicit `[ ! -e target ]` check is enough.
- **Fixing R1 by asking the operator to list only leaf prefixes**: error-prone; the tool must be safe for any prefix.

## 8. Design decisions

Locked (do not relitigate):
- Albert's rules (2026-11-13): his 21 customer short names are final; one spelling of a customer everywhere; drop a year shown by a higher folder; the six customer+year folders keep their names; folders under a different year keep their year; owner-chosen names may be under 3 characters (`VW`).
- `_FINISHED/<Customer>_finished` becomes `<short name>` (the `_finished` suffix always drops — `rules.json` `finished_bucket._note`).
- Executed rows (Desperate pilot) never change.
- The tool keeps `--dry-run`, the locked pre-batch snapshot, deepest-first order, one transaction per folder.
- Stored customer values stay the long canonical names (shared-db rule D8).

Open (implementer judges, criteria given):
- ShareSync idle check method (step 7): use whatever the NAS exposes read-only over SSH as the `ai` user (`synoshare`/Drive admin console API, or the ShareSync task status via `synowebapi`). Criterion: it must show "no pending items" for the `mac` share task; if no reliable read exists, the tool must ask for `--sharesync-checked "<who/when>"` and record it, never silently skip.
- Where to wire the tests into CI (step 2): extend the `ci.yml:80` `node --test` line, or add a root script `test:tools`. Criterion: runs on every PR, fails the job on failure, is advisory (not a new required check — owner ruling 2026-10-30).

## 9. The plan

**Step 1 — Confirm and coordinate.** Re-run §5 checks on current `main` (files may have moved). Post one comment on #963 (signed with `$AI_GH_SIGNATURE`): "Next production batch should wait for the rename-tool fixes in docs/plans/issue-1310-…; the tool would abort on the Concept Approved and top-folder batches." Check `HANDOFF.d/` for a newer Phase 5 handoff and whether a batch is running (`select batch_id, max(renamed_at) from dam.folder_rename_log group by 1 order by 2 desc limit 3;` read-only). `lead-only` (coordination). Gate: comment posted; no batch running.

**Step 2 — CI runs the tool tests.** Make every `tools/folder-rename/*.test.mjs` run in CI (decision in §8). Use the glob form `node --test tools/folder-rename/*.test.mjs` (the directory form failed on one Node version per the Phase 5 handoff). Add a check that `tools/folder-rename/rules.json` and `supabase/functions/_shared/folder-rules/rules.json` are byte-identical (`cmp`). `helper-ok`. Stop-and-ask: if this would make the check required, stop. Gate: a PR run shows the tests executing (count in the log).

**Step 3 — Skip already-renamed rows (R1).** In `planSteps`/`run`: after loading `logRows`, map each CSV row's `old_path` through earlier renames of its *parents only*; if a non-reverted log row has that exact `old_path`→`new_path`, mark the row done and drop it, logging "already renamed in batch <id>". If no steps remain, write "nothing to do" to the log and exit 0 without touching the snapshot, preconditions or SQL. Behaviour: `--match "…/In Development"` after all inner batches renames only the top folder. `lead-only` (production logic). Gate: tests "already-renamed rows are skipped", "empty batch exits cleanly without SQL".

**Step 4 — Quoting (R2, R3).** `snapshot()`: build `JSON.stringify({ desc: label, lock: true })` and pass it through `shq()`; also restrict `--batch-label` to `[A-Za-z0-9._-]{1,60}` (reject others). `rewriteSql`: drop `do $$`; emit plain statements inside the caller's `begin…commit`, and use `char_length(${q(from)})` instead of `from.length`. If chunking needs a loop, use a dollar tag that is random per run (`$fr_<8 hex>$`) and assert it is not in either path. `helper-ok`. Stop-and-ask: if removing `do $$` changes the chunking design, bring it back. Gate: tests "label with quote is rejected", "path containing $$ and emoji rewrites exactly".

**Step 5 — Checkouts, failures, clock (R4, R5).** Checkout check uses `c.status in ('active','checkin_queued','uploading','verifying')` — read the current status list from the vendored shared-db migration that defines `asset_checkouts_one_active_per_asset` and use exactly that set. Wrap the rename `ssh()` call in try/catch so the batch-id message is shown. Rollback: run `mv -n to from && [ -d from ] && [ ! -e to ] && echo ok`; if it fails, throw an error that names both the DB error and "folder left at <to>; run --revert <batch_id>". Use the database clock for both times: `renamed_at = now()` in the insert, then read it back with `returning renamed_at` for the log line. `lead-only` (failure handling decides production outcome). Gate: tests "rename failure names the batch id", "rollback failure keeps both errors".

**Step 6 — Safe revert (R6).** `revert()` runs the same preconditions as forward (scan off and idle, no live checkouts under the new paths, every `new_path` exists, every `old_path` absent). The move becomes `[ ! -e old ] && mv -n new old && [ ! -e new ] && [ -d old ] && echo ok`. DB failure → move back (`old`→`new`) with the same verified pattern as step 5. Write a run log even on failure. `lead-only`. Gate: tests "revert refuses when old path exists", "revert restores tree and paths exactly".

**Step 7 — Run log contents (R7, #1328 f4–6).** (a) ShareSync idle precondition (§8 open decision), recorded with its raw status. (b) Record `AUTO_SCAN_CONFIG` and `SCAN_PROGRESS` values before the batch, and print at the end: "Turn automatic scanning back on: …" when it was turned off. (c) Before and after the batch, record `select customer, program, count(*) from public.assets where is_deleted is not true and <under batch prefixes> group by 1,2 order by 1,2;` and flag any customer value that changed (customer must not change; program may change by rule — list both). (d) Write the run log in a `finally` so a stopped batch still leaves a file with the reason. `lead-only` (what counts as pass). Gate: rehearsal run log (step 14) shows all four.

**Step 8 — Tool tests (R8).** New `tools/folder-rename/execute.test.mjs` cases using a temp directory and a fake `ssh`/`psql` (inject them: refactor `run`/`revert` to take `{ ssh, psql, now }` from a context object; default to the real ones). Cases in §10. `helper-ok` once the injection seam exists (lead reviews the seam). Stop-and-ask: if the refactor would change any SQL text, stop. Gate: `node --test tools/folder-rename/*.test.mjs` green with the new cases.

*Context cut point.* Write a handoff if context is large; re-read steps 9–15.

**Step 9 — Brackets, ranges, dot (N1–N3).** In `core.mjs`: `standaloneYears` must not take a year that is one end of a range written with spaces (`2026 - 2027`, `2026 – 2027`, `2026 to 2027`); `tidy` must collapse spaces just inside brackets (`(Feb )` → `(Feb)`, `( x)` → `(x)`) and a space before a dot suffix (`x .merged` → `x.merged`). `helper-ok`. Stop-and-ask: any other CSV row that changes for a reason not in this step. Gate: tests in §10; step 13 diff.

**Step 10 — Punctuated customer names (N4).** In `stripTermsFor`/`stripTerms`, match customer names (and aliases) ignoring case and punctuation the same way `replaceCustomerNames` does (`:117-124`: letters/digits joined by `[^A-Za-z0-9]*`). `_FINISHED/Ollie's_finished` must become the same short name as the customer folder (`Ollies`). `lead-only` (changes many names). Gate: tests; step 13 diff lists every affected row.

**Step 11 — Short owner names with `_finished` (N5).** Replace both `!(p.applied.length === 1 && p.applied[0] === "customer_alias")` checks (`:297`, `:306`) with `!p.applied.includes("customer_alias")`. Result: `_FINISHED/Variety Wholesalers_finished` → `VW`. `helper-ok`. Stop-and-ask: none. Gate: test "VW_finished becomes VW".

**Step 12 — Planner tests (N6).** Add to `tools/folder-rename/plan.test.mjs` (they go through `planRenames`, not helpers): see §10. `helper-ok`. Stop-and-ask: if a test exposes a behaviour not described in §5, bring it to the lead. Gate: all pass.

**Step 13 — Regenerate the list.** Re-list folders from **edge2** read-only exactly as the 2026-11-13 run did (command in `verification/folder-shortening/summary.md`), run `plan.mjs`, and produce `verification/folder-shortening/old-to-new-diff-2026-MM-DD.md` listing every row that changed versus the frozen CSV with the reason (N1, N2, N4, N5, or "folder changed on disk since 2026-11-13"). Desperate pilot rows must be unchanged or marked "executed 2026-11-24; kept as executed". Replace `old-to-new.csv`, `needs-attention.csv`, `summary.md`. `lead-only` (judges every diff row). Gate: diff file has a reason for every changed row; no unexplained change.

**Step 14 — Land and rehearse.** Branch `claude/issue-1310-rename-tool-fixes`, PR to `main` ("Refs #1310 #985 #1007 #1012 #1328"), merge when required checks pass. Then re-run the rehearsal on preview exactly as parent plan 5.2 did (`--db preview --disk-root /volume1/mac/_folder_rename_rehearsal --no-snapshot`), including a two-stage batch (inner folder first, then its parent prefix) to prove step 3, and `--revert`. Commit the run logs. `lead-only`. Gate: rehearsal run logs show skipped rows, ShareSync/scan/customer lines, and a clean revert.

**Step 15 — Close out.** Update this STATUS table. Comment on #1310, #985, #1007, #1012 with what changed and the rehearsal log path, signed `$AI_GH_SIGNATURE`; close each once its findings are all fixed (live proof = the rehearsal + the next real batch's run log; if the next real batch has not run yet, leave a `- [ ] next production batch run log shows the new checks` checklist item on #1310 and close it then). Tell the Phase 5 session (comment on #963) the tool is ready. `lead-only`.

### Adversarial cases (folder names and CLI input are external input)

| Input | Hostile case | Test that proves it |
|---|---|---|
| `--batch-label` | `a'; rm -rf x; '` / `"` / `\` | `label with quote is rejected` |
| folder name | contains `$$` | `path containing $$ rewrites exactly` |
| folder name | emoji / non-BMP characters | `emoji path prefix length is exact` |
| folder name | `_` and `%` (LIKE wildcards) | `prefix replacement is literal for _ and %` |
| folder name | `(Feb 2026)` / `2026 - 2027` / `x 2026.merged` | `brackets tidy`, `spaced range kept`, `no space before dot` |
| customer folder | `Ollie's` vs `Ollies`, `POP Shelf` vs `Popshelf` | `punctuated customer stripped from children` |
| disk state | target already exists (forward and revert) | `precondition failure aborts untouched`, `revert refuses when old path exists` |
| DB state | already-renamed rows in the batch | `already-renamed rows are skipped` |
| DB failure | psql throws mid-batch | `db failure moves folder back`, `rollback failure keeps both errors` |
| checkout | status `uploading` on an asset in the batch | `in-flight check-in blocks the batch` |

## 10. Tests required

`tools/folder-rename/execute.test.mjs` (temp dir + fake ssh/psql): precondition failure aborts untouched; already-renamed rows are skipped; empty batch exits cleanly without SQL; deepest-first order; prefix replacement is literal for `_` and `%`; path containing `$$` rewrites exactly; emoji path prefix length is exact; label with quote is rejected; in-flight check-in blocks the batch; rename failure names the batch id; db failure moves folder back; rollback failure keeps both errors; revert refuses when old path exists; revert restores tree and paths exactly; run log is written when the batch stops; run log has ShareSync, scan state, customer/program before/after.

`tools/folder-rename/plan.test.mjs` (through `planRenames`): brackets tidy (`Group 27 (Feb 2026)` under `Hobby Lobby/2026` → `Group 27 (Feb)`); spaced range kept (`Wall 2026 - 2027`); no space before dot; punctuated customer stripped from children (`Ollie's/Ollies Fall Wall` → `Fall Wall`; `_FINISHED/Ollie's_finished` → `Ollies`); VW_finished becomes VW; `Variety Wholesalers` → `VW` with no attention row; rescue: `Dollar Tree/2027/Dollar Tree SS 2027` → `Dollar_Tree SS 2027` rule `customer_alias_in_name`, no attention row; `Concept Approved Designs` → `Concept_Approved`; idempotent on the full regenerated `old-to-new.csv` output (re-planning the new paths yields zero renames).

Must stay green: `node --test tools/folder-rename/*.test.mjs`, `npm test`, `npm run typecheck`.

## 11. Constraints and gotchas

- Never push to protected `main`; branch + PR; AI merges; reviews advisory.
- No DDL here. If `dam.folder_rename_log` needs a change, it goes to `popcre/shared-db` (load skill `shared-db-change`).
- No production NAS writes in this plan. Rehearsal only on the scratch tree and the preview database. Read the edge2 listing read-only.
- NAS reads longer than 25 s: load skill `synology-long-running-operations`.
- Credentials through `op run` only (`PGPASSWORD`, `DSM_PW` from 1Password `vibe_coding`); never in arguments, logs or commits.
- The Folder Names admin screen imports the same `core.mjs`; a rules change changes its suggestions too (intended).
- Git remote in some checkouts is `github`, in others `origin` — check `git remote -v`.
- Times to Albert in EST/EDT.

## 12. Access and environment

- `gh` as `u2giants`. SSH to edge1/edge2 as the `ai` account (see `docs/MCP_SERVERS.md` and the Phase 5 handoff for the exact host aliases).
- Database: production pooler user `postgres.qsllyeztdwjgirsysgai`, preview `postgres.mvpkijzfmfcxhnzqogzs` (hosts in `execute.mjs:20-23`); passwords in 1Password `vibe_coding` (Supabase database items; look up by title).
- Node 20+ locally; no `npm ci` needed for `tools/`.

## 13. Definition of done, risks, open questions

Done when: STATUS rows ✅ with evidence; PR merged; CI shows the tool tests running; regenerated list + diff committed; rehearsal logs committed; comments on all five issues; #985, #1007, #1012 closed; #1310 closed after the first real batch log shows the new checks (or a checklist item left on #1310 until then); #1328 findings 4–6 marked done in the issue-1328 plan.

Risks: the regenerated list differs from what Albert saw on 2026-11-13 in more rows than expected — then post the diff summary on #963 in plain words before the next batch (no approval needed for bug-fix differences, but he should know). A bad revert could nest folders — step 6 tests and the rehearsal cover it; the locked pre-batch snapshot is the last-resort rollback.

Open: ShareSync status read method (§8).

## Self-audit

1. *Fresh session without questions?* Yes — §2 explains every component, §5 has exact line refs and examples, §9 names files, behaviour and gates, §12 says where credentials are.
2. *All background and rejected options?* Yes — §6 why R1 matters and why the list must be regenerated; §7 five rejected approaches; §8 Albert's locked rulings with dates.
3. *Goal clear enough for judgment?* Yes — §1: Albert's names, nothing damaged, no aborts; the goal wins.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 issues #1310, #985, #1007, #1012 (and #1328 findings 4–6). Read AGENTS.md, then docs/plans/issue-1310-folder-rename-engine-and-executor.md (STATUS first), then STATUS and Phase 5 of plan_folder_shortening_snapshot_restore.md.
Do steps 1, 3, 5, 6, 7, 10, 13, 14, 15 yourself. Hand steps 2, 4, 8 (after you build the injection seam), 9, 11, 12 to your helper, one at a time, in plan order.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; no design decisions; no merges, pushes or GitHub posts; bring every stop-and-ask trigger back to you; if stuck 30 minutes, you take the step back.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run every test yourself, review each helper diff, judge every row of the regenerated-list diff, run the preview rehearsal, and update STATUS in the same PR. No production NAS writes.
```
