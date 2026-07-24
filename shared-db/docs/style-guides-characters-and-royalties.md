# Style guides, characters, and royalty rates

**Status:** authoritative for the business rules in §1–§3, which were stated directly by the
owner (Albert) on 2026-07-23. Data measurements in §4 were taken live against production
Supabase `qsllyeztdwjgirsysgai` on the same date. Open questions are marked as such in §7.

**Who this is for:** anyone about to touch characters, style guides, licensed properties, or
royalty reporting. Read this *before* [`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md)
if your work involves characters — that document covers the merch-group classification spine
and does not describe the style-guide model at all.

**Why it exists:** an AI session on 2026-07-23 was migrating the legacy licensing tables into
`core.character` and got the model wrong in two specific ways. Both errors are recorded in §6
so nobody repeats them. The owner's corrections are the substance of this document.

---

## 1. The layer that was missing: style guides and sub-style guides

There are **two different axes**, and collapsing them into one chain is the mistake everybody
makes.

### 1.0 The ownership axis is linear. The style axis is not.

> "Property → Style guide → Character is not a linear relationship.
> Licensor → Property → Character is linear. A style guide can have multiple characters in it.
> A character can appear in multiple Style Guides." — owner, 2026-07-23

```
AXIS 1 — OWNERSHIP (strictly linear, one parent each)

   Licensor  ──1:N──▶  Property  ──1:N──▶  Character
   e.g. WB              Batman              Batman, Joker, Catwoman

   A character belongs to exactly ONE property.
   A property belongs to exactly ONE licensor.


AXIS 2 — STYLE (many-to-many, cross-cutting)

   Style guide  ◀──M:N──▶  Character
   "Batman Core"            Batman
   "Batman Returns (1992)"  Joker
   "Arkham Knight"          Catwoman

   A style guide contains MANY characters.
   A character appears in MANY style guides.
```

**A style guide is a style of art. It is not a property, not a character, and not a level in
the ownership hierarchy.** It is a separate thing that *references* characters.

So "Batman" is **one** character. It belongs to **one** property (Batman) under **one** licensor
(WB). It appears in **15** style guides. Those 15 style-guide appearances are edges on axis 2 —
they never multiply the character on axis 1.

### 1.1 Why this matters more than it sounds

The two axes have opposite cardinality, so any model that chains them produces one of two bugs:

- **Chaining Property → Style guide → Character** duplicates every character once per style
  guide. That is exactly the shape of the legacy data, and reading it literally yields
  "9,622 characters" when the real count is far lower.
- **Hanging a character off a style guide** makes it impossible to answer "which property does
  this character belong to?" without picking one style guide arbitrarily.

The canonical model must therefore carry **both**: a single `property_id` on the character
(axis 1) **and** a style-guide ↔ character bridge table (axis 2).

> "Batman Beyond: Animated Series, Batman Core, Batman Forever (1995), Batman Returns (1992):
> these are not different characters, these are all Batman. They happen to be different
> sub-style guides within the Batman Style Guide. And the same character will appear in many
> of these, but that doesn't mean it's different characters. It's just a different style of
> art. That's what a sub-style guide is." — owner, 2026-07-23

### 1.2 The consequences that keep biting people

1. **The same character recurs across many style guides.** Batman is one character. He appears
   in at least 15 style guides. Fifteen rows describing Batman are **fifteen renditions of one
   character**, not fifteen characters.
2. **A per-style-guide row carries its own external id.** The upstream licensing system issues
   a distinct `source_character_id` for each (style guide × character) pair. **An external id
   identifies a character *appearance*, not a character.** Deduplicating on that id will never
   collapse Batman.
3. **Counting rows counts artwork entries, not characters.** Any report that says "we have
   9,622 characters" is counting style-guide entries. The 9,622 legacy rows **are the axis-2
   bridge** — (style guide × character) edges — not a character list.
4. **A character's parent is its property, never its style guide.** Resolving "which property
   does this character belong to?" must not go through a style guide.
5. **Sub-style guides do not create a hierarchy on axis 1.** "Batman Core" and
   "Batman Returns (1992)" are two style guides in the same style family. That family
   relationship is style metadata; it is **not** a parent chain that a character inherits
   ownership through.

---

## 2. Talent likeness and royalty rates

### 2.1 The business rule

- Some artwork contains **talent likeness** — a real actor's face/likeness, as opposed to a
  drawn or generic rendition of the character.
- **Marvel charges a 2% higher royalty rate for artwork containing talent likeness.**
- **Marvel is the only licensor that does this.** Do not generalize the rule to WB, Disney, or
  anyone else.
- **Coldlion has to report royalties against that distinction, and Coldlion does capture the
  data.** Whether it is exposed on any current API endpoint is an open question (§7).

### 2.2 The attachment point — this is the important part

> **Talent likeness is a property of a style guide asset (a file). It is NOT a property of a
> character.** — owner, 2026-07-23

So the "With Likeness" / "No Likeness" naming seen throughout the legacy licensing data
(`Marvel Studios' Thunderbolts - With Likeness`, `Captain Marvel Movie - No Likeness`, and
dozens more) is describing **which style guide the artwork came from**, at the level of the
asset file. It is not a character attribute, and a character does not become a different
character because a likeness version exists.

