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
them added about 2.2 seconds, so the proposed application correction serializes Licensed
only and keeps Generic parallel. One run is evidence for this scoped choice,
not a percentile or reliability guarantee. Each range remains capped at
1,000 rows and each query page remains 4,000 rows.

The current frontend remains the measured baseline. Live acceptance of the
new Licensed scheduling, truthful status, and retry behavior must follow its
normal reviewed release; this report does not claim the repair is deployed.

## Retained sanitized measurements

The complete sanitized report is below so future readers can inspect the
measurement evidence. Its digest is SHA-256 of the UTF-8 JSON text inside the
fence, excluding the final newline used to separate the closing fence.
Machine timestamps are UTC; the observation above is in EDT. No row data,
identifiers, account information, headers or authenticated traffic are present.

```json
{
  "origin": "https://dam.designflow.app",
  "projectRef": "qsllyeztdwjgirsysgai",
  "reviewedSourceHead": "d9ee53d9c6bf32e8c0e20e81966ab9ed4187ac3c",
  "expectedDeployedSha": "f02b9de2e60a317aaf5136c77957b1639b9274b1",
  "expectedBuildToken": "f02b9de",
  "runs": [
    {
      "sheet": "License.Style",
      "tab": "Licensed",
      "schedule": "parallel",
      "buildStampMatches": true,
      "failed": "Benchmark gate failed.",
      "firstWaveGets": [
        {
          "method": "GET",
          "offset": 0,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 6780,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 1000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 500,
          "durationMs": 8932,
          "rowCount": null,
          "hostMatches": true,
          "errorCode": "57014",
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 2000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 3282,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 3000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 3813,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstWaveStatusRpcs": [
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": null,
          "status": 200,
          "durationMs": 686,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": null,
          "status": 200,
          "durationMs": 235,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": null,
          "status": 200,
          "durationMs": 209,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstVisibleGridRowMs": null,
      "firstWaveCompleteMs": 7334,
      "loadedRowsStatus": null,
      "gridRowsAtCapture": 0,
      "countHeadRequests": 1,
      "countHeadStatuses": [
        206
      ],
      "optionGetRequests": 10,
      "optionGetStatuses": [
        400,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200
      ],
      "heldLaterRequestCount": 0,
      "wrongSheetAborts": 0,
      "blockedWrites": 0,
      "passed": false
    },
    {
      "sheet": "Generic.Style",
      "tab": "Generic",
      "schedule": "parallel",
      "buildStampMatches": true,
      "failed": null,
      "firstWaveGets": [
        {
          "method": "GET",
          "offset": 0,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 3018,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 1000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 3332,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 2000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 3591,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 3000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 3621,
          "rowCount": 249,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstWaveStatusRpcs": [
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 323,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 248,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 234,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 249,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 48,
          "resultCount": 249,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstVisibleGridRowMs": 4071,
      "firstWaveCompleteMs": 3906,
      "loadedRowsStatus": null,
      "gridRowsAtCapture": 34,
      "countHeadRequests": 1,
      "countHeadStatuses": [
        206
      ],
      "optionGetRequests": 11,
      "optionGetStatuses": [
        200,
        200,
        200,
        200,
        400,
        200,
        200,
        200,
        200,
        200
      ],
      "heldLaterRequestCount": 0,
      "wrongSheetAborts": 4,
      "blockedWrites": 0,
      "passed": true,
      "displayedLoadedCount": 3249,
      "expectedFirstWaveRowCount": 3249,
      "firstVisibleGridRowIs4000UsefulProof": true
    },
    {
      "sheet": "License.Style",
      "tab": "Licensed",
      "schedule": "serial",
      "buildStampMatches": true,
      "failed": null,
      "firstWaveGets": [
        {
          "method": "GET",
          "offset": 0,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 4381,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 1000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 4442,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 2000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 933,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 3000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 928,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstWaveStatusRpcs": [
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 100,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 114,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 99,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 41,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstVisibleGridRowMs": 13312,
      "firstWaveCompleteMs": 13041,
      "loadedRowsStatus": null,
      "gridRowsAtCapture": 34,
      "countHeadRequests": 1,
      "countHeadStatuses": [
        206
      ],
      "optionGetRequests": 10,
      "optionGetStatuses": [
        200,
        200,
        200,
        200,
        400,
        200,
        200,
        200,
        200,
        200
      ],
      "heldLaterRequestCount": 3,
      "wrongSheetAborts": 0,
      "blockedWrites": 0,
      "passed": true,
      "displayedLoadedCount": 4000,
      "expectedFirstWaveRowCount": 4000,
      "firstVisibleGridRowIs4000UsefulProof": true
    },
    {
      "sheet": "Generic.Style",
      "tab": "Generic",
      "schedule": "serial",
      "buildStampMatches": true,
      "failed": null,
      "firstWaveGets": [
        {
          "method": "GET",
          "offset": 0,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 2232,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 1000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 1006,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 2000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 579,
          "rowCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "GET",
          "offset": 3000,
          "limit": 1000,
          "rangeStart": null,
          "rangeEndInclusive": null,
          "rangeConsistent": true,
          "status": 200,
          "durationMs": 682,
          "rowCount": 249,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstWaveStatusRpcs": [
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 376,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 55,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 1000,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 121,
          "resultCount": 1000,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        },
        {
          "method": "POST",
          "requestedIdCount": 249,
          "idsMatchGet": true,
          "status": 200,
          "durationMs": 75,
          "resultCount": 249,
          "hostMatches": true,
          "errorCode": null,
          "errorName": null
        }
      ],
      "firstVisibleGridRowMs": 6254,
      "firstWaveCompleteMs": 6082,
      "loadedRowsStatus": null,
      "gridRowsAtCapture": 34,
      "countHeadRequests": 1,
      "countHeadStatuses": [
        206
      ],
      "optionGetRequests": 11,
      "optionGetStatuses": [
        200,
        400,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200
      ],
      "heldLaterRequestCount": 0,
      "wrongSheetAborts": 4,
      "blockedWrites": 0,
      "passed": true,
      "displayedLoadedCount": 3249,
      "expectedFirstWaveRowCount": 3249,
      "firstVisibleGridRowIs4000UsefulProof": true
    }
  ],
  "status": "FAIL",
  "finishedAtUtc": "2026-10-09T18:02:18.252Z"
}
```
