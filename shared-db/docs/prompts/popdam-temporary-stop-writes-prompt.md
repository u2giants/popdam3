*2026-08-09 · Originated from shared-db orchestrator session 8b3f21c4 · Status: **TEMPORARY***

# TEMPORARY FIX — STOP POPDAM WRITING INCORRECT LICENSOR AND PROPERTY DATA

**Repo:** `u2giants/popdam3`. **Status: TEMPORARY.** This is a stop-the-bleeding change. It must be labelled TEMPORARY in the code and in the docs. The permanent fix is a separate, larger piece of work described at the bottom. Do not delete this label until that work ships.

**Background you need, in three sentences.** PopDAM derives an asset's licensor and property two ways: by slicing characters out of the filename SKU, and by reading the licensor out of a folder name at a fixed position in the path. Both are wrong often enough to be a compliance risk — a real example is product `AAH62NBEX01`, nine Exorcist assets whose SKU encodes `NB` (NBC) when the licensor is Warner Bros, and 9,973 assets whose licensor foreign key disagrees with their own licensor code. We now have the ColdLion API and data direct from licensors, so PopDAM should not be guessing any of this.

## The one asymmetry that makes this fix possible — read this before touching anything

- The **four text columns** on `public.assets` — `licensor_code`, `licensor_name`, `property_code`, `property_name` — are **rewritten on every scan**. Any correction made in the database is destroyed on the next pass. This is why we must stop the writes before anyone repairs data.
- The **two FK columns** — `licensor_id`, `property_id` — are **null-only fill**. The code writes them only when the existing value is null, and never corrects a non-null value. Corrections to these survive.

So: stop the text writes, and the data becomes fixable. Leave them running, and every repair silently reverts.

## What each location does today

1. `supabase/functions/_shared/sku-parser.ts:147` — regex-slices the filename into size, **licensor code**, **property code**, sequence. `AAH62NBEX01` → size `62`, licensor `NB`, property `EX`. Lines 168-178 then look those codes up in ColdLion MG05/MG06 to get `licensor_name` and `property_name`. Note: MG05 is only a code-to-name dictionary. It cannot correct a wrong code — it just spells it out.
2. `supabase/functions/agent-api/index.ts:923` — the scan ingest path. Builds `skuFields` from `parseSku` and writes `licensor_code` and `property_code` **unconditionally on every scan**, plus `licensor_name` / `property_name` when the ColdLion lookup is non-null.
3. `supabase/functions/_shared/admin-handlers/metadata-handlers.ts:157` — the reprocess path. Writes **all four** text columns unconditionally on any difference (`if (current !== v) updates[k] = v`).
4. `supabase/functions/_shared/admin-handlers/metadata-handlers.ts:73-78` — writes the FK columns `licensor_id` / `property_id`, but only when currently null (`if (!asset.licensor_id && derived.licensor_id)`).
5. `supabase/functions/_shared/metadata-derivation.ts:98-105` — the source of the FK values. Reads the licensor from **folder segment 3 by position**, assuming `Decor/Character Licensed/[Licensor]/[Property]/...`. That layout describes only 393 of 117,969 licensed assets today.

## What to stop writing

- In `agent-api/index.ts:923`: stop writing `licensor_code`, `licensor_name`, `property_code`, `property_name`.
- In `metadata-handlers.ts:157`: stop writing the same four.
- In `metadata-handlers.ts:73-78`: stop writing `licensor_id` and `property_id` from path derivation. Folder position must no longer produce a foreign key, even into a null.

Preferred shape: put all six behind a single named flag, e.g. `TEMPORARY_DISABLE_PATH_AND_SKU_TAXONOMY_WRITES`, default **on** (writes disabled), read from `admin_config` so it can be flipped without a deploy. One switch, one place to remove later.

## What to leave completely alone

Everything else `parseSku` produces stays: `sku`, `mg01_*`, `mg02_*`, `mg03_*`, `size_*`, `sku_sequence`, `division_code`, `division_name`, `product_category`. The merch-group and size axes are fine — this is only about licensor and property. Also leave path-derived `is_licensed` and `workflow_status` alone; those legitimately come from the folder tree and are not in scope. Do not delete `sku-parser.ts` or `metadata-derivation.ts`; other fields still depend on them.

**Do not backfill or repair any data as part of this change.** Stopping the writes is the whole job. Repair is owner-gated and sequenced separately in `u2giants/shared-db`.

## Required labelling — not optional in this shop

- A comment block at every one of the six sites beginning `// TEMPORARY —` that states what is disabled, why, the date, and that the permanent fix is the ColdLion/licensor-authoritative rework.
- An entry in the repo's `HANDOFF.d/` and in `docs/KNOWN_QUIRKS` marked **TEMPORARY**, naming the flag, listing all six sites, and describing the permanent fix.
- Do not mark this issue "fixed". It is "bleeding stopped".

## The permanent fix this is standing in for

PopDAM stops deriving licensor and property attributes altogether and consumes them from the ColdLion API and direct licensor data, with folder position removed as a source entirely. That is a separate prompt and a separate piece of work. Until it ships, this flag stays and stays labelled TEMPORARY.
