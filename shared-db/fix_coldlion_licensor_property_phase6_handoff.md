# Handoff — ColdLion licensor/property Phase 6 (IN PROGRESS)

## 1. What this application is

`u2giants/shared-db` owns the shared Supabase schema and data-integration contracts. Licensors and
Properties are stable in `core.licensor` / `core.property`. Phase 6 is the **parallel-run
observation window**: ColdLion `mirror_only` + DesignFlow master-data sync + daily comparison +
alerts, with durable evidence for ≥14 real days on **preview only**.

## 2. What was delivered (Phase 6A)

- Migration `20260726180000` (append-only observation/alerts, Phase 4 baseline pins, drills)
- Node tools + preview guards + schedule map
- workflow_dispatch-first GitHub Actions workflow (schedule gated by `PHASE6_SCHEDULE_ENABLED`)
- Local unit/static tests + rolled-back SQL contracts
- Docs / verification package

**Never edit** the applied migration
`supabase/migrations/20260726180000_coldlion_licensor_property_phase6_parallel_run.sql`.
New schema needs a new timestamped migration only.

## 3. Current state (2026-07-26) — PREVIEW applied; clock STARTED day 1; Phase 6 still IN PROGRESS

### Headline

| Item | Status |
|---|---|
| Preview project | `rjyboqwcdzcocqgmsyel` |
| Migration `20260726180000` | **Applied** (dry-run listed only it) |
| Production `qsllyeztdwjgirsysgai` | **Untouched** |
| Day-1 dual-lane + green compare/health | **Verified** (IDs below) |
| Forced-failure drills | **Verified** (exit 1; append-only beside green row) |
| Rolled-back SQL contracts | **PASS** (comment-strip fixture preserved) |
| 14-day clock | **STARTED 2026-07-26** (day 1) |
| Phase 6 complete? | **No** — still **IN PROGRESS** |
| Earliest possible exit date | **2026-08-09**, only with 14 distinct green **scheduled** days + §9.4 |
| Phase 7 / 8 | **Not started; forbidden until Phase 6 exits** |
| GHA secrets / dispatch / schedule enable | Secrets exist; schedule path still being hardened |
| Workflow integration | **Partial** — run `30203386465` was DB-green but runner parse failed (see §3.1) |

### Entry prerequisites

| Gate | Status |
|---|---|
| Phase 3 complete | Yes |
| Phase 4 542 links on preview | Yes |
| Phase 5 | NOT NEEDED |
| Day-1 machinery + manual lanes proven | **Yes** (this handoff §3) |
| Schedules enabled + 14 green scheduled days | **Not yet** |
| ≥14 days evidence | **Day 1 of ≥14** |

### N1 live snapshot (reproduced exactly on preview)

| Check | Value |
|---|---|
| Licensors / properties | 26 / 256 |
| Mirror | 44 / 516 |
| Total / ColdLion / DesignFlow refs | 1047 / 542 / 505 |
| Links | 38 licensor + 504 property |
| Licensor UUID hash | `590ea83ea6df1487fcfc1e18b3ef6a0d` |
| Property UUID hash | `e0e6c36eb02bb2d320c0deaff7aa8f8c` |
| Licensor status hash | `d9b07759bf80ff227e2fa9bd635d2138` |
| Property status hash | `f436d4acd79761fedbfc9b5796ac7bce` |
| Parent-edge hash | `7459f6826cc59468779e7ead33ec0edc` |
| Combined status hash | `5960fa4c08b5da2d0880c138e3e32ef7` |
| Source-ref hash | `5585216ad77d3aec0f1dbbba802f1e36` |

### Verified day-1 runs (preview)

| Kind | ID | Notes |
|---|---|---|
| DesignFlow sync | `2fbc1653-e8ed-452f-8527-e1bf2761e25f` | 37 licensors, 468 properties, 57 customers |
| ColdLion mirror_only | `f71705f5-4778-47b0-a8e8-bb6233060933` | prior 44/516; 560 unchanged; 0 ins/upd; snapshot `a69332e05d9064723ffa1dfbd870506c` |
| Green observation | `a7de69bc-60d8-4d77-8b62-1e5af37fe28b` | non-drill; pass true; zero diffs |
| Green comparison run | `62843601-1a94-4081-9fa0-e324d14a5f89` | |
| Green health run | `8d585094-1bac-4343-8b25-8465ce3dbb05` | ok true; zero issues |
| Comparison drill observation | `f5f6129a-21ec-4c23-a3ff-cdad22993da4` | is_drill; expected exit 1 |
| Comparison drill run | `c4c76bd5-b4a2-459b-9c5d-e99c5c80e05d` | |
| Comparison drill alert | `50ffcfc2-58f8-4e50-97ac-0a9866579a6f` | |
| Health drill run | `5af6aecd-bdf7-4a4a-9a42-1e8c446da441` | expected exit 1 |
| Health drill alert | `77521ad3-e0dd-4aea-8047-cd7c3338e018` | |

Final read-only snapshot after drills: all §N1 counts/hashes reproduced; green non-drill observation
still exists beside the failed drill (append-only proven live).

Evidence package:
[`docs/verification/coldlion-licensor-property-phase6-20260726/README.md`](docs/verification/coldlion-licensor-property-phase6-20260726/README.md).

