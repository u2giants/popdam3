---
summary: Plan for #1236 and #1238 — finish "exact disk file names" (#1233): keep path spaces at ingest, reject blank and padded-junk names, make move matching exact at any size, show the exact name on every library screen, and repair stored trimmed names. Read its STATUS first.
kind: plan
status: open
read-when: changing how PopDAM stores or shows file names (agent-api ingest, validators, move detection, library name display)
---

# Plan: exact NAS file names end to end — u2giants/popdam3#1236, #1238

Issues covered:
- https://github.com/u2giants/popdam3/issues/1236 — review of PR #1235 "keep exact file names at ingest; moves match exact basenames"
- https://github.com/u2giants/popdam3/issues/1238 — review of PR #1237 "show the exact disk name in the Library"

Background issue (closed): https://github.com/u2giants/popdam3/issues/1233 — whitespace-twin files (`" x.ai"` and `"x.ai"` in one folder) flip-flopped one asset record.
Related, separate plan: [issue-1188 Windows agent 8.3 names](issue-1188-windows-agent-short-name-resolution.md).
Handoff: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md)
Written 2026-11-25 (3:55 PM EST) by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm findings; count stored names that differ from the disk name (read-only) | ⬜ open | |
| 2 | Ingest: stop trimming paths; reject blank names | ⬜ open | |
| 3 | Junk-file checks on the trimmed name | ⬜ open | |
| 4 | Move matching: filter by exact basename in the query | ⬜ open | |
| 5 | SKU parsing rule locked by a test | ⬜ open | |
| 6 | One display-name helper used on every library screen | ⬜ open | |
| 7 | Repair stored trimmed names (backfill script, dry run, run) | ⬜ open | |
| 8 | Tests, PR, CI, merge, deploy check | ⬜ open | |
| 9 | Live proof and close both issues | ⬜ open | |

**Where a fresh session starts:** step 1.

---

## 1. The ultimate goal

A file's name in PopDAM must be exactly its name on the NAS, character for character, including a leading or trailing space a designer typed by accident. Two files whose names differ only by a space are two files, each with its own record, tags and history. PopDAM must show that exact name everywhere a designer looks (grid, list, detail panel, style-group panel), and junk files (`Thumbs.db`, `._x`) must stay out even with a space in front.

**If a step conflicts with this goal, the goal wins — stop and flag it on #1236.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) is POP Creations' library of design files on a Synology NAS (share `mac`). The NAS "bridge agent" (`apps/bridge-agent/`) scans the share and posts each file to the `agent-api` edge function (`supabase/functions/agent-api/index.ts`, Supabase project `qsllyeztdwjgirsysgai`, deployed by `.github/workflows/deploy-supabase.yml` on merge to `main`). The ingest handler stores `public.assets.relative_path` (full path under the share) and `filename`. If a file with the same content appears at a new path, "move detection" re-homes the existing record instead of creating a new one (tiers: inode → full content hash → quick hash + exact basename). The React web app (`src/`, deployed by Coolify after merge) shows the files.

## 3. What triggered this work

#1233 (closed) fixed ingest so names are kept exactly and moves compare exact basenames (PR #1235), and made the grid and detail panel show the exact name (PR #1237). The advisory AI reviewer filed #1236 (5 findings) and #1238 (3 findings). Both source PRs are merged; the fixer deferred.

## 4. Scope

In: all 8 findings and a one-time repair of stored names that were trimmed before #1233.

### NOT in this plan
- Windows render agent short-name (8.3) resolution — [issue-1188 plan](issue-1188-windows-agent-short-name-resolution.md).
- Renaming files on the NAS (never).
- Settings/admin screens that show `filename` (TIFF hygiene, PDF samples, AI bakeoff…) — they are admin tools; listed in §5 for a later pass, not changed here except where step 6's helper drops in trivially. Exception: `TiffHygieneTab.tsx` `relative_path.replace("/" + filename)` is a correctness bug when they differ; step 6 fixes it with the helper.
- Database structure changes (none needed).

## 5. Current state (verified on `main` @ `787c20b8`, 2026-11-25)

