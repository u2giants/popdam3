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
| **2026-07-27** | **30300363303** | `15 */6 * * *` / health | **PASS**; preview guard, tests, preview link, and health passed; source, comparison, and drill lanes correctly skipped | non-drill health **`b7f0b1ca-baf8-496a-b9ad-5320d2d8c7ae`**; `ok:true`; `issues:[]`; latest observation `c72852e3-428b-4716-abcb-823bac769505`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms the last complete scheduled cycle remained healthy after the accelerated safety build began. |
| **2026-07-28** | **30326393766** | `15 */6 * * *` / health | **PASS**; preview guard, tests, preview link, and health passed; source, comparison, and drill lanes correctly skipped | non-drill health **`f4887126-ff7a-47d7-93f7-b5f955f920a3`**; `ok:true`; `issues:[]`; latest observation `c72852e3-428b-4716-abcb-823bac769505`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no preview health regression after the accelerated readiness implementation merged. |
| **2026-07-28** | **30333701256** | `30 3 * * *` / DesignFlow | **PASS**; DesignFlow preview sync completed; other lanes correctly skipped | sync run **`2f9ab744-64e1-4fa4-a6ed-76881582da01`**; licensors/properties/customers seen **37 / 468 / 57**; raw records upserted **562** | **Partial evidence.** One source lane passed; this run alone does not prove the full cycle. |
| **2026-07-28** | **30334798120** | `0 4 * * *` / ColdLion `mirror_only` | **PASS**; ColdLion preview mirror completed; other lanes correctly skipped | sync run **`76da2d9e-1146-4176-a094-bc31225c381e`**; rows **560**; inserted/updated/unchanged **0 / 0 / 560**; licensors/properties **44 / 516**; divisions **2**; cross-entity collisions **30**; snapshot hash **`a69332e05d9064723ffa1dfbd870506c`** | **Partial evidence.** The mirror remained byte-stable and successful. |
| **2026-07-28** | **30338860067** | `0 5 * * *` / daily comparison | **PASS**; complete scheduled DesignFlow + ColdLion pairing passed comparison with no unexplained differences | observation **`0289efd6-2681-45a3-9cdb-ff3fb81cefdc`**; comparison run **`fed1f419-f386-4564-a46f-5023a6e11563`**; `pass:true`; `diffs:[]`; `unexplained_diff_count:0`; baseline, source lanes, link checks, and immutability all true; canonical licensors/properties **26 / 256**; linked rows **38 / 504**; source refs **542 ColdLion / 505 DesignFlow**; every protected hash matches the prior baseline | **Strong §9.4 evidence, not overall readiness.** The complete scheduled cycle passed after the accelerated safety build. Step 6 application checks remain open. |
| **2026-07-28** | **30345094507** | `15 */6 * * *` / health | **PASS**; post-comparison preview health passed; source, comparison, and drill lanes correctly skipped | non-drill health **`80c849a7-cc1f-4e42-942e-2a74b89496f2`**; `ok:true`; `issues:[]`; latest observation `0289efd6-2681-45a3-9cdb-ff3fb81cefdc`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms the new complete cycle remained healthy. |
| **2026-07-28** | **30377295386** | `15 */6 * * *` / health | **PASS**; preview guard, tests, preview link, and health passed under the auto-trip workflow; source, comparison, drill, and immediate-alert lanes correctly skipped because no failure occurred | non-drill health **`8775ec1a-3c4c-428c-b99a-be8d7ba1a897`**; `ok:true`; `issues:[]`; latest observation `0289efd6-2681-45a3-9cdb-ff3fb81cefdc`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms healthy operation after automatic breaker enforcement merged. |
| **2026-07-28** | **30384327471** | `15 */6 * * *` / health | **PASS**; later preview health passed under the same auto-trip workflow; source, comparison, drill, and immediate-alert lanes correctly skipped because no failure occurred | non-drill health **`b228a25b-1aff-4dfb-98d4-2c59a17f2147`**; `ok:true`; `issues:[]`; latest observation `0289efd6-2681-45a3-9cdb-ff3fb81cefdc`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no health regression after the production package and approval request were prepared. |
| **2026-07-28** | **30393623817** | hourly health | **PASS**; preview guard, tests, preview link, and health passed; source, comparison, drill, and immediate-alert lanes correctly skipped because no failure occurred | non-drill health **`0df6cfa5-bde8-4379-ae0b-1f832a11f9f5`**; `ok:true`; `issues:[]`; latest observation `2f5c9ef5-71ac-4c2f-86c5-aa7cf143649f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** No regression or unexplained difference was reported. |
| **2026-07-28** | **30400243836** | hourly health | **PASS**; health passed and every non-health lane was correctly skipped | non-drill health **`e7de14ae-61c3-479a-a00f-212b402a05b8`**; `ok:true`; `issues:[]`; latest observation `2f5c9ef5-71ac-4c2f-86c5-aa7cf143649f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** No regression or unexplained difference was reported. |
| **2026-07-28** | **30407298447** | hourly health | **PASS**; health passed and every non-health lane was correctly skipped | non-drill health **`26d6dc3c-4342-4285-8caa-82a0c93128f7`**; `ok:true`; `issues:[]`; latest observation `2f5c9ef5-71ac-4c2f-86c5-aa7cf143649f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** No regression or unexplained difference was reported. |
| **2026-07-29** | **30410252150** | hourly health | **PASS**; health passed and every non-health lane was correctly skipped | non-drill health **`59875703-bc1a-4538-a6df-b6641a37819e`**; `ok:true`; `issues:[]`; latest observation `2f5c9ef5-71ac-4c2f-86c5-aa7cf143649f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** No regression or unexplained difference was reported. |
| **2026-07-29** | **30419950633** | hourly health | **PASS**; health passed and every non-health lane was correctly skipped | non-drill health **`d449ab38-58a0-4abb-9513-724150914d84`**; `ok:true`; `issues:[]`; latest observation `2f5c9ef5-71ac-4c2f-86c5-aa7cf143649f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** No regression or unexplained difference was reported. |
| **2026-07-29** | **30427351703** | `30 3 * * *` / DesignFlow | **PASS**; DesignFlow preview sync completed; all other lanes correctly skipped | sync run **`f6bde4eb-43b8-4ca6-9129-e5fa7a816c60`**; licensors/properties/customers seen **37 / 468 / 57**; raw records upserted **562** | **Partial evidence.** One complete source lane passed; this run alone does not prove the full cycle. |
| **2026-07-29** | **30428375725** | `0 4 * * *` / ColdLion `mirror_only` | **PASS**; ColdLion preview mirror completed; all other lanes correctly skipped | sync run **`2f0c0811-6e2a-48f5-b928-7a20b21b51e7`**; rows **560**; inserted/updated/unchanged **0 / 0 / 560**; licensors/properties **44 / 516**; divisions **2**; cross-entity collisions **30**; snapshot hash **`a69332e05d9064723ffa1dfbd870506c`** | **Partial evidence.** The canonical ERP mirror remained byte-stable and successful. |
| **2026-07-29** | **30429060180** | hourly health | **PASS**; health passed after both source lanes; all other lanes correctly skipped | non-drill health **`4c35b69f-738c-4ddc-a31c-b7397e60ce66`**; `ok:true`; `issues:[]`; ColdLion run `2f0c0811-6e2a-48f5-b928-7a20b21b51e7`; DesignFlow run `f6bde4eb-43b8-4ca6-9129-e5fa7a816c60`; latest observation `2f5c9ef5-71ac-4c2f-86c5-aa7cf143649f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** Both fresh source lanes were healthy; the scheduled comparison had not run yet. |
| **2026-07-29** | **30432352656** | `0 5 * * *` / daily comparison | **PASS**; the complete scheduled DesignFlow and ColdLion pair passed comparison with no unexplained differences | observation **`bd307350-0a1d-40f6-ab8e-a672f740a47f`**; comparison run **`81ab7383-4fe9-4064-9eaf-c5e643ece0ff`**; `pass:true`; `diffs:[]`; `unexplained_diff_count:0`; baseline, both source lanes, link checks, and immutability all true; canonical licensors/properties **26 / 256**; linked rows **38 / 504**; source refs **542 ColdLion / 505 DesignFlow**; UUID, status, parent, and source-reference hashes match the frozen baseline | **Strong §9.4 evidence, not production authorization.** It proves a new complete green cycle and unchanged protected values. Exact typed identity, breaker, alert, and rollback remain proven by the existing deterministic evidence. |
| **2026-07-29** | **30441061565** | hourly health | **PASS**; post-comparison health passed and every non-health lane was correctly skipped | non-drill health **`0cf27c54-e10e-4109-ae0a-5a4b4e2f4ec9`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms the new complete cycle remained healthy. |
| **2026-07-29** | **30450953903** | hourly health | **PASS**; post-comparison health passed and every non-health lane was correctly skipped | non-drill health **`b54186db-c689-4c9c-81d0-e8cd1130ea47`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms the complete scheduled cycle remained healthy. |
| **2026-07-29** | **30465172086** | hourly health | **PASS**; later health passed and every non-health lane was correctly skipped | non-drill health **`e8d16da9-8341-4e0c-b903-a6eee3524e70`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no regression or unexplained difference was reported. |
| **2026-07-29** | **30475979029** | hourly health | **PASS**; later health passed and every non-health lane was correctly skipped | non-drill health **`46974425-d2d2-4af5-a340-b171432d7612`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no regression or unexplained difference was reported. |
| **2026-07-29** | **30485408735** | hourly health | **PASS**; later health passed and every non-health lane was correctly skipped | non-drill health **`044c5be9-c72c-4517-b3d0-d98f5673066e`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no regression or unexplained difference was reported. |
| **2026-07-29** | **30491341597** | hourly health | **PASS**; later health passed and every non-health lane was correctly skipped | non-drill health **`248cf9ee-47ec-4d07-b8f9-ec2788e31d08`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no regression or unexplained difference was reported. |
| **2026-07-29** | **30495177345** | hourly health | **PASS**; later health passed and every non-health lane was correctly skipped | non-drill health **`7cb4c9fd-3f27-4c6c-9087-f155ffc839fd`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no regression or unexplained difference was reported. |
| **2026-07-29** | **30498750931** | hourly health | **PASS**; later health passed and every non-health lane was correctly skipped | non-drill health **`9a329221-dfb6-4bf7-b802-8885a33abd79`**; `ok:true`; `issues:[]`; latest observation `bd307350-0a1d-40f6-ab8e-a672f740a47f`; refs/links **542 / 38 / 504** | **Supporting evidence only.** It confirms no regression or unexplained difference was reported. |

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

