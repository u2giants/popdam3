---
issue: 6685
status: OPEN
owner: mimo/6685-alsand-worker-conn-limit
---

# Handoff — #6685 cap designflow_hts_alsand_worker connections (2026-11-18, 5:36 PM EST)

One-sentence goal (Albert's original ask, still unfinished): clear
[popcre/shared-db#6685](https://github.com/popcre/shared-db/issues/6685) fully —
the durable database-side connection cap for the sandbox HTS worker role, through
to production and live proof. This session stopped at the shared-db handover gate
(wrap-up invoked mid-delivery): implementation is frozen, the claim is parked and
released, and the delivery steps below are the successor's.

## 1. What we were doing, and why

Issue [#6685](https://github.com/popcre/shared-db/issues/6685): the login role
`designflow_hts_alsand_worker` held 16 concurrent active connections for 14+
hours (2026-11-17/18), saturating the shared pooler and making PopDAM search slow
or 503 (u2giants/popdam3#1037). The issue asked for a connection cap "via the
normal shared-db path" (e.g. `ALTER ROLE ... CONNECTION LIMIT 4`) — either that
or a worker-concurrency cap. The worker-side fix is
[popcre/designflow-backend#458](https://github.com/popcre/designflow-backend/pull/458)
(still OPEN, Uma's merge — do not merge it from shared-db); the DB-side backstop
was never landed. Albert asked this session to "pull the latest repo and clear
https://github.com/popcre/shared-db/issues/6685 fully".

## 2. What we actually DID

- Read-only production inspection (2026-11-18 ~6:50 PM EST, via `supabase db
  query` linked to project `qsllyeztdwjgirsysgai`):
  `designflow_hts_alsand_worker` is **rolcanlogin = true, rolconnlimit = -1**
  (unlimited), holding **5 connections** (3 active) at sample time. The role is
  created NOLOGIN by `supabase/migrations/20260911210709_hts_rag_shared_schema_least_privilege_roles.sql`
  and enabled for login by the out-of-git credential step that migration documents.
  Precedent for a login-role cap: `dam_image_embed_login` carries `rolconnlimit = 10`.
- Claim filed: [issue #6710](https://github.com/popcre/shared-db/issues/6710)
  (`db-claim` label) — fenced `db-claim` block (version `20261218120000`, object
  `role designflow_hts_alsand_worker`) plus a `db-author-lease` fence (owner
  `ses_ffe5e105c4413ffesHvMfxhSsn`, branch `mimo/6685-alsand-worker-conn-limit`).
- Work issue [#6685](https://github.com/popcre/shared-db/issues/6685) was given
  its `db-work` label and exactly one `db-work-scope` block (status ready,
  work_type structural, route claim-first, service_class urgent-application,
  change_type migration, application_return_to u2giants/popdam3).
- Implementation authored and pushed (branch `mimo/6685-alsand-worker-conn-limit`,
  worktree `D:/repos/shared-db/.claude/worktrees/6685-conn-limit`):
  - Migration
    [`supabase/migrations/20261218120000_hts_alsand_worker_connection_limit.sql`](https://github.com/popcre/shared-db/blob/mimo/6685-alsand-worker-conn-limit/supabase/migrations/20261218120000_hts_alsand_worker_connection_limit.sql)
    (commit `d72ff5145` on top of merges `0817fd4` / `a621a33b6`; final head
    `a621a33b6ccd3cc0c4664f51f724df4b0b4e5b56`): existence-guarded
    `alter role designflow_hts_alsand_worker connection limit 8;` with an
    in-migration assertion. **Why 8:** the scorer's designed budget is a
    four-connection pool (designflow-backend#458); 8 = 2× budget — room for a
    restart overlap and one operator sample (the 2026-11-18 recovery ran at 5
    live connections) while refusing the 16-way saturation.
  - Sidecar
    [`scripts/production-verification-sidecars/20261218120000.json`](https://github.com/popcre/shared-db/blob/mimo/6685-alsand-worker-conn-limit/scripts/production-verification-sidecars/20261218120000.json)
    — hash-bound `exact_row_count` on `pg_catalog.pg_roles`
    (`rolname = 'designflow_hts_alsand_worker'`, `rolconnlimit = 8`, expected 1).
    `migration_sha256` is `a8df35c9516d3edbd026f3ae911afb4c4f3b57a6855ed1cdcd2cd79fd2f2cad2`
    (CRLF-normalized file bytes). Registry entry added in
    [`config/production-verification-sidecar-registry.json`](https://github.com/popcre/shared-db/blob/mimo/6685-alsand-worker-conn-limit/config/production-verification-sidecar-registry.json).
  - Contract test
    [`supabase/tests/hts_alsand_worker_connection_limit_contract.sql`](https://github.com/popcre/shared-db/blob/mimo/6685-alsand-worker-conn-limit/supabase/tests/hts_alsand_worker_connection_limit_contract.sql)
    (passes on the ephemeral database; CI green at head `a621a33b6`).
- [PR #6711](https://github.com/popcre/shared-db/pull/6711) —
  "Cap designflow_hts_alsand_worker connections at 8 (#6685)", body has
  `Closes #6685`. State at 5:33 PM EST: OPEN, UNSTABLE (advisory checks only),
  required checks green at head `a621a33b6`. **Parked by this handover** (closed
  with resume note, branch kept).
- Local guard results at the final head: `check-sql.sh` static guards pass
  (Guard B clean vs main's newest), `check-production-verification-sidecars.mjs`
  OK (147 sidecars), `migration_derivation.py` exit 0 (`-- derived-from: none`
  present).
- Migration version reservations held forever (never reused):
  `refs/db-claims/20261218084708`, `refs/db-claims/20261218090100`,
  `refs/db-claims/20261218120000`. Per the park contract the successor must
  reserve a **fresh** version and rename the migration + sidecar + registry entry
  + contract-test comment before re-opening the PR (see §8 for why the version
  churned three times).

## 3. Applied to preview / production

**Nothing of mine was applied to preview or production.** Two preview dry-run
dispatches were attempted and both failed before any write (no migration was
applied): run `44372427949` (version `20261218090100`, ledger drift) and run
`44406585605` (version `20261218120000`, ledger drift — see §8). The only
side-effects on shared state are GitHub: claim issue #6710, issue #6685's
`db-work` label + `db-work-scope` block, PR #6711, three `refs/db-claims/*`
reservations, and three `refs/db-preview-ready/*` records from
`--prepare-preview-dispatch` (the latest: `refs/db-preview-ready/2f0429b2647fcb4309311bb8b6f30bf4ad55b5769e2b542bb668c4674d31dceb`
for head `a621a33b6`, manifest below). Preview's ledger carries OTHER sessions'
versions — see §9.

## 4. Half-finished / abandoned mid-way

The whole delivery pipeline after authoring. Not started: final pre-merge
preview dry-run dispatch, merge through the queue, post-merge preview rehearsal,
production promotion, live proof, and the issue checkboxes/close. Nothing was
abandoned mid-write; the worktree at `D:/repos/shared-db/.claude/worktrees/6685-conn-limit`
is clean and the branch is fully pushed.

## 5. What this session owns right now

- Branch `mimo/6685-alsand-worker-conn-limit` — pushed, head
  `a621a33b6ccd3cc0c4664f51f724df4b0b4e5b56`, **kept** (park contract: branch is
  never deleted).
- Worktree `D:/repos/shared-db/.claude/worktrees/6685-conn-limit` — clean
  (4 scratch files deleted at handover; nothing uncommitted), **live/resumable**.
- Claim [#6710](https://github.com/popcre/shared-db/issues/6710) — **released**
  via `--release-claim 6710 --owner ses_ffe5e105c4413ffesHvMfxhSsn --confirm-finished --park`;
  claim issue closed by the tool; PR #6711 closed with the tool's resume note.
- Tool worktree `D:/repos/shared-db/.claude/worktrees/tool-main` — pristine
  detached checkout of `e5a897027` used to run the ownership helper; carries this
  handoff branch `mimo/6685-handoff` (docs-only PR for this file).
- No sub-agents were dispatched this session (so there is no per-agent block
  beyond this one). No work delegated to any other session.

## 6. What we were ABOUT to do next

Exactly this sequence (the PREVIEW_READY manifest is already stored and valid for
head `a621a33b6`):

1. Dispatch the pre-merge preview dry-run:
   `gh workflow run shared-supabase-migrations.yml --repo popcre/shared-db -f target=preview -f mode=dry-run -f preview_allowlist=<new version> -f claim_pr=6711 -f claim_head_sha=<head after renumber>`.
   (Re-run `node scripts/manage-migration-coordination.mjs --prepare-preview-dispatch 6685`
   first if the head changed — it prints the exact manifest. Env needed:
   `SHARED_DB_AUTHOR_ENGINE=mimo`, `SHARED_DB_SESSION_ID=<session id>`,
   `SUPABASE_ACCESS_TOKEN` from 1Password.)
2. After the dry-run is green: enqueue the PR (`gh pr merge 6711`, no flags —
   the merge queue owns the strategy). Do NOT use `--admin`/`--squash`.
3. Post-merge preview rehearsal (the only route for this migration class —
   see §8): `gh workflow run shared-supabase-migrations.yml -f target=preview -f mode=apply -f preview_allowlist=<version> -f merged_preview_source_pr=6711 -f commit_sha=<current main tip>`.
   Its "Automatic production qualification and dispatch" job then dispatches the
   production apply (same pattern as PRs #6650/#6653/#6738 on 2026-11-18).
4. Live proof on production (project `qsllyeztdwjgirsysgai`):
   `select rolcanlogin, rolconnlimit from pg_roles where rolname = 'designflow_hts_alsand_worker'` → `true, 8`;
   sample `pg_stat_activity` over a scoring window → the role stays ≤ 8 and the
   nearest-product scorer still progresses; PopDAM ordinary-viewer control
   searches return 200 with stable latency (the four-search set from the #6685
   thread). Tick the live-proof box on #6685 and close it with evidence.

## 7. Blocked on

Nothing external right now. Historical blockers this session cleared: two
version collisions with other sessions (#6698 hand-renumbered onto our reserved
number; then main outran our second number), preview-ledger drift from other
sessions' rehearsals, a stranded author mutex (recovered via
`recover-author-mutex.yml`), and a stranded preview lane (another session
recovered it). If a rerun hits "Remote migration versions not found in local
migrations directory" again, see §8.

## 8. What we tried that did NOT work — MANDATORY reading

1. **Pre-merge preview APPLY is refused for this migration class by design.**
   `scripts/production_business_risk_gate.py premerge-preview-check` classifies
   `do $$` guard blocks + `alter role ...` as high-risk ("code with an
   unclassifiable data effect"), and the workflow step runs on a **default-branch
   checkout**, so any unmerged allowlist version reads as "expected one migration
   … found 0" first. Its own error text is the recipe: **"Run mode=dry-run now,
   merge, and let the automatic queue rehearse it post-merge."** Do not try to
   game the classifier; the dry-run → merge → post-merge rehearsal path is the
   sanctioned one (the same shape every successful delivery on 2026-11-18 used).
2. **`--prepare-preview-dispatch` refusals (in order, so you don't repeat them):**
   (a) `SHARED_DB_SESSION_ID` / `SHARED_DB_AUTHOR_ENGINE` must be set
   (`mimo` is a known engine); (b) the claim body must carry a
   ```db-author-lease``` fence with `owner`, `branch`, `worktree`, `expires_at`
   (a bare `db-claim` fence parses as a legacy claim with no branch, and the PR
   lookup then fails "must have exactly one live pull request"); (c) the work
   issue needs exactly one ```db-work-scope``` block and the `db-work` label;
   (d) `--check-in-author` **refuses an already-expired lease**
   ("refuses stopped, foreign or legacy execution") — renew BEFORE `expires_at`
   (renewals cap at 60 min). Also note no live gate currently demands the
   check-in receipt for merge/preview/production — don't block on it.
3. **Version collision #1 (1:47 PM vs 6:32 PM EST).** We reserved
   `20261218084708` atomically (`refs/db-claims/20261218084708`, tool
   `check-dispatch-collision.mjs --reserve-version --future-minutes 30`). PR
   #6698's takeover session then hand-renumbered its migration onto the same
   number ("Renumber #6693 migration after main's newest version") without
   holding the ref. Preview admission refused us ("open claim #6693 with an
   invalid title protects recovery version 20261218084708"). We posted a
   collision note on #6698/#6693, then **de-escalated**: renumbered ourselves to
   `20261218090100` and told #6698 to keep 84708. Lesson: "next after main's
   newest" is not a free number — only `--reserve-version` is.
4. **Version collision #2 (backdating).** After #6698/#6729 merged with
   hand-picked `20261218091500` / `20261218092000`, our `20261218090100` sorted
   before main's newest → the merge queue ejected the PR (DIRTY anyway from a
   sidecar-registry conflict). Renumbered to `20261218120000` with explicit
   `--version` — **the allocator's `--future-minutes 30` math lands just above
   main's newest in this future-stamped space (Dec stamps while the clock is
   Nov), and hand-renumberers keep picking round numbers just above main's
   newest**, so a high explicit margin is the only way to stop the churn.
5. **Preview ledger drift — twice.** `supabase db push --dry-run` refused with
   "Remote migration versions not found in local migrations directory": first
   `20261218084706`/`20261218084707` (other sessions' pre-merge applies), then
   `20261218093000` (PR #6738's rehearsal). Fix is always: **wait for the owning
   PR to merge, then merge `origin/main` into your branch** (the bounded preview
   checkout can only materialize remote-ledger files that exist in your tree).
   Never `supabase migration repair --status reverted` — those ledger rows are
   another team's applied work. Note the sharp edge: a same-version file from a
   DIFFERENT PR satisfies the CLI's version check (we were unblocked by #6738's
   `20261218093000_dam_search_word_form_candidate_cap.sql` after it merged).
6. **Merge-queue ejection / queue confusion.** After `gh pr merge` with no flags
   (correct — "the merge strategy for main is set by the merge queue"), a second
   call said "already queued" while the GraphQL merge-queue listing did not show
   the PR; re-check with
   `gh api graphql -f query='{repository(owner:"popcre",name:"shared-db"){mergeQueue(branch:"main"){entries(first:10){nodes{pullRequest{number} state position}}}}}'`
   and re-enqueue if absent. A new push ejects the queued entry (DIRTY/UNSTABLE).
7. **Sidecar registry merge conflict** with #6698 (both appended entries to
   `config/production-verification-sidecar-registry.json`): resolved as a pure
   union of both entries — keep everyone's rows, validate JSON, done.
8. **Stranded coordination locks.** A timed-out `--prepare-preview-dispatch` left
   `refs/db-coordination/author-acquisition` held (recover via
   `recover-author-mutex.yml` with the exact SHA + `RECOVER <sha>` confirmation);
   a failed preview run stranded `refs/db-coordination/preview` (another session
   used `recover-exclusive-db-lane.yml`). Verify no live process holds the ref
   before recovering. `Start-Process` backgrounding from this tool layer fails
   ("ChildProcess.kill") — run `ai-pr-wait --repo popcre/shared-db <pr>`
   foreground or poll.
9. **PowerShell ate triple backticks** in `node -e` one-liners when building
   fenced issue bodies — write fenced bodies with the Write tool, then
   `gh issue edit --body-file`. `gh issue edit --add-label` works for the
   `db-work` label.
10. **GitHub API rate limit** (shared hourly quota on this machine) repeatedly
    froze `gh` calls mid-pipeline; sleep to the reset (`gh api rate_limit` shows
    it) and batch queries. It also once made `gh pr merge` look like a no-op.

## 9. Facts that may already be stale (checked 2026-11-18 5:33 PM EST unless noted)

- `origin/main` tip `e5a897027e4b8e02cbbbb8e7464063a4c7d24c55`; newest migration
  on main `20261218093000_dam_search_word_form_candidate_cap.sql`. Main was
  moving several commits per hour all afternoon — re-fetch before anything.
- PR #6711: OPEN/UNSTABLE at head `a621a33b6` before parking. Claim #6710: OPEN
  before release. Both are being closed by this handover — re-verify.
- The stored preview manifest (may need re-prepare after any head change):
  `target=preview, mode=dry-run, preview_allowlist=20261218120000, claim_pr=6711,
  claim_head_sha=a621a33b6ccd3cc0c4664f51f724df4b0b4e5b56`, ready ref
  `refs/db-preview-ready/2f0429b2…`.
- Production role attributes (`rolcanlogin=true, rolconnlimit=-1`, 5 conns) were
  read at ~6:50 PM EST — 2026-12-18-stamped version space is the repo norm
  (versions compare to each other, never to the clock).
- designflow-backend#458 was OPEN (not merged) at 5:2x PM EST — the worker-side
  fix; Uma owns that merge. u2giants/popdam3#1037 OPEN (PopDAM acceptance).
- Preview ledger contains other sessions' applied versions
  (`20261218084706`, `20261218084707`, `20261218093000`, …) — preview is NOT a
  clean baseline.
- Comment timestamps in this file use EST (America/New_York); git/CI stamps are
  UTC.

## Outstanding work is on the existing issue

Everything above is mirrored as a dated signed comment on
[#6685](https://github.com/popcre/shared-db/issues/6685) (the one issue for this
application need — no second ticket). Its live-proof checkbox remains unchecked
there until production shows `rolconnlimit = 8`.
