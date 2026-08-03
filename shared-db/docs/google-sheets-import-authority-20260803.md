# Master Data import authority — where curated data is still overwritten (2026-08-03)

**Status: SCOPE ONLY. Nothing here is implemented, and no migration is authored by this
document.** It records the owner ruling of 2026-08-03 (recorded as `AGENTS.md` §6.4), proves
where production violates it, and proposes what would have to change. Implementation and
sequencing are an owner decision that has not been made.

Everything below was verified **directly against production**, not taken from a brief.

---

## 0. Proof of target

Every read in this document was made through the Supabase MCP, which takes no project
parameter and is bound to production. `get_project_url` returned, immediately before the reads:

```text
https://qsllyeztdwjgirsysgai.supabase.co
```

`qsllyeztdwjgirsysgai` = **production**. (Preview is `rjyboqwcdzcocqgmsyel`.) All statements
run were `SELECT` only — no `INSERT`, `UPDATE`, `DELETE`, `DDL`, and no import, sync or lane
was executed against either database.

---

## 1. The ruling being enforced

> "importing Master Data info from Google Sheets is a temporary thing until all the employees
> are ready to do all work in our Master Data and then Google Sheets version gets deprecated
> and never touched again. so any improvements we've made should no longer be overwritten by
> the imports from Google Sheets. those imports should only be data that gets us up to date
> until we're ready to cut-over (hopefully soon)."
> — Albert Hazan, 2026-08-03

Full rule text and the direction-of-authority statement: `AGENTS.md` §6.4.

### 1.1 The one open scoping question

Albert names **Google Sheets**. A repo-wide search for `google sheet` / `googlesheet` /
`gsheet` / `spreadsheet` finds **no importer of that name in this repository** — the only hits
are the DB Data Admin grid engine, an unrelated sample-tracking spreadsheet preview
(`20260722221500_sample_tracking_durable_imports.sql`), and prose.

The live mechanism that actually carries the Master Data content he is describing — licensors,
properties and customers landing on top of what our team curates — is the **DesignFlow PLM
master-data pull**: endpoints `getLicensorsWithProperties` and `getCustomers`, landing through
`plm.import_master_data(jsonb, jsonb)`. That is the importer this document analyses.

**This is flagged, not assumed away.** If Albert also means a separate spreadsheet-era feed
that lives outside `shared-db`, that feed needs the same audit. Either way the ruling binds the
importer we do have, because it is the one exhibiting the behaviour he ruled against.

---

## 2. Verified overwrite paths

Source of truth for this section: `pg_get_functiondef()` of the **live production function**
`plm.import_master_data(jsonb, jsonb)` (SECURITY DEFINER, `search_path = app, core, ingest,
plm, extensions, public`). The repo file that last defined it on production is
`supabase/migrations/20260723140000_plm_import_master_data_preserve_customer_status.sql`.

### 2.1 VIOLATION — `core.property.licensor_id` is unconditionally re-parented

In the existing-property UPDATE branch of the live production function:

```sql
update core.property
set licensor_id = parent_core_licensor_id,
    name = v_source_name,
    code = coalesce(v_source_code, code),
    status = 'active',
    metadata = metadata || jsonb_build_object('plm_import_source', 'designflow_plm')
where id = core_property_id;
```

`parent_core_licensor_id` is set earlier in the loop to `core_licensor_id` — i.e. **the licensor
whose `properties` array the feed happened to nest this property under**. There is no
comparison against the existing value, no ruling consulted, no audit row written, and no
quarantine. Whatever parentage a human curated is replaced by feed nesting on every re-pull.

**Which lookup actually triggers it — corrected after GLM-5.2 review, then re-verified against
the live function.** The property match runs three keys in order:

