# DS → DY at its source — chain of custody, blast radius, and plan

Date: 2026-08-07
Status: **investigation + recommendation. Nothing was changed. No migration was written.**
Owner ruling being planned: *"Don't hard-code DS to DY, change DS to DY at its source."* (Albert, 2026-08-07)

Database contacted: **production `qsllyeztdwjgirsysgai`** only (verified via `get_project_url` before every
read). All reads were `select` / catalog only. Preview `rjyboqwcdzcocqgmsyel` was **not** contacted.

Prior work this builds on (not re-derived): `docs/verification/disney-licensor-identity-20260807/README.md`,
`AGENTS.md` §6.12, migration `20260723113000_dam_core_licensor_property_cutover.sql`.

---

## 0. Headline

Three findings change the shape of the job.

1. **There is no upstream source.** `public.licensors` is not created, seeded, or written by **any** of the
   400 migrations in this repo, and **no database function writes it**. Its rows were hand-entered in the
   PopDAM admin UI on 2026-03-13, three months before the canonical taxonomy existed. The row *is* the
   source. Changing it is therefore the correct, permanent fix — not a band-aid.
2. **The hard-coded `case … when 'DS' then 'DY'` survives in exactly one live database object** — the view
   `public.dam_character_catalog`. After the data change that expression becomes a **provable no-op**, and
   the view has a second, independent name-matching arm that also succeeds. Nothing breaks.
3. **There is a trap that would have caused real damage.** Thirty rows in `public.assets` and six rows in
   `public.style_groups` carry `licensor_code = 'DS'` and **have nothing to do with Disney**. The `DS` was
   sliced out of item SKUs like `MCZ6X**DS**PT01` and `GF152**DS**EN01`. All of them have
   `licensor_name IS NULL`, `licensor_id IS NULL`, `is_licensed = false`. A sweep that changed every `'DS'`
   to `'DY'` would silently relabel 30 generic-decor assets as Disney property. **These must not be touched.**

---

## 1. Chain of custody for the value `DS`

### 1.1 Where it does *not* come from (evidence)

| Claim | Evidence |
|---|---|
| No migration creates `public.licensors` | `grep -rn "licensors" supabase/migrations/*.sql` — 400 migration files, **zero** `create table`, `insert into`, or `update` against it. Only `left join`, one FK, and two `comment on` statements. |
| No migration seeds the value `'DS'` into it | `git log -S"'DS'" -- supabase/migrations` returns exactly two commits (`6daff9c`, `7c8034c`), both of which only *read* `external_id` in the cutover remap. |
| No database function writes it | Catalog scan of every `pg_proc` in `public/core/plm/dam/api/app/crm` whose body mentions `licensors`: only 4 functions (`api.db_data_admin_licensor_property_list`, `api.db_data_admin_licensor_property_tree`, `plm.import_master_data`, `plm.refresh_style_tracker_item_bridge`) and **all four are read-only** against it. |
| The Coldlion/PLM importer does not feed it | `plm.import_master_data` takes a `licensors_payload` from `getLicensorsWithProperties` but writes to `plm.licensor_import` and `core.licensor`, never `public.licensors`. |
| It predates the repo's DAM work | Row `created_at` values are **2026-03-13 14:28–15:23 (America/New_York)**. `core.licensor` was created 2026-06-25. The cutover ran 2026-07-23. |

### 1.2 Where it *does* come from

`public.licensors` is an original PopDAM (Lovable-era) application table, created outside migration control
and populated by hand through the PopDAM admin screen. The write path that still exists today is:

- Table ACL: `anon`, `authenticated`, `service_role` all hold full `arwdDxtm` (owner `postgres`).
- RLS is **enabled**, with two policies:
  - `Authenticated read licensors` — `SELECT`, `qual = true`
  - `Admin write licensors` — `ALL`, `qual = has_role(auth.uid(), 'admin'::app_role)`

So a PopDAM `admin` user can still change `external_id` from the app at any time. That is the only live
writer. It is a human, not a system.

**Conclusion: the source of `'DS'` is the row itself.** There is nothing upstream of it inside this
database or this repo. `AGENTS.md` §6.12 and the two `comment on` statements added by the cutover already
declare the table `DEPRECATED compatibility storage`.

