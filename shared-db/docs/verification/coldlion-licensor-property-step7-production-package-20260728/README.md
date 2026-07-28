# ColdLion Licensor/Property — Step 7 bounded production change package

**Date:** 2026-07-28
**Status:** **PREPARED, NOT EXECUTED.** No production write has occurred or is authorized.
**Production project:** `qsllyeztdwjgirsysgai`
**Preview project:** `rjyboqwcdzcocqgmsyel`
**Human response owner:** Albert Hazan

This document is the complete package Step 9 would execute **if and only if** Albert grants
the Step 8 approval naming the exact migrations, modes, secret action, window, and rollback.
A general "go ahead" is explicitly **not** that approval.

Everything below was derived from an **owner-authorized read-only** production inspection on
2026-07-28. Nothing was written, and the detached worktree used for it was removed.

---

## 1. Bounded migration manifest — exactly 9 files

Production had **354** migrations applied, highest version `20260727213000`, and **zero**
ledger rows without a matching local file (no corruption, no repair temptation). Ten
migrations are pending. **Nine** are this workstream:

| # | Migration | What it adds |
|---|---|---|
| 1 | `20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql` | Guarded ColdLion mirror importer (`mirror_only`) |
| 2 | `20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql` | Importer guard corrections |
| 3 | `20260726030000_coldlion_licensor_property_phase4_link_approved.sql` | Approved-linking contract (`link_approved`) |
| 4 | `20260726031000_coldlion_licensor_property_phase4_null_shape_guard.sql` | Null/shape guard |
| 5 | `20260726032000_coldlion_licensor_property_phase4_browser_execute_revoke.sql` | Revokes browser EXECUTE on write wrappers |
| 6 | `20260726180000_coldlion_licensor_property_phase6_parallel_run.sql` | Parallel-run observation, alerts, health |
| 7 | `20260727221500_coldlion_licensor_property_readiness_and_breaker.sql` | Identity verifier + circuit breaker |
| 8 | `20260727223000_coldlion_breaker_blocked_attempt_logging_fix.sql` | Blocked-attempt logging correction |
| 9 | `20260727224500_coldlion_identity_verifier_reason_cast_fix.sql` | Verifier reason-cast correction |

Plus, if approved at the same time, the 2026-07-28 hardening:

| 10 | `20260728134500_coldlion_breaker_autotrip_and_gap_closure.sql` | **Auto-trip**, DELETE/linked-INSERT gap closure, anti-disarm, enforcement watchdog |

> **Strongly recommended:** promote #10 **with** the others. Without it the breaker exists but
> nothing arms it — the exact false-safety condition corrected on 2026-07-28 (evidence §4.8.1).
> Promoting 1–9 without 10 would ship the weaker version knowingly.

### Deliberately EXCLUDED

| Migration | Why |
|---|---|
| `20260727230000_core_style_guide_axis.sql` | Different workstream (characters / style guides). Not ours to promote. |

**`--include-all` must never be used against the full repo set.** Inside the bounded temp
checkout described below — where the excluded file is not on disk — it is the correct and safe
way to finish, per `AGENTS.md` §5.1.

---

## 2. Read-only identity pre-proof (already run, 2026-07-28)

Run **before any write**, against production, read-only:

| Measure | Result |
|---|---|
| Approved mappings resolved | **542** (38 licensor + 504 property), **271** distinct canonical |
| Canonical rows missing on production | **0** |
| Cross-typed (a licensor id that is really a property, or vice versa) | **0** |
| Code mismatches | **0** |
| Existing ColdLion source refs on production | **0** — clean slate |
| Production baseline | 26 licensors, 256 properties, **0** null parents, 505 DesignFlow refs — identical to preview |

Object check (never trust the ledger alone): `plm.erp_licensor` / `plm.erp_property` exist on
production from Phase 1 `20260724030000`; `plm.taxonomy_parallel_observation`,
`plm.taxonomy_sync_alert`, `plm.taxonomy_circuit_breaker`, and the identity verifier are all
**absent** — consistent with the pending list.

**This proof must be re-run inside the approved window, immediately before applying.**

---

## 3. Proposed GitHub secret — named only, NOT created