| # | Key | Scoped to the feed's parent? | Can it re-parent? |
|---|---|---|---|
| 1 | `core.taxonomy_source_ref` provenance ref (`source_table='merchGroup'`, `source_id`) | **No** | **YES** |
| 2 | `p.licensor_id = parent_core_licensor_id and p.code = v_source_code` | Yes | No — already that parent |
| 3 | `p.licensor_id = parent_core_licensor_id and lower(p.name) = lower(v_source_name)` | Yes | No — already that parent |

So re-parenting happens **only via key 1**, the one lookup not scoped to the feed's parent. Keys
2 and 3 can only match a row that already has the feed's parent, making the assignment a no-op
for them. My first draft attributed the re-parenting to the UPDATE generally; the mechanism is
narrower and more specific than that. **The inconsistent scoping is itself the defect** — and it
produces a *second*, opposite corruption mode, see §2.8.

This directly contradicts the standing rule that licensor→property links are **hand-curated**
and never inferred, and the design work in
`docs/licensor-property-parent-child-design-20260802.md`.

**Live in production: YES**, and currently the *active* mode: all **256 of 256** `core.property`
rows have a `designflow_plm` provenance ref, so every property today matches on key 1.
**Severity: highest** — this is the field Albert's 2026-08-02 ruling turns on.

### 2.2 VIOLATION — `status` is force-set to `'active'` on licensors AND properties

Same property UPDATE above (`status = 'active'`), and the existing-licensor UPDATE branch:

```sql
update core.licensor
set name = v_source_name,
    code = coalesce(v_source_code, code),
    status = 'active',
    metadata = metadata || jsonb_build_object('plm_import_source', 'designflow_plm')
where id = core_licensor_id;
```

A curated `inactive` / `archived` / `potential` survives only until the next sync. This is why
`20260802170000_plm_import_preserve_curated_licensor_property_status.sql` exists.

**Live in production: YES.**

### 2.3 VIOLATION — `name` is unconditionally overwritten on both

Both UPDATE branches set `name = v_source_name` with no comparison and no guard. A curated
rename (spelling, casing, disambiguation) reverts on the next pull. **This is not covered by
the pending fix** — `20260802170000` removes only the two `status` assignments. Note the
contrast with the ColdLion promotion lane (§4), which is allowed to touch `name` only under a
single approved normalized-equivalent rule and refuses everything else.

**Live in production: YES. Not fixed by the pending migration.**

### 2.4 VIOLATION — `code` (my first draft got this WRONG; GLM-5.2 was right)

Both branches use `code = coalesce(v_source_code, code)`. My first draft filed this as "not a
violation, low severity" on the grounds that it is a gap-fill. **That is wrong, and it was
internally inconsistent with flagging `name`.** `coalesce(v_source_code, code)` returns the
**feed's** value whenever the feed supplies one — the existing curated `code` is used only when
the feed's is NULL. So `coalesce` guards against *erasure* but not against *replacement*: a
curated code is silently overwritten whenever the feed disagrees. That is a rename, which the
ruling explicitly forbids. Re-verified against the live function definition.

`core.licensor.code` and `core.property.code` are both `text NULL` with no default, so there is
no default value masking the distinction either.

**Live in production: YES. Not fixed by the pending migration.**

### 2.5 NOT a violation — `core.customer.status`

The customer branch is already compliant and says so in-line:

```sql
-- STATUS is app-owned: do NOT reset it here (survives re-pull).
```

That is tranche 1 (`20260723140000`, **applied to production — verified**), whose own header
states "Licensor/property paths are unchanged in this tranche." The licensor/property tranche
is the one still missing.

### 2.6 VIOLATION (structural) — `core.taxonomy_source_ref.confidence` is force-set to `'verified'`

Added after GLM-5.2 review; verified against the live function and production schema. Every
licensor and property row upserts its provenance ref with `confidence = 'verified'` and
`on conflict … do update set … confidence = excluded.confidence`. `confidence` is
`app.source_confidence not null default 'verified'`, and the enum offers
`verified, probable, possible, unmatched, rejected`. A human who deliberately downgrades a link
to `possible` or `rejected` has that judgement reset on the next run — textbook "re-status
something a human deliberately set."

