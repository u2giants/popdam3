# Preview refusal and forward repair — 2026-08-30

Migration `20260830195655` refused and rolled back transactionally in preview run `33333416016`. Production was untouched.

Read-only preview queries returned schema names and aggregate counts only; no asset identifier, SKU, name, or row content was exposed. Of 30 rows whose `licensor_code` is `DS`, all 30 remain `is_licensed = false`, none has a licensor name, none has a property link, and 29 retain no licensor link. The remaining row links to an existing active non-Disney core licensor whose code is neither `DS` nor `DY`; it does not link to either legacy target row.

Therefore `licensor_id is null` was an over-broad proxy, not the licensing invariant. Successor `20260830204711` preserves every asset and style-group row and refuses if a `DS` row becomes licensed, named, property-linked, Disney-linked, orphan-linked, or linked to a core licensor coded `DS`/`DY`. The original version is permanently blocked from promotion.
