# Licensing Master Data

**Status:** Settled

**Controlling owner ruling:** Albert Hazan, 2026-08-16. Additional dated rulings are identified below and in the linked evidence.

## Official business objects

Licensing Master Data consists of Licensors, Properties, Characters, Style Guides, licensed Asset metadata, and Franchises or equivalent source-defined families.

## Authority

- An authorized licensor source owns official names, ownership, and relationships it publishes directly inside its licensed scope.
- ColdLion owns one separate fact: whether POP currently carries a Property. Present in a complete current ColdLion set means Active; absent means Inactive.
- DesignFlow's old imported licensing data has no authority for names, ownership, relationships, or Active/Inactive status.
- Internal spelling may be retained as an alias but must not replace a source-owned official name.
- Absence from a source never proves that an entity ceased to exist. Preserve the row and flag disappearance for review.
- Property codes are unique only with their owning Licensor. Never resolve a Property from its code alone.
- Item or Property letters do not identify a Licensor without the accompanying description. `CC`, for example, can refer to Disney's Coco or Coca-Cola depending on the description.
- `DY` and `DS` both describe the same Disney company for licensing identity. They must not create two Disney Licensors.
- `FR` was not a real Licensor in the ColdLion source. Do not promote it to one from an old code alone.

## Creation and status

A Property discovered by an authorized licensor source starts Potential. A Property proposed only from ColdLion requires Licensing confirmation of its official name and owning Licensor before creation. Guarded ColdLion membership may then make it Active or Inactive.

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

Authorized licensor sources run at least weekly. When an authorized source disagrees with ColdLion or an application about Property spelling or ownership, the licensor source wins. When a mapping is ambiguous, retain evidence and send it to review rather than guessing.

## Implementation and evidence

The detailed source matrix, entity model, provenance rules, and structural contract remain in [`../core-master-data-consolidation-aim.md`](../core-master-data-consolidation-aim.md). This page is the companywide business authority.