### 1.3 Where the value is read

Complete list of live readers of `public.licensors.external_id`, from the catalog:

| Object | How it uses the value |
|---|---|
| `public.dam_character_catalog` (view) | `join core.licensor on lower(code) = lower(case external_id when 'DS' then 'DY' when 'WWE' then 'WW' else external_id end) **or** lower(trim(name)) = lower(trim(legacy.name))` |

That is the **only** one. Verified two ways: a scan of every view/matview/function/check-constraint whose
definition contains the literal `'DS'` returns `public.dam_character_catalog` and nothing else; a scan for
objects mentioning both `licensors` and `external_id` returns the same single view.

The two foreign keys into `public.licensors` are on `id`, not on `external_id`:

- `plm.style_tracker_item_bridge.public_licensor_id`
- `public.properties.licensor_id`

Neither is affected by changing a text code.

### 1.4 Current census (production, `count(*)`, not `n_live_tup`)

| `external_id` | name | properties | characters | bridge rows |
|---|---|---:|---:|---:|
| WB | Warner Bros | 154 | 4,090 | 0 |
| **DS** | **Disney** | **124** | **1,097** | **4,048** |
| NB | NBCUniversal | 123 | 0 | 0 |
| MV | Marvel | 54 | 3,824 | 2,771 |
| VM | Paramount | 34 | 0 | 5 |
| SE | Sega | 6 | 0 | 374 |
| PN | Peanuts | 2 | 0 | 304 |
| **WWE** | **WWE** | **1** | **604** | **42** |
| SS | Strawberry Shortcake | 1 | 1 | 0 |
| CC | Coca Cola | 1 | 6 | 0 |

`external_id` has a **unique index** (`licensors_external_id_key`). `'DY'` and `'WW'` are both **free**
(0 rows each), so the rename cannot collide.

---

## 2. Blast radius — including the application-repo gap that prior work left open

`disney-licensor-identity-20260807/README.md` §3.2 stated its read/write map was inferred with **no app repo
read**. That gap is now closed for the repos present on this machine.

### 2.1 Application repositories — searched

Searched for the literal UUID `10a445bc-cdb8-4384-ad6f-a46fd029f2bc`, the `core.licensor` UUID prefix
`7d141a6f`, quoted `'DS'`/`"DS"`, quoted `'WWE'`/`'WW'`, the word *Disney* in source, and the table name
`licensors`/`external_id`.

