# Licensor term and territory structural sweep — issue #1242

## Result

The migration removes the only schema whose values were sourced from a licence
contract: `plm.nbcu_right`. It also removes that table's count from
`plm.finalize_nbcu_capture`, so the NBCU publication gate continues to validate
the portal capture without silently referring to a missing table.

No portal-derived row or field is removed. Warner's retired flat table and API
view (`plm.wb_property_character` and `api.wb_property_character`) were already
dropped by migration `20260814170749`; the live portal relationship is
`plm.wb_property_character_normalized`, and this change leaves it untouched.

## Sweep classification

The repository migrations were searched for licence/license, term, territory,
region, expiry/expiration, renewal, restriction and rights fields and comments.
Hits were classified by provenance rather than by their English word alone.

| Source area | Result | Reason |
|---|---|---|
| NBCU Creative Asset Factory | Remove `plm.nbcu_right`; preserve `licensed_scope_label`, asset `restriction_labels`, `excluded_unlicensed_assets`, and portal relationship tables | `nbcu_right` was explicitly transcribed from a contract. The other fields are observations or controls from the authorized portal capture. |
| Warner STARLABS | Preserve `plm.wb_property_character_normalized` and all source fields; make no Warner DDL change | The live relationships, identifiers, labels, capture evidence, and URL are portal-scraped. The old flat table and stale API view are already retired. |
| Disney OPA and DCP Vault | Preserve OPA selector `regionName`, DCP style-guide `region`, and DCP metadata `rights_parse_confident` | These are portal selector/folder/metadata values, not licence territory or term records. |
| Paramount Creative Library | Preserve licensed-selection flags and counts | These describe what the authenticated portal returned and how the capture was filtered; they do not model a contract term or territory. |
| Sesame Workshop NetX | Preserve `in_licensee_portal` and `usage_rights_label` | Both are source-faithful portal metadata. |
| Peanuts, WildBrain/Strawberry Shortcake, Sega | No contract-derived term, territory, expiry, renewal, restriction, or rights structure found | Search hits did not identify a governed structural removal. |
| ColdLion and application schemas | Preserve operational dates, customer region codes, production dates, status fields, and lease-renewal mechanics | These uses describe ERP/application operations, geography, or software leases—not licensor contract terms or territories. |

## Safety gates

- The migration aborts if `plm.nbcu_right` unexpectedly contains any row.
- `plm.finalize_nbcu_capture` retains every portal entity, relationship,
  completeness, metadata, and exclusion check; only the obsolete rights count is
  absent.
- The migration contains no `DROP` or row rewrite for Warner, Disney, Paramount,
  Sesame, Peanuts, WildBrain, or Sega portal data.

The private NBCU import specification is outside this public repository. Its
source-of-record wording must be corrected in the private source-data workflow;
no private licensed artifact is copied here.
