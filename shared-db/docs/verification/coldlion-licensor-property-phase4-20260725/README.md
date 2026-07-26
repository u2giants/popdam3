# ColdLion Licensor/Property Phase 4 — approved canonical linking

**Environment:** preview `rjyboqwcdzcocqgmsyel` only · **Date:** 2026-07-25/26
**Mode:** guarded `link_approved` — deterministic ColdLion source refs + typed mirror links only; no canonical create/update, no status/name/parent/UUID change, no schedule
**Production (`qsllyeztdwjgirsysgai`):** never connected or modified · **DesignFlow:** untouched · **Result:** **PASS**

This folder is the Phase 4 deliverable for
[`fix_coldlion_licensor_property_cutover.md`](../../../fix_coldlion_licensor_property_cutover.md) §15.3
and the user approval of 2026-07-25: link **ONLY** the 542 exact-compatible proposed mappings
(38 licensor + 504 property rows → 271 distinct canonical UUIDs), hash-pinned to
`1230f5a12d0f2a3029f1d3df17fc5b5f`.

> **Headline:** committed run `875109b5-2ac9-41a9-8280-4c4a36f6b639` inserted **542** deterministic
> ColdLion source refs beside the 505 DesignFlow refs (1047 total) and set **542** mirror links
> (38 licensor + 504 property). Canonical data is provably untouched (26 licensors / 256 properties;
> all UUID/status/parent hashes unchanged). Zero excluded rows linked. Phase 5 is ruled
> **NOT NEEDED** — zero canonical creates were approved.

## 1. Approved input (frozen artifact)

[`approved-mapping.json`](approved-mapping.json) — derived deterministically from the Phase 3
`phase4-proposed-auto-mapping.csv` (no Phase 3 artifact or generator modified):

| Field | Value |
|---|---|
| schema | `coldlion_phase4_approved_mapping_input/v1` |
| target | `rjyboqwcdzcocqgmsyel` (preview) |
| approved_by / approved_at_utc | Albert Hazan / 2026-07-25 |
| approved_mapping_hash | `1230f5a12d0f2a3029f1d3df17fc5b5f` |
| mapping_count | **542** (38 licensor + 504 property) |
| distinct_canonical | **271** (19 licensor + 252 property UUIDs) |
| exclusions (explicit) | NASA ×2 pending (`EDGEHOME/CW001/05/NA`, `EDGEHOME/SP001/05/NA`); FRIDA KAHLO licensor ×2; ZAG ×2; 12 ColdLion-only properties; 10 canonical-only incl. FRIENDS TV; Phase 5 creates (0 approved) |

Encoding: sorted `<entity_type>|<company>/<division>/<mgTypeCode>/<mgCode>|<canonical_id>` joined
by newline, md5 (code-unit sort = SQL `COLLATE "C"`). Recomputation from the file reproduces the
hash exactly (asserted by `tools/run-coldlion-licensor-property-phase4.test.mjs`).

## 2. Migrations applied to preview (additive, timestamped)

| Migration | What it ships |
|---|---|
| `20260726030000_coldlion_licensor_property_phase4_link_approved.sql` | `link_approved` mode: **ungranted deep-validation core** `plm.link_coldlion_licensors_properties_core` (owner-only) + **pinned wrapper** `plm.link_coldlion_licensors_properties_approved` (service_role) that rejects every expected contract except hash `1230f5a1…`/count 542/distinct 271; 3-arg `plm/public.sync_coldlion_licensors_properties` dispatch; `mirror_only` body byte-identical |
| `20260726031000_coldlion_licensor_property_phase4_null_shape_guard.sql` | Correction: `jsonb_typeof(...) IS DISTINCT FROM` so a NULL/missing `input.mappings` trips the documented guard (NULL made `<> 'array'` evaluate UNKNOWN and silently pass) |
| `20260726032000_coldlion_licensor_property_phase4_browser_execute_revoke.sql` | Correction: hosted-preview default privileges had granted `anon`/`authenticated` EXECUTE on the new 3-arg functions; `REVOKE FROM PUBLIC` alone did not remove those explicit grants. Explicit revokes; core stays ungranted; entry points service_role-only |

## 3. Runs (preview `ingest.sync_run`, source `coldlion_licensors_properties_link_approved`)

