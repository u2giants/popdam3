# Disney OPA property→character extract — 2026-08-06

**Status:** source data captured and **merged to `main`** (PR #466, 2026-08-07).
**No database work has been done and none is in flight.** The request to turn
this into a lookup table is filed in `COORDINATOR_INTAKE.md` under
`## REQUEST QUEUE` ("Store the Disney OPA property→character list as a lookup
table", 2026-08-06) and is **waiting for a coordinator to dispatch it**. Read
§6a and §7 before designing anything.

This document is written for someone who has never seen OPA, was not in the
session that produced this file, and needs to either (a) act on the request,
(b) reproduce or refresh the extract, or (c) challenge whether the data is
trustworthy. Read it before you use `opa-characters.csv` for anything.

---

## 1. What OPA is, in plain terms

**OPA = Online Product Approval**, at `https://opa.disney.com`. It is Disney's
web portal for licensees. POP Creations is a Disney licensee, so Albert Hazan
has an account on it.

When a licensee wants to make a product using Disney intellectual property, they
submit it through OPA for approval. On the product submission screen, the
licensee must declare **which property** the product uses (e.g. "Lion King",
"Marvel Games", "101 Dalmatians - Individual Characters") and **which characters
within that property** appear on it.

That property-and-character picker is the data in this folder. It is **Disney's
own canonical list**, with Disney's own internal IDs — not our reconstruction of
it, and not a licensing spreadsheet typed by a human.

**Access requires MFA.** There is no API key, no service account, and no
unattended login. Any refresh of this data requires Albert to log in himself.

---

## 2. What we are trying to accomplish, and why it matters

### The business goal

Get Disney's authoritative property/character list into the shared Supabase
database as a **lookup table**, so that:

- PopDAM's character and style-guide taxonomy can be checked against what Disney
  actually recognises, instead of against hand-maintained spreadsheets.
- The ongoing licensor/property reconciliation work stops guessing at canonical
  spellings. Disney's spelling of a character is in this file.
- Apps can validate a character name against the licensor's real list rather
  than accepting free text.
- Nobody has to log into a browser behind MFA and expand a tree by hand to
  answer "is this character approvable under this property?".

### Why this is worth doing now

There is an **in-flight characters / style-guides workstream** in this repo, with
open questions that have been sent to a person at the licensing company (Laura)
across at least three rounds. See:

- `docs/verification/character-identity-rules-20260728/` — the existing character
  identity work, including `canonical-character-identities.csv` and
  `licensing-questions-for-laura-20260729.csv`
- `docs/verification/characters-property-reconcile-20260726/`
- The `Characters / style-guides Phase 1` request in `COORDINATOR_INTAKE.md`
  (now in `## COMPLETED`)

**Some of the questions being asked of a human may be answered outright by this
file, because it is the licensor's own data.** That is the main reason it is
worth landing rather than filing away.

### What this is NOT trying to do

- It is **not** a proposal to replace `core.property` or the existing character
  identity model. Design is explicitly left to the coordinator.
- It is **not** a claim that Disney's list is complete or correct for our
  purposes. See §6, caveats.
- It is **not** urgent. Nothing is blocked on it and nobody is idle.

---

## 3. What is in `opa-characters.csv`

| Fact | Value |
| --- | --- |
| Rows (excl. header) | **10,262** |
| Distinct properties | **1,445** |
| Distinct character names | **9,591** |
| File size | ~1.05 MB |
| Captured | 2026-08-06 |

### Columns

| Column | What it is |
| --- | --- |
| `property` | Disney's display name for the property, e.g. `101 Dalmatians - Individual Characters` |
| `licensedPropertyID` | Disney's internal ID for that property |
| `optionSourceID` | Disney's internal source/list identifier (was `1007` for every property row observed) |
| `character` | Disney's display name for the character |
| `characterID` | Disney's internal ID for that character |
| `brandPropertyID` | Disney's internal brand-property ID attached to the character node |

All ID columns are **Disney's keys, not ours.** They are stable handles for
matching back to OPA later. They are written as quoted strings in the CSV
because some are long numerics that spreadsheet software will otherwise mangle.

### The shape of the data — read this before designing a table

The OPA picker is a **two-level tree**: property on top, characters beneath.
There is no third level.

```
101 Dalmatians - Individual Characters   (licensedPropertyID 93)
├── 101 Dalmatians Animated              (characterID 298)
├── ... 10 more
Lion King
├── ...
```

**A character is scoped to a property.** The same character name recurs under
many different properties, with different `characterID` values. That is why
10,262 rows collapse to only 9,591 distinct names — roughly 670 names appear
under more than one property.

> **The natural key is the (property, character) pair, not the character name.**
> Anyone who builds a table keyed on character name alone will silently lose
> rows or create false matches.

This mirrors a rule already established in this repo for properties themselves:
`core.property` is declared `unique (licensor_id, code)` — property codes are
**not** globally unique, and licensor→property is parent-child (Albert's ruling,
2026-08-06; schema at `supabase/migrations/20260621150815_app_core.sql:200`).
The OPA data extends the same parent-child logic one level deeper.

---

## 4. Exactly how the extract was made

### The key discovery

**This is not a page you scrape.** The naive approach — clicking each property,
waiting for characters to load, paging through — would take hours and hammer
Disney's server.

OPA loads the **entire** property-and-character tree into the browser in one go
when the product-create screen renders. It is a [jsTree](https://www.jstree.com/)
widget, and every node is already in the client-side model, marked
`state.loaded = true`, before anything is clicked. So the extract is a **single
read of data already sitting in the page**. It takes seconds and issues no extra
requests to Disney at all.

### Step by step, as performed

1. Albert logged into OPA in his own Chrome, completing MFA himself. **No
   credential, password, or MFA code passed through the AI session.** The AI was
   connected to that Chrome via the Claude in Chrome extension, so it inherited
   the authenticated session without ever seeing how it was obtained.
2. The AI opened one tab to the product-create URL (see §5). Because session
   state lives in the Chrome profile rather than the tab, the new tab was already
   logged in.
3. The property tree renders empty until "Show All" is triggered, so
   `showAllProperties()` was called to populate it.
4. The jsTree instance was read directly out of the page and flattened to CSV.
5. The CSV was saved via an in-page blob download — built entirely from data
   already in the browser, uploaded nowhere.
6. The tab was closed.

**Nothing was created or modified in OPA.** No form field was typed into, and
neither "Save for Later" nor "Submit to Disney" was ever clicked. The page is a
product-create form; treat it as read-only and leave it that way.

### The reproduction snippet

Run this in the browser console on the product-create page **after** the
property tree has been shown. It regenerates the identical CSV.

```js
// 1. Populate the tree (the picker is empty until this runs)
showAllProperties();

// 2. Wait a few seconds for it to render, then run the rest.

// 3. Flatten the jsTree model to CSV.
//    NOTE: 'jstree_741' is a generated id and WILL differ between page loads.
//    Find the current one with: document.querySelector('.jstree').id
const inst = jQuery.jstree.reference('#' + document.querySelector('.jstree').id);
const m = inst._model.data;
const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"';
const rows = ['property,licensedPropertyID,optionSourceID,character,characterID,brandPropertyID'];
m['#'].children.forEach(pid => {
  const p = m[pid], pa = p.li_attr || {};
  (p.children || []).forEach(cid => {
    const c = m[cid], ca = c.li_attr || {};
    rows.push([q(p.text), q(pa.licensedPropertyID), q(pa.optionSourceID),
               q(c.text), q(ca.characterID), q(ca.brandPropertyID)].join(','));
  });
});

// 4. Download it.
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([rows.join('\n')], {type: 'text/csv'}));
a.download = 'opa-characters.csv';
document.body.appendChild(a); a.click(); a.remove();
```

Refreshing this data takes about two minutes, and the only manual step is
Albert's login.

---

## 5. The source URL, and what its parameters mean

```
https://opa.disney.com/ProdApp/createEditProduct.spring
  ?do=createEdit
  &lob=200
  &templateId=21
  &workflowId=49
  &regionName=Option.Region.4
  &lobName=Option.Lob.Home       <-- line of business: HOME
  &productTypeName=pa.system.productType.standard
  &inbox=true
  &isCreatePage=true
```

> ⚠️ **`lobName=Option.Lob.Home` scopes this extract to the HOME line of
> business.** It is **unverified** whether other lines of business (apparel,
> toys, etc.) expose a different or larger property set. Anyone treating this
> file as "all of Disney" should check that first by loading the same screen for
> another `lob` value and comparing the property count against 1,445.

---

## 6. Caveats — read before trusting this data

1. **It is scoped to Albert's licensee entitlements.** OPA shows a licensee the
   properties it is contractually allowed to see. This is **not** Disney's full
   catalogue, and it will differ for a different account.
2. **It may be scoped to one line of business.** See §5. Unverified.
3. **Nothing was filtered out.** Retired properties, and variants with names like
   `MS Captain America New World Order - No Likeness` and
   `... - With Likeness`, are all present exactly as OPA lists them. The
   "No Likeness" / "With Likeness" distinction is a real licensing concept, not
   noise, and should not be stripped without a decision.
4. **It is a point-in-time snapshot.** Disney adds and retires properties. There
   is no change feed; a refresh is a full re-extract.
5. **`optionSourceID` was `1007` on every property row observed.** Its meaning is
   not understood. Do not build logic on it without establishing what it is.
6. **No live schema was consulted.** The session that captured this made **zero**
   database calls of any kind. Every statement here about our schema is
   second-hand from repo documents and must be re-derived before it is relied on.

---

## 6a. How this relates to the tables we already have

### ❌ First, a disproved claim — do not re-raise it

An earlier revision of this document (same day, 2026-08-06) suggested that
`dflow.properties_and_characters` might be a stale import of this same OPA list,
on the strength of the row counts being within ~1%. **That was wrong.** It is
kept here, struck, so nobody re-derives it.

| Source | Rows | What a row actually IS |
| --- | --- | --- |
| **This OPA extract** | **10,262** (9,591 distinct names) | a distinct **(property, character) pair** |
| `dflow.properties_and_characters` | 10,122 | `type='PROPERTY'` → a **style guide**; `type='CHARACTER'` → a character **appearance**, one per style guide |
| `public.characters` | 9,622 | a character **appearance**, but carrying `property_id` |
| `core.character` | **0** | intended home for distinct characters — never populated |

The counts are close but they **count different things**, so the closeness is a
coincidence. `AGENTS.md` §6.1 warns explicitly that
`dflow.properties_and_characters` is misleadingly named and that "two AI sessions
have already corrupted their understanding by reading those column names
literally." Numeric similarity between these tables is **not** evidence of shared
lineage.

### The two axes (read `AGENTS.md` §6.1 and `docs/style-guides-characters-and-royalties.md` before designing)

- **Ownership is linear:** licensor → property → character. A character has
  exactly one property. `public.characters` is on this axis.
- **Style is many-to-many:** a style guide holds many characters, and a character
  appears in many style guides. `dflow.properties_and_characters` is on this axis.
- **A style guide is NOT a level between property and character.** Chaining the
  two axes is the documented classic bug in this workstream.

### What actually survives, and why it matters

**`core.character` is 0 rows, and it wants distinct characters parented to a
property. Neither legacy table supplies that shape — this OPA file does.** Both
legacy tables hold *appearances*; OPA holds *identities scoped to a property*.
That is the gap, and it is a stronger argument for landing this file than the
disproved lineage claim ever was.

**Still unverified, and worth testing early:** whether OPA's `characterID` is
stable enough to serve as the identity key `core.character` needs, and how OPA's
property names line up with `core.property`. No session in this thread has made
any database call; every count above is read from repo documents, not measured.

---

## 7. Open design questions for whoever implements this

These are deliberately unanswered. They are the coordinator's to decide, not the
requester's.

1. **Where does it land?** This is vendor/source-owned data from Disney. Does it
   belong in a raw landing table alongside other vendor source material (the
   ColdLion pattern), with a view on top? Or reconciled directly into the
   existing character identity model?
2. **Does it join to `core.property`?** If it does, it becomes a **cross-app data
   contract** — PopCRM and DesignFlow both read licensor/property data — and
   needs the corresponding review. If it stays standalone reference data, it does
   not.
3. **How is Disney identified as a licensor?** Not checked. Note the repo already
   has history here: a property was found filed under a licensor named
   "NO LICENSE", and Albert ruled 2026-08-06 that "Coco IS a Disney license."
4. **Does this overlap or conflict with the existing character identity work?**
   Assume it does and dedupe first. `canonical-character-identities.csv` and this
   file may disagree, and if they do, the disagreement is itself a finding worth
   reporting rather than silently resolving.
5. **Refresh policy.** One-off snapshot, or a documented manual refresh ritual?
   Automation is not possible: MFA, no API.
6. **Do the `- No Likeness` / `- With Likeness` property variants need modelling
   as an attribute** rather than as two separate property names?

---

## 8. What we tried that did NOT work

Recorded so nobody burns time repeating it.

| Attempt | What happened | The lesson |
| --- | --- | --- |
| Looked for a `<select>` dropdown of characters | The `Character` field is a **hidden input**, not a dropdown. The visible control is a lookup that opens a popup. | The character list is not in a plain form control. |
| Planned to loop the `getCharacters.spring` endpoint per property | The endpoint is real (`?do=getCharacters&pIds=…&pType=std`) and would have worked, but it needs one HTTP call per property — 1,445 calls. | Unnecessary. Everything was already loaded client-side. Don't build the crawler before checking the page's own state. |
| Read `openCharacterPopup.toString()` and various `outerHTML` dumps | The browser tool's safety filter **blocked the response** with `[BLOCKED: Cookie/query string data]` — query-string-shaped text trips it. | Extract only what you need (paths, literals) and mask `=` signs, rather than dumping raw HTML or function bodies. |
| Looked for checkboxes named `pa.system.Attribute.Property` | Returned **0 elements**, even though the page's own `getProperties()` function reads exactly that name. | The page has legacy code for a checkbox UI it no longer uses. The live widget is jsTree. **Don't infer the DOM from the page's own JavaScript.** |
| Searched for the property text with `children.length === 0` | Not found. | jsTree anchors contain child elements. Use a `TreeWalker` over text nodes instead. |
| One `async` IIFE that triggered the load, awaited, and read the result | Returned `{}`. | Split "trigger" and "read" into separate calls. |
| `Copy-Item` on the download's `.tmp` file | Failed — Chrome had renamed the GUID `.tmp` to the final filename between two commands. | The download completes asynchronously. Check for the **final** filename before concluding it failed. |

---

## 9. Provenance and handling

- **Captured:** 2026-08-06, by an AI session on machine `t16`, driving Albert's
  own Chrome via the Claude in Chrome extension.
- **Authentication:** Albert performed the OPA login and MFA himself. No
  credential was seen, stored, requested, or transmitted by the AI session.
- **Disney's data.** It came from a licensee portal under a commercial licensing
  relationship. It is business-confidential. Do not publish it, and do not push
  it to any third-party service.
- **Related request:** `COORDINATOR_INTAKE.md` → `## REQUEST QUEUE` → "Store the
  Disney OPA property→character list as a lookup table" (2026-08-06). PR #466.
