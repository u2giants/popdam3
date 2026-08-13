# Licensor portal scrape — source schema and database contract

**Status:** authoritative for the Warner Bros. STARLABS extract. Written 2026-08-10 for
issue #588 (object claim #627), alongside migration
`20260810030000_warner_starlabs_source_landing.sql`.

**Why this file exists.** Two earlier sessions were told to follow this document and found
that it did not exist — it was referenced by the `wb-starlabs-scrape` skill and by issue
#588 as "the database contract", and the gap is recorded in
`HANDOFF.d/2026-08-07T2222Z-al8960ofc-orchestrator-opa-build-and-paramount-design.md`.
The contract was in practice being defined by whoever built the tables. It is written down
here instead.

---

## 0. The rule that outranks everything else in this file

**SCHEMA IN GIT. DATA OUT OF GIT.**

`u2giants/shared-db` is a **PUBLIC** repository. Every licensor extract it describes is
business-confidential data held under a commercial licensing relationship. No licensor
title, property name, character name, style-guide name, asset id, file name or file path
may appear in this repository — not in a migration, not in a seed, not in a doc, not in a
test fixture, not in a commit message, not in a PR body, and not in an issue comment.

Raw extracts live **only** in the private repository `u2giants/licensor-source-data`.

Rows reach the database at **runtime**, through a guarded importer that is fed a JSON
snapshot by a tool reading the private repo. There is no seed migration and there must
never be one. This is not a style preference: a seed puts licensed rows into public git
history permanently, and history cannot be un-published.

---

## 1. Scope of this contract

> ⚠️ **SUPERSEDED IN PART, 2026-08-13.** This table listed Disney as **OPA only** and
> omitted **DCP Vault** entirely, so it read as though Disney had one landing table where
> the other licensors had a full set. That was never true — the DCP Vault migrations
> landed 2026-08-10/11 and this table was not updated. They are now **applied to
> production** and Disney has **20 `plm.dcp_*` tables**. The corrected row is below.
> An orchestrator misread the omission as a schema gap and reported it to the owner as
> missing work; see issue #892. **"One licensor, one namespace" is also wrong for Disney:
> Disney is TWO portals with two namespaces.**

| Licensor | Portal | Landing namespace | Status |
| --- | --- | --- | --- |
| Disney | OPA (`opa.disney.com`) | `plm.opa_*` | built, migrations `20260807170000` / `20260807170100` |
| **Disney** | **DCP Vault (`dcpvault.disney.com`)** | **`plm.dcp_*`** | **built and APPLIED to production 2026-08-13; migrations `20260810190000`, `20260810190100`, `20260811050000`, `20260811060000` — 20 tables** |
| Warner Bros. | STARLABS | `plm.wb_*` | built by this contract, migration `20260810030000` |
| Paramount | Creative Library | `plm.pmt_*` | built and applied; `20260811030000` added lossless source IDs + `pmt_asset_metadata_value` |
| NBCU | — | `plm.nbcu_*` | built and applied; `20260811070000` added `nbcu_asset_ip_family` |

One licensor, one `plm.<prefix>_*` namespace — **except Disney, which has two portals and
therefore two namespaces (`plm.opa_*` and `plm.dcp_*`)**. Prefixes are never shared and
never reused.

⚠️ **Every one of these landing tables currently holds ZERO rows.** The schema is complete;
the loaders were never written. See issue #900.

⚠️ **DCP Vault's `properties[]` must NEVER be paired with its `character[]`** — that
relationship is valid only from OPA.

---

## 2. The house pattern every licensor landing follows

Established by the Disney OPA build and followed here without deviation.

1. **Raw mirror in `plm`.** The vendor's strings are stored byte-for-byte. Nothing is
   normalised, split, trimmed, case-folded or corrected in the landing table.
2. **Interpretation in `api`.** Any derived value lives in an `api.*` view built with
   `security_invoker = true`, and every derived column is named so a reader can tell it is
   ours and not the licensor's.
3. **Mirror columns on every table:** `raw jsonb`, `source_hash text`, `first_seen_at`,
   `last_seen_at`, `imported_at`, `updated_at`.
4. **Provenance on every row:** the capture date and the source URL, so no row can be read
   without its scope caveat.
5. **RLS on, one read policy, explicit grants.** `select` to `authenticated`, full rights
   to `service_role`, `revoke all` from `anon`. An RLS policy is **not** a grant
   (`AGENTS.md` §11); both are always required.
