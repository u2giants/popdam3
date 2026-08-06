# Where DesignFlow sets the Licensor → Property parent, and moving curation into DB Data Admin

**Status:** READ-ONLY investigation and design. No migration authored, no database written, no dflow repo touched.
**Author:** sub-agent `dflow-parent-logic`, dispatched by the shared-db coordinator.
**Date:** 2026-08-03.
**Builds on:** `docs/licensor-property-parent-child-design-20260802.md` (read first — this document does not
re-derive it; it corrects one section of it and adds the curation-home design Albert asked for).

**Target proof (`AGENTS.md` §4.2):** `get_project_url` returned `https://qsllyeztdwjgirsysgai.supabase.co`
— **production**. Every statement run for this document was a `SELECT`. No `INSERT`, `UPDATE`, `DELETE`,
DDL, migration, RPC-with-side-effects (`plm.check_taxonomy_sync_health()` was NOT called), alert
acknowledgement or breaker reset was performed, against either database.

---

## 1. The direct answer to "where does DesignFlow set the parent"

**Albert is right that DesignFlow sets a parent, and there is a real, live, verified write path for
`merchGroup.parent_id`. The previous agent found that same code and then mis-described it. Its finding was
RIGHT-BUT-MISLEADING on the code, and WRONG on the conclusion it drew from the code.**

### 1.1 The write path that exists

`PATCH /api/admin/updateMerchGroup` — a real, authenticated, role-gated HTTP endpoint on
`designflow-backend`.

`C:\repos\dflow\designflow-backend\routes\admin.router.js:87`:

```js
router.patch('/updateMerchGroup/', authRole(['designer', 'sourcing_manager', 'sales', 'production', 'admin']), adminController.updateMerchGroup);
```

`C:\repos\dflow\designflow-backend\controllers\admin.controller.js:299-307` passes the request body
straight through with **no validation of any kind** — no `mgTypeCode` check, no type check, no ownership
check:

```js
const updateMerchGroup = async (req, res) => {
  try {
    const { productType, productSubType, productSubSubType, divisionCode, updated_by } = req.body;
    const updatedAgeGroup = await AdminService.updateMerchGroup({ productType, productSubType, productSubSubType, divisionCode, updated_by });
```

`C:\repos\dflow\designflow-backend\services\admin.service.js:510-546` is the writer:

```js
      if (productSubType && productType) {
        if (!productSubType.parent_id && productSubType.is_active === false) {
          await sql.merchGroup.update(
            { parent_id: productType.id, is_active: true, modUser: updated_by, divisionCode_id_fk: divisionCode },
            { where: { mg_id: productSubType.id } }
          );
```

**This is where the previous agent went wrong.** It reported the writer as one that "handles Product
Type→Sub-Type only". That is true of the *screen*, and false of the *endpoint*. The service is entirely
**merch-group-type-blind**: `productType`/`productSubType` are just two ids the caller supplies. Nothing in
the router, controller or service restricts them to `'01'`/`'02'`/`'03'`. Send it a Licensor (`'05'`) as
`productType` and an unparented, `is_active = false` Property (`'06'`) as `productSubType`, and it writes
exactly the Licensor → Property edge, and flips the property to active. That is a licensor→property parent
write, reachable today by any user holding `designer`, `sourcing_manager`, `sales`, `production` or `admin`.

The previous agent's *second* claim — that the guard `!parent_id && is_active === false` means it "cannot
even re-parent an existing row" — is **correct and important**, and is the single most useful fact about
this endpoint. It is a first-parenting endpoint, not a correction endpoint. There is no re-parenting path in
DesignFlow at all.

### 1.2 The screen on top of it does not offer Licensor/Property

`C:\repos\dflow\designflow-frontend\src\app\pages\editor\merch-group-dialog\merch-group-dialog.component.ts`
("Update MG Dependencies", L58) L193-205 buckets options by `mgTypeDesc` into three named cases only:

```js
              switch (mgTypeDesc) {
                case 'Material':
                  this.productTypeOptions.push(option);
                  break;
                case 'Construction':
                  this.productSubTypeOptions.push(option);
                  break;
                case 'Feature':
                  if (merchGroup.parent_id === null) {
```

and L178-179 additionally discards everything not created in 2025:

