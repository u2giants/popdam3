---
issue: 863
status: OPEN
owner: edge-dev-mimo-nightly-monitor-863
---

# Handoff: popdam3 nightly style-group rebuild monitor (issue #863)

Written 2026-11-08 by the MiMo session that closed the 2026-11-05 Coolify
API-token watch and repaired popdam3's deploy health check. That work is DONE
and landed. This file carries ONE deferred workstream: the failing nightly
style-group rebuild monitor, tracked as issue
https://github.com/u2giants/popdam3/issues/863.

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs the owner. The monitor failure is a
technical problem with a tracked issue; fixing it is ordinary engineering work.

Already settled — do NOT re-ask:
- 2026-11-05: the Coolify token cleanup (revoke 10 dead keys, trim 3 over-armed
  keys) was owner-authorized after a GLM-5.3 second opinion.
- 2026-11-07: owner accepted the watch verdict ("not perfectly clean, one day-0
  breakage, self-recovered") and approved repairing the deploy health check.

## 1. What this application is

popdam3 is POP Creations' PopDAM platform — the digital asset / style-guide
management app behind PopDAM production (popdam-frontend, style groups, style
guide files). Repository: https://github.com/u2giants/popdam3 (this repo). It
deploys through Coolify (coolify.designflow.app) on a Hetzner VPS; container
images live in GHCR. Companion repos that share the same Coolify: u2giants/
popcrm-web (CRM web app), u2giants/emailCleanup, u2giants/authentik. Background
jobs include a nightly style-group rebuild worker whose health is watched by
the workflow "Monitor Nightly Style Group Rebuild".

## 2. What we set out to do this session, and why

(a) Close the 48-hour watch on the 2026-11-05 Coolify API-token cleanup: 10
dead tokens revoked at 10:33 AM EST, 3 live keys trimmed at 10:37 AM EST
(popcrm-web-ci and emailcleanup-deploy to [deploy,read]; root key lost delete).
The watch had to prove nothing broke. (b) After the watch closed, the owner
approved repairing popdam3's deploy health check, which had failed since at
least 2026-10-11. Both objectives are complete. The watch surfaced a third, unrelated failure — the nightly
style-group rebuild monitor — which was deliberately NOT fixed (wrap-up scope
freeze) and is filed as issue #863. That is the only open item.

## 3. Current state — what is true right now

- WATCH CLOSED 2026-11-07 11:18 AM EST. Verdict: not perfectly clean. Five
  u2giants/popcrm-web "Build and Deploy" runs failed 2026-11-05 2:07–3:40 PM
  EST with "Coolify tag pin failed with HTTP 403" because popcrm-web-ci, trimmed
  to [deploy,read] at 10:37 AM EST, lost the write the tag-pin step needs.
  Self-recovered by 3:52 PM EST: tag pinning now runs on the dedicated
  immutable-image-pin keys (which keep write). All four watched repos clean
  after that through watch close. Full evidence in 1Password vault vibe_coding,
  item "Coolify API token usage audit - dead keys and over-armed keys
  (2026-11-05)" (item id y4l773d7prmxvvehuf76xwcdgm) — read it first; it also
  contains the corrected attribution of the 2026-11-06 "DB Data Admin" failures.
- REPAIR LANDED. popdam3 PR #862 (https://github.com/u2giants/popdam3/pull/862)
  merged 2026-11-07 6:54 PM EST, squash commit
  https://github.com/u2giants/popdam3/commit/c280b463f8c8db939fae3a8f5ec29db5f775ca02.
  It makes the coolify-access job in
  https://github.com/u2giants/popdam3/blob/main/.github/workflows/db-data-admin.yml
  skip Dependabot/fork pull requests (GitHub withholds secrets there) and fail
  with an explicit error if the token is ever empty in a trusted run. Live
  proof: https://github.com/u2giants/popdam3/actions/runs/42426711292 —
  coolify-access passed in 4s reading both Coolify applications. No token
  permissions were changed; no key was minted, rotated, or revoked.
- ISSUE #863 OPEN (https://github.com/u2giants/popdam3/issues/863): the nightly
  style-group rebuild monitor fails with "No terminal worker outcome was
  recorded in the last 27 hours." Not started — no investigation has happened
  beyond the diagnosis in that issue.
- Nothing uncommitted or unpushed remains in this repo from that work.

## 4. Everything we tried that did NOT work

- PowerShell inline SQL over ssh to coolify-db: passing `psql -c "SELECT ..."`
  through ssh mangled the quoting and psql ignored every argument ("extra
  command-line argument ... ignored"). Working form: write the SQL to a file and
  pipe it: `Get-Content -Raw file.sql | ssh vps-direct "docker exec -i coolify-db
  psql -U coolify -d coolify"`.
- `gh run list --limit 50/300` cannot see 2026-11-05 on these repos (popcrm-web
  does ~300 runs/day; popdam3 ~388 runs per 8 hours). Working form: `gh api
  "repos/<owner>/<repo>/actions/runs?per_page=100&page=N&created=<ISO>..<ISO>"`
  and page through.
- Trusting PowerShell's formatted timestamps: `gh ... --json` output displays
  UTC wall-clock time on this machine, not local. Ground truth is the ISO
  `created_at` string, runner log timestamps, or coolify-db audit rows (all
  UTC). November EST = UTC-5.
- Grepping logs for '401' matches timestamps (e.g. 15:46:58.2140143Z contains
  "401"). Always print surrounding context.
- First diagnosis blamed every "DB Data Admin" failure on the empty-token
  coolify-access job. Wrong: the 2026-11-06 2:15/2:41/3:22 PM EST failures were
  verify-job test failures (npm-audit-fix PRs); coolify-access either skipped
  (push runs) or PASSED (human PRs, e.g.
  https://github.com/u2giants/popdam3/actions/runs/42281873622). Corrected in
  the vault note the same session.
- Second diagnosis suspected a missing repo secret. Wrong: the secret exists;
  GitHub simply withholds repository secrets from Dependabot-triggered and fork
  runs, so the job saw an empty value. Evidence: the failing runs' head branch
  was dependabot/github_actions/... and the env dump showed COOLIFY_TOKEN blank,
  while human PRs showed the masked value and passed.
- `ai-task-gates check --before merge` is invalid (allowed actions: review,
  code-only-review, pr-wait, ship, deploy, database, database-read,
  infrastructure, production, shared-db-promotion, application-workflow). The
  right call before merging is `check --before ship`.
- Declaring the task class "code" made `check --before ship` STOP: workflow
  files escalate to class "deployment" (protected). Fix: `ai-task-gates start
  --class deployment`, re-check, ship. Never work around the gate.

## 5. Root causes and key findings

- Dependabot- and fork-triggered Actions runs receive no repository secrets.
  Any job that consumes a secret must skip those runs (or fail with a named
  error), or it will fail forever on every bot PR. The pattern now lives in
  https://github.com/u2giants/popdam3/blob/main/.github/workflows/db-data-admin.yml
  (coolify-access `if:` line ~L155, empty-token guard in the step).
- The token cleanup's real blast radius was write-needing tag-pin steps: a key
  trimmed to [deploy,read] still deploys fine but 403s on an application
  PATCH. Coolify records each denial as api.auth.ability_denied with
  actor_token_name and required_abilities in the coolify-db `audit_events`
  table (UTC timestamps, no secret values) — good for auth forensics.
- The nightly monitor (https://github.com/u2giants/popdam3/blob/main/.github/workflows/monitor-nightly-style-group-rebuild.yml,
  job verify-worker-outcome at L13, error string at L35) fails when the
  style-group rebuild worker has written no terminal outcome to Supabase in 27
  hours. Two possible roots, undetermined: the worker is not running (dead
  schedule / silent crash) or it runs but no longer writes the outcome the
  monitor reads. The 2026-11-05 11:50 AM EST production canary failure
  ("agent_registrations: HTTP 500; bridge heartbeat: missing; expected at least
  one production row") may be the same broken worker path.
- popdam3's deploy.yml-era trust model: DB_DATA_ADMIN_COOLIFY_TOKEN is a repo
  secret shared by the read check and the deploy jobs; it authenticates
  (masked) and read/deploys succeed with it. Which Coolify key it binds to was
  not determined this session (the audit note's KEEP list is the place to
  check).

## 6. Exact next steps (the whole point of this handoff)

1. Read the monitor workflow source (URL in §5) end to end. Note exactly which
   Supabase table and query produce "the worker's latest terminal outcome".
   You'll know this step is done when you can name the table and the terminal
   states it looks for.
2. Read that table (read-only) for its most recent rows and their timestamps.
   You'll know it worked when you can say whether the worker wrote anything in
   the last 3 days, and when the last terminal row landed.
3. Find the worker that performs the nightly style-group rebuild (search this
   repo for the writer of that outcome table; check its registration/schedule).
   Cross-check "agent_registrations HTTP 500" and "bridge heartbeat: missing"
   from run https://github.com/u2giants/popdam3/actions/runs/42068596157
   (2026-11-05 11:50 AM EST canary). You'll know it worked when you can say
   whether the worker is alive, scheduled, and healthy.
4a. If the worker is dead or unscheduled: restore it, let one nightly cycle run.
4b. If the worker runs but does not write outcomes: fix the outcome-write path
   (or the monitor's query if it reads the wrong thing). Either path: you'll
   know it worked when the next scheduled "Monitor Nightly Style Group Rebuild"
   run concludes success (workflow URL in §5; runs list:
   https://github.com/u2giants/popdam3/actions/workflows/monitor-nightly-style-group-rebuild.yml).
5. Only when that run is green: close issue #863 and delete THIS handoff file
   in the same pull request (successor rule). The contract block at the top of
   this file is what proves the workstream finished.

## 7. Constraints and gotchas in force

- Never push directly to protected main: branch, PR, let checks run. Prose-only
  PRs merge with `gh pr merge --squash --admin` after ai-doc-safety passes on
  the exact head; code PRs go through normal checks. Albert does not merge —
  the AI does (owner standing rule).
- Squash merges rewrite SHAs: never compare SHAs and never use
  `git branch --merged` to decide deletion. Use `gh pr view <n> --json
  state,mergedAt` (MERGED is proof).
- Sign every GitHub post: "Posted by MiMo chat <session-id> on <machine>".
- Quote times to humans in EST/EDT (America/New_York); compute from the clock.
- Secrets: 1Password vault vibe_coding only; never values in chat, arguments,
  logs, or commits. Reference by vault/item name.
- Coolify key discipline (from the audit note): if a key must be replaced, mint
  a scoped replacement (Coolify PersonalAccessToken via
  `docker exec -u root coolify php artisan tinker`, team_id 0) and update that
  one consumer. NEVER restore a revoked full-power key.
- Do not edit other sessions' files under HANDOFF.d/ (large active set — leave
  them all alone). Do not rewrite the root HANDOFF.md pointer.
- ai-task-gates: workflow-file changes are class "deployment"; declare before
  `check --before ship`.
- No shared Supabase / popcre/shared-db work was in scope here; if your work
  touches shared-db, run the shared-db-change skill first.

## 8. Access and environment

- GitHub CLI (`gh`) authenticated as u2giants on machine edge-dev.
- `ssh vps-direct` reaches the Coolify host; the audit DB is
  `docker exec -i coolify-db psql -U coolify -d coolify` (table audit_events,
  also personal_access_tokens.last_used_at). SELECT never token values.
- 1Password MCP server is connected; the watch record is vault vibe_coding,
  item id y4l773d7prmxvvehuf76xwcdgm (title "Coolify API token usage audit -
  dead keys and over-armed keys (2026-11-05)").
- popdam3 workflow secret NAMES (values never read this session):
  DB_DATA_ADMIN_COOLIFY_TOKEN, SUPABASE_ACCESS_TOKEN, GHCR_PAT, plus repo vars
  DB_DATA_ADMIN_COOLIFY_URL / _APP_UUID / _PROD_APP_UUID.
- The session working directory (D:\repos\oracle) is NOT a git repo; the popdam3
  work happened in a scratch clone that was deleted at wrap-up.

## 9. Open questions and risks

- Risk: if the nightly style-group rebuild has silently stopped, production
  style data goes stale without any other alarm. The monitor failing IS the
  alarm — it must not be silenced; fix the worker, not the monitor.
- Open: is the 2026-11-05 canary signature (agent_registrations HTTP 500,
  bridge heartbeat missing) the same root cause? Dated 2026-11-08; a later
  session should not assume either answer without evidence.
- Recorded 2026-11-05 (GLM note in the audit item): AI admin sessions holding
  the root key with deploy+write are an incident class; per-task key elevation
  is the eventual answer. Not started; no owner decision needed to file it.
- Decision made 2026-11-05 (do not silently contradict): tag pinning for
  popcrm-web runs on the immutable-image-pin keys, NOT on popcrm-web-ci. If
  pinning is moved back to the CI key it will 403 again by design.

---

### Self-audit (handoff-writer Mode A gate)

1. Comprehensive for a brand-new developer? Yes — §1 gives the business and
   repos, §3 the exact landed state with URLs, §6 the cold-executable steps.
2. Detailed enough to continue as well as me? Yes — §4 preserves every failed
   diagnosis (the ones that cost hours) and §5 the root causes.
3. Every relevant detail? Yes — goals (§2), state (§3), failures (§4), findings
   (§5), next actions with gates (§6), constraints (§7), access (§8), risks (§9).
4. Owner-only decisions all in §0 with none technical? Yes — sweep run: the
   monitor bug is a tracked issue, not an ask; no approval, access, or key item
   appears anywhere; §0 lists the two settled owner rulings so they are not
   re-asked.
