---
issue: 3853
status: OPEN
owner: mimo/coldlion-intake-successor (this session; Albert holds the workstream card #3853)
---

# ColdLion intake — cron merged; STATUS D blocked on GitHub schedule not firing

## 0. Settled (never re-ask)

- Owner ruling 2026-10-05 (Albert, verbatim: "redact it from the transcript and don't rotate. proceed with everythign else"): production DB password NOT rotated. Transcript redacted. Rotation plan v10 is historical — never execute.
- PR #3938 (rotation prerequisite) is MERGED. PG* env transport is live.
- F1 sample-week proof PASSED (week 2026-09-08..14). Divergence classes recorded in `docs/verification/coldlion-order-intake-20260914/README.md`.
- Plan B0: cron stays off until F1; enabling after F1 needs no new approval. **F1 passed; cron is now ON.**
- JamieLynn's manual ERP entry is NOT automated (2026-09-17).
- C0 cardinality 1:N with `COLDLION-SO-<so>` placeholders.

## 1. What you were doing, and why

Successor to the ColdLion order-intake workstream (issue #3853): finish F1 sheet-side comparison, enable the hourly intake cron, tick plan STATUS D/F, close #3853, retire the leftover handoffs. Albert's dispatch was the 2035Z next-session prompt.

## 2. What you actually DID

| Item | Evidence |
|---|---|
| F1 sheet-side comparison | PR **#4017** MERGED 2026-10-06 6:06 PM EST (merge `386254c2`). Sheet week 2026-09-08..14: 7 rows / 4 customer-PO keys / all FOB. Divergence classes recorded. STATUS F ticked. |
| Cron enablement | PR **#4019** MERGED 2026-10-08 1:54 AM EST (merge `08db16243`). Hourly `schedule: '7 * * * *'` + `workflow_dispatch` only. Trigger-surface test pinned. Schedule does not inject `--limit`. Handoffs 2140Z and 2035Z retired in this PR (verified absent from `origin/main`). |
| Type-bug PR (redundant) | PR **#4092** opened then CLOSED without merge — `origin/main` already types numeric SQL nulls (`sqlNumber` → `null::numeric`). |
| Dry-run on current main | Run **37783505826** SUCCESS 2026-10-08 9:19 AM EST (24s). |

## 3. Applied to preview / production

- **Preview:** nothing this session.
- **Production:** no migrations. The intake workflow writes to production by design once cron fires (stage/decode/writer). Manual dry-run 37783505826 wrote nothing. First schedule run 37748611709 **failed** (SQL type error) before the fix landed on main; no successful scheduled production write has been proven yet.

## 4. Half-finished / abandoned mid-way

- **STATUS row D** still open. Definition: two consecutive green **scheduled** `coldlion-order-intake` runs after cron enablement. Not achieved.
- **Close #3853** not done — issue is still OPEN. Cannot close until D's live proof exists (or Albert accepts a substitute gate).
- Several sub-agents were dispatched and cancelled mid-flight (see § agent blocks).

## 5. What you own right now

**Branches / PRs:** none open from this session. #4017 and #4019 merged; #4092 closed.

**Worktrees under `C:/repos/shared-db/.ai/worktrees/` (this session created):**

| Worktree | Branch | State |
|---|---|---|
| `coldlion-review-4019` | detached / cron-review | finished — reviews for #4019; safe to clean after confirming no unique untracked evidence |
| `cron-land-3853` | `cron-land-3853` / `cron-rebase-tmp` | finished — final #4019 landing tree |
| `coldlion-lineprice-3853` | `coldlion-lineprice-3853` | **keep** — unmerged type-fix work (PR #4092 closed without merge); has gen-48 evidence pair and a couple of `run*.cmd` launcher leftovers |
| `coldlion-cron-3853`, `coldlion-f1-cron-3853` | various | finished — earlier F1/cron attempts |
| `handoff-3853-wrap` | `handoff-3853-wrap` | **live** — this handoff PR |

Also present from earlier sessions (do not treat as this session's): `coldlion-f1b-3853`, `coldlion-guard-fix`, `coldlion-intake-e`, `coldlion-intake-rot`.

## 6. What I was about to do next

Wait for GitHub to start the hourly `schedule` event again, confirm two consecutive green runs, tick STATUS D, then close #3853 with evidence.

## 7. What I am blocked on

**GitHub Actions is not starting scheduled runs for `coldlion-order-intake.yml`.**

- Workflow `state: active` on `popcre/shared-db` (id 372508500).
- YAML on `main` has `schedule: - cron: '7 * * * *'`.
- **Only one schedule run exists in history:** `37748611709` (failure, 2026-10-08 4:15 AM EST) — that was the first run after #4019 merge, before the `line_price` type fix landed.
- Other workflows on the same repo DO fire on schedule (Landing Sync, Recurring Feed, etc.) — this is specific to Order Intake.
- Tried: `gh workflow disable` then `enable` (11:10 AM EST); still no schedule run by 11:10 AM EST.
- Manual `workflow_dispatch` dry-run on current main is green (37783505826).

Not blocked on Albert for a business decision. The next session should re-check whether schedule runs started (cron is `:07` each hour), and if still silent, investigate GitHub-side schedule registration (possibly a one-line comment commit to the workflow file to re-register, via a normal PR).

## 8. What I tried that did NOT work [MANDATORY]

- **Grok/Gemini/Qwen/DeepSeek/StepFun/GLM reviews** — mostly preflight failures, "no response", or cancelled doors. Only **Muse** produced reliable APPROVE verdicts. Grok was later unregistered from the pool ("registry state: absent").
- **Durable APPROVE artifacts** — local `.ai/reviews` APPROVE files were not enough for Guarded Merge; it demands `refs/db-review-verdicts/...` records. A sub-agent eventually got #4019 through Guarded Merge (merged `08db16243`).
- **Guarded Merge refusals** (in order, all real): merge lock held by PR #4033; production freeze PR #3708 then #4042; `Closes #3853` in the PR body forced handoff retirement (Handoff contract) while the gen-39 evidence contract forbade those paths → published gen 40/44 including handoff deletes; `no reviewer was ever assigned head`; `no durable APPROVE artifact`; EOL guard `core.properties_and_characters` false-positive when main moved under the branch.
- **Merging `main` into a PR branch** to fix an EOL-guard race — pulled in SQL files and escalated `ai-task-gates` to protected class `shared-db`. Reverted; rebuilt the branch on current main with only the owned files instead.
- **`ai-review grok`** started returning "not a registered reviewer" mid-session. Do not assume yesterday's roster.
- **Reviewer slot release/reclaim** (`--release-failed-reviewer`, `--reclaim-silent-reviewer`) — refused with lease-mismatch / unreadable evidence after another session had already written replacement records (`failure-ref=self`). Do not retry those exact commands first; re-read the assignment/failure refs first.
- **Assuming "waiting on reviews" without re-checking** — background `Start-Process` review jobs do not notify the chat. They failed hours earlier while status still said "waiting."
- **First scheduled run** hit `column "line_price" is of type numeric but expression is of type text` (empty-window VALUES placeholder used bare `null`, which types as text). Fixed on main already (`sqlNumber` emits `null::numeric`) by another session's gen-49/50 work; PR #4092 closed as redundant.

## 9. Facts that may already be stale

- `main` tip **`64f1edb5c`** checked **2026-10-08 1:39 PM EST**. Moves hourly.
- Max migration seen: `20261008160444` (dflow users email ci unique reissue) — re-derive before use.
- PR #4017 merged 2026-10-06; PR #4019 merged 2026-10-08 — re-check via `gh pr view` if disputed.
- Schedule run count as of 1:39 PM EST: **1** (the failed 37748611709). Re-count before acting.
- Reviewer roster changed during the session (grok removed). Re-read `scripts/lib/lanes/reviewer-roster.mjs` before drawing reviewers.
- `plan_coldlion_order_intake.md` STATUS: D still ⬜ open, F ✅ (PR #4017). Re-read the table on `main`.

---

# Handover block for issue #3853 (path A)

1. **Doing:** successor for ColdLion intake — F1, cron, STATUS D/F, close #3853.
2. **Did:** F1 PR #4017 merged; cron PR #4019 merged (schedule `7 * * * *`, handoffs retired); dry-run 37783505826 green on current main.
3. **Preview:** nothing. **Production:** no DDL; one failed scheduled run; one successful dry-run (no writes).
4. **Half-finished:** STATUS D (two green scheduled runs); close of #3853.
5. **Own:** worktrees listed in §5; no open PR; no dirty intentional branch except `coldlion-lineprice-3853` (redundant fix, PR #4092 closed).
6. **Next:** re-check schedule runs; if green pair exists, tick STATUS D and close #3853; if silent, wake the schedule registration with a one-line workflow comment PR.
7. **Blocked on:** GitHub not starting `schedule` runs for this workflow (not an Albert decision).
8. **Tried that failed:** see §8 — reviewer pool gaps, durable-verdict gap, Guarded Merge refusals, merge-main class escalation, stale "waiting" status.
9. **Stale:** main SHA, migration version, schedule run count, reviewer roster — all re-derive from git/gh.

---

## Preview state

Not touched by this session. Production queried read-only earlier (F1 match keys via PG* env / `op://` password item id `246sf23gymd64yudpmhswcnyle`).

## Secrets sweep

Swept. Database password used only via 1Password `op://` / `op_run` env (item id `246sf23gymd64yudpmhswcnyle`). No new credential created or pasted into chat/commits. Scratch launcher `run*.cmd` files hold no secrets. **Swept, nothing new.**

## Docs pass

Handover is the primary record. `docs/verification/coldlion-order-intake-20260914/README.md` and `plan_coldlion_order_intake.md` STATUS F were updated on main via PR #4017. STATUS D correctly remains open. **Nothing outside the handover is stale.**

Posted by MiMo chat unknown on edge-dev
