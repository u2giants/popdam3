# Licensing Master Data

**Status:** Settled

**Controlling owner rulings:** Albert Hazan, 2026-08-16, 2026-08-19, 2026-08-23, 2026-08-25, and 2026-09-06. The 2026-09-06 ruling records that Paramount, Viacom Multi and Nickelodeon are one Licensor. The 2026-08-23 ruling establishes signed-contract authority for Warner Bros. licensing membership. The 2026-08-25 ruling records the Marvel portal-authority split effective December 2025.

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

## Licensor naming aliases

**Settled - Albert Hazan, 2026-09-06.** The Licensor recorded as `VM` / "Viacom Multi" is Paramount, and is also the Nickelodeon licensor. Paramount, Viacom and Nickelodeon are one Licensor under this single record, not three. Any item, property or asset whose description names Paramount or Nickelodeon resolves to this Licensor. Never create a separate Paramount or Nickelodeon Licensor, and never report such an item as having an unknown Licensor because the word "Paramount" does not appear in the Licensor list.

## Creation and status

A Property discovered by an authorized licensor source starts Potential. A ColdLion-only Property under a Licensor with no authorized scrape data may be created from ColdLion's name and ownership as canonical truth, subject to identity and collision safeguards. Guarded ColdLion membership then makes it Active or Inactive. A ColdLion Property inside a scrape-covered Licensor's scope still waits for the authorized scrape or Licensing review when its canonical match is unresolved.

No refresh hard-deletes licensing Master Data.

## Warner Bros. contract entitlement

**Status: Settled. Authority: Albert Hazan, 2026-08-23, based on the countersigned Warner Bros. agreement and Amendments 1-3.**