`source_name` and `source_code` on the same row are likewise overwritten unconditionally, the
same class as §2.3/§2.4 but on a `core.*` table my first draft did not apply the per-field rule
to.

**Severity: structural, not yet realised.** All **505 of 505** `core.taxonomy_source_ref` rows on
production are currently `verified`, so no curated value is being destroyed *today*. The path is
open, and it closes the moment anyone starts curating link confidence.

### 2.7 Minor — the unconditional `metadata` stamp, and the trap it sets for the fix

Both branches run `metadata = metadata || jsonb_build_object('plm_import_source',
'designflow_plm')` on every matched row. Under the operative "write nothing on a matched row"
reading this is itself a (minor) write. It matters mainly as a **trap for proposal Step 4**: if a
future per-field curation record is stored in `core.licensor.metadata` /
`core.property.metadata`, this stamp runs on the same jsonb every import. Keep any curation
record **out of `metadata`**, or make the stamp key-scoped.

Checked, and *not* a problem: `metadata` is `jsonb NOT NULL DEFAULT '{}'` on both tables, so the
`||` operator cannot yield NULL. (GLM flagged this as worth verifying; verified, it is fine.)

### 2.8 VIOLATION (latent) — duplicate INSERT, the mirror image of §2.1

Added after GLM-5.2 review. The inconsistent match scoping in §2.1 cuts both ways. Where key 1
(provenance ref) **misses** — a row a human created here, not sourced from the feed — keys 2 and 3
are scoped to `p.licensor_id = parent_core_licensor_id`, so a curated property sitting under a
*different* curated parent **cannot be found**. The function then judges the row absent and
INSERTs a duplicate under the feed's parent with `status = 'active'`.

That is an **indirect status and parentage overwrite**: the human's `inactive`, or their chosen
parent, is not overwritten — it is superseded by a live duplicate. The cascade then cements it,
because the new provenance ref points at the duplicate, so every future run matches the duplicate
on key 1 and the curated original stays orphaned. The same shape applies to licensors via
key-2/key-3 (`code`, then `lower(name)`).

**Live in production: latent, and closer than it looks.** All 256 properties currently carry a
`designflow_plm` ref, so the property path is dormant. But **6 of 26 `core.licensor` rows have no
`designflow_plm` provenance ref at all** — exactly the hand-curated / prospective licensor
population that Albert's 2026-08-02 ruling created. For those, matching falls through to `code`
then `lower(name)`, and a miss inserts a duplicate. The property path arms itself the moment the
curated parent-child path in `docs/licensor-property-parent-child-design-20260802.md` starts
creating properties outside the feed.

### 2.9 Minor — `lower(name)` matching can manufacture a false match

Keys 3 (property) and the licensor name fallback match on `lower(name)`. Two names a human
considered distinct but which differ only by case collapse into one identity and are then
overwritten as if they were the same row. Scoped by parent for properties, so bounded; noted for
completeness.

---

## 3. Production vs. preview — the migration ledger

Queried directly against `supabase_migrations.schema_migrations` on production:

| Migration | On production? |
|---|---|
| `20260624173000_plm_master_data_import` | **applied** |
| `20260715234500_erp_coldlion_customer_vendor_import` | **applied** |
| `20260722213000_vendor_sync_guarded_importer` | **applied** |
| `20260723140000_plm_import_master_data_preserve_customer_status` | **applied** |
| `20260802170000_plm_import_preserve_curated_licensor_property_status` | **NOT APPLIED** |
| `20260802171000_owner_ruling_friends_tv_frida_kahlo` | **NOT APPLIED** |

Production's highest recorded version is `20260802194100`
(`fix_style_tracker_rfq_index_predicate`), so both 2026-08-02 files sort *below* the remote
max — they are a genuine backlog gap, not "newer than production". Promotion would follow the
bounded-temp-checkout recipe in `AGENTS.md` §5.1 and is an **owner gate**; it is not requested
or performed here.