| Run ID | Kind | Result |
|---|---|---|
| `e6393a4e-db19-4426-9519-924c797ad888` | **Rollback rehearsal** | Would insert 542 refs / set 542 links inside one transaction; `ROLLBACK` restored 505 refs / 0 ColdLion links — full atomicity proven |
| `875109b5-2ac9-41a9-8280-4c4a36f6b639` | **Committed apply** | 542 refs inserted, 542 mirror links set (38 licensor + 504 property), 0 failed |
| `9dd0f675-30fc-4ff2-8010-9558bc075617` | Idempotent re-run | 0 inserted / 0 updated / 542 unchanged |
| `eb045c1b-85d5-4d0e-bb25-f86004e52f5a` | Idempotent re-run | 0 inserted / 0 updated / 542 unchanged |

Runner: `tools/run-coldlion-licensor-property-phase4.mjs` (dry-run default; `--apply --linked` with
the preview project link; recomputes and pins hash/count/distinct before sending; refuses
production targets; never prints secrets).

## 4. Before/after proof (canonical immutability + link effects)

| Check | Before | After | Verdict |
|---|---|---|---|
| Canonical licensors / properties | 26 / 256 | 26 / 256 | unchanged |
| Licensor UUID hash | `590ea83ea6df1487fcfc1e18b3ef6a0d` | same | unchanged |
| Licensor status hash | `d9b07759bf80ff227e2fa9bd635d2138` | same | unchanged |
| Property UUID hash | `e0e6c36eb02bb2d320c0deaff7aa8f8c` | same | unchanged |
| Property status hash | `f436d4acd79761fedbfc9b5796ac7bce` | same | unchanged |
| Parent-edge hash | `7459f6826cc59468779e7ead33ec0edc` | same | unchanged |
| `core.taxonomy_source_ref` total | 505 (all `designflow_plm`) | **1047** = 505 `designflow_plm` + 542 `coldlion` (`merchGroupDetails`, slash composite `source_id`) | as approved |
| Mirror canonical links | 0 | 38 `plm.erp_licensor.licensor_id` + 504 `plm.erp_property.property_id` (`manually_matched`, approver stamped) | as approved |
| Excluded rows linked | — | **0** (NASA, FRIDA KAHLO licensor, ZAG, ColdLion-only, canonical-only, FRIENDS TV) | none |
| Canonical rows created | — | **0** | none |

Local gates: Phase 2 + Phase 4 rolled-back SQL contracts **pass** on preview; **63 Node tests pass**
(`node --test tools/coldlion-licensor-property-phase1.test.mjs tools/coldlion-licensor-property-phase2a.test.mjs tools/coldlion-licensor-property-phase3.test.mjs tools/run-coldlion-licensor-property-phase4.test.mjs tools/sync-coldlion-licensors-properties.test.mjs`);
`scripts/check-sql.sh` passes.

## 5. Failed paths recorded (all corrected before PASS)

1. **Kimi session slowness/timeouts** — the implementation was split into bounded slices to finish safely.
2. **Grok review found test regressions** — caller-controlled `p_expected` could self-authorize; fixed by the DB-pinned wrapper + ungranted core split, then contracts PASS.
3. **Stale broad Phase 2 fixture assertion** — `run1 expected 6 inserted` assumed a fresh DB; on the long-lived preview the fixed fixture keys may pre-exist, so §1 now requires `rows_seen`/entity totals = 6 and inserted+updated+unchanged = 6 (importer behavior unchanged; idempotent re-run still requires 0/0/6).
4. **NULL jsonb guard** — `jsonb_typeof(v_mappings) <> 'array'` evaluated UNKNOWN for missing `mappings`; corrected by `20260726031000` (`IS DISTINCT FROM`).
5. **Explicit anon/auth default grants** — hosted preview's default privileges granted `anon`/`authenticated` EXECUTE on the new functions; `REVOKE FROM PUBLIC` did not remove explicit grants; corrected by `20260726032000`.
6. **One `DATABASE_URL` pooler prepared-statement failure** — a direct pooler attempt failed before writing any run (no partial work); the `--linked` Supabase CLI path worked and was used.

## 6. Phase 5 ruling and exclusions

**Phase 5 is NOT NEEDED / BLOCKED: the owner approved zero canonical creates.** No Phase 5 schema or
data work may begin. ZAG (`ZG`), FRIDA KAHLO licensor (`FK`), and the 12 ColdLion-only properties
stay out of canonical unless Albert separately approves creates in a fresh session. NASA
(`NA`→`X-NASA`, pending hash `2edf77b7ddd8d0405f93d020003b9540`) remains an unapproved pending link
decision. The Phase 6 parallel-run clock has not started (latest scheduled `designflow_plm` success
is still 2026-07-08).
