# Tariff and HTS classification

**Status:** Proposed

## Business purpose

Tariff classification determines landed cost and compliance exposure. The system supports a human decision; it must not silently turn an uncertain AI suggestion into an authoritative classification.

## Authority and reasoning order

1. A directly applicable binding customs ruling is the strongest classification evidence.
2. The current official tariff schedule supplies heading text and rates.
3. Product identity, primary function, material, use context, construction, and installed-versus-portable distinctions support classification reasoning.
4. AI and internal precedent retrieval are decision support, not legal authority.

The reasoning must compare plausible headings and apply the governing interpretation principles. A product-to-code shortcut is not a durable rule merely because it worked once.

## Confidence and questions

If required product facts are missing, the workflow asks a focused question. It must not present medium- or low-confidence output as a completed classification. Human correction remains visible and should improve general reasoning, not create an unexplained one-product exception.

## Duty components

Base duty, trade-remedy duty, reciprocal/country duty, and any specific dollar-per-unit duty are separate components. Store the components and the resulting total so a later reviewer can explain the number. A compound or non-percentage rate must not be forced into a percentage field.

Country defaults may prefill an empty field but must not overwrite a user's reviewed quote-specific value.

## External-data freshness

Government tariff schedules, trade-remedy lists, rulings, and country rates can change. Every operational dataset must retain source and effective date. Repository documentation may preserve historical rates as evidence, but it is not authority for today's legal rate.

## AI and precedent safety

Internal precedent search remains suggestion-only until measured comparison proves it safe. Revoked rulings cannot support a recommendation. AI failures, missing evidence, and fallback paths must be visible.

## Implementation and evidence

DesignFlow's [classification reference](https://github.com/popcre/designflow-frontend/blob/develop/docs/ai-classification.md), backend HTS documents, and RFQ implementation files record system behavior and historical data-import choices. They must link here and remain implementation evidence, not a second business-rule source.
