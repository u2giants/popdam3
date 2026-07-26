# Handoff — ColdLion licensor/property Phase 6 (IN PROGRESS)

## 1. What this application is

`u2giants/shared-db` owns the shared Supabase schema and data-integration contracts. Licensors and
Properties live in `core.licensor` / `core.property`. **Phase 6** is the parallel-run observation
window on **preview only**: scheduled ColdLion `mirror_only` + DesignFlow master-data sync + daily
comparison + health/alerts for **≥14 real calendar days**.

## 2. What a developer walking in today must know

| Fact | Value |
|---|---|
| Preview | `rjyboqwcdzcocqgmsyel` |
| Production | `qsllyeztdwjgirsysgai` — **never touched in Phase 6** |
| Migration | `20260726180000` **applied** — **never edit that file** |
| Machinery (6A) | **COMPLETE** |
| GitHub workflow proof | **COMPLETE** (after parser-fix PR #233) |
| Schedules | **ACTIVE** (`PHASE6_SCHEDULE_ENABLED=true` since 2026-07-26T13:27:41Z) |
| Phase 6 overall | **IN PROGRESS** — 14-day gate open |
| Clock day 1 | **2026-07-26** |
| Earliest exit | **2026-08-09** (only if 14 distinct green scheduled dates + §9.4) |
| **Exact next action** | **Monitor scheduled GHA runs and append-only observations. Do not start Phase 7.** |

Full evidence IDs:
[`docs/verification/coldlion-licensor-property-phase6-20260726/README.md`](docs/verification/coldlion-licensor-property-phase6-20260726/README.md).

## 3. Current state (2026-07-26) — machinery + workflow COMPLETE; observation gate open

### Headline

| Item | Status |
|---|---|
| Phase 6A schema + tools | **COMPLETE** (applied + contracts) |
| GHA secrets | `COLDLION_API_KEY`, `DESIGNFLOW_API_KEY` set from 1Password (names only); plus existing Supabase preview secrets |
| Parser fix | PR **#233**, merge **`18ab164ce503ba875413a7d4573597032c56be81`** |
| Workflow integration proof | **COMPLETE** (see §3.2) |
| Preview schedules | **ACTIVE** |
| 14-day clock | **STARTED 2026-07-26 (day 1)** |
| Phase 6 exit | **Not yet** — still **IN PROGRESS** |
| Phase 7 / 8 | **Forbidden until Phase 6 exits + Albert production window** |

### Entry prerequisites

| Gate | Status |
|---|---|
| Phase 3 complete | Yes |
| Phase 4 542 links | Yes (preview) |
| Phase 5 | NOT NEEDED |
| Schedules/alerts tested | **Yes** — GHA green + force-fail drills |
| 14 green scheduled days | **In progress** |

### Final baseline snapshot (2026-07-26 09:28 EDT)

Canonical **26/256**; mirror **44/516**; refs **1047** = **542** ColdLion + **505** DesignFlow;
links **38/504**. Hashes:

| Hash | Value |
|---|---|
| Licensor UUID | `590ea83ea6df1487fcfc1e18b3ef6a0d` |
| Property UUID | `e0e6c36eb02bb2d320c0deaff7aa8f8c` |
| Licensor status | `d9b07759bf80ff227e2fa9bd635d2138` |
| Property status | `f436d4acd79761fedbfc9b5796ac7bce` |
| Parent-edge | `7459f6826cc59468779e7ead33ec0edc` |
| Combined status | `5960fa4c08b5da2d0880c138e3e32ef7` |
| Source-ref | `5585216ad77d3aec0f1dbbba802f1e36` |

### 3.1 Source names

| Lane | `source_system` / `source_name` |
|---|---|
| ColdLion | `coldlion` / `coldlion_licensors_properties_api` |
| DesignFlow | `designflow_plm` / `plm_master_data_api` |
| Comparison | `shared_db` / `coldlion_designflow_daily_comparison` |
| Health | `shared_db` / `coldlion_designflow_sync_health` |

### 3.2 Final GHA workflow proof (COMPLETE)

| Workflow run | Job | Outcome | DB IDs |
|---|---|---|---|
| **30203333356** | DesignFlow | **PASS** | run `0a3c5474-2f33-49a4-926a-ef888ddbb826` |
| **30203361246** | ColdLion mirror_only | **PASS** | run `9b0b9f1c-f4b6-46b4-ba8a-4f1320470b4b` (560 unchanged; snapshot `a69332e05d9064723ffa1dfbd870506c`) |
| **30203386465** | Comparison (pre-parser-fix) | Runner exit **2**; **DB green** observation `bf9e8daf-84d9-49a1-8958-39aa987adeb4` | Retained as caught parser failure |
| **30203975505** | Green comparison (post-fix) | **PASS** exit 0 | comparison `a3776002-637b-4ca8-b0f4-a6d026a7f1c9`; observation **`16373e68-6f72-43ad-8219-7c999799675d`** pass true |
| **30204001916** | Green health (post-fix) | **PASS** exit 0 | health **`0332f071-b632-4fe4-ad7b-3d48168451da`** ok true |
| **30204031010** | Forced comparison | **PASS-as-drill** exit **1** (`pass=false`) | comparison `9bb99f4b-524f-4e25-9f6e-601afce92aed`; drill obs **`ca8d6615-5fcd-4243-ab7a-de1db23842a1`** |
| **30204054859** | Forced health | **PASS-as-drill** exit **1** (`ok=false`) | health **`7f5fa415-6d9e-4cf3-b131-b278e830dae5`** |

Parser fix path: Go-style `map[...]` box cells, fail-closed on garbage, **duplicate keys rejected**.

### 3.3 Schedule

| Item | Value |
|---|---|
| Variable | `PHASE6_SCHEDULE_ENABLED=true` |
| Enabled at | **2026-07-26T13:27:41Z** |
| Cadence | DesignFlow `30 3 * * *`; ColdLion `0 4 * * *`; compare `0 5 * * *`; health `15 */6 * * *` (exact `github.event.schedule` match) |

### Design notes still in force

1. Append-only UUID observations; drills never overwrite green daily rows.
2. Phase 4 baseline pins on every non-drill observation.
3. Schedule dispatch: exact cron string only (no wall-clock).
4. CLI parse fail-closed (exit 2 on unparseable; never treat exit 2 as success).
5. Never edit applied migration `20260726180000`.

## 4. What we tried / rejected (history)

| Approach | Outcome |
|---|---|
| Edge Function + Vault + pg_net for Phase 6A | Rejected — used GHA + existing Node runners |
| Date PK + ON CONFLICT UPDATE | Rejected — erase same-day green evidence |
| Wall-clock schedule mapping | Rejected |
| JSON-only CLI parse | **Failed in production GHA** (run 30203386465) → fixed PR #233 |
| Editing applied migration | Forbidden |

## 5. Exact next steps

1. **Monitor** scheduled Phase 6 GitHub Actions runs (preview only).
2. **Confirm** each day has a non-drill `pass=true` observation (and lane successes) in append-only evidence.
3. After **14 distinct green scheduled dates**, run a fresh evaluation session against cutover §9.4.
4. Earliest calendar claim of exit: **2026-08-09** if all criteria hold — do not claim earlier.
5. **Do not start Phase 7 or Phase 8** without Phase 6 exit + Albert’s explicit production window.

## 6. Constraints and gotchas

- Preview only for Phase 6 observation until Phase 7 is separately approved.
- Never `--include-all` promote unrelated migrations to production.
- NASA unlinked; Phase 5 creates blocked; 542 ColdLion links preserved.
- Secret **names** only in docs; values live in GitHub secrets / 1Password `vibe_coding`.

## 7. Access and environment

- Preview pooler port 6543; 1Password vault `vibe_coding` for local work.
- GHA uses repo secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PREVIEW`,
  `COLDLION_API_KEY`, `DESIGNFLOW_API_KEY`.

## 8. Open items

- Collect remaining green **scheduled** observation days through the 14-day gate.
- Production promotion of Phase 4+6 migrations = separate approved window (not this phase).

## Forward-impact audit

- Phase 7 may begin only after Phase 6 exit evidence + Albert production approval.
- Phase 8 still requires Phase 7 stability + relationship/status curation ownership.
- No app consumer deploy required for observation machinery.

## Handoff self-audit

1. Street newcomer knows machinery is done and only the calendar gate remains? **Yes** (§2–§3).
2. All workflow + DB IDs recorded? **Yes** (§3.2 + verification README).
3. Parser failure retained without blocking proof claim after fix? **Yes** (30203386465 historical).
4. Exact next action single sentence? **Yes** — monitor schedules; no Phase 7.
5. Production untouched? **Yes**.
