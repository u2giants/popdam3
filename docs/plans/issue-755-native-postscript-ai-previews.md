---
summary: Issue #755 plan: legacy PostScript .ai files are skipped as placeholders, so they never get previews. Read its STATUS first.
kind: plan
status: open
read-when: implementing #755, or changing the .ai sentinel / no-PDF-compatibility detection on the bridge or Windows render agent
---

# Plan: Let legacy PostScript Illustrator files get real previews (u2giants/popdam3#755)

Issue: https://github.com/u2giants/popdam3/issues/755 (review finding on merged PR #750)
Handoff: [HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md](../../HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md)
Written 2026-11-25 (about 4:00 PM EST) by Claude. Plan only; no implementation started. Code references are to `origin/main` at `787c20b8`.

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Measure how many files are affected (read-only SQL) | ⬜ open | |
| 2 | Bridge detector: native PostScript is "old format", not a placeholder | ⬜ open | still classified as sentinel: `apps/bridge-agent/src/ai-sentinel-detect.ts:72-75` |
| 3 | Bridge scan + thumbnailer: send old-format files to Windows instead of skipping them | ⬜ open | `apps/bridge-agent/src/index.ts:1220-1230`, `apps/bridge-agent/src/thumbnailer.ts:255-270` |
| 4 | Sentinel scan stops labelling old-format files as placeholders | ⬜ open | `apps/bridge-agent/src/ai-sentinel-scanner.ts:24` → `handleCompleteAiSentinelScan` `supabase/functions/agent-api/index.ts:4366` |
| 5 | Fix the false comment in the Windows detector | ⬜ open | `apps/windows-agent/src/renderer.ts:296-300` |
| 6 | Recover files already wrongly ignored | ⬜ open | `scanner_ai_ignores` rows with reason `no_pdf_compat` |
| 7 | Tests (§10), PR, CI, merge, bridge release | ⬜ open | |
| 8 | Live proof on a real legacy file, close #755 | ⬜ open | `- [ ] live proof` stays on #755 |

**Where a fresh session starts:** Step 1. Finding 1 is still true on `main`. The reviewer's findings 2–4 were never recorded (see §3); this plan does not chase them.

---

## 1. The ultimate goal

