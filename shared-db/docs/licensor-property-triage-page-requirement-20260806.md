# Requirement — ingest everything, then triage it: the Licensor/Property triage page

**Date:** 2026-08-06
**Status:** Requirement. Nothing here is built. No migration is authored by this document.
**Owner ruling this document exists to implement (2026-08-06, Albert):**

> **"The feed should not drop anything. In data-dev.designflow.app there should be a
> licensor-property triage page where I can fix the problems instead of ignoring them /
> not ingesting them."**

This ruling **overturns the current design.** Today the master-data feed is built to *discard*
anything it cannot cleanly classify. The ruling says the opposite: bring it all in, mark what is
broken, and give Albert a screen to fix it.

---

## 0. The short version

Three sentences, then the detail.

1. The feed that copies Licensors and Properties from DesignFlow into the shared database throws
   away roughly half the tree on purpose, and nobody sees what was thrown away.
2. Albert has ruled that nothing may be thrown away: everything comes in, the broken rows get
   flagged, and a new triage screen in DB Data Admin lets him fix them by looking at real evidence
   (descriptions and items), never by looking at a code.
3. **The order matters more than the work.** Two things must be fixed *before* the feed is repaired,
   or repairing the feed actively makes the system worse than it is today. Section 6 is the most
   important section in this document.

---

## 1. The problem, in plain business English

### 1.1 What is being thrown away

The shared database gets its list of Licensors (brand owners like Disney) and Properties (the things
under them, like a specific movie or character line) from one DesignFlow web address:
`GET /api/item_master/lib/getLicensorsWithProperties`.

That endpoint deliberately drops rows in **three separate places**
(`designflow-item-master/services/item_library.service.js` L71-138, quoted verbatim at
`docs/licensor-property-parent-child-design-20260802.md:161-181`):

| # | What is dropped | The code that drops it |
|---|---|---|
| (a) | **Inactive properties** | `const propertyWhereClause = { is_active: true, … }` |
| (b) | **Properties with no parent** | `if (property.parent_id === null \|\| property.parent_id === undefined) { return; }` |
| (c) | **Licensors with no children** | `.filter((licensor) => licensor.properties.length)` |

There is an asymmetry worth naming: **licensors are selected with no `is_active` filter at all**,
properties with one (`docs/licensor-property-parent-child-design-20260802.md:183-185`). The rule is
not a considered policy. It is three unrelated conveniences that happen to compound.

And because the payload is *nested* — properties are sent inside their licensor — a property with no
parent has no envelope to travel in. **The feed structurally cannot carry an unparented property.**
This is not a filter that can be flipped off; the shape of the message forbids it.

The shared-db side that consumes this is `tools/sync-plm-master-data.mjs:16-17`
(`LICENSORS_URL = "https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties"`).

### 1.2 How much is lost

Measured against `dflow."merchGroup"`, the DesignFlow mirror held in Supabase. Every figure is cited
to `docs/dflow-parent-logic-and-curation-home-20260803.md:120-140`.

| Measurement | DesignFlow | Arrived in `core.*` |
|---|---|---|
| Licensors (`mgTypeCode='05'`) | **82** | **26** |
| Properties (`mgTypeCode='06'`) | **614** (519 active) | **256** |
| Parent edges | **503** | **256** |
| **Unparented properties** | **111 (18%)** — of which **51 are ACTIVE** | cannot exist (see §2) |
| Distinct licensors actually used as a parent | **39** of 82 | — |
| Active **and** parented (the theoretical ceiling of the feed) | **468** of 614 | — |

Read the last row twice. **468 is the most the feed could ever deliver, out of 614.** The other 146
were never reachable. And only 256 actually arrived, because the feed has been dead since 2026-07-08.

> ### ⚠️ Correction to the framing these numbers are usually given in
>
> These are **not** "measured live today against production DesignFlow." They come from
> `dflow."merchGroup"` in Supabase, which is a **frozen snapshot dated 2026-05-07 14:36:55**
> (`docs/dflow-parent-logic-and-curation-home-20260803.md:112-116`). It is the best measurement
> anyone has taken and it is three months stale. It is good enough to prove the shape of the problem
> and to justify this requirement. It is **not** good enough to size the triage queues or to close
> Albert's decision on how orphans are stored. A read-only DesignFlow Cloud SQL account now exists
> to get the live count (1Password item `tcaf3o3u2cx52g6ivvczxbhola`, user `albert_read_only`,
> SELECT only, schema `designflow`); the queries to run are already written at
> `docs/dflow-parent-logic-and-curation-home-20260803.md:165-185`. **Get the live count before
> building the queues.**

