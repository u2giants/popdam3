---
issue: 778
status: BLOCKED
owner: claude/github-issues-albert-e4caf8
---

# HANDOFF — needs-albert issue sweep, orphan-schema freeze, property-list rulings

- **UTC:** 2026-08-27T17:30Z
- **Machine:** edge-dev
- **Agent:** claude (Opus 5)
- **Worktree:** `C:\repos\shared-db\.claude\worktrees\shared-db-orchestrator-ae40c6`
- **Branch:** `claude/github-issues-albert-e4caf8`

## 1. What and why

Albert asked to be walked through every open `needs-albert` issue on `u2giants/shared-db`, one at a time, and to resolve each in chat. Six were open at the start (#1629, #1609, #1353, #1352, #1238, #778); a seventh (#1646) appeared during the session. The sweep also produced two new owner rulings and one blocked migration.

## 2. Actually done — verified

| Issue | Outcome | Evidence |
|---|---|---|
| #1629 | CLOSED. Albert said "no" to rotating the two MCP bearer tokens. Rotation NOT authorized. | issue closed |
| #1352 | `needs-albert` removed. Fresh-empty-schema `dflow_prod` ruling recorded and already actioned. | label verified clear |
| #1353 | `needs-albert` removed. Owner corrected the premise: production DesignFlow is Cloud SQL, not Supabase. De-escalated to non-production hygiene. | label verified clear |
| #1609 | `needs-albert` removed. Ruling: plain references, validated on write, conditional on GLM 5.3 agreeing — GLM agreed with seven conditions, all recorded. | comment 5441457664; label verified clear |
| #1238 | `needs-albert` removed. Owner ruled the 260 `core.property` rows are **"disposable"** — nothing salvaged. Full feed/consumer investigation posted. | comments 5442503460, 5442625427; label verified clear |
| #1661 | CREATED — ColdLion API feed vs Cloud SQL `dflow` reconciliation, `route: dispatch`, `depends_on: 1352`. | issue exists |
| Rulings | **MERGED to `main`** — `docs/owner-rulings.md` §6.15 amended with the third (reconciled) property-list kind, plus the disposal ruling and its evidence. `AGENTS.md` index row updated. | PR #1672, squash merge `d0fd175d6478c90a889ca3bddefd8c736609daba`; verified by reading both files back off `origin/main` |

**Two label removals silently failed earlier in the session** (#1609, #1353 still carried `needs-albert` after the first `gh issue edit`). Both were re-removed and verified per-issue with `gh issue view --json labels`. **Do not trust `gh issue list --label` output; it is stale. Verify per issue.**

### The two owner rulings, verbatim

> "there needs to be a third: the reconciliation of those 2. the tables that all the apps actually use" — 2026-08-27

Amends §6.15, which had explicitly forbidden a third list. The two kinds (portal scrapes, ColdLion) are **sources**; the reconciled canonical layer is the only layer applications may read. That layer is Universe B (`core.properties_and_characters`), which already carries the licensors' `source_licensed_property_id` / `source_character_id` AND keys to `core."licenseList"`. This does **not** revive Universe A — Universe A carried neither side's keys, which is exactly why it could never be the reconciliation.

> "disposable." — 2026-08-27, of `core.property`'s 260 rows

Nothing salvaged, including the 16 rows stored at character grain. §6.15 step 3 is answered.

### Live investigation behind the disposal ruling (production, read-only, 2026-08-27)

- **Writers:** two governed functions only — `plm.promote_coldlion_source_owned` (status flips from the ColdLion feed) and `public.promote_property_alias_batch`. **No application writer, no trigger, no inbound FK, no PostgREST role grant.** RLS is on (`shared_read` / `admin_write`) but no role holds table privileges.
- **Row provenance:** 255 created 2026-06-25; 5 created 2026-08-25, all `VIACOM MULTI`, all stamped `authority: owner_ruling`, `approval_issue: #539`, `implementation_issue: #1177`. The "growth" was that one authorized batch. **The DesignFlow writer the #1238 dispatch gate waited on does not exist.**
- **Readers:** `api.pm_pipeline_page` joins via `pim.product.property_id` — `pim.product` has 17,909 rows, **0 with `property_id`, 0 with `licensor_id`**, so the join returns nothing. Other readers: `api.db_data_admin_licensor_property_list` / `_tree`, `public.search_style_tracker_link_candidates`, `plm.import_item_master_data`, `plm.compute_taxonomy_immutability_snapshot`, `plm.link_coldlion_licensors_properties_core`, `plm.verify_coldlion_approved_mapping_identity`, `core.reject_redundant_property_alias`, `app.enforce_licensing_write_authority`.
- **Capture wiring:** twelve `plm.*` scrape tables carry `core_property_id` and **every one is 0% populated** across ~6,400 rows (`wb_property_character_normalized` 4,158/0; `opa_property` 1,518/0; `nbcu_property` 249/0; `dcp_property` 237/0; `pmt_property` 134/0; `lucasfilm_dcp_property` 70/0; `marvel_dcp_property` 18/0; portal tiles 11/1/1/0; `api.pmt_properties` 67/0).
- **`core.licensor` is NOT disposable** and is out of scope: `plm.style_tracker_item_bridge.core_licensor_id` is populated on **8,568 of 15,619** rows.

## 3. Preview / production

Nothing was applied to preview or production this session. All database access was read-only. The one migration authored (below) has never been applied anywhere.

## 4. Half-finished — the one real carry-over

**PR https://github.com/u2giants/shared-db/pull/1670 — freeze the orphan `designflow` schema (issue #778).**

Albert authorized it in chat with the single word **"rename it"** on 2026-08-27.

- Migration file: `supabase/migrations/20260827160000_freeze_orphan_designflow_schema.sql`. It renames schema `designflow` to `designflow_frozen_20260710` inside an `if exists` guard and sets a `comment on schema`. Foreign keys track the object, not the name, so both inbound FKs survive the rename intact.
- Branch head: `11997f7`. PR state OPEN, `MERGEABLE`.
- Also in the PR: `docs/verification/cloudsql-designflow-capture-2026-08-27/` (README + 4,010-line read-only Cloud SQL production capture).

**Why the rename and not the drop:** the schema is NOT empty. **1,385 rows across 7 tables**, and two inbound foreign keys that still resolve — `app.RolePermissions` to `designflow."Roles"` (4 rows) and `plm.art_piece_attachment` to `designflow.art_piece` (**2,276 rows**). Grok 4.6 reviewed and **rejected** the earlier plan to re-point the 2,276 attachments onto `dflow.art_piece` and then drop; report at `.ai/reviews/grok-orphan-designflow-repoint-20260827T152007Z-1390799.md`. The DROP stays deferred until those children are disposed of.

## 5. Owned state

- **Worktree is clean.** `git status --short` returns nothing.
- **Open PR owned by this session:** #1670 (above). PR #1672 is merged and closed.
- **Branches:** `claude/github-issues-albert-e4caf8` (pushed, PR #1670). `claude/owner-rulings-20260827` was merged and deleted.
- **Background process still running:** a `bash until`-loop retrying `scripts/manage-migration-author-lanes.mjs --claim` every 120s, writing to `/tmp/claim778.json`. **If this session is gone, that loop is gone.** The next session must re-run the claim by hand (exact command in §6).
- **Local file deliberately NOT in git:** `backups/designflow-orphan-schema-backup-2026-08-27.json` (832,755 bytes) — the full pre-rename capture of all 1,385 rows, verified parseable with correct per-table counts. It contains **real customer and artist email addresses** and `u2giants/shared-db` is a **public** repository, so `backups/` was added to `.gitignore`. **Do not commit it.** If this machine is lost, the backup is lost — that is an accepted trade, but say so rather than assuming it is safe.

## 6. Next steps, in order

1. **Claim a migration lane and merge PR #1670.** All five author lanes were occupied by live claims #1659, #1656, #1584, #1581, #1580 with none expired. Exact command:

```bash
node scripts/manage-migration-author-lanes.mjs --claim --task "Freeze orphan designflow schema (#778)" --owner "<your-worktree-id>" --branch "claude/github-issues-albert-e4caf8" --worktree "<abs path>" --issue 778 --objects "schema designflow_frozen_20260710,schema designflow"
```

   The claim reserves a 14-digit version. **The migration filename must then be renamed to exactly that reserved version** — the lease check requires `filename version == claim version`. Then push and merge.

2. **Dispatch the #1238 drop.** It is now owner-authorized and unblocked. Scope: drop `core.property`, re-point or drop the nine functions listed in §2, and drop the twelve unpopulated `core_property_id` columns. `core.licensor` is **excluded**.
3. **#1646** — needs an explicit Albert instruction naming the production apply before anything runs.
4. **#1609 implementation** — build `plm.source_resolution` + `plm.set_source_resolution`. The uuid-vs-integer question raised in the GLM review is now **settled by the third-kind ruling**: decisions attach to the reconciled row (integer keys), never to `core.property`. The CI-replay collision with the two retired migration files is still open.

## 7. Blocked on

- **PR #1670:** blocked ONLY on migration-lane availability. No Albert decision outstanding — he already said "rename it".
- **#1646:** blocked on Albert naming the production apply. Its own body says "no Albert decision", but a mutating production apply requires owner authorization under Albert's standing rules regardless.
- Nothing else.

## 8. Tried and failed — do not repeat

- **`gh issue list --label` output is stale.** Two `needs-albert` removals reported success and did not take. Verify per issue with `gh issue view --json labels`.
- **Committing the backup JSON failed the `PII forward guard`** — 11 real email addresses at `popcre.com`, `popcre.me`, `gmail.com`, `mail.ru`. Correct fix was to **remove the file from the branch and gitignore it**, NOT to apply the `pii-guard-allow` label. Do not label your way past that guard on a public repo.
- **The rulings were originally committed onto the same branch as the migration**, which parked documentation behind the lane queue. They were cherry-picked onto a fresh branch off `main` and merged separately. **Never bundle docs with a migration** — the lane gate blocks the whole PR.
- **1Password reference with parentheses fails to parse.** The `DesignFlow PRODUCTION Cloud SQL - read-only (...)` item title breaks the `op://` parser. Use the item ID `tcaf3o3u2cx52g6ivvczxbhola`.
- **Earlier claim, now corrected:** an earlier statement that `dflow_prod` was "19 tables behind" was **wrong**. It was measured against `dflow` (test), which carries the Sampling module — built on Supabase only and deliberately never in Cloud SQL (owner ruling #707). Measured against Cloud SQL production, `dflow_prod` is a **complete** structural copy: 103 tables each side, **0 columns missing, 0 with differing type / length / precision / scale / nullability**. The 11 extra `dflow_prod` columns all belong to `dflow_prod."AuditLogHistory"`, confirmed a VIEW. Full comparison at `docs/verification/cloudsql-designflow-capture-2026-08-27/README.md`.
- **`ai-glm` is not on PATH in Git Bash** — run it from the PowerShell tool.
- Windows Python writes `C:\tmp`, Git-Bash reads `/tmp` — use `cygpath -w` and strip CRLF before comparing files across the two.
- **`pg_get_functiondef` throws on aggregates.** Filter `p.prokind='f'` when scanning routine bodies, or the whole catalog query fails.

## 9. Possibly stale

Every SHA, run state, lane occupancy and queue position must be re-read live. Lane occupancy in particular changes by the minute. The `needs-albert` list as of session close was **#1646 and #778 only** — #778 keeps the label because the deferred DROP still needs a future owner decision, not because the rename is unresolved.
