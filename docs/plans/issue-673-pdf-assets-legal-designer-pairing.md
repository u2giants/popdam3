---
summary: Issue #673 plan: fix(pdf): keep assets after legal headings and pair designer names. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-673
---

# Plan: Review finding: u2giants/popdam3#672 fix(pdf): keep assets after legal headings and pair designer names (u2giants/popdam3#673)
Issue: https://github.com/u2giants/popdam3/issues/673
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Confirm all three findings still stand on `main` | ⬜ open | — |
| A | Designer reorder fallback only when both headings exist, creative first | ⬜ open | — |
| B | Licensor suffix strip shared by V1 and V2, with tests | ⬜ open | — |
| C | Asset scan stops at free-form legal text | ⬜ open | — |
| D | Adversarial table covered by named tests | ⬜ open | — |
| E | PR, CI green, edge function deployed, issue closed with evidence | ⬜ open | — |

Where a fresh session starts: step 0. Best done in the same branch as `docs/plans/issue-671-pdf-parser-form-text.md` (same file, same functions); do step C here **before** #671 step 1.

---

## 1. The ultimate goal

Licensing sheets and tech packs name the people who designed a product and the art files it used. The team relies on those names (designer credit, search by designer) and those file links (Style Guide Sources). **The goal: one person is never split into two roles or invented; the licensor field holds the licensor's name and nothing else; and a "files used" link only points at an asset the sheet actually listed — never a code-shaped word from legal boilerplate.** A blank is always preferable to a wrong credit, because the parser's output overwrites designer names on live files.

If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. What this application is

PopDAM (`u2giants/popdam3`, feature branch → PR → `main`) is POP Creations' asset library at https://dam.designflow.app; database Supabase `qsllyeztdwjgirsysgai`. The sheet parser is `supabase/functions/_shared/pdf-sheet-fields.ts`, called from `supabase/functions/agent-api/index.ts:4122` (`completePdfRescanBatch`). Its output goes to the shared-db RPC `commit_pdf_rescan_batch` (`index.ts:4125`; defined in `popcre/shared-db` migration `20261103171536_pdf_sheet_designers_overwrite.sql` lines 133–196), which stores `pdf_text_samples.extracted_fields`, overwrites `assets.designer_name` / `technical_designer_name` with a backup row in `asset_designer_sheet_backup`, and inserts `sku_files_used`. The Windows render agent (`apps/windows-agent/src/pdf-backfill.ts`) supplies the OCR text. Edge functions deploy via `.github/workflows/deploy-supabase.yml` after merge. Tests: vitest `edge-functions` project (`vitest.config.ts`), run by root `npm run test` in CI.

## 3. What triggered this work

PR #672 (head `cd836b51`, merged as `3261888a`) fixed two rescan problems seen in the image spot-check: assets listed after a `LEGAL LINE` heading were dropped, and OCR sometimes reads both designer headings first and both names afterwards. The advisory Muse review (ai-review run 41667119442) found three problems with how it did that; the fixer bot deferred them (`fixer-deferred`) because the PR was closed. No later commit addressed them: `git log` for the file after `3261888a` shows only `69f6b094` (#674, spot-check fixes), `827c95a7` (#686, lint), `95510d35` (#692, N/A) and deno-fmt chores.

