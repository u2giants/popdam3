# ColdLion Licensor/Property Phase 6 — parallel-run evidence (IN PROGRESS)

**Date:** 2026-07-26
**Branch:** `codex/coldlion-licensor-property-phase6`
**Environment:** preview `rjyboqwcdzcocqgmsyel` only
**Production `qsllyeztdwjgirsysgai`:** **untouched**
**Phase status:** **IN PROGRESS**
**14-day observation clock:** **STARTED 2026-07-26 (day 1 evidence recorded)**
**Earliest possible Phase 6 exit date:** **2026-08-09**, and only if there are **14 distinct green scheduled days** plus full §9.4 exit criteria — one manual day does **not** complete Phase 6.

This folder records verified preview results for Phase 6A machinery and **day-1**
manual dual-lane + comparison + health evidence. It does **not** claim the 14-day
gate is complete, production cutover, Phase 5 creates, NASA link, or Phase 7/8.

---

## 1. Migration apply (preview)

| Item | Result |
|---|---|
| Migration | `20260726180000_coldlion_licensor_property_phase6_parallel_run.sql` |
| Target | preview `rjyboqwcdzcocqgmsyel` |
| Dry-run | Listed **only** this migration |
| Apply | **Applied** to preview |
| Production | **Never** linked or applied |

**Do not edit the applied migration file.** Further schema changes need a new
timestamped migration.

Rolled-back SQL contracts (`supabase/tests/coldlion_licensor_property_phase6_contracts.sql`)
**PASS** on preview after the supervising-agent fixture correction that strips SQL
comments before scanning for forbidden `ON CONFLICT` text. Preserve that test fix.

---

## 2. N1 live snapshot (baseline reproduced exactly)

Measured on preview after Phase 6 migration apply; matches Phase 4 immutability pins:

| Check | Value |
|---|---|
| Canonical licensors | **26** |
| Canonical properties | **256** |
| Mirror licensors / properties | **44 / 516** |
| `taxonomy_source_ref` total | **1047** |
| ColdLion refs (`coldlion` / `merchGroupDetails`) | **542** |
| DesignFlow refs (`designflow_plm`) | **505** |
| Linked `plm.erp_licensor` | **38** |
| Linked `plm.erp_property` | **504** |
| Licensor UUID hash | `590ea83ea6df1487fcfc1e18b3ef6a0d` |
| Property UUID hash | `e0e6c36eb02bb2d320c0deaff7aa8f8c` |
| Licensor status hash | `d9b07759bf80ff227e2fa9bd635d2138` |
| Property status hash | `f436d4acd79761fedbfc9b5796ac7bce` |
| Parent-edge hash | `7459f6826cc59468779e7ead33ec0edc` |
| Combined status hash | `5960fa4c08b5da2d0880c138e3e32ef7` |
| Source-ref hash | `5585216ad77d3aec0f1dbbba802f1e36` |

---

## 3. Day-1 manual lane runs (preview)

### DesignFlow (`designflow_plm` / `plm_master_data_api`)

| Field | Value |
|---|---|
| `ingest.sync_run` id | `2fbc1653-e8ed-452f-8527-e1bf2761e25f` |
| Payload counts | **37** licensors, **468** properties, **57** customers |

### ColdLion `mirror_only` (`coldlion` / `coldlion_licensors_properties_api`)

| Field | Value |
|---|---|
| `ingest.sync_run` id | `f71705f5-4778-47b0-a8e8-bb6233060933` |
| Prior mirror counts | **44 / 516** |
| Accounting | **560** unchanged; **0** inserted; **0** updated |
| Snapshot hash | `a69332e05d9064723ffa1dfbd870506c` |

Identical re-pull behavior matches Phase 2B snapshot identity (same hash family as prior
mirror-only evidence).

---

## 4. Green daily comparison + health (day 1 non-drill)

### Observation (non-drill, pass)

| Field | Value |
|---|---|
| Observation id | `a7de69bc-60d8-4d77-8b62-1e5af37fe28b` |
| Comparison `sync_run` id | `62843601-1a94-4081-9fa0-e324d14a5f89` |
| `pass` | **true** |
| Diffs | **zero** |
| `is_drill` | **false** |

### Health (green)

| Field | Value |
|---|---|
| Health `sync_run` id | `8d585094-1bac-4343-8b25-8465ce3dbb05` |
| `ok` | **true** |
| Issues | **zero** |

This green non-drill observation is **day 1** of the Phase 6 clock (2026-07-26).

---

## 5. Forced-failure drills (append-only; expected non-zero exit)

### Comparison drill

| Field | Value |
|---|---|
| Observation id | `f5f6129a-21ec-4c23-a3ff-cdad22993da4` |
| Comparison `sync_run` id | `c4c76bd5-b4a2-459b-9c5d-e99c5c80e05d` |
| Alert id | `50ffcfc2-58f8-4e50-97ac-0a9866579a6f` |
| Exit | **1** (expected) |
| Notes | Failed drill row **appended**; does not erase green non-drill observation |

### Health drill

| Field | Value |
|---|---|
| Health `sync_run` id | `5af6aecd-bdf7-4a4a-9a42-1e8c446da441` |
| Alert id | `77521ad3-e0dd-4aea-8047-cd7c3338e018` |
| Exit | **1** (expected) |

### Final read-only proof after drills

- Every count/hash in §2 reproduced again.
- Green non-drill observation `a7de69bc-60d8-4d77-8b62-1e5af37fe28b` **still present**
  beside failed drill observation `f5f6129a-21ec-4c23-a3ff-cdad22993da4`.

---

## 6. Clock and exit criteria (not complete)

| Item | Status |
|---|---|
| Clock start | **2026-07-26** (day 1 manual green evidence) |
| Days completed | **1** of ≥14 |
| Earliest calendar date Phase 6 *could* exit | **2026-08-09** |
| Exit still requires | **14 distinct green scheduled days**, dual-lane successes, daily comparisons, no unexplained failures, §9.4 criteria |
| Phase 6 complete? | **No** — still **IN PROGRESS** |

Supervising-agent **pending** (not claimed done here):

- Git commit / PR / merge for remaining branch work if any
- Confirm GitHub secrets (`COLDLION_API_KEY`, `DESIGNFLOW_API_KEY`, plus existing Supabase preview secrets)
- Workflow `workflow_dispatch` dry-runs and schedule enable (`PHASE6_SCHEDULE_ENABLED=true`)
- Ongoing scheduled observation through day 14+

---

## 7. Explicit non-claims

- Production was **not** accessed or modified.
- Phase 7 production cutover **not** started.
- Phase 8 DesignFlow deprecation **not** started.
- Phase 5 creates **not** reopened; NASA **not** linked.
- Applied migration `20260726180000` must **not** be edited; corrections need new migrations only.
- One successful manual day is **not** 14 days of scheduled parallel-run evidence.

---

## 8. Pointers

| Artifact | Path |
|---|---|
| Phase 6 handoff | [`fix_coldlion_licensor_property_phase6_handoff.md`](../../../fix_coldlion_licensor_property_phase6_handoff.md) |
| Cutover plan | [`fix_coldlion_licensor_property_cutover.md`](../../../fix_coldlion_licensor_property_cutover.md) |
| Phase 4 links | [`../coldlion-licensor-property-phase4-20260725/`](../coldlion-licensor-property-phase4-20260725/README.md) |
| Phase 5 NOT NEEDED | [`../coldlion-licensor-property-phase5-not-needed-20260726/`](../coldlion-licensor-property-phase5-not-needed-20260726/README.md) |