| Repo | Present | Licensor-code hard-code found |
|---|---|---|
| `C:\repos\popcrm-web` | yes | **none in app source.** Only in a vendored copy of shared-db at `popcrm-web\shared-db\`. Its one licensor surface is `licensor_approval_thread` (free-text comments). Zero *Disney* references in `src`. |
| `C:\repos\dflow\designflow-backend` | yes | **none in app source** (vendored shared-db copy only) |
| `C:\repos\dflow\designflow-bff` | yes | none |
| `C:\repos\dflow\designflow-frontend` | yes | none in logic; `'Disney'` appears only in `*.spec.ts` fixtures and docs |
| `C:\repos\dflow\designflow-item-master` | yes | none |
| `C:\repos\dflow\designflow-tracking` | yes | none in logic; `'Disney'` only as a mock value in `tests/unit/lic.filter-values.test.js` and `lead-time.controller.test.js` |
| `C:\repos\dflow\designflow-data-syncing` | yes | none |
| `C:\repos\oracle` | yes | zero hits of any kind |

**The UUID `10a445bc-cdb8-4384-ad6f-a46fd029f2bc` appears in zero application repositories.** Its only
occurrences on this machine are shared-db documentation and one AI transcript.

### 2.2 Repositories NOT on this machine — **unclosed gap**

`popdam3`, `poppim-web`, `monitor`, `hiclaw` are **not present** on this machine (`C:\repos` is the only
repo root; there is no `D:` drive). **`popdam3` is the one that matters** — it is the application that owns
the `public.licensors` admin screen and the only known live writer of `external_id`. It has not been read.
See §6 for what that means for the go/no-go.

### 2.3 Inside `shared-db` itself

| File | Line(s) | What it is | Effect of the data change |
|---|---|---|---|
| `supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql` | 19, 27 | one-time `create temporary table … on commit drop` backfill | **already ran; cannot run again.** Irrelevant. |
| `supabase/migrations/20260723113000_…sql` | 221 | the `create view public.dam_character_catalog` body | becomes a no-op (§3) |
| `supabase/migrations/20260723112930_dam_core_taxonomy_finalize_core_fks.sql` | 176 | earlier version of the same view body | same |
| `tools/dam-core-taxonomy-safe-cutover.mjs` | 130, 507 | `normalizeLegacyLicensorCode()` and generated SQL | becomes a no-op; **leave in place** as a safety net |
| `tools/dam-core-taxonomy-safe-cutover.test.mjs` | 73, 81, 376 | unit tests asserting the remap | **must keep passing.** Do not delete; the function must still map `DS→DY` for any future legacy input. |
| `scripts/dam-core-taxonomy-safe-cutover/sql/00,02,03,04_*.sql` | various | one-shot operational scripts, already run | inert |
| `apps/db-data-admin/src/lib/property-rows.test.ts` | 26 | test fixture `code: 'DS'` | cosmetic only; **optional** follow-up |
| `tools/process-style-guide-licensing-review.mjs` | 123 | `addRule('WW', 'Wonder Woman character family', …)` | **`WW` here means Wonder Woman, not WWE.** Unrelated namespace. Do not touch. |
| `tools/build-licensing-questions-csv.mjs` | 8 | `{1:'Disney', …, 12:'WWE'}` legacy merch-group id map | unrelated to `external_id`; leave |

`apps/db-data-admin` reads licensor codes through `api.db_data_admin_licensor_property_tree`, which does
**not** read `public.licensors.external_id`. It is unaffected.

### 2.4 The trap — denormalized `licensor_code` text columns

These columns hold licensor codes as free text and are **not** covered by the `public.licensors` row:

| Table.column | `DS` | `DY` | `WWE` | `WW` |
|---|---:|---:|---:|---:|
| `public.assets.licensor_code` | **30** | 30,894 | **15** | 381 |
| `public.style_groups.licensor_code` | **6** | 2,746 | 0 | 36 |

They split cleanly into two very different cases, and `licensor_name` is the discriminator:

**(a) The 30 `assets` + 6 `style_groups` rows with `licensor_code = 'DS'` are NOT Disney.**
All 30 assets have `licensor_name IS NULL`. All 6 style groups have `licensor_name IS NULL`,
`licensor_id IS NULL`, `is_licensed = false`. Their SKUs are generic decor:

```
MCZ6XDSPT01   FAM6XMSSPT01   GF152DSEN01   MWB21DSPT01   VDE83HDSUC01   VS162DSPT01
folder e.g.  Decor/Generic Decor/_New structure/GFZ_/15x20/GF152DSEN01/…
```

The `DS` is a substring of the style number, picked up by SKU parsing. **Changing these to `DY` would
falsely label 30 unlicensed decor assets as Disney.** Leave them alone. (They also explain why
`style_groups` shows `DS` rows created 2026-08-05, *after* the July cutover — `style_groups` is derived
from `assets` by `public.rebuild_style_groups_batch`, so the rebuild simply re-derived the same artifact.
There is no rogue writer.)

**(b) The 15 `assets` rows with `licensor_code = 'WWE'` ARE genuinely WWE.**
All 15 have `licensor_name = 'WWE'`. These are true stragglers the 2026-07-23 cutover missed. The canonical
pair is `WW` / `'WWE'` (379 rows already correct).

---

## 3. What the applied cutover migration means

`20260723113000_dam_core_licensor_property_cutover.sql` is **applied**. The `supabase_migrations` ledger
records that version, so the CLI will never re-run it. **It must never be edited** — an edit would change
nothing in the database and would desynchronise the file from the ledger.

Its `case … when 'DS' then 'DY' when 'WWE' then 'WW' else … end` appears three times:

- **Lines 19 and 27** are inside `create temporary table dam_legacy_licensor_map … on commit drop`. That
  temp table lived for the length of one transaction in July. It is gone. Those two occurrences are dead
  text in a file that will never execute again.
- **Line 221** is the body of `create or replace view public.dam_character_catalog`. That expression is
  **live right now**, baked into the view definition stored in the catalog.

### Does line 221 break after the data change? No. Proven.

Simulated in production, read-only, for all ten licensors — evaluating the `case` against the current value
and against the post-change value, and counting matching `core.licensor` rows under each:

| licensor | code today | code after | identical | core matches today | core matches after |
|---|---|---|---|---:|---:|
| Disney | DY | DY | yes | 1 | 1 |
| WWE | WW | WW | yes | 1 | 1 |
| *(all other 8)* | unchanged | unchanged | yes | 1 | 1 |

Mechanism: with `external_id = 'DY'`, the `when 'DS'` arm no longer matches, so the `else` branch returns
`'DY'` — the same string the `when` arm used to produce. The expression is **idempotent**, so it degrades to
a harmless pass-through. On top of that the join has a second arm,
`lower(trim(canonical_licensor.name)) = lower(trim(legacy_licensor.name))`, and `'Disney'` vs `'DISNEY'`
matches case-insensitively regardless. Two independent paths both hold.

**No other live code path depends on the old value existing.** The catalog scan for `'DS'` across every
view, function, procedure and check constraint returned only this view.

---

## 4. The `WWE` / `WW` twin

Same shape, same migration, never documented.

| | Disney | WWE |
|---|---|---|
| `public.licensors` row | `10a445bc-cdb8-4384-ad6f-a46fd029f2bc` `Disney` / `DS` | `1e3ebfce-7d9d-4424-a68c-73c4e57b6d83` `WWE` / `WWE` |
| `core.licensor` row | `7d141a6f-e229-46a2-b3f5-0ba0c97dd820` `DISNEY` / `DY` | `7575d1db-dbee-4336-84a9-aa378f05f105` `WWE` / `WW` |
| properties / characters / bridge | 124 / 1,097 / 4,048 | 1 / 604 / 42 |
| target code free? | `DY` — 0 rows, yes | `WW` — 0 rows, yes |

**The WWE/WWF caution does not apply here.** `core.licensor` contains no `WWF` row and no other wrestling
entity — the only codes beginning with `W` are `WB` (WARNER BROS) and `WW` (WWE). The rename is
`WWE` → `WW`, a code-format normalisation within one company, not a merge of two companies. Nothing is
being conflated.

**Recommendation: it rides along.** Both values are set by the same `case` in the same view, both are proved
no-ops by the same simulation, and both are one-row updates on the same table. Splitting them leaves the
codebase in a state where half the hard-code is dead and half is live, which is worse to reason about than
either endpoint. Doing them together costs nothing extra.

---

## 5. The plan

Design: **one forward migration**, idempotent, fails loudly, no data loss, trivially reversible.

### 5.1 Scope

**In scope (3 statements):**

1. `public.licensors` — `external_id`: `'DS'` → `'DY'` (1 row, pinned by UUID)
2. `public.licensors` — `external_id`: `'WWE'` → `'WW'` (1 row, pinned by UUID)
3. `public.assets` — `licensor_code`: `'WWE'` → `'WW'` **only where `licensor_name = 'WWE'`** (15 rows)

**Explicitly out of scope, with reason:**

- `public.assets` / `public.style_groups` rows with `licensor_code = 'DS'` — **SKU-parsing artifacts, not
  Disney** (§2.4a). Touching them is a data-corruption bug.
- The view `public.dam_character_catalog` — leave the `case` in place. It is a proven no-op and it is a free
  safety net if a legacy code ever reappears.
- `tools/dam-core-taxonomy-safe-cutover.mjs` and its tests — leave. Same reasoning.
- Migration `20260723113000` — **never edit**.

### 5.2 Preconditions the migration must assert (each aborts the transaction)

1. `public.licensors` row `10a445bc-cdb8-4384-ad6f-a46fd029f2bc` exists.
2. `public.licensors` row `1e3ebfce-7d9d-4424-a68c-73c4e57b6d83` exists.
3. No *other* row already holds `external_id = 'DY'` or `'WW'` (would violate `licensors_external_id_key`).
4. `core.licensor` `7d141a6f-…` has `code = 'DY'`; `core.licensor` `7575d1db-…` has `code = 'WW'`.
5. Every row in `public.licensors` resolves to exactly one `core.licensor` **after** the change (re-run of
   the §3 simulation, in-migration).
6. Row count of `public.dam_character_catalog` is identical before and after.

### 5.3 The migration

Filename: `supabase/migrations/<UTC-timestamp>_licensors_external_id_canonical_codes.sql`
(pick the timestamp at authoring time; it must sort after `20260807030000`).

```sql
-- Change DS -> DY and WWE -> WW at their source: the public.licensors rows themselves,
-- replacing the reliance on the hard-coded remap baked into public.dam_character_catalog.
-- Owner ruling 2026-08-07: "Don't hard-code DS to DY, change DS to DY at its source."
-- Idempotent. Aborts loudly on any unmet precondition. No object is dropped or replaced.

