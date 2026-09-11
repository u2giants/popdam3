---
issue: 2280
status: BLOCKED
owner: codex/2280-expired-claim-recovery
---

# Issue #2280 expired protected-claim recovery

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None. Albert does not need to decide or perform anything for this workstream. The only blocker is sequencing: the owner of earlier PR #2266 must finish or close that PR before this branch can be rebased and reviewed. Do not ask Albert to merge either PR.

Already settled — do not re-ask:

- 2026-09-04: this is repository-maintenance work, not structural database work. It must not touch orchestrator marker #2269, claim issues, database structure, preview, or production except through the recovery command after this tooling PR itself is merged and a structural owner explicitly invokes it.
- 2026-09-04: the only allowed independent reviewers for this work are Grok 4.6, GLM 5.3, or verified Muse Spark 1.3 Contributor. Installed Muse Spark 1.2 and Kimi K3 are prohibited for twelve hours.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the database structure shared by POP Creations applications. This task changes only its repository coordination tooling: the script that protects migration-author claims and refuses unsafe concurrent schema work. GitHub is the authoritative delivery path; this repo uses a branch, pull request, CI, independent exact-head review, and guarded merge to `main`.

## 2. What we set out to do this session, and why

Issue #2280 records a deadlock in expired protected claims. An open structural PR can prove that its migration writes child objects, such as columns, which were not listed when its original claim was created. Ordinary renewal correctly refuses uncovered objects, while ordinary expansion correctly refuses an expired lease. The required repair is one append-only, fail-closed, mutex-protected command that validates the issue, claim, PR, exact head, migration version, parser output, and collisions; appends only the proven missing objects; and renews the lease atomically.

The two production-shaped regression fixtures are:

- Issues #2177/#2182 and PR #2183: two tables plus eight child columns.
- Issues #2175/#2184 and PR #2185: two tables plus twelve child columns.

## 3. Current state — what is true right now

Implementation is committed and pushed on branch `codex/2280-expired-claim-recovery`, PR #2281: https://github.com/u2giants/shared-db/pull/2281.

- Exact head: `9c5eec4dc4d1703166fe5f9de9d3ab3e14084435`.
- Current `origin/main`: `591b8951485c601dc2652b11e51aa1b2b366d854`.
- Branch merge-base: `4ad84a354559bf2a3c8f95a0d6028c1b02d8da22`; branch is 3 commits ahead and 21 commits behind current main.
- Worktree: `C:\Users\ahazan\.codex\worktrees\ec09\shared-db`.
- Worktree was clean before this handoff file was added. The branch and remote matched exactly.
- Main implementation is in `scripts/manage-migration-author-lanes.mjs:4273-4400`, with CLI routing at `scripts/manage-migration-author-lanes.mjs:4958-5012`.
- Regression and refusal tests are in `scripts/manage-migration-author-lanes.test.mjs:2873-2923`.
- Focused suite passed 433/433 after the final fixes. The throughput truth audit passed all 248 sites. A full `node --test scripts/*.test.mjs` passed before the final small review repairs; it must be rerun after rebase.
- Current CI has every applicable check green except `Cross-PR object collision`. Preview, production dry run, production review, and production apply are skipped, as expected for tooling-only work.
- PR #2281 is open and blocked. Earlier PR #2266 edits the same protected script and is still open at `fd8a9ffe7e0f1d0660fc7fe9cc9bf57f6b564f9e`; its checks are green but it lacks a required reviewer verdict.
- Grok 4.6 reviewed earlier head `bc800e71` and returned REVISE. Its blocking mutex-allowlist finding, renewal-maintainability suggestion, and thin refusal-test concern were all fixed in `9c5eec4d`. There is not yet an allowed exact-head approval for `9c5eec4d`; any review before rebase would immediately become stale.
- Nothing was applied to preview or production. No database object, claim issue, orchestrator marker, reviewer ref, or live environment was mutated by this task.

## 4. Everything we tried that did NOT work

1. The first CI run failed because one test expected a different appended-object ordering. The implementation preserved deterministic parser order; the brittle expectation was corrected, not the behavior.
2. The first governed Grok invocation included an extra argument separator and exited before review. Re-running with the wrapper's documented argument shape succeeded and produced the REVISE verdict on `bc800e71`.
3. The first implementation omitted `expired-claim-recovery` from the stale author-mutex allowlist. Grok correctly identified that a crashed recovery could then leave a mutex that the normal stale-lock recovery refused. The allowlist and a regression test are now present at `scripts/manage-migration-author-lanes.mjs:1837` and `scripts/manage-migration-author-lanes.test.mjs:2621`.
4. The first renewal path still required claim objects to exactly equal the issue's original table-only scope. That would make a successfully expanded claim impossible to renew later. Renewal now permits a claim superset only when every extra protected object is authorized by the exact PR parser; ordinary issue coverage remains mandatory at `scripts/manage-migration-author-lanes.mjs:4273-4335`.
5. Repeated polling did not move PR #2266. Do not rerun #2281 CI unchanged or bypass the collision check. It is reporting a real protected-source sequencing conflict.

## 5. Root causes and key findings

