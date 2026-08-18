---
issue: 1164
status: OPEN
owner: claude-20260818-005914Z
---

# HANDOFF — shared-db orchestrator closeout (2026-08-18 14:35 UTC, al8960ofc/Claude)

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking now

None. #1090 can be resumed without asking Albert anything.

### Waiting on Albert, not blocking

- **#1166 — queue triage.** ~90 open `db-work` issues; exactly ONE is structural (#555, blocked). Only Albert can decide which of his own business items are still live.

### Already settled — do not re-ask

- **Qwen** excluded from all new reviewer assignments until Albert restores it.
- **The owner-decision block is RETIRED (owner ruling 2026-08-18).** Never ask Albert to sign off on technical risk, paste an approval block, or adjudicate a disagreement between two AI reviewers. He is not a programmer and cannot evaluate any of it. An unresolved reviewer dispute goes to a **third AI/reviewer**, and the merge stays stopped. See §5.
- `COORDINATOR_INTAKE.md` stays retired and unwritten.
- Release A scope was exactly three versions; it is now complete and in production.

## 1. What this application is

`u2giants/shared-db` owns the STRUCTURE of the shared Supabase database used by ~9 POP Creations applications. Preview is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`. One orchestrator, three migration-author lanes, every structural change through an exact issue, permanent version reservation, claim, branch, worktree, PR, preview evidence, independent review and bounded production promotion.

## 2. What this session was asked to do

Take over as sole orchestrator; resume #1115 first; then (revised mid-session) make Sample Tracking Release A top priority and drive it to production autonomously; then get Grok's advice on a durable fix for the gate blocking it and implement that; then finish #1115, merge two PRs, and complete #1090.

## 3. Current state — VERIFIED 2026-08-18T14:32Z, re-derive before trusting

- `origin/main` = `12b1ef7ffc0e2adedb5989620325fd4963d5a925`
- Highest migration on main: `20260818141220_popdam_bulk_order_line_relink.sql`
- Lanes: **1 of 3 occupied**, 0 expired. Only claim #1144 (#1090) remains.
- Open PRs: **#1145 only** (BLOCKED — see §4).
- Locks: none held. Only `refs/db-coordination/reviewer-round-robin` exists.
- Worktrees: exactly two. `C:\repos\shared-db` (main) and `C:\repos\shared-db-worktrees\issue-1143-fr-ruling-forward` — **LIVE, clean, do not retire.**

### Preview `rjyboqwcdzcocqgmsyel`

Written to twice this session, both bounded and announced:

- `20260818024441` (Release A reconciliation), run 32093350643, delta exactly +1
- `20260818141220` (#1115 relink), run 32147250008, delta exactly +1

Six unrelated pending versions were explicitly skipped by name on each. Preview also still carries `20260817150944`, which is truthful restored history and is **production-held forever**.

### Production `qsllyeztdwjgirsysgai`

Written to twice, both verified:

- Release A: `20260814130000`, `20260814193402`, `20260818024441` — run 32143415545
- #1115: `20260818141220` — run 32147729098, all four privilege assertions PASS

**Finding worth carrying:** production already HELD most Release A objects while missing their ledger rows (`relation "sample_carrier" already exists, skipping`). Production had the same ledger/catalog divergence preview did, and nobody knew. It applied cleanly only because every statement is `IF NOT EXISTS` guarded. Tracked as #1161.

## 4. The one live workstream: #1090

Parent #1090 · implementation #1143 · claim #1144 (renewed, expires 2026-08-18T22:28Z) · PR #1145 · handover issue **#1164**.

Branch `codex/issue-1143-fr-ruling-forward`, worktree live and clean.

**Blocked on a tooling race, not on the migration.** Main carries `20260818141220`, so #1145's `20260817232425` is backdated and the guard refuses it. `--supersede-active-claim-version` renames forward, re-reads the PR file list through the GitHub API, finds the API has not caught up with the commit it just pushed, and correctly rolls back:

```
3cbc028 migration: re-reserve 20260818142855 as 20260817232425   <- rollback
66cbf1d migration: re-reserve 20260817232425 as 20260818142855   <- rename
```

Stopped deliberately: **every attempt permanently burns a version reservation.** `20260818142815` and `20260818142855` are spent forever. Retrying in a loop would burn more against a timing problem. Tooling gap filed as **#1165**.

After the version is resolved: fresh exact-head review (sequences 154/155/157 are NOT approval), guarded merge, then the FR removal and strict-cleanup phase, then promote the COMPLETE ordered package in one bounded event. **Never `20260817124545` alone** — a production review found it alone would block held migration `20260802171000` and make the settled FR removal impossible. `20260802170000` and `20260802171000` remain deliberately unapplied.

## 5. What did NOT work — do not repeat these

- **The owner-decision ritual.** The gate demanded a JSON approval block posted by Albert. He is not a programmer, could not evaluate it, and the block was composed by the agent. That produces a signature on something unread plus an audit trail claiming oversight. Retired in #1162, with the instruction that would recreate it removed from the skill AND the operating manual in ai-devops.
- **The risk classifier was crying wolf.** It reported "existing production data may be lost" for a migration that only CREATES tables, having matched `ON UPDATE CASCADE` in a foreign key, `DROP TRIGGER IF EXISTS` before recreating it, `BEFORE UPDATE ON` in a trigger definition, and `UPDATE` inside a function body. Narrowed in #1162.
- **Trusting Grok's design unreviewed.** Grok recommended accepting a rehearsal from any commit of the PR. GLM showed that admits a complete forgery: dispatch preview at a commit carrying a doctored workflow, then restore it. Three rounds of Criticals followed, each one hop deeper. **One unpinned executed file breaks custody for every pinned one.** The final design WALKS the execution closure instead of listing it.
- **Letting the rotation's reviewer review its own design.** It assigned Grok to review Grok's recommendation. GLM was used instead and found three Criticals in it.
- **Re-running preview to refresh evidence.** Refused: an applied version can never be re-applied, in dry-run or apply. Its message says "already applied on production" even for preview — shared wording, documented at `shared-supabase-migrations.yml:365`. It does NOT mean production was touched.
- **The owner-decision hatch for an evidence error.** `prove_preview()` runs BEFORE the owner-decision branch and raises unconditionally. The hatch only ever accepted the five derived BUSINESS risks.
- **Backgrounding the AI reviewers** (`nohup ai-glm new … &`). Session is created, response never lands, wrapper then reports busy for 300s. **Run reviewers in the FOREGROUND.**
- **Heredocs containing regex escapes** through the shell mangled `\n` and `\b` into literal control characters repeatedly. Use the file-editing tools for code containing escapes.
- **GitHub runner package mirrors** stalled `Install psql` for 26+ minutes twice on steps that normally take seconds. Cancel and rerun clears it. If it holds the preview lock, cancelling still releases it — the release step is `if: always()`, verified live.

## 6. Exact next steps

1. Resume #1090 from **#1164**. Retry the supersession once after a pause; if it fails again, fix #1165 first.
2. Fresh independent review of #1145 by a reviewer that did not author it.
3. Guarded merge, successor claim for FR removal + strict cleanup, then one bounded promotion of the complete ordered package.
4. **#1166** — take the queue triage to Albert when he has an hour.
5. Optional cleanups: #1158 (atomic path mixes raw and CRLF digests), #1161 (historical proof is filename-based, not byte-based), #1153 (reviewer label — already fixed by #1154, close it).

## 7. Constraints in force

- Preview `rjyboqwcdzcocqgmsyel`, production `qsllyeztdwjgirsysgai`. Prove the target immediately before every write.
- Exact-head review evidence expires when the head changes. If a re-reservation renames the file, PROVE the reviewed content is byte-identical rather than asserting the review still holds.
- `20260817150944` is production-held forever.
- Reviewers get a self-contained review copy, never a raw linked worktree. Run them in the foreground.
- Never ask Albert to sign off on technical risk or adjudicate a reviewer dispute. Third AI/reviewer instead.

## 8. Access and environment

- Machine Windows 11 `al8960ofc`. `gh` authenticated as `u2giants`. Git identity verified `Albert Hazan <u2giants@users.noreply.github.com>`.
- Supabase credentials exist only as GitHub secrets and were deliberately never brought onto the laptop; the types generator runs in CI for that reason.
- **`C:\repos\shared-db` was EMPTY at session start and was re-cloned.** All previous worktrees were lost, including `C:\repos\shared-db-wt-1113\.private\item-mg-taxonomy-20260817`, flagged by the previous handoff as possibly the only copy of the Item Master taxonomy review (3,961 classified outputs, 110 accepted, 245 source rows reviewed). Searched; not found. **No code was lost** — every branch was on origin.
- **Secrets sweep: swept, nothing new.** No credential appeared this session; none needs storing in 1Password.
- **Docs pass:** the skill and operating manual in `ai-devops` were corrected (two commits) because they still taught the retired owner-approval behaviour. The incident ledger gained three entries. Nothing else outside this handover is now stale.

## 9. Open questions and risks

- #1090 is the only structural work left and is blocked on #1165.
- The production gate produced three Criticals in one day. Treat further edits as high-risk and always reviewed by a party that did not design the change.
- **There is no longer a human stop between a green evidence chain and a production write.** That is an accepted owner decision, recorded so it is never mistaken for an oversight.
- The historical preview proof is filename-based, not byte-based (#1161). It did not bite because the migrations are idempotent; it would on a non-idempotent batch.
- PR #1162 is the only gate change today merged without an external review round — 35 tests, no second model — a deliberate call after the owner asked to stop the ceremony and finish.
- The generated types artifact describes preview, which can be ahead of production between an apply and its promotion. Documented in `types/README.md`.

# Part B — sub-agent reports

This session dispatched **no sub-agents**. The orchestrator performed all work directly, and delegated only READ-ONLY review to external models. Recorded per reviewer instead:

### Reviewer: GLM `zai-coding-plan/glm-5.3` (rotation sequences 158, plus unrotated design reviews)
- **Asked to do:** exact-head review of #1117; independent review of #1157 and #1160.
- **Actually did:** APPROVED #1117 on `036c596` with 1 Medium and 3 Low. Found **three Criticals** across four passes on #1157 and one Critical-free APPROVE on #1160 with two Mediums.
- **Found:** the doctored-workflow forgery; the unpinned lane script; the unpinned transitive import; a false safety comment I had written; and that the historical proof is filename-based.
- **Deliberately did NOT do:** it is read-only and wrote nothing.

### Reviewer: Kimi `kimi-code/k3` (rotation sequence 159)
- **Asked to do:** exact-head review of #1126; advice on the Release A blocker.
- **Actually did:** APPROVED #1126 on `e4e01a5`, no Critical or High. Recommended option A for the blocker and conceded unprompted that the historical proof "would have passed while preview was broken".
- **Found:** the no-op-on-complete-target claim is proven by construction, not by test.
- **Caveat:** its packet was built from `8a92857`, before #1126 merged. It flagged this itself; the one assumption it asked to re-verify was checked directly on main and holds.

### Reviewer: Grok `grok-4.6`
- **Asked to do:** durable design recommendation for the preview-proof gate.
- **Actually did:** recommended content-binding over commit identity, and correctly rejected branch-freezing, re-applying an applied version, and misusing the owner hatch.
- **Found:** the head_sha check was both too strict and too weak.
- **Its design contained a Critical**, found by GLM. Recorded as the reason a designer must not review its own design.

# Closeout self-audit

1. **Could a street-new developer continue with no questions? Yes.** §3 gives verified live state with timestamps, §4 gives the single live workstream with its exact blocker and the two burned versions, §6 gives ordered next actions, and every issue number is named.
2. **As effectively as this session? Yes.** §5 preserves nine dead ends including the two that cost the most time (backgrounded reviewers, and trusting an unreviewed design).
3. **Every relevant detail present? Yes.** Background §1–2, live state §3, blocker §4, failures §5, actions §6, constraints §7, access §8, risks §9, reviewers in Part B.
4. **Would Albert see every decision he owes by reading only §0? Yes.** One non-blocking item (#1166) and the settled rulings that must not be re-asked.