### 1.3 What it costs

- **Half the tree is invisible.** Four applications read `core.licensor` / `core.property`. Any of
  them offering the user a picker is offering a picker with 26 of 82 brand owners in it. A user who
  cannot find their licensor concludes the system is broken, or files the work under the wrong one.
- **The dropping is silent.** Nothing counts what was skipped, nothing alerts, nothing is written to
  a quarantine table. A row simply is not there, and "not there" is indistinguishable from
  "does not exist". This is exactly the silent-failure pattern that is forbidden by standing rule.
- **The 51 active unparented properties are real, live work.** They are not junk rows. They are
  properties somebody is actively using in DesignFlow that the shared database has never heard of.
- **The problem is self-concealing.** Because the feed never delivers an unparented property, no
  downstream screen has ever had to render one, so nobody has ever seen the gap. The DB Data Admin
  orphan panel exists (`apps/db-data-admin/src/LicensorTree.tsx:149-152`) but has always shown zero,
  and it tells the user *"The relationship is DesignFlow-owned; do not repair it here."*

---

## 2. The ingestion change

### 2.1 The requirement

**Ingest every licensor and every property, regardless of parent, activity, or childlessness.**
A row that cannot be cleanly classified is **marked for triage**, never discarded.

Concretely, three things change:

1. **Remove the three drops** at the source (`item_library.service.js` L71-138). The endpoint must
   send inactive properties, unparented properties, and childless licensors.
2. **Change the payload shape.** The nested "properties inside their licensor" structure cannot
   carry an unparented property. The endpoint must emit properties as a flat list with a nullable
   parent reference, *or* emit an additional flat `unparented` collection alongside the tree. Either
   way this is a **breaking contract change** to the endpoint and to
   `tools/sync-plm-master-data.mjs` — both sides change together, in the same window.
3. **Every skipped or degraded row lands somewhere visible**, with the reason. Follow the existing
   `plm.coldlion_promotion_quarantine` pattern rather than inventing a new one.

### 2.2 What must NOT change with it

The rule already adopted for the importer applies with extra force here — restate it in whatever
lands:

> **The feed is not authoritative for absence.** A row being omitted from the feed does not mean
> delete, does not mean deactivate, and does not mean re-parent.

Under any absence-implies-something rule, every orphan the triage screen creates would be destroyed
by the next successful import.

### 2.3 The schema obstacle — `core.property.licensor_id` is `NOT NULL`

**An unparented property currently cannot be stored at all.** The column refuses it.

> ### ⚠️ Correction to the citation normally given for this
>
> This constraint is **not** at `supabase/migrations/20260621150815_app_core.sql:200`. That line is
> `unique nulls not distinct (licensor_id, code)` — a different constraint that matters separately
> (see the trap below). In the foundation migration the column is **nullable**:
> `20260621150815_app_core.sql:191` reads
> `licensor_id uuid references core.licensor(id) on delete set null`.
>
> The `NOT NULL` was added later, by
> `supabase/migrations/20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql:71-72`,
> together with an `ON DELETE RESTRICT` FK at `:74-78` and a preflight at `:43-65` that aborts the
> migration if any null exists. The column comment at `:80-81` states the rule as settled:
> *"every Property has exactly one Licensor."*
>
> **This matters.** The constraint was authored on the belief that DesignFlow had zero unparented
> properties. It had 111 (`docs/dflow-parent-logic-and-curation-home-20260803.md:134-136`). The
> constraint encodes an assumption the data has already falsified.

**A second, less obvious trap.** `unique nulls not distinct (licensor_id, code)` at
`20260621150815_app_core.sql:200` treats NULL as a *value* for uniqueness. So:

- Under a **nullable** column, two different orphan properties that share a code collide and the
  second insert is rejected. Given §5's collision rate, this is not hypothetical.
- Under a **holding licensor**, the same collision happens — every orphan sharing a parent means
  every duplicate code under it collides.

**Any option chosen in §2.4 must also state what happens to this unique constraint.** Ignoring it
turns "ingest everything" into "ingest everything except the duplicates", which is the same silent
drop wearing a different hat.

### 2.4 The options — Albert decides, this document does not

**Option A — make `licensor_id` nullable again.**