**Monitoring update at 2026-07-28T03:37:06Z:** the two later scheduled health runs
above are green and add no unexplained difference. Section 4.7 now proves the formerly missing
exact 542-row identity, circuit-breaker, measured alert delivery, rollback, and recovered
`ready=true` preview result. The active plan still requires Step 6 application checks before a
production package can be prepared. No production readiness or Phase 7 authorization is declared
by this monitoring entry.

**Monitoring update at 2026-07-28T09:05:47Z:** a new complete scheduled
DesignFlow, ColdLion, comparison, and health cycle passed on preview. ColdLion remained unchanged,
all protected hashes matched, and there were zero unexplained differences. This reinforces §9.4
and the deterministic preview proof but does not close Step 6 application checks, authorize
production, or begin Phase 7.

**Monitoring update at 2026-07-28T17:45:48Z:** two later health runs passed
after the automatic breaker enforcement, application checks, and bounded production package
landed. Both runs had `issues:[]`; no immediate alert was expected because no failure occurred.
Steps 1–7 are now complete in the accelerated plan. The active blocker is Step 8, Albert's
durable approval of the exact production window and package. This entry does not supply that
approval, declare overall readiness, access production, or begin Phase 7.

**Monitoring update at 2026-07-29T09:47:51Z:** ten later scheduled runs are preserved
above. Five initial health runs passed, then the complete DesignFlow, ColdLion, comparison,
and post-comparison health cycle passed. ColdLion returned the same 560 rows with 0 inserted,
0 updated, and 560 unchanged. The comparison recorded `diffs:[]`,
`unexplained_diff_count:0`, and byte-identical UUID, status, parent, and source-reference
hashes. Preview also contains two additional non-drill, append-only observations from
2026-07-28T18:01:19Z and 2026-07-28T18:02:19Z
(`7ae2e6dd-299e-491a-a415-a7d9fcca48a8` and
`2f5c9ef5-71ac-4c2f-86c5-aa7cf143649f`); both passed against the prior source pair with
zero unexplained differences and the same protected hashes. No failed, partial,
parser-error, or drill event occurred in this monitoring window. The breaker remains
closed after its authorized 2026-07-28 recovery. Steps 1–7 remain proven. Step 8,
Albert's durable approval of the exact production window and package, remains open.
This entry does not supply approval, declare overall readiness, access production, or
begin Phase 7.

