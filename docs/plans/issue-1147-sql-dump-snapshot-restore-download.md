---
summary: "Make the SQL backup export a true frozen snapshot, restore without touching shared master data, and download safely on any PowerShell."
kind: plan
status: open
read-when: "fixing the SQL export (export-sql-dump, download-sql-dump.ps1) or review findings #1147, #1149, #1150"
---

# SQL export: frozen snapshot, safe restore, safe download (#1147, #1149, #1150)

Covers three open review-finding issues, all on the same SQL export pipeline:

- [u2giants/popdam3#1147](https://github.com/u2giants/popdam3/issues/1147) — review of PR #1137 (snapshot cutoff + keyset cursor)
- [u2giants/popdam3#1149](https://github.com/u2giants/popdam3/issues/1149) — review of PR #1142 (restore without TRUNCATE CASCADE)
- [u2giants/popdam3#1150](https://github.com/u2giants/popdam3/issues/1150) — review of PR #1144 (SHA-256 per chunk, retry)

Handoff registration: [HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-export-script-plans.md](../../HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-export-script-plans.md).
Sibling plan for the CSV exporter: [issue-1129-csv-export-stale-and-empty-files.md](issue-1129-csv-export-stale-and-empty-files.md).

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Plan written (2026-11-25) | ✅ done | this file |
| 1 | Shared-db: `asset_characters.created_at` column | ⬜ open | — |
| 2 | Cutoff safety margin (clock skew / in-flight transactions) | ⬜ open | — |
| 3 | Freeze every table, including nullable columns | ⬜ open | — |
| 4 | `asset_characters` may shrink; frozen by `created_at` | ⬜ open | — |
| 5 | Shared master data is verified, never written | ⬜ open | — |
| 6 | Replace-wipe refuses a non-empty target unless opted in | ⬜ open | — |
| 7 | Downloader: PowerShell 7 required, every error fails the run | ⬜ open | — |
| 8 | Downloader: no sleep after the last attempt | ⬜ open | — |
| 9 | Comments and docs match behaviour | ⬜ open | — |
| 10 | Behavioural tests (PowerShell against a mock server) | ⬜ open | — |
| 11 | Live proof: one full export + rehearsal restore | ⬜ open | — |

**A fresh session starts at step 1** (it is independent of the code steps; steps 2–10 can be built while the shared-db PR is in review, but step 4 is merged only after step 1 is live).

## Part 1 — Why

### 1. The ultimate goal

PopDAM must be able to produce a backup of its own data that is **complete, consistent and restorable**, while the system keeps running. "Complete" means every row that existed at the backup moment is in it exactly once. "Restorable" means an operator can load it into a rehearsal or replacement database without it failing half-way and without it overwriting the company's shared master lists (licensors, properties, characters), which belong to the shared database team, not to PopDAM.

Today the backup can silently skip rows, can never finish while AI tagging runs, fails on the very first table when restored, and breaks on the default Windows PowerShell.

**If a step below conflicts with this goal, the goal wins — stop and flag it on the issue.**

### 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed product artwork. Repo `u2giants/popdam3`, default branch `main` (protected; feature branch + PR). Backend: one shared Supabase Postgres project `qsllyeztdwjgirsysgai` (shared with other company apps; its schema is owned by the separate repo `popcre/shared-db`). Edge functions in `supabase/functions/` deploy automatically on merge via `deploy-supabase.yml`.

The SQL export pipeline has two parts:

- **Edge function** `supabase/functions/export-sql-dump/index.ts` — `GET ?action=manifest` returns row counts per table and a snapshot `cutoff` timestamp; `GET ?table=X&offset=N&chunk_size=S&cutoff=C[&after=K][&truncate=true]` returns one SQL file (a transaction of INSERTs) for the next S rows after keyset cursor K. Helpers live in `supabase/functions/_shared/export-pagination.ts` and `supabase/functions/_shared/export-tables.ts`.
- **Downloader** `migration/download-sql-dump.ps1` — a PowerShell script an operator (in practice the AI) runs. It fetches the manifest, downloads every chunk into a fresh `dump/<timestamp>/` folder, verifies row counts, SHA-256 and `COMMIT;` trailer, and only writes `restore-order.txt` when everything validated. Restore is `psql -v ON_ERROR_STOP=1 -f` per listed file.

Terms: **keyset cursor** = "rows with id greater than the last one I got" paging, stable under inserts. **cutoff** = the instant the manifest counted; chunks only include rows inserted at or before it. **volatile** table = one whose rows may be deleted mid-export (queues); its chunks may come back short, never long. **core.\*** = shared master-data tables (`core.licensor`, `core.property`, `core.character`) owned by `popcre/shared-db`.

### 3. What triggered this work

The advisory AI reviewer filed review findings on three merged PRs (#1137, #1142, #1144). The `review-fixer` bot deferred all three ("source moved" / "analysis only"); those labels are **not** proof of anything fixed. The reviewer's text was cut off ("[findings truncated]") in every stored copy (issue body, PR comment, run log); the findings below combine the visible text with this planning session's own re-audit of `origin/main` at `787c20b8` (2026-11-25).

Open findings that this plan resolves:

| Issue | Finding | Still true at `787c20b8`? |
|---|---|---|
| #1147-1 | `asset_characters` (and `licensors`/`properties`) are not frozen at the cutoff; under live tagging the export aborts or has an undefined boundary | **Yes** — `export-pagination.ts:97-102` returns `null` for all three |
| #1147-2 | Cutoff comes from the edge function's clock (`index.ts:114`), rows' `created_at` from the DB clock; also a transaction that started before the cutoff but commits after the count has `created_at` < cutoff and is missed by the count | **Yes** |
| #1147-5 (named in visible text: "all NOT NULL except one") | `style_groups.created_at` is nullable (`shared-db/supabase/ci-bootstrap/010_pre_adoption_baseline.sql`, `style_groups` block). `created_at <= cutoff` excludes NULL rows from both the count and the chunks, so they are **silently never exported** | **Yes** |
| #1147 rest | Truncated; unknown | Step 11 re-audit covers the remaining risk |
| #1149-1 | `DELETE FROM public.characters` cascades into shared tables | **Fixed** by #1301/#1311: `characters` now reads and targets `core.character`, and `clearTableSQL` returns `null` for `core.*` (`export-pagination.ts:78-80`) |
| #1149-2 | Upserts into `core.licensor` / `core.property` are refused by shared-db guards (`licensor_00_mg05_only_guard`, `licensor_/property_licensing_write_guard`, `ENABLE ALWAYS` so the replica role does not skip them) → restore stops on table 1 | **Yes** — `insertRowSQL` emits `INSERT … ON CONFLICT DO UPDATE` for `core.*` (`export-pagination.ts:65-68`) |
| #1149-3 | Truncated ("the DELETE is skipped for core.\*, but the comment …") — comment/doc accuracy | **Yes** — downloader still says "include TRUNCATE" (`download-sql-dump.ps1:24`); function header still says "migration from Lovable Cloud" |
| (re-audit) | `DELETE FROM public.<table>` in chunk 0 wipes a populated target with no confirmation | **Yes** — a wrong `$PGCONN` would wipe production PopDAM tables |
| #1150-1 | `[Convert]::ToHexString` / `SHA256]::HashData` need PowerShell 7; on Windows PowerShell 5.1 they throw outside the try/catch | **Yes** — `download-sql-dump.ps1:126` |
| (re-audit) | No `$ErrorActionPreference = "Stop"`; on 5.1 `Out-File -Encoding UTF8` (`:141`) writes a byte-order mark that psql rejects in front of the first statement | **Yes** |
| #1150-2 | `Start-Sleep` runs after the final attempt (~20 s dead wait) | **Yes** — `download-sql-dump.ps1:138` |

Reproduce: read the cited lines; for #1147-1 run the existing unit test `src/test/export-sql-dump-integrity.test.ts` "freezes ingestion tables" — it asserts `snapshotColumn("asset_characters")` is `null`.

### 4. Scope

In: the three files above plus `src/test/export-sql-dump-integrity.test.ts`, a new PowerShell behavioural test, the docs that describe this pipeline, and one small shared-db migration (step 1).

**NOT in this plan:**
- The CSV exporter (`migration/export-all-tables.ps1`, `supabase/functions/export-table/index.ts`) — see the sibling plan for #1129.
- Making rows' *contents* point-in-time consistent (an update after a row's chunk was fetched is not captured). PostgREST cannot hold one snapshot across requests; documented as a limitation in step 9.
- Restoring shared master data. Loading `core.*` belongs to `popcre/shared-db` (owner rule: curated Master Data loads start there).
- Any change to the guard triggers themselves.
- Adding new tables to the export list.

## Part 2 — What we already know

### 5. Current state of the code (origin/main `787c20b8`, deployed)

- `export-pagination.ts`: `exportOrderColumns` (`:7-9`), `deletesDuringExport` = the three queues (`:25-27`), `manifestEntry` (`:34-46`), `insertRowSQL` with core upsert (`:60-69`), `clearTableSQL` (`:78-80`), `clampChunkSize` (`:86-89`), `snapshotColumn` (`:97-112`), cursor encode/decode (`:115-132`), `afterCursorFilter` (`:143-152`), `parseCutoff` (`:155-160`).
- `export-sql-dump/index.ts`: table list `:48-70`; `sqlTarget` `:75-80`; manifest `:107-136` with `cutoff = new Date().toISOString()` at `:114`; chunk fetch loop `:169-187` (applies `.lte(col, cutoff)` and `.or(afterCursorFilter)`); SQL build `:191-215`; SHA-256 + headers `:220-236`.
- `download-sql-dump.ps1`: config `:20-27`; `Fail-Run` `:42-48`; manifest checks `:59-70`; chunk loop with retry `:94-152`; hash at `:126`; sleep at `:138`; `Out-File` at `:141`; volatile short-chunk end `:144-148`; restore list `:157-158`.
- Tests: `src/test/export-sql-dump-integrity.test.ts` (unit tests of the helpers plus source-text greps of the PowerShell). No test executes the PowerShell.
- History: #1113, #1122, #1137, #1142, #1144, #1151 (queue shrink), #1301/#1311 (characters → `core.character`). All merged and deployed.

### 6. Key findings and root cause

- **Why `asset_characters` cannot be frozen today:** it has only `(asset_id, character_id)` — no timestamp (`010_pre_adoption_baseline.sql`, `CREATE TABLE … public.asset_characters`). Tagging inserts and deletes links continuously. With no freeze column the count is "live": new links sorted after the cursor make the last chunk overflow (run aborts); new links before the cursor are missed. Under continuous tagging the export may never finish.
- **Why the cutoff is unsafe:** `created_at DEFAULT now()` is the *transaction start* time on the DB clock. A worker transaction that began at T−30 s and commits at T+5 s has `created_at` < cutoff but was invisible to the count at T → the final chunk returns one more row than counted → spurious abort (or, if `rows % chunk == 0`, an extra row never fetched). Edge vs DB clock skew adds the same effect. A cutoff **in the past** by a margin larger than any write transaction removes both.
- **Why NULL `created_at` loses rows:** PostgREST `created_at=lte.X` is SQL `created_at <= X`, which is NULL (excluded) for NULL rows — in the count and in every chunk alike, so the counts match and nothing fails. Silent loss.
- **Why core upserts cannot work:** shared-db guards on `core.licensor`/`core.property` refuse any write unless the writer sets `app.core_licensor_writer='mg05_feed'` or holds a transaction-bound `plm.licensing_write_authorization` row; they are `ENABLE ALWAYS` triggers, so `session_replication_role='replica'` does not bypass them. Bypassing them from a PopDAM restore script is exactly what the shared-db ownership rules forbid.
- `core.licensor`, `core.property`, `core.character` all have `created_at timestamptz not null default now()` (shared-db migrations), so they *can* be frozen.

### 7. Approaches considered and REJECTED

- **Set `app.core_licensor_writer='mg05_feed'` in the restore SQL to pass the guard** — rejected: impersonates the MG05 feed, bypasses a shared-db control PopDAM does not own.
- **Keep restoring core.\* but with TRUNCATE/DELETE** — rejected in #1134: cascades into other applications' append-only tables.
- **Freeze `asset_characters` through its asset's `created_at`** — rejected: tagging adds links to old assets, so the asset's age says nothing about the link's age.
- **Tolerate growth for `asset_characters` (skip exact count check)** — rejected: removes the completeness guarantee that is the whole point (#1084).
- **New shared-db RPC returning the DB clock for the cutoff** — rejected as more moving parts than a margin: Supabase hosts are NTP-synced (sub-second skew); a fixed margin covers skew *and* in-flight transactions, which a DB-clock RPC alone would not.
- **PowerShell 5.1-compatible hashing (`SHA256Managed` + `BitConverter`)** — rejected in favour of `#Requires -Version 7.0`: 5.1 also writes a BOM with `Out-File -Encoding UTF8` and decodes responses differently; supporting both doubles the test surface for a script only the AI runs. PowerShell 7 is installed on the Windows workstations (`C:\Program Files\PowerShell\7`) and on GitHub `ubuntu-latest` runners.
- **Pester tests** — rejected: not installed in CI; a vitest test that spawns `pwsh` against a local Node HTTP server uses tools the repo already has.
- **One PostgREST snapshot across chunks (`pg_export_snapshot`)** — impossible through PostgREST's stateless requests.

### 8. Design decisions

Locked (2026-11-25, this plan):

1. Cutoff = edge `now()` **minus 15 minutes**, constant `CUTOFF_MARGIN_MS` in `export-pagination.ts`. Rows inserted in the last 15 minutes are "after the backup". 15 min ≤ the 30-minute hold rule, and longer than any edge request (150 s limit) or worker statement.
2. Every exported table is frozen by an insert-time column; `snapshotColumn` never returns `null`. Nullable columns are matched as `col IS NULL OR col <= cutoff` (rows that predate the column are part of the snapshot).
3. `asset_characters` gets `created_at timestamptz not null default now()` through `popcre/shared-db`, and is marked volatile (retagging deletes links).
4. `core.*` targets are **verify-only** in the restore: their chunk emits a check that every exported `id` exists in the target and raises an exception naming the missing count otherwise. No INSERT/UPDATE/DELETE on `core.*`.
5. The replace-wipe (`DELETE FROM public.<t>`) runs only when the target table is empty **or** the session sets `popdam.restore_replace = 'on'` (via `PGOPTIONS`). Otherwise it raises.
6. The downloader requires PowerShell 7 (`#Requires -Version 7.0`) and sets `$ErrorActionPreference = "Stop"` with a `trap` that calls `Fail-Run`.

Open (implementer's judgment, with criteria):

- Exact PostgREST syntax for combining the nullable-cutoff `or` with the cursor `or`: use one `.or()` containing `and(or(...),or(...))`, or `.or()` + `.filter()`; pick whichever the step-3 test against a real PostgREST (preview branch or local `supabase start`) proves returns the right rows.
- Whether the verify-only core chunk carries ids inline (JSON array) or as `VALUES`; pick the one that keeps a 10,000-row chunk under ~1 MB.

## Part 3 — How to build it

### 9. Steps

**Phase A — shared database (independent)**

**Step 1 — `asset_characters.created_at` (lead-only: shared-db structural change).**
Load the `shared-db-change` skill. In `popcre/shared-db`, claim the object on an existing or new issue, add a timestamped migration: `alter table public.asset_characters add column if not exists created_at timestamptz not null default now();` (a non-volatile default; Postgres 11+ adds it without a table rewrite). Preview-first, the repo's normal promotion workflow to production; no manual production command. After merge, the vendored mirror in this repo syncs automatically (`chore: sync shared-db` commits).
*You'll know it worked when* `shared-db/supabase/migrations/` in `popdam3` contains the migration after a sync and a read-only `select count(*) from public.asset_characters where created_at is null` on production returns 0.

**Phase B — edge function and helpers (one PR in `popdam3`)**

**Step 2 — Cutoff margin (lead-only: decides what a backup contains).**
In `export-pagination.ts` add `export const CUTOFF_MARGIN_MS = 15 * 60 * 1000;` and `export function snapshotCutoff(nowMs: number): string` returning `new Date(nowMs - CUTOFF_MARGIN_MS).toISOString()`. Use it at `export-sql-dump/index.ts:114`. Keep `parseCutoff` unchanged. Also add a guard in `parseCutoff`'s caller: reject a chunk request whose cutoff is later than `Date.now()` (400) — a cutoff in the future reintroduces the race.
*Gate:* unit test "cutoff lies 15 minutes before the manifest time" and "chunk refuses a future cutoff" pass.

**Step 3 — Freeze every table incl. nullable columns (lead-only).**
`snapshotColumn`: remove the `null` cases; `licensors`/`properties`/`asset_characters` → `created_at`. Change the return type to `string`. Add `export function snapshotNullable(table: string): boolean` returning `true` for `style_groups` (and any other table whose column the implementer confirms nullable in `shared-db/supabase/ci-bootstrap/010_pre_adoption_baseline.sql` + later migrations — re-check `assets` and `tiff_optimization_queue` `created_at` explicitly; the reviewer called them NOT NULL). Add `export function cutoffFilter(table, cutoff): string` producing the PostgREST filter, and apply it in both the manifest count (`index.ts:119-120`) and the chunk loop (`index.ts:172-174`), combined with the cursor filter per decision "Open 1".
*Gate:* against a preview/local PostgREST with a fixture `style_groups` row whose `created_at` is NULL, the manifest count includes it and exactly one chunk contains it. Unit test "nullable snapshot column keeps rows with no timestamp".

**Step 4 — `asset_characters` frozen and volatile (helper-ok after step 1 is live).**
`deletesDuringExport` adds `asset_characters`. Update the comment at `export-pagination.ts:19-24`. Merge only after step 1's column is on production (otherwise every manifest returns 500 — loud, but the export stops working).
*Gate:* updated unit test "freezes ingestion tables" asserts `snapshotColumn("asset_characters") === "created_at"` and `deletesDuringExport("asset_characters") === true`.
*Stop-and-ask:* step 1 not yet on production → stop, report.

**Step 5 — Core tables verify-only (lead-only: restore semantics on shared data).**
Add `export function verifyCoreRowsSQL(target: string, ids: string[]): string` producing one `DO $$ … $$;` block: `select count(*) from jsonb_array_elements_text('<ids json>'::jsonb) e(id) where not exists (select 1 from <target> t where t.id::text = e.id)`; if > 0, `raise exception 'restore target lacks % % rows exported from PopDAM; load shared master data through popcre/shared-db first', n, '<target>'`. In `index.ts:206-210`, when `sqlTarget(table)` starts with `core.`, emit that block instead of INSERTs. Remove the `core.` upsert branch from `insertRowSQL` (`:65-68`) so no code path can write `core.*`. Ids must be escaped like the existing JSON (`'` → `''`).
*Gate:* unit tests "core chunk contains no INSERT/UPDATE/DELETE" and "verify block escapes quotes"; in step 11's rehearsal restore the core chunks pass against a target that holds the master data and fail with the message against an empty one.

**Step 6 — Guarded replace-wipe (lead-only: destructive SQL).**
`clearTableSQL(target)` for non-core returns a `DO $$ begin if exists (select 1 from <target> limit 1) and coalesce(current_setting('popdam.restore_replace', true), '') <> 'on' then raise exception 'refusing to replace non-empty %; set PGOPTIONS=-c popdam.restore_replace=on to confirm', '<target>'; end if; end $$;` followed by `DELETE FROM <target>;`. Update the restore instructions printed by the downloader (`:164-173`) to show the `PGOPTIONS` line as an explicit opt-in.
*Gate:* unit test "replace-wipe is guarded"; rehearsal restore into a populated table without the option stops with that message.

**Phase C — downloader (same PR)**

**Step 7 — PowerShell 7 and fail-closed errors (helper-ok).**
Line 1 of `migration/download-sql-dump.ps1`: `#Requires -Version 7.0`. After config: `$ErrorActionPreference = "Stop"` and `trap { Fail-Run "unexpected error: $_" }` placed after `Fail-Run` is defined but before the manifest request (and the run folder is created before the trap can fire — keep `New-Item` before it). Replace `Out-File` at `:141` with `[System.IO.File]::WriteAllText($filePath, $resp.Content, [System.Text.UTF8Encoding]::new($false))`. Hash line `:126` may stay (valid on 7).
*Gate:* behavioural test (step 10) "a hashing exception renames the run folder INCOMPLETE"; `pwsh -File` on 5.1 (`powershell.exe -File`) prints the #Requires refusal and creates no `dump/` folder.
*Stop-and-ask:* if `trap` interferes with the intentional retry `try/catch` at `:118-122` (it should not; caught errors do not reach a trap).

**Step 8 — No sleep after the final attempt (helper-ok).**
`:138` → `if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds (5 * $attempt) }`.
*Gate:* behavioural test "four failures fail the run in under 35 s" (5+10+15 = 30 s of sleeps; without the fix 50 s).

**Step 9 — Comments and docs (helper-ok).**
Fix: `download-sql-dump.ps1:24` ("TRUNCATE" → "replace each PopDAM table (guarded; see restore steps); shared master data is only verified"); `export-sql-dump/index.ts:13-40` header (drop "migration from Lovable Cloud", describe cutoff margin, verify-only core, guarded wipe, the row-contents-not-point-in-time limitation); `export-pagination.ts` comments at `:15`, `:19-24`, `:53-59`, `:71-77`, `:91-96`. Find any doc describing this pipeline with `grep -rln "export-sql-dump\|download-sql-dump" docs README.md SELFHOST.md` and update them.
*Gate:* `grep -rn "TRUNCATE\|Lovable" migration/download-sql-dump.ps1 supabase/functions/export-sql-dump/index.ts` returns nothing misleading.
*Stop-and-ask:* a doc that states a business rule about backups.

**Step 10 — Behavioural tests (lead-only design, helper-ok typing).**
Add `POPDAM_EXPORT_URL` env override for `$SupabaseUrl` (default unchanged) and `POPDAM_EXPORT_OUT` for `$OutputDir`. New `src/test/download-sql-dump.pwsh.test.ts`: starts a Node `http` server on a random port serving a scripted manifest and chunks, runs `pwsh -NoProfile -File migration/download-sql-dump.ps1` with those env vars and a temp dir, and asserts outcomes (cases in §10). If `pwsh` is missing: `it.skip` locally, but **fail** when `process.env.CI` is set (ubuntu runners have it).
*Gate:* `npx vitest run src/test/download-sql-dump.pwsh.test.ts` green locally and in CI.

**Phase D — landing**

**Step 11 — Live proof (lead-only).**
After merge + deploy (`deploy-supabase.yml` run green for the merge SHA), run the downloader for real with an admin JWT (see §12) during normal operation (tagging running). Then restore the validated folder into a **rehearsal** database (Supabase preview branch or a local `supabase start`), never production. Record on #1147: manifest totals, file count, `restore-order.txt` line count, the restore exit code, and spot counts (`select count(*)` per table in the rehearsal vs manifest). Also re-read the three PR diffs (#1137, #1142, #1144) once more for any concern the truncated reviews may have raised and note "none further" or add it here.
*Gate:* restore exits 0; every table count in the rehearsal equals the manifest (volatile tables ≤).

### Adversarial cases (trust boundary: HTTP query parameters, server responses, restore target)

| Input | Hostile case | Test |
|---|---|---|
| `cutoff` param | future timestamp | unit "chunk refuses a future cutoff" |
| `cutoff` param | non-timestamp / injection text | existing `parseCutoff("nope")` throws |
| `after` cursor | wrong arity, non-string, quote/backslash | existing "round-trips keyset cursors" |
| exported ids (core verify) | id containing `'` | unit "verify block escapes quotes" |
| chunk body | cut in transit | pwsh test "truncated body is retried then fails" |
| chunk body | hash helper throws | pwsh test "hashing exception renames run INCOMPLETE" |
| chunk headers | more rows than counted on volatile table | pwsh test "volatile overflow fails" |
| manifest | `complete:false` / chunk size mismatch | pwsh test "incomplete manifest publishes nothing" |
| restore target | populated table, no opt-in | unit "replace-wipe is guarded" + step 11 rehearsal |
| restore target | lacks master data | step 11 rehearsal against empty core tables |

### 10. Tests required

Update `src/test/export-sql-dump-integrity.test.ts`:
- "freezes ingestion tables" — every table in the export list has a non-null `snapshotColumn`; `asset_characters`, `licensors`, `properties` → `created_at`.
- "nullable snapshot column keeps rows with no timestamp" — `cutoffFilter("style_groups", c)` includes `is.null`; a non-nullable table's does not.
- "cutoff lies 15 minutes before the manifest time"; "chunk refuses a future cutoff" (source check that the handler returns 400 + unit of the helper).
- "core chunk contains no INSERT/UPDATE/DELETE"; "verify block escapes quotes".
- "replace-wipe is guarded" — `clearTableSQL("public.assets")` contains `popdam.restore_replace` and precedes `DELETE`.
- Rewrite "deletes PopDAM tables, upserts core master data" to the new behaviour; extend "every frozen row exported exactly once" simulation with a NULL-timestamp row and an in-flight insert dated before the cutoff.

New `src/test/download-sql-dump.pwsh.test.ts` cases: full valid run writes `restore-order.txt`; truncated body retried then fails; hashing exception → `*-INCOMPLETE`; volatile overflow fails; incomplete manifest publishes nothing; four failures finish in < 35 s; written files have no BOM (first bytes `-- `).

Must stay green: `npm run test` (root vitest, both projects), `npm run lint` if the repo's CI runs it, `deno check` via the existing CI job for edge functions.

### 11. Constraints and gotchas

- Feature branch + PR to protected `main`; the AI merges after required checks; reviews are advisory.
- Database structure changes only through `popcre/shared-db` (step 1). No DDL in this repo; `shared-db-guard.yml` fails PRs that add it. Never edit `shared-db/` here (vendored mirror).
- Never restore into production. Never print or commit a JWT.
- Merge order: step 4 must not reach `main` before step 1's column is live in production.
- The run folder rename in `Fail-Run` uses `-ErrorAction SilentlyContinue`; with `$ErrorActionPreference = "Stop"` keep that explicit flag.
- PowerShell `trap` inside a script is script-scoped; test that `exit 1` from `Fail-Run` inside the trap does not re-enter the trap.
- No waits over 30 minutes; the retry ladder totals 30 s.

### 12. Access and environment

- `gh` authenticated as `u2giants` for `u2giants/popdam3`; shared-db PRs in `popcre/shared-db` (same identity unless that repo says otherwise).
- Admin JWT for the downloader: sign in to PopDAM as an admin and copy the session token as the script header describes, or set `POPDAM_EXPORT_JWT`. The service-role key is in 1Password vault `vibe_coding` (search "popdam supabase service role"); reference by `op://` only, never paste.
- Rehearsal DB: a Supabase preview branch (if the concurrent-branch limit allows — PR comments show it often doesn't) or local `npx supabase start` + applying `shared-db/supabase/ci-bootstrap` and migrations.
- Local tests: `npm ci && npx vitest run src/test/export-sql-dump-integrity.test.ts src/test/download-sql-dump.pwsh.test.ts`; `pwsh` at `C:\Program Files\PowerShell\7\pwsh.exe`.

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when: shared-db PR merged and promoted; popdam3 PR merged with all tests above green in CI; `deploy-supabase.yml` green for the merge SHA; step 11 live proof recorded on #1147 with counts and restore exit code; STATUS table updated with artifacts; #1147, #1149, #1150 closed with a comment linking the proof; the handoff file marked closed.

Risks and rollback:
- The 15-minute margin excludes the last 15 minutes of activity from the backup — intended; document it in the manifest output.
- A nullable column missed in step 3 keeps silently dropping rows — mitigated by the step 11 count comparison.
- Rollback: revert the popdam3 PR (edge function redeploys); the added column is harmless and needs no rollback.

Open: whether any other export table's timestamp is nullable (step 3 checks); the truncated reviewer text (step 11 re-audit).

### Self-audit (2026-11-25)

1. *Could a brand-new session execute this without asking?* Yes — goal §1, system and terms §2, findings with line refs §3/§5/§6, locked decisions §8, files and gates per step §9, access §12.
2. *Does it carry all background, including what was ruled out?* Yes — §7 lists seven rejected approaches with reasons; §3 records which findings are already fixed (#1149-1) and that the reviewer text was truncated.
3. *Is the goal clear enough for judgment calls?* Yes — §1 defines complete/consistent/restorable and that shared master data must never be written; §8 "Open" gives decision criteria.
Gap found and fixed during audit: the merge-order dependency between steps 1 and 4 (now in §9 step 4 and §11).

### Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1147-sql-dump-snapshot-restore-download.md in u2giants/popdam3 (covers issues #1147, #1149, #1150). Read AGENTS.md, then the plan's STATUS table and all 13 sections before touching code.
You do yourself: steps 1, 2, 3, 5, 6, 10 (test design), 11, and every verification gate.
Hand to your helper, in order, after step 3 is done: steps 8, 9, 7, then step 4 (only once step 1 is live in production), then the typing of the step-10 test cases you designed.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; bring back any stop-and-ask trigger named in the step; if stuck 30 minutes, you take the step back.
You run yourself: npx vitest run on both export test files, the full npm run test, the CI checks on the PR, the deploy run for the merge SHA, and the step-11 live export plus rehearsal restore. Update the STATUS table with artifacts, comment the proof on #1147, close #1147/#1149/#1150.
```