| | |
|---|---|
| **For** | Honest. A property with no owner genuinely has no owner, and the database says so. No fake row for every screen to learn to hide. Reverses a constraint written on a false premise. |
| **Against** | Changes the meaning of the column across **four applications**. Every `join core.licensor` becomes a `left join` or silently loses rows. The `ON DELETE RESTRICT` FK and the `NOT NULL` were added in the same migration and were the deliverable of a whole phase — reverting them needs a forward migration and a clear story about why. Must also decide the `unique nulls not distinct` behaviour. |
| **Reversibility** | Poor once orphans exist. Re-imposing `NOT NULL` later requires every orphan to be resolved first — exactly the preflight at `20260724030000:43-65`. |

**Option B — a holding licensor (e.g. `UNASSIGNED`).**

| | |
|---|---|
| **For** | No schema change to the column at all. Nothing downstream breaks on day one. Every existing join keeps working. The triage queue becomes trivially queryable: *"everything under UNASSIGNED"*. |
| **Against** | It is a lie in the data, and lies in data leak. Every screen that lists licensors must learn to hide one specific row — four applications, and every new screen forever. If any screen forgets, a user sees "UNASSIGNED" offered as a brand owner and may file work under it. Does not solve the unique-code collision. Creates a row that must never be deleted, with no constraint enforcing that. |
| **Reversibility** | Good. Once triage empties it, the row is dropped and nothing has changed structurally. |

**Option C — a separate quarantine table.**

| | |
|---|---|
| **For** | `core.property` stays exactly as it is — clean, `NOT NULL`, every row trustworthy. Broken rows never contaminate the canonical table, so no application can accidentally read one. Matches the pattern already in use (`plm.coldlion_promotion_quarantine`) and already recommended for the importer. Can carry the triage evidence columns (raw payload, reason, source hash) that do not belong in `core.property`. Naturally solves the unique-code collision — quarantine has no such constraint. |
| **Against** | Two places to look for a property instead of one. Promotion out of quarantine into `core.property` is a real code path that must be written and guarded. **Critically: nothing may auto-promote.** A quarantine row that promotes itself is the overwrite wearing a review queue as a disguise — a trap already named in the Phase 2 acceptance work. Also, a property in quarantine is invisible to applications, so from a user's point of view it is still "dropped" until a human triages it. |
| **Reversibility** | Excellent. Purely additive; rollback is `drop table`. |

**Not a recommendation, but a note the decision should account for:** A and C are not mutually
exclusive. C can ship first (additive, no blast radius, nothing breaks) to stop the data loss
immediately, with A or B decided later once the live orphan count is known. B is the only one that
requires no schema change at all and is therefore the fastest, and also the only one that puts a
fictional row in front of users.

**This decision is already open as Decision 3 in
`docs/licensor-property-cloudsql-cutover-plan-20260806.md` §8**, framed there as sentinel vs nullable
with a recommendation of the sentinel. **This document adds Option C, which that framing did not
consider, and adds the `unique nulls not distinct` complication, which neither considered.** Decision
3 should be re-asked with all three options on the table.

**No migration is written here, and none should be written until Albert rules.**

---

## 3. The triage screen

### 3.1 Where it lives

In the **DB Data Admin** application, at `data-dev.designflow.app` (development) and
`data.designflow.app` (production). See §7 — this is **not** where most people assume it is.

It replaces and forward-corrects the current orphan panel at
`apps/db-data-admin/src/LicensorTree.tsx:149-152`, whose copy reads *"The relationship is
DesignFlow-owned; do not repair it here."* **That sentence becomes wrong the moment this ruling is
implemented, and must be removed as part of the work.** The same correction is owed to migration
`20260722170000`, which lists "Licensor/Property" under "Refused here" — corrections to an applied
migration are **forward only; never edit an applied migration.**

### 3.2 The queues

Five queues. Each is a list of rows needing a decision, with a count badge, and each must show zero
cleanly (an empty queue is a normal state, not a blank screen).

| Queue | What is in it | Why it needs a human |
|---|---|---|
| **1. Unparented properties** | Properties that arrived with no licensor. Expect ~111, of which ~51 active, pending the live re-count (§1.2). | Only a human reading the description and the items can say who owns it. |
| **2. Parent looks wrong** | Properties whose stated parent disagrees with the evidence — the known Harry Potter and NASA products filed under DISNEY, plus anything the importer quarantined as a disagreement. | The feed and the curated value both claim to be right. |
| **3. Code collisions across licensors** | Property codes that exist under more than one licensor. See §5 — this is the queue that makes code-only matching provably unsafe. | Two rows with the same code are two different things and must stay two different things. |
| **4. Inactive rows** | Properties (and licensors) marked inactive in DesignFlow, now ingested rather than dropped. Note `is_active` on licensors is measurably meaningless: **499 of 503 edges point at a licensor that is not `is_active`** (`docs/dflow-parent-logic-and-curation-home-20260803.md:127`). | Albert decides whether inactive means retired, or just neglected. Mostly the latter. |
| **5. Childless licensors** | Licensors with no properties under them. Expect ~43 (82 total minus 39 actually used as a parent). | Some are real but unused; some are duplicates of a licensor that *does* have children. |

