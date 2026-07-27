# ColdLion Licensor/Property Phase 6 — parallel-run evidence (IN PROGRESS)

**Date:** 2026-07-26
**Environment:** preview `rjyboqwcdzcocqgmsyel` only
**Production `qsllyeztdwjgirsysgai`:** **untouched**
**Phase 6 overall:** **IN PROGRESS** (accelerated invariant-readiness gates open)
**Phase 6A machinery + GitHub workflow proof:** **COMPLETE**
**Historical observation schedule:** **STARTED 2026-07-26**; elapsed-time gate retired later that day
**Active exit:** accelerated readiness plan + §9.4 + explicit durable production approval

Parser-fix merge: **`18ab164ce503ba875413a7d4573597032c56be81`** (PR **#233**).
Schedule active: repository variable **`PHASE6_SCHEDULE_ENABLED=true`** at **2026-07-26T13:27:41Z**.

This folder is the street-newcomer record of Phase 6A deploy, day-1 evidence, parser failure/fix,
and **final GHA workflow proof**. It does **not** claim accelerated readiness, production
cutover, Phase 5 creates, NASA link, or Phase 7/8.

---

## 0. What a fresh developer must know

| Question | Answer |
|---|---|
| What is Phase 6? | Preview parallel-run machinery plus deterministic identity/invariant, breaker, alert, and rollback readiness |
| Is the plumbing done? | **Yes** — migration applied, runners work in GHA, secrets set, schedules **ACTIVE** |
| Is Phase 6 done? | **No** — accelerated readiness implementation remains open |
| Historical schedule start | **2026-07-26**; evidence only |
| Earliest exit calendar date | **None** — readiness is invariant-based, not calendar-based |
| Exact next action | Implement/prove the accelerated plan on preview; preserve observations; do **not execute** Phase 7 |
| Production | Untouched |

---

## 1. Migration apply (preview)

| Item | Result |
|---|---|
| Migration | `20260726180000_coldlion_licensor_property_phase6_parallel_run.sql` |
| Target | preview `rjyboqwcdzcocqgmsyel` |
| Dry-run | Listed **only** this migration |
| Apply | **Applied** |
| Production | **Never** linked or applied |

**Do not edit the applied migration.** Further schema needs a new timestamped file.

Rolled-back SQL contracts PASS (comment-strip fixture before ON CONFLICT scan — preserve it).

---

## 2. Final baseline snapshot (2026-07-26 09:28 EDT) — exact

| Check | Value |
|---|---|
| Canonical licensors / properties | **26 / 256** |
| Mirror licensors / properties | **44 / 516** |
| `taxonomy_source_ref` total | **1047** |
| ColdLion refs | **542** |
| DesignFlow refs | **505** |
| Linked licensors / properties | **38 / 504** |
| Licensor UUID hash | `590ea83ea6df1487fcfc1e18b3ef6a0d` |
| Property UUID hash | `e0e6c36eb02bb2d320c0deaff7aa8f8c` |
| Licensor status hash | `d9b07759bf80ff227e2fa9bd635d2138` |
| Property status hash | `f436d4acd79761fedbfc9b5796ac7bce` |
| Parent-edge hash | `7459f6826cc59468779e7ead33ec0edc` |
| Combined status hash | `5960fa4c08b5da2d0880c138e3e32ef7` |
| Source-ref hash | `5585216ad77d3aec0f1dbbba802f1e36` |

---

## 3. Early day-1 manual / local preview runs (historical)

These predate full GHA proof; retained for continuity.

| Kind | ID | Notes |
|---|---|---|
| DesignFlow (manual) | `2fbc1653-e8ed-452f-8527-e1bf2761e25f` | 37 licensors, 468 properties, 57 customers |
| ColdLion mirror (manual) | `f71705f5-4778-47b0-a8e8-bb6233060933` | 560 unchanged; snapshot `a69332e0…` |
| Green observation (manual) | `a7de69bc-60d8-4d77-8b62-1e5af37fe28b` | pass true |
| Comparison drill (manual) | `f5f6129a-21ec-4c23-a3ff-cdad22993da4` | is_drill; exit 1 |
| Health drill (manual) | run `5af6aecd-…` | exit 1 |

---

## 4. Final GitHub Actions workflow proof (COMPLETE)

Parser fix: merge **`18ab164ce503ba875413a7d4573597032c56be81`** / **PR #233**
(`tools/phase6-cli-result-parse.mjs` — Go-style `map[...]` box cells + fail-closed + duplicate-key reject).

### 4.1 Lane workflows

| Job | Workflow run | Result | DB `ingest.sync_run` | Notes |
|---|---|---|---|---|
| DesignFlow | **30203333356** | **PASS** | `0a3c5474-2f33-49a4-926a-ef888ddbb826` | GHA DesignFlow sync |
| ColdLion `mirror_only` | **30203361246** | **PASS** | `9b0b9f1c-f4b6-46b4-ba8a-4f1320470b4b` | 44/516 prior; **560 unchanged**; snapshot `a69332e05d9064723ffa1dfbd870506c` |

### 4.2 Pre-fix comparison (retained as caught failure)

| Item | Value |
|---|---|
| Workflow run | **30203386465** |
| Runner | Exit **2** (parser null on Go-map box cell) |
| DB | Green observation **`bf9e8daf-84d9-49a1-8958-39aa987adeb4`** (`pass:true`) still valid as DB evidence |
| Role | Historical proof that fail-closed worked; **not** integration success |

### 4.3 Post-parser-fix comparison + health (green)

| Job | Workflow run | Result | DB IDs |
|---|---|---|---|
| Green comparison | **30203975505** | **PASS** (runner exit 0) | comparison `a3776002-637b-4ca8-b0f4-a6d026a7f1c9`; observation **`16373e68-6f72-43ad-8219-7c999799675d`** (`pass:true`) |
| Green health | **30204001916** | **PASS** (runner exit 0) | health **`0332f071-b632-4fe4-ad7b-3d48168451da`** (`ok:true`) |

### 4.4 Post-parser-fix force-fail drills (PASS-as-drill = expected exit 1)

| Job | Workflow run | Result | DB IDs |
|---|---|---|---|
| Forced comparison | **30204031010** | **PASS-as-drill** — parser reported `pass=false`, exit **1** | comparison `9bb99f4b-524f-4e25-9f6e-601afce92aed`; drill observation **`ca8d6615-5fcd-4243-ab7a-de1db23842a1`** |
| Forced health | **30204054859** | **PASS-as-drill** — parser reported `ok=false`, exit **1** | health **`7f5fa415-6d9e-4cf3-b131-b278e830dae5`** |

No exit **2** on corrected runs.

### 4.5 Scheduled monitoring observations (append-only)

This ledger records unattended `schedule` events after
`PHASE6_SCHEDULE_ENABLED=true`. A health-only event proves scheduler routing and health
evaluation; it does **not** establish cutover readiness without the other accelerated gates.

| Scheduled date (UTC) | Workflow run | Exact schedule / lane | Result | Preview DB evidence | Qualifying-date ruling |
|---|---|---|---|---|---|
| **2026-07-26** | **30217172947** | `15 */6 * * *` / health | **PASS**; preview guard, schedule gate, 98 offline tests, preview link, and health step all passed; DesignFlow, ColdLion, comparison, and drills correctly skipped | non-drill health **`c738beac-fd63-44ae-9a90-5a67576c61aa`**; `ok:true`; `issues:[]`; ColdLion run `9b0b9f1c-f4b6-46b4-ba8a-4f1320470b4b`; DesignFlow run `0a3c5474-2f33-49a4-926a-ef888ddbb826`; latest non-drill observation `16373e68-6f72-43ad-8219-7c999799675d`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It proves health routing, not full accelerated readiness. |
| **2026-07-27** | **30236047002** | `15 */6 * * *` / health | **PASS**; preview guard, 98 offline tests, preview link, and health passed; source, comparison, and drill lanes correctly skipped | non-drill health **`0f971d44-6355-4f28-9a3f-9295db84a248`**; `ok:true`; `issues:[]`; prior ColdLion run `9b0b9f1c-f4b6-46b4-ba8a-4f1320470b4b`; prior DesignFlow run `0a3c5474-2f33-49a4-926a-ef888ddbb826`; refs/links **542 / 38 / 504** | **Supporting evidence only.** Health remained green before the day's source lanes. |
| **2026-07-27** | **30243839143** | `30 3 * * *` / DesignFlow | **PASS**; DesignFlow preview sync completed; other lanes correctly skipped | sync run **`e14de3e0-c9a0-4730-b205-bdad5df9bb4e`**; licensors/properties/customers seen **37 / 468 / 57**; raw records upserted **562** | **Partial evidence.** One source lane passed; this run alone does not prove readiness. |
| **2026-07-27** | **30246402428** | `0 4 * * *` / ColdLion `mirror_only` | **PASS**; ColdLion preview mirror completed; DesignFlow, comparison, health, and drills correctly skipped | sync run **`295ac8fb-d8f5-4017-9292-0449789990bf`**; rows **560**; inserted/updated/unchanged **0 / 0 / 560**; licensors/properties **44 / 516**; divisions **2**; cross-entity collisions **30**; snapshot hash **`a69332e05d9064723ffa1dfbd870506c`** | **Partial evidence.** The mirror was unchanged and successful, but this run alone does not prove readiness. |
| **2026-07-27** | **30249661878** | `0 5 * * *` / daily comparison | **PASS**; complete scheduled DesignFlow + ColdLion pairing passed comparison with no unexplained differences | observation **`c72852e3-428b-4716-abcb-823bac769505`**; comparison run **`544f6995-82f1-457e-aa3a-552e784cec6e`**; `pass:true`; `diffs:[]`; `unexplained_diff_count:0`; baseline, both source lanes, link checks, and immutability all true; canonical licensors/properties **26 / 256**; linked rows **38 / 504**; ColdLion refs **542**; DesignFlow refs **505**; hashes recorded for licensor UUID/status, property UUID/status, parent edges, source refs, and overall status | **Strong §9.4 evidence, not readiness.** It proves a green complete scheduled cycle and protected hashes for this observation. It does not prove exact 542-row mapping identity, breaker/alert delivery, or rollback. |
| **2026-07-27** | **30256960304** | `15 */6 * * *` / health | **PASS**; post-comparison preview health passed; source, comparison, and drill lanes correctly skipped | non-drill health **`3dcc1598-345e-4ca3-b18d-06bab47e2bf1`**; `ok:true`; `issues:[]`; latest observation `c72852e3-428b-4716-abcb-823bac769505`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms the completed cycle remained healthy. |
| **2026-07-27** | **30279033321** | `15 */6 * * *` / health | **PASS**; later preview health passed; source, comparison, and drill lanes correctly skipped | non-drill health **`27083aaf-4936-41bf-b09b-00b31e9294de`**; `ok:true`; `issues:[]`; latest observation `c72852e3-428b-4716-abcb-823bac769505`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no health regression later in the day. |

The workflow checked out `a14fefc9459a3ff8c74ea21c55e58230c47a4296`, resolved the
exact health cron rather than wall-clock time, displayed preview project
`rjyboqwcdzcocqgmsyel`, and refused production identity. Production was not accessed.

The six 2026-07-27 runs checked out `b97e9537aa9e748bd297d27894a1fb949ebea69b`
through the comparison and first post-comparison health check; the later health run checked out
`ad34051ae303d37b2f164974153e9449d6adbc4d`. Every run passed the preview-only
identity guard. Skipped lanes above were expected because each cron selects exactly one lane.
No failed, partial, parser-error, or drill run occurred in this monitoring window.

**Deterministic-readiness ruling at 2026-07-27T15:14:54Z:** **NOT READY.** The
scheduled source pair, comparison, protected hashes, zero unexplained differences, and repeated
health checks are proven. The accelerated plan still requires exact row-by-row identity for all
542 approved typed mappings rather than count/hash evidence alone, plus circuit-breaker behavior,
actual alert delivery to the named responder, and a rehearsed rollback. This entry does not
authorize production work or Phase 7.

### 4.6 Secrets and schedule (ACTIVE)

| Item | Status |
|---|---|
| `COLDLION_API_KEY` | Added to GitHub repo secrets from 1Password (name only in docs) |
| `DESIGNFLOW_API_KEY` | Added to GitHub repo secrets from 1Password (name only in docs) |
| Also required | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PREVIEW` (existing migrations pattern) |
| `PHASE6_SCHEDULE_ENABLED` | **`true`** since **2026-07-26T13:27:41Z** |
| Preview schedules | **ACTIVE** (DesignFlow 03:30 UTC, ColdLion 04:00, compare 05:00, health `15 */6 * * *`) |

---

## 5. Historical clock and active exit criteria

| Item | Status |
|---|---|
| Historical schedule start | **2026-07-26** |
| Scheduled observations | Preserved as supporting evidence; not counted toward an elapsed-time gate |
| Earliest exit date | **None** — calendar gate retired |
| Exit requires | Accelerated plan readiness, exact mapping identity, breaker/alert/rollback proof, §9.4, and durable approval |
| Machinery + workflow proof | **COMPLETE** |
| Phase 6 overall | **IN PROGRESS** |

### Exact next action

1. Implement/prove the accelerated readiness plan on preview.
2. Preserve scheduled GitHub Actions and append-only observations as supporting evidence.
3. **Do not execute** Phase 7 or 8.

---

## 6. Explicit non-claims

- Production was **not** accessed or modified.
- The historical 14-day gate was retired; accelerated readiness is **not** complete.
- Phase 7 production cutover **not** started.
- Phase 8 DesignFlow deprecation **not** started.
- Phase 5 creates **not** reopened; NASA **not** linked.
- Applied migration `20260726180000` must **not** be edited.

---

## 7. Pointers

| Artifact | Path |
|---|---|
| Phase 6 handoff | [`fix_coldlion_licensor_property_phase6_handoff.md`](../../../fix_coldlion_licensor_property_phase6_handoff.md) |
| Cutover plan | [`fix_coldlion_licensor_property_cutover.md`](../../../fix_coldlion_licensor_property_cutover.md) |
| Parser fix PR | #233 / merge `18ab164ce503ba875413a7d4573597032c56be81` |
| Phase 4 links | [`../coldlion-licensor-property-phase4-20260725/`](../coldlion-licensor-property-phase4-20260725/README.md) |
| Phase 5 NOT NEEDED | [`../coldlion-licensor-property-phase5-not-needed-20260726/`](../coldlion-licensor-property-phase5-not-needed-20260726/README.md) |
