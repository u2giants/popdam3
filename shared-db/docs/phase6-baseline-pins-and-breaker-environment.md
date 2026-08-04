# Phase 6 baseline pins + breaker environment (2026-08-04)

Two fix-forward migrations. Neither edits an applied migration.

- `20260804120000_taxonomy_baseline_pins_table.sql`
- `20260804120100_taxonomy_breaker_environment_and_provenance.sql`
- Contract tests: `supabase/tests/taxonomy_baseline_pin_and_breaker_environment_contracts.sql`

## What was wrong

`20260726180000` pinned the Phase 4 baseline as PL/pgSQL `constant` declarations in
two functions. On 2026-08-02 the approved owner ruling in
`20260802171000_owner_ruling_friends_tv_frida_kahlo.sql` set a licensor to
`inactive`. That is correct data, and it changed `core.licensor`'s status hash from
`d9b07759bf80ff227e2fa9bd635d2138` to `00bf7069fff79b9deab1d14dbd9112b2`. The pinned
constant could not follow, because an applied migration is immutable.

Verified live on preview `rjyboqwcdzcocqgmsyel` on 2026-08-04: **every other pin
still matched exactly** — 26 licensors, 256 properties, 1047/542/505 source refs,
38/504 links, both UUID hashes, the property status hash, the parent edge hash.
Exactly one value differed. That single-value signature is what distinguishes an
owner ruling from real drift.

Consequences: `baseline_ok` false on every non-drill observation since 2026-08-03,
a critical alert daily (23 unacknowledged, 08-02 to 08-04), and the
`coldlion_licensor_property` breaker auto-tripped at 2026-08-02 11:16:31-04.

Separately, `plm.taxonomy_circuit_breaker.environment` held
`auto (alert 4f44ec88-…)` — provenance, not an environment — because the auto-trip
functions in `20260728134500` call the trip function **positionally** and the 5th
slot is `p_environment`. The fallback in `20260727221500` line 170 was
`server_version_num`, a PostgreSQL version.

## What changed

`plm.taxonomy_baseline_pin` holds the expected values as rows with provenance
(who pinned it, when, why). Both Phase 6 functions read it via
`plm.taxonomy_baseline_pin_set()`, which **raises** if any of the twelve metrics
has no live pin — a missing pin must never read as "nothing to compare". The table
is append-only: a pin is retired by stamping `superseded_at`, enforced by a
**structural** trigger that does not consult `auth.role()` (NULL inside a
migration, which makes any role-based guard silently permissive).

`trip_provenance` columns now carry the cause. `plm.deployment_environment` names
the database. The trip function gained `p_provenance` as a ninth parameter with a
default, so all nine existing call sites work unchanged, and the two auto-trip
functions now call it with **named** arguments.

## These pins are PREVIEW values. Production must not use them.

AGENTS.md §6.5 (owner ruling, 2026-08-03): "production has `FR` active, preview has `FR`
inactive. This divergence is KNOWN, EXPECTED and ACCEPTED [...] do not re-report it as
drift." `20260802171000` is held off production until the FR removal work ships, so
production's live licensor status hash is **not** `00bf7069…`, and production is out of
bounds for this session to measure.

If these pins simply became active on promotion, production's first observation would
report `baseline_ok = false`, raise a **critical** alert, and the auto-trip trigger would
trip the **production** ColdLion breaker — over a divergence the owner has ruled is not a
bug.

**The gate:** a baseline governs nothing until it is explicitly activated, and the
migration activates nothing. `plm.taxonomy_baseline_activation` starts empty everywhere.
Where no baseline is active, both detectors **refuse**: a failed `ingest.sync_run` plus a
**warning** alert (deduplicated to one standing warning), no observation row, no breaker
trip. Not a false green, not a false red. The refusal does not depend on the environment
being named, which matters because production reads `unconfigured` until someone names it.

`plm.activate_taxonomy_baseline()` additionally refuses in an unnamed database, refuses a
baseline declared for a different environment, and refuses an incomplete baseline.

When the FR removal work ships: derive production's twelve values **from production**, seed
them under `phase4_production` in a new migration, and activate that.

## Blind detector leaves evidence

`plm.taxonomy_baseline_pin_set()` raises when a metric has no live pin, and the append-only
trigger permits stamping `superseded_at` without a replacement — so one permitted UPDATE
could blind both detectors. The baseline is therefore resolved in the function **body**, not
the DECLARE block, and the raise is caught: each detector records a failed `sync_run` and a
**critical** alert (fail closed) and returns, instead of raising out and rolling back every
trace that it ran.

## Required post-apply step, once per environment

No in-database value distinguishes preview from production (probed 2026-08-04: no
project ref in `pg_settings`, `pg_db_role_setting`, `pg_roles`; `current_database()`
is `postgres` and `cluster_name` is `main` in both). So the environment is explicit
configuration, seeded loud as `unconfigured (db=postgres)` rather than guessed.

Run both statements, in order, after the migrations apply:

```sql
update plm.deployment_environment
   set environment_name  = 'preview rjyboqwcdzcocqgmsyel',   -- production: 'production qsllyeztdwjgirsysgai'
       configured_by     = 'Albert Hazan (owner)',
       configured_at     = now(),
       configured_reason = 'Supabase preview project for the shared backend',
       updated_at        = now()
 where singleton;

update plm.taxonomy_circuit_breaker
   set environment = plm.resolve_deployment_environment(), updated_at = now()
 where environment is null;
```

Then, and **only** where a baseline derived from *that* database exists:

```sql
select plm.activate_taxonomy_baseline(
  'phase4_preview',                      -- production: its own key, e.g. 'phase4_production'
  'preview rjyboqwcdzcocqgmsyel',
  'Albert Hazan (owner)',
  'Phase 6 parallel run is a preview exercise; pins derived from preview on 2026-08-04.');
```

Already done on preview. **Production has not been touched, and must NOT be activated
until the FR removal work ships.**

## Evidence (preview, 2026-08-04)

| Proof | Result |
|---|---|
| Positive: new observation  `0b92e36a-…` | `baseline_ok = true`, `pass = true`, hash `00bf7069…` |
| Negative: forced drill | alert `fba552fa-…`, `severity = critical`, `is_drill = true` |
| Wrong pin injected (rolled back) | `baseline_ok` flips to false — the gate reads the table |
| Grants before / after | `postgres=X/postgres ; service_role=X/postgres` on every replaced function — unchanged |
| Production simulation: unnamed database, no activation | both detectors refuse — `pass=false`/`ok=false`, **warning** alerts only, trip events unchanged at 6, **zero** observation rows written |
| Activation in an unnamed database | refused |
| Activation of a preview baseline declared for production | refused |
| Blind detector (pin superseded, no replacement) | failed `sync_run` + **critical** alert survive; no observation row |
| TRUNCATE of the pin table | refused |

The 23 pre-existing alerts were **not** acknowledged and the breaker was **not**
reset. Clearing them is a separate step that must happen after this lands, or the
evidence that the fix worked is destroyed.