**Monitoring update at 2026-07-29T17:35:18Z:** three later scheduled health runs passed
with `issues:[]`, zero consecutive source failures, and the same latest successful
observation and source-pair IDs. The immediate-alert, source, comparison, and drill lanes
were correctly skipped because these were healthy hourly checks. Preview contains no new
comparison observation after `bd307350-0a1d-40f6-ab8e-a672f740a47f`; no failed, partial,
parser-error, or drill event occurred in this window. The breaker remains closed after its
authorized 2026-07-28 recovery. Existing deterministic proof remains intact. Step 8,
Albert's durable approval of the exact production window and package, remains open.
This entry does not supply approval, declare overall readiness, access production, or
begin Phase 7.

**Monitoring update at 2026-07-29T23:12:33Z:** four later scheduled health runs passed
with `issues:[]`, zero consecutive ColdLion or DesignFlow failures, and the same latest
successful observation and source-pair IDs. Each run correctly skipped the source,
comparison, immediate-alert, and drill lanes. Preview contains no new comparison
observation after `bd307350-0a1d-40f6-ab8e-a672f740a47f`; no failed, partial,
parser-error, or drill event occurred in this window. The breaker remains closed after
its authorized 2026-07-28 recovery. Existing exact typed mapping, protected-value,
breaker, alert, rollback, and §9.4 proof remains intact. Step 8, Albert's durable approval
of the exact production window and package, remains open. This entry does not supply
approval, declare overall readiness, access production, or begin Phase 7.

### 4.6 Secrets and schedule (ACTIVE)

| Item | Status |
|---|---|
| `COLDLION_API_KEY` | Added to GitHub repo secrets from 1Password (name only in docs) |
| `DESIGNFLOW_API_KEY` | Added to GitHub repo secrets from 1Password (name only in docs) |
| Also required | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PREVIEW` (existing migrations pattern) |
| `PHASE6_SCHEDULE_ENABLED` | **`true`** since **2026-07-26T13:27:41Z** |
| Preview schedules | **ACTIVE** (DesignFlow 03:30 UTC, ColdLion 04:00, compare 05:00, health `15 */6 * * *`) |

---

### 4.7 Accelerated readiness build — identity proof, circuit breaker, drills, rollback (2026-07-27, APPEND-ONLY)

Nothing in §§4.1–4.6 was changed, replaced, or re-run to produce this section. The
2026-07-27 scheduled cycle recorded in §4.5 (PR #262) was **reused as evidence, not
repeated**. Production `qsllyeztdwjgirsysgai` was **not accessed in any way** during
this work — not linked, not queried, not read.

#### 4.7.1 What was built

| Artifact | Purpose |
|---|---|
| `supabase/migrations/20260727221500_coldlion_licensor_property_readiness_and_breaker.sql` | `plm.taxonomy_circuit_breaker` + append-only `plm.taxonomy_circuit_breaker_event`; trip/reset/state functions; three enforcement triggers; the read-only 542-row identity verifier |
| `supabase/migrations/20260727223000_coldlion_breaker_blocked_attempt_logging_fix.sql` | Correction: a trigger cannot durably log its own refusal (see 4.7.5) |
| `supabase/migrations/20260727224500_coldlion_identity_verifier_reason_cast_fix.sql` | Correction: `text[] || <bare literal>` was parsed as an array literal (see 4.7.5) |
| `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` (+ `.test.mjs`) | The single deterministic readiness command |
| `tools/dispatch-coldlion-taxonomy-alerts.mjs` (+ `.test.mjs`) | Durable alert delivery |
| `.github/workflows/coldlion-licensor-property-alert-monitor.yml` | 10-minute preview alert monitor → GitHub issue naming Albert Hazan |
| `supabase/tests/coldlion_licensor_property_readiness_breaker_contracts.sql` | Rolled-back SQL contracts for the breaker and the identity verifier |

Preview apply used the bounded pattern from `AGENTS.md` §5.1: the three unrelated
pending migrations (`20260726190000`, `20260726200000`, `20260726210000`, all other
workstreams) were moved out of the local folder for the push and restored
immediately after, so each `supabase db push --dry-run` listed **only** the file
being applied. `--include-all` was never used.

#### 4.7.2 The readiness command

```bash
node tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs --apply --linked
```

Preview is the default target. Production requires **all three** of `--production`,
`--production-authorized`, `--project-ref qsllyeztdwjgirsysgai`, **and**
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true`; any one missing blocks. No
production authorization was supplied or created in this session.