### 3.1 The lane is dormant, not dismantled

`ingest.sync_run` on production, grouped by source:

| source_name | status | runs | last run |
|---|---|---|---|
| `plm_master_data_api` | succeeded | 15 | **2026-07-08 03:30:19 -04** |
| `coldlion_vendors_api` | succeeded | 8 | 2026-07-22 19:10:49 -04 |
| `coldlion_customers_api` | succeeded | 3 | 2026-07-17 12:20:42 -04 |

**Zero `failed` rows for `plm_master_data_api`** — the sync has been dead since 2026-07-08 and
recorded nothing, exactly the silent-failure shape already known upstream. Meanwhile
`systemd/plm-sync.timer` still schedules it **daily at 03:30** (`Persistent=true`), running
`tools/run-plm-master-data-sync.sh` → `tools/sync-plm-master-data.mjs` → `plm.import_master_data`.

**The consequence, stated plainly:** the only thing currently preventing production curated data
from being reverted is that an upstream endpoint is broken. Repairing that endpoint — a
reasonable-looking maintenance task, done by a session that has never read this document —
re-arms the overwrite. `Persistent=true` means a missed run fires on next boot. **Do not run,
re-enable, or repair that lane before §2.1–§2.3 are fixed.**

---

## 4. Sweep — does any other importer share the shape?

The rule in this repo is to sweep for the pattern, not fix one instance. All functions in
`plm`, `core`, `public`, `ingest`, `dam`, `pim`, `crm`, `app`, `dflow` matching
`import|sync|promote|upsert|ingest` were enumerated on production and their write paths read.

| Importer | Verdict | Evidence |
|---|---|---|
| `plm.import_master_data(jsonb,jsonb)` | **VIOLATES** | §2.1–§2.3 |
| `plm.import_coldlion_customers(jsonb)` | **Compliant, one note** | Carries the same `-- STATUS is app-owned: do NOT reset it here` comment; uses `phone = coalesce(phone, …)` so it fills gaps only. It does set `is_potential = false` unconditionally on match — but that is a *derived* flag, not curated: the trigger `core.sync_customer_potential()` sets exactly the same thing whenever a source ref appears. Not a curated-data overwrite. |
| `plm.sync_coldlion_vendors(jsonb)` / `public.sync_coldlion_vendors(jsonb)` | **Compliant — the reference implementation** | In-line: `-- MATCH: refresh non-status fields ONLY. Never status/name/display_name (app-owned).` and `-- coalesce guarantees we NEVER null an existing curated link`. Status set on INSERT only. This is what §6.4 compliance looks like. |
| `plm.import_item_master_data(jsonb)` | **Not applicable** | Writes `plm.item` / `plm.item_import` — ERP mirror tables, not curated master data. Its `status` comes from and belongs to the ERP feed. |
| `plm.import_merch_group_headers(jsonb)` | **Not applicable** | Writes `(company_code, division_code, mg_type_code)` header rows only; touches no curated entity. |
| `tools/promote-coldlion-source-owned.mjs` (recurring ColdLion licensor/property lane) | **Compliant — the second reference** | Its header states an explicit can/cannot list: it can change `core.taxonomy_source_ref.source_name`/`.source_code` and, under one approved normalized-equivalent rule, `core.licensor.name` / `core.property.name`. It **cannot** change canonical UUIDs, `core.property.licensor_id`, lifecycle status, canonical codes, or create/delete/inactivate a canonical row — because "ColdLion's API supplies neither the parent edge nor a lifecycle flag, so it is not entitled to assert either." Enforced by regression tests (`tools/coldlion-licensor-property-phase1.test.mjs` asserts no `update core.property set` / `update core.licensor set` in the migration). |
| `public.sync_*` trigger functions, `public.upsert_*` | **Not applicable** | Intra-row denormalization triggers and worker upserts into DAM-internal tables; no external feed, no curated field. |