Any future model of this must hang the likeness flag on the **asset/file**, not on
`core.character`, and not on a property.

### 2.3 Royalty-reporting sentinels are not characters

The legacy character list contains rows that are **royalty-reporting placeholders**, not
characters. Measured live (§4):

| Value | Style guides it appears in | What it is |
|---|---:|---|
| `NO REPORTABLE ELEMENTS` | 154 | nothing in this artwork triggers a royalty-reportable element |
| `NO CHARACTER LIKENESS` | 15 | artwork carries no character likeness |
| `LOGO` | 13 | logo-only artwork |

**Any import must exclude or specially classify these.** Loading `NO REPORTABLE ELEMENTS` into
`core.character` as a character named "NO REPORTABLE ELEMENTS" 154 times would be a data-quality
failure that is very hard to unpick later.

---

## 3. Where each fact is owned

| Fact | Owned by | Notes |
|---|---|---|
| Which licensors/properties exist (classification codes) | Coldlion ERP | flat merch-group lists, see the merch-group doc |
| Licensor → property relationship | **DesignFlow** | Coldlion has no parent link at all |
| Style guides and sub-style guides | **DesignFlow / the licensing system** | Coldlion returns **zero** MG07 Style Guide rows for both licensed divisions |
| Characters per style guide | **the licensing system** | `dflow.properties_and_characters` |
| Talent-likeness flag | **the style guide asset (file)** | Marvel-only royalty impact |
| Royalty rate | licensing agreement (`dflow."licenseList"`) | `licenseList_royalty_rate`, `licenseList_fob_royalty_rate` |

Note the collision with the merch-group document: merch-group type **MG07 is "Style Guide"** and
is **empty in Coldlion**, and the DesignFlow UI never populates style-guide options
(see merch-group doc §9.9). The licensing tables described here appear to be where style guides
actually live. See §7.

---

## 4. What the live data shows (production, 2026-07-23)

Source tables: `dflow.properties_and_characters` (10,122 rows) and
`dflow.property_character_associations` (9,622 rows).

| Measurement | Value |
|---|---:|
| Rows typed `PROPERTY` (**these are style guides / sub-style guides**) | 500 |
| Rows typed `CHARACTER` (**these are character *appearances*, one per style guide**) | 9,622 |
| Distinct character names (exact) | 8,370 |
| Distinct character names (trimmed + uppercased) | 8,307 |
| Style guides that actually have character rows | 335 |
| Style guides with no characters | 165 |
| Character rows whose parent style guide is ambiguous | **0** |

Every character row maps to **exactly one** style guide through the bridge table — there are no
multi-parent rows, no duplicate `(style_guide, character, licensor)` triples, and the bridge's
`licensor_id` always agrees with both endpoints.

### 4.1 Most-repeated characters (proof of the model)