6. **A guarded `SECURITY DEFINER` importer**, plus a thin `public.*` wrapper because `plm`
   is not PostgREST-exposed (`AGENTS.md` §8.1).
7. **Absence never removes.** Rows we hold that a new snapshot does not mention are
   counted and reported, never deleted. Presence adds and corrects.
8. **Resolution never mutates canon.** Reconciliation to `core.*` is recorded on the
   landing row in nullable columns and is excluded from the importer's insert and update
   lists, so a re-import cannot wipe a human decision.

### 2.1 The importer guard ladder

Every loader runs these in order and aborts the whole snapshot on the first failure. A
partial load that reports success is the exact failure mode this ladder exists to prevent.

| Guard | What it refuses |
| --- | --- |
| G1 privilege | Anything but a positively matched `service_role` / `postgres` / `supabase_admin`. NULL fails. |
| G2 mode | Any mode but `mirror_only`. There is deliberately no promote path. |
| G3 advisory lock | Overlapping runs of the same loader. |
| G4 snapshot shape | A payload that is not an object with a `rows` array. |
| G5 non-empty | An empty `rows` array — a failed extract must not look like a success. |
| G6 provenance | A missing or unparseable `captured_at`. It is always explicit and never derived from `now()`, because the server runs `America/New_York` and a UTC-midnight timestamp read back through `::date` lands on the previous day. |
| G7 row shape / natural key | A row missing a required field; a duplicate natural key inside one snapshot. |
| G8 pinned baseline | A snapshot claiming the pinned capture date whose row counts do not match the verified extract. |
| G9 shrink band | A refresh losing more than `p_max_shrink_fraction` of the stored rows. |

**Error text must never echo a licensor value.** Logs are not private. The Warner loaders
report offending row *counts* and never a row identifier or a field value.

---

## 3. Warner Bros. STARLABS — the source extract

**Pinned source:** `u2giants/licensor-source-data`, path `warner-bros/`, `main` commit
`9092c51afc42c080f199e5784451425810c39316`, `warner-bros/` tree
`a9056fe9058a317bbfb18238c367cf4d4c642f05`. **Always read the pinned commit, never a
working tree** — see §7.

**Capture:** 2026-08-07, read-only, from the signed-in POP Creations licensee account. Two
authenticated pages: the Art Assets search page, and the Product submission page. The user
logged in personally; no password, MFA code, cookie, browser-storage value or token passed
through the session. No form was submitted and no Warner record was created or changed. No
asset content — artwork, PDF, video, style-guide document — was ever downloaded.

**Scope, and it is narrow.** One entitled contract and its territories, one licensee
account, one point in time, no change feed. This is **not** Warner's global catalogue. The
extract is authoritative for what it **asserts** and **silent** about what it **omits**.

### 3.1 Files and verified row counts

Counts below were re-verified against the pinned commit on 2026-08-10 and match the source
README exactly.

| File | Rows | Lands | Meaning |
| --- | ---: | ---: | --- |
| `franchise-properties.csv` | 341 | 341 | Franchise/Property identities |
| `style-guides.csv` | 2,310 | 2,304 | Style-guide identities |
| `characters.csv` | 4,301 | 4,299 | Character identities |
| `assets.csv` | 147,537 | 147,537 | Asset metadata only |
| `links-asset-style-guide.csv` | 147,484 | 147,484 | Direct asset → style guide |
| `links-asset-franchise-property.csv` | 335,946 | 335,946 | Direct asset → Franchise/Property |
| `links-asset-character.csv` | 51,036 | 51,036 | Direct asset → character |
| `links-property-character.csv` | 4,158 | 4,158 | **Direct Property → Character** |

Where *Lands* is lower than *Rows*, the difference is a documented natural-key collapse
(§5.2), reported by the loader as `rows_collapsed` — never a silent drop.

These counts are asserted by guard G8 whenever a snapshot declares capture date
2026-08-07, so a re-run against the wrong commit fails loudly.

### 3.2 Referential integrity of the extract

Verified 2026-08-10 against the pinned commit: **zero orphans**. Every id referenced by
every link file resolves to a row in the matching identity file, in all eight directions
checked. All 165 Product properties have identity rows.

---

## 4. THE FRANCHISE-vs-PROPERTY TRAP

