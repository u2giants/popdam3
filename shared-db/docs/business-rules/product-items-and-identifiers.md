# Products, items, SKUs, and identifiers

**Status:** Proposed

## Identity

A Product or Item is the business object. A SKU, style number, ERP item number, and application row ID are identifiers for that object; none should be confused with the object itself. Separate source references must be retained when multiple systems describe the same Item.

Designs and creative concepts remain business assets even when no buyer selects them. Approved but unsold concepts and unpicked designs must remain findable and reusable rather than disappearing inside an old project.

## Style numbers

A ColdLion style number is required only when a user requests ColdLion numbering. Draft or earlier-stage Items may exist without one. When supplied, each merchandise-group component used to request the number must exist and be active.

A failure to obtain a ColdLion style number must not destroy the Item or silently invent a number.

## Classification and descriptions

Product classification follows [`merchandise-and-product-taxonomy.md`](merchandise-and-product-taxonomy.md). A controlled description keeps Product Type, subtype, Licensor, Property, artwork wording, and size as separate facts even when presented as one readable description.

## Lifecycle

Stage, lifecycle, next action, owner, blocker, and required evidence are different facts. A single status label must not be made to carry all of them. Every transition that becomes Settled must identify the object, starting and ending state, permitted role, required evidence, next owner, rejection/reversal behavior, and related notifications.

## Implementation and evidence

Application plans and Item Master validation notes may describe screens, endpoints, fields, and proposed transitions. They must link here and to [`product-development-workflow.md`](product-development-workflow.md) instead of becoming separate business authorities.
