---
issue: 3853
status: OPEN
owner: zcode/coldlion-intake-successor (any fresh session; Albert holds a coordinator prompt)
---

# ColdLion order intake — Phase B merged; continue at C2

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in this workstream needs Albert.** Everything he owes is already
ruled and Settled; do not re-ask:

- JamieLynn's manual ERP entry is NOT automated (2026-09-17).
- C0 cardinality ruled 1:N with `COLDLION-SO-<so>` placeholders (2026-09-17).
- Cron stays OFF until the F1 sample-week live proof passes (plan B0) — enabling it
  after F1 needs no new approval.
- Albert approves business outcomes only, never technical risk (2026-08-18/09-28).
- Albert already holds a copy-paste coordinator prompt for the remaining steps
  (issued 2026-10-01); if he pastes it, follow it — it matches §6 below.

## 1. What this application is

Automatic ColdLion order intake in `popcre/shared-db` (Supabase Postgres, project
ref `qsllyeztdwjgirsysgai`): an intra-day poll of the ColdLion ERP `/orderHistory`
API stages orders into `coldlion.intake_*` tables, then a canonical writer creates
placeholder `plm.production_order(_line)` rows — replacing Adam's manual Google
OrderList typing only. Adam reviews exceptions in a queue instead of typing rows.
Full authority: `plan_coldlion_order_intake.md` (STATUS table = source of truth)
and `docs/business-rules/erp-orders-and-source-meaning.md` §OrderList intake.

## 2. What this session set out to do, and why

Albert's dispatch: continue from Phase B (Phase A landed live 2026-09-30) — copy the
parked drafts, open the Phase B PR through the guarded lane, then build C2, run the
staged dispatch ladder, and finish with the sample-week live proof, using subagents
per step. Session ended early on Albert's wrap-up after Phase B merged; the
remainder is §6.

## 3. Current state — what is true right now

- **PR #3864 MERGED 2026-10-01 19:51Z (3:51 PM EST)** via the guarded merge queue:
  Phase B poller (`tools/coldlion-landing/order-intake.mjs` + lib modules
  windows/stage/run/decode), `.github/workflows/coldlion-order-intake.yml` with the
  cron COMMENTED OUT, 33 offline tests (`node --test
  tools/coldlion-order-intake-*.test.mjs`), plan successor-bound fix (§556-563
  area), and retirement of the prior phase-a handoff file. Final commits: impl
  `a4f9c9bc1` + pair `de46e1825` (evidence pair generation 8,
  `.agent/work/3853/8/`). Four governed review rounds preceded the merge; H-1
  (decode scope = all poll run ids) and M-1 (conrelid-joined constraint check)
  were the substantive round-1/2 fixes.
- **STATUS rows B/B0/B1 ticked** by this session's docs-only PR (see §6 step 0 for
  its number after merge). Rows C1/C2/D/E/F remain open on purpose: C1's decode
  code is merged but unproven live; D awaits cron enablement after F1; E awaits
  the claim test; C2/F untouched.
- **Issue #3853 OPEN** (non-orchestrator — no database shape changes in Phases
  B–F). It is the continuation card for this whole workstream.
- Worktree `C:/repos/shared-db/.ai/worktrees/coldlion-intake-b`: clean, on the
  docs branch of this close-out; branch `coldlion-intake-b` (the merged code PR)
  is fully landed and safe to reap. Main tip at write time: `25de9e7c7`
  (2026-10-02T00:14Z, checked 00:19Z).
- No ColdLion writes have been made to preview or production data by Phases B–F
  so far; the only production changes were Phase A's migration (already closed).
- Parked drafts `C:/repos/intake-3679-drafts/` are historical (promote*.py
  drivers, superseded); the live drafts all landed in PR #3864.

## 4. Everything we tried that did NOT work

- **Foreground subagent for a multi-hour PR lane**: the first subagent went
  "inactive for 600000ms" mid-review-rounds. Fix used: relaunch as a background
  agent (`run_in_background`) — the lane needs hours (checks + 2 review slots).
- **Trusting the local `origin/main` ref mid-verification**: after the merge, the
  local ref showed a tip without the merge while GitHub had it; conclusions drawn
  from it were briefly wrong. Fix: settle every moving fact via `gh api
  repos/popcre/shared-db/...` (GitHub is the source of truth), not local refs.