- For POP's Warner Bros. agreement, the signed agreement plus countersigned Amendments 1, 2, and 3 are the controlling authority for which Properties are licensed. They form one continuous schedule of 163 Licensed Properties.
- The exact confidential list lives only in the private `u2giants/licensor-source-data` repository at `warner-bros/contract-properties.csv`. This public Business Logic Library intentionally points to that file instead of reproducing licensed rows.
- `warner-bros/contract-property-canonical-mapping.csv` connects every signed contract entry to one canonical STARLABS Submissions Property identity. Submissions remains the canonical Warner name and identity vocabulary; the contract controls licensing membership.
- Creative Assets or Art Assets visibility is not evidence of entitlement. A Property, file, or style guide being reachable in STARLABS does not make it licensed.
- **"360" means the Art Assets vocabulary only.** The Warner Creative source holds two separate Property vocabularies, and a count is meaningless without saying which one. As re-measured read-only against production on 2026-09-04: the Art Assets vocabulary holds **360** identities (227 identified by the source's own id, 133 by a natural-key fallback) and the Product Catalogue vocabulary holds a further **165**, for **525** Warner Creative Property identities in total. Wherever this page or a review package says 360, it means the Art Assets vocabulary; a 525 figure means both vocabularies together. Neither number is wrong.
- `warner-bros/creative-property-license-status.csv` is the private operational decision file for the 360 **Art Assets** Creative Property identities. As verified on 2026-08-23, it records 261 licensed identities, 97 inactive identities absent from the signed schedule, 2 inactive portal utility values that are not licenses, and 0 unresolved. **The 165 Product Catalogue identities are not covered by that file** and carry no licensing decision yet.
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

**Status: Settled. Authority: Albert Hazan, 2026-08-26 and 2026-08-27.**

- OPA is the Submissions workflow for Disney, Marvel, Lucasfilm / Star Wars, and Pixar. Marvel submissions remain under the Disney OPA branch by business rule.

### OPA cannot separate Marvel from Disney

**Status: Settled. Authority: Albert Hazan, 2026-08-31.**

- When Disney moved Marvel product submissions out of ASGARD into OPA, Marvel was merged into the Disney creation branch rather than given its own branch. Lucasfilm / Star Wars did keep its own branch.
- This is confirmed in the captured OPA data, not assumed. Every captured OPA Property carries exactly one branch, and only two branch values exist: `disney` (1,445 Properties) and `lucasfilm` (74). Marvel Properties such as Avengers, Black Panther, and Deadpool Classic sit under `disney` and are identical to non-Marvel Disney Properties on every other captured axis (region, line of business, product type, template, workflow). No hidden backend separator exists behind the OPA front end.
- Consequence: OPA branch membership can prove that a Property is *not* Lucasfilm / Star Wars, but it can never distinguish Marvel from Disney. Direct OPA scope is therefore insufficient authority for the Disney-versus-Marvel question.
- Ruling: for the Disney and Marvel split only, the signed contract schedule is the controlling authority. Contract section membership decides Marvel versus Disney, and an OPA `disney` branch value must not be treated as a contradiction of a contract clause that places the Property under Marvel. Lucasfilm / Star Wars is unaffected and keeps the existing contract-and-OPA agreement rule.
- Marvel Creative Asset authority is unchanged and remains ASGARD.

### OPA submissions presence is authority for entitlement

**Current-rights refinement (owner issue #2703, 2026-09-10):** OPA's paired
`Show Compliant Only` and `Show All` observations distinguish current selection
rights for the exact Property, route and authenticated account scope. Only the
newest approved complete explicit `compliant` observation permits new styles or
new introduction into ColdLion. An explicit `non_compliant` observation blocks
those new uses, while retaining historical styles, existing ColdLion identities
and source records. OPA does not distinguish formerly-held from never-held rights.
Legacy observations without two-view evidence are `unknown`, not current-rights
proof. A later explicit compliant observation may reactivate selection; omission
from a newer Show All never deletes or deactivates a Property. Evidence review
approval and compliance are separate facts. Studio placement and historical
Creative/Submissions mapping remain governed by their independent authority rules.
See [the structural and private-loader contract](../app-migration-notes/opa-route-compliance-loader-contract.md).

**Status: Settled. Authority: Albert Hazan, 2026-09-05.**

- Ruling: "If they appear in the OPA submissions system we have rights, regardless of the contract and we'll go by the submissions system." A Disney-family Property present in the captured OPA submissions system is licensed to POP, whether or not a signed contract clause names it.
- This governs ENTITLEMENT only - whether POP holds rights to a Property. It does not disturb the 2026-08-31 ruling above, which governs STUDIO PLACEMENT: whether a Property is Marvel or Disney is still decided by the signed contract schedule, because OPA branch membership cannot distinguish them.
- Consequence for DCP Creative: a DCP Vault source identity may acquire studio placement through an approved exact-source-identity crosswalk to OPA `licensed_property_id` values alone, with no contract assertion. The resolution ledger records this by leaving the contract assertion columns null; a null there now means "authority is the submissions system", not "authority is missing".
- Why this was needed: the K2557 crosswalk only ever created resolution rows for contract-named Properties. 180 captured DCP Vault identities had no ledger row at all, so they presented as "DCP Creative - unresolved authority" permanently while being invisible to the review queue, which lists only identities that already carry a pending row. Cinderella was the owner-reported example - matched to OPA Properties 115 and 959 by name, named by no clause.
- Applied 2026-09-05: 96 of those 180 resolve to exactly one OPA Property and were recorded as approved on submissions-system authority. The remaining 84 have no OPA Property at all and are therefore NOT covered by this ruling; they are mostly shorts, umbrella and marketing slugs. Absence from OPA is not by itself a ruling that POP lacks rights - it is an open question.
- A Property absent from OPA gains nothing from this rule. Entitlement for those still needs a contract clause or a separate owner ruling.
- Signed agreements and schedules govern POP entitlement and every explicit Property-to-Licensor relationship they state. Direct captured OPA creation-branch membership governs submissions-system Property scope and relationships. Neither authority may be inferred from normalized names, canonical Master Data ownership, source labels, or landing-table families. Contract and direct OPA disagreement fails closed with both concrete assertions retained for Licensing review.
- DCP Vault is Creative style-guide and asset evidence only for Disney and Lucasfilm / Star Wars; it cannot assign Property ownership. DCP Creative presentation may acquire studio placement only through an explicit approved exact-source-identity crosswalk to one or more OPA `licensed_property_id` values and an authoritative signed-contract assertion, direct latest-approved OPA scope, or both in agreement. Missing authority, conflicting direct OPA scopes, and contract/OPA disagreement fail closed. Marvel Creative authority is ASGARD only; Marvel-tagged DCP rows remain mixed-guide raw evidence and are excluded from Marvel Creative presentation.
- The historical DCP presentation-resolution ledger remains immutable evidence but is no longer current Property-to-Licensor/Studio authority. Its old contract, canonical, name, and source-title decisions must not drive current presentation.
- The known OPA Property-to-Character extract does not prove that other portal hierarchy relationships are absent. Capture direct hierarchy selectors when available; never synthesize them from `brandPropertyID`, constant `optionSourceID`, names, or table families.

## Source-purpose presentation

DB Data Admin presents scraped Property vocabularies by Licensor and business
purpose, not by landing-table family. Every section is either `Submissions` or
`Creative`; a Licensor with both has two sections because their vocabularies
may differ.

Source-internal labels do not create Licensors. Sega is one Licensor with two
source-purpose sections. Peanuts' source field named `property` means Art
Program, not a POP licensing Property.

Creative-to-Submissions equivalence requires authoritative direct evidence or
an explicit reviewed decision. Similar names are not a mapping. Every
unresolved Creative Property stays visible and is highlighted red in DB Data
Admin. Contract evidence remains separate and reports incomplete document
chains explicitly rather than inferring missing terms.

## Talent likeness and royalty

Marvel charges two additional royalty percentage points when artwork contains talent likeness. Marvel is the only Licensor with this confirmed rule. The likeness flag belongs to the specific Style Guide Asset file, never to the Character or Property.

## Refresh cadence and conflict handling

Authorized licensor sources run at least weekly. Within their Property coverage, an authorized source wins disagreements about Property spelling or ownership. Outside that coverage, ColdLion-only Property data under a Licensor with no scrape data is canonical. ColdLion remains authoritative for Licensor names and normally for Property Active/Inactive, except where a signed entitlement schedule is explicitly controlling, as it is for Warner Bros. When identity or coverage is ambiguous, retain evidence and send it to review rather than guessing.

## Implementation and evidence

The detailed source matrix, entity model, provenance rules, and structural contract remain in [`../core-master-data-consolidation-aim.md`](../core-master-data-consolidation-aim.md). This page is the companywide business authority.
