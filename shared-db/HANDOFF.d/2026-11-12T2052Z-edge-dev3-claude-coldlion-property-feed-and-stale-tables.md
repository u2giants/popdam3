---
issue: 6194
status: OPEN
owner: claude/edge-dev3 session bd88e001 (ColdLion feed gap + stale tables)
---

# Handoff: ColdLion to shared property list gap, and stale merch-group copies (2026-11-12, 3:52 PM EST)

## 0. Business decisions only the owner can make

Put these to Albert in **one** message.

**Blocking**
1. **Should the shared property list (`core.property`) be filled straight from live ColdLion MG06 values,** adding the 16 missing active DY/MV/SW values such as Standard Characters, Wish and The Mandalorian, and updating old June names such as DARTH VADER to ColdLion's current ones? *Recommendation:* yes. ColdLion is Albert's curated list, and the switched-off feed is why the list is stale.

**Waiting on Uma (DesignFlow migration owner), not Albert**
2. Albert has a ready email to send Uma (owner's Dropbox `ai/email-to-uma-merchgroup-functions-2026-11-12.md`). It asks whether six more functions reading the frozen copy should join Phase 3 of designflow-item-master#205, who does it, and whether shared-db #4706 should load from a fresh source. Do not act on these until Uma answers.

**Already settled — do not re-ask**
- 2026-11-12: the 493 OPA site-only `core.property` rows stay as `potential`.
- Uma's merch-group plan decisions are recorded on [#205](https://github.com/popcre/designflow-item-master/issues/205) ("Leave the copy where it is. Do not copy from it, and do not drop it as part of the switch.").

## 1. What this is

POP Creations' ColdLion ERP data reaches the shared Supabase databases two ways. Production is `qsllyeztdwjgirsysgai`; non-production (sandbox/develop/staging) is `xupnyeifmpsacrqahwwm`.
- (a) The shared-db landing job `.github/workflows/coldlion-landing-sync.yml` writes `coldlion.*`, daily (last run 2026-11-12 8:54 AM EST). In non-production it skips merch groups (unexplained).
- (b) DesignFlow's data-syncing service calls ColdLion itself and writes the app's working merch-group list: `dflow_prod."merchGroup"` in production, `core."merchGroup"` in non-production until tonight's step 2.2 (2026-11-12 11 PM EST) moves it to `dflow."merchGroup"`.

A visual map is in the owner's Dropbox `ai/coldlion-data-map-2026-11-12.html`.

## 2. Goal

Stop sessions and functions from using stale ColdLion copies, and get `core.property` fed from live ColdLion again.

## 3. Current state

- `core.property` is **not** fed from ColdLion. [`coldlion-licensor-property-production.yml`](https://github.com/popcre/shared-db/blob/main/.github/workflows/coldlion-licensor-property-production.yml) refuses every run ("retired by #1090 Step 1.0"). #1090 is closed, and no Step 4 replacement exists.
- Production `core."merchGroup"` and `dflow."merchGroup"` are frozen at 2026-06-26 (3,645 rows, missing 772 codes). Seven functions read `core."merchGroup"`: `api.resolve_item_mg_category` (covered by #205 step 3.1), plus `plm.link_coldlion_licensors_properties_core`, `plm.verify_coldlion_approved_mapping_identity`, `plm.compute_taxonomy_immutability_snapshot`, `plm.refresh_style_tracker_item_bridge`, `ingest.apply_coldlion_product_size` and `public.search_style_tracker_link_candidates`. Those six are not covered. Findings and a released claim are posted on #205.
- `core.merch_group` (the future permanent table) is empty. #4706 plans to load it from the frozen copy, which is wrong.
- Star Wars comparison CSV (ColdLion vs production app vs sandbox vs `core.property`): owner's Dropbox `ai/star-wars-mg06-three-places-2026-11-12.csv`.
- A prompt for a full stale-table audit is ready (owner's Dropbox `ai/prompt-stale-table-audit-2026-11-12.md`) and has not run yet.
- Nothing is committed for this workstream apart from this file.

## 4. What did not work

- I treated `core."merchGroup"` as "ColdLion today". It's June data and led to a wrong rename-restore PR (#6187, cancelled).
- I described the gap as "the ColdLion feed is off". The landing feed works; only the ColdLion→`core.property` step is off.
- I claimed on #205 that I'd repoint the seven functions, then released the claim. They join on `mg_id`/`parent_id`, which `coldlion.merch_group_detail` lacks, so they can't simply be repointed to it, and tonight's step 2.2 does not touch production.
- An earlier "10k+ reads" claim for `api.resolve_item_mg_category` could not be re-verified (function stats are off in production).

## 5. Key findings

- `coldlion.merch_group_detail` columns: company_code, division_code, mg_type_code, mg_code, mg_desc, active ('Y'/'N'), item_no_code, mg_code2. MG06 = mg_type_code '06'. Licensor per MG06 comes via `coldlion.item_merch_group` slot 5.
- Non-production app reads `plm."itemHeader"` (columns `udf_merchgroup05_fk_id`/`06_fk_id`) and `core."merchGroup"`. Production reads `dflow_prod.*` (single-schema mode).
- Uma's plan is in [docs/designflow-cloudsql-to-supabase-plan.md](https://github.com/popcre/shared-db/blob/main/docs/designflow-cloudsql-to-supabase-plan.md), with parent [#4248](https://github.com/popcre/shared-db/issues/4248).

## 6. Next steps

1. Ask §0 item 1. *Done when Albert answers.*
2. If yes: design the Step 4 replacement from the [licensing-master-data plan](https://github.com/popcre/shared-db/blob/main/plan_licensing_master_data_implementation.md). It should create missing active MG06 values with their exact ColdLion code and name, update stale names, and never delete. Land it through the pipeline. *Done when production `core.property` has DY "Standard Characters" code MM, and the 16 missing values return 0.*
3. Run the stale-table audit prompt in its own session. *Done when its report and issue exist.*
4. After Uma answers, carry out her decisions on #205 or #4706.

## 7. Constraints

Claim-first on #6194. Never touch production `core."merchGroup"` (Uma: leave it). Never drop tables; retire only with Uma's plan. Times in EST.

## 8. Access

Supabase MCP is bound to production. Non-production can be read only with `bash ~/repos/dflow_plm/q.sh SANDBOX "<select>"` (secrets come from gcloud project `lithe-breaker-323913`).

## 9. Risks

The 2:41 PM coordinator request to place OPA properties via contract is a separate workstream (see the `opa-submission-properties` handoff). Don't mix them.

Self-audit: §0 lists Albert's decision and Uma's pending answers; §4 lists the dead ends; §6 gates each step.