Server:
- **F1 path trim (#1236 f1)** — `supabase/functions/_shared/validators.ts:60-77` `requireCanonicalRelativePath` does `raw.trim()` (`:68`). Callers: ingest `agent-api/index.ts:1060` and `:1786` (move/rename report). So `Decor/a/x.ai ` is stored as `Decor/a/x.ai` and twins with trailing spaces collide. No test of this function in `validators.test.ts`.
- **F2 move query (#1236 f2)** — tier 3 at `agent-api/index.ts:1215-1224`: `.eq("quick_hash", …).eq("is_deleted", false).neq("relative_path", …).limit(25)`, no order, then `pickMoveCandidate` (`_shared/move-candidates.ts`) keeps the unique exact-basename row. With >25 same-hash rows the right row can be cut off or a duplicate can be hidden. Tiers 1–2 (`:1191-1211`) use `limit(2)` and are fine.
- **F3 blank name (#1236 f3)** — `validators.ts:19-25` `requireExactString` rejects only `""`; `"   "` passes (ingest `:1065`).
- **F4 padded junk (#1236 f4)** — `agent-api/index.ts:1066-1072` tests `filename.startsWith("._")`, `startsWith("~")`, `JUNK_FILENAMES.has(filename)` on the exact name, so `" Thumbs.db"` and `" ._foo"` are ingested. Same pattern in `_shared/admin-handlers/agent-handlers.ts:570` (junk render-job cleanup). `JUNK_FILENAMES` is in `_shared/path-filters.ts:15`.
- **F5 SKU parse (#1236 f5)** — `_shared/sku-parser.ts:138` `filename.trim()` before parsing; untested.
- Bridge sends exact names: `apps/bridge-agent/src/scanner.ts:281-291` (no trim). Good.

Web app:
- **F6 list view (#1238 f1)** — `src/components/library/AssetListView.tsx:140,142` show `asset.filename`.
- **F7 style-group panel (#1238 f1)** — `src/components/library/StyleGroupDetailPanel.tsx:529` (`alt`), `:1095` (`alt`), `:1113-1114` (`title`, `formatFilename(asset.filename, …)`), `:227`, `:245`.
- **F8 duplicated rule (#1238 f2)** — `relative_path.split("/").pop() || filename` at `AssetDetailPanel.tsx:105`, `:217`, `AssetGrid.tsx:164`; bare `split("/").pop()` at `src/components/settings/windows-agent/RenderJobsTable.tsx:400`. `src/lib/path-utils.ts` has no basename helper.
- **F9 no test (#1238 f3)**.
- Other `filename` displays (admin tools, out of scope except TIFF): `ImageSimilarityResults.tsx:53,82,104,106`, `FindAlternativeImages.tsx:228,246`, `AiTagBakeoffTab.tsx:686,693`, `FileHygieneTab.tsx:404`, `TiffHygieneTab.tsx:600-603,677-679,729-731`, `settings/pdf-text-samples/*`, `PdfTextSamplesTab.tsx:179,184`, `AiTaggingDetailPage.tsx:311,351,387`.

Data:
- No repair was ever run for rows stored with a trimmed `filename` before #1233 (searched `docs/`, `supabase/migrations/`). Count unknown — step 1 measures it.

## 6. Key findings and root cause

The #1233 fix changed the `filename` validator but left the older path normalizer trimming, so the exact-name rule holds for leading spaces in inner folders and for the file name column, but not for a trailing space at the end of the path. The display fix replaced `filename` in two components only. The stored `filename` of older rows is still the trimmed name; that is why the UI derives the name from the path.

## 7. Approaches considered and REJECTED

- **Raising the tier-3 limit (e.g. 100)**: still arbitrary; the right fix filters by exact basename in the query.
- **Matching basename via `filename` column in the query**: wrong for older rows until the repair runs; use `relative_path` ending instead (works before and after the repair).
- **Trimming for storage but comparing untrimmed**: that was the original #1233 defect.
- **Deleting whitespace-twin files**: never; they are designer files.
- **A database migration to re-derive `filename`**: this is application data, not structure; a reviewed, logged script from this repo is the right tool (shared-db owns structure, not row repairs of `assets.filename`). If the implementer finds a trigger or constraint on `filename` that blocks the update, stop and route through `popcre/shared-db`.

## 8. Design decisions

Locked:
- Exact disk name is the truth (#1233, 2026-11-20).
- Junk detection ignores surrounding whitespace (a padded `Thumbs.db` is still junk).
- A blank or whitespace-only file name is rejected (400) — no real file is named only spaces on Synology.
- SKU parsing keeps trimming: the SKU is the same product code whether or not a stray space precedes it; two whitespace twins are two files of the same SKU. Lock it with a test (step 5). Reason: SKU drives licensing data; a leading space must not lose it.
- Path normalization still converts `\` to `/` and strips leading/trailing **slashes**, but no longer strips spaces. A whitespace-only path is still rejected.

Open:
- Name of the helper (`exactFileName(asset)` suggested) and its file (`src/lib/path-utils.ts` suggested). Criterion: one helper, imported everywhere listed in step 6.

## 9. The plan

**Step 1 — Re-confirm and measure.** Re-read §5 lines on current `main`. Read-only count: `select count(*) from public.assets where is_deleted = false and filename <> regexp_replace(relative_path, '^.*/', '');` and a 20-row sample (via the Supabase MCP `execute_sql` read-only or psql under `op run`). Record both in the PR description. `lead-only` (production read, judgment). Gate: numbers recorded.

**Step 2 — Ingest keeps path spaces; rejects blank names (F1, F3).** `requireCanonicalRelativePath`: replace `raw.trim()` with `raw`; keep the whitespace-only rejection (`raw.trim() === ""`). `requireExactString`: reject when `v.trim() === ""`. Check both callers (`agent-api/index.ts:1060`, `:1786`) and every other user of `requireExactString` (`grep -rn requireExactString supabase/functions`) for a caller that relied on trimming; if one is user-typed input (not a bridge path), stop and ask the lead. `helper-ok`. Stop-and-ask: any caller that is not bridge/agent input. Gate: tests "trailing space in final segment is kept", "leading space kept", "whitespace-only path rejected", "whitespace-only filename rejected".

**Step 3 — Junk checks on the trimmed name (F4).** Add `isJunkFileName(name)` to `_shared/path-filters.ts` (`const n = name.trim(); return n.startsWith("._") || n.startsWith("~") || JUNK_FILENAMES.has(n) || JUNK_GLOB_PATTERNS.some(...)` — match how `JUNK_FILENAMES` globs are used today). Use it at `agent-api/index.ts:1066-1072` and `agent-handlers.ts:570`. Also check the Windows agent junk guard (`apps/windows-agent/src/index.ts:556`) and the render-queue guard (`agent-api/index.ts:2062`) and switch them to the same rule if they test names. `helper-ok`. Stop-and-ask: if `JUNK_FILENAMES` globs behave differently from the inline checks. Gate: tests "padded Thumbs.db is junk", "padded ._foo is junk", "x.ai with trailing space is not junk".

**Step 4 — Exact basename in the move query (F2).** Tier 3: add `.like("relative_path", "%/" + escapeLikePattern(basenameOf(relativePath)))` (import `escapeLikePattern` from `_shared/product-code.ts:8`), add `.order("id")`, `.limit(3)`; keep `pickMoveCandidate` (it still requires exactly one). For a root-level path (no `/`), use `.eq("relative_path", …)` semantics are impossible (neq) — just skip tier 3 for root-level files. Behaviour: the candidate set is all same-hash rows with the exact basename; 2+ → no move (safe). `lead-only` (decides whether a record is re-homed in production). Gate: test "more than 25 same-hash rows still finds the unique exact-name match" (stub client asserting the `like` filter), "two exact-name matches → no move".

**Step 5 — SKU rule test (F5).** Add `sku-parser.test.ts` cases: `"  PQE8QMVAV01 art.psd"` and `"PQE8QMVAV01 art.psd"` parse the same SKU; comment at `sku-parser.ts:138` citing the decision. Stub the ColdLion lookup the way existing tests do. `helper-ok`. Stop-and-ask: if `parseSku` cannot be tested without network. Gate: tests pass.

**Step 6 — One display-name helper (F6–F9).** Add `export function exactFileName(a: { relative_path: string; filename: string }): string` to `src/lib/path-utils.ts`: basename of `relative_path` (ignore a trailing `/`), falling back to `filename` when empty. Use it at `AssetDetailPanel.tsx:105,217`, `AssetGrid.tsx:164`, `AssetListView.tsx:140,142`, `StyleGroupDetailPanel.tsx:227,245,529,1095,1113-1114`, `RenderJobsTable.tsx:400`, and fix `TiffHygieneTab.tsx` folder derivation to `relative_path.slice(0, relative_path.lastIndexOf("/"))`. Remove the copied comments; one comment on the helper. Note: React collapses nothing in text nodes but HTML whitespace collapsing hides a leading space visually — wrap the name in an element with `white-space: pre` (Tailwind `whitespace-pre`) where the name is shown as text so `" x.ai"` is visibly different. `helper-ok`. Stop-and-ask: if `whitespace-pre` breaks truncation layout, bring screenshots back. Gate: `src/test/exact-file-name.test.ts` passes; screenshots in step 9.

**Step 7 — Repair stored names.** Write `scripts/backfill-exact-filenames.mjs`: under `op run` (database password from 1Password `vibe_coding`), selects rows where `filename <> basename(relative_path)` in pages of 1,000 by `id`, `--dry-run` prints count and 20 samples, real run updates `filename = basename` per page in a transaction and writes `verification/exact-filenames/backfill-<date>.md` (counts, first/last id, time EST). Before the real run, check for triggers on `assets.filename` (`select tgname from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal;` and read their functions) — search documents may be rebuilt; that is fine but note it. Only rows where the two differ by whitespace or are otherwise just the trimmed form are updated; any row whose difference is more than whitespace is listed, not changed. `lead-only` (production data write). Gate: dry-run count equals step 1 count (± rows ingested since); after the run the step 1 query returns only the listed non-whitespace rows.

**Step 8 — Land.** Branch `claude/issue-1236-exact-names`, PR to `main` ("Refs #1236 #1238"), merge when required checks pass. Confirm deploy-supabase run green and the Coolify frontend at https://dam.designflow.app serves the merge SHA (see `docs/deployment.md` stale-site check). Run step 7 after the deploy. `lead-only`.

**Step 9 — Live proof.** As an admin (1Password `vibe_coding`, PopDAM `ai-admin` login item; never paste values): find an asset whose disk name has a leading or trailing space (from step 1 sample); screenshot grid, list, detail panel, style-group panel showing the same exact name. Check the next scan's `agent-api` logs show no flip-flop for that file. Comment on #1236 and #1238 with evidence and EST times (signed `$AI_GH_SIGNATURE`), close both. `lead-only`.

### Adversarial cases (bridge payload and disk names are external input)

| Input | Hostile case | Test |
|---|---|---|
| `relative_path` | trailing space on final segment | `trailing space in final segment is kept` |
| `relative_path` | only spaces / only slashes | `whitespace-only path rejected` |
| `relative_path` | `%` or `_` in basename (LIKE) | `move query escapes LIKE wildcards in basename` |
| `filename` | `"   "` | `whitespace-only filename rejected` |
| `filename` | `" Thumbs.db"`, `" ._foo"`, `"~$x.psd "` | `padded Thumbs.db is junk`, `padded ._foo is junk` |
| same-hash rows | 30 rows, one exact-name match | `more than 25 same-hash rows still finds the unique exact-name match` |
| same-hash rows | two exact-name matches | `two exact-name matches → no move` |
| display | `relative_path` ending in `/` | `exactFileName falls back to filename` |

## 10. Tests required

- `supabase/functions/_shared/validators.test.ts`: the four step-2 tests.
- `supabase/functions/_shared/path-filters.test.ts`: the three step-3 tests.
- `supabase/functions/_shared/move-candidates.test.ts` (or a new `agent-api` tier-3 test with a stub client): the two step-4 tests plus the LIKE-escape test.
- `supabase/functions/_shared/sku-parser.test.ts`: step 5.
- `src/test/exact-file-name.test.ts`: nested path, root file, trailing slash fallback, leading-space name preserved.
- Must stay green: `npm test`, `npm run typecheck`, `npm run lint`.

## 11. Constraints and gotchas

- Never push to protected `main`; AI merges after required checks; reviews advisory.
- No DDL in this repo; structure changes only via `popcre/shared-db`.
- Step 7 is a production data write: dry run first, log every run, page by id, never touch rows whose difference is not whitespace.
- HTML collapses leading spaces visually — the UI must use `whitespace-pre` or the fix is invisible.
- Times to Albert in EST/EDT.

## 12. Access and environment

- `gh` as `u2giants`. Supabase MCP for read-only queries; database password for psql in 1Password `vibe_coding` (Supabase production database item, by title).
- Local: `npm ci`, `npm run dev`; tests `npm test`.
- Admin login for screenshots: 1Password `vibe_coding`, PopDAM `ai-admin`.

## 13. Definition of done, risks, open questions

Done when: all STATUS rows ✅ with evidence; PR merged; edge functions deployed; frontend serves the merge SHA; backfill log committed; screenshots posted; #1236 and #1238 closed.

Risks: stopping the path trim could expose a caller that sends padded paths — step 2's caller check; rollback = revert PR. The backfill could rewrite search text for many rows — paged, logged, and reversible from the log (old value recorded per page in the log file if count < 5,000; otherwise export old values to a private file under `$TMPDIR` before the run).

Open: none beyond the helper name.

## Self-audit

1. *Fresh session without questions?* Yes — §2 system, §5 exact lines, §9 files/behaviour/gates, §12 access.
2. *Background and rejected options?* Yes — §6 why the gap exists; §7 five rejected approaches.
3. *Goal clear?* Yes — §1: exact name everywhere, twins stay separate, junk stays out.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 issues #1236 and #1238. Read AGENTS.md, then docs/plans/issue-1236-exact-nas-file-names.md (STATUS first).
Do steps 1, 4, 7, 8, 9 yourself. Hand steps 2, 3, 5, 6 to your helper, one at a time, in plan order.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; no design decisions; no merges, pushes or GitHub posts; bring every stop-and-ask trigger back to you; if stuck 30 minutes, you take the step back.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run all tests, review each helper diff, run the backfill (dry run first) and take the screenshots. Update STATUS in the same PR.
```
