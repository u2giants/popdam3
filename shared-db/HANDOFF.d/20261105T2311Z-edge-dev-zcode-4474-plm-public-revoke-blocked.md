---
issue: 4474
status: BLOCKED
owner: zcode/4474-plm-public-revoke
---

# #4474 — plm SECURITY DEFINER functions EXECUTE-able by PUBLIC: blocked behind T9 claim #5639 / PR #5640

Two consecutive ZCode sessions (2026-11-05) verified everything read-only and are
stopped by an exact-object collision. Do not redo the verification; author when
the collision clears.

## Already done (2026-11-05, evidence on issue #4474 comment at 5:58 PM EST)

- **Live before-state, production `qsllyeztdwjgirsysgai`, read-only 5:45 PM EST:**
  `plm.apply_style_tracker_designer_resolutions()` and
  `plm.refresh_style_tracker_item_bridge()` (zero-arg) are SECURITY DEFINER,
  owner `postgres`, ACL `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`.
  EXECUTE: `anon`=true, `authenticated`=true via the `=X` PUBLIC grant.
  `plm` is not in `pgrst.db_schemas`, so this is latent (direct role sessions /
  future exposure), not a live PostgREST path.
- **Consumer check:** popdam3 browser + worker call only the `public.`
  zero-arg wrapper (`refresh_style_tracker_item_bridge` unqualified,
  `src/pages/styles/api.ts`, `scripts/refresh-style-tracker-rows.py`) — no
  `plm.`-qualified call, no `.schema("plm")`. poppim-web / popcrm-web /
  designflow-* hit only generated or mirrored copies. Per #2873 the
  `designflow_prod_*_runtime` identities are contracted to have NO `plm` access —
  today they reach these functions only through PUBLIC, so no re-grant to them.
  Internal callers (cron `public.sync_new_items_into_style_tracker()`, the
  `public.` wrappers) are SECURITY DEFINER owned by `postgres` — owner needs no
  grant. `service_role` gets an explicit re-grant.
- **Migration version `20261105224633` is permanently reserved for this work**
  (`refs/db-claims/20261105224633`). A reserved version is never freed or
  reused — use it; do not reserve a new one unless the ref is somehow gone.

## Planned SQL (mirrors `20260729120000` belt-and-braces pattern)

```sql
revoke execute on function plm.apply_style_tracker_designer_resolutions() from public, anon, authenticated;
grant  execute on function plm.apply_style_tracker_designer_resolutions() to service_role;
revoke execute on function plm.refresh_style_tracker_item_bridge() from public, anon, authenticated;
grant  execute on function plm.refresh_style_tracker_item_bridge() to service_role;
```

Plus a fail-closed assertion (contract test under `supabase/tests/`) that
anon/authenticated no longer hold EXECUTE and service_role still does. Pure
REVOKE/GRANT does no whole-object replacement, so `-- derived-from:` should not
be demanded by `scripts/migration_derivation.py` (verify; the rule targets
`create or replace`). If PR #5640 landed first, re-read live ACLs: its migration
revokes only on the new `(uuid[])` overloads, and `create or replace` on the
zero-arg functions preserves the PUBLIC grant — #4474 still needs this revoke.

## Blocker (verbatim, `node scripts/check-dispatch-collision.mjs --objects "function plm.apply_style_tracker_designer_resolutions,function plm.refresh_style_tracker_item_bridge"`, still refusing 6:03 PM EST 2026-11-05)

> DO NOT DISPATCH — this task collides with work already in flight.
>   Collides with claim #5639 "PopDAM469 scoped Styles bridge refresh for edited rows"
>   Collides with PR #5640 "Bound Styles bridge refresh to edited rows"

#5639/#5640 belong to the Codex T9 session (wrapped up 1:59 PM EST 2026-11-05;
preserved worktree `/tmp/shared-db-t9-scoped-styles` on hetz; its own resume
steps are on #5639). The claim body additionally records: "Source PR must stay
unmerged until after3:30AM EST and earlier production train clears", and an
`Automatic production promotion trigger` run was still pending 6:07 PM EST
2026-11-05. Do NOT merge #5640, abandon #5639, or push to that branch as part of
#4474 — that is the T9 workstream's scope (AGENTS.md §6/§7: serialize).

## Next exact action

1. Re-run the collision check above.
2. Still refusing → stay blocked; keep this file and the `- [ ] live proof` box
   on #4474.
3. Clear (after #5639 closes and #5640 merges or is abandoned): fresh worktree
   from `origin/main`; claim-first with `SHARED_DB_SESSION_ID` declared —
   `check-dispatch-collision.mjs --task "--issue 4474 revoke PUBLIC execute on the two plm definer functions" --objects "function plm.apply_style_tracker_designer_resolutions,function plm.refresh_style_tracker_item_bridge" --version 20261105224633 --claim-body-file claim.md`, file the claim;
   author the migration + contract test; PR referencing #4474; merge per §5
   (review is advisory); drive the automatic promotion workflow; live proof =
   anon/authenticated/PUBLIC lose EXECUTE on both functions, service_role and
   the `public.` wrapper path still work.
4. Close #4474 naming the live proof, and delete this file in that same PR.
