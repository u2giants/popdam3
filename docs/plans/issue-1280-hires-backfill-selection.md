---
summary: Issues #1280/#1282 plan: hi-res backfill must finish instead of re-selecting files forever. Read its STATUS first.
kind: plan
status: open
read-when: implementing #1280/#1282, or changing hi-res backfill selection in agent-api check-changed, ingest width/height, or render completion
---

# Plan: Make the hi-res backfill finish instead of looping (u2giants/popdam3#1280, covers #1282)

Issues: https://github.com/u2giants/popdam3/issues/1280 (review finding on merged PR #1279) and its folded duplicate https://github.com/u2giants/popdam3/issues/1282 (review finding on merged PR #1281; closed into #1280). Parent feature: #1272.
Handoff: [HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md](../../HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md)
Written 2026-11-25 (about 4:00 PM EST) by Claude. Plan only. Code references are to `origin/main` at `787c20b8`.

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Measure the backlog (read-only SQL) | ⬜ open | |
| 2 | Extract the backfill selection into a tested `_shared` module | ⬜ open | selection is inline in `handleCheckChanged`, `supabase/functions/agent-api/index.ts:2586-2650` |
| 3 | "No larger rendition" is recorded as done (`hires_url = thumbnail_url`) | ⬜ open | ingest `index.ts:1120,1237,1303,1403`; complete-render `index.ts:2224` |
| 4 | Ingest never overwrites a known size with 0 | ⬜ open | `index.ts:1123-1124` (`?? 0`) and `updateFields` `:1336-1337` |
| 5 | Windows completion records the rendered size | ⬜ open | `apps/windows-agent/src/api-client.ts:166-180`, `index.ts:592`, `handleCompleteRender` `agent-api/index.ts:2195` |
| 6 | Skip-rule files never take backfill slots | ⬜ open | bridge pre-ingest skips `apps/bridge-agent/src/index.ts:1188-1230` |
| 7 | Rows with a thumbnail error drop out of backfill | ⬜ open | predicate `index.ts:2637-2645` ignores `thumbnail_error` |
| 8 | Tests (§10), PR, CI, merge, bridge + Windows releases | ⬜ open | |
| 9 | Live proof: backlog shrinks scan over scan; close #1280 | ⬜ open | `- [ ] live proof` stays on #1280 |

Finding 2's sub-claim "Windows never uploads hi-res for PSD/AI" is **already fixed** by #1284 (`apps/windows-agent/src/index.ts:567-571` uploads `result.hiresBuffer` for every type); the size-zeroing part is not (step 4–5).

**Where a fresh session starts:** Step 1.

---

## 1. The ultimate goal