#### 4.7.3 Exact mapping identity — all 542 rows, by identity, not by count

`plm.verify_coldlion_approved_mapping_identity` resolves every approved mapping by
full typed source identity (`company/division/mgTypeCode/mgCode` **plus** entity
type) to its exact canonical UUID, **in both directions**, and independently
recomputes the frozen Phase 4 hash in SQL.

| Measure | Result |
|---|---|
| Approved mappings checked | **542** (38 licensor + 504 property) |
| Distinct canonical UUIDs | **271** |
| Hash recomputed **in SQL** | **`1230f5a12d0f2a3029f1d3df17fc5b5f`** (matches the frozen Phase 4 artifact) |
| Live ColdLion source refs | **542** |
| `missing` / `extra` / `duplicate_input_key` / `duplicate_source_ref` | **0 / 0 / 0 / 0** |
| `cross_typed` / `changed_uuid` / `link_mismatch` / `canonical_missing` | **0 / 0 / 0 / 0** |

Counts alone can never pass: `row_counts_without_identity_proof_never_pass` blocks
readiness when the per-row payload is absent, partial, or non-numeric, even when
every count and hash is correct.

#### 4.7.4 Preview drills — forced failure, refusal, rollback, recovery (all real, not rolled back)

Protected baseline before the drill, identical to the §2 pinned values:
licensor UUID `590ea83ea6df1487fcfc1e18b3ef6a0d`, property UUID
`e0e6c36eb02bb2d320c0deaff7aa8f8c`, licensor status `d9b07759bf80ff227e2fa9bd635d2138`,
property status `f436d4acd79761fedbfc9b5796ac7bce`, parent edge
`7459f6826cc59468779e7ead33ec0edc`, combined status `5960fa4c08b5da2d0880c138e3e32ef7`,
source ref `5585216ad77d3aec0f1dbbba802f1e36`; canonical 26/256, refs 1047 = 542 + 505,
links 38/504.

| # | Step | Command / call | Result | Evidence ID |
|---|---|---|---|---|
| 1 | Trip the breaker on a simulated protected-invariant failure (drill-labelled) | `plm.trip_taxonomy_circuit_breaker(..., is_drill => true)` | `state=tripped` | trip event **`aedace23-c0eb-47d3-aad7-d49a1584b95e`**; durable **critical** alert **`de27d819-d4f7-4ab4-be0f-b6863e662e58`**, `human_response_owner: Albert Hazan` |
| 2 | Attempt a REAL ColdLion promotion while tripped | `node tools/run-coldlion-licensor-property-phase4.mjs --apply --linked` | **FAILED, exit 1** — trigger refused the first source-ref INSERT (`EDGEHOME/CW001/05/1P`) | failed `ingest.sync_run` **`15c0b900-d8eb-4925-a1ac-6323eaec5572`** (status `failed`, retained) |
| 3 | Record the refusal append-only | `plm.record_taxonomy_circuit_breaker_blocked_attempt(...)` | recorded | blocked_attempt event **`a97fc56d-5bd4-40e2-861f-bf6d2336a9c5`** |
| 4 | Re-snapshot protected facts | `plm.compute_taxonomy_immutability_snapshot()` | **every hash and count identical to the baseline above** | — |
| 5 | Readiness while tripped | readiness command | **exit 1, `ready=false`**; 6 checks passed, blocked **only** on `circuit_breaker_is_closed` with the exact trip reason | health run `3cbbe4a6-a4ea-4074-84eb-e22db527d7a4` |
| 6 | Alert delivery collection while tripped | `node tools/dispatch-coldlion-taxonomy-alerts.mjs --apply --linked` | **exit 1**, `deliver=true`, title `[DRILL] ColdLion taxonomy alert — 7 undelivered (breaker: tripped)`, body names **Albert Hazan** | — |
| 7 | Unauthorized reset | `readiness_pass=false` | **REFUSED** `P0001: circuit-breaker reset requires authorization.readiness_pass = true` | — |
| 8 | Operational rollback (authorized reset) | `plm.reset_taxonomy_circuit_breaker({authorized_by:'Albert Hazan', readiness_pass:true, readiness_evidence:'…'})` | `state=closed` | reset event **`19f8e231-6e0c-4928-8cda-18e86362c983`**; alert acknowledged `2026-07-27T18:23:09Z` |
| 9 | Prove promotion works again after rollback | `node tools/run-coldlion-licensor-property-phase4.mjs --apply --linked` | **exit 0** — `rows_seen 542`, `inserted 0`, `updated 0`, **`unchanged 542`**, licensor 38 / property 504, snapshot hash `1230f5a12d0f2a3029f1d3df17fc5b5f` | `ingest.sync_run` **`5676f13a-637d-4ca6-a77c-9e8f8d7d8839`** (succeeded) |
| 10 | Readiness after all drills | readiness command | **exit 0, `ready=true`**, all 7 checks pass, `blocking_reasons: []` | health run **`9d3b0ee3-6abf-49fe-85f0-c4632e32e9c8`** |
| 11 | Final protected snapshot | `plm.compute_taxonomy_immutability_snapshot()` | **byte-identical to the pre-drill baseline** — no canonical UUID, status, Property-to-Licensor parent, or approved source link changed at any point | — |