- **A subagent verdict recording was refused** ("reviewer grok-4.6 holds no active
  lease at all") — its findings stayed non-authorizing. If a slot's verdict
  refuses to record, re-assign the lease at the current head and re-run that
  slot; do not merge on unrecorded findings (the merge lane enforces this anyway).
- Carried forward from Phase A (still true): never `git commit --amend` after
  writing completion.json's head_sha; `gh run watch | tail` masks failures;
  installation-quota 403s are rerun-able, never diagnosis; `--admin` merge is
  refused for shared-db — prose PRs use the direct squash route, code PRs the
  guarded lane.

## 5. Root causes and key findings

- The merged poller is the plan's Phase B **plus** the C1 decode module and its 6
  tests (decode runs post-poll, quarantines unknown routing codes and zero-SO
  rows scoped to the poll's run-id set `lib/order-intake-decode.mjs:48-55`).
- Review convergence on #3864 took the pair from generation 1 to 8 — each fix
  round that changes files needs a NEW published generation before the impl
  commit, allowed_paths covering the changed files AND the pair's own paths, and
  the branch re-squashed to exactly ONE impl commit + ONE pair commit.
- The `--limit` bootstrap flag bounds rows per window; until C2 stamps canonical
  source refs, novelty is always zero, so every window stages its first N orders
  (documented in the PR; acceptable per plan B0's bounded-bootstrap intent).
- Tests are pure offline (`node --test`, flat names); the repo has no
  package.json — never introduce npm/yarn.

## 6. Exact next steps (in order; one subagent each)

0. Confirm this close-out's docs PR (STATUS ticks B/B0/B1 + this handoff) is
   MERGED — `gh pr list --repo popcre/shared-db --state merged --limit 3`. You'll
   know it worked when the plan STATUS on main shows B/B0/B1 ✅ and this file is
   on main.
1. **C2 canonical writer** `tools/coldlion-landing/order-intake-write.mjs` per
   plan §590-653 (read it verbatim) + read
   `docs/app-migration-notes/popdam-order-list.md` §Google-to-Coldlion identity
   proof first. Include `tools/coldlion-order-intake-claim.test.mjs` (completes
   Phase E). Land via the guarded lane. Gate: for a quarantine-free test order on
   preview, the canonical row exists exactly once; line count = winning-version
   staged components; `is_primary` on exactly one ref per header/line; a second
   `--write` run changes nothing.
2. **Staged dispatch ladder** exactly as the plan's B1 gate: `--dry-run --limit 5`
   against preview from the laptop; workflow_dispatch on preview; then ONE
   bounded production dispatch with `--limit`. Cron stays OFF.
3. **F1 sample-week live proof**: compare canonical rows against the Google sheet
   for a sample week; artifacts under
   `docs/verification/coldlion-order-intake-<date>/` — counts and deterministic
   refs only, never customer literals (PII). Gate: counts match the sheet for the
   sample week; quarantines each carry a reason.
4. **Enable the cron** in ONE commit (uncomment the schedule in
   `.github/workflows/coldlion-order-intake.yml`) — only after F1 passes.
5. Tick STATUS rows C1/C2/D/E/F as each lands (cite artifacts); close #3853 when
   F is proven; retire this handoff file in that same PR.

## 7. Constraints and gotchas in force

- Claim-first does NOT apply (non-orchestrator); issue #3853 is the card. Label
  every shared-db issue you touch as orchestrator (shape-changing) or not.
- Evidence-pair gates: publish the contract BEFORE the impl commit; completion
  `files_changed` = `git diff <merge-base>...<impl-head>` EXCLUDING pair files;
  ONE impl commit + ONE pair commit; verify committed bytes with
  `git show <sha>:<path> | grep <marker>` after explicit `git add <paths>`.
- Head FROZEN while governed reviews run; two APPROVE slots at the exact head;
  GLM never reviews GLM work; quota 403 → `gh run rerun <literal-id> --failed`.
- Merge code PRs only via the guarded lane (transient queue ejection → re-dispatch
  once); docs-only PRs via the direct squash route (no `--admin`).
- Fresh worktree from origin/main per step; stage only named files; committer
  `Albert Hazan <u2giants@users.noreply.github.com>`; sign every GitHub post
  `Posted by ZCode chat $ZCODE_SESSION_ID on <machine>`; EST for human times;
  `ai-task-gates start --class code` from the worktree.
- The shared preview database carries everyone's rehearsals; a "Remote migration
  versions not found" refusal means another workstream's unmerged migration sits
  there — wait, never `supabase migration repair`.

## 8. Access and environment

- `gh` authenticated as u2giants. Production DB password: 1Password vault
  `vibe_coding`, item "Supabase DB Password - shared POP database" (pooler
  `aws-1-us-east-1.pooler.supabase.com`; aws-0 does NOT host the tenant).
  ColdLion API key: repo secret `COLDLION_API_KEY` in the workflow.
- Canonical checkout `C:/repos/shared-db` (dirty with OTHER sessions' files —
  never clean it); this workstream's worktree is `.ai/worktrees/coldlion-intake-b`.

## 9. Open questions and risks

- Grok's slot-2 verdict on #3864 was refused at recording (lease mismatch, §4);
  the merge lane nonetheless authorized the merge — if a later audit questions
  verdict completeness, the durable verdict refs live under
  `refs/db-review-verdicts/3853-3864-*`.
- Main moves fast (tip advanced during this close-out); re-derive main SHA, max
  migration version, and PR states from GitHub at each step start.
- The poller's novelty detection intentionally reports zero until C2 lands —
  do not "fix" this in B; it is the designed bootstrap behavior.

## (b) Sub-agent record

### Agent: Phase B PR builder (foreground, then relaunched in background)
- **Asked to do:** open PR #3864 through the guarded lane and carry it to merge
  (contract before impl commit, §7 traps), tick STATUS rows after merge.
- **Actually did:** merged PR #3864 (impl `a4f9c9bc1`, pair `de46e1825`, gen 8)
  after four review rounds; fixed H-1/M-1 and later rounds; grew tests 13→33;
  retired the phase-a handoff in the PR. Died before the STATUS tick.
- **Found:** decode scoping and constraint-check gaps (fixed); `--limit` semantics
  documented rather than changed.
- **PR / branch:** #3864 MERGED; branch `coldlion-intake-b` landed.
- **Worktree:** `.ai/worktrees/coldlion-intake-b` — clean; safe to reap once this
  docs PR merges.
- **Deliberately did NOT do:** enable cron (plan B0); C2 writer; STATUS tick
  (session ended) — finished by the coordinator in this close-out PR.

### Session (coordinator, this file's author)
- Copied the seven parked drafts + workflow into the repo, verified 13→33 tests,
  verified the merge and every moving fact against GitHub, ticked B/B0/B1,
  wrote this handoff. Deliberately did NOT start C2/ladder/F1: Albert ended the
  session (wrap-up) and holds a coordinator prompt for exactly that remainder.

Posted by ZCode chat sess_d90a8669-02fe-4991-a6d5-23b533150b89 on edge-dev
