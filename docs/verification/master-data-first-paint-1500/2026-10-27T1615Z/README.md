# Master Data first-paint 1,500 rows — live production proof (2026-10-27)

Verifies PR #541 (issue #542) on the live site after the merge to `main`
(`eb405c02`), publish run `40533639626` (including the Coolify deploy step),
observed at 12:05 PM EDT.

## Method

Signed-in production browser run as the read-only viewer test account
(`ai-viewer@designflow.app`), headless Chrome driven over the DevTools
protocol from the VPS. The page's own network requests and status line were
recorded; two screenshots were taken at first paint and at background-load
completion. No business data was written.

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
- First paint renders exactly the first 1,500 rows (one visible grid page);
  background pages then append 4,000 rows each (5,500 → 9,500 → 12,875),
  matching the new page schedule in `src/lib/master-data-loading.ts`.
- Grid pagination footer read `1–1,500` of the loaded rows at first paint.
- Screenshots: `first-paint-1500.png` (status line and populated grid at first
  paint), `background-complete.png` (completed 12,875-row load).
- Machine-captured timeline and request log: `evidence.json`.

## Interpretation

The previous first wave (four sequential 1,000-row Licensed ranges plus status
RPCs — first visible row historically ~9.8 s on the October 9 baseline) is
replaced by a 1,000-row range plus a 500-row range; the grid paints as soon as
those two round trips complete (7.0 s here, cold browser profile on the VPS).
Find and filters continue to cover only loaded rows during background loading,
then the full 12,875-row tab, unchanged from the previous contract.