| Item | Value |
|---|---|
| GitHub Actions secret | `SUPABASE_DB_PASSWORD_PRODUCTION` |
| Source | 1Password vault `vibe_coding`, item `Supabase DB Password - shared POP database` |
| Status | **Does not exist. Not created. Creating and using it is a named production action requiring Step 8 approval.** |

No secret value appears in this document, in any command below, or in any log.

---

## 4. Exact commands Step 9 would run

Every command names `qsllyeztdwjgirsysgai` explicitly. Run from a **detached temp worktree**,
never the shared checkout — other sessions churn it between turns.

### 4.1 Bounded checkout

```bash
git worktree add --detach /tmp/coldlion-prod-apply origin/main
cd /tmp/coldlion-prod-apply
rm supabase/migrations/20260727230000_core_style_guide_axis.sql
```

Delete **only** the pending file being excluded. Do **not** delete already-applied files — the
CLI compares against every ledger row and will abort with *"Remote migration versions not found
in local migrations directory"* and suggest `migration repair --status reverted`. **Never run
that repair.**

### 4.2 Link production and confirm the target out loud

```bash
supabase link --project-ref qsllyeztdwjgirsysgai --password "$PROD_DB_PASSWORD"
cat supabase/.temp/project-ref   # must print exactly: qsllyeztdwjgirsysgai
```

### 4.3 Pre-cutover baseline and hashes (read-only, capture before anything changes)

```sql
select jsonb_pretty(jsonb_build_object(
  'captured_at', timezone('utc', now()),
  'licensors', (select count(*) from core.licensor),
  'properties', (select count(*) from core.property),
  'properties_null_parent', (select count(*) from core.property where licensor_id is null),
  'licensor_uuid_hash', (select md5(coalesce(string_agg(id::text,'|' order by id::text),'')) from core.licensor),
  'property_uuid_hash', (select md5(coalesce(string_agg(id::text,'|' order by id::text),'')) from core.property),
  'status_hash', (select md5(coalesce(string_agg(id::text||'|'||status::text,'|' order by id::text),''))
                    from (select id,status::text from core.licensor
                          union all select id,status::text from core.property) s),
  'parent_edge_hash', (select md5(coalesce(string_agg(id::text||'|'||licensor_id::text,'|' order by id::text),'')) from core.property),
  'source_ref_hash', (select md5(coalesce(string_agg(source_system||'|'||source_table||'|'||source_id,'|'
                        order by source_system,source_table,source_id),'')) from core.taxonomy_source_ref)));
```

Save the output. It is the comparison basis for §4.7 and the rollback decision.

### 4.4 Dry run — must list ONLY the approved manifest

```bash
supabase db push --dry-run
```

If it reports files to be inserted before the remote maximum and asks for `--include-all`, then
inside this bounded checkout run `supabase db push --include-all --dry-run` and **confirm it
names exactly the manifest in §1 and nothing else** before dropping `--dry-run`.

**Stop and return to Albert if any additional migration appears.**

### 4.5 Apply

```bash
supabase db push        # add --include-all ONLY after the bounded dry run above verified the exact set
```

### 4.6 Verify real objects, not the ledger

```sql
select jsonb_pretty(jsonb_build_object(
  'observation_table', to_regclass('plm.taxonomy_parallel_observation')::text,
  'alert_table', to_regclass('plm.taxonomy_sync_alert')::text,
  'breaker_table', to_regclass('plm.taxonomy_circuit_breaker')::text,
  'identity_verifier', to_regprocedure('plm.verify_coldlion_approved_mapping_identity(jsonb,jsonb,integer)')::text,
  'breaker_enforcement', plm.taxonomy_breaker_enforcement_status()));
```

`breaker_enforcement.all_enforced` must be **true** with **9/9** triggers.

### 4.7 Guarded snapshot, then the approved link, then re-hash

```bash
node tools/sync-coldlion-licensors-properties.mjs --apply --linked          # mirror_only
node tools/run-coldlion-licensor-property-phase4.mjs --apply --linked       # link_approved, 542 only
```

Expected: `rows_seen 542`, licensor 38 / property 504, snapshot hash
`1230f5a12d0f2a3029f1d3df17fc5b5f`. Re-run §4.3 and compare: **licensor UUID, property UUID,
status, and parent-edge hashes must be UNCHANGED.** Only `source_ref_hash` and the ColdLion ref
count may change, and only by the addition of exactly 542 ColdLion rows.