The AI tagger reads a larger picture ("hi-res rendition", up to 1500 px) when one exists, which tags artwork more accurately than the 800 px thumbnail (#1272). Older assets predate it, so every NAS scan re-renders up to 10 unchanged assets per batch to backfill one. Done means: **every asset gets processed once and then leaves the backlog** — whether it got a larger picture, has no larger source, is rendered on Windows, or cannot be rendered — so the backlog actually shrinks to zero, no asset blocks others, and no asset loses its recorded image size along the way. AI tagging results only improve; nothing a user sees changes.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`https://dam.designflow.app`) is POP Creations' internal Digital Asset Manager for licensed product art on a Synology NAS.
- **NAS bridge agent** (`apps/bridge-agent/`): scans the NAS, sends each chunk of files to agent-api `check-changed`, which answers `changed` (re-ingest), `needs_thumbnail` (re-render unchanged files), `existing_thumbnails` (reuse the stored thumbnail file name). The bridge renders locally (sharp/mupdf) via `encodeRenditions` (`apps/bridge-agent/src/thumbnailer.ts:52-72`), uploads thumbnail and hi-res (`uploader.ts:77-83`, key `hires/<assetId>.jpg`) and calls `ingest`. Files it cannot render, or that `shouldDeferToWindows` (`index.ts:758`) routes to Windows, are queued as render jobs.
- **Windows render agent** (`apps/windows-agent/`): renders queued jobs and calls `complete-render` with thumbnail and hi-res URLs.
- **agent-api** (`supabase/functions/agent-api/index.ts`, Supabase edge function): `handleCheckChanged` (`:2497`), `handleIngest` (around `:1100-1410`), `handleCompleteRender` (`:2195`).
- **Worker** (`apps/worker/src/handlers/ai-tagging.ts:218-220`): `taggingImageUrl = hires_url || thumbnail_url`.
Repo `u2giants/popdam3`, protected `main`. Edge functions deploy via `deploy-supabase.yml`; bridge via `publish-bridge-agent.yml` (`:stable` + version bump, NAS applies on request); Windows agent via GitHub Release.

## 3. What triggered this work

PR #1279 (merged 2026-11-23) added the backfill; PR #1281 (merged 2026-11-23) widened it to rows with unrecorded size. Advisory reviews (ai-review run 45225843191; fixer run 45226215229 confirmed all three; #1282 from PR #1281 added the fourth point):
1. **Endless re-render + starvation.** Selected: `thumbnail_url && !hires_url && quick_hash && (size unknown || max(width,height) >= 800)`, first 10 per check-changed batch in request order (`index.ts:2637-2649`). The bridge emits a hi-res only when it is larger than the thumbnail (`thumbnailer.ts:71`), so any source not larger than the 800 px thumbnail (for example exactly 800 px) keeps `hires_url` null and is re-selected every scan. Files the bridge skips before ingest (older than `scan_min_date`, in the `.ai` ignore list, `.ai` with a PDF sibling, `.ai` placeholder — `apps/bridge-agent/src/index.ts:1188-1230`) also stay selected; ten of them in a chunk take every slot forever and starve the rest.
2. **Windows-deferred / locally unrenderable PSD/AI.** Re-processing sends them to Windows; ingest writes `width: 0, height: 0` over the stored size (`index.ts:1123-1124` defaults missing to 0, written at `:1336-1337`) and queues a Windows job; Windows completion does not restore size.
3. **No tests** for the selection rules.
4. (#1282) Windows-deferred or locally failing rows never clear the predicate (size now 0 = "unknown" → always eligible) and are re-selected every scan.

## 4. Scope

In: selection rules; marking "processed, no larger source"; size preservation at ingest; size reporting from Windows; keeping skip-rule files out of slots; failure exit; tests; releases; live proof.
NOT in this plan: changing the hi-res size (1500 px) or the 10-per-batch cap; a schema change (see §7); re-tagging assets after they receive a hi-res (separate decision under #1272); PDFs' page-image logic (already sets hi-res from page 1).

## 5. Current state

- Selection `agent-api/index.ts:2586-2650` (quoted in §3). Bridge receives `needs_thumbnail` and `existing_thumbnails` (`apps/bridge-agent/src/index.ts:1132-1165`) and processes "thumb retry" files through `processFile`.
- Ingest: `hiresUrl = optionalString(body,"hires_url") || null` (`:1120`); a new thumbnail always replaces `hires_url` (`:1237` move path, `:1303` existing path, `:1403` insert) — "a stale hi-res copy never outlives the thumbnail it matched".
- Complete-render `saveThumbnail` writes `hires_url: optionalString(body,"hires_url") || null` (`:2224`); no width/height.
- Windows `RenderResult` already carries `width`, `height`, `hiresBuffer` (`apps/windows-agent/src/renderer.ts:58-66`), but `api.completeRender` sends only URLs (`apps/windows-agent/src/api-client.ts:166-180`).
- No code deletes `hires/` objects from storage (grep 2026-11-25), so pointing `hires_url` at the thumbnail URL is safe.
- No unit tests exist for `handleCheckChanged`; the pattern for testable agent-api logic is a `_shared` module with a test (e.g. `supabase/functions/_shared/dam-render-completion.ts` + `.test.ts`).

## 6. Key findings and root cause

Root cause: "needs backfill" is inferred from `hires_url IS NULL`, but `NULL` means three different things — "never tried", "tried, source is no bigger", and "tried, could not render / skipped". Only the first should be selected. Two fixes make NULL mean only "never tried": record a successful render with no larger source as `hires_url = thumbnail_url` (the best tagging image *is* the thumbnail — which is exactly what the tagger already falls back to), and exclude rows that carry a `thumbnail_error`. Skip-rule files never reach ingest at all, so the server cannot learn about them from ingest; the bridge must tell it at check-changed time.

The 800 threshold itself is right: the thumbnail is capped at 800 px, so a stored 800 px edge means "source ≥ 800", indistinguishable between exactly-800 and larger; only an attempt can tell — and the attempt's result must then be recorded (fix above).

## 7. Approaches rejected

- **A new column (`hires_checked_at` or similar).** Clean, but a shared-db structural change (`popcre/shared-db`, preview rehearsal) for a state the existing columns can express. Revisit only if `hires_url = thumbnail_url` proves confusing to a consumer (none today besides `taggingImageUrl`).
- **Change `>= 800` to `> 800`.** Thumbnails never exceed 800, so this would select nothing.
- **Rotate selection order per scan (hash of path + date).** Ends starvation but keeps wasting renders on files that never complete.
- **Bridge drops skip-rule files from the check-changed payload.** That payload also drives move detection and content identities (`existing_content_identities`); removing files there changes unrelated behaviour.

## 8. Design decisions

Locked (2026-11-25):
- `hires_url = thumbnail_url` whenever a successful render supplies a thumbnail but no larger rendition (bridge ingest and Windows completion alike). Comment it at each write: "no larger source: the thumbnail is the best tagging image (#1280)".
- Backfill predicate adds `!existing.thumbnail_error` and `f.hires_backfill_eligible !== false`.
- The bridge adds `hires_backfill_eligible: false` to a check-changed payload entry when its cheap pre-ingest rules would skip the file: `modifiedAt < scan_min_date`, or `.ai` path in `aiIgnoreSet`. (PDF-sibling and placeholder `.ai` files get added to the ignore list the first time `processFile` sees them, so they become ineligible from the next scan.) Old bridges omit the field → today's behaviour.
- Ingest writes `width`/`height` only when both are > 0.
- Windows `complete-render` sends `width`/`height`; agent-api writes them only when both are > 0.
Open: none.

## 9. The plan

One phase; fits one session.

**Step 1 — Measure (lead-only: production read).**
```sql
select
  case when coalesce(width,0)=0 or coalesce(height,0)=0 then 'size_unknown'
       when greatest(width,height) >= 800 then 'at_cap' else 'small' end as bucket,
  (thumbnail_error is not null) as has_error, count(*)
from public.assets
where not is_deleted and thumbnail_url is not null and hires_url is null and quick_hash is not null
group by 1,2 order by 1,2;
select count(*) from public.assets where not is_deleted and hires_url is not null;
```
Post the result on #1280 as the "before" baseline. Gate: posted.

**Step 2 — Extract selection (helper-ok: move code verbatim, then test).**
Create `supabase/functions/_shared/hires-backfill.ts` exporting `HIRES_BACKFILL_PER_BATCH = 10` and `isHiresBackfillCandidate(existing, incoming): boolean` containing the current predicate (minus the counter). Use it in `handleCheckChanged` (`index.ts:2637-2649`) keeping the counter there. No behaviour change in this step.
Gate: `supabase/functions/_shared/hires-backfill.test.ts` with the current rules passes (cases in §10, first group); root `npm test` green.
Stop-and-ask: if the predicate depends on anything not in `existing`/`incoming`, bring it back.

**Step 3 — Record "no larger source" (lead-only: changes stored production data semantics).**
- Ingest (`index.ts:1120`): `const hiresUrl = optionalString(body, "hires_url") || thumbnailUrl || null;` — so whenever a thumbnail is written, `hires_url` is the hi-res or the thumbnail. Check the three writes (`:1237`, `:1303`, `:1403`) still behave: `:1403` is `...(hiresUrl ? { hires_url } : {})` — keep.
- Complete-render (`index.ts:2224`): `hires_url: optionalString(body, "hires_url") || thumbnailUrl || null`.
Gate: tests in §10 (second group) via extracted helpers or handler-level mocks; after deploy, a re-rendered small-source asset has `hires_url = thumbnail_url`.

**Step 4 — Keep known sizes (helper-ok).**
`index.ts:1123-1124` → keep `optionalNumber(...)` as `number | undefined`; in `updateFields` (`:1336-1337`) spread `...(width > 0 && height > 0 ? { width, height } : {})`; for inserts keep `?? 0` (new rows have nothing to preserve). Search the function for other uses of `width`/`height` and keep their current meaning.
Gate: test "ingest without size keeps the stored size" (§10). Stop-and-ask: if any other branch (move path `:1237` area) writes size, bring it back.

**Step 5 — Windows reports size (helper-ok, then lead verifies release).**
`apps/windows-agent/src/api-client.ts` `completeRender(jobId, success, thumbnailUrl?, error?, hiresUrl?, size?: { width: number; height: number })` → send `width`, `height`. `apps/windows-agent/src/index.ts:592` pass `{ width: result.width, height: result.height }` from the render result (check the variable name in scope). agent-api `handleCompleteRender` `saveThumbnail` adds `width`/`height` when both > 0 (`optionalNumber(body,"width")`).
Gate: `npm test --prefix apps/windows-agent` green; agent-api test that `complete-render` with width/height writes them and without them leaves them.
Stop-and-ask: if the SG (style-guide) render completion shares this API client function, bring it back.

**Step 6 — Skip-rule files out of slots (lead-only: bridge scan behaviour).**
In `apps/bridge-agent/src/index.ts` where `checkPayload` is built (`:1119-1123`), add `hires_backfill_eligible: false` when `cloudScanMinDate && f.modifiedAt < new Date(cloudScanMinDate)`, or `f.fileType === "ai" && aiIgnoreSet.has(f.relativePath)`; omit the field otherwise (keeps payload small). Add the field to the request type in `apps/bridge-agent/src/api-client.ts` (`checkChanged`). In `isHiresBackfillCandidate`, require `incoming.hires_backfill_eligible !== false`.
Gate: bridge test (in `check-changed-preflight.test.ts` or a new `check-payload.test.ts`) that the flag is set exactly for those two cases; edge test that a flagged file is never selected and does not consume a slot.

**Step 7 — Error exit (helper-ok).** Add `!existing.thumbnail_error` to `isHiresBackfillCandidate`. A Windows backfill job that exhausts `MAX_RENDER_ATTEMPTS` sets `thumbnail_error = 'no_preview_or_render_failed'` (the `else if (!success && job.attempts >= MAX_RENDER_ATTEMPTS)` branch at the end of `handleCompleteRender`) and drops out; the existing thumbnail stays.
Gate: test "row with thumbnail_error is not selected".

**Step 8 — Land (lead-only).** One PR, CI green, merge. Confirm `deploy-supabase.yml` deployed agent-api at the merge SHA. Release the bridge (`publish-bridge-agent.yml`, version bump; ask the NAS to apply via the existing update request) and the Windows agent (GitHub Release per `docs/deployment.md`). Server changes are safe with old agents (fields optional).

**Step 9 — Live proof (lead-only).** After two full scans on the new bridge: re-run step 1's SQL; the backlog count falls each scan and `has_error`/`size_unknown` rows do not grow; spot-check 3 assets — one small source (`hires_url = thumbnail_url`), one large (`hires/…jpg`), one Windows-rendered PSD (size non-zero, hi-res set). Bridge logs show "Retrying thumbnails for N" with N falling toward 0. Post before/after on #1280, tick live proof, close #1280 (and note #1282 is covered).

No step holds work longer than 30 minutes; scans run on their normal cadence.

## 10. Tests required

`supabase/functions/_shared/hires-backfill.test.ts`:
- current rules: selected when thumbnail, no hi-res, quick_hash, size ≥ 800; selected when size unknown; not selected when hi-res set; not selected without quick_hash; not selected when size < 800; cap of 10 respected (via a small `selectHiresBackfill(files, existingMap)` helper if the counter is extracted too).
- new rules: not selected when `thumbnail_error` set; not selected and no slot used when `hires_backfill_eligible === false`; eleventh eligible file selected next batch only if earlier ones completed (simulate by setting `hires_url`).
agent-api handler-level (extract small pure helpers if needed, e.g. `ingestSizeFields(width,height)` and `renderCompletionThumbnailFields(body)` into `_shared/hires-backfill.ts`):
- ingest with thumbnail and no hi-res → `hires_url = thumbnail_url`; with hi-res → hi-res; without size → no `width`/`height` keys.
- complete-render with no hi-res → `hires_url = thumbnail_url`; with width/height → written.
Bridge: check payload flag cases (min-date, ignored `.ai`, normal file → no flag).
Windows: `completeRender` sends width/height (api-client unit test or `renderer-hires.test.ts` extension).
Must stay green: root `npm test`, `npm run typecheck`, `npm run lint`, `npm test --prefix apps/bridge-agent`, `npm test --prefix apps/windows-agent`, `npm test --prefix apps/worker`.

## 11. Constraints and gotchas

- Feature branch + PR; AI merges; reviews advisory.
- No schema change here; any need for one goes through `popcre/shared-db` (load `shared-db-change`).
- The bridge is the only render scheduler (#1094). Do not queue renders from agent-api.
- `apps/*/src/common/` is generated — never edit.
- Keep "a stale hi-res copy never outlives its thumbnail": every thumbnail write still replaces `hires_url`.
- #755's plan (`docs/plans/issue-755-native-postscript-ai-previews.md`) also edits the bridge `.ai` pre-flight; if both are in flight, land one and rebase the other.
- Quote times in EST.

## 12. Access and environment

`gh` as `u2giants` (PRs, releases). Supabase read-only SQL with the access token in 1Password vault `vibe_coding` (search "Supabase access token"). Bridge logs: NAS container logs via the existing agent log tooling (`docs/BRIDGE_AGENT_DEPLOYMENT.md` or `docs/deployment.md`). Windows agent heartbeat/version: web UI Settings → Agents.

## 13. Definition of done, risks, open questions

Done: steps 2–7 merged, CI green, agent-api deployed, bridge and Windows released and running the new versions, two-scan before/after evidence on #1280 shows the backlog shrinking and stable error/unknown buckets, #1280 closed.
Risks: `hires_url = thumbnail_url` makes the worker fetch the same image under the hi-res label — same result as today's fallback. If any future consumer treats `hires_url` as "larger than thumbnail", it must compare URLs. Rollback: revert the PR; agents tolerate the server either way.
Open: none for the owner.

## Self-audit (2026-11-25)

1. Executable without asking? Yes — §2 maps every component, §5 exact lines, §9 exact edits/gates, §12 access.
2. All background incl. rejected options? Yes — §3 four findings incl. #1282, §6 root cause and why 800 is right, §7 four rejected options, STATUS notes the part already fixed by #1284.
3. Goal clear for judgment? Yes — §1: every asset processed once then leaves the backlog, no starvation, no size loss.
Checklist passes: 13 sections; lead/helper marks with stop-and-ask triggers; external input here is the bridge's payload flag (adversarial: missing flag from old bridges → today's behaviour, tested; flag on a normal file → just not backfilled, harmless); locked decisions labelled; out-of-scope; named tests; secrets by location; handoff linked both ways.

## Lead launch prompt

```text
You are the lead implementing u2giants/popdam3#1280 (which also covers folded #1282). Read AGENTS.md, then docs/plans/issue-1280-hires-backfill-selection.md (STATUS first). Fresh worktree, feature branch from origin/main.
You do steps 1, 3, 6, 8, 9. Hand to your helper: step 2 first, then 4, 5, 7 (after step 2 lands in your branch). Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Run every suite listed in §10 yourself, CI, deployments and both releases, then the two-scan live proof. Update STATUS; sign GitHub posts.
```
