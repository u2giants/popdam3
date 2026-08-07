# OPA as source of truth — revised design (supersedes the merged DESIGN.md)

**Status: READ-ONLY DESIGN REVISION. No migration was written. No database write
was made. Nothing under `supabase/` was touched.** This document is the input to
a future migration, not the migration itself.

**This document SUPERSEDES
[`../opa-characters-20260806/DESIGN.md`](../opa-characters-20260806/DESIGN.md)
(merged in PR #476).** That document is **not edited** by this work and remains
in the repository as the record of the earlier ruling. Where the two disagree,
**this one wins.** §2 lists every disagreement side by side.

**Author:** sub-agent dispatched by the shared-db coordinator (session
`774f5010`, machine `t16`, coordinator marker: GitHub issue #473).
**Branch:** `agent/opa-truth-20260807`, cut from `origin/main` at
`f9d1d3757a35fdaf837ba80245095d001bc481e4` (re-verified immediately before
commit; `origin/main` did not move during this run).
**Date:** 2026-08-07.

**Database target, proved before the first query.** `get_project_url` returned
`https://qsllyeztdwjgirsysgai.supabase.co`, so every measurement is against
Supabase project **`qsllyeztdwjgirsysgai` — PRODUCTION**. The Supabase MCP takes
no project argument and is bound to production; preview (`rjyboqwcdzcocqgmsyel`)
was **never contacted**. Every statement issued was a read-only `select` or
catalog query.

**Every row count here was measured with `count(*)`.**
`pg_stat_user_tables.n_live_tup` is stale on this database — it reports `0` for
tables holding thousands of rows — and was not used anywhere.

**If you read only one section, read [§8, Options for Albert](#8-options-for-albert-plain-english).**
It stands alone and needs nothing above it.

---

## The one-paragraph version

Albert ruled that OPA is Disney's own data and therefore our source of truth for
Disney. That ruling is followed here. But the ruling was made on a premise —
that Disney's data proves 609 characters belong to several *properties* at once,
which our schema cannot represent — and **that premise does not survive
measurement.** Of the 609, **561 are the same property written twice for
contract reasons** (`- No Likeness` / `- With Likeness`), and of the remaining
48, **42 are one block of Disney data-entry error.** The genuine residual is
about **6 characters out of 9,613 — 0.06%.** The existing single-parent
`core.character.property_id` therefore survives Disney's own data almost intact,
and the owner's 2026-07-23 ruling that it "stays a single FK and is correct"
does not need to be reversed. The junction table is still designed below,
because the coordinator directed it and because `core.character` is empty so it
costs nothing — but **Albert should know he probably does not need it.**

---

## A retracted claim you must NOT re-derive

An early revision of the OPA README argued that `dflow.properties_and_characters`
was a stale import of the OPA list **because the row counts were within ~1%**.
That was wrong and was retracted. **Row-count similarity is never evidence of
shared lineage.**

You will meet near-identical shapes again — `core.properties_and_characters`
(10,122) and `core.property_character_associations` (9,622) mirror the `dflow`
and `public` ones. **Do not restart that argument.**

**§3 of this document reaches a lineage-adjacent conclusion by a completely
different method** — an exact join on 178 independent Disney-issued integer keys
plus byte-identical names and MD5-identical child sets. That is a key join, not
a count comparison. §3.5 states plainly what it can and cannot prove.

---

## 1. What "source of truth" concretely means here — and its limits

Albert's ruling: *"OPA is from Disney directly, so it's the source of truth. We
will follow it."*

That is correct as a statement about **authority**. It is not, by itself, a
statement about **coverage**, and the difference is where the danger lives.

### 1.1 What this extract IS authoritative for

| Question | Authoritative? | Why |
| --- | --- | --- |
| How does Disney **spell** a character name? | **Yes** | It is Disney's own picker text |
| What is Disney's **ID** for a property or character? | **Yes** | Disney's own keys, verbatim |
| Which characters are **approvable under a given property**, for POP, for Home? | **Yes** | That is literally what the picker enforces |
| Does a property carry a **likeness split**? | **Yes** | Disney models it as two picker nodes |
| Is a character name we hold **recognised by Disney**? | **Yes, one-way** — see §1.2 | Presence proves recognition |

### 1.2 What it is NOT authoritative for — the asymmetry that matters

**Presence is proof. Absence is not.** If a name is in OPA, Disney recognises
it. If a name is *absent* from OPA, that proves nothing, because three separate
filters sit between Disney's catalogue and this file:

1. **One line of business.** The capture URL carries
   `lobName=Option.Lob.Home` / `lob=200`. Apparel, toys and every other line
   were never loaded. **Unverified** whether they expose a different set.
2. **One licensee's entitlements.** OPA shows a licensee only what its contracts
   allow. A different Disney licensee sees a different tree. This is **not**
   Disney's full catalogue.
3. **One point in time.** Captured 2026-08-06. There is no change feed, no API,
   no webhook. Disney adds and retires properties and we would not know.

### 1.3 The warning that matters most

> **Following this file literally, as a full replacement, would let a
> single-line-of-business, entitlement-scoped, point-in-time snapshot silently
> delete curated data that is perfectly correct.**

The concrete number: our curated Disney-family list holds **2,951** distinct
character identities. **208 of them do not appear in OPA** (§6). A literal
"Disney is truth, so remove what Disney does not list" rule would destroy those
208 rows. Measured, **147 of the 208 are the same character written in a
different order** (`Arnim Zola` vs OPA's `Zola, Arnim`) and are not
disagreements at all — they are formatting. Deleting them would be pure data
loss caused by a string-comparison bug.

**Therefore the safe reading of the ruling, and the one this design implements:**

> **OPA is authoritative for what it asserts, and silent about what it omits.**
> Disney's spelling wins over ours. Disney's presence adds. **Disney's absence
> never removes** — it only raises a question for a human.

This is an **additive and corrective** authority, not a **destructive** one.
Anything stronger needs Albert to say so explicitly, and §8 Option D puts that
choice in front of him honestly.

### 1.4 Scope note on licensors

Albert's ruling names **Disney**. OPA also serves **Marvel** and **Star Wars**
properties, which `core.licensor` files as *peer* licensors, and the ERP
(ColdLion) — POP's royalty system of record — treats all three as distinct in
both divisions. See
[`../disney-licensor-identity-20260807/README.md`](../disney-licensor-identity-20260807/README.md) §4.
**Nothing in this design stamps a licensor on OPA rows.** That question stays
open and stays Albert's.

---

## 2. Every place the merged DESIGN.md must change

Old ruling and new ruling, side by side. The merged document is **not edited**;
this table is the change record.

| # | Topic | Merged DESIGN.md said | **Now (Albert's ruling)** | Impact |
| ---: | --- | --- | --- | --- |
| 1 | **Join to `core.property`** | §0: *"**No FK to `core.property` in this first landing.** … Land it standalone. Reconciliation is separate, later work"* | **Reconciliation columns are part of the landing.** `plm.opa_property_character` carries nullable `property_id`, `resolution_status`, `resolution_reason`, `resolved_at`, `resolved_by`, plus `api.opa_property_reconciliation` | **This makes it a cross-app data contract.** See §2.1 |
| 2 | **Cross-app review** | Deferred with the join (§7.2 item 2) | **Triggered now.** PopCRM, DesignFlow, PopDAM and Poppim all read licensor/property data | Requires the AGENTS.md §4 contract review before apply |
| 3 | **Authority of the data** | Reference data. §7 framed OPA as an input to *compare* against | **Authoritative for Disney**, additive/corrective, never destructive (§1.3) | Changes what the view is *for*: it becomes a correction source, not a curiosity |
| 4 | **`core.character` feed** | §5: *"OPA cannot feed `core.character` in its current shape"*; §7.2 item 5 blocked it | **Unblocked.** The blocker was 609 multi-property characters; measured, the real residual is ~6 (§5) | The single scalar FK survives. No schema change to `core.character` needed |
| 5 | **Licensor stamping** | §2.3 Option B: store no licensor | **Unchanged — still Option B.** Albert's ruling is about authority, not about resolving `DY`/`MV`/`SW` | Explicitly reaffirmed, not overturned |
| 6 | **Object inventory** | 13 objects | **20 objects** (§7.1) — adds 5 resolution columns, 1 index, 1 reconciliation view | Coordinator's collision-check list is replaced by §7.1 |
| 7 | **The junction table** | Not designed (out of scope) | **Designed** (§5.4) as directed — **with a documented recommendation not to build it** (§5.5) | Delivered but flagged |
| 8 | **README §3 "roughly 670"** | DESIGN.md corrected it to **609** | **609 confirmed**, and further decomposed: 561 contract variants + 42 Disney error + ~6 genuine | Refines, does not contradict |
| 9 | **`option_source_id` check constraint** | `check (option_source_id = 1007)` | **Kept, unchanged.** Constant across all 10,262 rows; meaning unknown | No logic is built on it |
| 10 | **Negative sentinel IDs** | `bigint`, not constrained positive | **Kept, unchanged.** `Special Projects` = `-9999`/`-9998` | Confirmed against the CSV |

### 2.1 The cross-app consequence, stated plainly

Adding `property_id → core.property` to the OPA landing means **shared-catalogue
data now has a Disney-sourced opinion attached to it.** `core.property` is read
by PopCRM, DesignFlow, PopDAM and Poppim.

**What this design does to keep the blast radius at zero:**

- The FK lives on the **OPA mirror row**, never on `core.property`. **No
  existing table, column, constraint, policy or grant is altered.**
- `resolution_status` starts `'unresolved'` on every row. The landing migration
  **resolves nothing**; a later, separately-reviewed migration does that.
- No app reads `plm.opa_property_character` or `api.opa_property_reconciliation`
  until someone changes an app to do so.

**What review it triggers:** AGENTS.md §4 cross-app data-contract review, and
per §4 rule 1 (one schema change in flight) it must be **serialised** against the
ColdLion licensor/property cutover, which touches the same property spine.

---

## 3. Does OPA list *properties* or *style guides*? — the premise question

This is the single most consequential question in the document, because the
whole `core.character` problem depends on the answer. I raised it, the
coordinator correctly pushed back that my first conclusion over-reached the
evidence, and I ran the discriminating tests. **The tests went against my
initial reading.** Reported as they fell.

### 3.1 The finding that started it

`dflow.properties_and_characters` rows typed `PROPERTY` are **style guides** —
`docs/style-guides-characters-and-royalties.md` §5 says so explicitly and warns
the column name lies. For Disney (`licensor_id` 1) and Marvel (3), **178** carry
a numeric `source_licensed_property_id`.

| Test | Result |
| --- | ---: |
| Those 178 IDs found in OPA as `licensedPropertyID` | **178 / 178 (100%)** |
| …with a **byte-identical** property name | **178 / 178 (100%)** |
| Style guides whose **character-ID set is MD5-identical** to OPA's | **168 / 178** |
| Style guides where dflow has **more** characters than OPA | **0** |
| Total character rows: dflow vs OPA, same 178 | 4,921 vs **4,967** |

Examples: `92` → `101 Dalmatians`; `1159115273` → `Marvel Studios: The Infinity
Saga - No Likeness`. Independently re-verified by the coordinator against the CSV.

**This is an exact-key join on 178 Disney-issued integers plus name and child-set
equality. It is not the retracted row-count argument.**

### 3.2 Test 1 — cardinality. Goes AGAINST the style-guide reading.

If OPA nodes were style guides, one property could map to many. Measured:

| Measurement | Value |
| --- | ---: |
| dflow style-guide rows (Disney+Marvel, numeric id) | 178 |
| Distinct `source_licensed_property_id` among them | **178** |
| Distinct style-guide names | **178** |
| OPA IDs mapping to **more than one** dflow style guide | **0** |
| dflow style guides mapping to more than one OPA ID | **0** |

**Strictly 1:1, with no exceptions.** `public.properties` under Disney (124) and
Marvel (54) totals **178** as well, all with numeric `external_id` — the same set
again.

**Honest caveat:** 1:1 is what *both* readings predict. If DesignFlow imported
one row per OPA node, 1:1 arises by construction. **This test does not
discriminate; it only removes support for my reading.**

### 3.3 Test 2 — variant families. Also goes AGAINST it.

If OPA were style-guide-grained, many names should be variants of fewer base
properties. Stripping `- No Likeness` / `- With Likeness` / `- Without Likeness`
/ `- Individual Characters`:

| Measurement | Value |
| --- | ---: |
| Distinct OPA property names | 1,444 |
| Distinct **base** names after stripping qualifiers | **1,354** |
| Base names with more than one variant | **90** |
| Property names absorbed into a multi-variant base | **180** |

Trailing qualifiers across all 1,444 names: `With Likeness` 71, `No Likeness`
67, `Individual Characters` 18, `Do Not Use` 10, `Discontinued as of 1-Aug-12`
8, `DNU` 6, `TV Series` 4 — then a long tail of one-offs that are genuine title
distinctions (`Magic English`, `Animated (China)`, `Live Action (China)`).

**1,444 collapses only to 1,354 — a 6% reduction.** The overwhelming majority of
OPA names are distinct titles, not variants. **This is real evidence against the
style-guide reading and I accept it.**

### 3.4 Test 3 — coverage. Cuts against it hardest.

We matched 178. OPA has 1,445. **What are the other 1,267?**

| | Matched (178) | **Unmatched (1,267)** |
| --- | ---: | ---: |
| Character rows | 4,967 | **5,295** |
| Properties with exactly **1** character | 78 | **894** |
| 2–5 characters | 22 | 153 |
| 6–20 | 45 | 179 |
| >20 | 33 | 41 |

**894 of the 1,267 have a single character, and 752 of those have one character
named identically to the property** — a placeholder so the picker has something
selectable.

The names are decisive. A sample of the unmatched: `10 Things I Hate About You`,
`24`, `28 Days Later`, `ABC News`, `ABC Sports`, `AVP`, `AD Astra (2019)`,
`Abyss, The`, `21CF Home`, `21CF Kitchen`,
`20thCFS LAMP - Kingdom of the Planet of the Apes`.

**These are 20th Century Fox / ABC titles** — Disney acquired Fox in 2019. They
are unmistakably **properties POP has never designed against**, not style guides.

**This is the strongest single piece of evidence, and it points away from my
reading.** The unmatched bulk is Disney's licensable *title* catalogue.

### 3.5 Test 4 — direction of flow. Stated with its limits.

Every one of 25 probe character-IDs taken from dflow's 10 differing style guides
exists in OPA. OPA's max `characterID` (1,159,383,366) exceeds every dflow value
sampled. Combined with dflow never exceeding OPA on any of the 178, OPA is a
**superset** in everything measured.

**What this can prove:** OPA's snapshot is at least as new as, and contains
everything in, the DesignFlow Disney/Marvel data sampled.

**What it CANNOT prove, and I will not claim:** that OPA is the *upstream* of
DesignFlow. A newer snapshot of a **shared Disney feed** fits the evidence
identically. Disney could serve both the portal and a licensing-system export
from one master. **I cannot distinguish those two, and the distinction does not
change any recommendation below.**

### 3.6 The honest verdict

> **The evidence does not support "OPA's property is a style guide." I was
> wrong, and the coordinator was right to force the test.**
>
> The supported reading is: **OPA nodes are Disney's licensable property
> catalogue, at contract granularity.** Mostly one node per title (1,354 base
> names), with a minority split by contract terms — the likeness split (138
> names) and `- Individual Characters` (18). Our 178 style guides were built
> one-per-OPA-node for the subset POP designs against, which is why they align
> perfectly.

**The residue of truth in my original reading:** the likeness split really is
style-guide-shaped. `docs/style-guides-characters-and-royalties.md` §2.2 records
the owner's rule that **talent likeness is a property of a style guide asset,
not of a character or a property** — yet Disney models it as two *property*
nodes. So OPA's grain is genuinely a hybrid: mostly title, sometimes contract
variant. **That is the real answer, and it is why §8 asks Albert directly.**

---

## 4. How OPA properties reconcile to `core.property` — measured

### 4.1 The measurement

`core.property` holds **256** rows. Under the Disney-family licensors:

| Licensor | `core.property` rows | Character of the names |
| --- | ---: | --- |
| `DY` DISNEY | **39** | `ALADDIN`, `CARS`, `CLASSIC PROPERTIES`, **`MOVIE POSTER`**, **`POSTER VERBIAGE`**, **`SPELLS`**, `CHARACTER GROUP` |
| `MV` MARVEL | **29** | `AVENGERS GROUP`, `GAMERVERSE`, `MARVEL ASSORTED STYLES`, `SPIDER MAN` |
| `SW` STAR WARS | **28** | `BB-8`, `DARTH VADER`, `TIE FIGHTER`, `XWING`, `YODA` |

### 4.2 Low overlap is EXPECTED and is not an error

This was already established in
[`../disney-licensor-identity-20260807/README.md`](../disney-licensor-identity-20260807/README.md)
and is confirmed here.

**`core.property` under `DY` is POP's internal product/design taxonomy, not
Disney's property list.** `MOVIE POSTER`, `POSTER VERBIAGE` and `SPELLS` are not
Disney properties in any sense — they are POP's own grouping buckets. Under
`SW`, the rows are not properties at all but **characters and vehicles**
(`YODA`, `TIE FIGHTER`, `XWING`) filed at property level.

Per `docs/style-guides-characters-and-royalties.md` §5A.2, this is deliberate:
**the canonical property list mirrors ColdLion — what POP produces or holds a
code for.** Being licensed for a title is explicitly *not* enough to make it a
property, classics collapse into the `CP` bucket, and no-code titles
(Luca, Kim Possible, Inside Out) are excluded on purpose.

> **Therefore: OPA's 1,445 and `core.property`'s 96 Disney-family rows are
> answering different questions. A low match rate confirms both are working
> correctly. It is NOT a data-quality finding and must not be reported as one.**

### 4.3 Where the real match lives

The **178** exact-ID matches of §3.1 are the reconciliation that actually
exists, and they land on `public.properties` (PopDAM's style-guide taxonomy) and
`dflow.properties_and_characters`, **not** on `core.property`.

| Reconciliation target | Rule | Matches |
| --- | --- | ---: |
| `public.properties` / `dflow` style guides | **Disney ID = `external_id`** (exact integer) | **178 / 178** |
| `core.property` Disney-family | name match | **near zero, correctly** |

### 4.4 What this design proposes, and what needs a ruling

**Proposed:** land `property_id` **nullable**, `resolution_status` defaulting to
`'unresolved'`, and **resolve nothing in the landing migration.** Follow the
`plm.erp_property` precedent exactly: resolution is recorded on the mirror row
and **never mutates a canonical row.**

**Needs an owner ruling before any resolution runs:**

1. **Does OPA get to add properties to `core.property`?** §5A.2 says the list
   mirrors ColdLion. OPA is not ColdLion. Following Disney literally would add
   ~1,267 properties POP has never produced against, contradicting a decided
   ruling. **Recommend: no. Reconcile only, never create.**
2. **Which side of the likeness split maps to a property?** Both, presumably —
   but that is a claim about our model, not Disney's.
3. **Which licensor?** Unchanged and still open (§1.4).

---

## 5. The `core.character` problem — and why it is much smaller than it looked

### 5.1 The stated problem

`core.character.property_id` is a **single scalar FK**. The brief states OPA
proves **609** characters legitimately belong to several properties under the
same Disney ID, so the schema cannot represent Disney's truth.

**Measured, that is not what the 609 are.**

### 5.2 The decomposition — the key measurement in this document

Starting from 609 `characterID` values appearing under more than one
`licensedPropertyID`, and collapsing property names that differ only by a
**contract qualifier** (`- No Likeness`, `- With Likeness`, `- Without
Likeness`, `- Individual Characters`, `- Discontinued as of …`, `- Do Not Use`,
`- DNU`):

| Layer | Count | What it actually is |
| --- | ---: | --- |
| `characterID` under >1 `licensedPropertyID` | **609** | the headline number |
| …collapsing to **one** base property | **561** | **not multi-property at all** — one property, two contract nodes |
| **Residual** genuinely spanning different base properties | **48** | 0.5% of 9,613 identities |
| …of which one Disney data-entry block | **42** | see §5.3 |
| …resolvable by the character name's own `( property )` suffix | **6** | |
| **Genuinely, irreducibly multi-property** | **≈ 6** | **0.06% of 9,613** |

> **The premise behind the ruling does not hold. Disney's own data does not show
> characters owned by many properties. It shows one property written twice for
> contract reasons, 92% of the time.**

`Iron Man ( Iron Man 2 Movie )` appearing under both `Iron Man 2 Movie - No
Likeness - Discontinued as of 1-Aug-12` and `Iron Man 2 Movie - With Likeness`
is **one character in one property**, licensed two ways. Treating that as
multi-property ownership would be the §6 Error 3 of
`docs/style-guides-characters-and-royalties.md` repeated exactly — chaining the
style axis into the ownership axis.

### 5.3 The 42 — a Disney-side defect, not a modelling truth

`Morbius Movie 2020 - No Likeness` holds **32** characters. **30 of them are
named `( MS Disney Plus TV Shows )`** — `Captain America`, `Baron Zemo`,
`Bishop, Kate`, `Falcon`, `Gamora, Daughter of Thanos`. Exactly **one** is named
for Morbius. **31 of the 32 also appear under another property.**

A block of Disney+ TV characters is mis-filed under the Morbius property **in
Disney's own portal.** This is a defect in the source, and it is a concrete
counter-example to "Disney is always right".

> **This alone justifies the §1.3 rule: additive and corrective, never
> destructive. Following OPA literally would import a known Disney error.**

### 5.4 The options, as directed — NOT chosen

This is an owner gate. Presented, not decided.

| Option | What it is | Cost | What it breaks |
| --- | --- | --- | --- |
| **A. Keep the scalar FK, resolve variants to one base property** | Collapse contract variants; ~6 exceptions get a curated parent | **Lowest.** No schema change. `core.character` is 0 rows so there is nothing to migrate | Nothing. Preserves the owner's 2026-07-23 ruling |
| **B. Add `core.property_character` bridge** (as directed, §7.2) | M:N between property and character | Moderate. New table, new contract | **Contradicts the 2026-07-23 owner ruling** that axis 1 is linear. Risks duplicating `core.style_guide_character` (§5.5) |
| **C. Keep the scalar and pick a primary** | Same as A but keep every edge somewhere | Moderate | "Primary" is our invention; Disney supplies no such flag |
| **D. Change `property_id` to an array or drop the FK** | Widen the column | High | Breaks referential integrity and every consumer. **Explicitly forbidden by §5A** |

**Recommended: A.** It matches the measurement, costs nothing (`core.character`
is empty), and keeps a ruling Albert already made. **Not chosen here.**

### 5.5 Cross-check against the two-axis model, as directed

`docs/style-guides-characters-and-royalties.md` §5A already specifies
`core.style_guide_character (style_guide_id, character_id)` as the M:N bridge —
the intended home for the 9,622 legacy rows.

**Is the directed junction the same shape or a different one?**

| | `core.style_guide_character` (specified) | `core.property_character` (directed, §7.2) |
| --- | --- | --- |
| Axis | **2 — style** (M:N by design) | **1 — ownership** (linear by ruling) |
| Left endpoint | `core.style_guide` | `core.property` |
| Populated from | the 9,622 legacy appearance rows | OPA's 10,262 pairs |
| Justified by | owner ruling, 2026-07-23 | Albert's 2026-08-07 ruling |

**They are genuinely different tables.** But note what happens with real data:
our 178 style guides are **1:1 with 178 OPA property nodes** (§3.2). So for the
Disney data we actually hold, **`core.property_character` and
`core.style_guide_character` would contain the same edges under two different
left-hand keys.**

> **That is the duplication risk, stated plainly: build both and you have two
> tables asserting the same 4,967 Disney facts, which will drift apart the first
> time somebody updates one.** Albert needs to know this before choosing.

**`core.character` is 0 rows**, so building either costs almost nothing today
and is defensible under either reading. The cost is not the build — **it is
owning two overlapping contracts forever.**

---

## 6. What happens to the existing character work

### 6.1 Verification of the prior review's numbers — they hold exactly

Re-measured against `canonical-character-identities.csv` and the OPA CSV,
normalising by stripping the trailing ` ( … )` suffix, collapsing whitespace,
mapping backtick → apostrophe, and lower-casing.

| Measurement | Prior review | **My measurement** | Verdict |
| --- | ---: | ---: | --- |
| Canonical Disney-family (`licensorId` 1+3) distinct names | 2,951 | **2,951** | ✅ |
| Found in OPA | 2,743 (93.0%) | **2,743 (93.0%)** | ✅ |
| Misses | 208 | **208** | ✅ |
| **Pure surname-order differences** | 147 | **147** | ✅ **confirmed exactly** |
| **Real misses** | 61 | **61** | ✅ **confirmed exactly** |

Further decomposition of the 61: **3** have a ≥0.92 fuzzy match in OPA
(near-miss spelling), leaving **58 hard misses**.

Related counts, measured: **668** distinct OPA base names use `Lastname,
Firstname` (the merged doc said 663 — same phenomenon, minor normalisation
difference). **637 rows / 569 distinct names contain a backtick** where an
apostrophe belongs (the merged doc said 250 base names; my figure counts raw
names before suffix stripping). **OPA distinct normalised base names: 6,564.**

### 6.2 What following Disney would actually overwrite — quantified

| Bucket | Count | What "following Disney" does | Risk |
| --- | ---: | --- | --- |
| Names matching OPA exactly | **2,743** | nothing changes | none |
| **Surname-order differences** | **147** | rewrites `Arnim Zola` → `Zola, Arnim` | **Cosmetic but wide.** Breaks any UI sorted by first name, and any hard-coded string |
| Near-miss spellings | **3** | corrects a genuine typo | low, good |
| **Hard misses** | **58** | **would DELETE if absence meant removal** | **This is the real exposure** |

**The 58 are not all Disney's problem.** Inspecting them:

- `agony (symbiote` — **our** value has an unclosed parenthesis. A defect on our
  side that OPA exposes.
- `baxter building` — a **location**, not a character.
- `cars 2 - mustangerberger lizzie sherif london police ford - alone` — a
  corrupted concatenation on our side.
- `doofus - do not use` — carries its own retirement marker.
- `aladdin - w smith` — an actor-likeness note, not a character name.
- `belova, yelena` — **already in OPA's surname form**, so this is a
  normalisation artefact of my own comparison, not a real miss.

> **So OPA is not mainly disagreeing with us. It is mainly exposing defects in
> our own curated data — which is exactly what a source of truth is for.**

**The number Albert needs: following Disney destructively would delete 58 rows,
of which several are known-bad on our side and none has been individually
reviewed.** Following it additively deletes nothing and still fixes the 3 typos
and flags all 58.

### 6.3 Which of Laura's open questions OPA now answers

`licensing-questions-for-laura-20260729.csv` and the round-2 workbook.

| Question type | Answered by OPA? | Evidence |
| --- | --- | --- |
| **Canonical spelling of a Disney/Marvel character** | **Yes, outright** | Disney's own picker text, 6,564 base names |
| **Does character X exist under property Y?** | **Yes, for Home** | that is what the picker enforces |
| **Dual-code rows — which universe owns the character?** | **Corroborated** | Laura's round-2 answer was `NONE` on all 11 because *"the character appears on both universes."* OPA agrees: the same `characterID` recurs, never two IDs |
| **Which property does a style guide belong to?** | **No** | OPA has no style-guide concept (§3.6) |
| **Talent-likeness royalty flag** | **No** | Disney splits properties by likeness but exposes no rate |
| **Royalty rates** | **No** | not in the portal |

**The royalty question stays open.** `docs/style-guides-characters-and-royalties.md`
§2.1: Marvel charges **+2% for talent likeness** and is the **only** licensor
that does. OPA confirms Disney *models* the split (138 property names) but
supplies **no rate**. ColdLion remains the royalty source of record. **OPA does
not answer it and must not be presented as doing so.**

### 6.4 `public.characters` — 9,622 appearance rows

Unchanged from the merged design and re-confirmed: 9,622 rows, 8,370 distinct
names, 3,973 with a parenthesised suffix. These are **appearances**, not
characters. `core.character` is **0 rows**.

Suffix convention is inconsistent on both sides — **61% of OPA base names carry a
`( … )` suffix (5,916 of 9,613 identities) versus 41% of ours.** Any matching
built on the suffix fails on roughly half the data in each direction. This
confirms and extends PR #468's hazard; **it does not resolve it.**

---

## 7. The revised, executable design

**This is not a migration and must not be applied as one. It has never been
executed anywhere.**

### 7.1 Object inventory — the coordinator's collision-check declaration

Exhaustive and schema-qualified. **Replaces** merged DESIGN.md §3.1.

| # | Object | Kind |
| ---: | --- | --- |
| 1 | `plm.opa_property_character` | table |
| 2 | `plm.opa_property_character_pkey` | primary key constraint (on 1) |
| 3 | `plm.opa_property_character_property_name_chk` | check constraint (on 1) |
| 4 | `plm.opa_property_character_character_name_chk` | check constraint (on 1) |
| 5 | `plm.opa_property_character_option_source_chk` | check constraint (on 1) |
| 6 | `plm.opa_property_character_lob_chk` | check constraint (on 1) |
| 7 | `plm.opa_property_character_resolution_status_chk` | check constraint (on 1) — **new** |
| 8 | `plm.opa_property_character_property_id_fkey` | FK → `core.property(id)` — **new** |
| 9 | `idx_opa_property_character_property_name` | index (on 1) |
| 10 | `idx_opa_property_character_character_name` | index (on 1) |
| 11 | `idx_opa_property_character_character_id` | index (on 1) |
| 12 | `idx_opa_property_character_licensed_property_id` | index (on 1) — **new** |
| 13 | `idx_opa_property_character_base_property_name` | index (on 1) |
| 14 | `idx_opa_property_character_property_id` | index (on 1) — **new** |
| 15 | `idx_opa_property_character_resolution_status` | index (on 1) — **new** |
| 16 | `opa_property_character_read` | RLS policy (on 1) |
| 17 | `api.opa_property_character` | view |
| 18 | `api.opa_property_reconciliation` | view — **new** |

**No other object is created, altered, or dropped.** In particular: **nothing in
`core.*` is touched**, `core.property` and `core.character` are not modified,
`core.character` is not populated, and no existing table, view, policy, grant or
constraint is changed. The FK (#8) is declared **on the new table**, pointing
outward.

**Suggested filename:**
`supabase/migrations/20260807HHMMSS_opa_property_character_landing.sql`.
The highest migration on `origin/main` at the time of writing is
`20260807030000_owner_ruling_coco_is_a_disney_license.sql`. **Re-derive the
maximum at the moment the migration is authored** — it goes stale within the
hour.

**Server timezone is `America/New_York`.** `captured_at` is a `date` and is
stamped explicitly, never derived from `now()`.

### 7.2 The junction table, as directed — and the recommendation against it

Directed by the coordinator; delivered here as a **separate, optional object
list**, deliberately kept out of §7.1 so the landing can ship without it.

| # | Object | Kind |
| ---: | --- | --- |
| J1 | `core.property_character` | table |
| J2 | `core.property_character_pkey` | primary key `(property_id, character_id)` |
| J3 | `core.property_character_property_id_fkey` | FK → `core.property(id)` |
| J4 | `core.property_character_character_id_fkey` | FK → `core.character(id)` |
| J5 | `idx_property_character_character_id` | index |
| J6 | `core_property_character_read` | RLS policy |

```sql
-- OPTIONAL. See section 5.5 before building this.
-- Axis 1 (ownership) is LINEAR by owner ruling 2026-07-23. This table widens it
-- to many-to-many. Measured, Disney's own data needs that for ~6 characters out
-- of 9,613 (0.06%). Building it also risks duplicating core.style_guide_character.
create table core.property_character (
  property_id  uuid not null references core.property(id)  on delete restrict,
  character_id uuid not null references core.character(id) on delete cascade,
  is_primary   boolean     not null default false,
  source       text        not null default 'opa',
  created_at   timestamptz not null default now(),
  constraint core_property_character_pkey primary key (property_id, character_id)
);

create index idx_property_character_character_id
  on core.property_character (character_id);

alter table core.property_character enable row level security;
create policy core_property_character_read on core.property_character
  for select to authenticated using (true);
grant select on core.property_character to authenticated;
grant select, insert, update, delete on core.property_character to service_role;
revoke all on core.property_character from anon;
```

> **Recommendation: do not build this yet.** `core.character` is 0 rows, so
> nothing needs it today, and §5.2 shows the problem it solves is ~6 characters.
> Build it only if Albert rules that Disney's contract-variant nodes are separate
> properties. **This is §8's question 1.**

### 7.3 DDL — the raw table

```sql
-- ---------------------------------------------------------------------------
-- Raw vendor landing: Disney OPA (Online Product Approval) property->character
-- picker, Home line of business, captured 2026-08-06.
--
-- This is a SOURCE table. Disney's strings are stored EXACTLY as OPA supplies
-- them. Nothing is normalised, split, trimmed or corrected here. Our
-- interpretation lives in api.opa_property_character, never in this table.
--
-- Pattern follows plm.erp_licensor / plm.erp_property exactly: raw typed mirror
-- in plm, read-only consumable view in api, nullable resolution columns on the
-- mirror row. There is NO `coldlion` schema; anyone looking for one will find
-- nothing. Resolution is recorded HERE and NEVER mutates a canonical row.
-- ---------------------------------------------------------------------------

create table plm.opa_property_character (
  -- Disney's identity. The natural key. The NAME pair is NOT unique
  -- (10,240 distinct pairs across 10,262 rows = 22 real collisions);
  -- the ID pair IS unique at exactly 10,262.
  licensed_property_id  bigint not null,
  character_id          bigint not null,

  -- Disney's strings, byte-for-byte as extracted. Do not normalise.
  property_name         text   not null,
  character_name        text   not null,

  -- Further Disney IDs, preserved but not interpreted.
  brand_property_id     bigint not null,
  option_source_id      bigint not null,

  -- Provenance. Every row carries its own scope caveat by design.
  captured_at           date   not null,
  source_url            text   not null,
  line_of_business      text   not null default 'Home',
  entitlement_scope     text   not null
    default 'POP Creations licensee entitlement only; NOT Disney''s full catalogue',

  -- Reconciliation, per Albert's 2026-08-07 ruling. ALL NULL/unresolved at
  -- landing. The landing migration resolves NOTHING.
  property_id           uuid        null references core.property(id) on delete restrict,
  resolution_status     text   not null default 'unresolved',
  resolution_reason     text        null,
  resolved_at           timestamptz null,
  resolved_by           text        null,

  -- Mirror convention, matching plm.erp_licensor / plm.erp_property.
  raw                   jsonb  not null,
  source_hash           text   not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  imported_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint opa_property_character_pkey
    primary key (licensed_property_id, character_id),

  constraint opa_property_character_property_name_chk
    check (btrim(property_name) <> ''),
  constraint opa_property_character_character_name_chk
    check (btrim(character_name) <> ''),

  -- option_source_id was 1007 on all 10,262 rows. Its meaning is UNKNOWN.
  -- Pinned so a future extract carrying a different value fails LOUDLY rather
  -- than landing silently under an assumption nobody has verified.
  constraint opa_property_character_option_source_chk
    check (option_source_id = 1007),

  constraint opa_property_character_lob_chk
    check (line_of_business = 'Home'),

  constraint opa_property_character_resolution_status_chk
    check (resolution_status in
      ('unresolved','matched','ambiguous','no_match','rejected'))
);
```

> **IDs are `bigint` and are deliberately NOT constrained positive.** The row
> `Special Projects` carries `licensedPropertyID = -9999`,
> `characterID = -9998`, `brandPropertyID = -9999`. These are Disney sentinels,
> not corrupt data. Any unsigned or `text`-with-digit-check typing rejects them.

```sql
comment on table plm.opa_property_character is
  'RAW Disney OPA (opa.disney.com) property->character picker extract. '
  'SCOPE WARNING: Home line of business ONLY (lobName=Option.Lob.Home), and '
  'ONLY the properties POP Creations'' licensee account is entitled to see. '
  'This is NOT all of Disney and NOT all lines of business. Point-in-time '
  'snapshot, no change feed; refresh is a full manual re-extract requiring '
  'Albert to complete MFA in his own browser. AUTHORITY (owner ruling '
  '2026-08-07): authoritative for what it ASSERTS, SILENT about what it OMITS. '
  'Presence adds and corrects; ABSENCE NEVER REMOVES. Disney''s strings are '
  'stored verbatim; interpretation belongs in api.opa_property_character. '
  'Business-confidential Disney data under a commercial licensing relationship '
  '- do not publish, do not send to any third-party service.';

comment on column plm.opa_property_character.option_source_id is
  'Disney''s optionSourceID. Was 1007 on ALL 10,262 rows of the 2026-08-06 '
  'extract. Its meaning is NOT understood. DO NOT BUILD LOGIC ON THIS COLUMN.';

comment on column plm.opa_property_character.property_name is
  'Disney''s exact property display name, verbatim. NOT unique: 1,444 distinct '
  'names across 1,445 distinct licensed_property_id values ("Davy Crockett" is '
  'both 216 and 425). 138 names carry a likeness contract split and 18 carry '
  '"- Individual Characters"; collapsing those qualifiers yields 1,354 base '
  'names. Disney also writes many character names surname-first ("Watson, '
  'Anna") and uses a BACKTICK (`) where an apostrophe is expected. Matching '
  'code must handle both.';

comment on column plm.opa_property_character.character_id is
  'Disney''s characterID. A STABLE character identity: 9,613 distinct values, '
  'never mapping to more than one name. 609 recur across property nodes, but '
  'MEASURED, 561 of those are the SAME property written twice for contract '
  'reasons and 42 more are one Disney data-entry error (see README section 5). '
  'The genuine multi-property residual is about 6. Do NOT conclude from the '
  '609 that ownership is many-to-many.';

comment on column plm.opa_property_character.property_id is
  'Nullable reconciliation to core.property, per owner ruling 2026-08-07. '
  'NULL and unresolved at landing. Resolution is recorded on THIS row and must '
  'NEVER mutate a core.property row. Expect a LOW match rate: core.property '
  'under DY is POP''s internal design taxonomy (MOVIE POSTER, SPELLS, POSTER '
  'VERBIAGE) while OPA carries Disney''s real property names. Low overlap is '
  'CORRECT and is not a data-quality finding.';

-- Lookup paths. None of these is unique.
create index idx_opa_property_character_property_name
  on plm.opa_property_character (property_name);
create index idx_opa_property_character_character_name
  on plm.opa_property_character (character_name);
create index idx_opa_property_character_character_id
  on plm.opa_property_character (character_id);
create index idx_opa_property_character_licensed_property_id
  on plm.opa_property_character (licensed_property_id);
create index idx_opa_property_character_property_id
  on plm.opa_property_character (property_id) where property_id is not null;
create index idx_opa_property_character_resolution_status
  on plm.opa_property_character (resolution_status);

-- Supports the view's base-name lookup without recomputing the split.
create index idx_opa_property_character_base_property_name
  on plm.opa_property_character (
    btrim(regexp_replace(property_name,
      '\s*-\s*(No|With|Without)\s+Likeness\s*$', '', 'i'))
  );

-- Posture matches plm.erp_property / plm.erp_licensor exactly, measured
-- 2026-08-07: RLS on, exactly one read policy, select to authenticated,
-- full rights to service_role, NOTHING to anon.
alter table plm.opa_property_character enable row level security;

create policy opa_property_character_read
  on plm.opa_property_character
  for select to authenticated using (true);

grant select on plm.opa_property_character to authenticated;
grant select, insert, update, delete on plm.opa_property_character to service_role;
revoke all on plm.opa_property_character from anon;
```

### 7.4 The privilege guard — the null-permissive trap

If the migration guards that the loader has sufficient privilege, **it must
require a non-null role AND a positive match.** This shape is forbidden:

```sql
-- WRONG. Never fires. Do not use this shape.
if not ( current_user = 'postgres' or auth.role() = 'service_role' ) then
  raise exception 'insufficient privilege';
end if;
```

Inside a migration `auth.role()` is **NULL**. `NULL = 'service_role'` is `NULL`,
`false or NULL` is `NULL`, and `if not NULL then` never runs the body. **The
guard silently passes for everyone, forever.** Correct shape:

```sql
do $$
declare
  v_role text := coalesce(auth.role(), '');
  v_user text := coalesce(current_user, '');
begin
  -- Require a NON-NULL role AND a positive match. Never `not (... or ...)`.
  if not (v_role = 'service_role' or v_user in ('postgres', 'supabase_admin')) then
    raise exception
      using message = format(
        'OPA landing refused: effective role %L / user %L is not permitted to '
        'load plm.opa_property_character. Run this migration through the '
        'shared-db apply workflow.', v_role, v_user),
      errcode = 'P0001';
  end if;
  raise notice 'OPA landing privilege check OK (user=%).', v_user;
end $$;
```

**No null-permissive guard appears anywhere in this design.** The same principle
covers the `option_source_id = 1007` constraint: it exists so a **future**
extract that disagrees **fails loudly**. If a later extract legitimately carries
a different value, widen it in a new migration with a recorded reason — do not
drop it.

### 7.5 DDL — the consumable view

```sql
-- ---------------------------------------------------------------------------
-- Consumable view over the raw OPA landing.
--
-- EVERY derived column below is OUR INTERPRETATION, not Disney's. Disney
-- supplies ONE string per property node. The base-name/likeness split is
-- inferred by us. Where the inference is not clean, likeness_parse_confident
-- is false and callers MUST fall back to property_name.
-- ---------------------------------------------------------------------------

create view api.opa_property_character
with (security_invoker = true) as
select
  -- Disney's own values, verbatim. Trust these.
  o.licensed_property_id,
  o.character_id,
  o.brand_property_id,
  o.property_name,
  o.character_name,

  -- OUR INTERPRETATION from here down. -------------------------------------
  btrim(regexp_replace(o.property_name,
    '\s*-\s*(No|With|Without)\s+Likeness\s*$', '', 'i'))
    as base_property_name_interpreted,

  case
    when o.property_name ~* '-\s*With\s+Likeness\s*$'         then 'with'
    when o.property_name ~* '-\s*(No|Without)\s+Likeness\s*$' then 'without'
    when o.property_name ~* 'Likeness'                        then 'unparsed'
    else null
  end as likeness_interpreted,

  (o.property_name !~* 'Likeness'
   or o.property_name ~* '-\s*(No|With|Without)\s+Likeness\s*$')
    as likeness_parse_confident,

  -- Disney writes many characters surname-first. OUR guess at direct order.
  case when o.character_name ~ '^[^,()]+,\s+[^,()]+' then true else false end
    as name_is_surname_first_interpreted,

  -- Disney uses a BACKTICK where an apostrophe belongs on 637 rows.
  replace(o.character_name, '`', '''') as character_name_normalised_interpreted,
  -- ------------------------------------------------------------------------

  -- Provenance, so no consumer can read a row without its caveats.
  o.captured_at,
  o.line_of_business,
  o.entitlement_scope,
  o.source_url
from plm.opa_property_character o;

comment on view api.opa_property_character is
  'Consumable read-only view over the raw Disney OPA landing. Every column '
  'ending _interpreted is OUR INTERPRETATION, not Disney''s. When '
  'likeness_parse_confident is false, use property_name and do not rely on the '
  'split. SCOPE: Home line of business only, POP Creations entitlement only, '
  'snapshot dated captured_at. This is NOT all of Disney. AUTHORITY: presence '
  'adds and corrects; ABSENCE NEVER REMOVES.';

grant select on api.opa_property_character to authenticated;
grant select on api.opa_property_character to service_role;
revoke all on api.opa_property_character from anon;
```

### 7.6 DDL — the reconciliation view

```sql
-- Mirrors api.coldlion_property_reconciliation. Reports state; changes nothing.
create view api.opa_property_reconciliation
with (security_invoker = true) as
select
  o.licensed_property_id,
  o.property_name              as opa_property_name,
  count(*)                     as opa_character_count,
  o.property_id,
  p.name                       as core_property_name,
  l.code                       as core_licensor_code,
  o.resolution_status,
  o.resolution_reason,
  o.resolved_at,
  o.resolved_by,
  o.captured_at,
  o.line_of_business,
  o.entitlement_scope
from plm.opa_property_character o
left join core.property p on p.id = o.property_id
left join core.licensor l on l.id = p.licensor_id
group by o.licensed_property_id, o.property_name, o.property_id, p.name,
         l.code, o.resolution_status, o.resolution_reason, o.resolved_at,
         o.resolved_by, o.captured_at, o.line_of_business, o.entitlement_scope;

comment on view api.opa_property_reconciliation is
  'One row per Disney OPA property node with its reconciliation state against '
  'core.property. EXPECT A LOW MATCH RATE and do not treat it as an error: '
  'core.property mirrors ColdLion (what POP produces/holds a code for, see '
  'docs/style-guides-characters-and-royalties.md 5A.2) while OPA carries '
  'Disney''s full licensable title catalogue for the Home line of business. '
  'Of 1,445 OPA nodes, 178 match a DesignFlow/PopDAM style guide by exact '
  'Disney ID; the ~1,267 remainder are largely 20th Century Fox / ABC titles '
  'POP has never designed against. Resolution NEVER mutates core.property.';

grant select on api.opa_property_reconciliation to authenticated;
grant select on api.opa_property_reconciliation to service_role;
revoke all on api.opa_property_reconciliation from anon;
```

**On `security_invoker = true`:** both views are invoker-security so they cannot
become a privilege-escalation path around the base table's RLS. **The existing
`api.coldlion_*_reconciliation` views should be checked for the same setting.**
If they are definer-security that is a **pre-existing finding to raise
separately** — not something to copy.

### 7.7 Loading the 10,262 rows

Unchanged from the merged design: **a seed migration generated from the
committed CSV**, with the generator script committed alongside so a future
snapshot can be regenerated rather than hand-edited.

`\copy` via psql is **forbidden by standing rule** (no direct psql against the
shared DB). The Supabase MCP is **read-only and bound to production** and is not
an option.

`opa-characters.csv` is **business-confidential Disney data** obtained under a
commercial licensing relationship. It must not be published or sent to any
third-party service. It is **already committed** to this private repository
(PR #466), so the seed crosses no new confidentiality boundary.

**Refresh:** one-off snapshot, **no schedule, no automation** (MFA, no API).
`captured_at` distinguishes snapshots. A refresh **replaces**; it does not
merge. If two snapshots must ever coexist, `captured_at` joins the primary key —
a change this design deliberately does **not** make.

---

## 8. Options for Albert (plain English)

*This section stands alone. You do not need to read anything above it.*

### The short version

You told us to follow Disney's list, and we will. While setting it up we found
that the reason we thought our database could not hold Disney's data **turns out
not to be true.** The problem was much smaller than it looked. So the change is
smaller and safer than expected. Two decisions are yours.

---

### Decision 1 — Does Disney's list show *properties* or *style guides*?

You run the licensing side, so you may simply know this. Everything else hangs
off it.

Disney's picker has 1,445 entries. Some look like whole titles (`Lion King`,
`24`, `ABC News`). Some look like art styles or contract versions of one title
(`Avengers Movie 3 - No Likeness` and `Avengers Movie 3 - With Likeness` are two
separate entries for one film).

- **Strongest reason they are properties:** about 1,267 of the 1,445 are titles
  we have never designed anything for, including old Fox and ABC shows like
  `24` and `28 Days Later`. Those are films and TV shows, not art styles.
- **Strongest reason they are style guides:** 138 entries are the same title
  split into a "with likeness" and a "no likeness" version, and you told us last
  month that likeness is an art-file thing, not a property thing.

**The measurement leans clearly toward properties.** Only about 6% of the names
are variants; the rest are separate titles.

**Recommendation: treat them as properties.** One line: the great majority are
plainly separate films and shows, and the likeness pairs are contract versions of
one property rather than a different kind of thing.

---

### Decision 2 — How far may Disney's list overwrite what we already have?

We compared Disney's list against our own Disney character list. Out of 2,951
names, 2,743 match. Of the 208 that do not:

- **147** are the same character written the other way round. We write
  `Arnim Zola`; Disney writes `Zola, Arnim`. Same person.
- **3** are genuine spelling mistakes on our side that Disney fixes.
- **58** are names Disney's list does not have at all — and several of those are
  broken entries of ours, like a character name with a missing bracket, or a
  building recorded as if it were a character.

| Option | What changes | What could break | Cost to undo |
| --- | --- | --- | --- |
| **A. Store Disney's list beside ours. Change nothing yet.** | We load Disney's list and can compare any time. No existing record is edited. | Nothing. | Minutes — delete one table. |
| **B. Store it, and let Disney correct our spellings.** *(recommended)* | The 3 typos get fixed. The 147 name-order differences get flagged for you to decide, not changed automatically. Nothing is deleted. | Very little. If you later want our spelling back, it is recorded. | Hours. Every old value is kept. |
| **C. Also adopt Disney's name order everywhere.** | All 147 names flip to `Surname, Firstname`. | Screens and reports that sort or search by first name would look wrong to staff. | Days. Reversible but touches a lot of screens. |
| **D. Treat Disney as complete — delete anything Disney does not list.** | The 58 unmatched names are removed. | **Real damage.** Disney's list only covers the Home product line and only what our account may see. It is also a photograph from one day, with no updates. We already found a block of 30 Disney+ TV characters filed under the wrong film **in Disney's own system**, so their list is not perfect either. | **High.** Deleted rows need a backup restore. |

**One-line recommendation: take Option B.** It gives you Disney's authority where
it genuinely helps, fixes real mistakes, and cannot lose anything.

---

### The one warning worth remembering

Disney's list is **not** the whole of Disney. It covers one product line (Home),
only the titles our own account is allowed to see, and only as things stood on
6 August. **If a name is on it, trust it. If a name is missing from it, that
tells you nothing** — and deleting our records on that basis would throw away
good data.

---

## 9. What I did NOT do, and what is still unknown

### 9.1 Explicitly not done

- **No migration written.** No file created, modified or deleted under
  `supabase/`.
- **No database write of any kind.** No `insert`, `update`, `delete`, `create`,
  `alter`, `drop`, or `apply_migration`. Read-only `select` and catalog queries
  only.
- **No `supabase` CLI command and no `psql`.**
- **No preview contact** — `rjyboqwcdzcocqgmsyel` was never touched. Only
  production `qsllyeztdwjgirsysgai`, proved before the first query.
- **No background task chip created.**
- **The shared checkout `C:\repos\shared-db` was never touched.** All work in an
  isolated worktree on `agent/opa-truth-20260807`.
- **`../opa-characters-20260806/DESIGN.md` was NOT edited.** It stands as the
  record of the earlier ruling; this document supersedes it by reference.
- **`HANDOFF.md`, `AGENTS.md`, `COORDINATOR_INTAKE.md` and `supabase/**` were not
  edited.** This file is the only one added.
- **No commit to `main`, no merge.**
- **Nothing was decided.** §5.4 and §8 present options and stop.
- **The canonical Disney licensor value was NOT chosen** and no licensor is
  stamped on OPA rows.

### 9.2 Still unknown

1. **Whether OPA nodes are properties or style guides.** §3 narrows it heavily
   toward properties but does not close it. **Only Albert can (§8 Decision 1).**
2. **Whether OPA is DesignFlow's upstream or a newer snapshot of a shared Disney
   feed.** §3.5 — the evidence cannot distinguish these, and I do not claim it can.
3. **What the other lines of business contain.** Home only. Albert declined a
   re-pull. Load the same screen with a different `lob` and compare against 1,445.
4. **What `optionSourceID` means.** Constant `1007` on all 10,262 rows.
5. **What `brandPropertyID` means.** 1,345 distinct values, stored, uninterpreted.
6. **Whether the 30 mis-filed Morbius characters are a Disney bug or a licensing
   fact we do not understand** (§5.3). **Worth asking Disney or Laura.** It is
   the clearest counter-example to "Disney is always right" we have.
7. **Whether the 58 hard misses (§6.2) should be corrected, retired or kept.**
   Not individually reviewed. Several are defects on our side.
8. **The 21 OPA character names carrying multiple `characterID`s** — an old short
   ID beside a long modern one, e.g. `Beagle Boys` has three (`510`, `512`,
   `518031315`). Looks like a Disney system migration that left both generations
   live. **Do not dedupe without asking Disney.**
9. **`Davy Crockett` is two different Disney properties (`216` and `425`) sharing
   one name.** Not disambiguated.
10. **Whether `api.coldlion_*_reconciliation` are definer- or invoker-security
    views** (§7.5). If definer, a pre-existing finding to raise separately.
11. **The talent-likeness royalty rate.** OPA confirms Disney models the split
    but supplies no rate. ColdLion remains the source of record. Marvel-only, +2%.
12. **The exact OPA ↔ `public.characters` set intersection.** Trivial the day
    after this lands; not computed here to avoid a sampled answer.

### 9.3 Follow-ups for the coordinator

Listed here rather than raised as task chips, per the brief.

- Put §8's two decisions to Albert.
- **Consider recording in `AGENTS.md` §6.1 that `core.properties_and_characters`
  (10,122) and `core.property_character_associations` (9,622) duplicate the
  `dflow`/`public` shapes**, so the next session does not rediscover them and
  re-litigate the retracted lineage argument. `AGENTS.md` is coordinator-owned;
  this is a recommendation, not an edit.
- **Serialise this against the ColdLion licensor/property cutover** — both touch
  the property spine (AGENTS.md §4 rule 1).
- Raise the Morbius block (§5.3) with Laura or Disney.