```js
              const createdDate = merchGroup.createdTime ? new Date(merchGroup.createdTime) : null;
              if (!createdDate || createdDate.getFullYear() !== 2025) return;
```

So the *supported UI* is Material → Construction → Feature. `designflow-frontend` has exactly one caller of
`adminService.updateMerchGroup` (`admin.service.ts:175-181` → this dialog, L266). **NOT VERIFIED:** whether
anyone has ever driven the endpoint directly (curl/Postman/a script) to parent a property. What would close
it: DesignFlow application access logs for `PATCH /api/admin/updateMerchGroup`, or a Cloud SQL audit of
`merchGroup` writes. Neither is in my scope.

### 1.3 Every other candidate mechanism — ruled out, with evidence

| Candidate | Verdict | Evidence |
|---|---|---|
| ColdLion sync derives a parent | **No.** `parent_id` is not in the mapped record at all, so Sequelize's field whitelist can never write it. | `designflow-data-syncing\helpers\utility.js:279-301` (`remapMGDetail` — 15 fields, no `parent_id`, no `is_active`); consumed by `models\lib.model.js:245-287` (`create(record)` / `existing.update(record, { fields: allowedFields })`) and `:343-431` (`findOrCreateWithSSE`). Whitelist at L274-276 and L409-411 excludes only `mgCategory`/`createdTime`/`createdUser`/`createdAt`. |
| Another admin/taxonomy/Master-Data screen | **No.** `designflow-frontend\src\app\pages\editor\` holds 19 screens; only `merch-group-dialog` writes a parent. `license-list` is the royalty-rate confusable. | Directory listing; single-caller grep on `updateMerchGroup`. |
| Raw SQL / startup migration in app code | **No.** No `sequelize.query` anywhere in the six repos writes `merchGroup`; the only raw queries are reads in `item-master\helpers\itemReferenceGuard.js:55`, `helpers\licensingTimeline.js:316`, and the `designflow-tracking` sample RPCs. | Repo-wide grep for `sequelize.query` / `UPDATE "merchGroup"`, excluding `node_modules`, the stray `shared-db/` clones, and `.agent-work/`. |
| The parent is derivable from a ColdLion field (so a script could have backfilled it) | **No — and this is a positive finding.** Of 503 real edges: only 14 have `mgCode2` = parent `mg_code`, 20 share `ItemNoCode`, 27 share a `mg_code` prefix. **No rule reproduces the data.** | Production query against `dflow."merchGroup"` (§2). |
| A trigger / stored procedure / scheduled job inside the DesignFlow Cloud SQL database | **NOT VERIFIED — this is now the only surviving candidate for the bulk of the data.** | See §3. |

---

## 2. What the data itself says (production, read-only)

`dflow."merchGroup"` in Supabase is a **frozen snapshot** (max `modTime` = max `createdTime` =
2026-05-07 14:36:55; no `ingest.sync_run` references it). Everything below is therefore **"as of
2026-05-07"**, not live DesignFlow.

> **SUPERSEDED IN PART — 2026-08-06.** The snapshot date above is stale. A read-only measurement
> against production `qsllyeztdwjgirsysgai` on 2026-08-06 returned **2026-06-26**, not 2026-05-07.
> **The counts below still reproduce** — only the date moved, so the analysis stands; treat every
> "as of 2026-05-07" below as "as of 2026-06-26". Re-derive the date live rather than trusting
> either value. The original text is left in place as history. Separately, `core.property` rows all
> carry `updated_at` = 2026-07-08 (the day the PLM sync died) while all 15 `sync_run` rows say
> "succeeded" — see `AGENTS.md` §6.10-A. It is still the best measurement anyone has taken, and it closes the
open item the 2026-08-02 design flagged as "the single most important open measurement".

Merch-group types are `'05'`/`'06'`, never `'MG05'`/`'MG06'`.

| Measurement | Result |
|---|---|
| Licensors (`mgTypeCode='05'`) | **82** — all `parent_id` null (expected; they are roots), only **2** `is_active` |
| Properties (`mgTypeCode='06'`) | **614** total, **519** active |
| **Unparented properties** | **111** (18%) — of which **51 are ACTIVE and unparented** |
| Parented properties | 503 |
| Parents that are not a licensor | **0** — all 503 edges point at an `mgTypeCode='05'` row |
| Distinct licensors actually used as a parent | **39** of 82 |
| Edges whose parent licensor is not `is_active` | **499** of 503 — confirms `is_active` on MG05 is meaningless |
| Cross-division edges (property division ≠ licensor division) | **2** |
| Active **and** parented | **468** |

Two conclusions follow.

1. **The 2026-08-02 design's §3(c) item 7 is now answered: DesignFlow does NOT have zero unparented
   properties. It had 111.** So `NOT NULL` on `core.property.licensor_id` is not "simply correct", and
   step 5 of that design is live, not hypothetical. (Caveat: snapshot-dated. A live count needs §3.)
2. **468 active-and-parented exactly matches the 256→? drop story**: the master-data endpoint drops
   inactive properties, unparented properties, and childless licensors
   (`designflow-item-master\services\item_library.service.js:71-138`), so at most 468 of 614 properties
   and 39 of 82 licensors could ever have reached Supabase. Production holds 256 properties / 26
   licensors — the feed has never delivered the full picture, and it has been dead since 2026-07-08.

The user columns are ColdLion ERP logins carried in by the sync (`JSeguine` 415, `JAshley` 67, `BRivera`
11, `Jcoleman` 5, `SGhosh` 1 on parented rows), not DesignFlow display names — and
`AdminService.updateMerchGroup` deliberately does **not** bump `modTime` (`admin.service.js:537`, commented
out "never enable this else it will break sync"). So the snapshot carries **no fingerprint of a DesignFlow
app write**. That is consistent with, but not proof of, §3.

---

## 3. The one thing I could not verify, and exactly what would close it

**Claim NOT VERIFIED:** that the 503 existing edges were written by a human doing direct SQL against the
DesignFlow Cloud SQL database (or by a trigger/procedure/job inside it), rather than through
`PATCH /api/admin/updateMerchGroup`.

The DesignFlow Cloud SQL database is out of scope (`AGENTS.md` §0.1 — I hold no read-only credential and
did not request one). **Two queries settle it**, run read-only against the DesignFlow Cloud SQL database:

```sql
-- Q1: is anything inside the database itself writing the edge?
select tgname, tgrelid::regclass, pg_get_triggerdef(oid)
  from pg_trigger where not tgisinternal and tgrelid = 'merchGroup'::regclass;