Queues 3 and 5 are the two most likely to be dismissed as low value. Both are the opposite: queue 3
is a live data-integrity defect (§5), and queue 5 is where duplicate brand owners hide.

### 3.3 What Albert can do to a row

Per row, in every queue:

- **Assign / re-assign the licensor** — the core action. Through the curation RPC only (§3.6).
- **Confirm as correct** — record that the current state was reviewed and is right. This must be a
  first-class recorded outcome, not "do nothing". Otherwise every re-import re-raises a row that has
  already been judged, and the queues never drain.
- **Mark as a duplicate of another row**, naming the survivor.
- **Defer with a note** — an explicit "I cannot decide this yet, and here is why." Better than a row
  silently sitting at the bottom of a list forever.
- **Change status** (active / inactive / potential) where that is the actual finding.

Bulk action is allowed **only** where every selected row resolves to the same target licensor, and
the screen must show the full list of what is about to change before it commits.

### 3.4 The evidence the screen must show

**This is the part that decides whether the screen works.** A row with only a code and a name on it
is not triageable — see §4. Every row must carry, without a second click:

- **The property description**, in full, not truncated. This is the deciding field (§4).
- **The licensor description** of the currently-assigned parent, and of any candidate parent offered.
- **Item numbers and item descriptions** for products already using this property — the strongest
  available evidence of what a property actually is. A count alone is not enough; show real examples.
- **The style guide(s)** associated with the property.
- **The division** (and company code), because a merch-group code is only unique per
  division + type — the same code in two divisions is two different things.
- **The source record as received**, raw, so a disputed decision can be re-examined later.
- **Why this row is in this queue**, in one plain sentence.
- **Any prior decision on this row** — who, when, and the evidence they gave.

If a piece of evidence is unavailable, the screen must say *"no items found"* rather than showing an
empty area that reads as zero.

### 3.5 What the screen must NEVER let him do

- **Never decide by code alone.** The screen must not offer an action whose only visible input is a
  code. (§4)
- **Never delete a licensor or a property.** Merge and deactivate, yes. Delete, no. The FK is
  `ON DELETE RESTRICT` (`20260724030000:74-78`) and it should stay that way.
- **Never auto-resolve, auto-accept, or auto-promote anything.** No "apply all suggestions", no
  confidence threshold that acts on its own, no quarantine row that promotes itself. The screen may
  *suggest* and rank; only a human commits.
- **Never save a decision without evidence.** Blank evidence is rejected at the database, not just
  in the browser.
- **Never write directly to `core.property` from the browser.** `authenticated` must never hold
  `INSERT`/`UPDATE`/`DELETE` on `core.property`. Curation goes through the RPC or it does not happen.
- **Never silently overwrite a decision it did not make.** If the underlying row changed since the
  screen loaded it, the save is rejected with a plain-English message and a reload — optimistic
  concurrency, not last-write-wins.
- **Never edit an applied migration** to correct stale copy. Forward only.

### 3.6 The audit trail

Every decision writes an append-only audit row. The objects are already designed in
`docs/licensor-property-cloudsql-cutover-plan-20260806.md` Phase 3 Track 3A; this screen is the
`curator_ui` client of them. Restating what must be captured:

- **Who** decided (`decided_by`, plus `decided_by_uid` from `auth.uid()` — a name typed into a box is
  not an identity).
- **When.**
- **What changed** — the before and after value of the parent, status, or merge target.
- **The evidence given** — free text, `CHECK` non-blank. A decision with no stated reason is not
  accepted.
- **The channel** (`owner_ruling | curator_ui | migration_backfill | db_data_admin | out_of_band`).
- **A consequence list** — the `dam.asset` / `dam.style_guide` rows whose stored licensor/property
  pair no longer agrees after the move. **Warn and list; never auto-rewrite.**

**The trigger matters more than the RPC.** An unconditional trigger on `core.property` must write an
audit row whenever `licensor_id` changes, tagging anything that did not arrive through the RPC as
`out_of_band`. Without it, a `service_role` UPDATE leaves no trace — and `service_role` is currently
the only role that can write at all.

---

## 4. The description-decides rule (settled ruling, 2026-08-06)

**Albert's ruling, recorded as settled:**

