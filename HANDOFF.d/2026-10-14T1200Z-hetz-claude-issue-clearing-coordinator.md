---
issue: 179
status: BLOCKED
owner: claude/7623097e-a8da-4712-8cab-fb86b5076289
---

# PopDAM open-issue clearing coordinator — handover

Written 2026-10-14 ~8:00 AM EDT by Claude chat 7623097e on hetz. This session coordinated helper agents clearing u2giants/popdam3 issues from 2026-10-11 to 2026-10-14. Most issues are merged and closed. This file covers only what is still open. Verify every fact below against GitHub and the live database before acting; several are hours old.

## 1. Goal

Finish the remaining work from the issue-clearing run:
- the render-account switch (#179 item 3a)
- the licensor fill-in after the DAM scan (#357)
- removing Qwen from reviewer rotation

## 2. Done (verified when written)

- **Merged and live:**
  - popdam3 PRs #297–#393, including the ones listed below.
  - Lazy loading, bundle split, and component splits (#190, #193, #197).
  - Helper security (#224, #225, #228, #229).
  - Edge CORS and auth (#216, #219, #220, #222).
  - ERP paging and batching (#203, #204, #205).
  - Worker cleanup (#206, #209).
  - SeaDrive (#199, #200).
  - Stuck nightly crawl fix (#335/#336).
  - Admin-api 500s (#329/#330).
  - ColdLion timeout fast-skip (#357/#358).
  - Fill-missing-only licensor mode (#359).
  - Render fixes for #382:
    - stale claim sweep (#385)
    - PSD fallback decoder (#388)
    - 8.3 short-name matching for quote-named files (#389–#391)
    - long-path fix (#393)
  - Agent remount/backoff (#383).
  - Agent-api Z: password served from Vault (#392).
- **#179 rotations done:**
  - The hetz `ai` OS password.
  - The NAS `ai` password on both units. It was rotated twice, after two leaks by a helper; the leak details are on #179.
  - The PopSG password moved to Vault, and its plaintext row was deleted.
- **#179 3a partial:** NAS user `popdam-render` exists on edgesynology2, with read-write on `mac` (Z:) and read-only on `styleguides` (Y:). Its password is in 1Password vault `vibe_coding`, item "edgesynology2 NAS - popdam-render service account".
- **shared-db:**
  - #4284, the Z: password Vault RPCs, was MERGED as 13bcff66 at 2026-10-14 07:19 UTC. It is NOT promoted to production.
  - Allocator fixes merged: #4286, #4289, #4291, #4293.
- **ai-devops:**
  - Production-gate enforcement merged: #1735, #1740, #1743.
  - Review identity-drift fixes merged: #1721, #1741.
  - StepFun verdict-parse fix merged: #1742.
  - Gemini hold fix merged: #1720.
  - The ban on plain `git pull` in the installed checkout, plus a detector for it, is merged and installed.
- **Data:**
  - "Exorcist, The (1973)" was added under WARNER BROS (shared-db #4176). The 11 assets were reclassified (popdam3 #95, closed).
  - ColdLion licensor codes were loaded (shared-db #4237).
  - The AI tester account was given DAM access (#327).

## 3. Not done — ordered next actions

1. **Get #4284 live.**
   - Blocker: preview refuses with "preview contains unmerged predecessor(s): 20261013130102", which is shared-db PR #4206 (issue #2336, claim #4152).
   - #4206 has a Muse APPROVE at 61b97f6.
   - Shared-db requires a second, independent, non-Muse reviewer, but Albert said "Switch to muse as the reviewer". Albert must say whether GLM or StepFun may be the second reviewer.
   - After that: guarded merge of #4206, preview replay, then `ai-task-gates check --before shared-db-promotion` with the Muse report, then promote #4284 and live-verify that `get_popdam_z_nas_password` and `set_popdam_z_nas_password` exist and are server-only.
   - Claim handover state for #4152 and #4283 is on https://github.com/popcre/shared-db/issues/2336 and https://github.com/popcre/shared-db/issues/4281.
2. **Do the #179 3a cutover**, with a Muse final-check of the plan first. Plan: https://github.com/u2giants/popdam3/blob/popdam/179-z-nas-vault-agent/docs/ops/179-3a-z-vault-cutover-plan.md
   - Load the popdam-render password into Vault for Z:, and update the Y: Vault secret.
   - Switch `WINDOWS_AGENT_NAS_USER` and `WINDOWS_AGENT_SG_NAS_USER` to popdam-render.
   - Send `force_restart` through the admin path. Log in as ai-admin@designflow.app; ai-tester is not an admin.
   - Prove live renders on Z: and Y:.
   - Delete the plaintext `WINDOWS_AGENT_NAS_PASS` row.
   - Remove `ahazan` from the share ACLs, the edgesynology2 Samba write list, and the docker sudo script.
   - Reassign DSM tasks 9 and 10.
   - **SECRET SAFETY:** a helper leaked a password twice. Put every secret-handling command in a reviewed script file. Values go from 1Password to a file created with umask 077, then into psql/stdin. Never put a value in arguments, stdout, or xtrace.
3. **Run the licensor fill-in (#357)** after the running DAM scan finishes. The scan session is 9381c755, and its progress is in admin_config key `SCAN_PROGRESS`. It was about 28% done at 1:18 AM EDT on 10-14.
   - The plan has a DeepSeek APPROVE. It is on branch `ops/licensor-fill-plan`: https://github.com/u2giants/popdam3/blob/ops/licensor-fill-plan/plan_licensor_fill_missing.md
   - Order: run a 500-row pilot, then the full run.
4. **Remove Qwen:** MiMo's shared-db #4272 and ai-devops #1728 must land, then reinstall and prove that a reviewer draw never selects Qwen.
5. **ai-devops gate inventory:** about 21 unchecked gates are ranked in ai-devops #1743. Enforce them top-down, starting with `never-open-raw-transcript-archives`.

## 4. Owner questions (Albert)

- May shared-db's required second reviewer be GLM or StepFun?
- 15 damaged PSDs, the Winnie the Pooh .ai file, and the 60 compat-alert .ai files can't be previewed. Should they be re-saved, or stay marked as no-preview? The list is on #382.
- Should the 15 zero-byte "_Conflict.psd" copies be deleted? One differs from its sibling and needs a human look.
- Should DeepSeek be topped up, or left out of use? It is out of credit.
- May the ColdLion property codes load now, or wait for Ilona's mapping and Laura's sign-off? This falls under the Sept 25 hold on shared-db #2541.

## 5. What did NOT work

- **Haiku helpers:** they stop after each small step, and they twice leaked a secret to their own output through shell constructs. Use a stronger model for multi-repo shared-db work.
- **Samba catia mapping on the edgesynology2 mac share:** it did not expose names containing `"`. It was rolled back. Windows only shows those files under 8.3 names, so the fix is to match on size and mtime (#391).
- **Waiting for a Hetzner console:** there is no console credential. The fallback is a key-based SSH recovery path that is held open.
- **Reviewer runner:** using `new` on a draw that had already started corrupts its continuation receipt. Run one `new`, then continue with `ask`.
- **Taking over claim #4152 from hetz:** the original working copy is on edge-dev3. PR #4289 added a signed cross-machine handover.

## 6. Stale-risk facts

All counts, SHAs, and the scan percentage above are from 2026-10-14 between 1 and 8 AM EDT. Re-check them.

Posted by Claude chat 7623097e-a8da-4712-8cab-fb86b5076289 on hetz
