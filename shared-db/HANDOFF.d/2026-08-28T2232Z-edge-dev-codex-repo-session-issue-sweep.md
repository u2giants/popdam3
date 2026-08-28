---
issue: 1789
status: OPEN
owner: codex/repo-session-backlog-handoff
---

# 0. Decisions only the owner can make

None are newly required to resume the safe repository-maintenance sweep. Each
blocked issue retains its own owner gate; do not broaden this handoff into
production database work, infrastructure mutation, or structural orchestration.

Already settled — do not re-ask without changed live facts:

- On 2026-08-25 Albert chose `popcre` as the destination and public visibility
  for the possible repository transfer tracked by #1435. That broad transfer was
  not executed in this session.
- The structural orchestrator remains separate. At the final check, marker #1786
  owned that work and handover #1778 remained its current continuation contract.

# 1. What this application is

`u2giants/shared-db` is the public source of truth for the shared Supabase
database shape and for repository tooling, documentation, and DB Data Admin.
Structural changes belong to the sole orchestrator. This handoff concerns only
the separate repository-maintenance/documentation issue queue.

# 2. What we set out to do this session, and why

Albert asked to resolve #1784 and then every issue that does not need the
structural orchestrator. The objective was to publish the preserved reviewer
allocator hardening, retire genuinely superseded coordination issues, forward
misrouted application work, and start resolving the remaining repo-session
backlog without touching database structure.

# 3. Current state — what is true right now

- #1784 and its source #1767 are closed. PR #1777 merged at
  `74a6e00a439b2ea82cc1b069a7fed3b877dcde5d`; 237 focused allocator tests and
  every required GitHub check passed.
- PR #1788 documented pure-data catalog-verification declarations and merged at
  `0d982b728b712923ff8e34ab2a5f01654152e529`; #1317 closed and all enforced
  checks passed.
- Seventeen shared-db issues were resolved or forwarded: #1767, #1784, #1415,
  #1598, #1665, #1735, #1756, #1438, #1363, #1521, #1628, #1522, #1202,
  #706, #543, #532, and #1317.
- Application work was forwarded to `u2giants/popcrm-web#5`,
  `u2giants/popdam3#102`, `u2giants/poppim-web#3`,
  `u2giants/popdam3#103`, and `popcre/designflow-frontend#163`.
- The last live count before this handoff issue was created was 47 ready and 11
  blocked repo-maintenance/documentation issues. Recount; #1789 itself now adds
  one open documentation issue.
- Branch `codex/repo-session-backlog-handoff` is based on current `origin/main`.
  Only this handoff file should be committed from it.
- The primary checkout `C:\repos\shared-db` was 137 commits behind when first
  inspected and contained many unrelated modified/untracked files. It was never
  cleaned, staged, or used for publication.
- The closeout stale-handoff audit found eight predecessor files whose issues
  this session had just proved superseded and which no open issue cited. They
  are retired in this handoff PR under the successor rule. The unrelated stale
  #1646 file is deliberately left for its owning/qualified successor.

# 4. Everything tried that did not work

- The first force-with-lease push for PR #1777 was rejected because another
  session pushed concurrently. The remote was fetched and proved to be exactly
  the already-known preserved commit before the rebased equivalent was pushed;
  no unknown work was overwritten.
- The documented documentation-only `gh pr merge --squash --admin` fast path
  was refused on PR #1788 because branch protection still required all checks.
  The checks were allowed to finish and the PR then merged normally. Do not
  assume prose can currently bypass GitHub's enforced contexts.
- Issue #1789 was initially created with literal PowerShell `` `n `` text in its
  body. It was immediately replaced through `--body-file -`; live queue output
  now recognizes #1789 as REPO-SESSION.

# 5. Root causes and key findings

- #1784's handoff was stale: the final work was committed locally and PR #1777
  already existed, but the remote lacked the last safety refinement.
- Several open issues were only old orchestrator coordination indexes. They were
  safely closed because the live successor chain culminated in #1778/#1786 and
  each carried workstream remained independently tracked.
