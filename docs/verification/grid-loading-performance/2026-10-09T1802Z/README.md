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

This report remains the pre-fix baseline: it records the parallel Licensed
`57014` and controlled schedule comparison, not post-release performance. PR
#287 later shipped as live token `f901017` in publish run `37974214106`. That
release serializes Licensed GET/status pairs, keeps Generic parallel, reports
rows actually received, and exposes initial/next-page errors with retry. A historical production observer passed on `f901017`: Licensed loaded 12,747 rows
with first visible row at 9,842 ms; Generic loaded 3,249 rows with first visible
row at 5,201 ms. Returning to cached Licensed data required no additional range
GET. The initial- and next-page retry probes also passed using browser-only
failure injection; failed ranges recovered through successful GET/status calls
without production data writes. These are separate acceptance observations, not
a repeated controlled before/after timing comparison. Existing OrderList
controls also passed for administrator and viewer:
`existing-capabilities-attempt7-f901017.json`, SHA-256
`072f9c2887770f1d07aada9fdbebdc39d6a17992412bc31dcd25695144995706`. PR #288
merged as `a5efa998799df2c99c562a10663b690d66c6ad18`; CI `37978046556` passed.
Final workflow `37978352705` failed viewer snapshot DOM finding and produced no
canonical type-proof artifacts. Current live deployment and focused acceptance are recorded below; the reports above describe earlier releases and remain historical evidence.

## Current release status

PR #289 is live as token `9883315`; publish `37986360726` succeeded at 4:25 PM
EDT. Focused administrator/viewer edit and refresh checks passed; report
`focus-refresh-9883315.json`, SHA-256
`4a3aced17a65b1d7ac473a31180ed7104cb9c36501ed4dfed114cf50702a2641`. In each
role, the same Find RPC ID was found at index 10,380; a held 500-row read
beginning at offset 10,000 was followed by a distinct 500-row read returning
HTTP 200 at the exact offset. The row appeared, and the earlier response did not
overwrite it. For the administrator, an unsaved value survived two focus
changes with zero reads during editing; Escape canceled it, one queued read
returned HTTP 200, and the original value returned. This focused acceptance made
zero business-row writes. The separate guarded #275 decision application made
three intended links, which were read back and verified. Prior `f901017`
observer, retry, Find, screenshot and controls results remain historical.

Native workflow `37987001226` passed 90 checks across both roles; checks-label manifest SHA-256
`708b9395e8e6e054372a7c9b7a7bb73b03f0ce3448df2acec338b447586eb0e1`. Schema
SHA-256 `fc9041a48038b8604e94a8e0169d06d049214eba57dd609dd296f95823738954`
matched the live schema. Type artifact `11643178561` SHA-256
`7fdbb47c64e182e3893d104ef3105a751e6a5666efe857d9d640943d306229a7` and live
artifact `11642863862` SHA-256
`54f02a6384171d797ce11ba7ef306dbc39e7d9e41a24c71c3f12b1672332ed59` passed.
Shared-db #4111 was closed with native completion evidence `03332b22ceb8adcb`.
PopDAM #275 also passed its normal administrator/viewer UI check: 53 checks,
all three exact Find IDs/indexes, 500-row reads at offsets 2,000/2,500/7,500, and
six canonical descriptions visible; zero write attempts or browser errors. Report
`coldlion-owner-link-proof.json`, SHA-256
`fd33979beb4abe88c0a5eb969b58ec7b679ebffda9f227d63b1bfb9b6d7a219f`, is recorded
in [#275 completion comment](https://github.com/u2giants/popdam3/issues/275#issuecomment-6089001259), and #275 is closed. The post-link cohort is 23 lines
across 7 Items; missing Master tracker facts remain honestly Unknown, without
creating tracker or Item Master records. Only #281 documentation closeout
remains open.

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
