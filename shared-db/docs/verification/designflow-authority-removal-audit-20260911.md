# Issue #2602 — DesignFlow removed from licensing authority decisions (audit, 2026-09-11)

Plan step 4.2 of `plan_licensing_master_data_implementation.md`. Read-only audit;
no structural change was required.

Target proven before every read: Supabase MCP URL `https://qsllyeztdwjgirsysgai.supabase.co`,
compared equal to `ai-private-config value supabase_shared_prod_ref` (production).
Repository base: `origin/main` `5eaebe7c09683aef77bdef92aec454af5dddf2cb`.

## Verdict per item named in the issue

| Item | Call site | Finding |
|---|---|---|
| `plm.import_master_data(jsonb,jsonb)` | `supabase/migrations/20260817124545_licensing_write_authority_guard.sql` | Live body is an unconditional `raise exception 'retired by #1090 Step 1.0 ...'`; EXECUTE revoked from public, anon, authenticated, service_role. Contract: `supabase/tests/licensing_write_authority_guard_contracts.sql`. |
| `plm-sync` path | `systemd/plm-sync.timer`, `systemd/plm-sync.service`, `tools/run-plm-master-data-sync.sh`, `tools/sync-plm-master-data.mjs` | Host timer: `Loaded: ... disabled`, `Active: inactive (dead)`, `Trigger: n/a` (read 2026-09-11). The only database target of this path is the retired function above, so even a manual run cannot write licensing identity. CI (`coldlion-licensor-property-phase6-parallel.yml`) runs it `--preview-only`. |
| DesignFlow Cloud SQL / API | `tools/coldlion-licensor-property-phase3-designflow-snapshot.mjs` | Writes only local JSON files (`designflow-fresh-snapshot.json`, `designflow-fresh-edges.json`) — a historical comparison, never a database write. No other repository caller of `getLicensorsWithProperties`. |
| `dflow.*` objects in licensing resolution | production catalog | See the two queries below: no live function or view that writes or resolves canonical licensing identity reads `dflow.*`. |

## Query 1 — functions that write licensing tables and mention DesignFlow

Predicate: `prosrc` matches `insert into|update|delete from core.(licensor|property|character|style_guide|franchise|asset)`
AND matches `dflow\.|designflow|plm\.(licensor|property)_import`.

Result: one function, `plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)`, `reads_dflow = false`.
Its only DesignFlow reference (body line 64) is an **exclusion**:
`and sr.source_system not in ('coldlion','designflow_plm')) as higher_authority` —
a DesignFlow source resolution can never count as a higher authority. That is §4 of
`docs/core-master-data-consolidation-aim.md` enforced, not violated.

## Query 2 — views over `dflow.*` that touch licensing tables

Result: one view, `public.style_tracker_rows_with_bridge` (references `core.licensor` for display).
It is read-only; `pg_depend` shows no dependent view and no function body references it,
so no licensing resolution or write consumes it.

## Positive controls (the search can fail)

- `CONTROL:any_fn_reading_dflow` returned true: live functions reading `dflow.*` exist, so the
  `dflow\.` predicate matches real catalog text.
- A known-dirty literal `select * from dflow.x join core.property p` returned true for both predicates.
- Query 1 did return a row (the exclusion above), proving the combined predicate is not vacuous.

## Out of scope

Changes inside DesignFlow application repositories route to those repositories' own sessions.