| Character | Appearances | Distinct style guides |
|---|---:|---:|
| `NO REPORTABLE ELEMENTS` *(sentinel)* | 154 | 154 |
| `NO CHARACTER LIKENESS` *(sentinel)* | 15 | 15 |
| **BATMAN** | **15** | **15** |
| `LOGO` *(sentinel)* | 13 | 13 |
| JASON VOORHEES | 12 | 12 |
| JOKER | 11 | 11 |
| BANE | 11 | 11 |
| CATWOMAN | 10 | 10 |
| BATMOBILE | 10 | 10 |
| HARLEY QUINN | 10 | 10 |

Batman's 15 rows, each in a different style guide, each with its own `source_character_id`:
Batman & Robin (1997) · Batman Beyond: Animated Series · Batman Returns (1992) ·
Batman: Animated Series (1992) · Batman: Arkham Asylum · Batman: Arkham City ·
Batman: Arkham Knight · Batman: Arkham Origins · Batman: Television Series (1966) ·
The Dark Knight (2008) · DC Super Friends Collection Comics · Green Lantern Core ·
Injustice: Gods Among Us · Justice League Core · Suicide Squad (2016).

### 4.1a Axis 2 is genuinely many-to-many — measured both directions

Excluding the three royalty sentinels (§2.3), the legacy bridge holds:

| Measurement | Value |
|---|---:|
| Bridge edges (style guide × character) | 9,440 |
| Distinct character names | 8,304 |
| Style guides represented | 313 |
| **Character names appearing in more than one style guide** | **653** |
| **Style guides containing more than one character** | **225** |

Both directions are populated, so the relationship is a true M:N — it cannot be modelled as a
foreign key in either direction. Note also that the sentinels account for 182 of the 9,622 rows.

### 4.2 External id shapes differ by licensor

`source_character_id` and `source_licensed_property_id` are **not one id space**:

- **WB** ids are UUIDs (`d34589c0-3a64-4f1a-9937-a79a1490e7d4`)
- **Disney / Marvel** ids are numeric strings (`92`, `1159115273`)

They came from separate licensor feeds. Never assume a single id namespace, and never assume an
id is numeric.

---

## 5. Naming: say what you mean

Because one word has meant three things in three systems, use these terms in code, columns,
docs, and conversation:

| Say | Mean | Do **not** call it |
|---|---|---|
| **Property** | the franchise being licensed (Batman, Harry Potter) | "licensed property id" alone |
| **Style guide** / **sub-style guide** | an art style within a property (Batman Core, Arkham Knight) | a property; a character group |
| **Character** | the character identity (Batman) — one row regardless of style | a style-guide entry |
| **Character appearance** | one character as rendered in one style guide | a character |
| **Merch-group property** | the Coldlion MG06 classification code | the same thing as a licensing property |

The legacy column names are actively misleading and cannot be trusted as documentation:
`properties_and_characters.type = 'PROPERTY'` holds **style guides**, and
`source_licensed_property_id` is the **style guide's** external id.

---

## 5A. The canonical target model

This is what the schema must express. It follows directly from §1.0: one linear ownership
chain, one many-to-many style axis.

```sql
-- AXIS 1 — ownership. Already correct in the canonical schema today.
core.licensor  (id, name, code, status, …)
core.property  (id, licensor_id → core.licensor, name, code, status, …)
core.character (id, property_id → core.property, name, code, status, …)
   -- ONE row per character. property_id is its single, real parent.

-- AXIS 2 — style. Does not exist yet; must be added.
core.style_guide            (id, licensor_id → core.licensor,
                             property_id → core.property NULL,  -- see open question 3
                             parent_style_guide_id → core.style_guide NULL,  -- sub-style guides
                             name, code, status, …)

core.style_guide_character  (style_guide_id → core.style_guide,
                             character_id   → core.character,
                             primary key (style_guide_id, character_id))
   -- the M:N bridge. THIS is what the 9,622 legacy rows become.
```

Key points:

- **`core.character.property_id` stays a single FK and is correct.** Do not widen it to
  many-to-many, and do not repoint it at a style guide. Axis 1 is genuinely linear.
