# PopDAM (DAM) — `.ai` sentinel stats + thumbnail findings (2026-07-03)

## What changed
- **`get_ai_sentinel_stats()`** re-homed from the app repo into shared-db and tightened.
  The `sentinel_pending` count previously used `pdf_text_samples.extracted_text LIKE
  '%saved without PDF Content%'`; it now matches the canonical phrase **exactly**
  (`= 'This is an Adobe® Illustrator® File that was saved without PDF Content.'`).
  Migration: `supabase/migrations/20260702220336_ai_sentinel_stats_exact_match.sql`.
- No table/column/RLS/realtime changes. Function only (`create or replace`, additive/idempotent).

## Why
- The DAM bridge agent collapses a **confirmed** sentinel's `extracted_text` to exactly that
  phrase; real `.ai` keep their actual page text. A `LIKE` substring also counted real artwork
  whose page merely carries Adobe's CompatibilityAlert text, inflating the count and (via the
  app-side `ai-sentinel-handlers.ts` list/cleanup queries, which were also switched to exact
  match) risking deletion of real art.
- App repos may no longer author shared migrations (see the app repos' new
  `forbid-shared-db-bypass` CI + `CLAUDE.md`), so the function belongs here.

## Affected apps
- **DAM (`popdam-web`)** only. `get_ai_sentinel_stats` is read by the DAM admin ".ai Sentinel
  Cleanup" card via `admin-api`. No other app reads it.

## Where the implementation lives
- shared-db: `supabase/migrations/20260702220336_ai_sentinel_stats_exact_match.sql` (this repo,
  merged via PR #33).
- popdam-web: `supabase/functions/_shared/admin-handlers/ai-sentinel-handlers.ts` (exact-match
  list + cleanup queries), `apps/bridge-agent/src/ai-sentinel-detect.ts` (detector),
  `apps/windows-agent/src/compat-audit.ts` (perceptual-hash thumbnail audit).
  NOTE: an orphaned copy `supabase/migrations/20260702120000_*.sql` remains in the app repo
  (never applied; app repos don't run `db push`) — leave it, the bypass guard blocks deleting it.

## Verified
- `scripts/check-sql.sh` passed.
- Applied to the **preview** branch (`xjcyeuvzkhtzsheknaiu`) and **production**
  (`qsllyeztdwjgirsysgai`) via the `Shared Supabase Migrations` workflow (apply mode);
  `db push` reported exactly the one pending migration on each. Verified in prod:
  `get_ai_sentinel_stats()` returns valid jsonb and the function body uses `= '…'` (no `LIKE`).

## Risky / unfinished — important context for future sessions
- **The DAM ".ai Sentinel Cleanup" premise is unsafe.** ".ai saved without PDF Content" files
  are **NOT empty** — they retain full native Illustrator artwork; only the embedded PDF preview
  is a boilerplate stub. The cleanup flow soft-deletes/hides them; ~1,319 real artworks were
  hidden this way (NAS source files are intact/recoverable). The count fix is cosmetic and does
  **not** make the delete flow safe. Recommend retiring/repurposing that feature (fix-list, or
  gate deletion on a confirmed sibling copy). Detail in the popdam-web `AGENTS.md` `.ai` quirk.
- The real thumbnail fix is the DAM Windows-agent **compat-thumbnail audit** (perceptual hash),
  which clears warning-page thumbnails and re-renders the native art — no schema involved.