select p.proname, n.nspname, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog','information_schema')
   and pg_get_functiondef(p.oid) ilike '%parent_id%';
```

```sql
-- Q2: the live version of §2, plus who last touched each parented property
select "mgTypeCode",
       count(*) total,
       count(*) filter (where parent_id is null) unparented,
       count(*) filter (where is_active) active
  from "merchGroup" where "mgTypeCode" in ('05','06') group by 1;
select "modUser", count(*) from "merchGroup"
 where "mgTypeCode" = '06' and parent_id is not null group by 1 order by 2 desc;
```

If Q1 returns nothing and Q2's `modUser` values are all ColdLion logins, the answer is settled: **the edge
is set by hand, directly in the database, by a person with SQL access** — which is exactly what Albert
means by "that's where the logic lives", and exactly why it must move.

---

## 4. Verdict on the previous agent's finding

| Their claim | Verdict |
|---|---|
| "No endpoint … writes `parent_id` for a licensor/property pair" | **WRONG.** `PATCH /api/admin/updateMerchGroup` writes `parent_id` for *any* pair, licensor/property included. It is type-blind at every layer (router, controller, service). |
| "handles Product Type→Sub-Type only" | **RIGHT-BUT-MISLEADING.** True of the dialog, false of the API. Stating a UI restriction as an API guarantee is how a real write path got reported as absent. |
| "guarded by `!parent_id && is_active === false` so it cannot re-parent an existing row" | **RIGHT, and the most useful fact in their report.** DesignFlow can *first-parent*; it can never *correct* a parent. |
| Implied conclusion "there is no mechanism" | **WRONG.** There is a mechanism; it is unusable for correction, unaudited, and unreachable from any screen for licensors/properties. |

There is also a trap worth recording: the guard tests `productSubType.is_active === false` on the
**client-supplied object**, strictly. ColdLion-synced rows arrive with `is_active` **NULL** (`remapMGDetail`
never sets it), and `null === false` is false — so freshly synced properties do **not** satisfy the guard.
Anyone assuming "new rows can be parented through this endpoint" would be wrong.

---

## 5. Design: DB Data Admin as the home for monitoring AND establishing parentage

Albert's ruling, verbatim: *"DB Data Admin screen should be where we monitor and establish the
licensor→property parent-child relationship. It sits in designflow now but we all agreed it should not be
only in 1 particular application."*

This **reverses** two things already written down, and both need a forward correction (never an edit to an
applied migration):

- `supabase/migrations/20260722170000_*.sql` lists **"Licensor/Property"** under **"Refused here"**
  (the `-- Refused here:` block, ~L36-38).
- `apps/db-data-admin/src/LicensorTree.tsx:152` tells the user: *"The relationship is DesignFlow-owned; do
  not repair it here."*

The 2026-08-02 design's §5 (audit table → RPC → proposal table → picker view, with step 0 disarming
`plm.import_master_data()` and step 5 gated) is **the right spine and I am not re-deriving it**. What
follows is only what changes now that DB Data Admin is the curation home rather than a read-only mirror.

### 5.1 The verified blocker

Production, `information_schema.role_table_grants`: on both `core.property` and `core.licensor`,
`authenticated` holds **`SELECT` only**. `postgres` and `service_role` hold the full set. The `admin_write`
RLS policy on `core.property` is therefore **unreachable from a browser session** — RLS is not a GRANT, and
this repo has already shipped that exact fix once for `crm.*` (`AGENTS.md` §11).

**The fix is NOT to grant `authenticated` `UPDATE`.** Doing so routes writes around the audit trail. The
fix is a `SECURITY DEFINER` RPC with `EXECUTE` granted to `authenticated` — the same shape every other DB
Data Admin write already uses.

### 5.2 What the database must expose (this is our work)

Four objects. Steps 1-4 are purely additive; nothing existing changes type, nullability or meaning.

**(a) A monitoring view — `api.db_data_admin_property_parent_health`** (`security_invoker = true`;
`AGENTS.md` §10.2 records three views that leaked ~16,600 rows to `anon` by omitting it). One row per
property, carrying the fields the panel needs to stop being read-only:

- identity: property id/name/code/status, licensor id/name/status;
- `is_orphan` (once step 5 makes orphans representable — until then always false);
- `has_open_proposal` (from the proposal table);
- `last_ruled_at` / `last_ruled_by` (from the audit table);
- `suspect_flags jsonb` — the audit signals, never applied, only shown. Seed it with the three that
  the §2 measurements actually justify: **cross-division pairing** (2 such edges exist in the snapshot),
  **licensor never used as a parent by anything else**, and **product co-occurrence disagreement**.

Filter predicate must be `status in ('active','potential')`, matching
`api.db_data_admin_licensor_property_tree`, **not** the `= 'active'` habit found elsewhere — otherwise the
5 `potential` licensors vanish and prospective-licensor workflows break.

**(b) A curation RPC — `core.set_property_licensor(...)`**, exactly as specified in
`licensor-property-parent-child-design-20260802.md` §5.3, with **three DB-Data-Admin-specific additions**:

1. **Authorisation must match the rest of DB Data Admin**, not invent a new axis: both the `administrator`
   role **and** a live `admin` `app_access` row, via `app.require_db_data_admin_access()` — the gate
   `20260722170000` already established. Do **not** gate on `public.app_role` (`admin | user` only —
   see the two-permission-systems trap).
2. **Optimistic concurrency + idempotency, same as every other DB Data Admin write**: `p_expected_updated_at`
   on the core row returning `code='stale_token'` with the fresh row, and a client `p_operation_id`
   recorded so a retry replays rather than re-applies. A curation screen that does not match the grid's
   concurrency contract will corrupt data the first time two people have it open.
3. **Return the stale-pair consequence list** — the `dam.asset` / `dam.style_guide` rows whose stored
   `(licensor_id, property_id)` pair no longer agrees — so the curator *sees* the blast radius. Do not
   repair them silently.

**(c) An audit trail — `core.property_parent_audit`**, per that design's §5.2, **plus the unconditional
trigger on `core.property`** (its §5.3, post-Kimi). Without the trigger, a `service_role` update leaves no
trace, and `service_role` is the only role that can currently write at all. Emit
`source_channel = 'db_data_admin'` for RPC-originated changes so DB Data Admin's own history panel can
filter to its own writes.

**(d) A proposal queue — `core.property_parent_proposal`**, per that design's §5.4, unchanged. This is
where **R4** is enforced structurally: co-occurrence, ColdLion divergence and DesignFlow-feed divergence
land here as *proposals a human must rule on*, and **no trigger ever promotes an accepted proposal into
`core.property`**. Accepting a proposal and moving the edge are two separate acts.

Order: audit table → RPC → proposal table → health view. Step 0 (disarming the `licensor_id` overwrite in
`plm.import_master_data()`) still **blocks everything**, and still must land before any revival of the
master-data feed — otherwise the first successful run reverts every curated ruling.

### 5.3 What is application work (NOT ours — I did not do it)

- The DB Data Admin curation panel itself: replacing the `LicensorTree.tsx:152` copy, a "change licensor"
  action, the evidence textbox, the confirmation dialog showing the stale-pair list, the proposal inbox,
  the history panel.
- DesignFlow: retiring or type-restricting `PATCH /api/admin/updateMerchGroup`, and pointing DesignFlow's
  property picker at the shared source once **R5** retires `dflow.*`.
- Any change to `poppim-web`, `popcrm-web`, `popdam` screens.

### 5.4 What changes for DesignFlow

Nothing breaks on day one. Long-term, three things change and each needs the app team, not us:

1. DesignFlow stops being the place a parent is established. `PATCH /api/admin/updateMerchGroup` should
   either reject `mgTypeCode` `'05'`/`'06'` pairs outright, or be retired. Leaving it type-blind while
   curation lives elsewhere means two writers of one fact — the exact condition that produces silent drift.
2. DesignFlow's client-side cascade
   (`newItem-dialog.component.ts:1227-1228`, `.filter(feature => feature.parent_id === Number(licenseId))`)
   keeps working off `merchGroup.parent_id` until **R5** completes, so during the transition the two stores
   can disagree. The drift detector (`parent_edge_hash`, `20260726180000`) will see every legitimate
   curation as drift unless it is taught to recognise a ruled change — that is an owner decision already on
   the 2026-08-02 list (item 7 there / item 9 in its §7).
3. DesignFlow gains something it has never had: **the ability to correct a wrong parent.** Today it
   structurally cannot (§1.1 guard).

### 5.5 Blast radius

Steps (a)-(d) are additive: a view, a function, two tables. **Zero effect on PopPIM, PopCRM, PopDAM,
DesignFlow PLM or DB Data Admin until each opts in.** The 2026-08-02 design's §6 table stands unchanged and
I am not restating it. Three deltas specific to this reversal:

| Surface | Delta from making DB Data Admin the curation home |
|---|---|
| **PopDAM** | Highest exposure. It holds **hard FKs** (`dam.asset.licensor_id/property_id`, `dam.style_guide.licensor_id/property_id`). Curation makes the stale-pair problem *actual*, not theoretical, because someone can now re-parent. Mitigated by 5.2(b)(3): warn and list, never auto-rewrite. |
| **PopPIM** | Reads via `api.pm_product_board` / `api.pm_product_assets`. **NOT VERIFIED** whether any PIM table *stores* licensor/property ids — `poppim-web` is not checked out here. Same residual risk the 2026-08-02 review flagged and could not close. |
| **PopCRM** | Effectively none; reaches the edge only through `api.global_search`. |
| **DesignFlow PLM** | See 5.4. Dual-writer risk during transition is the real item. |
| **DB Data Admin** | Its own panel copy and the migration's "Refused here" list become wrong and must be corrected forward. Its orphan panel currently assumes zero orphans is normal; §2 says 111 existed in DesignFlow, so the panel must handle a real non-zero set. |

---

## 6. What I deliberately did NOT do

- **No migration authored**, and no edit to the applied `20260722170000` — corrections are forward only.
- **No database write of any kind.** Every statement was a `SELECT`. `plm.check_taxonomy_sync_health()` was
  not called (it writes). No alert acknowledged, no breaker reset.
- **No change to any dflow repo** — no file touched, no branch switched, no commit.
- **No DesignFlow Cloud SQL access.** I hold no read-only credential and did not request one; §3 states the
  two queries that would close the remaining question.
- **No application work** — no DB Data Admin UI, no DesignFlow endpoint change.
- **No co-occurrence analysis run.** It is an audit tool (R4); running it here would produce numbers that
  read as findings.
- **No merge**, no promotion. PR opened and stopped.