set local statement_timeout = '5min';

do $$
declare
  c_disney_legacy constant uuid := '10a445bc-cdb8-4384-ad6f-a46fd029f2bc';
  c_wwe_legacy    constant uuid := '1e3ebfce-7d9d-4424-a68c-73c4e57b6d83';
  c_disney_core   constant uuid := '7d141a6f-e229-46a2-b3f5-0ba0c97dd820';
  c_wwe_core      constant uuid := '7575d1db-dbee-4336-84a9-aa378f05f105';
  v_before        bigint;
  v_after         bigint;
  v_code          text;
  v_bad           bigint;
  v_n             bigint;
begin
  -- ---------- preconditions ----------
  if not exists (select 1 from public.licensors where id = c_disney_legacy) then
    raise exception 'abort: legacy Disney licensor row % is missing', c_disney_legacy;
  end if;
  if not exists (select 1 from public.licensors where id = c_wwe_legacy) then
    raise exception 'abort: legacy WWE licensor row % is missing', c_wwe_legacy;
  end if;

  select code into v_code from core.licensor where id = c_disney_core;
  if v_code is distinct from 'DY' then
    raise exception 'abort: core.licensor % has code %, expected DY', c_disney_core, coalesce(v_code,'<missing>');
  end if;
  select code into v_code from core.licensor where id = c_wwe_core;
  if v_code is distinct from 'WW' then
    raise exception 'abort: core.licensor % has code %, expected WW', c_wwe_core, coalesce(v_code,'<missing>');
  end if;

  select count(*) into v_bad
  from public.licensors
  where external_id in ('DY','WW') and id not in (c_disney_legacy, c_wwe_legacy);
  if v_bad <> 0 then
    raise exception 'abort: % other public.licensors row(s) already hold DY or WW; unique index would be violated', v_bad;
  end if;

  select count(*) into v_before from public.dam_character_catalog;

  -- ---------- the change (idempotent: re-running matches 0 rows) ----------
  update public.licensors set external_id = 'DY', updated_at = now()
   where id = c_disney_legacy and external_id = 'DS';
  update public.licensors set external_id = 'WW', updated_at = now()
   where id = c_wwe_legacy and external_id = 'WWE';

  -- Straggler denormalised codes that the 2026-07-23 cutover missed.
  -- licensor_name = 'WWE' is the discriminator that proves these are genuinely WWE.
  -- NOTE: assets/style_groups rows with licensor_code = 'DS' are deliberately NOT touched.
  -- Their DS is a substring of the item SKU (e.g. MCZ6XDSPT01) and licensor_name is NULL.
  update public.assets set licensor_code = 'WW'
   where licensor_code = 'WWE' and licensor_name = 'WWE';

  -- ---------- postconditions ----------
  select external_id into v_code from public.licensors where id = c_disney_legacy;
  if v_code <> 'DY' then
    raise exception 'abort: Disney legacy external_id is % after update, expected DY', v_code;
  end if;
  select external_id into v_code from public.licensors where id = c_wwe_legacy;
  if v_code <> 'WW' then
    raise exception 'abort: WWE legacy external_id is % after update, expected WW', v_code;
  end if;

  select count(*) into v_bad
  from public.licensors l
  where (
    select count(*) from core.licensor c
    where lower(c.code) = lower(
            case l.external_id when 'DS' then 'DY' when 'WWE' then 'WW' else l.external_id end)
       or lower(trim(c.name)) = lower(trim(l.name))
  ) <> 1;
  if v_bad <> 0 then
    raise exception 'abort: % legacy licensor(s) no longer resolve to exactly one core.licensor', v_bad;
  end if;

  select count(*) into v_after from public.dam_character_catalog;
  if v_after <> v_before then
    raise exception 'abort: dam_character_catalog row count changed from % to %', v_before, v_after;
  end if;

  select count(*) into v_n from public.assets where licensor_code = 'WWE';
  if v_n <> 0 then
    raise exception 'abort: % assets still carry licensor_code WWE', v_n;
  end if;

  select count(*) into v_n from public.assets where licensor_code = 'DS' and licensor_name is not null;
  if v_n <> 0 then
    raise exception 'abort: % DS assets unexpectedly carry a licensor_name; re-check the SKU-artifact finding', v_n;
  end if;