### 3.1 Workflow run 30203386465 — DB green, runner integration failure (NOT workflow proof)

| Item | Value |
|---|---|
| GitHub Actions run | **30203386465** (merged Phase 6 workflow) |
| Environment | Ubuntu runner + `supabase db query` |
| DB outcome | **Succeeded** — green observation inserted `bf9e8daf-84d9-49a1-8958-39aa987adeb4` with `pass:true` |
| Runner outcome | **Failed closed exit 2** — `parseComparisonResult` returned `null` |
| Root cause | Hosted Supabase CLI rendered the jsonb function result as a Unicode box table whose cell is a **Go-style** `map[key:value …]` dump (key order not fixed; values include `<nil>`, bools, ints, UUIDs, `[]`). The parser only accepted JSON/envelope shapes. |
| What this is not | Not a Phase 4 baseline drift, not a failed observation write, not production impact. |
| Permanent fix branch | `codex/coldlion-phase6-cli-parser-fix` — shared `tools/phase6-cli-result-parse.mjs` for comparison **and** health; regression fixtures from real Go-map box output; fail-closed preserved for garbage; exit 2 still failure; **duplicate map keys rejected** (no later-value shadowing). |
| Next verification (supervising) | Re-run GHA compare + health (green + force-fail) on preview after merge of parser fix; require runner exit **0** on green and **1** on force-fail (not 2). **Do not claim workflow proof complete until those exits are green.** |

### Source names (unchanged)

| Lane | `source_system` / `source_name` |
|---|---|
| ColdLion | `coldlion` / `coldlion_licensors_properties_api` |
| DesignFlow | `designflow_plm` / `plm_master_data_api` |
| Comparison | `shared_db` / `coldlion_designflow_daily_comparison` |
| Health | `shared_db` / `coldlion_designflow_sync_health` |

### Design notes still in force

1. Append-only UUID observation rows; drills never overwrite green daily evidence.
2. Phase 4 baseline pins on **every** non-drill observation (including first day).
3. Schedule dispatch must use exact `github.event.schedule` (no wall-clock).
4. CLI parse fail-closed (exit 2 if unparseable).
5. SQL contracts strip comments before ON CONFLICT scan — preserve that fixture.

## 4. What we tried / rejected (history)

| Approach | Outcome |
|---|---|
| Edge Function + Vault + pg_net | Rejected for Phase 6A |
| Date PK + ON CONFLICT UPDATE | Rejected — would erase same-day green evidence |
| Wall-clock schedule mapping | Rejected (GLM I2) |
| Silent first-day baseline | Rejected — Phase 4 pins always |
| Editing applied migration `20260726180000` | **Forbidden** |

## 5. Exact next steps (supervising agent)

1. Merge `codex/coldlion-phase6-cli-parser-fix` (shared Go-map CLI parser + fixtures).
2. Re-dispatch Phase 6 workflow jobs on **preview**: compare (expect exit 0), force-fail-compare
   (expect exit 1), health (expect exit 0), force-fail-health (expect exit 1). Confirm no exit 2.
3. Only after step 2: treat GHA path as integration-proven; then enable
   `PHASE6_SCHEDULE_ENABLED=true` if still pending.
4. Collect **14 distinct green scheduled observation days** (§9.4). Day 1 manual + DB row
   `bf9e8daf-…` count toward evidence but **workflow proof is not complete** until step 2.
5. Earliest calendar exit: **2026-08-09** if all criteria hold — do not claim earlier.
6. **Do not start Phase 7/8** without Albert’s production window and Phase 6 exit.

## 6. Constraints and gotchas

- Preview only for ongoing Phase 6 observation apply/schedule until Phase 7 is separately approved.
- Never edit `20260726180000_…phase6_parallel_run.sql`.
- Never promote with `--include-all` to production as a side effect.
- NASA unlinked; Phase 5 creates blocked; 542 links preserved.
- Hosted default privileges: keep browser EXECUTE off write wrappers on any future functions.

## 7. Access and environment

- Preview: `rjyboqwcdzcocqgmsyel`, pooler 6543; credentials from 1Password vault `vibe_coding`.
- Production credentials/URLs must not be used for Phase 6 observation work.

## 8. Open items

- GHA secrets presence and schedule enable (supervising agent).
- Remaining 13+ green scheduled days after day 1.
- Production promotion of Phase 4+6 migrations remains a **separate** approved window (not Phase 6).

## Forward-impact audit

- Phase 7 entry needs full §9.4 package + Albert production window; day-1 alone is insufficient.
- Phase 8 unchanged: DesignFlow continues through Phase 6.
- No consumer app deploy required for Phase 6 observation machinery.

## Handoff self-audit

1. Fresh developer can continue observation without chat context? **Yes** — run IDs, hashes, clock start, earliest exit, pending GHA steps.
2. Could they avoid re-applying or editing the migration? **Yes** — applied; edit forbidden.
3. Day-1 vs 14-day confusion avoided? **Yes** — clock started; exit not claimed; earliest 2026-08-09.
4. Production untouched stated? **Yes**.
5. Next gates concrete? **Yes** — §5.