The Indra rescan that used this parser finished at 4:24 PM EST Nov 4 (`admin_config.PDF_BACKFILL.status = completed`, 19,434 processed). So the fix protects the failed-file requeue (~634 live files, #680) and all future scans; it does not rewrite stored fields.

## 4. Scope

In: the three findings, regression tests, and closing #673 with evidence.

**NOT in this plan**
- #671's findings (spaced tokens, wrapped line, `FORM_FURNITURE`, `product_size`) — sibling plan `issue-671-pdf-parser-form-text.md`.
- Re-parsing stored sheet text; undoing designer values written by the rescan (undo table `asset_designer_sheet_backup`, admin_config backups `NULL_DESIGNER_CLEANUP_BACKUP_2026_11_04`, `DESIGNER_SPELLING_CLEANUP_BACKUP_2026_11_04` — owned by #680).
- Any shared-db object.
- Requeue of failed rescan files (#680, PR #718).

## 5. Current state of the code (worktree `01fcfc34`; identical to `origin/main` `4409e2d3` for this file)

`supabase/functions/_shared/pdf-sheet-fields.ts`:
- Finding A — lines 245–256. Fallback fires on `!out.creative_designer && out.technical_designer` (246); finds the `TECHNICALDESIGNER` heading (247); collects up to six person-name lines after it (249–251); if ≥2 names, rewrites creative=names[0], technical=names[1] (252–255). **No check that a `CREATIVEDESIGNER` heading exists or precedes.** Covered only by the positive test `pdf-sheet-fields.test.ts:137-141`.
- Finding B — line 240: V2 licensor `.replace(/\s+(LLC|Inc|All Rights)\b.*$/i, "")`; line 257: same strip on the `©` fallback line. Line 220: V1 `License:` value stored **unstripped**. Tests at 92–95 cover `©` stripping only; no test for `LLC`/`Inc`/`All Rights`.
- Finding C — `assetsAfter` lines 153–169: stop regex at 158 is `isFieldHeading(line) || /prop\s*65|warning/i.test(line)`; `isOtherHeading` (159) skips exact headings such as `LEGAL LINE` (in `OTHER_HEADINGS`, line 66) and breaks only if something was already found. Free-form legal lines (`©2024 Acme Inc. Item 12345`, `TM & © Big Co`) are scanned; today tokens containing `©` are rejected by `looksLikeAssetCode` (131), but a legal line without a glyph (`ALL RIGHTS RESERVED 2024-A1`) yields a token. Test at 122–125 covers the positive case only.

Nothing implemented; no branch exists.

## 6. Key findings and root cause

- A single-designer sheet with a two-line name (`TECHNICAL DESIGNER / JOHN / DOE`) parses `technical="JOHN"` at line 241, then the fallback at 246 turns it into `creative="JOHN", technical="DOE"` — one person split into two credits, and a creative designer invented. This is the exact failure class (wrong overwrite of designer names) that produced the Nov 3 incident, because `commit_pdf_rescan_batch` writes both columns.
- The licensor strip exists because sheets print `©Disney Enterprises, Inc. All Rights Reserved`; V1 sheets print `License: Acme LLC`. Inconsistent output means the same licensor appears twice in distinct-value lists.
- `legal` was removed from the asset-scan stop list so that `LEGAL LINE` as a heading no longer ends the scan before the assets (test 122–125). The side effect is that free-form legal paragraphs within 14 lines are now scanned for code-shaped tokens.

## 7. Approaches considered and rejected

- **Restoring `legal` to the stop regex** — rejected: it re-breaks the case #672 fixed (assets listed after a `LEGAL LINE` heading).
- **Requiring the creative heading anywhere in the document** — not enough: the reorder is only valid when the creative heading comes *before* the technical one and both names follow the technical heading; require `c >= 0 && c < t`.
- **Dropping the fallback and accepting a blank creative designer** — rejected: the both-headings-then-both-names OCR layout is common (that was #672's reason), and the fix is a cheap guard.
- **Stripping licensor suffixes in the shared-db RPC instead** — rejected: the parser owns value shape; the RPC stores what it is given, and shared-db changes have their own slower path.

## 8. Design decisions

LOCKED
- Reorder runs only when both headings exist, creative precedes technical, and at least two person-name lines follow the technical heading (A).
- One `stripLicensorSuffix` helper used by V1 (line 220), V2 (240) and the `©` fallback (257) (B).
- Legal free text ends the asset scan; exact `LEGAL LINE` headings are still skipped (C).
- No schema or RPC change.

OPEN
- The exact legal-text regex for C — contract is the adversarial table; suggested: `/[©®™]|all rights reserved|rights reserved|under license|licensed by|trademark|\bTM\b/i`.

## 9. The plan

Branch `fix/pdf-parser-673` (or the shared #671 branch). Run `npx vitest run supabase/functions/_shared/pdf-sheet-fields.test.ts` after each step.

**Step 0 — confirm.** `git log --oneline -5 origin/main -- supabase/functions/_shared/pdf-sheet-fields.ts`; if anything landed after `95510d35`, re-read lines in section 5 and re-number. Gate: 14/14 existing tests pass untouched.

**Step A — guard the designer reorder (lines 245–256).** Compute `c = lines.findIndex(l => norm(l) === "CREATIVEDESIGNER")` alongside `t`; run the block only if `c >= 0 && t >= 0 && c < t`. Behaviour: a sheet with only a technical heading never gains a creative designer; a two-line technical name stays `JOHN` (first line only — the rest is not a different person). Gate: test `keeps a single two-line technical designer in one role` (rows A1–A2) passes; test at 137–141 still passes.

**Step B — shared licensor strip.** Add `const stripLicensorSuffix = (v: string | null) => v && clean(v.replace(/^[©Ø]\s*/, "").replace(/\s*,?\s+(LLC|Inc\.?|Ltd\.?|All Rights)\b.*$/i, ""))` and use it at lines 220, 240 and 257 (keep the existing `©` removal semantics). Gate: tests `strips company suffixes from a licensor on either form` (rows B1–B4) pass; tests 46–59 (`licensor: "Acme"`) and 92–95 still pass.

**Step C — stop the asset scan at legal text (`assetsAfter`, line 158).** Add a `LEGAL_TEXT` regex (section 8 OPEN) and treat a matching line like `prop 65`: `break`. Keep `isOtherHeading` skipping of exact headings. Order with #671: do this before #671's spaced-token acceptance so no legal token can pass. Gate: tests `stops collecting assets at legal boilerplate` (rows C1–C3) pass; test 122–125 still passes.

**Step D — table complete.** Every row below names a passing test.

**Step E — land.** Commit, push, PR to `main` (`fix(pdf): guard designer pairing, share licensor strip, stop assets at legal text (#673)`), `bin/ai-pr-wait <pr>` in background, merge yourself, confirm `deploy-supabase.yml` succeeded and the `agent-api` function updated after the merge. Comment on #673 (signed `$AI_GH_SIGNATURE`) with merge SHA and test names; close. Leave `- [ ] live proof` on #673: when the #680 failed-file requeue commits new rows, query `pdf_text_samples` committed after the deploy for (i) rows where `creative_designer = technical_designer` or creative is set while the text has no `CREATIVE DESIGNER` line, expect 0; (ii) `licensor` ending in `LLC|Inc|Rights`, expect 0.

## 10. Tests required

File `supabase/functions/_shared/pdf-sheet-fields.test.ts`; command `npx vitest run supabase/functions/_shared/pdf-sheet-fields.test.ts`; CI: root `npm run lint && npm run typecheck && npm run test`.

Adversarial-cases table (OCR text from NAS files is external input):

| Row | Input | Hostile case | Expected | Test name |
|---|---|---|---|---|
| A1 | `TECHNICAL DESIGNER\nJOHN\nDOE\nRETAILER\nX` | single designer, two-line name, no creative heading | creative `null`, technical `JOHN` | keeps a single two-line technical designer in one role |
| A2 | `TECHNICAL DESIGNER\nROBIN\nCREATIVE DESIGNER\nKIM\nRETAILER\nX` | headings in reverse order | creative `KIM`, technical `ROBIN` (no reorder) | same |
| A3 | `CREATIVE DESIGNER\n3/4 View\nTECHNICAL DESIGNER\nROBIN\nTOP\nKIM\nRETAILER\nX` | existing positive case | creative `ROBIN`, technical `KIM` | existing test lines 137–141 |
| B1 | `RETAILER\nX\nLICENSE\nAcme LLC` | V2 suffix | `Acme` | strips company suffixes from a licensor on either form |
| B2 | `Designer: X\nLicense: Acme LLC` | V1 suffix | `Acme` | same |
| B3 | `RETAILER\nX\nLICENSE / LEGAL LINE\n©Acme Inc. All Rights Reserved` | glyph + suffix | `Acme` | same |
| B4 | `RETAILER\nX\nLICENSE\nAcme - Sub` | no suffix | `Acme - Sub` (unchanged, test line 94) | same |
| C1 | `RETAILER\nX\nASSET/STYLE GUIDE\nLEGAL LINE\nPRODUCT:\nAB_0010.ai\n©2024 Acme Inc. Item 12345` | code-shaped token in legal text | `["AB_0010.ai"]` | stops collecting assets at legal boilerplate |
| C2 | `...ASSET/STYLE GUIDE\nALL RIGHTS RESERVED 2024-A1\nAB_0010.ai` | legal line before the asset | `[]` (scan ended) — documents the trade-off | same |
| C3 | `...ASSET/STYLE GUIDE\nLEGAL LINE\nAB_0010.ai` | exact heading still skipped | `["AB_0010.ai"]` (existing test 122–125) | existing |

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push to `main`; the AI merges; sign posts with `$AI_GH_SIGNATURE`; times in EST.
- **Overlap with #671**: same file, adjacent lines. One branch for both is preferred; if separate, land this one first and rebase #671 on it. Both plans' STATUS tables get updated by whoever lands the code.
- `edge-functions-format.yml` pushes a `chore: deno fmt` commit to your branch after each push; `git pull --rebase` before pushing again.
- DB changes never in this repo. None needed.
- Parser output overwrites live designer names via `commit_pdf_rescan_batch`; when unsure, blank.
- `no-useless-escape` lint is enforced (PR #686 history).
- Worktree per task; stage only your hunks.

## 12. Access and environment

Machine hetz. `gh` as `u2giants`. Supabase MCP (confirm URL contains `qsllyeztdwjgirsysgai`; production is read-only by default). 1Password vault `vibe_coding` — nothing needed here. Local: `npm ci && npx vitest run supabase/functions/_shared/pdf-sheet-fields.test.ts`. Deploy: merge → `deploy-supabase.yml`.

## 13. Definition of done, risks, open questions

- [ ] Steps A–C implemented; every table row has a named passing test.
- [ ] Root lint, typecheck, test green locally and in CI; PR merged; `deploy-supabase.yml` succeeded; function updated after merge.
- [ ] #673 closed with merge SHA and test names; `- [ ] live proof` item left on #673 (section 9 step E) until the next rescan batch is checked.
- [ ] STATUS table and the linked handoff updated.

Risks: C2 shows the trade-off — a legal line printed *before* the assets ends the scan early. Sheets reviewed so far list assets directly under the heading, so this is accepted; if the live-proof query shows sheets losing assets this way, make the legal stop apply only after at least one asset was found (mirrors the `isOtherHeading` rule at line 160). Rollback: revert the PR.

Open questions: none blocking.

## Self-audit

1. Executable without questions? Yes — section 5 line refs, section 9 per-step behaviour and gates, section 10 rows with test names, section 12 commands.
2. All background and rejected paths carried? Yes — sections 3, 6, 7 (including why `legal` cannot go back into the stop list and why the fallback stays), section 11 overlap with #671.
3. Goal clear enough for judgment calls? Yes — section 1 ("never split or invent a person; blank over wrong") and the C2 trade-off rule in section 13.