**Conclusion of the sweep: `plm.import_master_data` is the only violator.** The pattern is not
systemic — it is the *oldest* importer (`20260624173000`), written before the app-owned-field
discipline that every later importer adopted. It simply never got retrofitted past the customer
tranche.

---

## 5. Scoped proposal (NOT an implementation)

Presented as options with a recommendation, per §1 of `AGENTS.md`. **No migration is authored
here** — `supabase/migrations/` is owned by another agent this session, and sequencing is
Albert's call.

### Step 1 — Promote what is already written and merged
`20260802170000` (status durability) and `20260802171000` (the FRIENDS TV / FRIDA KAHLO ruling)
are merged to `main` and absent from production. Promoting them via the §5.1 bounded temp
checkout closes §2.2 with code that already exists and has been reviewed. **Smallest possible
first move; needs only Albert's production-window approval.**

### Step 2 — Close the `licensor_id` re-parenting (§2.1)
Recommended: **stop writing `core.property.licensor_id` on an existing row entirely.** Set it on
INSERT only, exactly as `sync_coldlion_vendors` does for `status`. Parentage becomes a curated
field, which is what the standing memory rule and
`docs/licensor-property-parent-child-design-20260802.md` already say it is.

Where the feed disagrees with our parentage, do not silently reconcile — **land the disagreement
as evidence**, following the ColdLion quarantine pattern (`plm.coldlion_promotion_quarantine`).
The feed's *current* assertion stays available in `plm.property_import.plm_parent_licensor_id`
and `ingest.raw_record`, so refusing to apply it loses nothing that matters operationally.
(Precision, after GLM-5.2 review: both of those are **upserts keyed on the source id**, so they
hold the latest payload, not a history. They are not an audit trail and must not be cited as
one — which is a further reason the disagreement needs its own quarantine row.)

Rejected alternative: "only overwrite when ours is NULL." That is precisely the field-level
loophole §6.4 names — a deliberately-cleared parent is indistinguishable from one never set.
(Moot for this column anyway: `core.property.licensor_id` is `NOT NULL`.)

### Step 2b — Fix the match scoping, or Step 2 just moves the damage (§2.8)
Making `licensor_id` INSERT-only **does not** close §2.8; it can make it worse, because a
disagreement that used to re-parent will instead fall through to an INSERT. The match keys must
become consistent: either scope key 1 the same way as keys 2–3, or (better, and what the ruling
implies) **un-scope keys 2–3 so a curated row under a different parent is still found** — and
when the keys disagree about which row this is, treat it as a **possible match, not an absence**
and quarantine rather than insert. Steps 2 and 2b should ship together.

### Step 3 — Close the unconditional `name` and `code` overwrites (§2.3, §2.4)
Same shape, and `code` belongs here — it is an unconditional replacement, not a gap-fill (§2.4).
Options, in order of preference:
1. **Set them on INSERT only** — simplest, fully honours the ruling, costs us automatic
   propagation of upstream spelling fixes.
2. **Adopt the ColdLion normalized-equivalent rule** — allow the rewrite only when the two values
   are equal after normalization (case/whitespace), refuse otherwise. Precedent exists, is
   tested, and preserves cosmetic upstream fixes.

Recommend (2) for `name`, because it is proven in this repo and does not require new machinery.
Recommend (1) for `code`, because a code is an identifier: a "normalized-equivalent" code change
is not a cosmetic fix, it is a re-key.

### Step 3b — Stop force-setting `taxonomy_source_ref.confidence` (§2.6)
`confidence = coalesce(existing, 'verified')` on conflict, or omit it from the `do update` set
entirely so it is written on INSERT only. Cheap, and it forecloses the path before anyone starts
curating link confidence. `source_name` / `source_code` on that row should follow whatever Step 3
decides for the core tables.

