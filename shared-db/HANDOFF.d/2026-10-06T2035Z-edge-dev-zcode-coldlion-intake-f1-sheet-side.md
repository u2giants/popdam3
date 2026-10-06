---
issue: 3853
status: OPEN
owner: zcode/coldlion-intake-successor (this session; Albert holds the workstream card #3853)
---

# ColdLion intake — rotation cancelled, F1 intake-side done, sheet-side blocked

## 0. Settled (never re-ask)

- Owner ruling 2026-10-05 (Albert, verbatim: "redact it from the transcript and don't rotate. proceed with everythign else"): the production DB password is NOT rotated. The exposed value was redacted from local transcripts (423 URL matches zeroed across part/message/event/history_fts tables; 0 remaining plaintext credentials verified). Vault + GitHub secrets keep the unchanged password.
- PR #3938 (rotation prerequisite hardening) is MERGED (cd265aa1, 2026-10-05 9:02 PM EST). PG* env transport is live on main — connection URLs never appear in psql argv again.
- The rotation plan v10 (branch `rotation-plan-v10`, worktree `coldlion-intake-rot`) is a HISTORICAL record. Never execute it.

## 1. Immediate next actions (in order)

1. **F1 sheet-side comparison.** The intake side is done (`docs/verification/coldlion-order-intake-20260914/README.md`, uncommitted). The sheet side needs the Google OrderList rows for week 2026-09-08..14 keyed by Start Ship Date. The 2245Z handoff claims an export exists at `C:/Users/ahazan/AppData/Local/Temp/f1/orderlist.xlsx` (33 rows: 31 POE + 2 FOB) — VERIFY that file exists before trusting it. Compare order-by-order, record divergence classes (sheet-not-in-ERP, POE-labelled-DDP), update the README.
2. **Enable the cron** in `.github/workflows/coldlion-order-intake.yml` (uncomment the schedule) — ONE commit, only after F1 passes. The workflow test that asserts `schedule:` is absent must be updated in the same commit.
3. **Tick STATUS rows D and F** in `plan_coldlion_order_intake.md`.
4. **Close #3853** with evidence.
5. **Retire both handoff files** (2140Z and 2245Z) in the same PR that closes #3853.

## 2. What was tried that did NOT work (MANDATORY)

- **60+ codex plan-review rounds on the rotation plan** — every round returned REJECT. Rounds 1-21 fixed all rotation-specific findings (28P01-only old-reject, live-main P5, ACL-first secret writes, CLI token save/restore, dispatch correlation, env+repo secrets, pg 8.23.0 pin). Rounds 22-60 kept expanding into F1 cursor design and intake plan issues (never reached APPROVE). Owner ruling cancelled rotation.
- **`ai-review codex diff-review` intermittently killed** by infrastructure (900s timeout, ChildProcess.kill). Reviews on PR #3938 completed through 12 rounds; all High findings were fixed.
- **`new URL()` rejects PostgreSQL multi-host URIs** (`host1:5432,host2:5433`). Custom `parsePgUri` regex parser written with contiguity checks.
- **`connect_string` in libpq service files is NOT supported** — the format only accepts individual keyword=value pairs. Switched to PG* env vars with a complete param map.
- **`ssl=true` maps to `PGSSLMODE=true`** which libpq ignores. Only `true`/`1` alias to `require`; `false`/`0` are now rejected (would disable encryption).
- **PowerShell process substitution `<()` not supported** — used env files with `[uri]::EscapeDataString()` for passwords containing `@`.
- **`ai-devops-reviewer-install` junction was broken** — fixed with `mklink /J` to `ai-devops`.
- **Throughput truth-audit catalogues** pin line hashes — removing `--password` from workflows breaks them. Those workflow changes were reverted from PR #3938 and deferred.

## 3. What I own / worktree state

| Worktree | Branch | State |
|---|---|---|
| `coldlion-prereq` | `coldlion-prereq` | PR #3938 MERGED — safe to clean |
| `coldlion-intake-d` | `coldlion-intake-d` | rotation plan review reports — safe to clean |
| `coldlion-intake-rot` | `rotation-plan-v10` | rotation plan v10 (historical) — keep until #3853 closes |

Do NOT touch other sessions' worktrees (`coldlion-guard-fix`, `coldlion-intake-e`, `fix-3944-argv-leak`, etc.).

## 4. Main SHA and migration version

- main tip: `c86be424` (checked 2026-10-06 4:31 PM EST)
- Max migration: `20261006170117` (sync_run_lookup_index.sql)

## 5. Preview state

Not touched by this session. Production queried read-only only.

## 6. Secrets sweep

Swept: the database password was used via `op read` → env vars only. Scratch files cleaned (`env-f1.txt`, `tmp-*.mjs`). No credential appeared in chat, commits, or untracked files. **Swept, nothing new.**

## 7. Docs pass

The F1 verification report (`docs/verification/coldlion-order-intake-20260914/README.md`) is the primary record. `plan_coldlion_order_intake.md` STATUS table needs D/F ticks (step 3 above). Nothing outside the handover is stale — the2140Z and 2245Z handoffs are historical records, not live docs.

## 8. Next-session prompt

```
You are the ColdLion intake successor for popcre/shared-db, issue #3853 (non-orchestrator).
Read HANDOFF.d/2026-10-06T2035Z-edge-dev-zcode-coldlion-intake-f1-sheet-side.md on main FIRST.
Owner ruling: rotation is CANCELLED (transcript redacted, no password change). PR #3938 is MERGED.
Your steps, in order:
(1) F1 sheet-side comparison — verify C:/Users/ahazan/AppData/Local/Temp/f1/orderlist.xlsx exists (33 rows per the 2245Z handoff), compare against the intake side in docs/verification/coldlion-order-intake-20260914/README.md, record divergence classes.
(2) Enable the cron in .github/workflows/coldlion-order-intake.yml (uncomment schedule) — ONE commit, only after F1 passes. Update the workflow test that asserts schedule is absent.
(3) Tick STATUS D/F in plan_coldlion_order_intake.md.
(4) Close #3853 with evidence, retire the 2140Z and 2245Z handoffs in the same PR.
Act as coordinator: spin up a subagent per phase where independent. Do not re-ask settled rulings (handoff §0). Issue #3853 is the card; comment evidence there with your ZCode session signature.
```
