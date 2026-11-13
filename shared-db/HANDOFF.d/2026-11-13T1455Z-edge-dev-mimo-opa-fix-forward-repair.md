---
issue: 6209
status: OPEN
owner: mimo/opa-fix-forward-repair
---

# Handoff — stuck-migration repair and the wrong OPA fix-forward (wrap-up 2026-11-13)

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

Put this WHOLE list to Albert in ONE message before starting work. Technical approvals are not here and never go to him (owner ruling 2026-09-28: never ask a human to approve).

**Blocking (blocks the corrected fix-forward and issue #6209's close):**

1. **Are OPA 372 "Mickey Mouse" and OPA 640 "X-Men" SEPARATE shared property records from OPA 361 "Standard Characters" and OPA 1107 "X-Men Classic"?** The Disney OPA contract placement work links each placed OPA property to a record in `core.property`; two links point at the wrong records (372 -> the record that belongs to 361, 640 -> the record that belongs to 1107), and no records named "Mickey Mouse" or "X-Men" exist at all. Recommendation: **SEPARATE** — create the two missing records and re-point the two links (this preserves "Standard Characters", which already carries Albert's 2026-11-12 nickname ruling "Mickey Group"). If instead they are the same entities under different names, the placement rule's name-match check is too strict and must be loosened instead. Blocks step 6.1 in "Exact next steps".

**Recoverable if guessed wrong, but wasteful:**

2. **Should the 15 GitHub-locked ghost workflow runs be purged by a GitHub Support request?** (Issue #6215.) Automation cannot delete them (GitHub answers 404/403); the new watchdog sweep names them loudly instead. Recommendation: **yes, file the purge request** — they hold per-ref concurrency slots and block later workflow runs. Not urgent for delivery; operational hygiene.

**Not part of this workstream, nobody is on it:**

3. **The DesignFlow-sandbox half of the older catch-up (version 20261112163600, PR #6147) keeps failing its own sandbox-lane check** ("DesignFlow Sandbox Migrations" runs fail at post-apply catalog verification). It is a separate route from shared-db promotion (this version is a FOREIGN_TARGET whose real delivery target is the DesignFlow sandbox). Recommendation: give it its own repair session under issue #6136/#5994's DesignFlow work. This session recorded it and moved on.

**Already settled — do NOT re-ask:**

- OPA submission names are 100% canonical (owner ruling 2026-10-26) — but see question 1: that ruling settles the *names*, not the *identity/linking* question.
- "Standard Characters"'s nickname is Mickey Group (owner ruling 2026-11-12).
- Review is advisory only and never a merge gate (owner ruling 2026-10-29).
- Never ask a human to approve (owner ruling 2026-09-28).

## 1. What this application is

`popcre/shared-db` is the shape-of-database source of truth for POP Creations' shared Supabase project (production project ref `qsllyeztdwjgirsysgai`; preview is a protected shared rehearsal database; DesignFlow sandbox is `xupnyeifmpsacrqahwwm`). CRM, DAM, PM/PIM and DesignFlow PLM all read the same tables. Migrations land via branch + PR + merge queue, then reach production ONLY through the bounded automatic promotion workflow (preview rehearsal -> automatic production apply). Repo: https://github.com/popcre/shared-db

## 2. What we set out to do this session, and why

Albert (2026-11-13, in chat): "go through all the open Issues on github for this repo, take only the ones that have no blockers, and find the 3 that should be highest priority and have individual subagents clear them." This coordinator session triaged ~100 open issues and picked three: #6209 (stuck migrations not reaching production), #6215 (ghost workflow runs wedging CI), #6193 (documentation health faults). Each was handed to its own sub-agent. #6215 and #6193 are fully cleared and closed. #6209 is 2 of 3 delivered; the third is blocked on business question 0.1 and on a WRONG merged fix-forward that must be withdrawn.

## 3. Current state — what is true right now

Checked 2026-11-13, times in EST (America/New_York).

- **main**: `84c42ee25` (https://github.com/popcre/shared-db/commit/84c42ee25), checked 09:58 AM EST. Max migration version on main: `20261113043850`. (Earlier snapshot 09:35 AM EST: main `8a15b5f53`, max version `20261113043850`.)
- **LIVE in production** (delivered by this session): version `20261112232209` (PR #6206, production apply run 43359834474, 2026-11-13T03:34:10Z) and version `20261111183827` (PR #6064, production apply run 43094471144; historical-recovery with corrected original-run reference 43088247701).
- **NOT delivered**: version `20261112225250` (PR #6203, https://github.com/popcre/shared-db/pull/6203) — its #2541 post-condition fails on 2 of 528 studio-placed OPA properties because the `taxonomy_source_ref` links are wrong (see 5).
- **Merged but WRONG — must be withdrawn**: version `20261113041225`, PR #6227 (https://github.com/popcre/shared-db/pull/6227, merged 2026-11-13T04:47:32Z as commit 3c91786c9). File: https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261113041225_opa_contract_studio_placement_fix_forward.sql It renames two shared `core.property` rows to match OPA names — the renames belong to OTHER properties' rows. It is kept out of production ONLY by blocking review finding #6228 (https://github.com/popcre/shared-db/issues/6228): the promotion lane holds "for a blocking review finding". **If #6228 is closed without a replacement fix, the lane will deliver these wrong renames to production.**
- **Preview (protected shared project) — dirty because of us**: version `20261113041225` APPLIED on preview (run 43368574276, "Bounded apply" succeeded ~04:5x UTC). It renamed `core.property` row id `4bb52946` ("Standard Characters", the entity of OPA 361) to "Mickey Mouse" and row id `e0cde0d5` ("X-Men Classic", the entity of OPA 1107) to "X-Men", and wrote `metadata.submission_canonical` entries on both (authorising_issue 2541, migration 20261113041225, fix_forward true). The corrected fix-forward MUST restore these two rows (their `previous_name` is preserved in that metadata).
- **Issues**: #6209 OPEN (handover comment posted: https://github.com/popcre/shared-db/issues/6209#issuecomment-6856490292); #6215 CLOSED (ghost-run live proof, run 43344255086); #6193 CLOSED (doc health clean). Review finding #6228 OPEN (blocks the wrong version). Review finding #6207 closed by us.
- **PRs of this session**: #6220 MERGED 01:38:54Z (doc health, https://github.com/popcre/shared-db/pull/6220), #6222 MERGED 02:58:22Z (restore pinned #1039 forward proof + doc-health exclusion, https://github.com/popcre/shared-db/pull/6222), #6227 MERGED 04:47:32Z (WRONG fix-forward, above). No open PRs of ours remain.
- **Worktrees of this session** (all clean; branches' PRs merged): `shared-db-wt-6222` (branch `coord/6222-doc-health-exclusion`, tip def3900f2), `shared-db-6209-mimo` under the system temp dir (branch `fix/6209-opa-fix-forward`, tip baae9f4b2), `shared-db-wt-docs6193` (branch `fix/docs-health-6193`, tip ba9cceb49). Being retired in the wrap-up sweep — if you find them, their PRs (#6222/#6227/#6220) are merged and they hold no unique bytes. Other worktrees in the repo belong to OTHER sessions (e.g. `ghost-run-reaper`, `6119-stuck-migration-repair`, `triage-handoff-ffe5e443`, `shared-db-main-check`) — do not touch them.
- Sub-agents general-1 (issue #6209 repair), general-2 (issue #6215), general-3 (issue #6193) all completed and returned; their blocks are in part (b).

## 4. Everything we tried that did NOT work

1. **The rename fix-forward (PR #6227) — the wrong fix entirely.** We assumed two `core.property` rows had drifted names and renamed them to match the OPA names. Review finding #6228 correctly caught that those rows belong to OTHER OPA properties (361 and 1107). Renaming would have corrupted shared entities — including "Standard Characters", which carries Albert's Mickey Group nickname ruling. Lesson: never rename a shared entity to fix a link; re-point the link.
2. **Trusting a passing preview rehearsal as production proof.** 20261112225250's rehearsal passed because preview data already matched the post-condition; production needed the write, and because the write and the post-condition shared one DO block, the post-condition failure rolled the write back. Isolate writes from post-conditions in their own DO blocks.
3. **Reading the "main moved" refusals as change faults.** All original exhausted attempts were transient coordination refusals (20261112163600 runs 43276821707/43278921545/43280852374; 20261112232209 runs 43331925739/43332357613/43332786333/43333564607; 20261111183827 runs 43303160414-43327480559; 20261112190611 runs 43305309525/43308658833/43312912345). The refund classifier cannot read in-job failure evidence and defaults to "change fault", so attempt budgets burned instead of refunding.
4. **Historical-recovery pointed at a recovery run as the "original"** (run 43093794366 for 20261111183827). The production gate rejects recovery-on-recovery evidence chains. The true original is run 43088247701 (a normal post-merge rehearsal whose Bounded apply succeeded). The gate distinguishes them by the `historical-preview-source.json` artifact marker.
5. **Concurrent preview-lane dispatches cancel each other** (concurrency group). Dispatch strictly sequentially against freshly-read SHAs.
6. **`gh run rerun` cannot re-run production apply runs.** A fresh preview rehearsal is required to trigger auto-qualification.
7. **A failed production apply leaves a promotion merge freeze.** Releasable only when STALE via `scripts/manage-migration-coordination.mjs --release-promotion-freeze`; never release a live production hold. A live freeze correctly refused our docs merges (standing fact 14) until its TTL expired; the documents-only authorization check must then be re-proved (it is the "Re-prove and authorize under the repository-maintenance mutex" job).
8. **Editing `docs/verification/issue-1039-production-risk-activation-forward-proof.md` breaks the SHA-256 pin** in `config/production-risk-policy-activation.json` (hash `8fe5889eba4e31f7683db77fdfc7cf766243c55104ff5e5c7a5bc8fdf12e9c9b`) and blocks ALL production applies ("forward-test proof does not match the activated record"). This recurred three times (commits 00a6e4900, d1119d645, 9b94f7369 — the last one ours, via a doc-health header fix). PR #6222 restored the exact bytes AND added the file to the `exclude` list in `.doc-health.json` so doc-health can never touch it again. Never re-add a header to that file; never remove the exclusion without a replacement pin strategy.
9. **Long helper CLIs die as "ChildProcess.kill" through some harness paths** (`ai-pr-wait`, `ai-shared-db-closeout-check`). They queue for minutes behind the machine-wide `ai-gh` admission throttle. Run them detached (`nohup … &` inside bash) and poll their output file instead of blocking.
10. **`gh pr merge` in this repo enqueues silently** (no output). Confirm via `git ls-remote --heads origin "gh-readonly-queue/*"` or the "already queued to merge" message on retry. Never `--admin`/`--squash`; the queue refuses them.

## 5. Root causes and key findings

- **The #2541 placement chain is broken by wrong links, not names.** `plm.opa_property` 372 ("Mickey Mouse") has a `core.taxonomy_source_ref` row (source_system `disney_opa`, source_table `plm.opa_property`) pointing at `core.property` id `4bb52946` — the row named "Standard Characters" that belongs to OPA 361. Likewise OPA 640 ("X-Men") -> `core.property` id `e0cde0d5` ("X-Men Classic", the entity of OPA 1107). No `core.property` rows named "Mickey Mouse" or "X-Men" exist. The links were created with `on conflict do nothing` (see `taxonomy_source_ref` writes in https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261112225250_opa_contract_studio_placement.sql), which preserves existing links even when the target row's name has drifted; the post-condition's `p.name = o.property_name` join is what catches the mismatch.
- **The post-condition in `20261112225250`** (same file) raises `#2541 post-condition: 527 of 528 studio-placed OPA properties are canonical` — one count out; it was actually two rows failing the name join once the links were examined (the sub-agent's first report said "1 of 528", its final analysis found both rows).
- **A DO block that both writes and post-checks rolls back the write on failure**, so a migration can "pass on preview, fail on production" purely because the data differed.
- **The forward-proof pin** (`config/production-risk-policy-activation.json`, key `forward_test_sha256`) is a tamper guard on a frozen evidence file; doc-health cleanups keep colliding with it. The durable fix (landed in PR #6222) is to exclude the file from doc-health, not to update the pin.
- **Systemic findings filed on #6209 and NOT fixed** (need their own follow-ups): the `earlier_preview_apply` predicate in https://github.com/popcre/shared-db/blob/main/scripts/automatic_promotion_candidates.py checks job conclusion, not step-level apply success (runs where "Bounded apply" succeeded but a later step failed are invisible to it); and the recovery-on-recovery evidence-chain gap in the production risk gate.

## 6. Exact next steps (in order)

1. **Get Albert's answer to business question 0.1** (separate entities vs same entities). You'll know you have it when the answer is recorded on issue #6209.
2. **If SEPARATE (the recommendation): author the corrected fix-forward** in your own worktree from `origin/main`:
   - New migration, version reserved ONLY via `check-dispatch-collision.mjs --reserve-version` (never hand-pick a 14-digit timestamp — duplicates silently skip).
   - `derived-from: 20261112225250`.
   - Must: (a) restore the two wrongly-renamed `core.property` rows on any database where `20261113041225` applied (read `metadata.submission_canonical.previous_name` for the exact strings: "Standard Characters" for id `4bb52946`, "X-Men Classic" for id `e0cde0d5`) — on production these rows were never renamed, so the restore must be conditional/no-op there; (b) create the two missing `core.property` rows "Mickey Mouse" and "X-Men" under the right licensor (check how OPA 372/640's studio_code maps: `marvel`->`MV`, `lucasfilm`->`SW`, else `DY` — 640 "X-Men" is Marvel, 372 "Mickey Mouse" is Disney); (c) RE-POINT the two `core.taxonomy_source_ref` links to the new rows; (d) keep the #2541 post-condition intact and in its own DO block AFTER the writes.
   - If Albert answers SAME ENTITIES instead: the fix relaxes the post-condition's name-match instead — same version-reservation rules.
   You'll know it worked when `scripts/check-sql.sh` passes and the preview rehearsal of the new version succeeds.
3. **Withdraw/retire version `20261113041225`** (the wrong fix-forward) through the repo's governed retirement mechanism (`createRetirementTombstone` / retirement record — see `scripts/manage-migration-coordination.mjs` and `scripts/migration-retirement-tombstones.test.mjs` for the record shape). It must never reach production. You'll know it worked when the ledger-drift report lists it as retired/deliberately-held and the promotion lane no longer dispatches it.
4. **Deliver 20261112225250 through the normal path** (preview rehearsal -> automatic production apply) — the corrected fix-forward satisfies its post-condition. You'll know it worked when the version shows in the production `schema_migrations` ledger and the #2541 post-condition passes.
5. **Close review finding #6228** with a note naming the replacement fix, and **close #6209** with the live-proof evidence for all three delivered versions (`20261112232209`, `20261111183827`, `20261112225250` + fix-forward). Note `20261112163600` remains a DesignFlow-sandbox delivery (see 0.3) — name it in the closing note so it is not lost.
6. **Optional (0.2)**: file the GitHub Support purge request for the 15 locked ghost runs (issue #6215 records their IDs and the sweep evidence).

## 7. Constraints and gotchas in force

- Claim-first: a session needing a database-shape change claims the exact objects on the existing issue (a `db-claim` block naming version + objects) and does the work itself. There is no orchestrator. Declare `SHARED_DB_AUTHOR_ENGINE` and `SHARED_DB_SESSION_ID`.
- Worktree-only: never edit the canonical checkout; use your own worktree cut from `origin/main`.
- Never edit an applied migration; fix forward under a NEW reserved version. Reserve versions only through `check-dispatch-collision.mjs --reserve-version` / `manage-migration-coordination.mjs`.
- Production is read-only by default; delivery happens ONLY through the bounded Shared Supabase Migrations workflow. No manual production SQL, no bypasses, never `--admin`/`--squash`.
- The promotion merge freeze is real (standing fact 14): merges pause during production applies. Re-prove the documents-only authorization after a freeze expires; release only STALE freezes.
- Do not touch `docs/verification/issue-1039-production-risk-activation-forward-proof.md` (SHA-256 pinned; excluded from doc-health on purpose).
- `HANDOFF.d/` files: never rewrite another session's file; retire one only under the successor rule (its issue closed, obligations carried forward). File names: `YYYY-MM-DDTHHMMZ-<machine>-<agent>-<slug>.md` (hyphenated date).
- Sign every GitHub post: `Posted by MiMo chat <id> on <machine>` (use `unknown` for an empty session id). This machine signs as `edge-dev`.
- Long helpers (`ai-pr-wait`, `ai-shared-db-closeout-check`) die as `ChildProcess.kill` in some harness paths; run detached and poll.

## 8. Access and environment

- GitHub: `gh` authenticated as `u2giants` (the owner's account). Repo `popcre/shared-db`.
- `ai-task-gates`, `ai-doc-health`, `ai-doc-safety`, `ai-pr-wait`, `ai-shared-db-closeout-check`, `ai-housekeeping` are installed from `popcre/ai-devops` (https://github.com/popcre/ai-devops). Most are on PATH; `ai-doc-health` is a Python script that must be run through its `.cmd` wrapper (running the extensionless file via bash fails).
- Migration lane CLIs: `scripts/manage-migration-coordination.mjs`, `scripts/check-dispatch-collision.mjs`, `scripts/automatic_promotion_candidates.py`, `scripts/historical_preview_recovery.py`, `scripts/production_migration_guard.py` (all in the repo).
- Secrets: none used or created this session. 1Password vault `vibe_coding` is the only place credentials ever live; never write values into chat, logs, or commits.
- Session id: `ses_ffe5e2d8ca5bcffept9l960z8B` (use with `ai-shared-db-closeout-check --session-id`).

## 9. Open questions and risks

- **Risk (2026-11-13): version `20261113041225` is merged and wrong.** It is out of production only while review finding #6228 is open. Do not close #6228 before the replacement fix (step 6.2) and the retirement (step 6.3) are done. This is the single most dangerous loose end in this handoff.
- **Risk: preview holds two wrong `core.property` names** (step 3 disclosure). Any rehearsal asserting property names may misread them until the corrected fix-forward restores the rows.
- **Open: the two systemic findings** (section 5, last bullet) have no owner session yet.
- **Open: DesignFlow-sandbox delivery of `20261112163600`** keeps failing its own lane (business item 0.3).
- **Decisions made this session, dated so they cannot be unknowingly contradicted:** 2026-11-13 we restored the #1039 forward-proof pin and excluded the file from doc-health (PR #6222) instead of updating the pin — the pin is a tamper guard and must not be edited alongside content. 2026-11-13 we closed #6215 on live proof (sweep run 43344255086) and #6193 on a clean `ai-doc-health` run.

---

# Part (b) — sub-agent blocks

### Agent: general-1 (repair session for #6209; worktree `shared-db-6209-mimo` under the system temp dir, branch `fix/6209-opa-fix-forward`)
- **Asked to do:** Clear #6209 — diagnose the exhausted promotion attempts, fix, re-dispatch, deliver, and close.
- **Actually did:** Diagnosed the whole stuck set (transient "main moved" refusals misclassified as change faults); closed review finding #6207; re-dispatched and delivered `20261112232209` (live, run 43359834474) and `20261111183827` (live, run 43094471144, corrected original-run reference 43088247701); released one stale promotion freeze; identified the two wrong-link rows; opened PR #6227 (version `20261113041225`, reserved via `check-dispatch-collision.mjs --reserve-version`) — merged 04:47:32Z but WRONG (see part (a) section 4.1); filed the systemic findings and the exact remaining step on #6209.
- **Found:** The #2541 post-condition failure is wrong `taxonomy_source_ref` links (OPA 372 -> OPA 361's row, OPA 640 -> OPA 1107's row), not name drift; review finding #6228 independently caught the rename error.
- **PR / branch:** https://github.com/popcre/shared-db/pull/6227 (MERGED, wrong) / `fix/6209-opa-fix-forward`.
- **Worktree:** finished (safe to clean — PR merged, tree clean at baae9f4b2).
- **Deliberately did NOT do, and why:** Stopped at the business question as instructed — did not guess whether the properties are separate entities; did not relax the post-condition; did not attempt the DesignFlow-sandbox delivery of `20261112163600` (separate route).

### Agent: general-2 (issue #6215 ghost-run live proof)
- **Asked to do:** Clear #6215 — prove the just-merged ghost-run sweep works and close the issue.
- **Actually did:** Verified all three fixes of PR #6216 on `origin/main`; recorded live proof from scheduled sweep run 43344255086 (4 older ghosts reaped; 15 wedge ghosts named GitHub-support-purge-only — the sanctioned outcome (b)); posted evidence and closed #6215 at 8:25 PM EST 2026-11-12. No files touched.
- **Found:** The 15 ghosts from the 2026-11-11 wedge are hard-locked by GitHub (cancel 409, delete 403) — only GitHub Support can purge them; the sweep correctly reds naming them.
- **PR / branch:** none.
- **Worktree:** none created (observation and issue hygiene only).
- **Deliberately did NOT do, and why:** Did not open a GitHub Support ticket (contacting a third party on Albert's behalf is out of scope — raised as business item 0.2); did not touch the 2 ghosts in `popcre/ai-devops` (follow-up under popcre/ai-devops#2367).

### Agent: general-3 (issue #6193 documentation health)
- **Asked to do:** Clear #6193 — get `ai-doc-health` to zero faults and close the issue.
- **Actually did:** Cleared 7 live faults on branch `fix/docs-health-6193` (shortened a header summary; added a four-key header; fixed a reachability link in `plan_db-anti-bloat-safeguards.md`; renamed 3 HANDOFF.d files to the hyphenated-date convention after grepping that no citations named the old paths; regenerated `docs/INDEX.md`); after review, added the required `---` frontmatter (`issue:`/`status:`/`owner:`) to the two renamed handoff files that lacked it (contract-compliance repair, disclosed in the PR body); closed #6193 with clean-run evidence. PR #6220 merged 2026-11-13T01:38:54Z.
- **Found:** The 31-day-old handoff fault was already resolved upstream; `ai-doc-health` is a Python script behind `bin/ai-doc-health.cmd`; HANDOFF.d contract requires the frontmatter block on every file a PR touches.
- **PR / branch:** https://github.com/popcre/shared-db/pull/6220 (MERGED) / `fix/docs-health-6193`.
- **Worktree:** `shared-db-wt-docs6193` — finished (safe to clean — PR merged, tree clean at ba9cceb49).
- **Deliberately did NOT do, and why:** Did not retire the one handoff file whose issue is closed but which open issues still cite (per #5993's rule); did not touch evidence bulk beyond the two named files.
