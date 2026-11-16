# Issue #469 rich-pdf failed-row retry — live probe 2026-11-15

summary: Live probe of rich-pdf failed-row retry on a toytest fixture (failure recording + retry cooldown)
kind: verification-record
status: current
read-when: closing or resuming #469 rich-pdf live-proof checkbox

## Scope and method

Deployed worker (PR #779 merge `832813c` in ancestry), shared-db RPC
(`get_pdf_rich_extraction_hashes` returns `parse_error`/`extracted_at` per
#5627, production apply 41971432267). Production gate:
`ai-task-gates start --class production` + `check --before production
--acknowledge` (scoped delegation, recorded verbatim in `evidence.json`).

Toytest-class fixture PDF created in production DB (fixture rows only,
reversible). No real design files touched. No NAS files placed.

## Fixture

- Asset: `a4690000-4690-4000-8000-000000000001`
  (`toytest_tech_pack_469probe.pdf`, file_type=pdf)
- `pdf_text_samples` row: 150 chars of harmless filler text, sha256
  `ba621d0e526b761177d81b3e488fdfffab2625e9fb345bd80bfbd8a576c15de0`
- Failure extraction row created via `upsert_pdf_rich_extraction` RPC with
  `p_parse_error="probe-induced failure for 469 retry verification"`,
  `p_data={}`, `p_source_text_sha256=ba621d0e...`

## Leg 1: Failure recording + hash not marked done — PROVEN

Evidence: `get_pdf_rich_extraction_hashes` returns for asset
`a4690000-…`:
- `parse_error`: `"probe-induced failure for 469 retry verification"` (non-null) ✓
- `source_text_sha256`: `ba621d0e526b761177d81b3e488fdfffab2625e9fb345bd80bfbd8a576c15de0` ✓
- `extracted_at`: initially `2026-11-15T19:20:54-05:00`, then seeded to
  `2026-11-14T18:21:29-05:00` (25h ago)

The hash is NOT marked done: `shouldExtractRichPdf` returns `true` for this
row because `parse_error` is non-null (not a success) and the cooldown has
elapsed. Unlike a successful extraction (which is permanently skipped for the
same hash), a failure row remains eligible for retry after cooldown.

Code: `apps/worker/src/handlers/rich-pdf.ts:175-186`.

## Leg 2: Retry after cooldown — PARTIALLY PROVEN

**Cooldown seeded** (per probe rules: "seeding an old-failure timestamp on the
test row only"): `extracted_at` set to 25h before probe time via Supabase
Management API SQL (fixture row only, reversible). 24h cooldown elapsed.

**Retry triggered**: `admin_config.BULK_OPERATIONS.rich-pdf-extract` set to
`status=running` at 7:22 PM EST. Worker picked up within 5s.

**Retry NOT observed**: worker auto-stopped at 84% failure rate
("Auto-stopped: Failure rate 84% (90 failed out of 107 processed)",
`interruption_reason_code=repeated_failure`). The scan window (200 rows from
offset 0) did not reach asset `a4690000-…` (uuid sorts past the first 200
rows). The failure row was NOT updated — `extracted_at` still shows the
seeded 25h-old timestamp.

The DeepSeek provider was failing for all 90 attempted extractions during
this run (0 successes). This is a provider-side issue, not a retry-logic
issue.

**Observation step for retry leg (after DeepSeek provider recovery):**
1. Set `admin_config.BULK_OPERATIONS.rich-pdf-extract` `status=running`
   (cursor 0).
2. Wait for worker to scan past offset 200 and reach asset
   `a4690000-4690-4000-8000-000000000001`.
3. Verify `get_pdf_rich_extraction_hashes` shows `parse_error=null` and
   `extracted_at` updated to now (success clears the error).

**Time of last observation:** 2026-11-15 7:24 PM EST.

## Cleanup

- **Fixture rows:** PENDING — left in place so the retry leg can be observed
  after DeepSeek provider recovery. Delete after retry is proven:
  - `assets WHERE id='a4690000-4690-4000-8000-000000000001'`
  - `pdf_text_samples WHERE asset_id='a4690000-4690-4000-8000-000000000001'`
  - `dam.pdf_rich_extraction WHERE asset_id='a4690000-4690-4000-8000-000000000001'`
- No NAS files placed. No real design files touched.

## Live-proof checkbox

- [x] `rich-pdf` failed extraction no longer permanently marked done under the same text hash — fixed (PRs #5627 / #779; contract test #6424).
- [ ] live proof — **Leg 1 proven** (failure row recorded with `parse_error`, hash not marked done). **Leg 2 requires DeepSeek provider recovery** — cooldown elapsed and retry was triggered but the worker auto-stopped at 84% provider failure rate before reaching the fixture. Observation step and time recorded above.

Posted by MiMo chat unknown on desktop
