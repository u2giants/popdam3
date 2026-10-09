# Master Data first-wave load check — 2026-10-09

This read-only Viewer run completed at 2:02 PM EDT and compared the deployed
`f02b9de` frontend at `dam.designflow.app` with a controlled request-order
simulation. It used four fresh browser contexts total, one per sheet/schedule,
real production GET and computed-status RPC responses, and issued no
business-row writes. Generic cases aborted the initial Licensed row reads to
isolate the selected sheet. The driver held later-page reads and, in controlled
serial cases, held each next 1,000-row GET until the prior GET and its matching
status RPC completed. These limits simulated request order; it did not run a
rebuilt or deployed serial implementation.

Protected sanitized report SHA-256:
`8957f45fda2d5abb0a33919782e33aad361709d0a16c7f225d396f333c1d1702`.
Only the sanitized report was retained; raw authenticated traffic was not
retained. No row identifiers, business values, credentials, or cookies are
recorded here.

| Sheet and schedule | Bounded row results | Computed status RPCs | Slowest successful GET | First visible row | First-wave completion |
|---|---|---|---:|---:|---:|
| Licensed, current parallel UI | Three GETs returned 200; offset 1,000 returned HTTP 500 / `57014` after 8,932 ms. No complete 4,000-row wave rendered. | Three matching RPCs returned 200; failed range had no RPC. | 6,780 ms | Not reached | Not reached |
| Licensed, controlled serial schedule | Four 1,000-row GETs returned 200; 4,000 rows. | Four matching RPCs returned 200. | 4,442 ms | 13,312 ms | 13,041 ms |
| Generic, current parallel UI | Four GETs returned 200; 3,249 rows. | Four matching RPCs returned 200. | 3,621 ms | 4,071 ms | 3,906 ms |
| Generic, controlled serial schedule | Four GETs returned 200; 3,249 rows. | Four matching RPCs returned 200. | 2,232 ms | 6,254 ms | 6,082 ms |

The Licensed error is consistent with the existing eight-second database
statement cap: this one concurrent 1,000-row request ended in `57014`, while
the same four ranges completed when each request and status calculation ran
before the next began. Generic parallel requests all completed; serializing
them added about 2.2 seconds, so the application change serializes Licensed
only and keeps Generic parallel. One run is evidence for this scoped choice,
not a percentile or reliability guarantee. Each range remains capped at
1,000 rows and each query page remains 4,000 rows.

The current frontend remains the measured baseline. Live acceptance of the
new Licensed scheduling, truthful status, and retry behavior must follow its
normal reviewed release; this report does not claim the repair is deployed.
