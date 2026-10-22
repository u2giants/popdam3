# Handoff — AI tags/descriptions: licensor & property restored (live proof pending)

## 1. Goal
AI image tagging (all models, incl. the vision bake-off) must again carry licensing names:
licensor **in tags only**; property **in tags and in `ai_description`** (owner rule, Albert, 2026-10-19).

## 2. Status
- DONE: merged [u2giants/popdam3#439](https://github.com/u2giants/popdam3/pull/439) (squash `c2f64f73`). Railway worker deployment for `c2f64f73` reported success; edge functions + frontend workflows green.
- NOT DONE: live proof on real files.

## 3. Root cause
Commit `16cc5070` (2026-08-26, "scope AI metadata by asset and style group") told models that licensor/property belong to the Style Group and must not appear in file tags or descriptions. The prompt also never told the model the file's own licensor/property.

## 4. What changed
- Prompt contract: [supabase/functions/_shared/tag-asset-contract.js](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/tag-asset-contract.js) (mirrored byte-for-byte in [apps/worker/vendor/tag-asset-contract.js](https://github.com/u2giants/popdam3/blob/main/apps/worker/vendor/tag-asset-contract.js)) — adds "Licensing for this file (authoritative)" block and the new rules.
- Name lookup: `resolveLicensingNames` in [apps/worker/src/handlers/ai-tagging-shared.ts](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/ai-tagging-shared.ts) — grouped files use `style_groups.licensor_name/property_name`; ungrouped use `core.licensor/property` by the asset's IDs. Bake-off asset select now includes `style_group_id`.
- Owner change recorded in [plan_style_group_scoped_ai_metadata.md](https://github.com/u2giants/popdam3/blob/main/plan_style_group_scoped_ai_metadata.md).

## 5. Tried / rejected
First version read only the asset's own IDs; DeepSeek review REJECTED it (grouped assets often have null asset IDs). Fixed; re-review APPROVE.

## 6. Next action (live proof)
Run a vision bake-off (or a retag) on GFA7HMVSP and Mickey_Lemons. Success = tags contain `marvel` + `spider-man` (GFA7HMVSP) and `disney` + the property (Mickey_Lemons); descriptions name the property but not the licensor.

## 7. If it still fails
Check whether the asset's Style Group has `licensor_name/property_name` filled; if null, the model gets no licensing block — that is a data gap, not the prompt.

## 8. Risks
Tag validation rejects duplicate tags; prompt tells the model to tag a shared licensor/property name once.

## 9. Owner
Next Claude/Codex session in u2giants/popdam3.

Posted by Claude chat 0de4f387-a39c-426f-ae73-05dfbbc7845b on edge-dev3
