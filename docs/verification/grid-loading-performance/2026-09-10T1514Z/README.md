# Grid loading performance baseline

- **Captured:** 2026-09-10T15:14Z
- **Target:** production `https://dam.designflow.app/styles`
- **Build:** `6296708` (shown by the production build stamp)
- **Browser state:** signed-in read-only test account; no edits or saves performed.
- **Redaction:** this note contains only request shapes, counts, and timings. No cookies, authorization headers, user identifiers, or row contents were saved.

## Licensed Master Data before this change

- The initial request wave contained four `style_tracker_rows_with_bridge`
  requests for offsets `0`, `1000`, `2000`, and `3000`, each requesting
  `select=*` and `limit=1000`.
- The first 1,000-row request took 1.67 seconds. The prior implementation held
  all rows from that wave and all later waves until the entire tab had loaded.
- The same visit continued through offsets `4000` through `15000`, demonstrating
  the full-tab fetch. A separate exact-count request was made.

## Limits of this baseline

Generic-tab and OrderList-Find measurements were not collected in this browser
run. The production session diagnostic exposed an access token; browser evidence
collection stopped immediately and no secret-bearing artifact was retained.
Repeat those read-only measurements after the test session is rotated, using the
same redaction rule above.
