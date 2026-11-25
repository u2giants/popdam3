---
summary: "Issue 908: edge cover picker uses the database cover rank so COMP files rank as ruled; fix COMP ingest docs."
kind: plan
status: open
read-when: "changing how a style group's cover (primary asset) is chosen, the COMP/mockup cover rules, or selectPrimaryAsset; fixing review finding 908"
---

# COMP cover rank: one ranking, not two (issue #908)

Issue: [#908](https://github.com/u2giants/popdam3/issues/908). This is the review of [PR #907](https://github.com/u2giants/popdam3/pull/907), merged 2026-11-10.
Handoff registration: [HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md](../../HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. `selectPrimaryAsset` ranks by `primary_sort_tier`, then `created_at` | ⬜ open | — |
| 2. Callers select `primary_sort_tier` | ⬜ open | — |
| 3. Tests rewritten to tier-based cases | ⬜ open | — |
| 4. Scanner comment and configuration doc mention bare COMP | ⬜ open | — |
| 5. Land and live proof | ⬜ open | `- [ ] live proof` on #908 |

A fresh session starts at step 1.

## 1. Ultimate goal

Every style group (all the files for one product SKU) shows the right cover picture, following Albert's ruling:
- a professional "3-4" photo comes first;
- then a mockup;
- then a COMP file;
- then plain art;
- and so on.

The cover must be the same no matter which part of the system last recalculated it. Today two different rankings exist, and they can disagree.

**If a step conflicts with this goal, the goal wins. Stop and flag it on the issue.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed product artwork. Files on the NAS are grouped by SKU folder into style groups. Each group shows one cover (`style_groups.primary_asset_id`, plus the cached `primary_thumbnail_url`) in the web library.

The cover is chosen in two places:
- **The database.** Trigger `compute_primary_sort_tier()` assigns every asset a `primary_sort_tier`, and `refresh_style_group_primaries` picks `ORDER BY primary_sort_tier, created_at`. This lives in the shared database, project `qsllyeztdwjgirsysgai`, owned by [popcre/shared-db](https://github.com/popcre/shared-db).
- **The edge function `agent-api`.** When a render job finishes with a new thumbnail, it calls `selectPrimaryAsset()` in `supabase/functions/_shared/style-grouping.ts`, which has its **own** hard-coded ladder, and writes the result to `style_groups` (`supabase/functions/agent-api/index.ts:2234-2258`).

Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3), protected `main`. Edge functions deploy on merge through `deploy-supabase.yml`.

## 3. What triggered this work

The owner ruled on 2026-11-10 (exact words, recorded in shared-db migration `20261110192227`): "A file with COMP, COMPVIEW, COMP-VIEW or COMP_VIEW in the file name should automatically be imported and it is chosen as the cover image right after '3-4' and 'mockup' files."

PR #907 implemented this in the edge ladder, and shared-db [#6011](https://github.com/popcre/shared-db/issues/6011) implemented it in the database ladder. The reviewer found:
1. The edge ladder ranks COMP files of any type, not just raster images.
2. With no thumbnail, COMP falls below art in the edge ladder, because the edge code has no "COMP without thumbnail" tier.
3. The scanner comment and `docs/configuration.md` still list only `comp-view`, `compview` and `mockup` as raster ingest keywords.

All three were verified on `main` @ `787c20b8` (2026-11-25).

## 4. Scope

**In:**
- `supabase/functions/_shared/style-grouping.ts` (`selectPrimaryAsset`);
- its caller in `supabase/functions/agent-api/index.ts`;
- `supabase/functions/_shared/style-grouping.test.ts`;
- the comment at `apps/bridge-agent/src/scanner.ts:36-37`;
- the `INGESTION_RULES` paragraph in `docs/configuration.md` (around `:301`).

**NOT in this plan:**
- Changing the database ladder or the owner's ruling.
- Re-picking covers for existing groups. The database already did that for COMP groups in migration `20261110192227`.
- The AI-tag candidate tier exclusion `(5,9)`, which is correct; #914 was closed with live proof on 2026-11-25.
- What files are ingested. Ingestion itself already accepts bare COMP (`packages/agent-common/src/ingestion-rules.ts:137-146`).

## 5. Current state of the code

- `style-grouping.ts:52-129`: `selectPrimaryAsset()` implements ten tiers:
  - photo34, which needs a `/professional photos/` or `/prof photos/` folder and a base name ending in `3-4`;
  - mockup + thumbnail, where "mockup" is any name containing `mock`;
  - COMP + thumbnail (2b), any file type;
  - art + thumbnail;
  - other + thumbnail;
  - packaging + thumbnail;
  - mockup;
  - art;
  - other (which **includes COMP**);
  - packaging;
  - then the oldest file.
- Database ladder, live (read-only check 2026-11-25, `public.compute_primary_sort_tier`). The fourteen tiers are listed in the header of `shared-db/supabase/migrations/20261110192227_dam_cover_tier_comp_files.sql`:
  1. photo34, meaning the base name **contains** `3-4`, in any folder;
  2. mockup + thumbnail (`mockup` / `mock up`);
  3. COMP + thumbnail;
  4. art + thumbnail;
  5. techpack + thumbnail;
  6. neutral non-PDF + thumbnail;
  7. packaging + thumbnail;
  8. neutral PDF + thumbnail;
  9. mockup;
  10. COMP;
  11. art;
  12. techpack;
  13. neutral;
  14. everything else.
  Here `is_comp` is `lower(filename) ~ '(^|[^a-z])comp([-_ ]?view)?([^a-z]|$)'`, and "thumbnail" means `thumbnail_url is not null and thumbnail_error is null`.
- `refresh_style_group_primaries`, live: `ORDER BY sg.id, a.primary_sort_tier ASC, a.created_at ASC`.
- `agent-api/index.ts:2243-2246`: it selects `id, filename, relative_path, file_type, asset_type, created_at, thumbnail_url, thumbnail_error`, but not `primary_sort_tier`.
- The `primary_sort_tier` column is recomputed by a trigger on every insert or update of the relevant columns. By the time the render-completion handler reads the group, the thumbnail write that just happened has already updated the tier.

## 6. Key findings and root cause

The root cause is a duplicated business rule. The edge ladder and the database ladder were written separately and differ in five places:
- the photo34 folder requirement;
- `mock` versus `mockup`;
- techpack handling;
- PDF handling;
- the COMP-without-thumbnail tier.

Whenever a render completes, the edge result overwrites the database's choice. Findings 1 and 2 are symptoms of this.

Finding 1 is **not** a defect against the ruling. "A file with COMP … in the file name" covers any file type, and the database (the system of record) ranks COMP of any type. The fix is parity, not a raster guard.

## 7. Approaches considered and rejected

- **Add a raster-only guard to edge tier 2b (the reviewer's suggestion).** Rejected. It contradicts the owner's ruling as implemented in the database.
- **Copy the fourteen-tier SQL ladder into TypeScript and add a parity test.** Rejected. That keeps two copies of a business rule. The database already computes the tier on every write; read it.
- **Have the edge call `refresh_style_group_primaries` for the group.** This is viable, but it is heavier: a batch function and permissions. Use it only if step 2's gate shows the tier is stale at read time (see the stop-and-ask in step 1).

## 8. Design decisions

Locked:
- The owner ruling of 2026-11-10, quoted in §3.
- The database `primary_sort_tier` is the single cover rank.
- Ties are broken by `created_at` ascending, matching the database.

Open: what to do when `primary_sort_tier` is null. The column has a default of 13, so this should not happen. Fall back to the last position, then `created_at`.

## 9. The plan

**Step 1. Rank by tier.** `lead-only`: this rule decides the production cover.
- Change `selectPrimaryAsset(assets)` in `style-grouping.ts` so it accepts assets carrying `primary_sort_tier: number | null` and `created_at`. It returns the ID with the lowest `(primary_sort_tier ?? 99, created_at, id)`.
- Delete the hand-written ladder and the now-unused `isCompFilename` import, if nothing else in the file uses it.
- Replace the doc comment with: "The cover rank lives in the database (compute_primary_sort_tier, shared-db); this picks the same winner as refresh_style_group_primaries."
- Gate: step 3's tests pass.
- Stop-and-ask: if the render-completion handler can read a tier that is stale, because the thumbnail write happens after the read, it is a stop-and-ask. Check the order in `agent-api/index.ts` around `:2225-2240`: the completion RPC writes the thumbnail first, so the tier should be current.

**Step 2. Callers select the tier.** `helper-ok`.
- Add `primary_sort_tier` to the select at `agent-api/index.ts:2245`.
- Grep for any other `selectPrimaryAsset(` callers (only `agent-api` today) and update them the same way.
- Gate: `deno check supabase/functions/agent-api/index.ts`, or the repo's edge-function type-check script, passes.
- Stop-and-ask trigger: a caller without access to `primary_sort_tier`.

**Step 3. Tests.** `helper-ok`.
- Rewrite `supabase/functions/_shared/style-grouping.test.ts` around tiers:
  - lowest tier wins;
  - an equal tier goes to the oldest `created_at`;
  - an equal tier and `created_at` go to the lower ID;
  - a null tier ranks last.
- Keep one documentary test that mirrors the owner ruling with database-computed tiers: mockup with thumbnail = 2 beats COMP with thumbnail = 3, which beats art with thumbnail = 4; with no thumbnails, mockup = 9 beats COMP = 10, which beats art = 11.
- Gate: `npm test` (vitest), including `style-grouping.test.ts`, passes.
- Stop-and-ask trigger: other tests import ladder helpers that were deleted.

**Step 4. Docs and comment.** `helper-ok`.
- `apps/bridge-agent/src/scanner.ts:36-37`: "Raster keyword filter: ingest png/jpg/jpeg whose name matches comp-view, compview, mockup or a whole-word COMP (see ingestion-rules), or a configured image_include rule."
- `docs/configuration.md` around `:301`: list bare `COMP`, `COMP-VIEW` and `COMP_VIEW` as whole-word built-ins, and add one sentence saying the cover rank is the database `primary_sort_tier` ladder, with a link to the shared-db migration.
- Do **not** bump the bridge agent version; only a comment changes.
- Run `ai-doc-health --repo . --fix-index`.
- Gate: `grep -n "comp-view" docs/configuration.md` shows the updated sentence.
- Stop-and-ask trigger: the shared ingestion list differs from this description.

**Step 5. Land and live proof.** `lead-only`.
- Open a PR and merge once the required checks pass. `deploy-supabase.yml` deploys `agent-api`; confirm that the run succeeded for the merge SHA.
- Live proof, read-only SQL: pick a style group containing a COMP asset and a mockup. After its next render completion (or any group whose render completes after the deploy), `style_groups.primary_asset_id` equals the asset with `min(primary_sort_tier, created_at)` among its non-deleted assets.
- Run a sampled check across 200 recently rendered groups:
  `select count(*) from style_groups sg where sg.primary_asset_id is distinct from (select a.id from assets a where a.style_group_id = sg.id and not a.is_deleted order by a.primary_sort_tier, a.created_at limit 1) and sg.updated_at > '<deploy time>'`. It returns 0.
- Record the result on #908, then close it. If no render completes during the session, leave `- [ ] live proof`.

## 10. Tests required

- The four tier-ranking cases and the ruling-mirroring case from step 3.
- Existing: the root `npm test`, which covers `supabase/functions/_shared/*.test.ts` through vitest, the edge type check, and `apps/bridge-agent` `npm test`, which is unchanged.

## 11. Constraints and gotchas

- Never change the database ladder from this repo. Shared-db owns it (load `shared-db-change` if it is ever needed).
- The sampled SQL in step 5 is read-only. Never run an `update` to "fix" covers by hand.
- `selectPrimaryAsset` is also re-exported for tests. Keep the export name.
- Use a feature branch and PR; never push to `main`.

## 12. Access and environment

- `gh` is authenticated as `u2giants`.
- Read-only SQL: the Supabase Management API, with the token from 1Password `vibe_coding` → "Supabase CLI Personal Access Token", injected with `op run` (see `docs/MCP_SERVERS.md`).
- Local: `npm ci`, then `npm test`.
- Edge deploy status: `gh run list -R u2giants/popdam3 --workflow deploy-supabase.yml`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–4 are merged with CI green.
- [ ] `agent-api` is deployed at the merge SHA.
- [ ] The step 5 sampled check returns 0 and is recorded on #908, then #908 is closed, or `- [ ] live proof` is left.
- [ ] STATUS is updated.

Risk: covers in groups whose edge-chosen cover differed from the database's choice will switch to the database's choice on their next render. That is the intended correction, but Albert may notice changed covers. Rollback: revert the PR, and the edge function redeploys.

Open: none.

## Self-audit

1. *Could a fresh session execute this without asking?* Yes. §2 and §5 show both rankings with exact locations and the live ordering, §9 gives the files and gates, and §12 the access.
2. *Is all background captured?* Yes. §3 quotes the ruling, §6 explains why finding 1 is not a defect, and §7 records the rejected options (raster guard, a copied ladder).
3. *Is the goal clear for judgment calls?* Yes. §1 says one cover order, matching the ruling, whatever recalculated it.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-908-comp-cover-rank-parity.md in u2giants/popdam3. Read AGENTS.md, then the plan (STATUS first). Do step 1 and step 5 yourself. Give steps 2, 3 and 4 to your helper. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules (https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md): return finished work or an evidenced blocker. Make no design decisions, no merges and no posts. Bring stop-and-ask triggers back to you. If stuck for 30 minutes, the step is taken back. You re-run every gate, merge the PR when required checks pass, verify the deploy-supabase run, run the step 5 read-only check, update STATUS, and close #908 with evidence.
```