> **A property's CODE is meaningless on its own. The DESCRIPTION decides the licensor.**
> *"A CC described as Coco is Disney; a CC described as Coca Cola is Coca Cola."*

This is not a preference about screen layout. It is a statement about what the data means, and it
drives the whole design:

1. **The code is not an identifier of a thing.** It is a label that is only unique within a
   division and a merch-group type. Two rows sharing `CC` are not two records of one property; they
   are two unrelated properties.
2. **Therefore the triage screen leads with the description**, and the description must be visible
   before any action can be taken. It is not behind a hover, a tooltip, or an expand chevron.
3. **Therefore the screen must never ask "which licensor does CC belong to?"** — a question with no
   correct answer. It asks *"which licensor does **Coco** belong to?"*, showing the description, the
   items, and the style guide.
4. **Therefore any suggestion the screen offers is ranked by descriptive and item evidence**, and
   labelled as a suggestion. A code match may be *displayed* as one weak signal among several. It
   may never be the sole basis of a suggestion, and never the basis of an automatic action.
5. **Therefore §5 is a defect, not a nuance.** Any code-only resolution path in the system is
   answering a question this ruling says has no answer.

Everything in §3.4 exists to serve this rule.

---

## 5. Why code-only matching is a live defect

**The claim:** in DesignFlow, **241 of 322 property codes (75%) sit under more than one licensor.**

> ### ⚠️ Verification status of the 241/322 figure
>
> **This agent could not reproduce or locate this figure anywhere in the shared-db repository.** It
> is not in `docs/dflow-parent-logic-and-curation-home-20260803.md`, not in
> `docs/parent-child-answers-20260803.md`, and not in the `docs/verification/` datasets. It is
> carried here **as supplied and unverified.**
>
> The direction of the finding is nonetheless independently supported: property codes are documented
> as unique only per division + merch-group type, and 2 cross-division edges already exist
> (`docs/dflow-parent-logic-and-curation-home-20260803.md:129`). Collisions are certain; the *rate*
> is what is unverified.
>
> **What closes it:** one `group by code having count(distinct parent_id) > 1` against
> `dflow."merchGroup"` where `mgTypeCode='06'` — a single read-only query, runnable on the same
> connection as the §1.2 re-count. **Run it before quoting 75% in front of anyone.** The requirement
> in this section does not depend on the exact rate; it depends only on the rate being greater
> than zero, which is already proven.

### 5.1 The two known offenders

**Offender 1 — `tools/validate-licensing-answers.mjs`.** Verified in this repository at lines 85-95:

```js
  const { rows: found } = await client.query(
    `select p.code, p.name, l.name as licensor
       from core.property p
       left join core.licensor l on l.id = p.licensor_id
      where p.code = any($1)`,
    [codes],
  );
  await client.end();

  const have = new Set(found.map((r) => r.code));
```

It matches on `p.code` alone with no licensor predicate, and it **selects the licensor name and then
never uses it** — `have` is a set of codes. The licensor is fetched, displayed in the report, and
discarded from the logic. A code under two licensors returns two rows that collapse into one set
entry, and the tool reports "found" without ever noticing which one it found.

**Offender 2 — the first lateral in `plm.import_item_master_data`.** Quoted verbatim from
production `pg_get_functiondef` at `docs/parent-child-answers-20260803.md:410-414`:

```sql
left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id,
  (array_agg(licensor_id order by id))[1] parent_id from core.property where code = b.merch_group_06) pc on true
```

`where code = b.merch_group_06`, unscoped. On a collision it takes `(array_agg(id order by id))[1]`
— **the lowest UUID wins.** Not the best match, not the most likely: an arbitrary one, stable enough
to look deliberate. A second lateral immediately below *is* licensor-scoped, which shows the author
knew scoping was needed and left the first path unscoped anyway.

**This document does not fix either one.** Both must be made licensor-scoped as a prerequisite (§6).

### 5.2 The danger — state it plainly

**Repairing the feed BEFORE fixing these two paths would introduce silent wrong-licensor binding.**

Today, code-only matching is mostly getting away with it: the shared database holds 26 licensors and
256 properties, so most collisions simply are not present to collide with. **The incompleteness that
is the problem is also the thing currently masking the defect.**

The moment 82 licensors and 614 properties land, every dormant collision becomes live. An item that
resolves by code alone will bind to whichever row happens to have the lowest UUID, and it will do so
**without an error, without a warning, and without a quarantine row.** The item will look correctly
classified. It will be filed under the wrong brand owner.

That is worse than today's problem. Today's problem is *missing data*, which is visible and
frustrating. That problem is *confidently wrong data*, which is invisible and is discovered months
later by a licensor.

