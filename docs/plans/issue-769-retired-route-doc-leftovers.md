---
summary: Issue #769 plan: correct the two docs that still describe the Helper /logs route and the sync-external tombstone retired by PR #765. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #769, or editing docs/INFRASTRUCTURE.md helper-api routes or the docs/UI_OVERVIEW.md AI Tagging tab section
---

# Plan: Remove stale docs for routes retired in PR #765 (u2giants/popdam3#769)

Issue: https://github.com/u2giants/popdam3/issues/769
Handoff: [HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md](../../HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md)
Parent work: [issue-471-dead-code-removal.md](issue-471-dead-code-removal.md) (COMPLETE).
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Worktree + branch | ⬜ open | |
| 2 | Delete the `/logs` row in `docs/INFRASTRUCTURE.md` | ⬜ open | row at `docs/INFRASTRUCTURE.md:197` on `origin/main` `787c20b8` |
| 3 | Rewrite the AI Tagging paragraph in `docs/UI_OVERVIEW.md` | ⬜ open | paragraph at `docs/UI_OVERVIEW.md:403-407` |
| 4 | Doc grep gate + index regen | ⬜ open | |
| 5 | PR, merge, close #769 with proof | ⬜ open | |

Review finding 3 (issue-471 plan STATUS rows 4–6 left open) is **already resolved**: that plan's STATUS now reads "COMPLETE" with live 404 evidence. Nothing to do for it.

**Where a fresh session starts:** Step 1. No dependency on any other open PR.

## 1. The ultimate goal

When someone reads PopDAM's documentation, it must describe the system that actually runs. PR #765 deleted two server endpoints that nothing used: the desktop Helper's `POST /logs` route and the old `sync-external` taxonomy function. Two documents still describe them as live. A reader (human or AI) who trusts those lines will look for a feature that does not exist, or think a 404 is a bug. When this plan is done, neither document mentions either endpoint as current behaviour.

Nothing a user sees in the app changes. No code changes. **If a step conflicts with this goal, the goal wins — stop and flag it.** For example, if you find either endpoint is in fact still deployed and answering, do not delete the doc line; record the evidence on #769 and stop.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed consumer-product art (https://dam.designflow.app), with a sibling style-guide app PopSG (https://sg.designflow.app) served from the same repo, `u2giants/popdam3`, release branch `main`. Stack: Vite + React web app (`src/`), Supabase edge functions (`supabase/functions/`, project `qsllyeztdwjgirsysgai`), a Railway worker, a Synology bridge agent, a Windows render agent and an Electron desktop "Helper" (`apps/popdam-helper/`) that checks files out and back in. `helper-api` is the edge function the Helper talks to. Read `AGENTS.md` first.

## 3. What triggered this work

The advisory AI reviewer (GLM) reviewed merged PR #765 ("Remove unused taxonomy writer and no-op endpoints", head `d2f35d3c`) and opened #769 with three findings:
1. `docs/INFRASTRUCTURE.md` still lists `| POST | /logs | Helper | Store audit / error events |` although #765 removed that route.
2. `docs/UI_OVERVIEW.md` still says "`sync-external` was retired on 2026-07-23 and returns HTTP 410", but the function source and config were deleted.
3. The #471 plan STATUS rows were left open. (Since fixed — see STATUS.)

The review-fixer bot deferred it ("source owner must deliver a corrective PR"). Reproduce: `grep -n "/logs" docs/INFRASTRUCTURE.md` and `grep -n "sync-external" docs/UI_OVERVIEW.md` on `origin/main`.

## 4. Scope

**In:** the one table row and the one paragraph named in §5, plus any other current (non-history) doc line the Step 4 grep finds that describes either endpoint as live.

**NOT in this plan:**
- Any code, edge function, or config change (the code removal is done).
- History documents: `docs/archive/`, `docs/plans/`, `docs/verification/`, `docs/audit-2026-10-21.md`, `docs/incident-log.md`. Those record what was true then; leave them.
- Rewriting the rest of the AI Tagging tab section or the helper-api table.

## 5. Current state of the code (verified 2026-11-25 on `origin/main` `787c20b8`)

- `docs/INFRASTRUCTURE.md:197` — `| \`POST\` | \`/logs\` | Helper | Store audit / error events |` inside the `helper-api` route table (rows `:190-197`).
- `docs/UI_OVERVIEW.md:403-407`, under `### Tab: AI Tagging`:
  > Legacy taxonomy endpoint fields and sync controls remain visible, but `sync-external` was retired on 2026-07-23 and returns HTTP 410. They no longer populate licensors, properties, or `public.characters`; see `docs/SCHEMA.md` §2.3 …
- Live checks run 2026-11-25 ~4:00 PM EST: `POST https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/sync-external` → **404**; `POST …/functions/v1/helper-api/logs` → **404**. Both deployed copies are gone, so the "deployed copy deletion pending" wording the reviewer suggested is no longer needed either.
- `grep -rn -i "taxonomy\|sync-external" src/components/settings/AiTaggingTab.tsx` finds nothing: the "legacy taxonomy endpoint fields and sync controls" the paragraph says "remain visible" also appear to be gone. Step 3 confirms on the live Settings page.

## 6. Key findings

1. Both endpoints are deleted in source **and** in the deployed project (404s above). The docs are the only remaining trace.
2. The paragraph's first clause (fields "remain visible") is probably stale too; the source has no such fields. This must be checked visually, not assumed.
3. The pointer to `docs/SCHEMA.md` §2.3 for character-catalog lineage is still useful and should survive.

## 7. Approaches considered and rejected