end $$;

comment on column public.licensors.external_id is
  'Canonical licensor code, aligned to core.licensor.code since 2026-08-07 (owner ruling: change DS to DY at its source). Legacy values DS/WWE were normalised to DY/WW. public.dam_character_catalog still carries a defensive DS/WWE remap; it is now a no-op.';
```

Notes on the shape, deliberately:

- **No privilege guard.** The forbidden pattern `if not ( … or auth.role() = 'service_role' ) then raise`
  never fires inside a migration because `auth.role()` is NULL there. It is omitted rather than written
  wrong. The gate is the PR review and the approved-workflow apply, not a runtime check.
- **No approval-timestamp row is written**, so the America/New_York midnight-UTC `::date` hazard does not
  arise. If the owner wants an approval record added, pin it to **midday UTC** (`… 12:00:00+00`).
- Statements are `update … where <old value>`, so a second run matches zero rows and every postcondition
  still passes. Fully idempotent.
- Everything is one `do $$` block in one transaction. Any `raise exception` rolls the whole thing back.

### 5.4 Ordering

1. Merge the migration to `main` in `u2giants/shared-db` (branch + PR).
2. Apply to **preview** `rjyboqwcdzcocqgmsyel` via the GitHub apply workflow. Do not use the Supabase MCP —
   it is read-only and points at production.
3. Verify on preview: the two `public.licensors` rows read `DY` / `WW`; `dam_character_catalog` count
   unchanged; `select count(*) from public.assets where licensor_code = 'DS'` still returns the artifact
   count (unchanged, not zero).
4. Owner gate.
5. Apply to **production** `qsllyeztdwjgirsysgai` via the same workflow.
6. Re-run the same three checks on production.

### 5.5 Rollback

Two `update` statements, no schema change, nothing dropped:

```sql
update public.licensors set external_id = 'DS'  where id = '10a445bc-cdb8-4384-ad6f-a46fd029f2bc';
update public.licensors set external_id = 'WWE' where id = '1e3ebfce-7d9d-4424-a68c-73c4e57b6d83';
update public.assets   set licensor_code = 'WWE' where licensor_code = 'WW' and licensor_name = 'WWE'
  and id in (<the 15 ids captured before the change>);
