---
issue: 6356
status: OPEN
owner: claude session f66ef41b (sandbox catch-up batch 10)
---
# Sandbox catch-up after batch 9 (#6356) — state at 2026-11-16 10:30 AM EST

## 1. What and why
Albert authorized (2026-11-15) a full catch-up of the DesignFlow sandbox (ref xupnyeifmpsacrqahwwm) to production structure. Never touch production or preview.

## 2. Done
- Batch 9 (20261116120100) after-check failure diagnosed: verifier cannot accept "revoke from public, anon, authenticated; grant to public" on app.handle_new_auth_user(). Live sandbox ACL equals production (public, postgres, service_role). Check NOT waived.
- Batch 10 = migration 20261116124000, PR #6430 (merged): 35 indexes, 24 constraints, 7 triggers copied from production, no grant/revoke on that function. Dry-run run 43790725930, apply run 43790813961, catalog verification green, https://alsand.designflow.app returned 200.
- PR #6438 (merged): sandbox dependency catalog now includes the ingest schema. Two stale truth-audit entries cleared in #6430.
- Progress comment posted on #6356.

## 3. Preview / production
Nothing written to either.

## 4. Half-finished
Nothing half-applied. Sandbox row counts were not re-measured after batch 10 (only pre-checked: zero offenders for every new rule).

## 5. Owned
Branch claude/sandbox-catchup-10 (merged), claude/sandbox-catchup-guard-ingest (merged); worktree happy-faraday-54acb3 (clean). No open claims (ai-shared-db-closeout-check ok).

## 6. Next
1. Recount sandbox rows vs the before image (side-session-notes sandbox-before-image-2026-11-15.json) and confirm site 200.
2. Property-name rules for #6269 on core.property: property_no_submission_canonical_ck, property_submission_link_pair_ck, unique index property_submission_link_uq. Claim #6178 is closed now. Needs a verification sidecar (scripts/production-verification-sidecars/, registry config/production-verification-sidecar-registry.json). Pre-check sandbox for offenders. Migration 20261113183820 must NOT replay on the sandbox.
3. Remaining drift (run: python3 scripts/sandbox_prod_drift_check.py with SUPABASE_ACCESS_TOKEN from 1Password item "Supabase CLI Personal Access Token", field credential): 54 triggers incl. sku_sg_* functions in public (need public schema decision), policies (20 missing, 4 changed), changed constraints/indexes, missing columns on api views, plm.creative_submission_property_resolution_archive tables, dflow FK differences (sandbox's own design; candidate for allowlist).
4. Held by open claims: core.character_alias and core.taxonomy_source_ref (#5683), crm.* (PR #5859).
5. Albert's 2026-11-15 7:41 PM EST ruling "Yes, copy them too": dam, hts_rag, archive, public relations also go to the sandbox; dflow_prod stays excluded. Not yet done; the drift check currently ignores those schemas.
6. Guard PR #6293-line (#6290 merged already).

## 7. Blocked on
Other sessions' claims (#5683, PR #5859). No question for Albert.

## 8. Tried and failed
- Keeping the revoke-then-grant-public sequence: verifier reads it as contradictory.
- Dry-run on batch 10 first failed: live-catalog read omitted the ingest schema (fixed by #6438).
- Tools offline tests were red on main: reworded a note and catalogued sandbox_prod_drift_check.py wording.
- Dry-run runs guards only, not the SQL: syntax-check with pglast first. Version must sort after main's newest.

## 9. Possibly stale
Main tip aba1a9d01 and newest migration 20261116124000, checked 10:25 AM EST. Drift counts from 8:15 PM EST 2026-11-15.