**Prerequisite, not a follow-up:** every code-only resolution path is licensor-scoped, with a
regression test that fails if an unscoped `where code =` is reintroduced, **before** the feed is
repaired.

---

## 6. Ordering — where this slots into the cutover plan

Read against `docs/licensor-property-cloudsql-cutover-plan-20260806.md` (branch
`docs/licensor-property-cutover-plan-20260806`), which phases the whole programme.

### 6.1 ⚠️ THE ONE THING THAT MUST NOT BE GOT WRONG

> **The dead PLM sync is currently the ONLY thing protecting curated data from being overwritten.**
>
> `plm.import_master_data()` overwrites `licensor_id`, `status`, `name`, `code` and `confidence` on
> rows a human has curated. It has not run since 2026-07-08. **The system is safe today only because
> the feed is broken.**
>
> **Reviving ingestion before the overwrite paths are stopped would actively make things worse.** It
> would restart the destruction of curated data, at a larger volume, against a dataset that is about
> to receive a great deal of new curation. Every triage decision Albert makes would be at risk of
> being silently reverted by the next import.
>
> **The overwrite paths must be stopped BEFORE the feed is repaired. This is not negotiable and it
> is not a sequencing preference — it is the difference between this work helping and this work
> causing harm.**

### 6.2 The slot

| Cutover phase | What it is | This work |
|---|---|---|
| **Phase 1** — make production reachable | Fix the promotion lane | **Unchanged.** Hard prerequisite; nothing here can ship without it. |
| **Phase 2** — stop the shared copy destroying curated data | `licensor_id` INSERT-only, match scoping fixed, regression tests | **Hard prerequisite (§6.1).** Step 2.3 (match scoping) is where §5's offender 2 gets fixed. **Add offender 1 (`validate-licensing-answers.mjs`) to this phase** — it is not currently listed there. |
| **Phase 3** — build the curation path | Track 3A audit table + trigger + `set_property_licensor` RPC; Track 3B the orphan measurement; Track 3C the DB Data Admin UI | **This is the slot.** §3.6 is Track 3A's client. §3.4/§3.5 are the requirement for **Track 3C**, which the plan states as "Application work" but does not otherwise specify. This document is that specification. **Track 3B must run first** — the live orphan count gates §2.4. |
| **Phase 4** — correct the data | Fix the 9 wrong parents; the 7-step `FK`/`NA`/`ZG`/`FR` sequence | **Where the ingestion change lands.** The feed repair (§2) is a data-correction act and belongs here, **after** Phase 2 and after the triage screen exists to receive what arrives. Rulings in the 7-step sequence are FINAL after two reversals — do not re-litigate. |
| **Phase 5** — app-by-app cutover | | **Materially affected.** Phase 5.0 is a survey of what each app breaks on if the shared copy is *incomplete*. That survey must now also ask what each app breaks on if the copy is **complete but contains rows with no licensor** — a case no application has ever seen. |
| **Phase 6** — retire the old copy | | Unchanged. |

### 6.3 The ordering, as one sentence

**Fix the promotion lane → stop the overwrites and scope every code match → build the audit trail
and the triage screen → measure the live orphan count → Albert rules on §2.4 → *then*, and only
then, repair the feed.**

Any ordering that moves "repair the feed" earlier is wrong, and §6.1 says why.

---

## 7. Which repo owns which half

> ### ⚠️ Correction — the triage UI is **NOT** in the DesignFlow repos
>
> It is a natural assumption, because the screen is served from `data-dev.designflow.app`. **The
> hostname is misleading.** The DB Data Admin application lives **in `u2giants/shared-db`**, at
> `apps/db-data-admin/` — verified: `apps/db-data-admin/src/LicensorTree.tsx`,
> `PropertyTable.tsx`, `MergeDialog.tsx`, its own `Dockerfile`, `vite.config.ts` and Playwright
> suite are all in this repository. Its README (`apps/db-data-admin/README.md:1-11`) states it
> explicitly: production `https://data.designflow.app`, development
> `https://data-dev.designflow.app`, requirements in `DB_Data_Admin.md` at the shared-db root.
>
> **Building the triage screen in a DesignFlow repo would put it in the wrong application, on the
> wrong deploy path, against the wrong database client.** State this to whoever picks the work up.