```

The first two are exact and safe. The third needs the 15 asset ids captured **before** the change, because
after it they are indistinguishable from the 379 rows that were already `WW`. **Capture and record those 15
ids in the PR body before applying.** Cost to undo: minutes.

---

## 6. Is this safe, or should it wait?

**Verdict: the database side is safe and well-proven. It should still wait on one thing.**

What is proven:

- Only one live database object reads the value, and it degrades to a no-op — demonstrated, not assumed.
- No foreign key depends on the code; both FKs are on `id`.
- The target codes are free, so the unique index cannot be violated.
- Eight of nine sibling application repositories on this machine contain **zero** licensor-code hard-codes.
- The change is two `update` statements and reverses in minutes.

What is not closed:

- **`popdam3` has not been read.** It is not on this machine. It owns the PopDAM admin screen that is the
  *only* live writer of `public.licensors.external_id`, and a hard-coded `'DS'` in that front end would be
  invisible to every query run here. The most likely failure mode is a PopDAM screen that filters or labels
  by the literal code and shows an empty or mislabelled Disney list after the change.
- `poppim-web`, `monitor` and `hiclaw` are also unread. They are lower risk — none of them is known to touch
  the DAM legacy catalog — but they are not confirmed.

**Recommendation: clone `popdam3` and grep it for `'DS'`, `'WWE'`, and
`10a445bc-cdb8-4384-ad6f-a46fd029f2bc` before applying.** That is a ten-minute job and it converts the last
real unknown into a fact. If it is clean, apply. If it is not, the fix is a one-line app change that ships
alongside.

---

## 7. Options for Albert — plain English

Background in one line: the Disney licensor is stored twice in the shared database under two different
short codes, `DS` in the old PopDAM list and `DY` in the new master list, and a piece of database code
currently translates one into the other every time it runs.

### Option A — Fix the code on the row, and the WWE one too *(recommended)*

- **What changes:** two rows in the old licensor list. Disney's code becomes `DY`. WWE's code becomes `WW`.
  Fifteen artwork files that still say `WWE` get corrected to `WW`. Nothing is deleted or moved.
- **What could break:** the PopDAM screen that shows the licensor list, *if* someone wrote the letters `DS`
  directly into that app's code. We have not been able to check that app because it is not on this computer.
- **Cost to undo:** minutes. Two statements put it back exactly as it was.
- **Why recommended:** it does exactly what you asked, it removes the translation trick permanently, and we
  proved the existing database code keeps working afterwards rather than assuming it.

### Option B — Fix Disney only, leave WWE for later

- **What changes:** one row. Disney's code becomes `DY`.
- **What could break:** the same PopDAM risk.
- **Cost to undo:** minutes.
- **Downside:** the same translation trick stays alive for WWE, so the problem is half-solved and someone
  has to come back to it. No cheaper or safer than doing both.

### Option C — Check the PopDAM app first, then do Option A

- **What changes:** nothing today. We download the PopDAM code, search it for the letters `DS`, then apply
  Option A.
- **What could break:** nothing.
- **Cost to undo:** none.
- **Downside:** adds a short delay.

### Option D — Do nothing

- **What changes:** nothing. The translation trick keeps running.
- **What could break:** nothing today. But every new report or screen built on this data has to remember the
  trick, and one day someone will forget.
- **Cost to undo:** none.

**Recommendation: Option C, then A.** It is Option A with the one genuine unknown removed first, and the
check costs about ten minutes.

### One thing to be aware of either way

We found thirty artwork files whose licensor code reads `DS` but which are **not Disney at all** — the
letters come from the middle of the item number, like `MCZ6X**DS**PT01`, on plain unlicensed decor. A
careless "change every DS to DY" would have quietly labelled thirty generic products as Disney. The plan
above deliberately leaves them alone.

---

## 8. What was NOT done, and what is still unknown

Not done, by instruction:

- No migration file was written. Nothing under `supabase/` was created or modified.
- No database write of any kind. Every statement issued was `select` or a catalog read.
- The Supabase CLI and `psql` were not used. No background task chip was created.
- `C:\repos\shared-db` was not used for any work; all work was in the isolated worktree.
- `HANDOFF.md`, `AGENTS.md` and `COORDINATOR_INTAKE.md` were not touched.

Still unknown:

1. **`popdam3` contents.** The single most important open item (§6). Not on this machine.
2. `poppim-web`, `monitor`, `hiclaw` — also not on this machine, not searched.
3. **Who set `'DS'` originally, and why.** We can prove *when* (2026-03-13) and *through what path* (the
   PopDAM admin write policy), but not by whom. There is no audit table on `public.licensors`.
4. **Whether Supabase Storage object paths or Edge Functions embed `DS`.** Not searched — outside the scope
   of a catalog read.
5. **The 100 assets with `licensor_code = 'DY'` and `licensor_name = '____New Structure'`**, plus 6 with a
   NULL name and 2 `WW` equivalents. These look like a separate folder-parsing defect. Unrelated to this
   change, but someone should look. Noted here rather than as a task chip.
6. **The `WW` namespace collision inside this repo.** `tools/process-style-guide-licensing-review.mjs:123`
   uses `'WW'` to mean *Wonder Woman*, while `core.licensor` uses `WW` for *WWE*. Nothing breaks today
   because they are different systems, but it is a live trip hazard for the next person.
