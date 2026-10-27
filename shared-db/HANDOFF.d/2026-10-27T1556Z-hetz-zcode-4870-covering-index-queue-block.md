---
issue: 4870
status: BLOCKED
owner: zcode-hetz-4870-covidx
---

# #4870 covering indexes for image_embed_stale_assets — merge-queue blocked by open PR #4888

## 0. Business decisions only the owner can make

None. The change is technical and additive; everything up to the production apply
was already authorized by the workstream ruling (2026-10-25) and the OWNER-OVERRIDE
confirmation path is the sanctioned production mechanism (precedent runs
40264183001, 40431336163, 40510284474 — the last is this workstream's own
20261027020503 apply). Do not ask Albert anything.

## 1. Application and outcome

PopDAM's image-similarity backfill enumerates stale assets through
`public.image_embed_stale_assets` (service_role over PostgREST). The stale set is
sparse and scattered, so proving exhaustion walks the whole ~139.5k `assets.id`
range; without covering indexes the walk is heap-fetch bound (cold 51-59 s per
side, >120 s joined; warm 10.2 s). Issue
[#4870](https://github.com/popcre/shared-db/issues/4870) tracks two covering
indexes that make the walk index-only on both sides.

## 2. Exact state as of 2026-10-27 11:56 AM EDT

- Work issue [#4870](https://github.com/popcre/shared-db/issues/4870) — body
  carries the authoritative `db-work-scope` (writes: the two indexes + both
  tables), label `db-work`. OPEN.
- Author claim [#4900](https://github.com/popcre/shared-db/issues/4900)
  (owner `zcode-hetz-4870-covidx`, version **20261027143718**). Lease active;
  author check-in refreshed through ~12:04 PM EDT. Do NOT re-version.
- Branch `zcode/4870-covering-index`, worktree
  `/worksp/shared-db/.wt-4870-covering-index`, head
  `57bcf9bb7ec5b3d305ae7bea596175b7fcf4e934`. Files: migration
  `supabase/migrations/20261027143718_dam_image_embed_stale_covering_indexes.sql`
  + contract test
  `supabase/tests/popdam_image_embed_stale_covering_indexes_contracts.sql`.
  Validated on a disposable local Postgres 16 (positive + negative).
- PR [#4901](https://github.com/popcre/shared-db/pull/4901) — all required
  checks green (SQL migration guards passed after the one fix: `derived-from`
  must be bare versions or `none`); Guarded Merge run 40529276508 SUCCEEDED and
  admitted the PR to GitHub's merge queue. Not merged.
- Local `ai-task-gates check --before production` prints verbatim:
  `ai-task-gates: STOP. "production" is forbidden for the protected class
  "shared-db" in popcre/shared-db.` — the sanctioned path for this database
  apply is the OWNER-OVERRIDE confirmation per the workstream ruling; noted
  here so the successor is not surprised.

## 3. The block

The merge queue ejected PR #4901's batch (merge-queue-gate run 40529811746):
`REFUSED: migration queue order refused: PR #4901 starts at 20261027143718,
behind open PR #4888 at 20261027132801`.

PR [#4888](https://github.com/popcre/shared-db/pulls/4888) (OrderList Master
Data linking, branch `codex/orderlist-division-intake`, last push 9:34 AM EDT)
is the earliest-version open migration PR; its owning session was mid
governed-review cycle at 2:18 PM UTC (comment on the PR) and an FYI comment
about the queue-order impact was posted at 11:34 AM EDT. PR #4857 (version
20261027150048) hit the identical refusal (run 40530597540). The read-only
`--abandonment-audit` reports nothing actionable: #4888's claim is current, so
the abandonment machinery does not apply. Do NOT re-version to undercut it and
do NOT touch #4888's lane; that refusal is a gate, not an obstacle to route
around.

## 4. Next exact actions for the successor (same session or a fresh one)

1. When PR #4888 merges (or closes unmerged): re-check-in if the last check-in
   is older than 60 minutes (`SHARED_DB_SESSION_ID=zcode-hetz-4870-covidx node
   scripts/manage-migration-author-lanes.mjs --check-in-author --claim-number
   4900 --issue 4870 --owner zcode-hetz-4870-covidx --branch
   zcode/4870-covering-index --worktree /worksp/shared-db/.wt-4870-covering-index
   --pr 4901 --head-sha 57bcf9bb7ec5b3d305ae7bea596175b7fcf4e934`), then
   re-dispatch Guarded Merge on the same head (pull_request=4901,
   head_sha=57bcf9bb7ec5b3d305ae7bea596175b7fcf4e934) and let the queue merge.
2. After merge, merged-main preview rehearsal (input name matters —
   `merged_preview_source_pr`, NOT `source_pr`): `gh workflow run "Shared
   Supabase Migrations" --repo popcre/shared-db --ref main -f target=preview -f
   mode=apply -f commit_sha=<merge-sha> -f merged_preview_source_pr=4901 -f
   work_issue=4870 -f preview_allowlist=20261027143718`. The lane auto-dispatches
   a production apply that FAILS by design (business-risk gate, no allocator
   APPROVE) — that refusal is the expected precursor.
3. Production apply via OWNER-OVERRIDE:
   `gh workflow run "Shared Supabase Migrations" --repo popcre/shared-db --ref
   main -f target=production -f mode=apply -f commit_sha=<merge-sha> -f
   confirmation="OWNER-OVERRIDE <merge-sha>" -f source_pr=4901 -f
   work_issue=4870 -f preview_run_id=<preview-run-id> -f
   production_allowlist=20261027143718`. Post-merge the claim cannot be renewed;
   landing preview+apply without renewal still works.
4. Live verification: time `public.image_embed_stale_assets` over PostgREST
   (service-role key from 1Password vault `vibe_coding`, item "Supabase Runtime
   Keys - shared POP database (production)" — id 3hhxwrljnaq2tykxi7hplq5ryi,
   protected temp file via pipe, delete after; baseline before-numbers: 10.2 s
   warm / 55 stale of ~139.5k, popdam3 #486 comment ~9:32 AM EDT 2026-10-27).
   Post evidence on #4870, close it, release claim #4900
   (`--release-claim 4900 --owner zcode-hetz-4870-covidx --confirm-finished`),
   retire this handoff, remove worktree + branch and the disposable docker
   container `pg4870` (port 55433) if still running.

## 5. In-flight caveats

- Another session is concurrently working PR #4881 (PopSG semantic stage 2);
  its REST detail endpoint intermittently 422s ("too many files changed"),
  which fails Guarded Merge's cross-PR collision guard closed for EVERYONE.
  If GM fails with `cross-PR object collision guard could not gather complete
  inputs`, wait for that session's next push (it self-cleared at 11:11 AM EDT)
  and retry.
- The "Entire Gates" check (entire.com trail) is failing repo-wide and is not
  a required check; ignore it.
- Index builds take SHARE locks on `public.assets` and
  `dam.dam_asset_image_vectors` (~30-90 s each at current size) during the
  production apply; writes queue briefly. Transactional with `lock_timeout=5s`
  per the 20260830013942 precedent.

Posted by ZCode chat ${ZCODE_SESSION_ID:-unknown} on hetz
