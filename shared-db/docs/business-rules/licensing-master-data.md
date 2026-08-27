# Licensing Master Data

**Status:** Settled

**Controlling owner rulings:** Albert Hazan, 2026-08-16, 2026-08-19, 2026-08-23, and 2026-08-25. The 2026-08-23 ruling establishes signed-contract authority for Warner Bros. licensing membership. The 2026-08-25 ruling records the Marvel portal-authority split effective December 2025.

## Official business objects

Licensing Master Data consists of Licensors, Properties, Characters, Style Guides, licensed Asset metadata, and Franchises or equivalent source-defined families.

## Authority

- ColdLion owns official Licensor names.
- Inside an authorized licensor scrape's Property coverage, that source owns official Property names, ownership, entities, and direct relationships it publishes.
- For a ColdLion-only Property under a Licensor that has no authorized scrape data, ColdLion's Property name and owning Licensor are canonical truth.
- ColdLion owns whether POP currently carries a Property except where Albert identifies a signed agreement and amendments as the controlling entitlement schedule. Warner Bros. is the first such exception; its signed contract schedule controls Active/Inactive licensing membership.
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

## Warner Bros. contract entitlement

**Status: Settled. Authority: Albert Hazan, 2026-08-23, based on the countersigned Warner Bros. agreement and Amendments 1-3.**

- For POP's Warner Bros. agreement, the signed agreement plus countersigned Amendments 1, 2, and 3 are the controlling authority for which Properties are licensed. They form one continuous schedule of 163 Licensed Properties.
- The exact confidential list lives only in the private `u2giants/licensor-source-data` repository at `warner-bros/contract-properties.csv`. This public Business Logic Library intentionally points to that file instead of reproducing licensed rows.
- `warner-bros/contract-property-canonical-mapping.csv` connects every signed contract entry to one canonical STARLABS Submissions Property identity. Submissions remains the canonical Warner name and identity vocabulary; the contract controls licensing membership.
- Creative Assets or Art Assets visibility is not evidence of entitlement. A Property, file, or style guide being reachable in STARLABS does not make it licensed.
- `warner-bros/creative-property-license-status.csv` is the private operational decision file for all 360 Creative Assets Property identities. As verified on 2026-08-23, it records 261 licensed identities, 97 inactive identities absent from the signed schedule, 2 inactive portal utility values that are not licenses, and 0 unresolved.
- Inactive or non-license Creative Assets identities remain preserved as source evidence, but they must not create canonical Property, Asset, or Style Guide links. Portal-presence status is separate: a source record may remain active in a capture manifest while its licensing status is inactive.
- A future signed amendment changes Warner entitlement only after the private contract schedule and mappings are updated and revalidated. A portal refresh, ColdLion change, or newly visible asset cannot supersede the signed schedule by itself.

## Relationships

- One Licensor may own many Properties; each Property has one owning Licensor at a time.
- A Character may belong to multiple Properties.
- A Style Guide may contain multiple Characters, and a Character may appear in multiple Style Guides.
- Asset, Property, Character, Style Guide, and Franchise relationships become canonical only when the authorized source publishes the relationship directly.
- Co-occurrence, filename similarity, internal lists, or absence of better data do not prove a direct relationship.
- Sub-licensing routes stay flat in the current Licensor model. A sub-licensor such as Desperate or FanCreations remains an ordinary Licensor record and must not be merged with the underlying brand owner merely because the names are related.

## Marvel portal authority

**Status: Settled. Authority: Albert Hazan, 2026-08-25. Effective: December 2025.**

- Marvel product submissions and product approvals are performed in Disney OPA as of December 2025. OPA is therefore the authoritative workflow and submission-side vocabulary for current Marvel product submissions.
- Marvel ASGARD remains the authoritative source for Marvel Creative Assets, including style guides, asset-library organization, and creative-asset search metadata.
- The portals have different business roles. An ASGARD guide, campaign, film, art pack, folder, or search value must not be promoted to a canonical submission Property merely because its label resembles an OPA option.
- OPA submission evidence and ASGARD Creative Asset evidence must retain separate source provenance. Where the two use different labels, preserve both and leave any unresolved mapping explicit rather than forcing a name match.
- Historical Marvel submission records created before the December 2025 transition retain their original source provenance. This ruling changes the current workflow authority; it does not relabel historical records as OPA-originated.

## Disney source-purpose authority

**Status: Settled. Authority: Albert Hazan, 2026-08-26.**

- OPA is the Submissions workflow for Disney, Marvel, Lucasfilm / Star Wars, and Pixar. Marvel submissions remain under the Disney OPA branch by business rule.
- Direct OPA creation-branch membership is authoritative studio/licensor scope evidence. Property-name keywords and landing-table families are not authority. One Property may legitimately appear in more than one route, and absent or conflicting current approved scope evidence remains explicit for Licensing review.
- DCP Vault is Creative authority only for Disney and Lucasfilm / Star Wars. Marvel Creative authority is ASGARD only. Marvel-tagged DCP rows are retained as mixed-guide raw evidence but excluded from Marvel Creative presentation.
- DCP presentation decisions preserve exact source identity and immutable supersession history. Only the deterministic latest approved decision is current. `supported_owner_source_label` means an owner-approved source-title-family declaration; it is not exact OPA evidence.
- The known OPA Property-to-Character extract does not prove that other portal hierarchy relationships are absent. Capture direct hierarchy selectors when available; never synthesize them from `brandPropertyID`, constant `optionSourceID`, names, or table families.

## Talent likeness and royalty

Marvel charges two additional royalty percentage points when artwork contains talent likeness. Marvel is the only Licensor with this confirmed rule. The likeness flag belongs to the specific Style Guide Asset file, never to the Character or Property.

## Refresh cadence and conflict handling

Authorized licensor sources run at least weekly. Within their Property coverage, an authorized source wins disagreements about Property spelling or ownership. Outside that coverage, ColdLion-only Property data under a Licensor with no scrape data is canonical. ColdLion remains authoritative for Licensor names and normally for Property Active/Inactive, except where a signed entitlement schedule is explicitly controlling, as it is for Warner Bros. When identity or coverage is ambiguous, retain evidence and send it to review rather than guessing.

## Implementation and evidence

The detailed source matrix, entity model, provenance rules, and structural contract remain in [`../core-master-data-consolidation-aim.md`](../core-master-data-consolidation-aim.md). This page is the companywide business authority.