### Step 4 — Make "deliberately set" recordable, so the loophole is closed structurally
Steps 2 and 3 dodge the loophole by never writing on UPDATE. That is safe but blunt: it also
blocks the legitimate catch-up case where a field genuinely has never been touched. If Albert
wants the finer behaviour, it needs a **per-field curation record** (a `curated_fields` marker
or a curation audit table) so an importer can ask "did a human set this?" rather than infer it
from the value. **This is design work, not yet designed, and is explicitly out of scope here.**
Note that Step 4 is optional: Steps 1–3b satisfy the ruling on their own.

**Constraint on the design, from §2.7:** do **not** put that record in
`core.licensor.metadata` / `core.property.metadata`. The import stamps that jsonb on every
matched row, so a curation marker living there would be overwritten by the very importer it is
meant to restrain.

### Step 5 — Guard it so it cannot regress
Add a regression test asserting that `plm.import_master_data` contains no unguarded
`licensor_id =` / `status =` / `name =` assignment in an UPDATE branch — mirroring the existing
`tools/coldlion-licensor-property-phase*.test.mjs` assertions. (`tools/*.test.mjs` is owned by
another agent this session; this is a proposal, not a change.)

### Sequencing note for Albert
Steps 1–3 are all **strictly less destructive** than the current function: each removes a write,
none adds one. None can break a reading app. The blocking question is only *when* to take the
production window.

### Out of scope, deliberately
- Applying anything to production (owner gate).
- Authoring any migration (another agent owns `supabase/migrations/` this session).
- Repairing the dead `plm_master_data_api` endpoint — **that must not be done first**; repairing
  it before Steps 1–3 re-arms the overwrite (§3.1).
- The silent-failure gap in the sync lane (15 runs, zero failure rows). Real, tracked elsewhere,
  and not this ruling.

---

## 5b. Independent review — GLM-5.2, 2026-08-03

The rule text and this analysis were reviewed by GLM-5.2 via `ai-glm-agent` in read-only mode
(exit 0, no working-tree change). Full report: `.ai/reviews/glm52-import-authority-20260803.md`.
**Every finding below was re-verified against the live production function definition and
production schema before being accepted** — GLM has produced confidently-wrong findings in this
repo before. Verdicts are mine.