**This is the whole risk of the Warner job. Read it before adding any object.**

Warner exposes **Franchise** and **Property** as **separate levels**. Three link objects
are therefore deliberately **absent** from the schema, and their absence is the design:

- **No** Franchise → Property object.
- **No** Style-Guide → Property object.
- **No** Style-Guide → Character object.

### Why

None of those three is a Warner record. Each could only be manufactured by joining two
rows that happen to share an asset. On 2026-08-07 every reachable STARLABS page was
audited — Home, Product, Packaging, Marketing, Jobs, Art Assets, Licensee Help, plus the
loaded page components and submission application code — and **no page and no read
operation exposed a direct Style-Guide-to-Property or Style-Guide-to-Character
relationship.** Art Assets implements Property, Style Guide and Character as three
**independent** asset filters.

**Two things appearing on the same asset is not Warner stating that they are linked.**
Once such a link is stored it is indistinguishable from a real one, forever. No later
reader can separate what Warner asserted from what we inferred. So the object that would
hold it is never created — not as a table, not as a view, not as an index, not as a join
inside a function.

### The specific traps the files set

- **`franchise-properties.csv` is one flat identity list, not a hierarchy.** Warner's own
  Art Assets filter is literally labelled `Franchise / Property` — a single combined filter
  spanning both levels — and the file also carries Product-page Property rows. The landing
  table keeps a `source_term` column recording which surface each row came from, and has
  **no parent column, no franchise id and no self-reference**, because the source asserts
  no parentage. Do not add one.
- **`links-asset-franchise-property.csv` links an asset to a franchise-or-property value.**
  It never links a franchise to a property. Self-joining it on the asset id would fabricate
  exactly the edge Warner does not publish.
- **`assets.csv` carries `property_labels` and `franchise_labels` as separate packed
  multi-value display strings**, alongside `character_labels`. They are stored verbatim and
  deliberately **not parsed**. They are provenance, not relationships. The three link
  tables are the only authoritative asset relationships. Splitting these columns into edges
  — or pairing `franchise_labels` with `property_labels` — manufactures the forbidden link.
  Corroborating evidence that the levels really are different: only **9** distinct
  franchise values span all 147,537 assets, against **241** property identities.
- **`links-property-character.csv` is the one direct Warner Property-to-Character record.**
  It comes from the Product submission page, where Warner itself returns a character array
  for a selected property through its own field lookup. All 4,158 rows carry real Warner
  ids on both endpoints (`id_fallback = false`), pinned by a CHECK constraint so a
  label-derived fallback extract fails loudly instead of landing pairs that look
  id-backed. The crawl read the component's fully loaded array, not the 20 rows the menu
  happened to render.

Issue #583 recorded that "Warner has no property→character link at all" and would need "a
third shape". **That is out of date.** The catalogue was captured afterwards. Warner has
the same Property-to-Character shape Disney and Paramount provide.

---

## 5. Identity rules that will corrupt the data if ignored

### 5.1 A label is never an identity

- **Characters:** 495 labels carry more than one distinct Warner UUID. The portal exposes
  separate UUIDs under the same visible name, and narrow one-result searches proved they
  point at genuinely different assets, properties and style guides. **Match on the id.
  Never on the label. Never dedupe repeated labels.**
- **Franchise/Property:** ids are 1:1 with labels in this snapshot, but the same guarantee
  does not extend to future captures.

### 5.2 Missing ids and the natural-key collapse

Warner did not expose an id everywhere, and the crawl ran in more than one pass, so the
identity files contain both id-bearing and label-only rows.

| Table | Missing ids | Collapse applied |
| --- | --- | --- |
| `plm.wb_franchise_property` | 100 of 341 rows have no id (99 repeat an id-bearing label) | none — the key is `(source_term, source_id, label)`, unique at 341 |
| `plm.wb_style_guide` | **all** 2,310 rows — Warner exposes no style-guide id at all | 6 label pairs collapse to 1 each (one row with an asset count, one without) → 2,304 |
| `plm.wb_character` | 97 of 4,301 rows | 2 label-only duplicates collapse → 4,299 |

Rules that follow:

- A missing id is stored as `''` (empty string), never `NULL`, so it can sit in a primary
  key. This is faithful to the CSV, which carries an empty field.
- The 99 blank-id Franchise/Property rows that repeat an id-bearing label are **kept
  verbatim, not merged**. Merging them would be our interpretation of identity; the landing
  table does not interpret. Resolve them in a view.