The rollback restored the prior safe state **and kept every failure**: the trip
event, the blocked-attempt event, and the failed link run all survive the reset.
The reset is append-only too — it adds a `reset` event rather than clearing history.

Latest non-drill comparison observation reused as evidence:
**`c72852e3-428b-4716-abcb-823bac769505`** (`pass:true`, `unexplained_diff_count:0`),
from the 2026-07-27 scheduled cycle in §4.5. It was **not** re-run.

#### 4.7.5 Two real defects this work found in itself — both caught by its own tests

Recorded because both are the kind of bug that reads as working code.

1. **A trigger cannot durably log its own refusal.** The first breaker triggers did
   `insert into plm.taxonomy_circuit_breaker_event (... 'blocked_attempt' ...)` and
   then `raise exception`. The exception rolls back the trigger's own insert, so the
   event row silently vanished. Postgres has no autonomous transactions. The contract
   test failed with `blocked attempts were not recorded append-only (got 0)` — without
   that assertion this would have been a permanent, invisible evidence gap. Fixed by
   `20260727223000`: triggers refuse only; the **caller** records the blocked attempt
   after catching the error, in a transaction that commits.
2. **`text[] || '<bare literal>'` is parsed as an array literal.** The identity
   verifier built its blocking-reason list with `format(...)` (returns `text`, works)
   in most branches but with bare quoted literals in two. Those two threw
   `22P02 malformed array literal`. The two affected branches were the **duplicate**
   and **ambiguous** detectors — they only run when something is already wrong, so the
   verifier would have crashed with a type error at exactly the moment it had found a
   real ambiguity, looking like a broken tool instead of a caught defect. Fixed by
   `20260727224500` with explicit `::text`.

Neither applied migration was edited. Each correction is a new timestamped file, per
`AGENTS.md` §4.4.

#### 4.7.6 Alert delivery — the named path did not exist, so the smallest durable one was built

The accelerated plan named "the existing Codex heartbeat task" as the primary alert
path. **A 2026-07-27 sweep of this repository found no such task**: no scheduled
monitor workflow, no cron definition, and no automation prompt anywhere in the repo
watches this workstream. The named path could not be proven because it is not here.
Per plan Step 4 item 8, the smallest durable replacement was built instead:

```text
plm.taxonomy_sync_alert (preview)
  -> .github/workflows/coldlion-licensor-property-alert-monitor.yml, cron */10 * * * *
  -> a GitHub Issue naming Albert Hazan as human response owner + a RED failed run
```

Both surfaces are permanent and timestamped, so delivery time is provable after the
fact rather than asserted. The 10-minute cadence sits inside the 15-minute target with
margin for GitHub queue delay. Gated by repository variable
`COLDLION_ALERT_MONITOR_ENABLED` (default off), production ref hard-refused.

**Delivery drill — measured, 2026-07-27 (post-merge on `main`)**