- #1522's durable document correction had already merged in PR #1611; only the
  sanitized correction comment on #679 was missing, so no new doc patch or data
  action was needed.
- #1202 was already satisfied by the current ColdLion phases 2–6 plan and the
  dated supersession block in the historical design.
- #706, #543, and #532 were application work incorrectly parked in shared-db;
  they now have live issues in their owning repositories.

# 6. Exact next steps

1. Run `node scripts/check-orchestrator-marker.mjs --resolve` and
   `node scripts/manage-migration-author-lanes.mjs --queue-audit`. Success means
   the structural owner is current and #1789 appears only as REPO-SESSION.
2. Recount open issues by parsed `work_type`, `route`, and `status`; never reuse
   the 47/11 snapshot as current truth. Success means every candidate has a live
   issue number and current status.
3. Continue highest-priority ready repo-session work. First re-check #1436,
   #1435, #1200, and #1182 for completion/supersession evidence. Success means
   each is either delivered with proof, truthfully blocked, or left open with a
   specific unmet gate.
4. For misplaced application work, search the owning repo for duplicates, open
   the successor there first, link it here, then close the shared-db issue.
   Success means no task disappears between repositories.
5. Do not work #1778 or any structural issue; the active orchestrator owns them.
   Success means no migration, database write, claim, preview lock, or promotion
   action originates from this repo-session branch.
6. When the remaining repo-session queue is genuinely exhausted or fully
   blocked, delete this handoff file in the finishing commit and close #1789.
7. Separately audit the stale #1646 handoff before retiring it. Success means
   all successor obligations and unique decisions are proven elsewhere; absence
   of an open citation alone is not sufficient.

# 7. Constraints and gotchas in force

- Structural work is shape work and belongs only to the sole orchestrator.
- Production, preview, merge, and database writes require their own exact live
  proofs and authorizations; this handoff grants none.
- Preserve unrelated changes in the primary checkout. Stage exact owned files.
- Do not edit or retire another session's `HANDOFF.d` file merely because its
  issue looks old; apply the successor proof rule first.
- GitHub state and current queue output override issue prose, handoffs, and this
  timestamped snapshot.
- Licensed rows, private source evidence, and secrets must not enter issues,
  commits, logs, or external reviewer prompts.

# 8. Access and environment

- GitHub CLI was authenticated for `u2giants` and successfully created, edited,
  closed, and merged issues/PRs.
- Work was performed on EDGE-DEV in isolated Codex worktrees. The closeout branch
  lives at `C:\Users\ahazan\.codex\worktrees\repo1522\shared-db`.
- No database connection was used and no production or preview target was linked.
- Durable secrets belong in 1Password vault `vibe_coding`; no secret value is
  needed for the next read-only queue audit.

# 9. Open questions and risks

- #1435 may require a broad repository transfer and restoration exercise. The
  destination decision is recorded, but live settings and dependencies must be
  re-derived immediately before acting.
- #1436 depends on the isolated-preview pilot #1391 and may remain blocked until
  that pilot's prerequisite is honestly resolved.
- Some old issues are misclassified as repo-maintenance despite describing
  production promotion, structural changes, or work in another repository.
  Reclassify from the requested action, not the historical label.
- The primary checkout remains dirty with unrelated work. Using it for a broad
  pull, reset, cleanup, or commit risks other sessions' data.

# Final self-audit

1. **Yes.** Sections 1–3 give a newcomer the repository purpose, goal, exact
   delivered state, SHAs, issue list, branches, and ownership boundary.
2. **Yes.** Sections 4–5 preserve the concurrency push, merge-protection, issue
   body, stale-handover, already-done, and routing findings that would otherwise
   be rediscovered.
3. **Yes.** Sections 6–9 provide executable next steps with success gates,
   constraints, access facts, risks, and current/non-current evidence rules.
4. **Yes.** A line-by-line owner-decision sweep of sections 1–9 found no new
   decision required to resume safe reads and repo maintenance. The only broad
   settled choice, #1435's destination/public status, is indexed in section 0;
   every remaining blocked issue keeps its own owner gate.