- **`core.style_guide_character` is where multiplicity lives.** Batman = 1 character row +
  15 bridge rows.
- **Sub-style guides** are modelled as `parent_style_guide_id` self-reference on the style guide,
  *not* as a level between property and character.
- **Talent likeness belongs on the style guide asset (file)**, per §2.2 — not on
  `core.character`, not on `core.style_guide`, and not on `core.property`. The asset table is not
  yet traced (open question 5).
- The legacy 9,622 rows are **bridge edges**, so the loader must resolve each edge's character to
  a single canonical character identity before inserting — otherwise it recreates the duplication.

### 5A.0 How a style guide resolves to its property (owner rules, 2026-07-23/24)

The legacy data does not store a style guide's owning **property** (only its licensor, §7.3).
The owner supplied the rules that resolve it. Apply them in order:

1. **Named property exists in Coldlion MG06 → use it.** Most style guides are named after a
   property that Coldlion already carries (e.g. every `Batman *` style guide → the `Batman`
   property). This is the bulk of the mapping.
2. **Disney Classics → the `CP` bucket property.** Classic Disney titles are **not** separate
   properties in our catalog. They are grouped under one Coldlion property:
   **`CP` = "CLASSIC PROPERTIES"** (licensor DISNEY, active; present in both Coldlion MG06 and
   `core.property`). Confirmed classics that map to `CP`:
   **Bambi, Lion King, Aristocats, Jungle Book, 101 Dalmatians** (and titles like them).
   > "Bambi, Lion King, Aristocats, Jungle Book and 101 Dalmatians are considered Classics so
   > we use the CP MG06." — owner, 2026-07-24
   Related Coldlion classics buckets, for reference: `MP` "MIXED PROPERTIES (DISNEY CLASSICS)",
   `CBC` "CARE BEARS CLASSIC", `SC` "SONIC CLASSIC".
3. **No code exists → do not invent a property.** Some titles have **no property code at all**
   because POP has never produced against them. Confirmed examples: **Luca, Kim Possible,
   Inside Out.** Their style guides (and the characters under them) **cannot** be given a real
   property parent today, and **no placeholder property is to be created** to force a link. They
   wait until the business assigns a code, or are loaded with a null property and flagged.

**The rule this establishes:** the canonical property list mirrors **Coldlion** (what POP
produces / holds a code for), with classics folded into `CP`. Being *licensed* for a title is
not sufficient for it to be a property — see §5A.2.

### 5A.1 What must be answered before this can be built

The blocker is **not** the shape above — it is the two inputs the legacy data does not contain:

1. **Which property does each character belong to?** (axis 1 parent)
2. **Which property does each style guide belong to?** (open question 3)

The legacy tables record `licensor` for both, never `property`. §5A.0 now supplies the owner's
resolution rules for input 2 (style guide → property). Input 1 (character → property) follows
from it: a character's property is the property of whichever style guide owns it, which is
well-defined for the 149 name-matched style guides plus the classics that fold into `CP`, and
undefined for the no-code titles (§5A.0 rule 3).

### 5A.2 "Everything licensed" vs "only what Coldlion produces" — decided

This was the open strategic question. The owner's classics/no-code rules answer it:

**The canonical property list mirrors Coldlion (what POP produces or holds a code for). Being
licensed for a title is not enough to make it a property.**

- Classic titles do not each become a property; they collapse into the **`CP`** bucket (§5A.0
  rule 2).
- Titles with no code (Luca, Kim Possible, Inside Out) are **not** added as properties, even
  though POP is licensed for them (§5A.0 rule 3).

So the earlier idea of adding ~186 "missing" properties to cover every licensed title is
**rejected**. Properties are added only when Coldlion carries a code (classics route through the
existing `CP`). This keeps `core.property` aligned with the ERP and avoids inventing rows the
ERP will never confirm.

---

## 6. Two errors made on 2026-07-23 — do not repeat them

