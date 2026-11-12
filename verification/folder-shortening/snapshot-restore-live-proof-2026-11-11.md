# Phase 2 live proof — restore from snapshot (#963, step 2.7)

Date: 2026-11-11, about 6:50 PM EST (America/New_York). Site: https://dam.designflow.app, frontend build `829da81`,
bridge helper build `baa75e2` (PR #971), database objects from popcre/shared-db#6078 (production apply run
43122565603 → production apply succeeded 2026-11-11 ~6:55 PM EST).

Signed in as the PopDAM administrator tester (1Password `vibe_coding`, administrator tester item).

## File

`Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/PFX_MBX_PBX_Molded shadowbox/12.5x15.25/Marvel/XA12SP/XA12SP_PACKAGING.ai`
(asset `30738be2-1a83-44fe-8943-eaff69abc729`).

On edge1, read over SSH before the test, the file has three distinct versions across the 56 snapshots:
size 2,863,180 (May 29 → Sep 25), 2,438,951 (Sep 30 → Oct 27), 2,481,942 (Oct 28 → now = current file).

## Result

1. "Find older copies" listed exactly those three versions (screenshot `older-copies-versions.png`). This also
   proves the helper container sees `/mnt/nas/mac/#snapshot` (step 0.3 deferred check).
2. Restored the Sep 30 – Oct 27 version (confirm dialog → success: `XA12SP_PACKAGING (restored 2026-10-27).ai`,
   screenshot `older-copies-restored.png`).
3. On edge1 after the restore:

| File | Size | mtime (epoch) | SHA-256 (first 16) |
|---|---|---|---|
| current `XA12SP_PACKAGING.ai`, before | 2,481,942 | 1793203038 | `1eeba1116aa02e16` |
| current `XA12SP_PACKAGING.ai`, after | 2,481,942 | 1793203038 | `1eeba1116aa02e16` (unchanged) |
| snapshot `GMT-04-2026.09.30-18.15.03` copy | 2,438,951 | 1790729233 | `12fb565c1681b11c` |
| restored `XA12SP_PACKAGING (restored 2026-10-27).ai` | 2,438,951 | 1790729233 | `12fb565c1681b11c` (identical) |

The restore was written beside the current file, never over it; modified time preserved.

4. Next scan ingests the restored copy as its own asset: see the STATUS row / #963 comment for the result.
