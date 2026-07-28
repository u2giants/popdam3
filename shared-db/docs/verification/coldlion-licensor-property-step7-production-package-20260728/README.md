# ColdLion Licensor/Property — Step 7 bounded production change package

**Date:** 2026-07-28
**Status:** **PREPARED, NOT EXECUTED.** No production write has occurred or is authorized.
**Production project:** `qsllyeztdwjgirsysgai`
**Preview project:** `rjyboqwcdzcocqgmsyel`
**Human response owner:** Albert Hazan

This document is the complete package Step 9 would execute **if and only if** Albert grants
the Step 8 approval naming the exact migrations, modes, window, and rollback.
A general "go ahead" is explicitly **not** that approval.

Everything below was derived from an **owner-authorized read-only** production inspection on
2026-07-28. Nothing was written, and the detached worktree used for it was removed.

---

## 1. Bounded migration manifest — 10 files (9 + the hardening)

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

## 3. No production GitHub secret is needed — REMOVED from this request

The earlier draft asked to create GitHub Actions secret `SUPABASE_DB_PASSWORD_PRODUCTION`.
**That was wrong, and it is withdrawn.** A Codex review on 2026-07-28 asked why a *workflow*
secret was needed when **no production workflow exists** — and it does not. Every step below runs
from an operator's linked Supabase CLI session, using the production password read directly from
1Password vault `vibe_coding`, item `Supabase DB Password - shared POP database`.

Creating a long-lived production database password inside GitHub Actions for a one-time,
hand-watched cutover would have widened the blast radius for no benefit. **Nothing you approve
here creates a secret.** If recurring production automation is built later, that becomes its own
request.

## 3A. Pre-window prerequisites — prove each ONE BEFORE starting

Every one of these has to work before the first migration is applied. A missing
credential discovered mid-window, with production half-changed, is exactly the
pressure that produces improvisation.

| Prerequisite | Prove it with | Needed for |
|---|---|---|
| Supabase CLI authenticated | `supabase projects list` | everything |
| Production DB password | `op read` from vault `vibe_coding`, item `Supabase DB Password - shared POP database` | `supabase link` |
| **`COLDLION_API_KEY`** | `op read 'op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential'` — **added 2026-07-28 (Grok review); the earlier draft named only the DB password, and the ColdLion snapshot in §4.8 would have failed after the migrations were already applied** | the `mirror_only` snapshot |
| The apply checkout contains the production-auth tooling | `test -f tools/coldlion-production-authorization.mjs` in the temp worktree | §4.8 and §4.10 |
| DesignFlow PLM test login | 1Password `designflow PLM frontend gui access credentials` | §4.7 / §4.9 smoke |

## 4. Exact commands Step 9 would run

Every command names `qsllyeztdwjgirsysgai` explicitly. Run from a **detached temp worktree**,
never the shared checkout — other sessions churn it between turns.

### 4.1 Bounded checkout

```bash
git worktree add --detach C:/repos/shared-db-prod-apply-<date> fcca1f7b47b857f7c6da976d417220c13f6cf2ed
cd C:/repos/shared-db-prod-apply-<date>
rm supabase/migrations/20260727230000_core_style_guide_axis.sql
```

**The SHA is pinned deliberately, not floating `origin/main`.** `fcca1f7b47b857f7c6da976d417220c13f6cf2ed` is the merge
commit that contains the production-authorization tooling. Checking out bare `origin/main`
was a real defect (Grok review, 2026-07-28): at the time the package was written, `main`
carried the migrations but **not** the runners that can write to production, so following
the package literally would have applied the migrations and then aborted mid-window. Verify
before going further:

```bash
test -f tools/coldlion-production-authorization.mjs && echo "production tooling present"
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
  -- STRENGTHENED 2026-07-28 (Codex review): the earlier hash covered only
  -- system|table|source_id, so a ref silently REPOINTED to a different canonical row
  -- or entity type would not have changed it. Include entity type and target UUID,
  -- and hash the two source systems separately so a ColdLion change cannot mask a
  -- DesignFlow change (or vice versa).
  'coldlion_ref_hash', (select md5(coalesce(string_agg(
        entity_table||'|'||entity_id::text||'|'||source_id||'|'||coalesce(source_code,''),
        '|' order by source_id),'')) from core.taxonomy_source_ref where source_system='coldlion'),
  'designflow_ref_hash', (select md5(coalesce(string_agg(
        entity_table||'|'||entity_id::text||'|'||source_id||'|'||coalesce(source_code,''),
        '|' order by source_id),'')) from core.taxonomy_source_ref where source_system='designflow_plm'),
  'coldlion_ref_count', (select count(*) from core.taxonomy_source_ref where source_system='coldlion'),
  'designflow_ref_count', (select count(*) from core.taxonomy_source_ref where source_system='designflow_plm'),
  'licensor_code_name_hash', (select md5(coalesce(string_agg(id::text||'|'||coalesce(code,'')||'|'||coalesce(name,''),'|' order by id::text),'')) from core.licensor),
  'property_code_name_hash', (select md5(coalesce(string_agg(id::text||'|'||coalesce(code,'')||'|'||coalesce(name,''),'|' order by id::text),'')) from core.property)));
```

Save the output. It is the comparison basis for §4.8 and the rollback decision.

**The DesignFlow ref hash and count must be identical afterwards.** The ColdLion ref hash and
count are the only values expected to move, and only from 0 to exactly 542.

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

### 4.7 DesignFlow PLM read-only smoke — BEFORE any link is written

**Reordered on 2026-07-28 following the Codex review.** The earlier draft checked DesignFlow only
after linking. DesignFlow is the one fully live application and it was never exercised on preview
(`plm.item` is empty there), so it is the largest untested risk in this cutover. Checking it now —
after the migrations, before a single link row exists — means a failure here needs **no data
cleanup at all**: nothing has been added yet, and the migrations are inert additive objects that
no application reads.

Read-only. Do not create or modify any production record.

- Licensor and Property selectors populate
- An existing item displays correctly
- Tracking references resolve
- A saved UUID deep-link opens the expected record
- No new application errors in the named log sources

**If anything looks wrong here, STOP and report to Albert. Do not proceed to 4.8.** Rolling back
at this point is simply "do nothing further".

### 4.8 Guarded snapshot, then the approved link, then re-hash

Both runners now take a **four-part production authorization**. Before 2026-07-28 they were
hard-coded preview-only and would have **aborted mid-window** on these exact commands — the defect
Codex caught. All four parts are required; any one missing refuses with a message naming what is
absent.

```bash
export COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true

# 1. Guarded ColdLion snapshot (mirror_only — writes no canonical row)
node tools/sync-coldlion-licensors-properties.mjs --apply --linked \
  --production --production-authorized --project-ref qsllyeztdwjgirsysgai

# 2. The approved link — exactly the frozen 542
node tools/run-coldlion-licensor-property-phase4.mjs --apply --linked \
  --production --production-authorized --project-ref qsllyeztdwjgirsysgai
```

Each run prints `"authorized_target": "PRODUCTION qsllyeztdwjgirsysgai (explicitly authorized)"`.
**If it prints preview, stop** — you are not where you think you are.

Expected: `rows_seen 542`, `rows_unchanged`/`rows_inserted` totalling 542, licensor 38 /
property 504, snapshot hash `1230f5a12d0f2a3029f1d3df17fc5b5f`. Re-run §4.3 and compare:
**licensor UUID, property UUID, status, and parent-edge hashes must be UNCHANGED.** Only the
source-ref hash and the ColdLion ref count may change, and only by exactly 542 added rows.

### 4.9 Repeat the DesignFlow smoke, now with links present

Same read-only checks as §4.7. This is the one that proves the cutover itself changed nothing
DesignFlow depends on.

### 4.10 Readiness, in explicitly production-authorized mode

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
4. **Compare protected hashes** against the §4.3 capture. In most incidents the rollback ends
   here: the lane is stopped, nothing canonical moved, and the 542 refs are harmless additive
   provenance that can safely stay while the defect is fixed forward.
