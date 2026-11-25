---
summary: Issue #1027 plan: redact one licensed filename in the #469 heavy evidence log and add a guard test. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1027, or adding evidence files under verification/
---

# Plan: remove a licensed filename from the #469 heavy evidence log (u2giants/popdam3#1027)

Issue: https://github.com/u2giants/popdam3/issues/1027
Handoff: [HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-469-review-finding-plans.md](../../HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-469-review-finding-plans.md)
Written November 25, 2026, 4:05 PM EST on `al8960ofc` by Claude (session b5bcb2fd). Planning only: no file was changed.

## STATUS — read before executing

| Step | State (Nov 25, 2026) | Evidence / artifact |
|---|---|---|
| 1. Redact the filename in `backfill-run-log.json` | ⬜ open | — |
| 2. Add a guard test over `verification/` | ⬜ open | — |
| 3. Merge, comment, close #1027 | ⬜ open | — |

**Start at Step 1.**

## 1. Ultimate goal

Evidence files in this repository must not carry the names of real licensed artwork files: the repo's own rule keeps those names in the git-ignored `.private/` folder only. One committed record breaks that rule. The goal is that the current tree is clean and a test stops the same slip next time. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, branch `main`) is POP Creations' internal library of licensed product artwork (React app, Supabase functions, Railway worker, NAS agents). `verification/` holds evidence records from live proofs; it is excluded from the doc index (`.doc-health.json`). Audit issue #469, which these records served, closed November 22, 2026.

## 3. What triggered this work

The advisory reviewer on PR #1026 filed #1027 with three findings. Decision per finding (checked on `main` at 787c20b8):

1. **Real — planned here.** `verification/469-heavy/backfill-run-log.json:38` records `"live_current_file"` with the real name of a production licensing-sheet PDF (a SKU code followed by `_LICENSING SHEET.pdf`). Rule sources: `plan_popsg_production_readiness.md:470` ("Never log, commit, or put licensed filenames … into … verification files"), `.gitignore:47-48` (`.private/`).
2. **Moot.** `verification/469-heavy/batch-loop-cap-sim.mjs:138` could report PASS if it extracted zero loops. The committed run did exercise all loops (`verification/469-heavy/evidence.json:31`: "8/8 observations PASS"), no workflow or doc runs the script, and the audit is closed.
3. **Moot.** `heavy-live-proof-2026-11-15.md` lacks the four-key header; `verification/**` is excluded from the index by design and the audit is closed.

## 4. Scope

In: step-1 redaction, step-2 guard test. NOT in scope: rewriting git history (owner ruling: a value exposed only in this private repository is redacted, never rotated — history is left as is); findings 2 and 3; the sample table of licensing-sheet filenames in `docs/RICH_PDF_EXTRACTION.md:63-72` (a design doc, not a verification record — see §13).

## 5. Current state

`grep -rnoE "[A-Z0-9]{8,12}_[A-Z ]+\.(pdf|psd|ai)" verification/` matches exactly one line: `backfill-run-log.json:38`. No other file in `verification/469-heavy/` carries a licensed name. Nothing is half-done.

## 6. Key findings

The field is informational (which file the backfill was on at one poll); no script reads it (`grep -rn live_current_file` finds only this log). Replacing the value loses no proof: the `processed`/`remaining`/`stats` counts on that line are the evidence.

## 7. Rejected approaches

- **History rewrite (`git filter-repo`, force-push)** — rejected by the owner ruling above and because many parallel sessions share this repo.
- **Deleting the whole log** — loses the backfill progress evidence for nothing.
- **Hashing the filename** — fine but unnecessary; a fixed placeholder is simpler and leaks nothing.

## 8. Decisions

Locked: placeholder text `"[licensed filename redacted]"`; no history rewrite. Open: the guard's exact regex, as long as it catches `<SKU>_LICENSING SHEET.pdf`-style names and passes on synthetic test names such as `469-toytest-checkout-art-a.psd`.

## 9. Steps

1. **Redact** — in `verification/469-heavy/backfill-run-log.json:38` set `"live_current_file": "[licensed filename redacted]"`. Gate: the file still parses (`node -e "JSON.parse(require('fs').readFileSync('verification/469-heavy/backfill-run-log.json','utf8'))"`) and the grep in §5 returns nothing. `helper-ok`. Stop-and-ask: the grep finds any other match.
2. **Guard test** — add `verification/no-licensed-filenames.test.mjs` (node:test) that walks `verification/` (skip `.private/`), reads `.json`/`.md`/`.txt` files, and fails listing any file:line matching a POP SKU-style name (`/\b[A-Z0-9]{8,12}_[A-Z0-9 _-]+\.(pdf|psd|ai|tif|png)\b/`). Add it to the `node --test` list in `.github/workflows/ci.yml:80`. Gate: test fails before step 1, passes after; CI log shows it ran. `helper-ok`. Stop-and-ask: the pattern flags a file that is clearly synthetic.
3. **Land** — branch, PR, merge on required checks, comment on #1027 with the PR link and the finding-2/3 rationale above, close it. `lead-only` — closing judgment.

## 10. Tests

New: `verification/no-licensed-filenames.test.mjs`. Must stay green: the `ci.yml` node-test job.

## 11. Constraints

Feature branch + PR; AI merges; reviews advisory. Never paste the real filename into a commit message, PR, or comment. Sign comments with the `$AI_GH_SIGNATURE` format.

## 12. Access

`gh` as `u2giants`; Node 22; no secrets needed.

## 13. Done, risks, open questions

Done: steps 1-3, CI green, #1027 closed, STATUS updated, handoff closed. Risk: the guard is advisory (lean required checks) and could be noisy; tune the regex rather than delete it. Open question for a future session (not this plan): `docs/RICH_PDF_EXTRACTION.md:63-72` lists ten real licensing-sheet filenames as a sample table; whether that design doc falls under the same rule is a business call for Albert.

## Self-audit

1. Executable without questions? Yes — §3 names the exact line, §9 the exact value, regex and gates.
2. All background, including rejections? Yes — §3 decides each finding, §7 lists rejected options, §4 the history ruling.
3. Goal clear for judgment? Yes — §1: no licensed names in verification records, with a guard.

## Lead launch prompt

```
Implement docs/plans/issue-1027-redact-licensed-filename-469-heavy.md in u2giants/popdam3. Read the whole plan, then its STATUS.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper does steps 1 and 2 (helper-ok); it returns finished work or an evidenced blocker, decides nothing, never merges or posts, asks you on a stop-and-ask trigger, and is taken back after 30 minutes stuck.
You verify the grep and the new test yourself, then do step 3. Update the plan STATUS and close the handoff.
```