- **Reword to "deleted; deployed copy pending"** (the reviewer's suggestion). Rejected: the deployed copy is already deleted (404), so this would be a new stale statement.
- **Leave a "removed in #765" row in the route table.** Rejected: the table is an inventory of live routes; history belongs in the #471 plan, which already records it.
- **Edit the #471 plan's STATUS** (finding 3). Rejected: already done by a later session.

## 8. Design decisions

- **LOCKED (2026-11-25):** current-state docs describe only live behaviour; history docs untouched.
- **OPEN:** exact wording of the replacement sentence in Step 3 — criterion: one or two sentences, states that taxonomy data does not come from an external sync, keeps the `docs/SCHEMA.md` §2.3 pointer.

## 9. The plan

**Step 1 — Worktree/branch.** `git worktree add <path> -b claude/769-retired-route-docs origin/main`. Gate: `git log --oneline -1` equals current `origin/main`. `helper-ok` — mechanical. Stop-and-ask: worktree creation fails.

**Step 2 — Delete the `/logs` row.** Remove `docs/INFRASTRUCTURE.md:197` (the whole table row) and nothing else. Gate: `grep -n "/logs" docs/INFRASTRUCTURE.md` returns nothing; the table still renders (rows above unchanged). `helper-ok` — single exact line. Stop-and-ask: the line is not at that position or there is more than one `/logs` mention.

**Step 3 — Rewrite the AI Tagging paragraph.** First open https://dam.designflow.app → Settings → AI Tagging as the admin tester (§12) and screenshot the tab. Then replace `docs/UI_OVERVIEW.md:403-407` with wording that matches the screenshot, e.g.: "Taxonomy (licensors, properties, `public.characters`) is not populated from any external sync; the old `sync-external` function was removed (#471). See `docs/SCHEMA.md` §2.3 for the character catalog's verified and unverified source lineage." If the screenshot *does* show legacy taxonomy endpoint fields, keep a clause saying they are present but inert, and add a note to #769 that the fields remain (do not remove UI here). Gate: `grep -n "sync-external\|410" docs/UI_OVERVIEW.md` shows no "returns HTTP 410" claim; the sentence matches the screenshot. `lead-only` — wording depends on a live visual judgment.

**Step 4 — Repo-wide doc gate + index.** Run `grep -rn "sync-external\|helper-api/logs\|POST.*/logs\|sendLog" docs README.md AGENTS.md --include=*.md | grep -v "docs/archive\|docs/plans\|docs/verification\|audit-2026\|incident-log"`. Fix any remaining current-state claim the same way. Then `ai-doc-health --repo . --fix-index` (from `popcre/ai-devops`) if available; if the tool is not installed, note it in the PR (the doc-health check is advisory). Gate: the grep is empty. `helper-ok` for running the grep; any hit it finds is brought back to the lead (stop-and-ask: any hit).

**Step 5 — PR, merge, close.** Commit as the verified identity (`git var GIT_COMMITTER_IDENT`), stage only the two docs (+ `docs/INDEX.md` if regenerated). `gh pr create --base main`, body ending with the attribution line. Wait with `bin/ai-pr-wait <pr>` in the background if present, else `gh pr checks <pr> --watch`. Merge when required checks pass (reviews are advisory). Comment on #769 with the merged SHA, the two 404 results and the Step 3 screenshot description, signed with the session signature, then close it. Update this plan's STATUS. `lead-only` — merge and closure.

## 10. Tests required

No code changes, so no unit tests. Required green: the PR's required checks (doc-only PRs run `ci.yml` path-filtered; nothing must break). The Step 4 grep is the regression check.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push to `main`; the AI merges. Reviews are advisory.
- New Markdown files need the four-key header; this plan edits existing files only.
- Do not edit history documents (§4).
- Sign every GitHub post (session signature, format "Posted by <tool> chat (<id>) on <host>"). Times in EST.
- Canonical checkout is landing-only — work in your own worktree.

## 12. Access and environment

- `gh` authenticated as `u2giants`.
- Admin test login for the live DAM: 1Password vault `vibe_coding`, item listed in `docs/1password.md` ("PopDAM admin tester"); never paste the value.
- Live endpoints for the 404 re-check: `https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/sync-external` and `…/helper-api/logs` (unauthenticated POST is enough to see 404 vs 410).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Both stale statements removed/rewritten on `main`; Step 4 grep empty.
- [ ] PR merged with required checks green.
- [ ] #769 commented (SHA, 404s, screenshot) and closed; this STATUS updated.

Risks: none to runtime; a wrong rewrite of the UI paragraph is the only risk (mitigated by the screenshot). Rollback: revert the PR.

Open questions: none.

## Self-audit

1. **Fresh session could execute without asking?** Yes — §5 gives exact lines and live results, §9 gives the exact edits and gates, §12 the login location.
2. **All background carried, including what was ruled out?** Yes — §6 records that deployed copies are already gone and the UI clause is probably stale; §7 records why the reviewer's wording and a history row were rejected, and that finding 3 is already fixed.
3. **Goal clear enough to steer by?** Yes — §1: current docs describe only live behaviour; if an endpoint is found live, stop.

## Lead launch prompt

```
Read docs/plans/issue-769-retired-route-doc-leftovers.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 3 and 5 yourself (live screenshot judgment, merge, issue closure).
Hand Steps 1, 2 and 4 (grep only) to your helper, in that order. Your helper is your own tool's smaller
model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for
Mimo Pro. Never a full-strength model. Helper rules: return finished work or an evidenced blocker; make no
design decisions; never merge or post; bring back any stop-and-ask trigger named in the step; if stuck 30
minutes, the lead takes the step back. Rules sheet:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Lead checks: re-run the Step 4 grep and both live 404 probes yourself before merging.
```
