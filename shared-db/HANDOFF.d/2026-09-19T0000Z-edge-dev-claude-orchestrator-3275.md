---
issue: 3191
status: BLOCKED
owner: claude/shared-db-orchestrator-255ebb (marker #3275, closed at session end)
---

# Orchestrator session closeout — marker #3275

## 1. What this session was asked to do
Albert (chat message, this session): "clear #3218, #3104, #3091, #3023, #3036,
#3174, #3264, #3191, #3091, #2870" in `popcre/shared-db` (formerly
`u2giants/shared-db`), running as the sole orchestrator.

## 2. What was actually done
- Opened orchestrator marker **#3275** (route_id `local_e81e0ac2-472a-4227-92b3-16fce6a866ee`),
  resolved clean via `node scripts/check-orchestrator-marker.mjs --resolve`.
- Already closed before the session: **#3104, #3091, #3036, #3264, #2870**.
- Closed with signed comments after confirming delivery on production:
  **#3023**, **#3174**. Both non-orchestrator work.
- **#3218** — dispatched an agent. Finding: production already has the `hts_rag`
  schema, all ten tables and all its migrations. The migration the ticket names
  builds a sandbox-only test schema (`hts_rag_split`), not `hts_rag`. Real cause:
  the production app runs with `HTS_RAG_DB_ENABLED=false` on Cloud Run
  `popcre-core-prod`. Finding posted on #3218; issue left OPEN. Non-orchestrator.
- **#3191** — dispatched an agent to deliver the narrowest grant so
  `supabase_read_only_user` can verify the #2611 prepack exclusion on production.
  PR **#3277** (`feat(#3191): read-only proof role may execute plm.prepack_role`)
  was approved by two independent reviewers and **MERGED**. Preview rehearsal
  passed. Orchestrator work.

## 3. Applied to preview / production
- Preview: the #3277 migration was rehearsed (passed). No ad-hoc data rows written.
- Production: **nothing**. No manual production command was run in this session.

## 4. Half-finished / abandoned
**#3191 is merged but not live.** The automatic production promotion lane refused
it with, verbatim:
`ENGINEER ACTION REQUIRED: automatic production promotion is not fully
machine-qualified: access or permissions materially change…`
A grant changes access, so it is outside the automatic lane's exception and needs
the manual release route, which this session is not authorized to run.
Consequences still open: the #2611 live proof on production, closing #3191, and
releasing version claim **#3276** (held until the release happens).

## 5. What this session owns
- Marker **#3275** — closed as the final action of this closeout.
- Worktree `C:\repos\shared-db\.claude\worktrees\ecstatic-mestorf-2708ca`,
  branch `claude/shared-db-orchestrator-255ebb`. Clean apart from this handoff
  file and the PR that carries it. Safe to clean after that PR merges.
- No other open PR in this repo belongs to this session. The eleven open PRs
  listed at closeout (#3279, #3274, #3258, #3248, #3214, #3188, #3186, #3103,
  #2877, #2835, #2607) belong to other sessions — deliberately untouched.
- Sub-agents: both finished and reported. Neither has a live worktree to resume.

### Agent: Deliver shared-db #3191 grant
- **Asked to do:** narrowest grant so the proof role can verify #2611 on production.
- **Actually did:** authored the migration, PR #3277, two independent APPROVEs,
  merged; preview rehearsal passed; signed stop note posted on #3191.
- **Found:** the automatic promotion lane refuses permission changes (verbatim
  line in section 4).
- **PR / branch:** #3277, MERGED.
- **Worktree:** finished — safe to clean.
- **Deliberately did NOT do:** run the manual production release; it is outside
  its authorization. It also did not close #3191, correctly, since the outcome is
  not proven live.

### Agent: #3218 investigation
- **Asked to do:** find why live duty research fails its precheck.
- **Actually did:** compared production schema and migration history against the
  ticket's claim; posted the finding on #3218.
- **Found:** the database is not missing anything; the app setting is off.
- **PR / branch:** none — read-only.
- **Worktree:** finished — safe to clean.
- **Deliberately did NOT do:** change any Cloud Run environment variable. That is
  DesignFlow production work and needs an independent reviewer's APPROVE.

## 6. The exact next actions
1. **#3191** — an engineer authorized for manual production releases applies the
   merged #3277 migration to production through the manual route, with an
   independent reviewer's APPROVE on the exact dispatch inputs.
2. Re-run the **#2611** prepack-exclusion proof on production as
   `supabase_read_only_user`, post the evidence, then close **#3191** and release
   claim **#3276**.
3. **#3218** — a DesignFlow session turns on `HTS_RAG_DB_ENABLED` with the
   `hts_rag` settings on Cloud Run `popcre-core-prod`, again with an independent
   reviewer's APPROVE, then proves duty research works on the live site and
   closes #3218. Not orchestrator work; do not route it here.

## 7. Blocked on
- #3191: authorization to run the manual production release. Owner set on the
  issue at closeout.
- #3218: the DesignFlow app setting, owned outside this repo.

## 8. What was tried that did NOT work — MANDATORY
- `check-orchestrator-marker.mjs --resolve` first reported **NO ACTIVE
  ORCHESTRATOR** immediately after #3275 was created. That was lag, not an error;
  a retry cleared it. Do not recreate the marker.
- It then reported **UNROUTABLE** twice: the `route_id` lacked the `local_`
  prefix, and the `authorization: owner-current-chat <ISO>` line was missing.
  Both must be present or the marker is unroutable.
- The **automatic** production promotion lane was the intended route for #3191.
  It refuses any change that materially alters access or permissions. Do not
  retry it for this migration; it will refuse again for the same reason.
- Assuming #3218 was a missing-schema problem cost time. Production already had
  the schema; the ticket title is wrong.

## 9. Facts that may already be stale
Checked 2026-09-18 23:39Z:
- `origin/main` tip `4fcf0704`.
- Maximum migration version `20260917144950_db_data_admin_inventory_coke_wwe_peanuts_sesame_sections.sql`.
- Open PR list as in section 5; issue states #3191 OPEN, #3276 OPEN, #3218 OPEN,
  PR #3277 MERGED.
Re-derive all of these from `git`/`gh` before acting; they go stale within the hour.

## Secrets sweep
Swept the session, its diff and untracked files: no credential, token, connection
string or `.env` appeared. Nothing to store.

## Documentation pass
Nothing outside this handoff is now wrong. The automatic-promotion refusal for
permission changes is the lane behaving as `AGENTS.md` already describes, not a
new rule.

Posted by Claude chat e81e0ac2-472a-4227-92b3-16fce6a866ee on edge-dev