**Error 1 — treating the legacy `PROPERTY` rows as properties.**
An AI session read `type='PROPERTY'` literally and concluded that 313 "properties" were missing
from `core.property` and had to be created. Those rows are **style guides**. Creating 313
style guides as properties would have corrupted the property list permanently and made every
property picker unusable. *Lesson: a column named `type` describes the legacy system's
vocabulary, not ours.*

**Error 2 — inferring that "With Likeness / No Likeness" was a contract artifact irrelevant to
classification.** The same session wrote that a merch-group classification "has no reason to
carry" a likeness distinction. That is wrong: the likeness split is a **real royalty rule**
(Marvel, +2%), Coldlion does capture it, and it attaches to the **style guide asset**. *Lesson:
do not reason about why a business distinction "shouldn't" exist — ask.*

**Error 3 — chaining the two axes into one hierarchy.** The first version of *this document*
described the model as `Property → Style guide → Character`, a single linear chain. That is also
wrong, and the owner corrected it the same day (§1.0). Ownership is linear
(`Licensor → Property → Character`); style is many-to-many (`Style guide ↔ Character`). Chaining
them duplicates every character once per style guide and makes a character's property
unanswerable. *Lesson: when a new layer appears, establish its **cardinality** before drawing an
arrow through it.*

All three errors share a root cause: **inferring business meaning from schema shape and row names
instead of asking the owner.** The taxonomy in this area is full of words that mean different
things in different systems (see the merch-group doc's opening warning). Ask first.

---

## 7. Open questions

1. **Does Coldlion expose the talent-likeness flag on any endpoint?** The owner confirms
   Coldlion captures the data and reports royalties against it. It is not present in
   `/merchGroupDetails`. Needs an endpoint sweep before any royalty work.
   See [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md).
2. **Are the licensing tables the real source of style guides?** Coldlion returns zero MG07
   Style Guide rows and the DesignFlow style-guide picker is never populated (merch-group doc
   §9.9), yet 500 style guides exist here. If so, MG07 should be sourced from this spine rather
   than from the ERP.
3. ~~**How do these style guides attach to properties?**~~ **MOSTLY RESOLVED 2026-07-24 (§5A.0).**
   Rule: name-match to a Coldlion MG06 property; classics → `CP`; no-code titles get no
   property. Remaining work is a human review of the name-match pass and enumerating which
   titles are classics vs no-code.
3a. **Which property does each character belong to?** Follows from §5A.0 via the character's
   owning style guide. Well-defined except for no-code titles.
4. **What is the true distinct-character count?** At most 8,307 by normalized name, but names
   carry qualifiers (`ROBIN AKA DICK GRAYSON`, `HARLEY QUINN AKA DR. HARLEEN FRANCIS QUINZEL`)
   so real identity resolution needs rules, and probably a human pass.
5. **Where do style guide assets (files) live**, given that talent likeness attaches to the
   file? Not yet traced.
6. ~~**`core.character` shape.**~~ **RESOLVED 2026-07-23.** The single `property_id` FK is
   **correct** — axis 1 is linear (§1.0). Multiplicity belongs in a new
   `core.style_guide_character` bridge, not in `core.character`. Target model in §5A.

**Blocking status:** questions 3 and 3a are **resolved in principle** by §5A.0; what remains is
a curation/review pass, not an unknown. The strategic question (§5A.2) is **decided**: mirror
Coldlion, classics → `CP`, no-code titles excluded. Questions 1, 2, 4, and 5 do not block the
schema change but do block a fully correct *backfill*.

---

## 8. Related documents

- [`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) — the Coldlion → DesignFlow → Supabase classification spine; §4.5 covers the two separate licensor spines
- [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) — Coldlion endpoints and auth
- [`designflow-master-data-migration/designflow-schema-segregation.md`](designflow-master-data-migration/designflow-schema-segregation.md) — table placement map (note: its `properties_and_characters → core.property + core.character` mapping predates this document and should be re-read in light of §1)
- [`unified-supabase-schema-map.md`](unified-supabase-schema-map.md) — where every table lives

## 9. Document history

| Date | Change |
|---|---|
| 2026-07-23 | Created from owner corrections on style guides, sub-style guides, talent likeness, and Marvel royalty rates; live measurements added |
