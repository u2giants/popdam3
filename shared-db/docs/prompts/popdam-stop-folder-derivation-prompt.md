*2026-08-09 · Originated from shared-db orchestrator session 8b3f21c4*

# POPDAM: STOP DERIVING LICENSOR AND PROPERTY FROM FOLDER NAMES AND DIRECTORY TREES

**Repo:** `u2giants/popdam3`. This asks you to remove code that is currently running in production. The evidence is below, measured, so you can check every number yourself before you delete anything.

**The decision, from the business owner:** *"Stop setting styles' attributes from folder names and directory trees. We now have the ColdLion API and direct info from licensors themselves. Folder names and directory trees are the LEAST accurate option."*

## What the code does now

`supabase/functions/_shared/metadata-derivation.ts:98-105` derives an asset's licensor by taking **path segment 3 by position**, assuming every licensed asset lives at:

```
Decor/Character Licensed/[Licensor]/[Property]/...
```

It then looks that segment up in `core.licensor` by name and writes the resulting `licensor_id` / `property_id` onto the asset.

## Why it has to go — six measured facts

1. **The assumed layout is essentially extinct.** A folder reorganisation moved everything under `____New Structure`. Of **117,969** licensed assets, **117,576 (99.7%)** now sit at `Decor/Character Licensed/____New Structure/...`, where segment 3 is the literal string `____New Structure` and matches no licensor. **Only 393 assets still match the layout the resolver expects.**
2. **9,973 assets carry a licensor foreign key that disagrees with their own licensor code.** 99.3% of them sit under the new structure.
3. **99.0% of those disagreements date to the March 2026 bulk load** — 9,875 of 9,973. April onward produced 75, 11, 9 and 3.
4. **Since the reorg the resolver has stopped producing wrong values and started producing none.** By month, the share of newly ingested assets with a null licensor FK runs 78%, 96%, 99%, 99.7%. It is not working. It is silently returning nothing.
5. **73,476 licensed assets have no property at all.**
6. **The two halves can never be reconciled, by design.** Both writers fill the FK columns only when they are null (`metadata-handlers.ts:73-78`) and never correct a wrong value, while the SKU-derived text columns are rewritten on every scan (`agent-api/index.ts:923`, `metadata-handlers.ts:157`). So the March values are frozen forever while the text keeps moving. Nothing in the system can pull them back together.

**One latent bug worth fixing regardless.** `____New Structure` contains four underscores. Underscore is a single-character wildcard in SQL `LIKE`, and this string is passed straight into `.ilike()` at `metadata-derivation.ts:119`. Today it matches nothing. The day a licensor is named to fit that pattern, it silently captures thousands of assets with no error. Never pass an unescaped path segment into `ilike`.

## What to build instead

**ColdLion API data and direct licensor data are authoritative. Folder position is not evidence and must not be used as a source or as a fallback.**

- Remove licensor and property derivation from `metadata-derivation.ts` entirely. Do not "improve" the path parsing, do not add more folder patterns, do not make it smarter about `____New Structure`. Position in a directory tree is not a fact about licensing.
- Keep `is_licensed` and `workflow_status` from the path. Those are genuine folder semantics and are not in scope.
- Take licensor and property identity from the ColdLion API and from direct licensor data.
- **Know the limit of ColdLion before you design around it.** ColdLion's MG05 gives you licensor code → name. MG06 gives you property code → name. **Neither carries any link between them.** We verified this across all 614 mirrored records: the complete field set ColdLion sends is `companyCode, createdTime, createdUser, divisionCode, itemNoCode, mgCategory, mgCode, mgCode2, mgDesc, mgTypeCode, modTime, modUser`, with `mgCategory` empty on every row. There is no owner field. So the licensor-to-property relationship must come from the curated taxonomy in `u2giants/shared-db` (`core.licensor` / `core.property`), not from ColdLion and not from you.
- Also note `mgTypeCode` is division-scoped: `05` means Licensor in `CW001`/`SP001` but Big Theme in `EH001` and Product Line in `EP001`. Codes are unique only per `(division, mgTypeCode)` — never globally. Do not build a global code map.

## When authoritative data is missing

**Leave it null and surface it. Never guess from a path.** No silent failures — this is a standing rule here.

- Write `null`, not a fallback and not a best guess.
- Record the miss somewhere a human will actually see it: a counter, an unresolved-items view, or an admin surface listing assets with no licensor or no property and why.
- A scan that could not resolve 5,000 assets must say so loudly in its result, not return `ok: true` and move on.
- An asset with no licensor is an honest gap someone can fix. An asset with a guessed licensor is a compliance problem nobody knows they have. We currently have 9,973 of the second kind.

## Out of scope

Do not repair existing data. Correcting the 9,973 and the 73,476 is owner-gated and sequenced separately in `u2giants/shared-db`. Your job is to stop new bad values being written and to stop old ones being frozen in place.
