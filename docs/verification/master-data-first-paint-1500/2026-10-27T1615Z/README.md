# Master Data first-paint 1,500 rows — live production proof (2026-10-27)

Verifies PR #541 (issue #542) on the live site after the merge to `main`
(`eb405c02`), publish run `40533639626` (including the Coolify deploy step),
observed at 12:05 PM EDT. Sanitized re-land: an earlier version of this
directory committed two full-page screenshots; per the evidence-privacy
contract (`plan_master_data_orderlist_loading_performance.md`: never commit
row contents or licensed data) they were removed by review finding (muse
plan-review 20261027T163004). Their SHA-256 digests are recorded below so the
original capture remains verifiable without exposing business rows.

## Method

Signed-in production browser run as the read-only viewer test account
(`ai-viewer@designflow.app`), headless Chrome driven over the DevTools
protocol from the VPS. The page's on-screen status line was polled and
timestamped from page load until background loading finished; two screenshots
were captured locally for visual confirmation but are not committed. No
business data was written.

## Observed on https://dam.designflow.app/styles (Licensed tab)

| Event | Time from navigation | On-screen status (verbatim) |
|---|---:|---|
| Loading begins | 0.5 s | `Loading Master Data…` |
| First paint (grid rows visible) | 7.0 s | `1,500 of 12,875 rows loaded — loading the rest. Find and filters cover loaded rows.` |
| Background page 1 | 16.3 s | `5,500 of 12,875 rows loaded — loading the rest. …` |
| Background page 2 | 23.9 s | `9,500 of 12,875 rows loaded — loading the rest. …` |
| Load complete | 29.1 s | `12,875 rows loaded` |

- The app header's build stamp read `eb405c0`, a prefix of the merged commit
  `eb405c02479f1d76b319f2f2e89150493bcade45` — the live site served the new build.
- The status counts themselves demonstrate the page schedule: the grid paints
  after exactly 1,500 rows (one visible grid page), then grows by 4,000-row
  background pages (5,500 → 9,500 → 12,875), matching
  `src/lib/master-data-loading.ts`. Request-level Range headers were not
  captured; this proof rests on the timestamped status line, not on a
  per-request log.
- Grid pagination footer read `1–1,500` of the loaded rows at first paint.
- Machine-captured timeline: `evidence.json` (status text, DOM row counts,
  build stamp, timings only — no row identifiers or business values).
- Uncommitted capture digests (SHA-256):
  `fac294971bf6f6a6a0763f9a04f8db6ebacd8f9c7df199b1c027dee966facc4f`
  (first paint), `89447a2c334a2912d648310a975ec46ccc71baea4633640f87cf4460e6424ae2`
  (background complete).

## Interpretation

The previous first wave (four sequential 1,000-row Licensed ranges plus status
RPCs — first visible row historically ~9.8 s on the October 9 baseline) is
replaced by a 1,000-row range plus a 500-row range; the grid paints as soon as
those two round trips complete (7.0 s here, cold browser profile on the VPS).
Find and filters continue to cover only loaded rows during background loading,
then the full 12,875-row tab, unchanged from the previous contract.
