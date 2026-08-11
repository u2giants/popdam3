# Production promotion — the application tolerance contract

**Issue:** [#612](https://github.com/u2giants/shared-db/issues/612) — "Declare a safe intermediate-state
contract for the five apps before any batch promotion."
**Written:** 2026-08-10, against `main` tip `53e1e47`, by sub-agent `contract-612` of orchestrator
session `511f124e` (marker #684).
**Nothing in this document was produced by a database call.** Both databases were read earlier the
same day by other sessions; this document is written from repository files and application source
code only. Everything below is marked VERIFIED (I opened the file and read the line) or UNVERIFIED
(inherited from an earlier session's database read, and it is labelled so).

**Revision 2026-08-10 (issue [#721](https://github.com/u2giants/shared-db/issues/721), sub-agent of
orchestrator `d152a272`, marker #739).** Three §3.2 claims were re-derived from `origin/main` of
`u2giants/popdam3` (`a56715a9`) **and** from a live read-only catalog read of production
`qsllyeztdwjgirsysgai` — so, unlike the original draft, the corrected claims below **are** backed by
database calls. Corrected: (1) the size-picker fallback is **already live**, and it rests on
`style_groups.size_name`, not on the hardcoded list; (2) `core.product_material` has **no reader**;
(3) `dam_character_catalog` is **`public`**, not `api`. Each correction is marked inline in §3.2 and
§7.2. `scripts/post_batch_app_verification.py` already encoded all three correctly and needed no
assertion change. **If you edit §3.2, re-check that script's `APP_MANIFEST` and `MANIFEST_DRIFT` in
the same commit** — nothing mechanically enforces that today (issue #721 item 4).

---

## 1. What this document decides, and the one-line answer

**Decides:** whether the 61-migration production backlog may be promoted in batches, and if so, at
which exact version boundaries the database may be left sitting half-promoted while three live
applications keep reading it.

**The one-line answer: yes — in nine batches, at the nine boundaries listed in §5, and at no other
boundary.** **Since 2026-08-11 there is also a batch B10 (§5A), in four parts, covering the six
migrations merged after the nine-batch plan was written. Completing B1–B9 does NOT promote them, and
B10 may never run before B9 (§5A.5).**
Sub-batching is safe here because the structural changes to live objects across
the whole backlog are few and enumerated — **one view rebuild and two function-signature drops in
B1–B9, plus the five `api.pmt_*` views that B10b (`20260811030000`) drops and recreates in a single
transaction (§5A.4)** — and because there is not a
single `ALTER … RENAME` anywhere in the backlog — rename is the failure mode that almost all of the
application fragility below is about, and it never occurs.

**But two things are true at the same time, and both must be said in the same breath.** The
boundaries are safe by construction. The *watching* is not: none of the three exposed applications
has any monitoring that would catch a mid-promotion break. Discovery is by a person complaining.
That is §7 and §8, and it is the part of #612 that #612 itself predicted would need an owner
decision.

---

## 2. Which applications are exposed, and which are not

#612 names five applications. **Only three of them read the shared production project
`qsllyeztdwjgirsysgai`.** That halves the problem, and it is provable from code rather than from
documents — which matters, because in this repository documents have been wrong about the database
twice today alone.

### 2.1 DesignFlow PLM — NOT exposed in production. Proven.

`C:\repos\dflow plm\designflow-backend\config\database-connection-contract.js`, the production
branch, lines 78-85 (VERIFIED, read directly):

```js
if (metadata.provider !== 'cloud-sql') throw new Error('Production DB_PROVIDER must be cloud-sql');
if (values.PORT !== '5432')            throw new Error('Production Cloud SQL must use DB_PORT 5432');
if (env.DB_SSL !== 'false')            throw new Error('Production Cloud SQL DB_SSL must be false');
if (metadata.networkPath !== 'private-vpc') throw new Error('Production DB_NETWORK_PATH must be private-vpc');
if (/^postgres\./i.test(values.USER))  throw new Error('Production DB_USER cannot be a Supabase pooler user');
```

A DesignFlow production process cannot connect to Supabase. The provider, the port, the SSL setting,
the network path and the username shape are all forced to Cloud SQL, and the last line rejects the
Supabase pooler username form outright. Line 116-117 re-asserts the same at the deployment-binding
level. Additionally: **no `@supabase/supabase-js` dependency and no `createClient(` call exists in
any of the six `designflow-*` repositories** (VERIFIED by grep across all six, excluding
`node_modules` and the vendored read-only `shared-db/` documentation copy).

**But there is a real and permanent caveat, and it belongs in the promotion plan.** The same
contract file forces the *opposite* for non-production (lines 87-92): provider must be `supabase`,
port `6543`, `DB_SSL=true`, network path `public-pooler`, host must be a pooler host, user must
match `^postgres\.[a-z0-9]+$`. **DesignFlow develop, staging and sandbox therefore run on the shared
Supabase pooler.** Those environments are hit by a promotion the instant it lands, with no redeploy
and no opt-in. This creates a permanent drift window between DesignFlow production (Cloud SQL, on a
release cadence) and every DesignFlow non-production environment (shared Supabase, immediately
current). Nothing in this backlog closes it.

*Partly unverified:* the actual project ref used by DesignFlow non-production is **not in the
repository** — `cloudbuild.yaml` supplies the host through Secret Manager references only. That
those non-production environments point at `qsllyeztdwjgirsysgai` specifically is inherited, not
proven from code. What IS proven from code is that they point at *a* Supabase pooler.

**Consequence for this contract: DesignFlow imposes no constraint on any batch boundary.** It cannot
see production. Its non-production environments will see every batch immediately, which is a testing
opportunity rather than a risk — see §7.

### 2.2 monitor — NOT exposed. Its presence on the #612 list is a documentation artifact.

**There is no `monitor` repository under the `u2giants` GitHub organisation at all** (VERIFIED —
the full repo list contains `synology-monitor`, which is the NAS monitoring MCP server, not an
application reading the shared database). The string `aaxtrlfpnoutziwhshlt` — the separate Supabase
project the earlier mapper attributed to monitor — appears nowhere in `poppim-web`, `popcrm-web` or
`popdam3`.

**Code wins over the #612 issue text.** monitor imposes no constraint on any batch boundary. If a
"monitor" application does exist somewhere outside `u2giants`, that is a gap in this contract and is
recorded honestly in §9.

### 2.3 The three that ARE exposed

| App | Repo | How it reaches production | Evidence |
|---|---|---|---|
| **PopPIM** | `u2giants/poppim-web` | PostgREST, `VITE_SUPABASE_URL` | ref documented in `AGENTS.md`, `docs/configuration.md`; not hardcoded in `src/` |
| **PopDAM** | `u2giants/popdam3` | PostgREST **plus** service-role background agents | ref **hardcoded** at `src/lib/app-mode.ts:43`, `apps/bridge-agent/src/config.ts:49`, `apps/windows-agent/src/config.ts:89` |
| **PopCRM** | `u2giants/popcrm-web` | PostgREST **plus** five systemd service-role workers | `workers/crm-worker-supabase.mjs:43-51` |

> ⚠️ **A methodology warning for whoever executes this.** The local checkouts of these three repos
> on machine `al8960ofc` are **two to three weeks stale** (`poppim-web` and `popcrm-web` at
> 2026-07-23, `popdam3` at 2026-07-27; all three remotes moved on 2026-08-10). A first verification
> pass against those local copies produced four confident WRONG answers — it reported that
> `src/lib/uiError.ts` does not exist and that PopPIM calls exactly one RPC. Both are false against
> `origin/main`. **Every application claim in this document was re-verified against a fresh clone of
> `origin/main`.** Do the same. Do not grep `C:\repos\poppim-web`.

---

## 3. What each exposed app tolerates

Six change shapes, one row each, per app. **"Loudly" means a human sees an error. "Silently" means
the screen looks fine and the data is wrong or missing** — which is the worse outcome, because
nobody files a ticket.

### 3.1 PopPIM (`poppim-web`) — the most dangerous, because it fails most quietly

Almost the entire application is named-argument RPCs against the `api` schema. VERIFIED against
`origin/main`: **19 distinct `api.pm_*` RPCs** (`pm_account_page`, `pm_department_handoffs`,
`pm_department_report`, `pm_design_collection_page`, `pm_design_page`, `pm_my_reminder_page`,
`pm_my_revision_page`, `pm_my_work_page`, `pm_notes_page`, `pm_order_page`,
`pm_patch_product_metadata`, `pm_people_workload_page`, `pm_pipeline_count`,
`pm_pipeline_list_facets`, `pm_pipeline_page`, `pm_project_page`, `pm_schedule_page`,
`pm_set_product_stage`, `pm_upsert_view_pref`) plus `api.current_user_profile`, plus the view
`api.pm_customer_list`.

| Change shape | Verdict | Loud or silent |
|---|---|---|
| A new column PopPIM does not know about | **TOLERATES** — it never uses `select("*")` against `api` RPC results; RPCs return JSON it maps by key | — |
| A view whose shape changed (columns added) | **TOLERATES** | — |
| A view whose shape changed (a column PopPIM reads is removed) | **BREAKS — loudly, then blank** | see below |
| A function replaced under it, same argument names | **TOLERATES** | — |
| A function replaced under it, an argument **renamed** | **BREAKS — loudly, then blank.** PostgREST resolves overloads *by argument name*; a rename makes the function unfindable | white screen |
| A table that exists but is not yet populated | **TOLERATES** — empty result sets map to empty lists | — |
| A lookup value going inactive | **TOLERATES** — no `.eq('status','active')` filters found | — |
| **An object renamed** | **BREAKS — loudly, then blank** | white screen |

**Why "then blank".** `src/lib/supabaseQuery.ts` `unwrap()` (VERIFIED, `origin/main`):

```ts
export function unwrap<T>(result: { data: T | null; error: { message?: string } | null }): T {
  if (result.error) throw new Error(result.error.message ?? 'Supabase request failed')
  return result.data as T
}
```

It throws on error, and casts `null` data to `T` with no guard — so a query that returns no error
and no rows produces a downstream `TypeError`. **There is no `ErrorBoundary` anywhere in
`poppim-web`** (VERIFIED: zero matches in `src/` and `package.json`). A thrown render error unmounts
the React tree. The user sees a white page with no message.

**The silent path is institutionalised.** `src/lib/uiError.ts` (VERIFIED, `origin/main`):

```ts
export function reportOptionalDataError(operation: string, label: string, error: unknown): void {
  console.warn({ operation, message: errorMessage(error, `Unable to load ${label}`) })
  toast.warning(`${label} could not be loaded. The rest of the page is still available.`)
}
```

That message actively reassures the user that the page is fine. It is imported by **12 files**
(VERIFIED). During a promotion this is the most likely way a break reaches a user and stops there.

**Two specific fragilities that no database check would catch:**

- **The unenforced cross-schema reference.** `src/features/operating/api.ts` addresses rows in
  `app.activity` and `app.notification` by the string triple
  `('pim', 'product', <product uuid>)` — six occurrences, VERIFIED, e.g.
  `.eq('target_schema','pim').eq('target_table','product').eq('target_id', productId)`.
  There is no foreign key. **Renaming `pim.product` would pass every database constraint, every
  trigger and the whole preflight, and silently empty the dependencies, decisions and reminders
  panes.** No backlog migration renames it. This is a permanent hazard, not a batch hazard.
- **The single highest fan-out object is `api.current_user_profile`.** Called from
  `poppim-web/src/auth/auth.tsx:35`, `poppim-web/src/features/operating/api.ts:9`, and
  `popcrm-web/src/auth/auth.tsx:106`. In PopPIM, `currentProfileId()` hard-throws
  `'No Supabase profile is available for this session.'` if it returns no `id` — which kills every
  write in the operating panes. **Correction to an earlier finding: the PopCRM systemd worker does
  NOT call it** (VERIFIED: zero occurrences in `workers/crm-worker-supabase.mjs`; it uses
  service-role and has no profile identity). Fan-out is two applications, three call sites.
- **One embedded relationship.** `src/features/board/collab.ts:358` does
  `.select('contact:contact_id(id,full_name,email)')` against `core.contact_company`. PostgREST
  resolves that embed through the foreign key. **If that FK is dropped or renamed the request 400s.**
  No backlog migration touches it.

### 3.2 PopDAM (`popdam3`) — the largest surface, with two invisible failure paths

VERIFIED against `origin/main`: **23 distinct RPC names** (all unqualified, i.e. `public`);
**14 `.schema("core")` call sites**; **3 `.schema("api")` call sites**, reaching
`api.dam_customer_list` and `api.dam_factory_list`; **9
`postgres_changes` realtime subscriptions**; **4 `select("*")` calls**; **4 `.eq("status","active")`
filters** in `src/pages/StylesPage.tsx` (lines 636, 674, 744, 762).

*(An earlier mapper reported ~48 RPCs, 31 `.schema("core")` and 8+ realtime subscriptions. My counts
are lower and are of **distinct names** at `origin/main`. The discrepancy does not change any
verdict — it changes the size of the surface, not its shape. Treat the numbers here as the verified
ones.)*

| Change shape | Verdict | Loud or silent |
|---|---|---|
| A new column PopDAM does not know about | **TOLERATES** | — |
| A view/table gaining columns, read via `select("*")` | **TOLERATES** — 4 sites, extra keys ignored | — |
| A column PopDAM names being removed | **BREAKS — loudly** (PostgREST 400) | error surfaces |
| A function replaced, same signature | **TOLERATES** | — |
| A function replaced, signature changed | **BREAKS — loudly** | error surfaces |
| A table that exists but is not yet populated | **TOLERATES** | — |
| **A lookup value going inactive** | **BREAKS — silently.** Four `.eq("status","active")` filters mean the value *and* the column are contractual; flip a `core` lookup row to inactive and it vanishes from a picker with no error | silent |
| **An object renamed** | **BREAKS — silently for realtime, loudly for queries.** The 9 `postgres_changes` subscriptions bind to table names as strings; a renamed table makes the subscription simply never fire. The grid stops updating and looks idle | silent |

**The invisible path — this is the part to actually worry about, and it is ALREADY OPEN.**
`src/pages/StylesPage.tsx`, `fetchSizeOptions` (VERIFIED 2026-08-10 against `origin/main`
`a56715a9`, lines 757–776):

```
757: async function fetchSizeOptions() {
760:    .from("product_size")          // .schema("core"), .eq("status","active")
765:  if (!coreSize.error) return compactPickerOptions(coreSize.data);
769:    .from("style_groups").select("size_name")   // tier 2
772:  if (styleGroupSizes.error) return compactStringOptions(COMMON_SIZE_OPTIONS, 500);  // tier 3
```

`fetchSizeOptions` reads `core.product_size`; on **any** error it falls through to
`public.style_groups.size_name`, and only if *that* also errors to the hardcoded `COMMON_SIZE_OPTIONS`.
No tier alerts. **Batch 8 of this promotion creates and seeds `core.product_size` and
`core.product_depth`.** If anything in that batch is wrong, PopDAM will show a plausible-looking size
picker and report nothing. Nobody will notice for weeks. This is the single most important thing to
check by hand after B8, and §7 says how.

**This fallback is live on production RIGHT NOW, and has been all along.** VERIFIED by catalog read
of `qsllyeztdwjgirsysgai`, 2026-08-10: `core.product_size` **does not exist**. So tier 1 errors on
every load and the picker is served by **tier 2**, `public.style_groups.size_name` — **316 distinct
values across 8,327 rows** (verified by count). It is *not* on the hardcoded list. That distinction
is load-bearing: 316 free-text values do **not** "look like a short generic list", so the naive
eyeball test cannot detect this state. See the corrected B8 manual check in §7.2.

**Correction (issue #721): `core.product_material` has NO reader.** An earlier revision of this
section claimed `fetchProductMaterialOptions` reads `core.product_material` and falls back to
`COMMON_PRODUCT_MATERIAL_OPTIONS`. That function **no longer exists on `origin/main`**. VERIFIED: the
only surviving `product_material` references in `src/` are an array **column** on the assets facet
(`src/hooks/useAssets.ts:179,357`) and generated types — no `core.product_material` read anywhere.
Note the two situations this used to merge: `core.product_material` is an **existing** table on
production today with **no reader**, whereas `core.product_depth` is a **future** table (B8) with
**no reader**. Neither is an application dependency; neither belongs in the PopDAM manifest.

**Correction (issue #721): `dam_character_catalog` is `public`, not `api`.** VERIFIED two ways.
Code: every read is unqualified (`client.from("dam_character_catalog")` in
`apps/worker/src/handlers/ai-tagging-shared.ts` and `ai-tag-bakeoff.ts`), i.e. `public`, and
`src/components/settings/ApisTab.tsx:283` passes the schema explicitly as the literal `"public"`.
Catalog: `public.dam_character_catalog` exists as a **view**, and **no `api.dam_character_catalog`
exists at all** — the `api` schema holds only `dam_asset_library`, `dam_customer_list` and
`dam_factory_list`. The old `api.` reference named an object that has never existed.

Several `.single()` calls will throw on zero rows rather than return null — relevant when a table
exists but has not been populated yet.

**`api.dam_order_list` has no application reader today.** VERIFIED: the string `dam_order_list`
appears in `popdam3` **only inside the vendored read-only `shared-db/` documentation copy**, never in
`src/` or `apps/`. The `security_invoker` fix in `20260810110000` therefore protects a view no
deployed client reads yet. That lowers its urgency; it does not lower its correctness (see §5, B9).

### 3.3 PopCRM (`popcrm-web`) — genuinely exposed, and the best behaved of the three

VERIFIED against `origin/main`: **25 `.schema('api')` call sites**, **25 distinct `crm_*` names**
(views plus RPCs), **9 distinct RPC names** on the `api` schema plus `current_user_profile`.

| Change shape | Verdict | Loud or silent |
|---|---|---|
| A new column | **TOLERATES** — the generic helpers do `select('*')` and map defensively | — |
| A view gaining columns | **TOLERATES** | — |
| A view losing a column the UI renders | **BREAKS — loudly.** Explicit UI error states exist | error surfaces |
| A function replaced, same signature | **TOLERATES** | — |
| A table that exists but is not populated | **TOLERATES** | — |
| A lookup value going inactive | **TOLERATES in the UI**, but enum vocabularies are duplicated in three places, so the value quietly stops being offered | mixed |
| **A view renamed** | **BREAKS — loudly at runtime, with zero compile-time signal** | error surfaces |

The rename hazard is structural. `src/features/crm/api.ts` (VERIFIED, lines 97, 111, 124):

```ts
let q = anyDb.schema("api").from(view).select('*').range(from, from + PAGE - 1)
```

`view` is an untyped `string` parameter into three generic helpers, and the client is cast to
`anyDb`. TypeScript cannot see a wrong name. This is a rename hazard only, and **no backlog
migration renames anything** (§5).

**The worker is the real exposure, and it bypasses the safety net.**
`workers/crm-worker-supabase.mjs` drives five systemd unit pairs — `popcrm-outlook-ingest`,
`popcrm-summarize`, `popcrm-reroute`, `popcrm-contact-sync`, `popcrm-apply-ignore-rules`. VERIFIED:

```js
43: const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
50: const crm  = (t) => sb.schema('crm').from(t)
51: const core = (t) => sb.schema('core').from(t)
```

**It writes `crm.*` and `core.*` directly and never touches the `api` schema.** A migration that
carefully preserves the `api` façade can still break it. Worse, its failures are invisible: they
appear only in the systemd journal, and its health endpoint (line 871) is

```js
if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, jsonHeaders); res.end(JSON.stringify({ ok: true })); return }
```

— a constant. **It does not touch the database and would stay green through a total schema break.**
It is the only health check any of the three applications has, and it is worth nothing for this
purpose. Do not let anyone use it as evidence that a batch landed cleanly.

### 3.4 The summary that matters

**Renames are the dominant failure mode across all three apps, and there are none in this backlog.**
That single fact is what makes a nine-batch promotion defensible. VERIFIED: across every migration
in `supabase/migrations/`, the only `ALTER … RENAME` is
`20260625153000_core_company_rename_customer.sql`, which is far below the backlog window and has
long been on production.

---

## 4. The PostgREST schema-cache window — the risk every boundary shares

All three exposed applications are PostgREST clients against the **same** Supabase project. PostgREST
serves from a cached snapshot of the database schema, and that cache reload is **not synchronised
with migration boundaries**. So every DDL step opens a window in which the database is correct and
the API layer is not.

**The asymmetry is the whole point, and it is good news:**

| Direction | Behaviour during the window |
|---|---|
| **Additive** — a new column, view, function or table | **Invisible** until the cache reloads. Requests for it 404 or "column does not exist". The apps do not request it yet, because no app deploy has shipped that reads it. **Harmless.** |
| **Subtractive** — a dropped or replaced object | **Effective immediately.** The object is gone from the database, and the cached schema pointing at it produces an error on the very next request. |

**What this means for boundaries.** Every batch in §5 is overwhelmingly additive, so the cache
window is a non-event at eight of the nine boundaries. It matters at exactly three points, all
inside batches rather than at boundaries, and all covered by the atomicity rules in §5:

1. **B1**, `20260726030000` drops and re-creates `sync_coldlion_licensors_properties` with a new
   signature. No exposed app calls it (it is a service-role import path), so the window is not
   user-visible.
2. **B6**, `20260804120100` drops the 8-argument `trip_taxonomy_circuit_breaker` in both `public`
   and `plm`. Same: no exposed app calls it.
3. **B7**, `20260807190000` does `drop view if exists api.opa_property_reconciliation;` followed by
   `create view api.opa_property_reconciliation` — a genuine column-set change, which
   `create or replace view` cannot do. **There is a window with no view at all.** No exposed app
   reads it (it is a Disney reconciliation view read by nothing yet), which is why B7 can be atomic
   rather than blocked.

**Operational rule:** do not treat a "does not exist" error immediately after a batch as proof the
batch failed. Wait for the schema cache and re-check. Conversely, a *dropped-object* error is real
immediately and never resolves itself.

---

## 5. The nine batches

**Scope arithmetic, and how it closes.** At `main` tip `53e1e47` there are **65 pending migration
files**. Of these:

- **1 is RETIRED and must NEVER be applied** — `20260729120000`. Applying it would *regress* a
  security control that is live on production today: it rewrites
  `public.lock_down_new_public_function_execute` back to a narrower body that stops locking down
  newly created public PROCEDURES, and it sorts *below* the already-applied `20260729180000`, which
  will therefore never re-run to repair the damage. VERIFIED in
  `scripts/production_migration_guard.py` `HARD_BLOCKED` and in
  `docs/verification/production-apply-set-and-rehearsal-20260809.md`.
- **2 are HELD under the §6.5 owner ruling** — `20260802170000` and `20260802171000`. Neither may
  reach production by any route until the `FR` "FRIENDS TV" removal work ships with them as one
  bounded apply. No removal migration exists, so the one legal event cannot currently be assembled.
  VERIFIED in the guard's `FR_HELD_20260803` / `FR_REMOVAL_VERSIONS` (empty on purpose).
- **1 is the canary** — `20260810140000`, which goes through the lane **first and alone** so that a
  lane failure can never be confused with a migration failure. It is the only thing #611 currently
  permits.

**65 − 1 retired − 2 held − 1 canary = 61 promotable, in nine batches.** That reconciles exactly
with the independently derived 47-entry apply set in
`docs/verification/production-apply-set-and-rehearsal-20260809.md` plus the fourteen
`2026081x` migrations merged since.

> *Partly unverified:* which files are pending is a property of the production
> `supabase_migrations.schema_migrations` ledger, which I was forbidden to read. The 65 figure is
> derived from the 2026-08-09 rehearsal document's ledger diff plus the files merged since. Anyone
> executing this **must re-derive the pending set with `supabase migration list` in the dry-run
> job** before pasting an allowlist. Do not trust this count blind.

### The batches

| # | Versions | Count | Why the boundary at the end is safe |
|---|---|---|---|
| **B0** | `20260810140000` | 1 | **The canary.** One table, one row, read by nothing. It exists to prove the lane, not to deliver a feature. Boundary is safe because nothing depends on it in either direction. |
| **B1** | `20260724060000` … `20260728134500` | 11 | **ATOMIC — no legal internal boundary.** Contains the `BUNDLE_20260804` four (`20260726030000`, `031000`, `032000`, `180000`), which `parse_allowlist` enforces as all-or-none (§6.8), *and* the `sync_coldlion_licensors_properties` 2-arg → 3-arg signature change at `20260726030000`, whose 2-arg predecessor is created by `20260724060000`/`061000`. Rest only at the end: the ColdLion circuit breaker is fully armed and gap-closed by `20260728134500`. |
| **B2** | `20260728171500`, `20260728174500`, `20260728181500` | 3 | Safe at the end because the ClickUp incremental importer created by `174500` is corrected by `181500`; resting between them ships a known-defective importer. |
| **B3** | `20260729230000` … `20260731200000` | 10 | **ATOMIC.** Eight successive bodies of `plm.promote_coldlion_source_owned` (`230000`, `234500`, `235500`, `20260730000500`, `20260731163000`, `180000`, `190000`, `200000`) — only the eighth is safe to rest on. Earlier bodies leave a known ambiguous-column runtime error, broken absence detection, no serialization lock, or **incomplete provenance, which is unrecoverable after the fact**. The two PopSG files (`20260731150000`, `153000`) sort *inside* this span and therefore travel with it — see the correction note below. |
| **B4** | `20260731210000`, `20260731220000` | 2 | `core.licensor` alias table then the owner-approved remaining five aliases. Additive; nothing reads aliases yet. |
| **B5** | `20260802140000` … `20260802160000` | 4 | Taxonomy alert acknowledgement RPC and its three corrections. Rest at the end because `160000` fixes the effective-role check. The two §6.5-held files sort just above `160000` and are absent from the pruned checkout. |
| **B6** | `20260803150000` … `20260804120100` | 5 | Item identity/UPC contract, temp status watch, taxonomy baseline pins. `20260804120100` drops the 8-arg `trip_taxonomy_circuit_breaker` and re-creates it — resting before it leaves the pin table without its environment/provenance columns. |
| **B7** | `20260807030000` … `20260807200000` | 6 | **ATOMIC.** Contains the `api.opa_property_reconciliation` **drop-and-recreate** at `20260807190000` (a genuine column-set change; `create or replace view` was insufficient, so there is a window with **no view at all**) and the three-version `plm.sync_opa_property_character` chain (`170100` → `180000` → `190000`). `190000` is also a security fix, not an optional polish. Rest only after `200000`. |
| **B8** | `20260809170000` … `20260809170500` | 6 | `core.product_size` / `core.product_depth` foundation, both seeds, the guarded importer, the `api` pickers, and the DB Data Admin mutations. Rest at the end because a half-seeded `core.product_size` is exactly what PopDAM swallows silently — into the `style_groups.size_name` fallback, which looks plausible (§3.2). |
| **B9** | `20260810010000` … `20260810170000` (excl. `140000`) | 14 | **ATOMIC — the licensor landing batch.** Carries all three security co-presence pairs (below), the `api.dam_order_list` `security_invoker` fix, and both DAM function chains. There is **no** safe internal boundary anywhere in it. |

> **⚠️ Correction to the earlier batch sketch, and it is load-bearing.** An earlier draft placed
> `20260731150000` and `20260731153000` (PopSG) in a batch *after* `20260731200000`. **The two PopSG
> files belong inside B3**, making B3 ten files and B4 two. With this correction the batch counts sum
> to exactly 61.
>
> **Why — stated correctly, because the original reason given here was wrong (2026-08-11, §5A.5).**
> This note used to say such a split was "not executable" because `supabase db push` applies in
> version order and a batch is therefore "a contiguous version-ordered slice that cannot leapfrog".
> **That reasoning is FALSE for the production lane and has been removed.**
> `scripts/production_migration_guard.py` `prepare()` computes `keep = remote | set(allowlist)` and
> **deletes every migration file outside it**, so `supabase db push` never sees the skipped versions
> and an allowlist need not be contiguous. That is precisely why production's ledger is applied out
> of order. **The conclusion stands on different grounds:** B3 is **contract policy**, mechanically
> enforced by the guard's `ATOMIC_BATCHES` entry for B3 — which is what actually refuses a partial
> B3 allowlist — and the PopSG files sit inside its span. **Nowhere in this document may version
> order be treated as a mechanism that prevents a bad ordering.** Full consequences: §5A.5.

### B9's three security co-presence pairs — the reason it cannot be split

These are enforced in `scripts/production_migration_guard.py` `parse_allowlist`, one-directionally
and deliberately so (a symmetric rule would refuse the only legal recovery allowlist if a run died
between a create and its fix). **Do not "tidy" them into symmetry.**

- **Paramount** — `20260810020000` requires `20260810090000`. Between them, 23 `plm.pmt_*` tables
  exist with `service_role` holding TRUNCATE. **TRUNCATE does not fire row-level triggers**, so a
  single statement silently bypasses all five immutability guards the migration installs.
- **NBCU** — `20260810070000` requires `20260810080000`. Between them, 16 tables (VERIFIED count) are
  directly rewritable and the capture ledger is directly insertable, bypassing
  `begin_nbcu_capture` / `finalize_nbcu_capture` entirely.
- **Warner** — `20260810030000` requires both `20260810110000` and `20260810120000`. Eight tables of
  confidential licensor data.

> **⚠️ Correction, verified.** An earlier summary described the Warner window as "RLS enabled but
> **no policies at all** — the read gate is undefined". **That is wrong, and the truth is worse in a
> different way.** `20260810030000` creates eight `create policy … for select to authenticated
> using (true)` policies (VERIFIED, lines 137-138, 178-179, 223-224, 277-278, 319-320 and three
> more) and grants `select` to `authenticated`. So between `030000` and `110000` the read gate is
> not undefined — it is **definitively wide open**: every authenticated account in the shared
> project can read Warner's confidential STARLABS data. `20260810110000` replaces `using (true)`
> with the administrator / plm-app-access / `sales`+`licensing` role gate. Resting between `110000`
> and `120000` still leaves `service_role` able to INSERT arbitrary rows.

**Root cause of all three, and it is already live:** `20260710135975` set a schema-wide
`alter default privileges … to service_role`, which fires at `CREATE TABLE` and makes the
in-migration grants a no-op. It is applied and in force throughout the promotion.

### The trap that only this batch plan prevents

`20260810110000` is described in issues and handoffs as "the Warner grants migration". Its SQL at
line **183** also does:

```sql
alter view api.dam_order_list set (security_invoker = true);
```

VERIFIED, with a 9-line comment explaining that `20260810010000` created the view **without** it, so
it ran as its owner (`postgres`, `BYPASSRLS`) and bypassed RLS on `core.customer`, `core.factory`,
`plm.item` and the production_order tables for every authenticated reader. That is the #653 fix,
shipped today.

The filename does say `..._and_dam_order_list_invoker.sql`, so the trap is not perfectly hidden —
but **anyone batching from the prose descriptions would separate the fix from `20260810010000` and
silently reopen the bug.** The guard's co-presence rules deliberately do not encode this dependency.
**This batch plan is the only thing preventing that resting state.** B9 being atomic is what closes
it.

---

## 5A. B10 — the four parts that postdate the nine-batch plan

**Written 2026-08-11 by sub-agent `b10-contract` of orchestrator session `fcc2a1` (marker #793),
against `origin/main` `685ebf6952edb0ddd259aa09c8fabaf61df7bfb2`.** Unlike §5, **this section IS
backed by live database calls**: every membership claim below was derived by **per-version set
membership** against production `qsllyeztdwjgirsysgai`'s `supabase_migrations.schema_migrations`,
read read-only on 2026-08-11 at ledger count **381**.

> **⚠️ Read this before using any version list in this section, or anywhere else.**
> Production's ledger is applied **OUT OF ORDER**. At the time of writing, `20260731230000`,
> `20260802194000`, `20260802194100`, `20260810140000` and `20260810180000` are applied while
> `20260729230000` — which sorts far below all of them — is not.
> **Never reason from the maximum applied version.** Re-derive with set membership.

> **⚠️ This section was written while the promotion sequence was RUNNING.** The owner approved
> running the batches one at a time, and **B3 was being applied to production as this was written**.
> **B1, B2 and B5 are fully applied** (B5 landed 2026-08-11, ledger 377 → 381), which means §5's own
> arithmetic — written before any of that — is stale about them. The membership of B10 does **not**
> change when an earlier batch lands (B10's six sort above every other batch), but **the counts in
> §5A.2 do**. Re-derive the counts at the moment you act. The six-version B10 list is the durable
> part; the totals around it are a snapshot.

### 5A.1 Why B10 exists

§5 plans nine batches whose highest member is `20260810170000`. Everything merged to `main` after
that belongs to **no batch**, so **completing B1–B9 would never promote it**. That is the gap
[#773](https://github.com/u2giants/shared-db/issues/773) ruled must be closed with a batch B10.
This section is that ruling made executable. **The contract is the authority for batch membership;
an issue body never is** (#788 item 3).

### 5A.2 The derived membership — computed, not inherited

Method: `git ls-tree origin/main --name-only supabase/migrations/` (433 files, no duplicate
versions) minus the production ledger, by set membership.

| Figure | Value | How derived |
|---|---|---|
| Migration files on `origin/main` @ `685ebf6` | **433** | `git ls-tree`, no duplicate 14-digit prefixes |
| Applied on production | **381** | `select count(*) from supabase_migrations.schema_migrations` |
| **Unapplied** | **52** | set difference; reconciles exactly with 433 − 381, and **every** ledger row corresponds to a file on `main` (zero orphans) |
| Of those: retired, never apply | **1** | `20260729120000` (§5) |
| Of those: §6.5 HELD | **2** | `20260802170000`, `20260802171000` |
| Of those: inside B3, B4, B6, B7, B8, B9 | **43** | 10 + 2 + 5 + 6 + 6 + 14. **B1, B2 and B5 contribute 0 — they are fully applied.** |
| **Of those: belonging to NO batch — B10** | **6** | 52 − 1 − 2 − 43 |

**The six B10 members, in version order, by full 14-digit version:**

```
20260810190000   dcp_vault_source_landing
20260810190100   dcp_vault_chunked_loader
20260811030000   pmt_lossless_source_ids_and_asset_metadata_value
20260811050000   dcp_vault_metadata_landing
20260811060000   dcp_vault_metadata_chunked_loader
20260811070000   nbcu_asset_ip_family_relationship
```

**`20260810180000` is NOT a pending B10 member — it is APPLIED.** #773 listed it as B10's first
file. It was applied to production on 2026-08-11 (ledger 376 → 377), and is still applied at ledger
381. Naming it in any future
allowlist is now an **error**: `validate_candidates` refuses any allowlist containing an
already-applied version. See §5A.3 for why the ruling that put it first still matters.

> **Correction to a figure in circulation.** Dispatch notes describe "ten licensor landing
> migrations with zero applied" as B10's scope. **That count is wrong for B10.** The ten NBCU /
> Paramount / Warner landing migrations are already batched — they are **B9** — and B9 is indeed
> entirely unapplied. B10's own membership is **six**. Do not merge the two sets.

### 5A.3 The `20260810180000` ordering ruling — precondition SATISFIED, with evidence

#773 ruled that `20260810180000` must land **first** inside B10, and the reason is load-bearing:
until it lands, the `plm` schema's `alter default privileges` gives `service_role` **TRUNCATE** on
every newly created table at `CREATE TABLE`, before any `GRANT` in the creating migration runs.
**TRUNCATE fires no row-level triggers**, so one statement voids every immutability guard these
migrations install.

**That precondition is now SATISFIED.** VERIFIED by live read of `pg_default_acl` on production
`qsllyeztdwjgirsysgai`, 2026-08-11, and **re-read unchanged at ledger 381**:

| Schema | `defaclacl` for tables | Reading |
|---|---|---|
| **`plm`** | `{service_role=arwd/postgres}` | **TRUNCATE (`D`) is gone.** Narrowed by `20260810180000`. |
| `core` | `{service_role=arwdDxtm/postgres}` | still un-narrowed |
| `ingest` | `{service_role=arwdDxtm/postgres}` | still un-narrowed |
| `api` | `{service_role=arwdDxtm/postgres}` | still un-narrowed |

**Every table any B10 member creates is in the `plm` schema** (VERIFIED by reading all six files),
so the whole of B10 is now born clean. The ruling is not dropped — it is **discharged**.

> **Do not read this as "the hole is closed."** It is closed for `plm` only. `core`, `ingest` and
> `api` still hand `service_role` all eight bits at `CREATE TABLE`. Any future migration creating a
> table in those three schemas re-enters the exact state #773 was written about.

### 5A.4 The four parts, and why B10 is divided into them

**To be precise about what is being claimed: all six COULD safely run as one allowlist, in version
order, after B9.** Nothing here proves a combined B10 unsafe. The four parts exist because six files
spanning two licensors and two independent DCP builds give the operator **four genuinely coherent
resting points** instead of one all-or-nothing run — smaller runs, each individually verifiable,
each stopping somewhere this document has reasoned about. `20260811030000` (Paramount) sorts
*between* the two DCP builds, so the parts fall out at those seams. **The parts are ordered by version, but note that the
production lane could technically run them in another order — see the leapfrog correction in §5A.5
before assuming version order is a guard rail.**

| # | Versions | Count | Atomic? | Why the boundary at the end is safe |
|---|---|---|---|---|
| **B10a** | `20260810190000`, `20260810190100` | 2 | **ATOMIC** | Disney DCP Vault source landing + its chunked loader. `20260810190000` creates nine `plm.dcp_*` tables, the frozen row-hash function and the immutability triggers but **no loader**; `20260810190100` supplies the chunked loader, `plm.dcp_chunk_ledger` and `plm.finalize_dcp_crawl` — the only **checked** path to `status='complete'`. **Precisely, because the loose version of this was wrong:** `20260810190000` grants `service_role` `select, insert` on the nine tables and installs **no header INSERT trigger**, so a caller can write rows directly and even insert a `dcp_crawl` row already marked `'complete'`. What is missing between the pair is the **supported, checked, finalizable** path — not the ability to write. See §6. Rest only after `190100`. |
| **B10b** | `20260811030000` | 1 | single file — **trivially atomic** | Paramount lossless source ids + `plm.pmt_asset_metadata_value`. One file, so there is no internal boundary to rest at. Safe at the end because the five `api.pmt_*` views it drops are recreated inside the same file. |
| **B10c** | `20260811050000`, `20260811060000` | 2 | **ATOMIC** | DCP Vault metadata landing + its chunked loader. Identical shape to B10a: `050000` creates `plm.dcp_metadata_*`, `dcp_property`, `dcp_character`, `dcp_term` and three observation tables with no loader; `060000` supplies `begin_dcp_metadata_run` / `load_dcp_metadata_chunk` / `finalize_dcp_metadata_run` plus `plm.dcp_metadata_chunk_ledger` and `plm.dcp_metadata_load_exception`. Same precision as B10a: `050000` **does** grant `service_role` `select, insert`, so the gap is the supported loader and finalizer, not raw writability. Rest only after `060000`. |
| **B10d** | `20260811070000` | 1 | single file — **trivially atomic** | NBCU asset ↔ IP-family relationship: `create table plm.nbcu_asset_ip_family` (the **17th** NBCU table) plus a `create or replace plm.finalize_nbcu_capture`. One file, so no internal boundary. **Its CONCERNS review is DISCHARGED (§5A.7, #800)** — the one real finding became the hard ordering edge in §5A.5. |

**2 + 1 + 2 + 1 = 6.** Reconciles with §5A.2.

### 5A.5 Ordering dependencies, both directions — VERIFIED, not assumed

**B10 is ordered after B9 for all four parts. For B10b and B10d the dependency is HARD (the run
aborts); for B10a and B10c it is POLICY — see the leapfrog correction below, because the reason is
not what it looks like.**

> ### ⛔ The hardest edge: **`20260810080000` (B9) MUST apply before `20260811070000` (B10d).**
> **`20260811070000` can never precede `20260810080000`. Not "should not" — the run aborts.**
> (Scope note, because the overbroad version of this sentence was wrong: **only B10b and B10d abort**
> if run before B9. B10a and B10c are held behind B9 by policy, not mechanism — see the leapfrog
> correction below.)
>
> **VERIFIED FROM THE SQL, not inferred.** `20260810080000_nbcu_revoke_default_granted_write_privileges.sql`
> ends in a `do $$` assertion block that counts `service_role`'s grants on `plm.nbcu_*` and raises
> on any deviation:
>
> ```sql
> if v_bad <> 16 then
>   raise exception 'nbcu revoke migration: expected 16 SELECT grants, found %', v_bad;
> ...
> if v_bad <> 15 then
>   raise exception 'nbcu revoke migration: expected 15 INSERT grants, found %', v_bad;
> ```
>
> `20260811070000` does `create table plm.nbcu_asset_ip_family` and then
> `grant select, insert on plm.nbcu_asset_ip_family to service_role` — the **seventeenth** NBCU
> table. **If `20260811070000` lands first, `20260810080000` counts 17 against its literal 16, the
> exception fires, and the whole batch aborts and rolls back.** The counts are hard-coded literals;
> nothing adapts them.
>
> This edge is of the same class as **B4-after-B3** and **B9-after-B8**, and is recorded here as a
> first-class ordering constraint for the same reason: it is invisible in the file names and it is
> enforced by nothing in the guard.
>
> **⚠️ Do NOT dismiss it with "the timestamps already handle it". THEY DO NOT.** See the leapfrog
> correction immediately below — the production lane **deletes** every migration outside
> `applied ∪ allowlist` before running `supabase db push`, so an allowlist naming only B10 really
> would run B10 with B9 absent. **The timestamps are not a guard rail here; the operator and this
> document are.** Adjudicated in [#800](https://github.com/u2giants/shared-db/issues/800) item (b);
> do not re-litigate it, and do not delete this edge.

> ### ⚠️ CORRECTION — "a batch cannot leapfrog" is FALSE for the production lane. Read this before
> ### relying on version order anywhere in this document.
>
> An earlier version of §5's own correction note argued that a batch is necessarily a contiguous
> version-ordered slice because `supabase db push` applies in version order and "cannot leapfrog".
> **That is true of a plain checkout and FALSE of the production lane**, and the difference is
> load-bearing. The sentence has been struck from §5; this box explains why. If you find that
> reasoning anywhere else in this repo — a doc, an issue, a PR body, a comment — it is wrong.
>
> **VERIFIED in `scripts/production_migration_guard.py`, `prepare()`:** the lane builds a *bounded
> checkout* and then computes `keep = remote | set(allowlist)` and **deletes every migration file
> not in `keep`**. `supabase db push` therefore never sees the skipped versions at all. It applies
> the allowlist in version order — but the allowlist need not be contiguous, and the gaps are simply
> gone. **This is exactly why production's ledger is applied out of order in the first place.**
>
> Consequences, stated bluntly because a reader who assumes contiguity will get this wrong:
>
> - **B10a (`20260810190000` + `20260810190100`) and B10c (`20260811050000` + `20260811060000`)
>   CAN technically be run before B9.** They create their own objects and consume nothing B9 makes.
>   Nothing mechanical stops it.
> - **B10b (`20260811030000`) and B10d (`20260811070000`) CANNOT** — B10b alters objects only B9
>   creates, and B10d trips B9's 16/15 assertion. Those are hard.
> - **B10b is independent of the DCP parts** and may be ordered before or after them.
>
> **This document nonetheless mandates B9 first, for all four parts** (§5A.9). That is a *policy*
> choice, not a mechanical consequence: promoting licensor landing schema out of the planned order
> multiplies the states an operator has to reason about, and two of the four parts are hard-blocked
> anyway. **Do not "optimise" B10a or B10c ahead of B9 on the grounds that it is technically
> possible.** If a future operator has a real reason to, it needs its own owner approval and its own
> entry here — not a silent reinterpretation of this section.

- `20260811030000` (B10b) **alters** `plm.pmt_*` tables and drops/recreates five `api.pmt_*` views.
  Those objects are created by `20260810020000` — a **B9** member. **B10b aborts without B9.**
- `20260811070000` (B10d) **references** `plm.nbcu_*` and does `create or replace
  plm.finalize_nbcu_capture`. Those come from `20260810070000` — a **B9** member. **B10d aborts
  without B9.** (This is the CONCERNS finding in #788, and it is **correct**: VERIFIED by reading
  the file — no B10 member creates any `plm.nbcu_*` table.)
- B10a and B10c create their own objects and need nothing from B9. **They sort above B9, but that is
  NOT what keeps them behind it** — the lane could run them alone (see the leapfrog correction).
  They wait on B9 by the policy stated there, not by mechanism.

**Nothing in B1–B9 depends on anything in B10.** The dependency is one-directional. VERIFIED by
searching all six files for objects consumed by earlier batches: none.

**Internal to B10:** B10c depends on B10a (`plm.dcp_metadata_asset` references `plm.dcp_asset`).
B10b is independent of both DCP parts.

**The two dependencies #793 asked to verify rather than assume — both CONFIRMED, one with a
correction:**

- **"B4 aborts without B3" — CONFIRMED, and the reason is an object, not just version order.**
  `20260731210000` (B4) references `core.normalize_popsg_property_observation`, which is created by
  `20260731150000` — a **B3** member (the PopSG file that §5's correction note moved into B3).
  VERIFIED by grep across `supabase/migrations/`. B4 also depends on `public.approve_licensor_alias`,
  but that is created by `20260731210000` itself, inside B4.
- **"`20260810050000` grants access to screens B8 creates" — CONFIRMED as a real dependency, and
  NOT automatically satisfied.** `20260810050000` is a B9 member; B8 is
  `20260809170000`…`20260809170500`, which all sort **below** it. An earlier draft of this bullet
  said version order therefore settles it and "no extra rule is needed". **That was wrong, for the
  same reason as the leapfrog correction above:** separate allowlists are separate runs, and the
  bounded checkout deletes everything outside `applied ∪ allowlist`, so **a B9 allowlist can be
  promoted with B8 still unapplied.** Nothing mechanical stops it. **B8-before-B9 is a rule of this
  document that the operator must honour**, exactly like B4-after-B3.

### 5A.6 The #790 interaction — B10's risk is the INVERSE of B5–B9's, and that is more dangerous

[#790](https://github.com/u2giants/shared-db/issues/790): the post-apply catalog verifier derives
its targets with a conservative lexer whose own caveat says objects named through **`alter default
privileges`**, **`execute format(...)`**, quoted/mixed-case identifiers and search_path-relative
names are **"NOT listed and NOT checked"**. On `20260810180000` that produced zero targets and a
correct **red X on a successful apply**.

**No B10 member has that shape.** VERIFIED: none of the six contains an `alter default privileges`
statement (all matches are inside comments). **So do not expect a red X from B10, and if one
appears, treat it as a REAL failure, not the #790 false negative.**

**The real B10 exposure is the opposite and it is quieter.** Every one of these six names plenty of
plain `create table` targets, so the lexer will happily derive targets and the step will go
**green** — while the privilege, revoke and RLS-policy work it cannot read goes unchecked:

**Per member, and — because the question always gets asked — whether
[#794](https://github.com/u2giants/shared-db/pull/794) fixes it.** #794 (OPEN at time of writing)
teaches the verifier to accept a declared no-op for **data-only `do` blocks**. It **deliberately
does NOT read inside `execute format(...)`**. So for every row below where the privilege work is
built by `execute format`, **#794 landing changes nothing** — the blind spot survives.

| Version | Shape | Privilege / policy work the verifier cannot read | Still blind after #794? |
|---|---|---|---|
| `20260810190000` | create-table + dynamic loop | **All three** of `grant select, insert on plm.%I to service_role`, `grant select on plm.%I to authenticated`, and `revoke update, delete, truncate, references, trigger, maintain on plm.%I from service_role` — every one issued via `execute format`, looped over the nine `plm.dcp_*` tables. **The `service_role` write grant itself is invisible too, not just the revoke.** | **YES — still blind.** `execute format`. |
| `20260810190100` | create-table + literal grants | Creates `plm.dcp_chunk_ledger` and the loader functions; grants/revokes are **literal and lexer-readable** | **No — already visible.** Least affected. |
| `20260811030000` | create-table + view rebuild + dynamic loop | `grant select on api.%I to authenticated, service_role` for the **five recreated `api.pmt_*` views**, issued inside a `do $$ … execute format(...)` loop | **YES — still blind**, and this is the sharpest B10 case: five live `api` views are dropped and recreated, and the re-grant that restores app access is the exact statement the verifier cannot see. #794 will not read it. Same blind spot as `20260810120000`. |
| `20260811050000` | create-table + dynamic grants | **All** table grants are dynamic — `execute format('grant select, insert on plm.%I to service_role', t)` and `grant select … to authenticated` — plus `create policy %I on plm.%I` built in a `do $$` block | **YES for the privileges — but this is a NOTE, not a blocker.** Target derivation still works, because the targets come from its **readable `create table` statements**; only the privilege *expectation* is undrivable. The step will go green having checked existence, not access. |
| `20260811060000` | create-table + literal grants | Creates `plm.dcp_metadata_chunk_ledger` and `plm.dcp_metadata_load_exception`; grants and revokes are **static** | **No — already visible.** No issue found. |
| `20260811070000` | create-table + mixed | Static `revoke all … from public/anon/authenticated`, a static `revoke update, delete, truncate, references, trigger, maintain`, and a static `grant select, insert … to service_role` — **all readable**. A trailing `foreach p in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']` **self-check** loop is not | **Partly — and it does not matter.** The dynamic part is an assertion, not the grant. The grants that decide access are literal. |

**For contrast, and because it is a B9 problem that must not get filed under B10:**
`20260810120000_wb_correct_read_claim_and_revoke_service_role_insert.sql` performs a **dynamic
revoke** and is a **real blocker** for the verifier — #794 does not rescue it either. It is a **B9**
member, not a B10 member. Do not move it.

**None of the six has the `alter default privileges` shape that produced #790's red X.** VERIFIED:
every `alter default privileges` match across all six files is **inside a comment**. **So do not
expect a red X from B10 — and if one appears, treat it as a REAL failure, not the #790 false
negative.**

**Consequence for the operator: a green post-apply step on B10a, B10b, B10c or B10d proves the
tables exist. It proves NOTHING about who can write to them, and #794 will not change that for
`20260810190000`, `20260811030000` or `20260811050000`.** **Verify the ACLs by hand** after each
part: read `relacl` for the created tables and the five recreated `api.pmt_*` views, and confirm
`service_role` holds no `D` (TRUNCATE), `x`, `t` or `m` bit. Do not accept the green tick as that
evidence.

### 5A.7 What is BLOCKED, and must not be quietly scheduled

**`20260811070000` (B10d) was HELD. It is now RELEASED — with one finding converted into a permanent
ordering constraint. Do not re-open this.**

On 2026-08-11 the advisory model review ran end-to-end for the first time in this repo's history and
returned **VERDICT: CONCERNS** against this exact file (#788). Every finding was adjudicated against
the actual SQL by a separate agent in [#800](https://github.com/u2giants/shared-db/issues/800), and
independently confirmed by a second model (Codex, read-only, APPROVE). The outcome:

| # | Concern | Adjudication (#800) |
|---|---|---|
| (a) | "depends on `plm.nbcu_*` tables no file in the batch creates" | **Not a defect.** The dependency is real and normal: `20260810070000` (**B9**) creates the sixteen tables and sorts first. Recorded as the B10-after-B9 edge in §5A.5. |
| (b) | "would break two lower-versioned count gates" | **REAL, and it reduces to ONE gate** — `20260810080000`'s 16/15 assertion. **This is the hard ordering edge in §5A.5.** The other gate (`20260810180000`'s 0-or-16 rule) is moot: it is already applied and cannot re-run. |
| (c) | "`create or replace finalize_nbcu_capture` tightens the loader contract" | **Real and intentional.** A loader omitting `expected_counts.asset_ip_family` now raises `expected_count_missing`. Production risk is low — **zero `plm.nbcu_*` tables exist there.** The exposure is on preview, where NBCU is already landed. |
| (d) | "PG17-only `MAINTAIN` syntax" | **NOT REAL.** Both projects run PostgreSQL **17.6**, and `maintain` is the merged repo-wide pattern (`20260810090000`, `20260810180000`, `20260811060000`). Corroborated by `20260810180000` — which uses it — applying cleanly to production. |

**So B10d's only residue is item (b), and it is now a recorded ordering constraint rather than a
hold.** **Do not re-litigate (a) through (d); cite #800.**

**B10a, B10b and B10c carry no unresolved review finding**, but none of them has had the same
end-to-end model review B10d got. They must get one before approval, like every other batch.

### 5A.8 What the guard does and does NOT enforce for B10

**Enforced today** — `scripts/production_migration_guard.py` `CO_PRESENCE_RULES` already carries the
B10a pair (issue #665): `20260810190000` requires `20260810190100`, one-directionally, so an
allowlist naming the create without the loader is refused. The rule's reversed reading is
**deliberately absent** — read its header comment before "fixing" it.

**NOT enforced, and this is the gap [#784](https://github.com/u2giants/shared-db/issues/784) is
about.** `ATOMIC_BATCHES` is the tuple `(B1, B3, B7, B9)` only. **B10a's atomicity is enforced only
by its co-presence rule; B10c's atomicity is enforced by NOTHING AT ALL.** The guard will accept an
allowlist of `20260811050000` alone and nothing but the operator prevents that rest. Registering
B10a and B10c in `ATOMIC_BATCHES` is the correct fix, and it belongs to #784 — **this document does
not perform it, and until it is done, the never-rest states in §6 for B10c are prose only.**

> **✅ RESOLVED — the guard deadlock that once blocked B9, and therefore all of B10, is FIXED. Any
> text you find saying "B9 is impossible" or "B9 is un-allowlistable" is STALE; delete it.**
> The deadlock was real: `CO_PRESENCE_RULES` required `20260810020000` and `20260810070000` to be
> promoted together with `20260810180000`; `parse_allowlist` applied that rule **ledger-blind** while
> `validate_candidates` refuses any allowlist naming an already-applied version — and
> `20260810180000` is applied. Including it was refused as already-applied; omitting it was refused
> by co-presence. **PR [#798](https://github.com/u2giants/shared-db/pull/798)
> ("fix(guard): make the co-presence rule ledger-aware so B9 can ship") merged to `main` on
> 2026-08-11 at `685ebf6`.** `parse_allowlist` now takes the real production ledger and treats an
> already-applied fix as satisfied, while a fix that is **neither applied nor in the allowlist**
> still REFUSES. **B9 is allowlistable, and B10 is no longer blocked behind it.**
>
> The guard's ledger-awareness **fails closed**: callers with no ledger in hand keep the stricter
> ledger-blind behaviour. So a B9 allowlist validated without `--remote-ledger` can still be refused.
> That is correct, not a regression.

### 5A.9 Promotion order

`20260810180000` (**done**) → **B3** (in flight at time of writing) → **B4** → **B6** → **B7** →
**B8** → **B9** → **B10a** → **B10b** → **B10c** → **B10d**.

**No part of B10 may precede B9.** Two hard reasons, both in §5A.5: `20260811030000` and
`20260811070000` reference objects that only B9 creates, and `20260810080000`'s 16/15 assertion
**aborts** if `20260811070000` lands first.

**B10a, B10b and B10c may not be reordered among themselves.** That is a rule of this document, not
a mechanical impossibility — the lane's bounded checkout would permit it (§5A.5 leapfrog
correction). B10b is genuinely independent of the DCP parts; the fixed order exists so that every
run's starting state is one this document has actually reasoned about.

---

## 6. States that must NEVER be rested on

A flat list. If a run stops here, it is not "paused" — it is **exposed**, and the only correct next
move is to complete the batch, not to wait.

**Never rest after any of these versions:**

```
20260724060000   20260724061000   20260726030000   20260726031000   20260726032000
20260726180000   20260727221500   20260727223000   20260727224500   20260727230000
20260728171500   20260728174500
20260729230000   20260729234500   20260729235500   20260730000500   20260731150000
20260731153000   20260731163000   20260731180000   20260731190000
20260731210000
20260802140000   20260802141000   20260802150000
20260803150000   20260803200000   20260803201000   20260804120000
20260807030000   20260807170000   20260807170100   20260807180000   20260807190000
20260809170000   20260809170100   20260809170200   20260809170300   20260809170400
20260810010000   20260810020000   20260810030000   20260810050000   20260810060000
20260810070000   20260810080000   20260810090000   20260810100000   20260810110000
20260810120000   20260810130000   20260810160000
20260810190000   20260811050000
```

**The two B10 never-rest states, spelled out (added 2026-08-11, §5A):**

- **After `20260810190000`, before `20260810190100`** — nine `plm.dcp_*` tables that **have no
  supported loader and cannot be safely finalized**. The only *checked* writer is the chunked loader
  in `20260810190100`, and the only *checked* path to `dcp_crawl.status = 'complete'` is
  `plm.finalize_dcp_crawl`, also in `190100` — the routine that verifies sections, gaps, membership
  and counts.
  **State this accurately, because the overstated version of it was wrong:** `service_role` holds
  `insert`, and there is **no header INSERT trigger**, so a caller *can* directly insert a
  `dcp_crawl` row already carrying `status = 'complete'` if it satisfies the row checks — and thereby
  arm the immutability triggers over data nothing ever validated. **That is worse than "nothing can
  happen", not better.** The gap is the absence of the supported, checked finalization path, not an
  inability to reach the status value. A half-build, not a paused promotion. **Enforced by
  `CO_PRESENCE_RULES`.**
- **After `20260811050000`, before `20260811060000`** — the same shape for
  `plm.dcp_metadata_run` / `dcp_metadata_asset` / `dcp_property` / `dcp_character` / `dcp_term` and
  the three observation tables: created, `service_role`-insertable, ungoverned by any supported
  loader, triggers unarmed. **Enforced by
  NOTHING — see §5A.8 and #784.** The guard will accept `20260811050000` alone. Only the operator
  stands between this list and that state.

**The B10 versions that are single-file parts, and therefore have no internal rest state at all:**
`20260811030000` (B10b) and `20260811070000` (B10d). Both are **trivially atomic** — one file each,
so there is nothing to stop halfway through. **B10d is no longer held** (§5A.7, #800); its one real
finding is the ordering edge in §5A.5.

**The nine (plus the canary) that ARE legal resting points — and the only ones:**

```
20260810140000  (B0, canary, alone)
20260728134500  (B1)
20260728181500  (B2)
20260731200000  (B3)
20260731220000  (B4)
20260802160000  (B5)
20260804120100  (B6)
20260807200000  (B7)
20260809170500  (B8)
20260810170000  (B9 — end of the ORIGINAL nine-batch backlog)
```

**Plus the four B10 resting points (added 2026-08-11, §5A) — and no others above `20260810170000`:**

```
20260810190100  (B10a)
20260811030000  (B10b)
20260811060000  (B10c)
20260811070000  (B10d — end of the whole backlog)
```

`20260810180000` is not listed here because it is **already applied** (§5A.3), not because it is an
illegal boundary.

**And one that must never be applied at all, at any time, in any batch:** `20260729120000`.

**The three worst states in the list, ranked:**

1. **After `20260810020000`, before `20260810090000`** — 23 Paramount tables with `service_role`
   holding TRUNCATE, which silently bypasses every immutability guard.
2. **After `20260810030000`, before `20260810110000`** — eight Warner tables of confidential
   licensor data readable by *every* authenticated account in the shared project.
3. **After `20260810070000`, before `20260810080000`** — 16 NBCU tables directly rewritable, capture
   protocol bypassable.

---

## 7. What to watch after each batch, by hand

**This section exists because there is no alternative.** For all three exposed applications there is
**no monitoring that would catch a mid-promotion break**. The only health endpoint that exists —
PopCRM's worker `/health` — returns a hardcoded `{ok:true}` and never touches the database. Assume
it is green. It proves nothing.

### 7.0 Before anything: the free rehearsal nobody has used

**DesignFlow develop, staging and sandbox run on the shared Supabase pooler** (§2.1). They receive
every batch immediately, with no redeploy. **Promote each batch, then exercise DesignFlow sandbox
before touching the next batch.** It is the only environment in the estate that gets the new
database and can be broken without consequence. This costs nothing and is currently wasted.

### 7.1 The five-minute smoke test — run after EVERY batch, all nine times

Do these in order. Each one is a screen a person can open.

1. **PopCRM — log in.** Exercises `api.current_user_profile` (`src/auth/auth.tsx:106`). If login
   hangs or the user's name is blank, stop.
2. **PopPIM — log in, then open the Pipeline screen.** Exercises `api.current_user_profile` and
   `api.pm_pipeline_page` / `pm_pipeline_count` / `pm_pipeline_list_facets`. **A white page with no
   error message is the expected symptom of a PopPIM break** (§3.1) — treat a blank screen as a
   failure, not as "still loading".
3. **PopPIM — open a product and check the Dependencies / Decisions / Reminders panes.** These are
   the `('pim','product',id)` string-triple reads and the `current_user_profile` write path.
   **Empty-but-no-error is a failure signal here**, not an empty state.
4. **PopDAM — open the Styles grid.** Exercises the largest `core` surface and the realtime
   subscriptions. Then **edit one row** so a `postgres_changes` event has to fire; if the grid does
   not update itself, a realtime subscription has silently detached.
5. **PopCRM — open Customers and Contacts, then one Opportunity.** Exercises the generic
   `.from(view)` helpers where a wrong view name has no compile-time signal.
6. **PopCRM worker — read the journal, do NOT read `/health`.** On the worker host:
   `journalctl -u popcrm-outlook-ingest -u popcrm-summarize -u popcrm-reroute -u popcrm-contact-sync -u popcrm-apply-ignore-rules --since "10 minutes ago" -p err`
   Any output at all is a failure. This is the only way a worker break becomes visible.
7. **Open the browser devtools console on each app for one minute.** PopPIM's
   `reportOptionalDataError` writes a `console.warn` and shows a *reassuring* toast. The console is
   where the truth is.

### 7.2 Per-batch extras — the specific thing each batch could break

| Batch | Extra check, beyond the smoke test |
|---|---|
| **B0** canary | Nothing app-facing. Confirm the lane's own job summary and that one row exists. This batch is about the lane, not the data. |
| **B1** ColdLion breaker + signature change | No exposed app calls `sync_coldlion_licensors_properties`. Check the DB Data Admin licensor/property tree screen renders and the breaker state reads as untripped. |
| **B2** DB Data Admin tree + ClickUp import | **Highest-probability abort of the whole backlog is here** — see §7.3. Then open the DB Data Admin licensor→property tree and confirm division names appear instead of numeric codes. |
| **B3** promotion function chain | Run one ColdLion promotion dry pass and confirm the provenance columns are populated. **Incomplete provenance is unrecoverable after the fact**, so verify it before starting B4. |
| **B4** licensor aliases | DB Data Admin licensor list still renders; alias table is additive and read by nothing. |
| **B5** taxonomy alert ack | Acknowledge one taxonomy alert as a non-administrator and confirm the effective-role check accepts it. |
| **B6** item identity, status watch, baseline pins | PopPIM product pages (UPC/identity contract). Confirm nothing calls the old 8-argument `trip_taxonomy_circuit_breaker`. |
| **B7** Disney OPA | `api.opa_property_reconciliation` is read by no deployed app, so the drop-recreate window is invisible. **Confirm the view exists after the batch** — this is the one place a rebuild could leave nothing behind. |
| **B8** `core.product_size` / `core.product_depth` | **The most important manual check in this document.** Open PopDAM Styles and open the **size** picker (there is no material picker — §3.2, issue #721). **Do not judge it by whether the list "looks generic".** That test is broken: before B8 the picker is served by fallback **tier 2**, `style_groups.size_name`, whose 316 free-text values look entirely plausible (§3.2, `StylesPage.tsx:757–776`). The only valid check is a **count-and-content cross-check against what B8 seeded** — expect the seeded active identities, and confirm at least one value that exists **only** in `core.product_size` and not in `style_groups.size_name`. The automated equivalent is `core_product_size_*_matches_the_seed` in `scripts/post_batch_app_verification.py`; prefer it. A plausible-looking list is not evidence of success. |
| **B9** licensor landing | Confirm all three co-presence pairs completed. Spot-check that a *non*-administrator, non-`sales`, non-`licensing` account **cannot** read `plm.wb_*`. Confirm `api.dam_order_list` reports `security_invoker = true`. Note that `20260810170000` widens `plm.item` SELECT to every authenticated account by owner ruling — confirm that is still what the owner wants on the day. |

### 7.3 The one thing most likely to abort, and it is in B2

`20260728171500` reads the **live catalog body** of
`api.db_data_admin_licensor_property_tree(text, boolean, text, integer)` via `pg_get_functiondef`,
counts occurrences of two string anchors, string-patches both, and `execute`s the result (VERIFIED,
lines 64-84). **One character of drift between the production body and the anchors and it either
raises or silently patches nothing.** It also references `plm."divisionCode"`, a table created
nowhere in the backlog — so it depends on production already having it.

**Check this before B2, not during.** In the read-only dry-run job, dump the live function body and
confirm both anchors appear the expected number of times.

### 7.4 Other external preconditions to confirm before their batch

- **B7** — `20260807030000` hard-aborts unless a specific `core.licensor` row is exactly `DY` /
  `DISNEY` (VERIFIED: precondition raises at line 146, pinned by UUID
  `7d141a6f-e229-46a2-b3f5-0ba0c97dd820`).
- **B9** — `20260810050000` asserts a named profile is active; `20260810110000` / `120000` require
  `app.app_role` to contain `sales` and `licensing` (VERIFIED, line 123:
  `app.has_any_role(array['sales','licensing']::app.app_role[])`).

### 7.5 What "PREFLIGHT OK" is worth

Nothing, as approval. `strip_sql` in the guard removes dollar-quoted bodies on purpose, so a batch
whose real dependency lives inside a `do $$ … $$` block passes preflight and still aborts on
production. **The preflight may REJECT; it can never certify.** Do not report a green preflight as
evidence a batch is safe.

---

## 8. Owner decisions

These are stated, not answered. Each is one or two sentences: what changes, what could break, what
it costs to undo.

### D1 — Is user-reported discovery acceptable?

**What changes:** nothing technical; this is a decision to proceed as things are. **What could
break:** any of the nine batches could break any of the three applications, and the only way anyone
would find out is a person complaining — there is no monitoring on PopPIM, PopDAM or PopCRM, and the
one health check that exists is a hardcoded `{ok:true}` that would stay green through a total schema
break. **Cost to undo:** the promotion lane is forward-only; there is no rollback, so a break
discovered late is repaired by writing and promoting a new migration, not by reverting.
**This is the business risk #612 predicted, and it is the top decision.**

### D2 — How long may a legal resting point persist?

**What changes:** the elapsed time between batches, which can be minutes or days. **What could
break:** nothing structurally — every boundary in §5 is safe by construction — but each one is still
a **half-promoted production database**, and the longer it sits, the more likely a concurrent
workstream merges something that assumes the finished state. The most acute case is B9: it is atomic
and 14 files long, so a failure inside it leaves production in one of the three exposed states in §6
until it is finished. **Cost to undo:** none for a legal resting point; a resting point is safe
indefinitely in principle. The question is how long the owner wants "half done" to be the normal
state.

### D3 — The destructive migrations, named individually

Four migrations in the 61 remove or replace something that already exists on production. Each needs
explicit approval. (VERIFIED by scanning every one of the 61 for `drop` / `truncate` /
`delete from` / `alter table … drop`, excluding self-drops of temp tables and objects the same file
creates.)

1. **`20260726030000` (B1)** — **drops** `public.sync_coldlion_licensors_properties(jsonb, text)` and
   `plm.sync_coldlion_licensors_properties(jsonb, text)`, replacing them with a 3-argument version.
   *Could break:* anything calling the 2-argument signature. No exposed application does; this is a
   service-role import path. *Undo:* re-create the old signature in a new migration.
2. **`20260804120100` (B6)** — **drops** the 8-argument `trip_taxonomy_circuit_breaker` in both
   `plm` and `public`. *Could break:* any caller pinned to the old signature. *Undo:* same.
3. **`20260807190000` (B7)** — **drops and re-creates** the view `api.opa_property_reconciliation`
   (a genuine column-set change that `create or replace view` cannot do) and drops the
   `opa_property_character_read` policy. *Could break:* any reader during the window in which the
   view does not exist. No deployed application reads it. *Undo:* re-create the previous view
   definition, which is recoverable from git.
4. **`20260810170000` (B9)** — **drops and replaces** the `item_popdam_read` policy on the live
   `plm.item` table with `for select to authenticated using (true)`. **This is a security widening,
   not a cleanup: it makes the entire item catalogue readable by every authenticated account in the
   shared project.** The migration's own comment records this as an accepted owner trade-off
   (2026-08-10, issue #653, Option A). *Undo:* replace the policy with a narrower one — cheap
   technically, but the data has been readable in the meantime.

### D4 — Should the canary go before #611 is discharged?

**What changes:** `20260810140000` runs through the production apply lane while the `db push`
atomicity question is still open. **What could break:** if the CLI does not write SQL and ledger row
in one transaction, the canary could land as SQL-without-ledger-row or ledger-row-without-SQL.
**Why it is probably right anyway:** the canary is one table with one row read by nothing, and
running it is the cheapest way to settle #611 instead of arguing it — which is exactly what
`AGENTS.md` §5.1-A already allows. **This is listed because it is the owner's call to make, not
because the rule is unclear.**

### D5 — The DesignFlow non-production drift window

**What changes:** every batch immediately reaches DesignFlow develop, staging and sandbox, because
those environments are contractually bound to the shared Supabase pooler while DesignFlow production
is contractually bound to Cloud SQL. **What could break:** DesignFlow non-production, at any moment,
with no redeploy and no opt-in — and permanently, since nothing in this backlog closes the gap.
**Undo:** none; this is architecture, not a migration. **The decision is whether this is treated as
an asset (a free rehearsal environment, §7.0) or as a hazard to be scheduled around.**

### D6 — Is `20260810170000`'s widening still wanted on the day?

Separate from D3.4 because it is a *business* question, not an approval of a destructive statement:
opening the entire `plm.item` catalogue to every authenticated account was accepted on 2026-08-10 to
fix blank columns in PopDAM's order list. **`api.dam_order_list` has no deployed reader today**
(VERIFIED: the name appears in `popdam3` only inside vendored documentation). So the widening is
being shipped ahead of the feature that needed it. The owner may prefer to hold it.

### D7 — Who watches, and when?

§7 is a manual checklist requiring a human with logins to three applications and SSH to the PopCRM
worker host, run **nine times**. That is a real time commitment by a named person, and if the batches
are hours apart it is nine interruptions. **The decision is who does it and whether the batch
schedule is built around their availability** — because a checklist nobody runs is the same as no
checklist, and §7 is the only thing standing in for alerting.

---

## 9. What this contract does NOT cover

Stated honestly, because a summary is a document like any other.

1. **It did not read either database.** Which migrations are actually pending, what the live function
   bodies contain, and whether the guard's assumptions still hold on production are all properties of
   the database. The pending-set arithmetic in §5 is derived from a 2026-08-09 document plus files
   merged since. **Re-derive it with `supabase migration list` before pasting an allowlist.**
2. **It does not discharge issue #611.** Whether `db push` writes a migration's SQL and its ledger row
   in one transaction is unsettled, and only a run of
   `scripts/experiment_611_db_push_atomicity.sh` on Supabase CLI **2.105.0** discharges it. **No
   licensor batch — B1 through B9 — may go until that script has been RUN.** Only B0 is permitted
   meanwhile. This contract describes *where* the batches may rest; #611 governs *whether they may
   start*.
3. **It does not replace the whole-batch rehearsal** against a production-shaped scratch database.
   `supabase db push` wraps each *file*, not the batch, so a data-dependent assertion failing at file
   13 of 14 in B9 leaves production partially promoted with no undo. This contract makes the resting
   points safe; it cannot make a mid-file abort safe.
4. **It says nothing about performance.** Row counts, lock duration and index build time are not
   analysed. Warner alone is ~594,000 rows / ~150 MB. A batch that is logically safe can still hold a
   lock long enough for a live application to time out.
5. **It assumes the three exposed applications are not redeployed during the promotion.** Every
   verdict in §3 is against `origin/main` on 2026-08-10. A concurrent app deploy invalidates them.
6. **It does not cover any application outside `u2giants` and `popcre`.** If a "monitor" application
   exists somewhere I could not see, it is unrepresented here (§2.2).
7. **It does not analyse the `licensor-source-data-*` scraper repositories.** They may hold
   service-role credentials against the shared project; they were out of scope.
8. **The migration-side inventory is verified; the ledger-side inventory is not.** Every claim about
   what a migration *file* does was checked by opening the file. Every claim about what production
   *currently has* is inherited.

---

## 10. One-page summary for whoever executes this

- **Three apps are exposed: PopPIM, PopDAM, PopCRM.** DesignFlow production and monitor are not.
- **There are no renames in the backlog.** That is why batching works at all.
- **Fourteen legal resting points**, listed in §6 — the original ten, plus B10's four (§5A). Every
  other version in §6's first block is an exposed state.
- **B1, B3, B7, B9, B10a and B10c are atomic.** Do not split them, whatever a description implies.
  **`ATOMIC_BATCHES` covers only the first four**; **B10a is enforced separately, by its
  `CO_PRESENCE_RULES` pair**; and **B10c is enforced by nothing at all** — see §5A.8 and #784.
- **There is a batch B10, of six migrations in four parts** (§5A), covering everything merged after
  `20260810170000`. **Finishing B1–B9 does not promote it.** `20260810180000` is already applied and
  must never appear in an allowlist again.
- **"A batch cannot leapfrog" is FALSE for the production lane.** `prepare()` deletes every migration
  outside `applied ∪ allowlist`, so version order is **not** a guard rail (§5A.5). Anything in this
  document that relies on ordering relies on the operator.
- **B10 must NEVER be promoted before B9.** `20260810080000` (B9) asserts **exactly 16 SELECT and 15
  INSERT** grants on `plm.nbcu_*`; `20260811070000` (B10d) adds the **17th** table. Out of order, the
  assertion raises and the batch aborts (§5A.5, #800).
- **B9 is allowlistable again.** The co-presence deadlock over the already-applied `20260810180000`
  was fixed by PR #798, merged at `685ebf6`. Any note saying B9 is impossible is stale (§5A.8).
- **B1, B2 and B5 are fully applied**; B3 was in flight when §5A was written. §5's own arithmetic
  predates all of that — re-derive counts by set membership before acting.
- **The three worst states to be caught in** are inside B9: Paramount TRUNCATE, Warner
  `using (true)`, NBCU direct write.
- **Nothing may start until #611 is discharged by a RUN**, except the canary.
- **There is no monitoring.** §7 is a human checklist, and it is the entire safety net.
- **Verify against `origin/main` clones, not the stale local checkouts on this machine.**
