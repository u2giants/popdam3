# Phase 0 baseline — folder shortening (#963)

Measured 2026-11-11, about 3:55–4:30 PM EST, read-only. Database: Supabase `qsllyeztdwjgirsysgai`. NAS: edgesynology1 (settings), edgesynology2 (file reads).

## 0.1 Path lengths (`assets.relative_path` under `____New Structure`)

| Bucket | Files |
|---|---|
| ≤180 | 120,020 |
| 181–200 | 29,560 |
| 201–220 | 15,426 |
| 221–240 | 6,015 |
| >240 | 1,770 |
| **Total** | **172,791** |

Longest: 329 characters. Over 200: 23,211. Over 240: 1,770 (these fail even via `\\edgesynology1\mac\`, 19-char prefix). With a Synology Drive prefix (~35–50 chars) the failing set is roughly everything over ~210–224, i.e. ~10,000–17,700 files.
Premise confirmed: the Windows 260-character limit fits the complaint.

The longest paths are deep working subfolders, not only the top folders, e.g.:
- 329 — `…/Customer Adopted/Dollar General/2027/Dollar General Pop Spruce Impulse 2027/_working files/Perpetual Calendar/_assets/DCPVault-04Sep2026/3040881-nightmare-before-christmas-…-style-guide/character-art/3040881_ca207.ai` (an unzipped licensor vault with very long folder names)
- 325 (×9) — `…/_FINISHED/Ross_finished/Ross_Q1 Q2 Dev_SS24_NEEDS REVISIONS/_preliminary files/_round 1_091323/11x14'' 2 piece canvas set w glitter or foil/preliminary assets/_extra designs from Gina/<SKU>/Option 2/Canvass Mock Up/<SKU>_set mockup-01.jpg`
- 309 — `…/____New Structure/Product Ideas/2024-07_Polyester gardening gloves and Garden tools/Multiple Customers- Licensed Garden Tools Costing 6-2024/For Factory/…`
- 308 — `…/_FINISHED/Burlington_finished/Burlington Lap Desks, Pencil Cups, DIY Julie Greer SS25/_Working files/_preliminary files/Strawberry Shortcake/…`

Implication for Phase 4: customer/stage rules alone will not reach the target; step 4.3 per-folder rules for deep working folders (and `Product Ideas`, `_FINISHED`) are required.

## 0.2 Live function and history

- `public.infer_path_attrs(text)` live definition md5 `c5631d56721174b79b539832a6a0d87a`; logic matches the mirror at `shared-db/supabase/ci-bootstrap/010_pre_adoption_baseline.sql:5182` (exact compares on `In Development` / `Customer Adopted`; customer = next segment; program = segment after).
- **Finding 7 confirmed:** under `Customer Adopted/Ross/2026/`, all 2,455 assets have customer `Ross`, program `2026`. Programs are wrong today for every year-foldered customer. Phase 3.1 fixes it and needs the batched re-backfill.
- `public.asset_path_history` is a **table** (relkind r), ~23,400 rows, columns `old_relative_path`, `new_relative_path`, `detected_at`. `dam.asset_path_history` and `dam.asset` exist but are empty (unused).
- Purge job `purge-asset-path-history-old-rows`: daily 03:30 UTC, `DELETE … WHERE detected_at < NOW() - INTERVAL '90 days'`.

## 0.3 Helper sees snapshots

- Host: `/volume1/mac/#snapshot` lists 56 snapshots, oldest `GMT-04-2026.05.29-18.15.01`.
- Compose mounts `/volume1/mac:/mnt/nas/mac`, so `#snapshot` is inside the mount.
- **Inside-container check not done:** docker access for `ai` on edge1 is closed (sudo asks a password). It will be proven by Phase 2's live proof (step 2.7), which exercises the same path.

## 0.4 Consumers of the folder names

| Consumer | What it does | Phase 3 change? |
|---|---|---|
| `public.infer_path_attrs` + triggers on `assets.relative_path`, `style_groups.folder_path` | stage/customer/program | Yes (3.1) |
| `supabase/functions/_shared/metadata-derivation.ts:16-25,80-81` | workflow_status map; `____New Structure` check | Yes, add short keys (3.2). No `WORKFLOW_FOLDER_MAP` override exists in `admin_config`. |
| `src/types/assets.ts:37-44` `STAGE_OPTIONS` | Stage filter values | No (values stay canonical, D8); add comment |
| `supabase/functions/_shared/ingestion-rules.ts:142`, `packages/agent-common/src/ingestion-rules.ts:142`, `src/components/settings/IngestionRulesTab.tsx:150` | "lone PDF in style folder" rule keyed on `____New Structure` | No (anchor not renamed) |
| `apps/worker/src/handlers/popsg-tags.ts:419` | comment only | No |
| `admin_config` `SCAN_ROOTS`, `NAS_MOUNT_ROOT`, `NAS_CONTAINER_MOUNT_ROOT` | do not contain tree names | No |
| `admin_config` request/result blobs (`BULK_OPERATIONS`, `COMPAT_AUDIT_PREVIEW_REQUEST`, `AI_SENTINEL_SCAN_REQUEST`, `BLANK_THUMB_CLEANUP_REQUEST`, `DESIGNER_SPELLING_CLEANUP_BACKUP_2026_11_04`, 644 `sibling_scan_request_*`) | historical job payloads holding paths | No; stale history, not live config |
| Path-keyed tables for the Phase 5 executor rewrite | `assets.relative_path`, `style_groups.folder_path`, `dam_search_documents.path` (~181k), `dam_search_keys.path` (~181k), `asset_checkouts.source_local_path`/`seafile_path` (1 active, 20 discarded), `scanner_ai_ignores.relative_path` (~1.7k), `pdf_text_samples.relative_path` (~28k), `hygiene_findings`, `tiff_optimization_queue`, `ai_sentinel_cleanup_log` | Phase 5 must rewrite or confirm each is derived |

## 0.5 Snapshot and backup setup (edge1)

- Snapshot schedule for share `mac` (task 11): weekdays Mon–Fri, 10:15, 14:15, 18:15 (local).
- Retention (`/usr/syno/etc/synoretention/Share#/mac/policy`, advanced policy): keep 24 hourly, 30 daily, 12 weekly, 12 monthly, minimum 30. **Policy horizon ≈ 12 months.** Observed oldest is 2026-05-29 only because snapshots started then.
- Hyper Backup tasks including `/mac`: task 3 "edgesynology1 to bac" (image, custom rotation keeping up to ~10 years thinned: hourly 2 weeks, daily 6 weeks, weekly 1 year, monthly 2 years, yearly 10 years), last success today; task 15 "Backblaze" (cloud, rotate earliest: hourly 1 day, daily 4 weeks, weekly beyond), last success today.
- O4 consequence: per-file move history must be kept ≥ 12 months (snapshots) — backups go further but are covered by the folder rename log.

## 0.6 Links inside design documents

Sample: 30 `.ai` files across 8 customers (At Home, Burlington, Desperate Signs, Dollar General, Hobby Lobby, Ross, TJX, Walmart), linked paths read from XMP `stRef:filePath` on edge2.

| Class | Documents |
|---|---|
| No linked files | 20 |
| Links only outside the tree (old `R:\Decor\Character Licensed\…` folders, designer desktops, Mac temp) | 7 |
| Links into `____New Structure` by absolute path | 3 (10%) |

All 39 distinct in-tree link targets **already fail to resolve today** (folders were reorganised earlier, e.g. links to `Customer Adopted\Burlington Julie Greer_DIY canvas_SS24\…`, now under `_FINISHED/Burlington_finished/`). Designers already relink or embed. A rename adds no new breakage of working links in this sample → not raised to Albert.

Windows prefix in use: not determinable read-only; assume the longer Synology Drive prefix (~50 chars) → O1 target `relative_path` ≤ 200 stands.
