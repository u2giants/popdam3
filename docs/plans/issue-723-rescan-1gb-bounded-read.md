# Plan: Review finding: u2giants/popdam3#718 fix(windows-agent): let the Indra rescan read PDFs up to 1 GB (#680) (u2giants/popdam3#723)
Issue: https://github.com/u2giants/popdam3/issues/723
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Confirm the finding is still open on `main` | ⬜ open | Checked 2026-11-04 4:45 PM EST: `main` (4409e2d3) still has the 100 MB rescan limit at `apps/windows-agent/src/pdf-backfill.ts:269-274`; PR #718 is OPEN, unmerged, reviewer verdict REVISE |
| 1 | Branch from `main`, carry PR #718's two-line change onto it | ✅ landed | #718 merged as `4970cdeb`, Nov 4, 5:34 PM EST; branch from `main`, skip this step |
| 2 | Pure policy module `apps/windows-agent/src/pdf-rescan-policy.ts` (limit, per-file outcome, batch-stop rule) | ⬜ open | |
| 3 | Rescan reads through `readFileWithinLimit` (bounded), never blind `readFile` | ⬜ open | |
| 4 | All-failed batch rule ignores per-file size skips (no stall) | ⬜ open | |
| 5 | Memory telemetry on large files (`rss_mb`) | ⬜ open | |
| 6 | Tests added and wired into `apps/windows-agent/package.json` test list | ⬜ open | |
| 7 | Docs: `docs/WORKER_LOGIC.md` size guard + rescan section | ⬜ open | |
| 8 | PR, CI green, merge, Windows agent published and self-updated | ⬜ open | |
| 9 | Live proof on the 792 MB file, then requeue the 192 oversized rows; close #723 and tick the #680 checklist | ⬜ open | |