Old Adobe Illustrator files (saved before Illustrator embedded a PDF copy — "native PostScript" files) should show their real artwork as a thumbnail in PopDAM, like every other file. Today the scanner throws them away as if they were blank "saved without PDF content" placeholders, so the team sees no preview, cannot find them visually, and the AI tagger never sees them.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Two things must stay true while doing it: genuine placeholder files (modern PDF-wrapped `.ai` whose only page is Adobe's "saved without PDF Content" notice) must still be skipped, and `.eps` files must keep rendering as today.

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed consumer-product art. Source design files (PSD, AI, PDF, EPS…) live on a Synology NAS. Pieces involved here:

- **NAS bridge agent** (`apps/bridge-agent/`, Node, runs as a container on the NAS) walks the NAS, asks the server which files changed (`check-changed`), makes thumbnails locally with sharp/mupdf where it can, uploads them to DigitalOcean Spaces, and records each file via `ingest`. If it cannot render a file it sets `thumbnail_error` and queues a Windows render job.
- **Windows render agent** (`apps/windows-agent/`, Node on a Windows PC with Ghostscript, Inkscape, ImageMagick, Poppler) claims render jobs and renders the hard files.
- **agent-api** edge function (`supabase/functions/agent-api/index.ts`, Deno on Supabase) is the server both agents talk to.
- Web UI: `https://dam.designflow.app`. Repo `u2giants/popdam3`, release branch `main` (protected; feature branch → PR → merge). Bridge releases: `publish-bridge-agent.yml` builds `:stable` and bumps the version; the NAS applies it on request (`docs/deployment.md`). Windows agent ships as a GitHub Release.

## 3. What triggered this work

PR #750 ("Restore fair photo indexing and recover off-page artwork previews", merged 2026-11-05) taught the Windows agent to render native-PostScript `.ai` files with Ghostscript inside their declared bounding box (`nativePostscriptPage`, `apps/windows-agent/src/renderer.ts` ~line 341, used by `renderWithGhostscript`), and changed the Windows detector to treat `%!PS-Adobe-` files as renderable (`renderer.ts:289-293`).

The advisory reviewer (deepseek, ai-review run 41962746916) found: the bridge still classifies the same files as placeholders **before ingest** and drops them — so the new Windows path is unreachable for scanned files:

- `apps/bridge-agent/src/index.ts:1220-1230` — scan pre-flight calls `isAiWithoutPdfCompat`; true → `markAiIgnored(…, "no_pdf_compat")` and return (file never ingested, never queued).
- `apps/bridge-agent/src/thumbnailer.ts:134-140` → `isAiSentinel` → `inspectAiPage` (`ai-sentinel-detect.ts:69-75`) returns `isSentinel: true, oldFormat: true` for any file starting `%!PS-Adobe-` without `%PDF-` in the first 512 bytes.
- The comment at `renderer.ts:299` ("this matches the bridge agent's shared detector") is false.

The reviewer wrote "findings 2–4 remain as previously stated", but those earlier findings were never posted to the issue, the PR comment, or the run log (checked 2026-11-25). They are unrecoverable; PR #750's remaining changes (PopSG search claim batch of 1, lane labels in logs — `apps/image-embed-worker/`) were re-read and are out of this plan's scope.

Reproduce: pick any legacy `.ai` whose first bytes are `%!PS-Adobe-` and contain no `%PDF-` (step 1 lists candidates). It has a row in `scanner_ai_ignores` with reason `no_pdf_compat` and no `assets` row (or an asset row with no thumbnail).

## 4. Scope

In: the bridge's classification of native-PostScript `.ai`; the bridge scan pre-flight and local thumbnailer for those files; the sentinel scan result for them; the Windows comment; recovery of already-ignored files; tests.

NOT in this plan:
- Any change to the Windows Ghostscript bounding-box rendering itself (already landed in #750).
- `.eps` handling (unchanged; Windows already skips the AI pre-check for EPS, `renderer.ts:814-819`).
- PR #750's image-embed-worker changes and the unrecorded findings 2–4.
- Modern PDF-wrapped placeholder detection (stays exactly as is).
- Any schema change.

## 5. Current state of the code

- `ai-sentinel-detect.ts:69-75`: old format → `{ isSentinel: true, oldFormat: true }`. Modern format → mupdf page-0 text + draw-op probe (unchanged, correct).
- `thumbnailer.ts:134-140` `isAiWithoutPdfCompat` = `isAiSentinel` (true for old format). `thumbnailer.ts:255-270` (`.ai` thumbnail): if "without PDF compat", try a sibling image, else throw `no_pdf_compat`. Otherwise sharp → `thumbnailAiGhostscript` → sibling → throw `no_pdf_compat`.
- `index.ts:841-848`: a thrown `no_pdf_compat` becomes `thumbnailError: "no_pdf_compat"`, which is the "queue for Windows" signal; `shouldDeferToWindows` (`index.ts:758`) governs deferral.
- `index.ts:1194-1230` `.ai` pre-flight: (1) permanent ignore list `aiIgnoreSet` (loaded from table `scanner_ai_ignores` via `load-ai-ignore-list`, `agent-api/index.ts:5247`); (2) PDF sibling → ignore `pdf_sibling`; (3) sentinel → ignore `no_pdf_compat`.
- `ai-sentinel-scanner.ts` (admin-triggered sentinel scan of existing assets) reports `is_sentinel` per asset; `handleCompleteAiSentinelScan` (`agent-api/index.ts:4366-4387`) writes Adobe's placeholder sentence into `pdf_text_samples` for each "sentinel".
- Windows: `renderer.ts:277-293` treats `%!PS-Adobe-` as renderable; `renderFile` `.ai` path tries Sharp/GS/Poppler then Inkscape; GS uses `nativePostscriptPage` bounds.
- Bridge version on `main`: `apps/bridge-agent/package.json` `1.17.3`.

## 6. Key findings and root cause

Root cause: one word — "sentinel" — is doing two jobs on the bridge. It means both "a placeholder with no artwork, skip forever" and "not PDF-renderable here". Native PostScript `.ai` is the second, not the first: it has real artwork that only Ghostscript (on Windows, with the bounds fix) renders correctly. `inspectAiPage` already distinguishes them (`oldFormat: true`) but every caller reads only `isSentinel`.

Why not render old-format files on the bridge: the bridge's `thumbnailAiGhostscript` does not apply the bounding-box fix, so artwork placed outside the Letter page renders blank or clipped — exactly the "off-page artwork" problem #750 fixed on Windows. The Windows path is the one that works.

## 7. Approaches considered and rejected

- **Make the bridge render old-format files itself** (port `nativePostscriptPage` into the bridge). Rejected: duplicates a renderer, the bridge container's Ghostscript build/options differ, and Windows already renders these correctly. Revisit only if Windows capacity becomes the bottleneck.
- **Delete the old-format branch so old files fall through to mupdf.** Rejected: mupdf cannot open pure PostScript; `inspectAiPage` would throw and `isAiWithoutPdfCompat` would return false, so the bridge would then attempt sharp/GS locally (wrong renderer, off-page blanks).
- **Leave the bridge alone and have Windows scan the NAS for ignored files.** Rejected: a second discovery path; ingest/identity must stay bridge-owned.

## 8. Design decisions

Locked (2026-11-25, this plan):
- A native-PostScript `.ai` is **not** a placeholder. It is ingested and its thumbnail is produced by the Windows agent.
- The bridge does not render old-format files locally; it signals `no_pdf_compat` so the existing Windows queueing path handles them (a sibling image may still be used if one exists, as today).
- Modern-format placeholder detection is unchanged.
- No schema change; recovery is a data change to `scanner_ai_ignores` (PopDAM-owned application data, not structure) done by the app session.

Open (implementer judgment):
- Whether to keep the name `isSentinel` and add a separate `nativePostscript` flag, or rename. Criteria: fewest call-site changes, and every caller must read the right one. Recommended: keep `AiPageInfo.isSentinel` meaning "placeholder" only (false for old format) and keep `oldFormat` as the flag.

## 9. The plan

Phase 1 is one session; no cut point needed.

**Step 1 — Measure (lead-only: read-only production SQL, judgment on numbers).**
Run, read-only:
```sql
select reason, count(*) from public.scanner_ai_ignores group by reason;
select count(*) from public.pdf_text_samples where extracted_text like 'This is an Adobe® Illustrator® File that was saved without PDF Content.%';
```
Record the counts in the issue. The old-format share cannot be known from SQL (it needs the file header); step 6 measures it.
You'll know it worked when: both counts are posted on #755.

**Step 2 — Bridge detector (helper-ok: exact edit + named test).**
In `apps/bridge-agent/src/ai-sentinel-detect.ts:72-75` return `{ isSentinel: false, oldFormat: true, pageCount: 1, pageText: "" }` and update the doc comment above `inspectAiPage` ("Old format: native PostScript — real artwork, rendered by the Windows agent; never a placeholder"). `isAiSentinel` then returns false for old format.
Add `export async function isNativePostscriptAi(filePath)` returning `(await inspectAiPage(filePath)).oldFormat` (or reuse `inspectAiPage` directly in step 3).
Gate: new test cases in a new `apps/bridge-agent/src/ai-sentinel-detect.test.ts` (added to the `test` script in `apps/bridge-agent/package.json`) pass: a temp file `%!PS-Adobe-3.0\n%%BoundingBox: 0 0 100 100\n…` → `isSentinel false, oldFormat true`; a file whose head has both `%!PS-Adobe-` and `%PDF-` → not old format.
Stop-and-ask: if any other caller of `isAiSentinel`/`inspectAiPage` exists beyond `thumbnailer.ts` and `ai-sentinel-scanner.ts` (`grep -rn "isAiSentinel\|inspectAiPage" apps packages`), bring it back.

**Step 3 — Bridge scan and thumbnailer (lead-only: changes which files reach production ingest).**
- `apps/bridge-agent/src/index.ts:1220-1230`: unchanged code now only skips true placeholders (because step 2 made `isAiWithoutPdfCompat` false for old format). Update the comment at 1220-1222 to say so.
- `apps/bridge-agent/src/thumbnailer.ts` `.ai` path (around 255): before sharp, if the file is native PostScript, try `thumbnailFromSibling`, else `throw new Error("no_pdf_compat")` — do **not** run sharp or `thumbnailAiGhostscript` on it. Comment: "native PostScript: the Windows agent renders it within its bounding box (#750/#755)."
- Confirm `index.ts:841-848` → `thumbnailError: "no_pdf_compat"` → ingest records the asset with that error and the existing render-queue request path queues it for Windows (`render-queue-request.ts`; #1094: bridge is the only render scheduler). Do not add a second queueing path.
You'll know it worked when: a unit test (step 7) shows a native-PS temp `.ai` makes `generateThumbnail` reject with `no_pdf_compat` without invoking sharp; and in live proof the asset appears with `thumbnail_error = no_pdf_compat` and a `render_queue` row.

**Step 4 — Sentinel scan (helper-ok: follows from step 2).**
After step 2, `ai-sentinel-scanner.ts:24` reports old-format files as `is_sentinel: false`, so `handleCompleteAiSentinelScan` stops writing the placeholder sentence for them. No server change needed. Gate: the step-2 test covers it; add one line to the scanner test if one exists, else none.
Stop-and-ask: if `handleCompleteAiSentinelScan` turns out to also clear thumbnails or set errors for non-sentinels, bring it back.

**Step 5 — Windows comment (helper-ok: comment only).**
`apps/windows-agent/src/renderer.ts:296-300`: replace "this matches the bridge agent's shared detector" with "the bridge agent's detector makes the same placeholder decision and also treats native PostScript as real artwork (#755)". Gate: `npm test --prefix apps/windows-agent` green.

**Step 6 — Recover already-ignored files (lead-only: production data change).**
Files the bridge already wrote to `scanner_ai_ignores` with reason `no_pdf_compat` are skipped forever by pre-flight step (1). After the new bridge is deployed:
1. Add a bridge maintenance routine (small, in `apps/bridge-agent/src/ai-sentinel-scanner.ts` or a new `ai-ignore-recheck.ts`) that, at scan start after `loadAiIgnoreList`, for each ignore entry with reason `no_pdf_compat` reads the file head (≤512 bytes, `resolveUnderRoot` for containment) and, when it is native PostScript, calls a new agent-api action `unmark-ai-ignored` (deletes that one `scanner_ai_ignores` row by `relative_path` and `reason = 'no_pdf_compat'`) and removes it from `aiIgnoreSet`. It runs once per bridge version (store `AI_IGNORE_RECHECK_VERSION` in agent metadata or `admin_config`), bounded to header reads only.
   - `load-ai-ignore-list` currently returns `relative_path, reason, snoozed_until`; the bridge's `loadAiIgnoreList` (`apps/bridge-agent/src/api-client.ts` ~540) returns only a `Set` of paths — extend it to keep the reason.
2. For assets that already exist and carry the placeholder sentence in `pdf_text_samples` from an earlier sentinel scan, re-run the admin sentinel scan after deployment; old-format rows will now report false. Delete those stale `pdf_text_samples` rows only for assets confirmed old-format (the recheck routine can report them).
You'll know it worked when: the routine logs `{rechecked, native_postscript_unignored}` counts once; the `scanner_ai_ignores` `no_pdf_compat` count drops by that number; the next scan ingests those paths.

**Step 7 — Tests, PR, merge, release (lead-only: release).**
See §10. PR to `main`, CI green, merge. Release the bridge (`publish-bridge-agent.yml`, version bump) and the Windows agent only if step 5 is the only Windows change (comment-only → it may ride the next Windows release; no urgent release needed).

**Step 8 — Live proof (lead-only).**
Pick 3 recovered native-PostScript `.ai` files. Within one scan + Windows render cycle each shows real artwork in the PopDAM grid (screenshot of each asset's detail view) and `assets.thumbnail_url` is set, `thumbnail_error` null. Also confirm one known modern placeholder `.ai` is still ignored. Post evidence on #755, tick `- [ ] live proof`, close.

## 10. Tests required

New:
- `apps/bridge-agent/src/ai-sentinel-detect.test.ts`: native PS → `isSentinel false, oldFormat true`; PS header with `%PDF-` inside first 512 bytes → modern path; empty/short file does not throw.
- `apps/bridge-agent/src/thumbnailer-native-ps.test.ts` (or a case in `thumbnailer-hires.test.ts`): `generateThumbnail` on a native-PS `.ai` rejects with `no_pdf_compat` and does not call sharp (spy/mock).
- Recheck routine: unit test with a fake API — native-PS ignore entries are unmarked, modern ones are kept, `pdf_sibling` entries are never touched, a path escaping the root is refused.
- agent-api `unmark-ai-ignored`: extract its body into `supabase/functions/_shared/mark-ai-ignored.ts` (beside `markAiIgnored`) and test it deletes only `reason = 'no_pdf_compat'` rows for the exact path.
Must stay green: `npm test --prefix apps/bridge-agent`, `npm test --prefix apps/windows-agent`, root `npm test`, `npm run typecheck`, `npm run lint`.

## 11. Constraints and gotchas

- Feature branch + PR to protected `main`; the AI merges after required checks; reviews are advisory.
- `apps/*/src/common/` is a generated copy of `packages/agent-common/src` — never edit it.
- `.eps` files start with `%!PS-Adobe-` too; never route EPS through the AI pre-check.
- Path containment: every NAS path read goes through `resolveUnderRoot` (#229).
- The bridge is the only render scheduler (#1094); do not queue renders from agent-api.
- No schema change; if one seems necessary, it goes through `popcre/shared-db` (load `shared-db-change`), never an app-repo migration.
- `scanner_ai_ignores` deletes must be one row per path with the exact reason; never bulk-delete the table.
- Quote times in EST.

## 12. Access and environment

- `gh` authenticated as `u2giants` for repo, PRs, releases.
- Read-only SQL: Supabase MCP or `psql` with the Supabase access token from 1Password vault `vibe_coding` (search "Supabase access token"); never paste values.
- Local tests: `npm ci` at root and `npm ci --prefix apps/bridge-agent`, then the commands in §10. No NAS needed for unit tests.
- Live proof needs the deployed bridge on the NAS and the Windows render agent online (Settings → Agents in the web UI shows heartbeats).

## 13. Definition of done, risks, open questions

Done when: steps 2–6 merged on `main`, CI green, bridge released and running the new version (heartbeat version in Settings → Agents), recovery routine ran once with counts posted, live proof posted on #755, #755 closed.

Risks and rollback:
- More files reach Windows → render queue grows. Bounded by the number of recovered files (step 1/6 counts). If Windows falls behind, that is throughput, not breakage.
- A native-PS file Ghostscript cannot render ends at `no_preview_or_render_failed` after `MAX_RENDER_ATTEMPTS` — acceptable and visible.
- Rollback: revert the PR and redeploy the previous bridge `:stable`; recovered ignore rows can be re-marked by the old bridge automatically on its next scan.

Open: none requiring the owner.

## Self-audit (2026-11-25)

1. Fresh session could execute without asking? Yes — §2 explains every component, §5 gives exact current lines, §9 names every file and gate, §12 gives access.
2. Carries all background incl. rejected options? Yes — §3 (trigger, lost findings 2–4), §6 root cause, §7 three rejected approaches.
3. Goal clear enough for judgment calls? Yes — §1 states the business outcome and the two invariants (placeholders still skipped, EPS unchanged).
Checklist: all 13 sections present; steps marked lead-only/helper-ok with stop-and-ask triggers; no trust-boundary parser is added beyond a 512-byte header check (adversarial cases covered in §10: short file, PS+PDF header, path escape); locked/open labelled; out-of-scope listed; secrets by location only; handoff linked both ways.

## Lead launch prompt

```text
You are the lead implementing u2giants/popdam3#755. Read AGENTS.md, then docs/plans/issue-755-native-postscript-ai-previews.md (STATUS first). Work in a fresh git worktree on a feature branch from origin/main.
Do yourself (lead-only): steps 1, 3, 6, 7, 8 and verification of every helper step.
Hand to your helper, in order: step 2, then 4 and 5 (parallel). Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, no posts; when a step's stop-and-ask trigger fires, bring it to you; if stuck 30 minutes you take the step back.
You run the checks yourself: bridge, windows-agent and root test suites, typecheck, lint, CI on the PR, then the live proof in step 8. Update the STATUS table as steps land. Sign GitHub posts with the session signature.
```