- The collapse keeps the greater `visible_asset_count` and is **reported** as
  `rows_collapsed` so a change in collapse volume is visible rather than silent.
- `plm.wb_style_guide.source_id` is pinned to `''` by CHECK. If a future extract carries a
  real style-guide id, **widen it in a new migration with a recorded reason**. Do not drop
  the constraint to make a load pass.

### 5.3 `visible_asset_count` is a UI artefact

It is Warner's displayed count for the signed-in entitlement at capture time, `NULL` where
the portal showed none. It is not a catalogue total. **Do not build logic on it.**

---

## 6. Object inventory — Warner (claim #627)

Migration `20260810030000_warner_starlabs_source_landing.sql`. 48 objects.

**Tables (8, all in `plm`):** `wb_franchise_property`, `wb_style_guide`, `wb_character`,
`wb_asset`, `wb_asset_style_guide`, `wb_asset_franchise_property`, `wb_asset_character`,
`wb_property_character`.

**Indexes (13):** `idx_wb_franchise_property_label`, `idx_wb_franchise_property_source_id`,
`idx_wb_character_label`, `idx_wb_character_source_id`,
`idx_wb_asset_style_guide_natural_key`, `idx_wb_asset_warner_asset_id`,
`idx_wb_asset_style_guide_style_guide_natural_key`,
`idx_wb_asset_franchise_property_target`, `idx_wb_asset_character_character_source_id`,
`idx_wb_property_character_property_source_id`,
`idx_wb_property_character_character_source_id`, `idx_wb_property_character_property_id`,
`idx_wb_property_character_resolution_status`.

**Policies (8):** one `<table>_read` per table.

**Functions (17):** `plm.wb_loader_privilege_ok(text, text)`; eight
`plm.sync_wb_<entity>(jsonb, text, numeric)`; eight matching
`public.sync_wb_<entity>(jsonb, text, numeric)` wrappers.

**Views (2):** `api.wb_property_character`, `api.wb_property_reconciliation`.

### What is deliberately NOT created

- No Franchise→Property, Style-Guide→Property or Style-Guide→Character object (§4).
- **No `core.*` object, and no write to `core.property_character`.** Whether Warner's 4,158
  pairs feed the same canonical table as Disney's is an **open owner decision** and has
  been given no code path. The only `core` reference is a nullable resolution FK on
  `plm.wb_property_character.property_id`, recorded on the landing row.
- **No foreign keys between the landing tables.** The loaders are per-entity, so an FK
  would make load order a hidden requirement and turn a routine refresh into a failure.
  Orphans are instead **counted and returned** by each link loader as
  `rows_orphan_identity`. Expected value against the pinned snapshot: **0**.

---

## 7. Operational traps

**Read the pinned commit, never the working tree.** On 2026-08-10 the checkout at
`C:\repos\licensor-source-data-warner` was on a feature branch with a **staged deletion of
`warner-bros/links-property-character.csv`** — the one file carrying the direct
Property-to-Character record — plus staged edits to three other files. An agent reading
that directory off disk would have loaded a Warner extract with **zero** direct
Property-to-Character rows and reported success. Use `git show <pinned-sha>:<path>`.

**Two Warner PRs are not competing.** Issue #583 warned of two unmerged PRs with different
row counts. PR #3 and its follow-ups #6, #7 and #8 are **merged**; only PR #2 is still
open, and it is an abandoned first checkpoint containing 2 asset rows and neither of the
two most important files. PR #3's lineage is authoritative.

**All eight loaders may run in one transaction.** `ON COMMIT DROP` does not fire until the
transaction ends, so each loader drops its scratch tables before creating them. Do not
remove those drops.

---

## 8. Adding the next licensor

1. Claim a `plm.<prefix>_*` namespace through the orchestrator before writing anything.
2. Put the raw extract in `u2giants/licensor-source-data` only, and pin a commit.
3. Verify the README's row counts against the pinned commit yourself, and check
   referential integrity across the files, before designing the tables.
4. Follow §2 exactly, including the full guard ladder and the pinned-baseline assertion.
5. **Write down which relationships the portal states directly and which would be
   inferred, and create objects only for the direct ones.** This is the step that protects
   the data. Warner's Franchise/Property trap will have an analogue in every portal.
6. Update the table in §1.
