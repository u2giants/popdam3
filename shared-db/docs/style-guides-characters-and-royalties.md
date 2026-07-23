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

The mental model most people arrive with is two levels — **Property → Character**. That is
wrong. The real model has a **style guide** layer in between, and it is where most of the
licensing data actually lives.

```
Licensor            e.g. WB
   │
   └── Property     e.g. Batman            ← the franchise / the thing being licensed
         │
         └── Style guide  e.g. "Batman Core"                    ← an art style
             (sub-style     "Batman Returns (1992)"
              guides)       "Batman: Arkham Knight: Video Game 4"
                            "Batman: Animated Series (1992)"
                   │
                   └── Character artwork appearing in that style guide
                         e.g. Batman, Joker, Catwoman, Batmobile
```

**A style guide is a style of art, not a different property and not a different character.**

> "Batman Beyond: Animated Series, Batman Core, Batman Forever (1995), Batman Returns (1992):
> these are not different characters, these are all Batman. They happen to be different
> sub-style guides within the Batman Style Guide. And the same character will appear in many
> of these, but that doesn't mean it's different characters. It's just a different style of
> art. That's what a sub-style guide is." — owner, 2026-07-23

### 1.1 The consequences that keep biting people

1. **The same character recurs across many style guides.** Batman is one character. He appears
   in at least 15 style guides. Fifteen rows describing Batman are **fifteen renditions of one
   character**, not fifteen characters.
2. **A per-style-guide row carries its own external id.** The upstream licensing system issues
   a distinct `source_character_id` for each (style guide × character) pair. **An external id
   identifies a character *appearance*, not a character.** Deduplicating on that id will never
   collapse Batman.
3. **Counting rows counts artwork entries, not characters.** Any report that says "we have
   9,622 characters" is counting style-guide entries.
4. **Style guides are hierarchical in reality even though nothing enforces it.** A sub-style
   guide belongs under a parent style guide, which belongs under a property. No database
   constraint expresses this today.

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

Both errors share a root cause: **inferring business meaning from schema shape and row names
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
3. **How do these style guides attach to properties?** The legacy data links a style guide to a
   **licensor**, not to a property. "Batman Core" is linked to WB, not to a Batman property row.
   The property layer has to be derived or curated — it is not in the data.
4. **What is the true distinct-character count?** At most 8,307 by normalized name, but names
   carry qualifiers (`ROBIN AKA DICK GRAYSON`, `HARLEY QUINN AKA DR. HARLEEN FRANCIS QUINZEL`)
   so real identity resolution needs rules, and probably a human pass.
5. **Where do style guide assets (files) live**, given that talent likeness attaches to the
   file? Not yet traced.
6. **`core.character` shape.** It currently has a single `property_id` FK. If characters attach
   to style guides and recur across them, the canonical model likely needs a character identity
   table plus a character-appearance bridge. **No migration should be written until §7.2 and
   §7.3 are answered.**

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
