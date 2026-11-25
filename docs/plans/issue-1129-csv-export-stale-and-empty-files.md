---
summary: "Make each CSV export one complete run folder that never mixes old files or loses rows under live writes."
kind: plan
status: open
read-when: "fixing the CSV exporter (export-all-tables.ps1, export-table edge function) or review finding #1129"
---

# CSV export: one complete run folder, frozen rows, real tests (#1129)

Covers [u2giants/popdam3#1129](https://github.com/u2giants/popdam3/issues/1129) — advisory review of PR #1126 ("CSV exporter: fail loudly and keep the last good export", #1097).

Handoff registration: [HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-export-script-plans.md](../../HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-export-script-plans.md).
Sibling plan for the SQL exporter (shares helpers and the PowerShell test harness): [issue-1147-sql-dump-snapshot-restore-download.md](issue-1147-sql-dump-snapshot-restore-download.md).

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Plan written (2026-11-25) | ✅ done | this file |
| 1 | Per-run folder; complete marker only on full success | ⬜ open | — |
| 2 | Empty reference tables fail; empty tables recorded, not deleted | ⬜ open | — |
| 3 | `export-table`: keyset cursor + snapshot cutoff | ⬜ open | — |
| 4 | Status contract documented and pinned | ⬜ open | — |
| 5 | Page-collection loop extracted and unit-tested | ⬜ open | — |
| 6 | PowerShell behavioural tests | ⬜ open | — |
| 7 | Docs | ⬜ open | — |
| 8 | Live proof: one full CSV export | ⬜ open | — |

**A fresh session starts at step 1.** If the sibling SQL plan has landed, reuse its `snapshotCutoff`, `cutoffFilter`, cursor helpers and PowerShell harness instead of writing new ones.

## Part 1 — Why

### 1. The ultimate goal

PopDAM can export each of its tables to CSV files for offline use or migration. Whoever opens an export folder must be able to trust it: **either every table in it comes from the same run and is complete, or the folder is plainly marked unusable.** An earlier good export must never be damaged by a later failed one, and rows must not silently go missing or appear twice because the system was writing while the export ran.

**If a step below conflicts with this goal, the goal wins — stop and flag it on the issue.**

### 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager (repo `u2giants/popdam3`, protected `main`, PRs only). Backend: shared Supabase project `qsllyeztdwjgirsysgai`; edge functions deploy on merge via `deploy-supabase.yml`.

The CSV pipeline:
- **Edge function** `supabase/functions/export-table/index.ts` — `GET ?table=X&page=N&page_size=S&format=csv` returns one CSV page (header row on page 0) with `X-Total-Count` and `X-Rows-In-Page`; JSON `{rowsInPage:0,…}` when past the end; JSON `{error}` with HTTP 500 on failure. Auth: admin JWT or service-role key.
- **Script** `migration/export-all-tables.ps1` — loops over 22 tables, streams pages into `<table>.csv.tmp`, validates page sizes and totals, then swaps the file into `export/<table>.csv` (`File.Replace`). Failed tables are listed and the script exits 1.
- **Browser variant** `migration/export-from-browser.md` — a console snippet using the same function.

### 3. What triggered this work

The advisory reviewer filed five findings on PR #1126; `review-fixer` deferred them (not proof of anything fixed). Reviewer text was truncated after finding 5 in every stored copy. Status at `origin/main` `787c20b8` (2026-11-25):

| # | Finding | Status |
|---|---|---|
| 1 | `$content.ToString() \| Out-File` could alter cells / add BOM | **Fixed** — pages now stream through `StreamWriter(…, UTF8Encoding($false))` (`export-all-tables.ps1:123`) |
| 2 | A failed run leaves `export/` mixing this run's CSVs with older ones; nothing records which are fresh | **Open** — `:201-217`, messages at `:207` |
| 3 | A table that validates as empty deletes its previous full CSV (reference data lost) | **Open** — `:184-189` |
| 4 | Count failure changed from `200 {error}` to `500 {error}`; undocumented, untested | **Open (doc + test)** — `index.ts:72-77`; the browser snippet reads `json.error` (`export-from-browser.md:90`), so it still works |
| 5 | Short-chunk fix (`offset += chunk.length`, `index.ts:98`) only checked by grepping source | **Open** — `src/test/export-all-tables-integrity.test.ts:78` |
| re-audit | Offset paging over a live table: ordering is by random UUID, so an insert mid-run shifts later pages; one row can be exported twice and another skipped while the final count still matches — **silent corruption** | **Open** — `index.ts:70,81-99` (live count, `range(offset…)`) |

### 4. Scope

In: `migration/export-all-tables.ps1`, `supabase/functions/export-table/index.ts`, shared helpers in `supabase/functions/_shared/export-pagination.ts` / `export-tables.ts`, `migration/export-from-browser.md`, tests under `src/test/`.

**NOT in this plan:** the SQL dump (sibling plan); import tooling for the CSVs; adding/removing exported tables; changing who may call the function; point-in-time consistency of row *contents* (updates after a page was fetched are not captured — documented).

## Part 2 — What we already know

### 5. Current state (origin/main `787c20b8`, deployed)

- Script: config + page-size ladder `:28-40`; table list `:45-68`; `Publish-File` `:89-97`; resource-limit step-down `:99-110`, `:136-145`; `Export-Table` `:112-199` (tmp file, page loop `:128-176`, empty handling `:184-189`, publish `:191-193`); run loop and exit `:201-217`; import instructions `:219-231`.
- Function: table allow-list `:13-36`; params `:52-59`; live count `:70-77`; page loop with short-chunk fix `:85-99`; CSV escaping `:115-134`; headers `:138-147`.
- Tests: `src/test/export-all-tables-integrity.test.ts` — all source-text greps; `src/test/export-pagination.test.ts` — `exportRange` unit tests.
- The SQL exporter already solved the same problems with a fresh per-run folder (`download-sql-dump.ps1:36-48`), snapshot cutoff and keyset cursor (`export-pagination.ts:97-160`).

### 6. Key findings and root cause

- Finding 2/3 share one root cause: the script publishes **into a long-lived shared folder** table by table, so the folder's meaning depends on history. A fresh folder per run removes both: nothing old is ever in it, nothing old is ever deleted.
- The re-audit finding: `orderedTableSource` orders by `id` (random UUID). With `range(offset, …)`, a row inserted with an id below the current offset pushes every later row one position down — the next page repeats one row; a deletion skips one. The script's check (`totalRows == totalCount`, `:182`) compares against the *latest* live count, so +1 insert / one duplicate still balances.
- An empty result can legitimately be a real empty table (queues) — it cannot be treated as an error everywhere, only for tables that must never be empty.

### 7. Approaches considered and REJECTED

- **Rename stale files `*.stale` before the run** (reviewer's fallback) — rejected: still a shared folder whose state depends on history; per-run folders are simpler and already proven in the SQL downloader.
- **Keep `File.Replace` per table** — superseded; with per-run folders there is nothing to replace. Remove `Publish-File`.
- **Revert the 500 status to 200 `{error}`** — rejected: a failed count must look like a failure (#1097); only document and test it.
- **Keep offset paging and re-check the count each page** — rejected: cannot detect a balanced insert+duplicate.
- **Pester** — not in CI; use vitest spawning `pwsh` (same as the sibling plan).

### 8. Design decisions

Locked (2026-11-25):
1. Each run writes to `export/<yyyyMMdd-HHmmss>/`. On full success it writes `export-complete.json` (`{ cutoff, generated, tables: [{table, rows, file|null}] }`). On any failure the folder is renamed `<stamp>-INCOMPLETE` and the script exits 1. Earlier folders are never touched.
2. An empty table is recorded in `export-complete.json` with `rows: 0, file: null` — no file is deleted anywhere.
3. Tables that must never be empty (`licensors`, `properties`, `characters`, `product_categories`, `product_types`, `product_subtypes`) fail the run when they return 0 rows.
4. `export-table` uses the same keyset cursor and snapshot cutoff as the SQL exporter: request params `cutoff` and `after`; response headers `X-Next-Cursor`, `X-Cutoff`. Page 0 without `cutoff` gets one computed by the server (15-minute margin, see sibling plan §8) and returned in `X-Cutoff`; the script passes it verbatim on every later request.
5. `page` remains for labelling and for page-0 header detection only.
6. Errors keep HTTP 500 + `{ "error": "…" }`; this is now the documented contract.

Open (criteria given):
- Whether to keep backward compatibility for callers that send `page` without `after` (the browser snippet). Criterion: if `export-from-browser.md` can be updated in the same PR to follow `X-Next-Cursor`, drop offset paging entirely; otherwise keep offset paging only when `after` is absent **and** log a warning header `X-Paging: offset-unsafe-under-writes`.

## Part 3 — How to build it

### 9. Steps

**Step 1 — Per-run folder (helper-ok).**
In `export-all-tables.ps1`: after `$OutputDir`, create `$RunDir = Join-Path $OutputDir (Get-Date -Format "yyyyMMdd-HHmmss")`, refuse if it exists; write every `<table>.csv` (via `.tmp` then `Move`) into `$RunDir`. Delete `Publish-File` and the empty-file deletion at `:184-189`. Add `Fail-Run` like `download-sql-dump.ps1:42-48` (rename to `-INCOMPLETE`, exit 1). Keep collecting all failed tables first (current behaviour `:201-210`), then call `Fail-Run` with the list. Write `export-complete.json` only after all tables pass; print import steps referencing `$RunDir` only then. Update the header comment `:15-22`.
*Gate:* pwsh tests "successful run writes export-complete.json" and "failed table renames folder INCOMPLETE and leaves an earlier run folder byte-identical".
*Stop-and-ask:* any reason to keep writing into the flat `export/` folder.

**Step 2 — Empty tables (helper-ok).**
Add `$MustHaveRows = @("licensors","properties","characters","product_categories","product_types","product_subtypes")`. In `Export-Table`, after validation: if 0 rows and the table is in the list → throw "`<table>` returned no rows; reference tables are never empty"; otherwise return `@{table; rows=0; file=$null}`. Return `@{table; rows; file}` for normal tables so the run loop can build the JSON.
*Gate:* pwsh tests "empty reference table fails the run" and "empty queue table is recorded with rows 0".

**Step 3 — Keyset + cutoff in `export-table` (lead-only: decides completeness).**
Reuse `snapshotColumn`, `cutoffFilter`/`parseCutoff`, `encodeCursor`/`decodeCursor`/`afterCursorFilter` and `snapshotCutoff` from `_shared/export-pagination.ts` (create the ones the sibling plan has not landed yet, exactly as specified there §9 steps 2–3, so both plans converge on one helper set). In `index.ts`: compute or parse `cutoff`; apply it to the count (`:70`) and to every fetch; replace `range(offset…)` with `.or(afterCursorFilter(...)).limit(n)` keyset paging; return `X-Next-Cursor` and `X-Cutoff`. Volatile tables (`deletesDuringExport`) may return fewer total rows than counted; the script must accept `totalRows <= totalCount` for them and treat a short page as their end (mirror `download-sql-dump.ps1:130-148`). Update the script to send `cutoff` and `after` and to read the server's cutoff from page 0 verbatim (regex on the header string, never through `[DateTime]`).
*Gate:* unit test "CSV export frozen under inserts" (simulation like `export-sql-dump-integrity.test.ts` "every frozen row exported exactly once…", driven through the extracted loop from step 5); pwsh test "script pins the server cutoff and follows the cursor".

**Step 4 — Status contract (helper-ok).**
Header comment in `export-table/index.ts` lists: 200 CSV page; 200 JSON end-of-data; 400 bad params/table; 401 unauthorised; 500 `{error}` for count/fetch failures. Mirror in `migration/export-from-browser.md` and make its snippet check `res.ok` before parsing.
*Gate:* test "export-table failure answers 500 with an error body" (call the handler with a fake client whose count returns an error, if step 5 makes the handler importable; otherwise unit-test the extracted response builder).
*Stop-and-ask:* if any monitoring/canary is found to alert on this function's 500s (`grep -rn "export-table" .github scripts`).

**Step 5 — Extract and test the page loop (lead-only: test design).**
Move the fetch loop (`index.ts:85-99`, keyset version from step 3) into `_shared/export-pagination.ts` as `async function collectRows(fetchPage: (after: string[] | null, limit: number) => Promise<{data, error}>, …)`. Unit tests with a fake `fetchPage` that returns short pages, empty pages, and an error.
*Gate:* new tests "a short PostgREST page does not end the page early", "an error stops collection", in `src/test/export-pagination.test.ts`.

**Step 6 — PowerShell behavioural tests (lead-only design, helper-ok typing).**
Add env overrides `POPDAM_EXPORT_URL` (for `$SupabaseUrl`) and `POPDAM_EXPORT_OUT` (for `$OutputDir`). New `src/test/export-all-tables.pwsh.test.ts` using the shared Node mock-server harness (`src/test/helpers/pwsh-export-harness.ts`, created by whichever plan lands first). Skip without `pwsh` locally; fail without it when `CI` is set. Replace the source-grep tests in `export-all-tables-integrity.test.ts` that the behavioural ones now cover; keep the table-list tests (`:16-25`).
*Gate:* `npx vitest run src/test/export-all-tables.pwsh.test.ts` green locally and in CI.

**Step 7 — Docs (helper-ok).**
Update every doc that describes the CSV export (`grep -rln "export-all-tables\|export-table" docs README.md SELFHOST.md migration`): per-run folder, `export-complete.json`, cutoff margin, status contract.
*Gate:* no doc still says files are replaced in `export/`.

**Step 8 — Live proof (lead-only).**
After merge and a green `deploy-supabase.yml` for the merge SHA, run the script with the service-role key from 1Password (§12) during normal operation. Record on #1129: run folder name, `export-complete.json` totals, and for three tables a comparison of CSV line count − 1 against a read-only `select count(*) … where created_at <= '<cutoff>'`. Then make one table fail deliberately (e.g. set `POPDAM_EXPORT_URL` to a bad host for a rerun) and record that the new folder is `-INCOMPLETE` and the first is unchanged (hash of its JSON before/after).
*Gate:* counts match; earlier folder hash unchanged.

### Adversarial cases (trust boundary: server responses into the script, query params into the function)

| Input | Hostile case | Test |
|---|---|---|
| CSV page | fewer rows than header says | pwsh "short page fails the table" |
| CSV page | HTTP 500 `{error}` mid-table | pwsh "failed table renames folder INCOMPLETE…" |
| JSON end page | `totalCount` 0 for a reference table | pwsh "empty reference table fails the run" |
| `X-Cutoff` | value with milliseconds | pwsh "script pins the server cutoff…" |
| `cutoff` param | future or garbage | unit "chunk refuses a future cutoff" (shared helper) + existing `parseCutoff` test |
| `after` cursor | malformed / quotes | existing cursor tests in `export-sql-dump-integrity.test.ts` |
| live table | inserts during export | unit "CSV export frozen under inserts" |
| earlier export | any failure in a later run | pwsh "…leaves an earlier run folder byte-identical" |

### 10. Tests required

New: `src/test/export-all-tables.pwsh.test.ts` (cases above: success writes JSON; failure renames INCOMPLETE and leaves earlier folder identical; short page fails; empty reference table fails; empty queue table recorded; cutoff pinned and cursor followed). In `src/test/export-pagination.test.ts`: "a short PostgREST page does not end the page early", "an error stops collection", "CSV export frozen under inserts". In `export-all-tables-integrity.test.ts`: "export-table failure answers 500 with an error body"; remove greps superseded by behaviour.
Must stay green: `npm run test` (root vitest), and the edge-function type check job in `.github/workflows/ci.yml`.

### 11. Constraints and gotchas

- Feature branch + PR; AI merges after required checks; reviews advisory.
- No database changes needed (all export tables already have insert-time columns except `asset_characters` — that column comes from the sibling plan's shared-db step; until it lands, `asset_characters` stays unfrozen here too and the CSV run will fail loudly under heavy tagging. Do not invent another freeze.)
- Never commit or print the service-role key; the script reads `POPDAM_EXPORT_KEY` from the environment.
- `$ErrorActionPreference = "Stop"` is already set (`:25`); keep it.
- `File.Move` across volumes fails; `.tmp` and final file share `$RunDir`.
- The page-size ladder (`:39`) assumed offsets; with keyset paging page size can change freely — keep the ladder for the step-down but drop the "divides the one before" requirement and its test (`export-all-tables-integrity.test.ts:95`).

### 12. Access and environment

- `gh` as `u2giants` for `u2giants/popdam3`.
- Service-role key: 1Password vault `vibe_coding` (search "popdam supabase service role"); pass via `op run` / `POPDAM_EXPORT_KEY`, never paste.
- Read-only production counts: Supabase MCP or `psql` with the read-only connection described in `docs/MCP_SERVERS.md`.
- Local: `npm ci && npx vitest run src/test/export-pagination.test.ts src/test/export-all-tables-integrity.test.ts src/test/export-all-tables.pwsh.test.ts`; `pwsh` at `C:\Program Files\PowerShell\7\pwsh.exe`.

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when: PR merged with the tests above green in CI; `deploy-supabase.yml` green for the merge SHA; step 8 proof recorded on #1129; STATUS updated with artifacts; #1129 closed linking the proof; handoff file closed.

Risks/rollback: changing the function's paging breaks the browser snippet if it is not updated in the same PR (decision Open 1). Rollback = revert the PR; the function redeploys; old flat `export/` files are never touched by either version.

Open: decision Open 1; the reviewer text truncated after finding 5 (the lead re-reads PR #1126's diff once during step 8 and records "none further" or adds a row here).

### Self-audit (2026-11-25)

1. *Executable without questions?* Yes — goal §1, pipeline and terms §2, per-finding status with lines §3, locked decisions §8, files/gates/roles per step §9, access §12.
2. *All background, including rejections?* Yes — §3 records finding 1 as already fixed; §7 lists five rejected approaches; §6 explains the silent-duplicate mechanism found in re-audit.
3. *Goal clear enough for judgment?* Yes — §1 defines a trustworthy folder; §8 gives the criterion for the one open choice.
Gap found and fixed: dependency on the sibling plan's `asset_characters` column (now in §11).

### Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1129-csv-export-stale-and-empty-files.md in u2giants/popdam3 (issue #1129). Read AGENTS.md, then the plan's STATUS and all 13 sections; check whether docs/plans/issue-1147-sql-dump-snapshot-restore-download.md has landed its shared helpers and PowerShell harness, and reuse them.
You do yourself: steps 3, 5, 6 (test design), 8, and every verification gate.
Hand to your helper, in order: steps 1, 2, 4, 7, then the typing of the step-6 test cases you designed.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; no design decisions; no merges, pushes or GitHub posts; bring back any stop-and-ask trigger; if stuck 30 minutes, you take the step back.
You run yourself: the named vitest files, npm run test, PR CI, the deploy run for the merge SHA, and the step-8 live export. Update STATUS with artifacts, comment proof on #1129, close it.
```
