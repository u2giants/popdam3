# Licensing Master Data

**Status:** Settled

**Controlling owner rulings:** Albert Hazan, 2026-08-16 and 2026-08-19. The later ruling clarifies ColdLion authority for Licensor names and for Properties outside scrape coverage.

## Official business objects

Licensing Master Data consists of Licensors, Properties, Characters, Style Guides, licensed Asset metadata, and Franchises or equivalent source-defined families.

## Authority

- ColdLion owns official Licensor names.
- Inside an authorized licensor scrape's Property coverage, that source owns official Property names, ownership, entities, and direct relationships it publishes.
- For a ColdLion-only Property under a Licensor that has no authorized scrape data, ColdLion's Property name and owning Licensor are canonical truth.
- ColdLion also owns whether POP currently carries a Property. Present in a complete current ColdLion set means Active; absent means Inactive.
- DesignFlow's old imported licensing data has no authority for names, ownership, relationships, or Active/Inactive status.
- Internal spelling may be retained as an alias but must not replace a source-owned official name.
- Absence from a source never proves that an entity ceased to exist. Preserve the row and flag disappearance for review.
- Property codes are unique only with their owning Licensor. Never resolve a Property from its code alone.
- Item or Property letters do not identify a Licensor without the accompanying description. `CC`, for example, can refer to Disney's Coco or Coca-Cola depending on the description.
- `DY` and `DS` both describe the same Disney company for licensing identity. They must not create two Disney Licensors.
- `FR` was not a real Licensor in the ColdLion source. Do not promote it to one from an old code alone.

## Creation and status

A Property discovered by an authorized licensor source starts Potential. A ColdLion-only Property under a Licensor with no authorized scrape data may be created from ColdLion's name and ownership as canonical truth, subject to identity and collision safeguards. Guarded ColdLion membership then makes it Active or Inactive. A ColdLion Property inside a scrape-covered Licensor's scope still waits for the authorized scrape or Licensing review when its canonical match is unresolved.

No refresh hard-deletes licensing Master Data.

## Relationships

- One Licensor may own many Properties; each Property has one owning Licensor at a time.
- A Character may belong to multiple Properties.
- A Style Guide may contain multiple Characters, and a Character may appear in multiple Style Guides.
- Asset, Property, Character, Style Guide, and Franchise relationships become canonical only when the authorized source publishes the relationship directly.
- Co-occurrence, filename similarity, internal lists, or absence of better data do not prove a direct relationship.
- Sub-licensing routes stay flat in the current Licensor model. A sub-licensor such as Desperate or FanCreations remains an ordinary Licensor record and must not be merged with the underlying brand owner merely because the names are related.

## Talent likeness and royalty

Marvel charges two additional royalty percentage points when artwork contains talent likeness. Marvel is the only Licensor with this confirmed rule. The likeness flag belongs to the specific Style Guide Asset file, never to the Character or Property.

## Refresh cadence and conflict handling

Authorized licensor sources run at least weekly. Within their Property coverage, an authorized source wins disagreements about Property spelling or ownership. Outside that coverage, ColdLion-only Property data under a Licensor with no scrape data is canonical. ColdLion remains authoritative for Licensor names and Property Active/Inactive. When identity or coverage is ambiguous, retain evidence and send it to review rather than guessing.

## Implementation and evidence

The detailed source matrix, entity model, provenance rules, and structural contract remain in [`../core-master-data-consolidation-aim.md`](../core-master-data-consolidation-aim.md). This page is the companywide business authority.
