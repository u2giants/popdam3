# Phase 5.2 rehearsal — 2026-11-24

Scratch copy of the `Desperate Signs` and `_FINISHED/Desperate Signs_finished` trees (335 empty placeholder files, real folder names) at `/volume1/mac/_folder_rename_rehearsal` on edge1 (outside the scan root), against the preview database. Removed afterwards.

| Proof | Result |
|---|---|
| Rename (6 folders, deepest first, no-clobber) | ok — `run-rehearsal-desperate-e971b33e.md` |
| Log rows in `dam.folder_rename_log` | 6 rows, batch `e971b33e-6b63-4d7b-bfe9-df734773ba94` |
| Path rewrite | assets moved (2+3), 0 left under old names; style groups moved; search documents follow by trigger (7 new, 0 old); 0 render-queue rows added |
| Restore across rename | `dam.path_as_of('mac', <new path>, now()-1h)` returned the pre-rename path |
| Revert | `run-revert-rehearsal-desperate-e971b33e.md` — all 6 folders back on disk, 6 log rows `reverted_at` set, assets and search documents back under the old names |

Found: renaming the customer folder changed the stored customer (`Desperate Signs` → `Desperate`). Fixed before the pilot by `dam.customer_folder_alias` (popcre/shared-db#7022).