### 4.8 Readiness, in explicitly production-authorized mode

```bash
COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true \
node tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs \
  --apply --linked --production --production-authorized --project-ref qsllyeztdwjgirsysgai
```

All three flags **and** the environment variable are required; any one missing blocks.

---

## 5. Expected database changes — and what must NOT change

**Expected:** new schema objects (observation/alert/breaker tables, importer, linking and
verifier functions, 9 breaker triggers); a `plm.erp_*` mirror refresh; **542 new
`core.taxonomy_source_ref` rows** with `source_system='coldlion'`; typed mirror link columns
set on the 542 matched rows; `ingest.sync_run` accounting rows.

**Must NOT change — any difference is a stop-and-roll-back condition:**

- canonical `core.licensor` / `core.property` **UUIDs**
- canonical **status** values
- **`core.property.licensor_id`** parent links
- the **505 existing DesignFlow** source refs
- canonical names and codes
- row counts (26 licensors / 256 properties)

---

## 6. Application smoke checklist (production, READ-ONLY)

Do **not** create or modify a production record.

| App | Check | Maturity |
|---|---|---|
| DesignFlow PLM | Licensor/Property selectors populate; an existing item displays; tracking references resolve; a saved UUID deep-link opens | **Fully live — primary gate** |
| DAM | The live asset/style-group paths that read Licensor/Property still resolve; **stay off the Master Data grid** (per `AGENTS.md` §0.4 it is writable by any signed-in user) | Partially live — live subset only |
| DB Data Admin | Licensor/Property tree, filters, parent display, no duplicate or cross-entity rows | Admin contract |
| CRM | Development compatibility only | In development |
| PM/PIM | Development pickers and saved UUID references | In development |

Never state CRM, PM, or all of DAM as production-proven.

---

## 7. Operational rollback — no schema drop, no data delete

Rollback is **operational**, not structural. Schema rollback is more dangerous than stopping
the source lane.

1. **Stop the lane.**
   ```sql
   select plm.trip_taxonomy_circuit_breaker(
     'production rollback: <reason>', '<failed_invariant>',
     'coldlion_licensor_property', null, 'production qsllyeztdwjgirsysgai', '<operator>', false, '{}'::jsonb);
   ```
   Also set the production schedule variable to `false`.
2. **Leave mirrors, alerts, observations, and failed runs intact.** Evidence is append-only.
3. **Confirm the curated path still works** — DesignFlow refs, statuses, and parents are
   untouched by design and must be verified as such.
4. **Compare protected hashes** against the §4.3 capture.
5. **If, and only if, the 542 ColdLion refs must be withdrawn** (canonical rows are never
   touched):
   ```sql
   -- Requires the breaker CLOSED, since the delete guard refuses while tripped.
   delete from core.taxonomy_source_ref
    where source_system = 'coldlion' and source_table = 'merchGroupDetails';
   update plm.erp_licensor set licensor_id = null where licensor_id is not null;
   update plm.erp_property set property_id = null where property_id is not null;
   ```
   This removes only ColdLion provenance and mirror links. It **never** touches
   `core.licensor`, `core.property`, statuses, or parents. Re-run §4.3 and confirm the
   canonical hashes are still identical to the pre-cutover capture.
6. **Fix forward through `shared-db`.** Reproduce on preview first. Re-enable only after a
   green readiness evaluation and an authorized
   `plm.reset_taxonomy_circuit_breaker(...)`.

Note the ordering trap: the breaker's delete guard refuses step 5 while the breaker is
tripped. That is deliberate — withdrawing approved links is a considered act, not an
incident reflex. Reset under authorization first, or the guard will stop you.

---

## 8. What this package does NOT do

- It does **not** authorize any production write.
- It does **not** create `SUPABASE_DB_PASSWORD_PRODUCTION`.
- It does **not** enable any production schedule.
- It does **not** start Phase 7, or Phase 8 (DesignFlow deprecation).
- It does **not** promote `20260727230000_core_style_guide_axis.sql`.
- It does **not** create Phase 5 canonical rows, link NASA, or touch the FRIDA KAHLO or ZAG
  exclusions.

**Next gate:** Step 8 — Albert's explicit, durable approval naming the exact project, the exact
migration list, the data modes, the secret action, the window, the monitoring, and this
rollback.