5. **Only if the links must actually be withdrawn** — reset under authorization, withdraw
   **exactly the frozen 542**, then immediately re-arm:

   ```bash
   # 5a. Generate the withdrawal SQL FROM the frozen approval artifact, so the
   #     rollback can only ever remove what was approved.
   node tools/emit-coldlion-rollback-sql.mjs > rollback-542.sql

   # 5b. READ IT. It must contain exactly 542 source ids and a guard that aborts
   #     if the count is anything else.
   grep -c "^    ('" rollback-542.sql     # must print 542
   ```

   ```sql
   -- 5c. The delete guard refuses while tripped, by design. Reset deliberately.
   select plm.reset_taxonomy_circuit_breaker(jsonb_build_object(
     'authorized_by', '<named human>',
     'readiness_pass', true,
     'readiness_evidence', 'production rollback <date>: withdrawing the approved 542 links'));
   ```

   ```bash
   # 5d. Apply the generated, reviewed SQL.
   supabase db query --linked --file rollback-542.sql
   ```

   **This SQL has actually been executed**, against preview inside a rolled-back
   transaction on 2026-07-28, and it reported `coldlion_refs_remaining 0`,
   `mirror_licensor_links_remaining 0`, `mirror_property_links_remaining 0` before
   rolling back. That run is how a real defect was found: nulling the mirror link
   without also resetting `resolution_status` violates
   `plm_erp_licensor_resolution_link_ck` and aborts the whole rollback with `23514`.
   The emitter now clears both together. **Rollback SQL that nobody has run is not a
   rollback plan** — this one has been run.

   This touches **no** `core.licensor` or `core.property` row, no status, and no parent.

6. **Re-arm immediately.** Leaving the breaker closed after a rollback would leave the lane open
   for the next scheduled run to re-create exactly what was just withdrawn:
   ```sql
   select plm.trip_taxonomy_circuit_breaker(
     'post-rollback hold: lane intentionally stopped pending fix-forward',
     'post_rollback_hold', 'coldlion_licensor_property', null,
     'production qsllyeztdwjgirsysgai', '<operator>', false, '{}'::jsonb);
   ```
7. **Re-check hashes and re-run the DesignFlow read-only smoke** (§4.7).
8. **Fix forward through `shared-db`.** Reproduce on preview first. Re-open the lane only after a
   green readiness evaluation and a fresh authorized `plm.reset_taxonomy_circuit_breaker(...)`.

Two deliberate frictions, both corrected or confirmed in the 2026-07-28 Codex review: the delete
guard refuses while tripped (withdrawing approved links is a considered act, not an incident
reflex), and the rollback re-arms rather than finishing in an open state.

**Known limitation, stated rather than hidden:** the breaker stops the *next* attempt. The
material does not prove it can abort a ColdLion write that began in the same instant the trip
landed. In practice these runs are manual and serialized by an advisory lock, so the window is
very small — but it is not zero, and it should not be described as if it were.

---

## 8. What this package does NOT do

- It does **not** authorize any production write.
- It does **not** create any GitHub secret. That request was withdrawn (§3).
- It does **not** enable any production schedule.
- It does **not** start Phase 7, or Phase 8 (DesignFlow deprecation).
- It does **not** promote `20260727230000_core_style_guide_axis.sql`.
- It does **not** create Phase 5 canonical rows, link NASA, or touch the FRIDA KAHLO or ZAG
  exclusions.

**Next gate:** Step 8 — Albert's explicit, durable approval naming the exact project, the exact
migration list, the data modes, the window, the monitoring, and this rollback.

---

## 9. Revision history

| Date | Change |
|---|---|
| 2026-07-28 (first draft) | Original package written from the owner-authorized read-only production inventory |
| 2026-07-28 (revision 3) | **Grok review found six more "cannot be run as written" faults**, all confirmed: the checkout SHA pointed at bare `origin/main` which lacked the new tooling; the sync runner never printed the `authorized_target` the package told the operator to check; `COLDLION_API_KEY` was missing from the prerequisites; the rollback used an unbound `:approved_mapping_json`; **readiness skipped the target check under production authorization and could have reported green against preview**; and a `/tmp` path on a Windows machine. All fixed. Executing the generated rollback on preview then exposed a seventh: nulling a mirror link without resetting `resolution_status` violates `plm_erp_licensor_resolution_link_ck` and aborts the whole rollback — corrected, and the SQL has now actually been run end to end |
| 2026-07-28 (revision 2) | **Codex review found the package could not be executed**: both write runners were hard preview-only, so §4.8 would have aborted mid-window. Added four-part production authorization to both runners (`tools/coldlion-production-authorization.mjs`, 7 new tests) and proved the refusals. Also: DesignFlow smoke moved **before** linking so a failure needs no cleanup; rollback bound to the **exact frozen 542** instead of every ColdLion row, and now re-arms the breaker; pre/post hashes strengthened to include entity type, canonical UUID and code, with ColdLion and DesignFlow hashed separately; the production GitHub secret request **withdrawn** as unnecessary |
