---
issue: 6356
status: OPEN
owner: claude/83b531ac (session 83b531ac-363f-4fa4-abb7-8f2ffdbd3ad6)
---

# Sandbox catch-up to production structure (#6356), after batch 9

## 1. What and why
Albert authorized (2026-11-15) a full additive catch-up of the DesignFlow sandbox (ref xupnyeifmpsacrqahwwm) to production structure, verified per batch, never touching production or preview. Goal: sandbox structure = production except by-design differences.

## 2. Done (all through workflow designflow-sandbox-migrations.yml: dry-run, apply, catalog verification)
Batches 1-2 earlier. This session: 3 `20261115153254` (PR 6371), 4 `20261115160800` (6374), 5 `20261115163358` (6377), 6 `20261115163555` (6378, fixed by 6380 and 6401-era fixes), 7 `20261115172649` (6382, fixes 6390, 6392), 8 `20261115181438` (6388, fixes 6401, 6420, 6422), 9 `20261116120100` (6397). Guard fixes: 6385, 6396 (sandbox live catalog counts functions and app/pim/crm). Drift check: PR 6393 (scripts/sandbox_prod_drift_check.py, weekly workflow, ALLOWLIST in script). Each verified: ledger +1, only intended new objects, new function hashes equal production, row counts unchanged, https://alsand.designflow.app 200.

## 3. Preview / production
Nothing applied or written to either. Production and preview were only read (read-only Management API).

## 4. Half-finished
Batch 9 applied (ledger has 20261116120100) but the post-apply verification FAILED 3 rows on `app.handle_new_auth_user()` (run 43782948144): the generated `revoke ... from public, anon, authenticated` plus `grant execute ... to public` is read as contradictory (the verifier only accepts PUBLIC as the default ACL). Live ACL equals production. Not waived. Production claim #6432 / PR 6433 (revoke trigger-function execute on 104 functions) is now MERGED (checked 2026-11-16 10:30 AM EST), so the sandbox follow-up is unblocked.

## 5. Owned
No claims (ai-shared-db-closeout-check ok, zero owned). Worktree clever-kirch-46551b clean; branches claude/6356-* are merged except claude/6356-acl-fix (empty).

## 6. Next
1. Re-read production ACL for `app.handle_new_auth_user` and the 104 functions of PR 6433; write one migration (new version after main's newest, currently 20261116123000) that restates the sandbox ACL as production now has it, with no PUBLIC grant; file a claim; syntax-check with pglast; register in FOREIGN_TARGET_MIGRATIONS; run lane; confirm verification passes.
2. Re-run `python3 scripts/sandbox_prod_drift_check.py` (needs SUPABASE_ACCESS_TOKEN via 1Password) and port the remaining drift in batches: missing columns/constraints/indexes/triggers/policies on new tables, remaining functions.
3. #6269: add core.property constraints property_no_submission_canonical_ck, property_submission_link_pair_ck and unique index property_submission_link_uq (definitions from production; sandbox 0 offenders in 260 rows) once claim #6178 closes. PR 6290 is merged. 20261113183820 must NOT replay on the sandbox.

## 7. Blocked
Claim #6178 (core.property), #5683 (core.taxonomy_source_ref, core.character_alias), PR #5859 (crm.*). Owner question: should production-only dam, hts_rag, archive and public objects be copied to the sandbox? (Left open; Albert not yet asked.)

## 8. Tried and failed
- Dry-run does not run SQL; three applies failed on syntax/missing column/missing role (all atomic, nothing changed). Always syntax-check with pglast (`pip install --target`, run with `python3 -I`).
- Generator emits invalid `alter table .. add constraint .. TRIGGER` lines; strip them.
- Functions touching dflow_prod, api.db_data_admin_licensor_property_tree (#1684 guard), plm.alert_coldlion_property_skips (repo body newer than prod) cannot be ported as-is.
- Grants to production-only roles (pm_jev_triage_worker, designflow_prod_backend_runtime) fail on the sandbox.
- Migration versions must sort after main's newest; `source_pr` must be the PR that added the version; promotion merge freezes eject queue PRs (re-run `gh pr merge --auto --squash`).
- Muse (ai-muse) was unavailable once, then agreed with the plan.

## 9. Possibly stale
main tip aba1a9d01 and max migration 20261116123000 (2026-11-16 10:30 AM EST); drift counts from 2026-11-15 evening; item_product_description row growth (4520 to 4873) is a DesignFlow job, not migrations.
