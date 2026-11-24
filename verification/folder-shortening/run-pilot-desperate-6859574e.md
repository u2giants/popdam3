# Folder rename run pilot-desperate

- batch_id: 6859574e-0221-4e07-8c79-d278c5c7b948
- db: prod
- disk root: /volume1/mac
- started: 2026-11-24T20:12:09.328Z
- folders: 6

## Preconditions

- all passed (scan paused and idle, no active checkouts, sources exist, targets free)

## Snapshot

- locked snapshot of share mac: GMT-05-2026.11.24-15.12.21

## Renames (deepest first)

- 2026-11-24T20:12:24.702Z Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished/Desperate Enterprises FH24 → Enterprises FH24 (strip_customer)
- 2026-11-24T20:12:27.459Z Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished/Desperate_SS23 → SS23 (strip_customer)
- 2026-11-24T20:12:41.406Z Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished/Shane Desperate Signs FH23 → FH23 (strip_customer)
- 2026-11-24T20:12:43.383Z Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished → Desperate (customer_alias+drop_finished_suffix)
- 2026-11-24T20:12:48.267Z Decor/Character Licensed/____New Structure/In Development/Customer Adopted/Desperate Signs/Shane Desperate Signs SS24 → SS24 (strip_customer)
- 2026-11-24T20:12:58.746Z Decor/Character Licensed/____New Structure/In Development/Customer Adopted/Desperate Signs → Desperate (customer_alias)

## Postconditions

- ok Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished/Desperate Enterprises FH24: 0 assets before, 0 under new name, 0 left under old
- ok Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished/Desperate_SS23: 49 assets before, 49 under new name, 0 left under old
- ok Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished/Shane Desperate Signs FH23: 0 assets before, 0 under new name, 0 left under old
- ok Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/Desperate Signs_finished: 49 assets before, 49 under new name, 0 left under old
- ok Decor/Character Licensed/____New Structure/In Development/Customer Adopted/Desperate Signs/Shane Desperate Signs SS24: 37 assets before, 37 under new name, 0 left under old
- ok Decor/Character Licensed/____New Structure/In Development/Customer Adopted/Desperate Signs: 41 assets before, 41 under new name, 0 left under old
- ok 20 sampled files exist at their new location

- finished: 2026-11-24T20:13:47.487Z
- result: OK