- The deadlock is caused by two individually correct refusals with no combined audited transition: renewal rejects PR-derived child objects absent from the original claim, and expansion rejects an expired lease.
- Recovery must be a single mutex-owned operation. `recoverExpiredClaimFromPr` starts at `scripts/manage-migration-author-lanes.mjs:4365`; it validates exact issue/claim/PR identity, full 40-character head, branch, owner, worktree, permanent version ref, one migration version, parser source, parsed writes, and collision freedom before its one GitHub issue update.
- `appendClaimObjects` at `scripts/manage-migration-author-lanes.mjs:4353` preserves all existing claim body bytes and appends only missing objects to the existing `writes:` or `objects:` block. Lease expiry is then renewed.
- The operation re-reads issue, claim, and PR while holding the global author mutex. Ambiguous update failure rolls back only while mutex ownership is still proven; loss of mutex ownership refuses rollback to avoid overwriting a concurrent owner.
- Actual claim titles use forms such as `CLAIM: Issue #2175...`; strict matching of only `CLAIM: #2175` would reject real claims. The implementation uses parsed issue references and requires exactly one matching issue.
- Protected-source serialization is working as designed: PR #2266 must clear before #2281 can be rebased, freshly reviewed, and merged.

## 6. Exact next steps

1. Verify PR #2266 is MERGED or CLOSED and record its final head. You will know this is safe when `gh pr view 2266 --repo u2giants/shared-db --json state,mergedAt` no longer reports `OPEN`.
2. Fetch current `origin/main`, rebase `codex/2280-expired-claim-recovery` onto it, and resolve only this branch's overlap with `scripts/manage-migration-author-lanes.mjs`. Preserve PR #2266's landed behavior and all #2280 recovery behavior. You will know it worked when `git merge-base HEAD origin/main` equals current `origin/main`, the worktree is clean, and the branch diff contains only issue #2280 plus this handoff.
3. Rerun `node --test scripts/*.test.mjs`, `node scripts/check-throughput-truth-audit.mjs`, and `git diff --check`. You will know it worked when every command exits 0 with no failures.
4. Push the rebased branch using `--force-with-lease`, then wait for all applicable PR #2281 checks. Do not rerun an unchanged failure. You will know it worked when `Cross-PR object collision` and all other required checks are green on the new exact head.
5. Assign an exact-head reviewer through `manage-migration-author-lanes.mjs --assign-reviewer` for issue #2280/PR #2281, slot 1. Accept only Grok 4.6, GLM 5.3, or verified Muse Spark 1.3 Contributor. If Grok is assigned, continue persistent session `issue-2280-expired-claim`; make it reread the new head and verify all prior findings. You will know it worked when the durable verdict ref records APPROVE for the new 40-character head.
6. Use the repository's guarded merge workflow; do not use an unguarded raw merge. You will know it worked when PR #2281 reports MERGED, the merge commit is reachable from current `origin/main`, issue #2280 is closed, and the protected-source check identifies no competing PR.
7. Delete this handoff file in the finishing commit under the successor rule after all obligations above are proven on `main`. Notify source task `01a06a69-cbe3-7183-b029-8ce75153c7e1` with the merge commit and exact verification. You will know closeout is complete when the file is absent on main and the source task has the final evidence.

## 7. Constraints and gotchas in force

- This is repository-maintenance work outside the structural orchestrator. Never touch marker #2269 or manually edit/release claim or reviewer refs.
- Do not invoke the new recovery command against #2182 or #2184 as part of merging the tool. The structural owners decide when to use the merged capability.
- Do not mutate preview, production, or database structure/data.
- Do not bypass protected-source serialization, weaken tests, close another owner's PR, or self-create a synthetic reviewer verdict.
- Exact-head approval becomes stale after any rebase or commit. Review only after the final branch head is pushed and CI is current.
- The live orchestrator engine cannot review its own work. Installed Muse Spark 1.2 and Kimi K3 remain prohibited for the user-specified twelve-hour window; verify the provider identity before accepting Muse.
- Shared-db uses branch/PR/guarded-merge delivery. Albert does not merge this PR.
- Preserve concurrent work and stage only owned files. Never rewrite root `HANDOFF.md` or another session's handoff.

## 8. Access and environment

- GitHub CLI was authenticated for `u2giants/shared-db`; it successfully read issues, PRs, checks, refs, and pushed this branch.
- Node.js and repository scripts ran locally in the EDGE-DEV worktree above.
- Governed Grok access worked through the repository wrapper. The prior review's cost was not exposed by the governed runner, so no cost is claimed.
- No database or Supabase credentials were used. No secret values or `.env` files were created or changed. If future access requires credentials, use the `vibe_coding` 1Password vault and never print values.

## 9. Open questions and risks

- 2026-09-04: PR #2266 may merge with changes overlapping the same functions. The successor must resolve semantically and rerun the full suite; a textual rebase success is insufficient.
- 2026-09-04: current main moved 21 commits beyond this branch's merge-base during the session. All CI and reviewer evidence must be regenerated after rebase.
- 2026-09-04: Grok's REVISE verdict is useful historical evidence but not approval. The corrected exact head has no durable allowed-reviewer APPROVE yet.
- 2026-09-04: the recovery path is deliberately fail-closed. If live issue/claim/PR text differs from the tested shapes, investigate and add a truthful fixture; do not loosen identity, parser, collision, or mutex checks merely to make the command proceed.

## Final self-audit

1. Yes: sections 1–9 define the repository, business purpose, exact implementation, current Git/GitHub state, failures, findings, ordered continuation, constraints, access, and risks for a newcomer.
2. Yes: sections 3–6 contain every exact SHA, PR/issue identity, file/line location, failed approach, reviewer result, blocker, and executable next gate known to this session.
3. Yes: background and intended outcome are in sections 1–2; evidence and deployment status in section 3; dead ends in section 4; causes in section 5; exact actions and success tests in section 6; constraints/access/risks in sections 7–9.
4. Yes: a line-by-line sweep of sections 1–9 found no decision requiring Albert. The sequencing blocker and reviewer restrictions are settled constraints, both consolidated in section 0 with explicit instructions not to re-ask.