| Step | Value |
|---|---|
| Monitor enabled | repository variable `COLDLION_ALERT_MONITOR_ENABLED=true` at **2026-07-27T22:29:49Z** |
| Six pre-existing Phase 6 drill alerts | **acknowledged, never deleted** (`50ffcfc2`, `77521ad3`, `884bcab2`, `609db3fb`, `896185d4`, `7d6bfc6d`) so the drill measured only the fresh alert |
| Alert fired | **2026-07-27T22:30:00Z** — critical alert **`821d2c5b-5fd1-4714-a4ca-274fd22a9e75`**, `failed_invariant: alert_delivery_drill`, breaker tripped (second trip event) |
| Monitor run | **30311589271** — collected the alert, exited **red** as designed |
| Delivered | GitHub issue **[#279](https://github.com/u2giants/shared-db/issues/279)** created **2026-07-27T22:41:27Z** |
| **Latency** | **11 minutes 27 seconds — inside the 15-minute target** |
| Named owner | Issue body opens `**Human response owner: Albert Hazan.**`; the alert payload, the workflow error annotation, and the readiness report all carry the same name |
| Contents delivered | alert id, fired-at, age, severity, drill flag, failed invariant, reason, exact first response, preview project ref, run link |
| Closeout | alert acknowledged (not deleted), breaker reset under authorization, issue #279 closed, readiness re-evaluated **`ready=true`** (health run `c6518fc2-420d-4502-9f6b-9ab131593dfe`), every protected hash still identical to the §2 baseline |

**Honest remaining gap — the one thing NOT yet proven.** Run 30311589271 was a
`workflow_dispatch`. As of **2026-07-27T23:09Z**, roughly 40 minutes after the workflow
landed on `main`, **GitHub had not yet fired any `schedule` run of this workflow**. That
is normal for a newly added cron (GitHub activates new schedules lazily and throttles
`*/10` on shared runners), but it means the **delivery mechanism is proven end to end
while the unattended scheduled cadence is not yet observed**. Do not report this as
fully proven until it is.

To close it, in one command:

```bash
gh run list --repo u2giants/shared-db \
  --workflow coldlion-licensor-property-alert-monitor.yml \
  --json event,createdAt,conclusion,databaseId
```

Confirm at least one `"event": "schedule"` row and that consecutive scheduled runs are
about 10 minutes apart, then record the observed interval here. If GitHub proves unable
to hold the cadence, the fallback is to attach the alert check as an extra job on the
already-proven Phase 6 schedule rather than to relax the 15-minute target.

#### 4.7.7 Tests

| Suite | Result |
|---|---|
| `node --test` across all 11 ColdLion/Phase 6 suites | **127 passing, 0 failing** |
| `bash scripts/check-sql.sh` | **PASS** |
| `supabase/tests/coldlion_licensor_property_readiness_breaker_contracts.sql` (rolled back, preview) | **PASS** — emits `coldlion readiness + circuit-breaker contracts PASS` |

New readiness cases: `preview_composes_existing_green_results`,
`production_requires_exact_authorization`,
`all_542_typed_source_rows_resolve_to_approved_uuids`,
`missing_ambiguous_or_different_mapping_blocks` (each of the eight buckets
independently), `row_counts_without_identity_proof_never_pass`,
`tampered_approved_mapping_contract_blocks`.

New circuit-breaker contracts: durable alert on trip; refusal of a first and a
**second** promotion attempt; refusal of typed mirror link changes; evidence and the
DesignFlow/curated lane still writable while tripped; an unconfigured lane reads
closed; unauthorized reset refused three ways; authorized reset works; trip and
blocked-attempt evidence survives the reset; protected UUID/status/parent hashes
unchanged throughout.

#### 4.7.8 Explicit non-claims for this section

- Production was **not** accessed, linked, queried, or modified.
- **Phase 7 was not started.** No production migration, secret, or window exists.
- The readiness command reports readiness of the **preview** deterministic gates only.
- Application maturity checks (plan Step 6) and the bounded production package
  (Step 7) are **not** done.
- Albert's production-window approval (Step 8) has **not** been requested or given.

### 4.8 Hardening — the breaker now trips ITSELF (2026-07-28, APPEND-ONLY)

Nothing in §§4.1–4.7 was changed or re-run. This section records a **correction to a
false claim §4.7 rested on**, and the work that made the claim true.

#### 4.8.1 The false claim

§4.7 and the 2026-07-27 session reports stated the breaker "blocks unsafe changes in
milliseconds whether or not a human hears about it". **That was wrong.** Verified on
2026-07-28: `plm.trip_taxonomy_circuit_breaker` was called by exactly two things — the
contract test, and a human at a keyboard. Nothing in the detection path called it. The
2026-07-27 drill tripped the breaker **by hand first**, then watched a promotion fail,
which proved the refusal but never the arming.

So in steady state the lane was **open**, and protection depended on somebody noticing and
throwing a switch. The real exposure was:

```text
time to next detection run  +  alert latency  +  a human running the trip command
```

The 2026-07-27 work only attacked the middle term. Caught by an independent GLM 5.2 review
commissioned by Albert on 2026-07-28 (`.ai/reviews/coldlion-go-forward-glm.md`), then
confirmed directly against the code before acting. Recorded here because a review that
finds a wrong safety claim is exactly the evidence a future session needs.

Caution for future sessions: the same review also asserted production held ~318–322
migrations. The actual read was **354**. A second opinion can be right about the principle
and wrong about the numbers — verify both.

#### 4.8.2 What migration `20260728134500` adds

| Area | Change |
|---|---|
| **Auto-trip** | Both Phase 6 detectors already write a CRITICAL row to `plm.taxonomy_sync_alert` on failure, so one `after insert` trigger catches both and any future detector using the same convention. No applied 400-line function was rewritten. A second trigger on `plm.taxonomy_parallel_observation` covers a failed observation even if the alert write were skipped. |
| **Recursion guard** | The breaker's own alert is excluded by source name **and** `pg_trigger_depth()`. A later failure while already tripped is logged as a `blocked_attempt` and never overwrites the first trip reason. |
| **Gap closure** | `DELETE` of a ColdLion source ref, and `INSERT` of a mirror row already carrying a canonical link, are now refused. Previously only INSERT/UPDATE of refs and UPDATE of link columns were guarded. |
| **Anti-disarm** | `service_role` holds `grant all` on the breaker table, so `update ... set state='closed'` bypassed every authorization check. Closing now requires `plm.reset_taxonomy_circuit_breaker()`, which sets a **transaction-local** flag the state guard demands. The flag dies with the transaction, so it can never leave a standing bypass. |
| **Watchdog** | `plm.taxonomy_breaker_enforcement_status()` reports whether all **9** expected triggers are installed *and* enabled. Readiness blocks on anything less — a "closed" breaker on an unguarded database is otherwise indistinguishable from a safe one. |

#### 4.8.3 The auto-trip drill — nobody touched the switch

| # | Step | Result |
|---|---|---|
| 1 | Enforcement watchdog before | `all_enforced: true`, **9/9** triggers installed and enabled; breaker `closed` |
| 2 | Run the **real** health check in forced-failure mode. **No trip call anywhere.** | health `ok:false`; alert **`eae463fa-e870-454c-a463-b59a36c5d70a`** written |
| 3 | Breaker state immediately after | **`tripped`**, `tripped_by:` **`auto-trip`**, reason `AUTO-TRIP on critical alert from coldlion_designflow_sync_health`, breaker alert `05950e65-…`, run `22229a3b-…` — **tripped in the same transaction that detected the failure** |
| 4 | Real promotion attempt | `run-coldlion-licensor-property-phase4.mjs` **exit 1** — refused at `EDGEHOME/CW001/05/1P` |
| 5 | `DELETE` an approved ColdLion source ref | **refused** (`P0001`, new delete guard) |
| 6 | Disarm by direct `UPDATE ... state='closed'` | **refused** (`P0001`, anti-disarm guard); breaker still tripped afterwards |
| 7 | Readiness | **exit 1, `ready=false`**, blocked **only** on `circuit_breaker_is_closed`, naming the auto-trip reason; enforcement still 9/9 |
| 8 | Authorized reset | `closed`, `reset_by: Albert Hazan` |
| 9 | Promotion after recovery | **exit 0** — `rows_seen 542`, `unchanged 542`, `inserted 0`, `updated 0`, licensor 38 / property 504 |
| 10 | Protected snapshot | **every hash identical to the §2 baseline** — licensor UUID `590ea83e…`, property UUID `e0e6c36e…`, statuses `d9b07759…` / `f436d4ac…`, parent edge `7459f682…`, source refs `5585216a…`, refs/links 542 / 38 / 504 |

A trap worth keeping: step 3 first *looked* like a failure because the breaker state was
read inside the **same** `SELECT` as the forced failure. `plm.taxonomy_circuit_breaker_state`
is `STABLE`, so it uses the statement snapshot and cannot see a change made mid-statement.
Always re-read breaker state in a **separate** statement, or you will conclude the auto-trip
is broken when it actually worked.

#### 4.8.4 Alert timing — fixed at the right end

The `*/10` alert-monitor cron was measured across 2026-07-27/28 at **57, 84, 201, 171, 165
and 126 minute** gaps. GitHub throttles it; the 15-minute target cannot be met that way.

Fix: **the run that detects the failure delivers the alert itself**, in an `if: failure()`
step, before it exits. Latency becomes seconds. The cron monitor stays as a slow backstop for
anything failing outside a GitHub run. Health detection also moved from `15 */6 * * *` (every
6 hours) to **`15 * * * *`** (hourly), with `tools/phase6-schedule-map.mjs` and its test kept
in lockstep — the exact-cron lane dispatch depends on them matching.

The deeper point: with auto-trip in place, **alert latency no longer gates safety**. The lane
stops itself the moment a detector fails. Alert speed now only governs how fast a human starts
investigating an already-stopped lane.

#### 4.8.5 Tests

129 offline tests pass (was 127). `scripts/check-sql.sh` passes. Rolled-back SQL contracts
pass, now also proving: a critical alert auto-trips with no human call; a **warning** alert
does **not** trip; DELETE and linked-INSERT are refused; direct disarm is refused; authorized
reset works; and canonical status and parents are untouched throughout.

New readiness case `a_closed_breaker_on_an_unguarded_database_never_passes` covers a dropped
trigger, a disabled trigger, and an unreadable enforcement status.

---

## 4A. Step 6 (partial) and Step 7 evidence — 2026-07-28

### 4A.1 Step 6 — consumer contracts verified on preview

| Check | Result |
|---|---|
| Foreign keys into `core.licensor` / `core.property` | **40 constraints, all valid**, none `NOT VALID` |
| Canonical state | 26 licensors (21 active / 5 potential), 256 properties (all active), **0** properties with a null parent |
| Duplicate canonical names | **none** (licensor, and property-within-licensor) |
| ColdLion refs pointing at a non-existent canonical row | **0** |
| **DAM live subset** | **85,481** assets carry a licensor, **42,700** carry a property, **5,726** style groups carry a licensor — **0 orphans**, and **0** cases where an asset's licensor disagrees with its property's parent licensor |
| ColdLion-linked licensors in real DAM use | **10** — the cutover touches live data, and that data is sound |

**Explicitly NOT verified, because the data does not exist on preview:** `plm.item`,
`pim.product`, `pim.project`, `pim.product_submission`, `crm.licensor_approval_thread`,
`dam.asset`, `dam.style_group`, `dam.style_guide_file`, `core.character` and
`core.style_guide` are **all zero rows** on preview. That is "nothing to exercise", **not**
a pass.

`api.db_data_admin_licensor_property_list/tree` could not be called from the CLI —
`app.require_db_data_admin_access()` correctly refuses a role with no JWT. That check needs a
browser login and remains **open**.

**DAM screen check deferred.** Per `AGENTS.md` §0.4 the Master Data grid is writable by
**any** signed-in user and PopDAM has no read-only role, so an ordinary tester login is not a
safe read-only instrument against production. Deferred until a constrained account exists.

### 4A.2 Step 7 — production read-only inventory (owner-authorized 2026-07-28)

Albert explicitly authorized read-only production access. Performed in a **detached throwaway
worktree**, removed immediately afterwards; no worktree remains linked to production.
**No write, no `db push`, no mutation.**

| Measure | Value |
|---|---|
| Migrations applied on production | **354** |
| Highest applied version | `20260727213000` |
| Ledger rows with no local file | **0** — no corruption, no repair temptation |
| Pending on production | **10** |
| **Bounded ColdLion manifest** | `20260724060000`, `20260724061000`, `20260726030000`, `20260726031000`, `20260726032000`, `20260726180000`, `20260727221500`, `20260727223000`, `20260727224500` — **9 files** |
| Deliberately EXCLUDED | `20260727230000_core_style_guide_axis.sql` — a different workstream. **Never `--include-all`.** |

Object check, not just the ledger: `plm.erp_licensor` / `plm.erp_property` exist on production
(created by Phase 1 `20260724030000`, already promoted), while
`plm.taxonomy_parallel_observation`, `plm.taxonomy_sync_alert`, `plm.taxonomy_circuit_breaker`
and the identity verifier are all **absent** — consistent with the pending list.

**Read-only 542-row identity pre-proof against production, before any write:**

| Measure | Production result |
|---|---|
| Approved rows resolved | **542** (38 licensor + 504 property), **271** distinct canonical |
| Canonical rows missing on production | **0** |
| Cross-typed (a licensor id that is really a property, or vice versa) | **0** |
| Code mismatches | **0** |
| Existing ColdLion source refs on production | **0** — clean slate |
| Production canonical baseline | 26 licensors, 256 properties, **0** null parents, 505 DesignFlow refs — identical to preview |

Step 7 items 1–5 are satisfied. Items 6–9 (the production secret proposal, the exact command
set, and the rollback commands) remain, and **Step 8 approval has not been requested.**

### 4A.3 Step 6 item 5 — DB Data Admin, exercised as a real signed-in user (2026-07-28)

`data-dev.designflow.app` runs against **preview** `rjyboqwcdzcocqgmsyel` (confirmed in
`docs/db-data-admin-deployment.md`), so this check carried **zero production risk**.

Signed in through Supabase Auth with the 1Password tester account
`DB Data Admin AI tester login (data-dev.designflow.app) - non-SSO`, then called the exact
`api.db_data_admin_licensor_property_tree` / `_list` functions the UI calls, under a genuine
user JWT. The password was passed through the process environment and never written to a file,
a log, or a command line.

> Two traps worth recording. (1) These functions are **role-gated** — calling them from the
> Supabase CLI as the migration role fails with `42501 db_data_admin: not authorized` from
> `app.require_db_data_admin_access()`. A real JWT is required; that is correct behaviour, not
> a defect. (2) Their real signature is
> `(p_search text, p_include_inactive boolean, p_cursor text, p_page_size integer)` returning a
> **jsonb envelope** keyed `licensors / page_size / next_cursor / orphan_properties`
> (plus `snapshot` and `reconciliation` on the tree) — **not** a row set. Guessing
> `p_entity` / `p_limit` returns `PGRST202`.

| Contract check | Result |
|---|---|
| Tree renders the hierarchy | **26 licensors, 256 properties** |
| Duplicate licensor rows / duplicate property rows | **0 / 0** |
| A UUID appearing as both a licensor **and** a property (cross-entity) | **0** |
| A property appearing under more than one licensor | **0** |
| Orphan properties reported by the function | **0** |
| Linked parent display | every property row carries `licensor_id` |
| Filter — search `MARVEL` | **1** licensor |
| Filter — nonsense search term | **0** rows (does not fall back to everything) |
| List envelope | `licensors / page_size / next_cursor / orphan_properties`, 26 licensors |

**ColdLion provenance is visible in the admin surface, beside DesignFlow — the parallel run
working end to end:**

- **19** licensors show at least one `coldlion` source ref (matching the 19 distinct linked
  licensors from Phase 4)
- **504** ColdLion property refs and **468** DesignFlow property refs visible together
- `MARVEL` (`MV`, active, 29 properties) shows both ColdLion divisions
  (`EDGEHOME/CW001/05/MV`, `EDGEHOME/SP001/05/MV`, table `merchGroupDetails`) **and** its
  DesignFlow refs (`merchGroup` ids `1115`, `201`) — coexisting, neither overwriting the other

**Honest limitation on the inactive-visibility rule.** `include_inactive=false` returned the
same 26 licensors as `true`, because production and preview currently hold **21 active + 5
potential and zero inactive** licensors. There was nothing inactive to hide, so that rule was
**not genuinely exercised**. It is recorded as untested, not as passed.

### 4A.4 Step 6 — final maturity-accurate conclusion

| App | Result | Basis |
|---|---|---|
| **DB Data Admin** | **VERIFIED** | Real signed-in user against preview; tree, filters, parent display, duplicate/cross-entity all clean (§4A.3) |
| **DAM** | **Live subset verified at the data contract; screens NOT clicked** | 85,481 assets / 42,700 property refs / 5,726 style groups, **0 orphans**, **0** asset-licensor vs property-parent mismatches, 10 ColdLion-linked licensors in real use (§4A.1). The UI was deliberately not driven: per `AGENTS.md` §0.4 the Master Data grid is writable by **any** signed-in user and PopDAM has no read-only role, so an ordinary tester login is not a safe read-only instrument against production |
| **DesignFlow PLM** | **NOT exercised — no data on preview** | `plm.item` is **0 rows** on preview. Its dependency is the FK/api contract, and all 40 FKs are valid. This is "nothing to exercise", **not** a pass. The live PLM smoke belongs in the Step 9 read-only production window |
| **CRM** | **NOT exercised — no data** | `crm.licensor_approval_thread` is **0 rows** on preview; dependency is 2 FKs, both valid |
| **PM/PIM** | **NOT exercised — no data** | `pim.product` / `pim.project` / `pim.product_submission` all **0 rows** on preview; dependency is 6 FKs, all valid |

**Conclusion, stated at the accuracy the evidence supports:** DB Data Admin behaviour is
verified against the preview-connected environment; the DAM live subset is verified at the
data-contract level and its screens are explicitly untested; DesignFlow PLM, CRM, and PM/PIM
could not be exercised because those tables hold no rows on preview, and their dependency —
40 valid foreign keys and the `api.*` contracts — is proven intact. **No claim is made that
CRM, PM, or all of DAM is production-proven.**

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