Where a fresh session starts: Step 0 (re-verify, because PR #718 or a fixer bot may have moved first), then Step 1.

**Correction (verified on `origin/main` `e037dd7a` (Nov 4, 2026, 6:05 PM EST)):** PR #718 was merged unrevised, and "Publish Windows Agent" succeeded for `4970cdeb`. So the 1 GiB limit and `file_over_1gb` are on `main` and the blind read (`pdf-backfill.ts:275`) and all-failed rule (`:379`) may already be running on the render PC. This raises the priority: both review findings are now live risks, not hazards to avoid before merging. Before starting, read the agent's reported version and whether any `file_over_100mb` rows were requeued; if they were, the Step 9 counts change. Do not requeue until Step 4 is deployed. §5's PR #718 paragraph, Step 8's "supersedes #718, close #718" and §13's "#718 closed as superseded" no longer apply. §7's "merging #718 as-is" was rejected here but happened. Step 3's replacement range is now `:269-275`, and the constant moves from `pdf-backfill.ts:247`.

---

## 1. The ultimate goal

Every licensing sheet and tech pack on the NAS should have its text read by the Indra rescan so designers, files-used and search tags come from the real sheet. Today 192 live PDFs between 100 MB and 792 MB are skipped outright, and 162 of them have no other good sheet for their product, so those products have no readable sheet at all. When this is done, the Windows agent reads those files safely (no out-of-memory crash on the render PC), records a clear per-file outcome for anything still too big, and never gets stuck re-claiming the same batch forever.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular: never trade "the agent stays up" for "more files read"; a crash loses every file in the run, a size skip loses one.

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed consumer-product art. Design files live on a Synology NAS; agents read them and the web UI (https://dam.designflow.app) lets staff browse, search and tag. Repo: `u2giants/popdam3`, default branch `main`. This plan touches only the **Windows render agent** (`apps/windows-agent/`, Node 20 + TypeScript, runs as the `PopDAMWindowsAgent` service on the render PC with the NAS mapped as a drive) and the shared agent source in `packages/agent-common/` (copied into each agent's `src/common/` by `packages/agent-common/sync.mjs` before build/test; `apps/*/src/common/` is git-ignored). Server side (Supabase edge function `agent-api`, project `qsllyeztdwjgirsysgai`) and the DB function `commit_pdf_rescan_batch` (canonical repo `popcre/shared-db`) are read for context only; nothing there changes.

## 3. What triggered this work

The Indra rescan (PDF re-OCR of the whole library, `admin_config.PDF_BACKFILL.mode = "indra_rescan"`, parent issue #680) skipped 192 live PDFs with `indra_rescan_error = 'file_over_100mb'` (investigation comment on #680, 11:15 AM EST Nov 4: "Over the 100 MB limit: 192. Files exist, up to 792 MB. Only 30 have another good sheet, so this is the largest gap."). PR #718 (branch `claude/youthful-euler-5e3545`, head `cca24917`) raised the rescan limit to 1 GiB by changing two lines. The advisory AI review (DeepSeek, run 41915503551) returned REVISE with these findings, which this issue carries:

1. The rescan still does a blind `readFile(fullPath)` into mupdf, while `packages/agent-common/src/bounded-read.ts:1-11` documents the policy "never readFile() art files blindly" and `renderer.ts:284-288` follows it. A 1 GiB whole-file read has no validated memory bound on the agent host.
2. `pdf-backfill.ts:378-382` stops the batch without committing when **every** result has `extraction_error`. A batch made only of oversized files therefore never commits, and because uncommitted rows are re-claimed (claim order is `a.id`), the loop re-claims the same ten files on every heartbeat.
3. `docs/WORKER_LOGIC.md:247-249` documents only the 100 MB normal-path guard; the rescan section (`268-276`) records no rescan limit.

Reproduce (read-only): in production `pdf_text_samples`, count rows with `indra_rescan_error = 'file_over_100mb'` (192 at last check).

## 4. Scope

In: the rescan path only (`processOneForRescan` and the batch rule in `runPdfBackfill`), its tests, its docs, publishing the agent, requeueing the skipped rows, and live proof.

**NOT in this plan:**
- Raising the **normal** backfill limit (`PDF_SIZE_LIMIT_BYTES`, `pdf-backfill.ts:26`, used by `processOne` at `:44`) — the normal path runs the full engine cascade (mupdf text, OCR, AI vision) on one page and was not part of #718.
- The 438 "not at recorded path" rescan failures and the 4 zero-byte files from the same #680 comment.
- The bridge agent (`apps/bridge-agent`); the rescan never runs there (`supabase/functions/agent-api/index.ts:841`).
- Any change to `commit_pdf_rescan_batch`, `claim_pdf_rescan_batch` or any table (shared-db territory).
- Changing `RESCAN_MAX_PAGES` (12) or `RESCAN_MAX_RENDER_PX` (4000).
- Streaming or page-at-a-time parsing in mupdf: mupdf.js (`mupdf ^1.26.0`, WebAssembly) only opens documents from an in-memory buffer; there is no file-handle mode. Rejected approach, see §7.

## 5. Current state of the code (verified on `origin/main` @ 4409e2d3, 2026-11-04 4:45 PM EST)

- `apps/windows-agent/src/pdf-backfill.ts:15` imports `readFile, stat` from `node:fs/promises`; `:26` `PDF_SIZE_LIMIT_BYTES = 100 * 1024 * 1024`.
- Rescan: `:246-248` constants (`RESCAN_MAX_PAGES = 12`, `RESCAN_MAX_RENDER_PX = 4000`, `RESCAN_BATCH_PAUSE_MS = 2_000`); `processOneForRescan` at `:254-309`; size check `:268-271` returns `extraction_error: "file_over_100mb"`; blind read `:274` `mupdf.Document.openDocument(await readFile(fullPath), "application/pdf")`; pages rendered `:279-288`; thumbnail `:293-305`; Indra OCR `:307`.
- Batch loop `runPdfBackfill` at `:313-401`; per-file try/catch `:351-373` turns a thrown error into `extraction_method: "failed"` + `extraction_error`; the all-failed rule `:376-382` (`isRescan && results.length > 1 && results.every(r => r.extraction_error)` → log, report `batch_failed`, `break` without commit).
- Bounded helper: `packages/agent-common/src/bounded-read.ts:17-29` `readFileWithinLimit(filePath, maxBytes = 100 MiB): Promise<Buffer | null>` — stats through one handle, returns `null` without reading when over the cap. Tests in `packages/agent-common/src/bounded-read.test.ts` (3 cases). Used by `apps/windows-agent/src/renderer.ts:39` (import from `./common/bounded-read.js`) and `:286`.
- Server: `supabase/functions/agent-api/index.ts:4111-4126` `completePdfRescanBatch` maps `extraction_error` → `error` and calls RPC `commit_pdf_rescan_batch`. In `shared-db/supabase/migrations/20261103142609_pdf_indra_rescan.sql:179` an error makes the outcome `failed`, and `:214-216` sets `indra_rescan_at = now()` and `indra_rescan_error`. Claim (`:101-106`, `:112-116`) excludes rows whose `indra_rescan_at IS NOT NULL`. So a **committed** failure is not re-claimed; only an **uncommitted** batch is.
- Tests: `apps/windows-agent/package.json:10` lists test files explicitly (`tsx --test src/...test.ts ...`); a new test file is **not** picked up unless added to that line. No test covers `pdf-backfill.ts` today.
- Docs: `docs/WORKER_LOGIC.md:247-249` ("File size guard", 100 MB), `:264` (`skipped` = "File > 100 MB size limit"), `:268-276` (Indra rescan section, no size limit mentioned).
- PR #718 state: OPEN, head `cca24917`, one file changed (`pdf-backfill.ts`: adds `RESCAN_SIZE_LIMIT_BYTES = 1024 * 1024 * 1024` after `RESCAN_MAX_PAGES`, uses it at the size check, error string `file_over_1gb`). CI `lint-test-build` SUCCESS. Nothing from it is on `main`. No fixer-bot PR exists for #723 (checked `gh pr list --search 723`).
- Agent version `apps/windows-agent/package.json:3` is `0.17.0`; the publish workflow appends the run number and updates the `WINDOWS_LATEST_BUILD` pointer (`.github/workflows/publish-windows-agent.yml:494-538`), and the agent self-updates within 10 minutes (`docs/WINDOWS_AGENT_RUNBOOK.md:205-219`).

## 6. Key findings and root cause

- The limit is not the only risk: a `Buffer` of the file (off the V8 heap) **plus** mupdf's own copy inside its WebAssembly memory, plus up to 12 pixmaps at up to 4000 px (48 MB raw each) and their PNGs. For the 792 MB file that is roughly 1.6 GB before rendering. No one has measured the render PC's free RAM or the agent's peak RSS on such a file; §9 Step 5 adds the measurement and §13 gives the decision rule.
- The stall is real but narrow: it needs a claimed batch of 10 consecutive-by-id files that **all** fail. In the first pass that is unlikely; in the planned **requeue of the 192 oversized rows** it becomes likely (the requeued set is oversized by construction), so the batch rule must be fixed **before** the requeue.
- `readFileWithinLimit` already does the stat-and-refuse in one handle; keeping a separate `stat()` guard before it is harmless but the helper's `null` is the authoritative signal (it also covers a file that grows between stat and read).
- The error string is stored verbatim in `indra_rescan_error`; the earlier analysis counted `file_over_100mb`. Changing it to `file_over_1gb` is intended (different limit), but the requeue query in Step 9 must target the **old** string.

## 7. Approaches considered and rejected

- **Page-at-a-time / streamed parsing** — mupdf.js has no file-handle open; `Document.openDocument` takes a buffer. Rejected.
- **Spawning Indra's Python directly on the PDF** — Indra OCRs PNGs (`packages/agent-common/src/indra-ocr.ts`); rasterising still needs mupdf. Rejected.
- **Keeping 100 MB and asking for re-exports** — 192 files, 162 without another sheet; re-export is human work and the files are valid. Rejected by the #680 investigation ("raise the agent size limit").
- **Committing a whole-failed batch anyway** — would hide a share or Indra outage as ten `failed` rows. Rejected; only *per-file* outcomes (size skip) are excluded from the stop rule.
- **Merging PR #718 as-is and fixing later** — the review's point 2 becomes certain during the requeue. Rejected; land the bounded read and the batch rule together.

## 8. Design decisions

- **LOCKED** 2026-11-04: rescan limit is 1 GiB (`1024 * 1024 * 1024`), constant name `RESCAN_SIZE_LIMIT_BYTES`, error string `file_over_1gb` (from PR #718).
- **LOCKED**: the rescan reads through `readFileWithinLimit(fullPath, RESCAN_SIZE_LIMIT_BYTES)`; no `readFile` call remains in `processOneForRescan`.
- **LOCKED**: a size skip is a *per-file outcome* and is committed (so the row gets `indra_rescan_outcome = 'failed'`, `indra_rescan_error = 'file_over_1gb'`, `indra_rescan_at` set, and is never re-claimed). The all-failed stop rule counts only results that are **not** per-file outcomes.
- **LOCKED**: no change to the normal backfill limit.
- **OPEN** (implementer decides with the rule in §13): whether 1 GiB survives the memory measurement. If peak RSS on the 792 MB file exceeds 75% of the render PC's physical RAM, or the process is killed, lower `RESCAN_SIZE_LIMIT_BYTES` to the largest size class that fits (the #680 data shows sizes "100-792 MB"; pick the cap from the measured peak-RSS-to-file-size ratio) and record the number in the PR and on #680.
- **OPEN**: whether a `pdf_text_samples` zero-byte file (`stat.size === 0`) should also be a per-file outcome. Reasonable to include (`file_empty`); not required for this issue.

## 9. The plan

Branch: `claude/723-rescan-bounded-read` from `origin/main`. Run every command from the worktree root. Declare the task class with `ai-task-gates` (code) before editing; recheck before the `production` step (Step 9).

**Step 1 — carry PR #718 onto the branch.** Apply the two-line diff (`gh pr diff 718`): add `RESCAN_SIZE_LIMIT_BYTES` and use it at the check in `processOneForRescan`; error string `file_over_1gb`. Do not merge the PR branch itself (it is behind `main`). Gate: `git diff origin/main -- apps/windows-agent/src/pdf-backfill.ts` shows exactly those lines.

**Step 2 — pure policy module.** Create `apps/windows-agent/src/pdf-rescan-policy.ts` exporting:
- `RESCAN_SIZE_LIMIT_BYTES` (moved from `pdf-backfill.ts`).
- `RESCAN_SIZE_ERROR = "file_over_1gb"`.
- `isPerFileRescanOutcome(error: string | null | undefined): boolean` — true for `file_over_1gb` (and `file_empty` if the OPEN decision above is taken).
- `rescanBatchShouldStop(results: Array<{ extraction_error: string | null }>): boolean` — true only when `results.length > 1`, every result has an error, **and none** of those errors is a per-file outcome. (Intent: a batch of ten oversized files commits; a batch of ten "share unreachable" errors stops. A mixed batch — nine oversized, one real failure — commits, because the real failure is recorded with its message and can be rerun by clearing `indra_rescan_at`; that is cheaper than stalling.)
Keep it free of imports from `api-client`, `logger`, or mupdf so the test can load it without environment. Gate: `npx tsc --noEmit -p apps/windows-agent` passes.

**Step 3 — bounded read.** In `pdf-backfill.ts`: import `readFileWithinLimit` from `./common/bounded-read.js` (same form as `renderer.ts:39`; the file exists after `sync.mjs` runs, which `pretest`/`prebuild` do). Replace `:268-274` with: `const buffer = await readFileWithinLimit(fullPath, RESCAN_SIZE_LIMIT_BYTES); if (!buffer) return { ...base, extracted_text: null, page_count: null, char_count: 0, extraction_error: RESCAN_SIZE_ERROR };` then `mupdf.Document.openDocument(buffer, "application/pdf")`. Drop `readFile` from the import only if `processOne` (`:57`) still needs it — it does, so keep the import. Gate: `grep -n "readFile(" apps/windows-agent/src/pdf-backfill.ts` shows only the `processOne` call at `:57`.

**Step 4 — batch rule.** Replace the condition at `:378` with `if (isRescan && rescanBatchShouldStop(results))`. Keep the log and `batch_failed` report. Gate: unit test in Step 6 (`rescan batch of only oversized files commits`).

**Step 5 — memory telemetry.** In `processOneForRescan`, after the pixmaps are rendered and before OCR, when `buffer.length > PDF_SIZE_LIMIT_BYTES`, log `logger.info("PDF rescan: large file", { filename, size_mb, pages: numPages, rss_mb: Math.round(process.memoryUsage().rss / 1048576) })`. This is the number the live proof reads. Gate: the log line appears in `%ProgramData%\PopDAM\logs\` for the 792 MB file during Step 9.

**Step 6 — tests.** Create `apps/windows-agent/src/pdf-rescan-policy.test.ts` (node:test + node:assert/strict, like `claim-gate.test.ts`) and add it to the `test` script in `apps/windows-agent/package.json:10` (the list is explicit; forgetting this makes CI silently skip the file). Tests are named in §10. Gate: `npm test --prefix apps/windows-agent` passes locally and the new test names appear in its output.

**Step 7 — docs.** `docs/WORKER_LOGIC.md`: in "File size guard" (`:247-249`) add one sentence: the Indra rescan uses its own 1 GB limit through the bounded reader and records `file_over_1gb`; in the rescan section (`:272`) add: a size skip is a committed per-file failure, and the "whole failed batch stops" rule ignores size skips. Gate: `grep -n "file_over_1gb" docs/WORKER_LOGIC.md` returns both places.

**Step 8 — land it.** Commit (identity per `git var GIT_COMMITTER_IDENT`), push, open the PR with `Refs #680, closes #723` (and note it supersedes #718; close #718 with a comment pointing here, signed with `$AI_GH_SIGNATURE`). Wait with `bin/ai-pr-wait <pr>` in the background. Merge (the AI merges; Albert does not). Then confirm the "Publish Windows Agent" run exists for the merge commit (`gh run list --workflow publish-windows-agent.yml`); if none appears, dispatch it manually (`docs/WINDOWS_AGENT_RUNBOOK.md` row 21). Gate: `admin_config.WINDOWS_LATEST_BUILD.version` matches the new build and the agent's heartbeat in `agent_registrations` reports that version within 10 minutes.

**Step 9 — live proof and requeue (class `production`; read-only by default, so recheck `ai-task-gates` first).** Order matters:
1. Pick the 792 MB file (largest `file_size` among rows with `indra_rescan_error = 'file_over_100mb'`). Clear `indra_rescan_at` on **that one row only** (application data write through the same path the #680 session used; never a schema change). With the rescan mode active and status `running`, the agent claims it on the next heartbeat.
2. Read the agent log for `PDF rescan: large file` with `rss_mb`, and the row's new `indra_rescan_outcome` (`replaced` or `kept_existing`, not `failed`). Apply the §13 rule to `rss_mb`.
3. Only then clear `indra_rescan_at` on the remaining rows with `indra_rescan_error = 'file_over_100mb'` (191). Do **not** press Start; the running mode picks them up.
4. Post the evidence on #680 and #723 (counts before/after, the `rss_mb`, the deployed build), tick `- [ ] live proof` on #680, close #723. Leave the checklist item open if any part is unproven.

Phases: Steps 1-7 are one session; Step 8 waits on CI and publish; Step 9 is a natural cut point (re-read §9 and §13 before starting it).

### Adversarial cases (trust boundary: files from the NAS)

| Input | Hostile case | Test |
|---|---|---|
| File size exactly at the cap | 1 GiB exactly must be read (helper uses `>`) | `readFileWithinLimit returns contents at or under the cap` (exists, bounded-read.test.ts) |
| File one byte over the cap | returns `file_over_1gb`, no buffer allocated | `rescan refuses a file over the limit without reading it` (new; use a sparse/temp file and a 16-byte cap passed in via a parameter of a thin wrapper, or test the policy constant plus the helper) |
| File grows between stat and read | helper stats through the open handle; no second stat | covered by using the helper only (no test; cite code) |
| Batch of 10 oversized files | commits; outcome `failed` per row; no stall | `rescan batch of only oversized files commits` |
| Batch of 10 share-unreachable errors | stops without commit | `rescan batch of only infrastructure failures stops` |
| Mixed batch (oversized + one real failure) | commits | `rescan batch with one real failure among size skips commits` |
| Single-file batch that fails | commits (`results.length > 1` guard unchanged) | `rescan single failed file commits` |
| 0-byte file | mupdf throws → per-file `failed` with message (or `file_empty` if OPEN decision taken) | `rescan empty file is a per-file outcome` (only if taken) |

## 10. Tests required

New `apps/windows-agent/src/pdf-rescan-policy.test.ts`:
- `rescan batch of only oversized files commits`
- `rescan batch of only infrastructure failures stops`
- `rescan batch with one real failure among size skips commits`
- `rescan single failed file commits`
- `rescan refuses a file over the limit without reading it` (exercise `readFileWithinLimit` with `RESCAN_SIZE_LIMIT_BYTES` semantics on a small temp file and a small cap, asserting `null` and no exception)

Existing suites that must stay green: `npm test --prefix apps/windows-agent` (includes `packages/agent-common/src/bounded-read.test.ts`), and root CI (`.github/workflows/ci.yml`: `npm ci && npm run lint && npm run typecheck && npm run test`; worker and windows-agent jobs; `npm run build`).

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`; the AI merges. Reviews are advisory and never block; required checks are lean.
- No DB schema changes here; anything in `commit_pdf_rescan_batch`/`claim_pdf_rescan_batch` lives in `popcre/shared-db` (claim-first on the existing issue, load `shared-db-change`). Production DB is read-only by default; the row writes in Step 9 are application data on the existing rescan path and need the `production` gate declared.
- `apps/*/src/common/` is generated by `packages/agent-common/sync.mjs` and git-ignored; edit `packages/agent-common/src/` if the helper itself must change (it must not here).
- The windows-agent test list is explicit in `package.json`; add the new test file there.
- No `sleep` loops; wait on CI with `bin/ai-pr-wait <pr>` in the background.
- Never report a stall after 30 minutes without progress — reroute.
- Times to humans in EST; sign GitHub posts with `$AI_GH_SIGNATURE`.
- The #680 comment of 11:15 AM EST Nov 4 says an agent update was "currently barred". Before Step 8, read the latest #680 comments and `docs/owner-rulings.md` in `ai-devops`; if a bar on agent updates is still in force, stop at the merged PR and report `Blocked —` with the exact ruling, do not publish.
- The agent must never crash out of `runPdfBackfill` (`pdf-backfill.ts:11`); keep every new throw inside the per-file try/catch.
- Never quote a secret; the `WINDOWS_LATEST_BUILD` pointer and agent logs contain none, but the NAS login in `admin_config` does — never print `admin_config` rows wholesale.

## 12. Access and environment

- Machine: hetz (production VPS). `gh` authenticated as `u2giants`; Supabase MCP targets project `qsllyeztdwjgirsysgai` (Virginia; the default MCP may point at the old Ohio project — verify the project ref before any query). Railway is not involved.
- Local checks: `npm ci --prefix apps/windows-agent && npm test --prefix apps/windows-agent` (runs `sync.mjs` first). mupdf is not installed in this checkout (`apps/windows-agent/node_modules` absent), which is why the policy module is pure.
- Render PC: service `PopDAMWindowsAgent`; logs under `%ProgramData%\PopDAM\logs\`; the AI reads them through the agent's heartbeat/log upload or the Windows session documented in `docs/WINDOWS_AGENT_RUNBOOK.md` (do not ask Albert to open anything).
- Secrets: 1Password vault `vibe_coding` (NAS service login item, Supabase service role item) — by title only, never values.

## 13. Definition of done, risks, open questions

Done when: code + tests on the branch; PR merged to `main`; CI green; "Publish Windows Agent" run succeeded and the agent heartbeat shows the new version; the 792 MB file's row shows a non-`failed` outcome; the remaining 191 rows requeued and the running rescan has committed batches containing them (spot-check 3 rows with `indra_rescan_at` after the requeue time); `docs/WORKER_LOGIC.md` updated; #718 closed as superseded; #723 closed with the evidence; `- [ ] live proof` ticked on #680; the HANDOFF.d entry updated.

Risks and rollback: an out-of-memory kill on the render PC — the service restarts (NSSM) and the batch is uncommitted, so the same files are re-claimed; that is the stall this plan removes, so if the kill repeats, set `PDF_BACKFILL.status = "paused"` and lower the cap (OPEN decision) in a follow-up PR. Rollback of the agent is re-pointing `WINDOWS_LATEST_BUILD` at the previous release zip and checksum (runbook §7).

Decision rule for the OPEN memory question: `rss_mb` on the 792 MB file ≤ 75% of the render PC's physical RAM (read it from the heartbeat's system info or the Windows session) → keep 1 GiB. Otherwise cap = floor(0.75 × RAM / (rss_mb / 792)) MB rounded down to the nearest 64 MB, and say so on #680.

Open: whether the "agent update barred" note on #680 is still in force (see §11); whether `file_empty` is added (§8).

## Self-audit

1. **Could a brand-new session execute this without asking?** Yes. §5 gives every file:line on `origin/main`, §9 gives the branch name, exact replacements, the test-list gotcha, the publish and requeue order, and §12 the tooling; §13 gives the decision rule for the only measurement-dependent choice.
2. **Does it carry every piece of background and what was ruled out?** Yes. §3 reproduces the review verbatim in substance, §6 explains why the stall becomes likely at requeue time and the double-copy memory behaviour of mupdf.js, §7 lists the five rejected routes with reasons, §8 separates LOCKED from OPEN.
3. **Is the goal clear enough to steer by when a step is wrong?** Yes. §1 states the business outcome (162 products with no readable sheet) and the tie-breaker (agent stability over file count), and §13 turns it into a numeric rule.

Self-audit passed; no gaps found after the second pass.
