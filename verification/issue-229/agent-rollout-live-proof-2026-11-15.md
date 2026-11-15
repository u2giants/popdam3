# Issue #229 live proof — post-#991 agent rollout (bridge + windows)

Date: 2026-11-15, about 4:32–4:46 PM EST (America/New_York). Read-only evidence plus
one reversible probe in the established class
(`verification/folder-shortening/snapshot-restore-live-proof-2026-11-11.md`).
Nothing destructive; no schema or credential changes; no scan was triggered by this session.

## 0. Safety gate — no rescan/backfill in flight (read-only)

`get-pdf-backfill-status` (admin-api) at 4:32 PM EST: `PDF_BACKFILL.status = "completed"`,
mode `indra_rescan`, `completed_at 2026-11-04T23:57:25Z`, `live_current_step: "idle"`,
`live_current_file: null`, windows-render heartbeat current. The withhold condition from
issue #681 ("After PDF_BACKFILL reaches completed, update the bridge") is satisfied; the
Indra rescan is finished and nothing is queued. `ai-task-gates check --before production`
reports `production` forbidden for class `deployment` (none taken); `check --before deploy`
reports `"deploy" may start for effective class "deployment"` — the in-app agent update is
the repo's deploy path and was performed under that authority.

## 1. Builds deployed (versions live)

PR #991 merged 2026-11-12 8:39 PM EST as merge commit
`487af8868596694a96c2d2e5ac7818569ea8d6d2` (shared `assertSafeFilename` /
`resolveUnderRootFilename` in `packages/agent-common/src/path-containment.ts`, wired into
`apps/bridge-agent/src/handlers/snapshot-tools.ts`). Publish runs on that merge:

- `publish-bridge-agent.yml` run 43346565017 — success; image tags
  `ghcr.io/u2giants/popdam-bridge:{latest,stable,v1.16.26,sha-487af88}`, build arg
  `POPDAM_BUILD_SHA=487af8868596694a96c2d2e5ac7818569ea8d6d2` (run log).
- `publish-windows-agent.yml` run 43346565074 (build 210) and run 43346812393 (build 211,
  commit `ad999066` = #992 merge; `git merge-base --is-ancestor 487af886 ad999066` holds,
  and that tree carries `assertSafeFilename` / `resolveUnderRootFilename`).

Live heartbeat version stamps (`list-agents`):

| Agent | version | build_sha | note |
|---|---|---|---|
| windows-render-agent | 0.17.0.211 | `ad999066d9de5b93cfca32c6c53b4e81211cfb00` | live since Nov 13 (`get-update-status`: 0.17.0.209 → 0.17.0.211); `update_available: false` |
| synology-bridge-1 (before update) | 1.16.26 | `baa75e2485c1f04acb0923b4f1ec04c68f429912` | pre-#991 image (#971 publish), running until 4:38 PM EST today |
| synology-bridge-1 (after update) | 1.16.26 | `487af8868596694a96c2d2e5ac7818569ea8d6d2` | in-app update request `c097bdb6-f04a-40d2-a892-3e7bdda4eccb` (4:37 PM EST); heartbeat 4:38:52 PM EST already reports the new sha; `updating: false`, `update_error: null`, `last_error: null` |

The bridge was updated only through the in-app update path (Admin UI → Settings → Agents →
Update / `trigger-agent-update` `apply`), per deployment.md.

## 2. Snapshot "Find older copies" and restore — proven on the new bridge build

Probe class: `verification/folder-shortening/snapshot-restore-live-proof-2026-11-11.md`
(same asset, listing + restore-beside-file). Asset `30738be2-1a83-44fe-8943-eaff69abc729`
(`.../Marvel/XA12SP/XA12SP_PACKAGING.ai`), signed in as the administrator tester account.

1. `request-snapshot-versions` request `e0b6e71e-1d76-4419-82c8-916722b28514`; the new
   bridge build returned three versions at 4:41:58 PM EST — sizes 2,863,180 /
   2,438,951 / 2,481,942 bytes, identical to the Nov 11 baseline.
2. `request-snapshot-restore` of snapshot `GMT-04-2026.09.30-18.15.03`
   (request `76af67fa-01a2-4ea6-a12e-2cf41a1cc604`); result at 4:44:58 PM EST:
   `XA12SP_PACKAGING (restored 2026-09-30).ai`, 2,438,951 bytes — the snapshot version's
   exact size, written beside the current file by exclusive create (the current file is
   never overwritten; name collisions take a ` 2` suffix). This exercised
   `resolveUnderRootFilename(destDir, name)` — the #991 change — on a legitimate name.

Reversible: the restored copy can be deleted; it is the same probe class as Nov 11.

## 3. Ordinary ingest

- Post-update bridge health (4:45:59 PM EST): online, marker `Decor: ok`, mount root
  exists, scan roots readable, `last_error: null`, auto-scan enabled (`interval_hours: 2`).
- Ingest code is unchanged between the old and the deployed build: the image-relevant
  delta `baa75e24..487af886` is only `snapshot-tools.ts` (4 lines) and the shared
  `path-containment` additions + tests. The old build completed today's full ingest pass
  at 3:15 PM EST (163,905 files checked, 100 existing updated, 0 errors).
- Read-only DB check (`run-query`, SELECT only): 10 assets updated and 1 created in the
  last 24 hours; latest asset update 12:49 PM EST today.

- [ ] live proof: first full ingest pass on build `487af886` — the auto-scan restarts a
  pass at ~6:38 PM EST (two hours after the 4:38 PM EST restart, per the bridge's
  "wait one full interval after startup" rule). Confirm counters advance with 0 errors
  and the restored copy `XA12SP_PACKAGING (restored 2026-09-30).ai` is ingested as its
  own asset (same step-4 class as the Nov 11 record). No scan was forced from this
  session — no verification record establishes scan-triggering as a probe class.

## 4. Negative probe — fixture traversal jobs reported failed (added 5:00 PM EST)

Coordinator-authorized fixture jobs on the bridge's snapshot-restore job surface (the
same single-slot request class as section 2; the API-side validator was bypassed on
purpose so the job reaches the agent). No filesystem access happens either time —
`assertSafeRelativePath` throws before any fs call. Both requests were consumed and
closed by the agent within one heartbeat.

1. Request `f4521351-a8db-4de0-adbb-41b0b2cf5db5`, `source_path = ..\..\Startup\x.bat`
   (the issue's literal). Reported failed 4:55:11 PM EST:
   `{"ok": false, "error": "Unsafe path: \"..\" segment not allowed (..\\..\\Startup\\x.bat)", "action": "report-snapshot-restore", ...}`
2. Request `b1e5e011-2452-4857-aeb7-6943c03ff01e`, `source_path = /etc/passwd` (absolute).
   Reported failed 4:56:12 PM EST:
   `{"ok": false, "error": "Unsafe path: absolute path not allowed (/etc/passwd)", ...}`

Both payloads were rejected by `assertSafeRelativePath`
(`packages/agent-common/src/path-containment.ts`) inside `restoreFromSnapshot` on the
live bridge build `487af886`. Reversible: fixture request/result rows only; the failed
requests are closed and can be deleted from `admin_config`.

## 5. Still open on issue #229

- Ordinary ingest first pass on build `487af886` — pending the ~6:38 PM EST auto-scan
  (section 3); also the `skipped_before_min_date` ("too old") chip read on the admin UI
  during that live scan for #469's parseCounters live proof. Both are window-scoped
  read-only checks.
- Desktop Helper checkout/check-in live proof — needs a user to run an installed Helper
  (none online as of the 2026-10-22 proof).

Posted by MiMo chat unknown on desktop