| # | GLM finding (condensed) | Verified? | Verdict |
|---|---|---|---|
| 1 | The "safe reading" clause collides with clause 3: clause 3 assumes the import gap-fills unset fields on a matched row, the safe-reading clause says write nothing on UPDATE. And "the safe reading is…" reads advisory, not binding. | n/a (text) | **AGREE — real ambiguity, fixed.** §6.4 now states the today-rule as operative, not advisory: write curated fields on INSERT only, nothing on a matched row. |
| 2 | "A row is never wholly imported or wholly curated" is contradicted by "it may create a new row" — a new row *is* wholly imported. | n/a (text) | **AGREE — fixed.** That sentence is now scoped to **matched** rows. |
| 3 | The loophole clause closes the field level but leaves the **row** level open: fail to match → declare absent → INSERT. The rule even exempts INSERT. Property lookups scoped to the feed's parent guarantee a curated row under a different parent won't match. | **Yes** — confirmed in the live function: keys 2 and 3 carry `where p.licensor_id = parent_core_licensor_id`. | **AGREE — the strongest finding in the review.** A row-level loophole clause was added to §6.4, and §2.8 documents the mechanism. |
| 4 | `core.taxonomy_source_ref.confidence` is force-set to `'verified'` on conflict — a missed violation. | **Yes** — `confidence = excluded.confidence` in the live function; column is `app.source_confidence not null default 'verified'`; enum includes `possible`, `rejected`. | **AGREE on the path, DISAGREE on severity.** All 505 production rows are `verified`, so nothing is being destroyed today. Recorded as §2.6, "structural, not yet realised", with a fix in Step 3b. |
| 5 | `taxonomy_source_ref.source_code` / `source_name` are unconditionally overwritten and were not separated out. | **Yes.** | **AGREE.** Folded into §2.6. |
| 6 | The unconditional `metadata ||` stamp is itself a minor write, and is a **trap** if the per-field curation record is stored in `metadata`. Also: check jsonb `||` NULL behaviour. | **Yes** on the stamp and the trap. **NO** on the NULL concern — `metadata` is `jsonb NOT NULL DEFAULT '{}'` on both tables, so `||` cannot yield NULL. | **AGREE on the trap** (the best practical catch in the review — it would have broken Step 4). **DISAGREE on the NULL risk**, verified as a non-issue. Recorded as §2.7 and as a constraint on Step 4. |
| 7 | "NOT a violation: `code`" is wrong — `coalesce(v_source_code, code)` returns the feed value whenever it is non-null, so it replaces a differing curated code. Internally inconsistent with flagging `name`. | **Yes** — plain reading of `coalesce`, re-confirmed against the live definition. | **AGREE — GLM is right and my first draft was wrong.** Reclassified as a violation (§2.4) and folded into Step 3. This was a real error, not a nuance. |
| 8 | The re-parent mechanism is mis-pinned: keys 2 and 3 are scoped to the feed's parent so they cannot re-parent; only the provenance-ref match can. | **Yes** — confirmed key by key against the live function. | **AGREE, and it sharpens the finding.** §2.1 now carries a key-by-key table. The violation stands; the mechanism is narrower than I first wrote. |
| 9 | Duplicate INSERT is an indirect status overwrite, and the cascade cements it (provenance ref repoints to the duplicate, original orphaned). | **Yes** structurally; and production adds numbers GLM did not have: **256/256 properties have a PLM provenance ref** (path dormant) but **6/26 licensors have none** (path live for the curated licensor population). | **AGREE.** Recorded as §2.8 with the counts, and Step 2b was added because Step 2 alone would make it worse. |
| 10 | `lower(name)` matching can manufacture false matches between names a human considered distinct. | **Yes.** | **AGREE**, low severity — bounded by parent scoping for properties. §2.9. |
| 11 | `plm.*` staging and `ingest.raw_record` full-overwrite are plausibly fine as mirrors, but `raw_record` overwrite destroys the evidence base the "must be RECORDED" clause leans on. | **Yes** — both are upserts keyed on the source id, so they hold the latest payload, not history. | **AGREE, and it corrects an overstatement of mine.** My Step 2 had cited them as durable preservation of the feed's assertion; that claim is now qualified in place. |

**Net effect of the review:** two of my findings were wrong (§2.4 misclassified; §2.1 mechanism
mis-attributed), three overwrite paths were missing (§2.6, §2.8, §2.9), one supporting claim was
overstated (Step 2's evidence citation), and the rule text had a real ambiguity and a real
row-level loophole. One GLM concern (jsonb `||` on NULL) was checked and dismissed, and one
severity claim (§2.6) was downgraded on evidence.

---

## 6. What a fresh session must not conclude

- **"The sync is dead, so this is theoretical."** It is not. The timer is installed, daily and
  `Persistent=true`; only an upstream 502 is holding it off.
- **"`20260802170000` is merged, so production is fixed."** It is merged and **not applied** —
  verified against the production ledger on 2026-08-03.
- **"That migration fixes the whole problem."** It removes two `status` assignments. It
  deliberately leaves `licensor_id` (its own header says so) and does not touch `name`, `code`,
  `taxonomy_source_ref.confidence`, or the duplicate-INSERT path.
- **"`coalesce(feed, existing)` is a safe gap-fill."** It is not — it returns the *feed's* value
  whenever the feed has one. It prevents erasure, not replacement. This is what §2.4 got wrong
  in its first draft.
- **"Only the UPDATE branch can hurt curated data."** The INSERT branch can too, by creating a
  live duplicate that supersedes a curated row (§2.8).
- **"Every importer here does this."** No — one does. The other four, and the ColdLion promotion
  lane, are already compliant and are the templates to copy.