| Half | Repo | Branch / process |
|---|---|---|
| **The triage screen** (§3) | **`u2giants/shared-db`**, `apps/db-data-admin/` | shared-db process: branch + PR, preview first, Claude merges. |
| **Any schema change** (§2.4 — nullable / holding licensor / quarantine table) | **`u2giants/shared-db`**, `supabase/migrations/` | shared-db process. **Authored here BEFORE any app code.** Never an app-repo migration, never a direct `ALTER` against the shared DB. |
| **The audit table, trigger and curation RPC** (§3.6) | **`u2giants/shared-db`** | shared-db process. Cutover plan Phase 3 Track 3A. |
| **The feed / ingestion change** (§2.1 steps 1-2, source side) | **DesignFlow repos (popcre org)** — `designflow-item-master`, `services/item_library.service.js` | dflow process: branch `sandbox-albert`, PR to `develop`, never `main`, never self-merged. |
| **The sync consumer** (`tools/sync-plm-master-data.mjs`) | **`u2giants/shared-db`** | shared-db process. Changes in the same window as the endpoint — it is a breaking contract change on both sides. |

**Summary: the only half that lives outside shared-db is the DesignFlow endpoint itself.** Everything
else — the screen, the schema, the audit trail, the sync consumer — is shared-db work.

---

## 8. Open questions for Albert

**Q1 — How should a property with no owner be stored?**
Three ways: let a property have no owner at all; park them all under a fake owner called something
like UNASSIGNED; or hold them in a separate holding area until you have sorted them. Each has a real
cost, laid out in §2.4. This blocks everything else, and it should be answered after we count how
many orphans there really are today.

**Q2 — Should we stop the data loss first, and decide the storage question after?**
The holding-area option can be built on its own, quickly, with no risk to anything that exists. It
would stop losing rows immediately and buy time to decide Q1 properly. Or we can wait and do it once.

**Q3 — What does "inactive" actually mean to you?**
Nearly every licensor in DesignFlow is flagged inactive, which strongly suggests the flag is just
neglected rather than meaningful. Should the triage screen treat inactive rows as a real queue to
work through, or just show the flag and otherwise ignore it?

**Q4 — When a licensor has no properties under it, what do you want to see?**
Are these real brand owners we simply have not filed anything under yet, or are they mostly
duplicates of a licensor that does have properties? Your answer decides whether that queue is a
merge tool or just a list.

**Q5 — Besides the description, the item numbers, the style guide and the division, what else do you
need on screen to make the call?**
Say it now. Adding a field to that screen later is much more expensive than adding it at the start,
and a screen missing the one thing you actually look at will not get used.

**Q6 — Who else, if anyone, may use this screen?**
Just you, or does anyone else get to reassign a property? The answer changes the permission design,
and permissions are much easier to set correctly at the start than to tighten later.

**Q7 — When a decision you make would leave other records disagreeing (an asset or a style guide
still pointing at the old pairing), do you want to see the list and fix them yourself, or should the
screen just warn you and move on?**
The design assumes warn-and-list, never fix-automatically. Confirm that is what you want.

---

## 9. What this document deliberately did NOT do

- **No database call of any kind.** No Supabase MCP, no psql, no Cloud SQL, no preview, no
  production. Every number is quoted from a repository document and attributed, or flagged as
  unverified.
- **No migration authored, and none proposed as a deliverable of this document.** §2.4 lists options
  and refuses to choose.
- **No code changed.** The two defects in §5 are specified as prerequisites and left untouched.
- **No 1Password read.** The credential items are referenced by ID only.
- **No push, no PR.** github.com is firewall-blocked from this machine. Committed locally only.
- **No existing file edited.** This document is the only file created.

---

## 10. What this ruling contradicts in existing documents

Recorded so nobody follows a superseded instruction:

| Location | What it says | Status under this ruling |
|---|---|---|
| `apps/db-data-admin/src/LicensorTree.tsx:152` | *"The relationship is DesignFlow-owned; do not repair it here."* | **CONTRADICTED.** Repairing it here is exactly the ruling. Copy must be removed with the triage screen. |
| Migration `20260722170000` | Lists "Licensor/Property" under **"Refused here"** | **CONTRADICTED.** Correct **forward** in a new migration; never edit an applied one. |
| `20260724030000_…phase1_mirror_schema.sql:71-72, 80-81` | `licensor_id` `NOT NULL`; comment states *"every Property has exactly one Licensor"* as settled | **UNDER REVIEW.** The premise (zero orphans) is false — there are 111. Whether the constraint survives is Albert's §2.4 call. |
| `20260621150815_app_core.sql:200` | `unique nulls not distinct (licensor_id, code)` | **NEWLY IN SCOPE.** Never previously considered in this programme; blocks both the nullable and the holding-licensor options as written. |
| `designflow-item-master/services/item_library.service.js` L71-138 | Three drops: inactive, unparented, childless | **CONTRADICTED — this is the ruling's direct target.** All three removed; payload shape changes with them. |
| `docs/licensor-property-cloudsql-cutover-plan-20260806.md` §8 Decision 3 | Frames the orphan question as sentinel vs nullable, recommends sentinel | **SUPERSEDED IN SCOPE.** Adds Option C (quarantine) and the unique-constraint complication. Re-ask with three options. |
| Same document, Phase 3 Track 3C | *"Application work, not shared-db."* | **HALF WRONG.** DB Data Admin **is** shared-db (`apps/db-data-admin/`). See §7. |
| Same document, Phase 5.0 survey scope | Asks what each app breaks on if the copy is **incomplete** | **INSUFFICIENT.** Must also ask what breaks on a **complete** copy containing rows with no licensor. |
| Any framing of 82/614/503/26/256 as *"measured live today against production"* | | **WRONG.** Frozen `dflow."merchGroup"` snapshot, 2026-05-07. See §1.2. |
| The citation *"`20260621150815_app_core.sql:200` is the NOT NULL"* | | **WRONG.** Line 200 is the unique constraint. The `NOT NULL` is `20260724030000:71-72`. |

---

## REQUEST QUEUE — summary block for the coordinator

*(For the coordinator to land in `COORDINATOR_INTAKE.md`. This agent does not own that file and did
not edit it.)*

**Request:** Licensor/Property triage page + stop-dropping-rows ingestion change
**Filed:** 2026-08-06
**Origin:** Owner ruling, Albert, 2026-08-06 (verbatim in §0 of this document)
**Document:** `docs/licensor-property-triage-page-requirement-20260806.md`
**Branch:** `docs/licensor-property-triage-page-20260806`
**Status:** Requirement written. **BLOCKED on Albert's decision (§2.4 / Q1) and on cutover Phases 1-2.**

**What is being asked for**
1. Ingest every licensor and property regardless of parent, activity or childlessness; flag broken
   rows instead of discarding them.
2. A triage screen in DB Data Admin (five queues) where Albert fixes what arrives broken.

**Blocking decision — Albert only**
How to store a property with no owner: (A) nullable FK, (B) holding licensor, (C) quarantine table.
Options and trade-offs in §2.4. **Overlaps and supersedes cutover-plan §8 Decision 3**, which knew
only A and B. **No migration may be authored until this is answered.**

**Hard prerequisites — must land BEFORE the feed is repaired**
- **P1.** Cutover Phase 1 (promotion lane reachable).
- **P2.** Cutover Phase 2 (`import_master_data` stops overwriting curated rows). ⚠️ **The dead sync
  is currently the only thing protecting curated data. Reviving ingestion first makes things
  actively worse.**
- **P3.** Every code-only resolution path licensor-scoped, with a regression test:
  `tools/validate-licensing-answers.mjs:85-95` and the first lateral in
  `plm.import_item_master_data` (`docs/parent-child-answers-20260803.md:410-414`). **Not currently
  on any phase list — needs adding to Phase 2.** Repairing the feed first causes **silent
  wrong-licensor binding** (§5.2).
- **P4.** Live orphan re-count against DesignFlow Cloud SQL (read-only account exists). The
  111/51 figures are from a **frozen 2026-05-07 snapshot**, not live.

**New verification task this document opens**
The claim *"241 of 322 property codes sit under more than one licensor (75%)"* **could not be found
anywhere in this repository.** Closed by one query:
`group by code having count(distinct parent_id) > 1` on `dflow."merchGroup"` where
`mgTypeCode='06'`. Direction of the finding is independently supported; the rate is unverified. **Do
not quote 75% until it is measured.**

**Repo ownership** (§7) — ⚠️ **DB Data Admin lives in `shared-db` at `apps/db-data-admin/`, not in
the DesignFlow repos, despite the `designflow.app` hostname.** Only the endpoint change
(`designflow-item-master`) is dflow work. Screen, schema, audit trail and sync consumer are all
shared-db.

**Corrections this document makes to briefs in circulation**
1. The `NOT NULL` is `20260724030000:71-72`, **not** `20260621150815_app_core.sql:200` (that line is
   `unique nulls not distinct (licensor_id, code)` — a **second, separate obstacle** not previously
   considered by anyone).
2. The counts are a **frozen 2026-05-07 snapshot**, not live production.
3. The triage UI is **shared-db work**, not DesignFlow work.

**Open questions for Albert:** seven, §8.
**Documents contradicted by this ruling:** nine, §10.
