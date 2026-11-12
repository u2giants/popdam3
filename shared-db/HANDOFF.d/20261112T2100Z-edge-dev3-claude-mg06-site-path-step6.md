# Handoff: MG06 licensor-site path — preview proof + step 6 (populate)

## 1. Goal
For every active ColdLion MG06 (Property) value, store the exact path on the licensor's submission site so an AI can fill Disney OPA (and other) forms. Plan: [plan_mg06_licensor_site_path.md](https://github.com/popcre/shared-db/blob/main/plan_mg06_licensor_site_path.md).

## 2. State (2026-11-12 3:55 PM EST)
- Steps 1-5 done in code: `core.property_site_path` + `api.mg06_site_path` merged via https://github.com/popcre/shared-db/pull/6153 (merge d1e95195, 3:10 PM EST). Migration [20261112194140_property_site_path.sql](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261112194140_property_site_path.sql); test [property_site_path.sql](https://github.com/popcre/shared-db/blob/main/supabase/tests/property_site_path.sql). Versions 20261112173358 and 20261112185147 are reserved and unused (re-versioned twice after merge-queue "backdated" ejections).
- Claim issue https://github.com/popcre/shared-db/issues/6150 deliberately kept OPEN (reopened after merge auto-closed it): automatic production promotion requires the open linked work issue.
- NOT yet on preview: read at 3:52 PM EST, `to_regclass('core.property_site_path')` is null; the automatic production trigger serializes merged migration PRs and others were ahead.
- Step 6 not started (cancelled by close-nested scope freeze).

## 3. Next actions
1. Read preview (read-only, pooler host aws-0-us-east-1, user postgres.<preview ref from `ai-private-config value supabase_shared_preview_ref`; the ref in the runbook is stale): table exists, RLS on, anon no select, authenticated select only, `api.mg06_site_path` callable. Then production the same after promotion. Post live proof on #6150, then close it.
2. Step 6: corrected MG06 list = Dropbox `ai/ColdLion changes for Jamielynn - 2026-11-12.xlsx`, tab "Property values" (128 values with Keep/Reactivate actions; "Style moves" column J has owner "Parent > value on licensor site" hints). Map each to `core.property.id` and scraped site vocab (`plm.opa_property`, `plm.opa_property_character`, `plm.wb_property`, `plm.nbcu_property`, `plm.sega_submission_property`, `plm.pmt_trackerplus_submission_property`). New claim + reserved version; data migration; land through the pipeline after the table is on preview; post count proof (every active MG06 has >=1 current row).

## 4. Owner rulings (binding)
- MICKEY MOUSE -> OPA "Mickey Mouse Family" > "Mickey Mouse" (single-character designs only).
- Mickey + anyone (Minnie, Pluto, Goofy) is coded MG06 "Standard Characters" -> OPA "Standard Characters". Standard Characters has no core.property row yet (Albert's decision pending): leave it out, list as pending.
- Minnie-only -> OPA "Minnie" > "Minnie & Me".
- Short MG06 display names; path lives only in this table.

## 5. Gotchas
- Tests writing `core.property` must first `select public.ci_authorize_licensing_contract_test();`.
- Merge queue ejects a migration whose version is older than the newest on main: reserve a new version with `scripts/check-dispatch-collision.mjs --reserve-version`, `git mv`, update the claim body's `version:` line.
- Merging auto-closes "Closes #N" issues; reopen the claim issue until production proof.

## 6. Related
Sibling nickname work (Standard Characters nickname "Mickey Group"): https://github.com/popcre/shared-db/pull/6181 (own session).

## 7. Self-audit
Stranger can resume: goal §1, exact state §2, next steps §3, rulings §4, traps §5. Yes.
