---
summary: Plan for #1307 (+#1335): repair the shared-data no-copies plan STATUS and drop stale table docs. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1307, or editing plan_shared_data_no_copies.md STATUS
---

# Plan: repair `plan_shared_data_no_copies.md` STATUS and close out the no-copies effort (u2giants/popdam3#1307, folded #1335)

Issue: https://github.com/u2giants/popdam3/issues/1307 (folded child: #1335, closed)
Handoff: [HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-plans-master-data-shared-data-invites.md](../../HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-plans-master-data-shared-data-invites.md)
Target plan being repaired: [plan_shared_data_no_copies.md](../../plan_shared_data_no_copies.md)
Written 2026-11-25 3:56 PM EST by Claude (plan only).

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 1. Re-verify T1 and S2 facts from their own sources | ⬜ open | Planning read 2026-11-25: popcre/designflow-tracking#239 CLOSED with a signed "T1 done (verified 4:03 PM EST)" comment; popcre/shared-db#6993 CLOSED; parent #1298 CLOSED |
| 2. Rewrite the T1 row with T1's own evidence | ⬜ open | `plan_shared_data_no_copies.md` T1 row currently cites migration `20261225091103` (that is S2) and has only 4 cells |
| 3. Fix the "Fresh session starts at" line (#1335) | ⬜ open | Still says "only C2+C3 (together) then C4 remain" while all 12 rows are done |
| 4. Retire PopDAM docs for dropped tables | ⬜ open | `docs/SCHEMA.md:259-275` §2.15 still documents `prod_order_sync_runs`, `prod_order_headers_raw`, `prod_order_headers_current`; generated types no longer list them (grep empty 2026-11-25) |
| 5. Mark the plan and its handoff complete | ⬜ open | plan front-matter `status: current`; handoff `HANDOFF.d/2026-11-23T2010Z-hetz-claude-shared-data-no-copies.md` still `status: current` |
| 6. Check the shared-db sibling plan S2 row | ⬜ open | `popcre/shared-db` `plan_shared_data_no_copies_db.md` — S2 row was open at review time |
| 7. PR → merge, comment and close #1307 | ⬜ open | — |

Where a fresh session starts: Step 1.

## 1. Ultimate goal

The "read shared data instead of copying it" effort is finished. Its plan must
say so truthfully, with each finished stage pointing at its own proof, so no
future session re-runs a destructive stage (dropping tables that are already
gone) or skips a credential stage on false evidence. Documentation must stop
describing tables that no longer exist. **If a step conflicts with this goal,
the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`) is POP Creations' internal digital asset manager.
`plan_shared_data_no_copies.md` (repo root) is the coordinator plan for removing
PopDAM's private copies of data that lives in the shared Supabase database
(project `qsllyeztdwjgirsysgai`; canonical schema repo `popcre/shared-db`).
Stages are rows S1, P1, P2, T1, S2, C1–C4, N1, D1, D2, each with a child issue in
one of four repositories (listed at the top of that plan's STATUS).

## 3. What triggered this work

- #1307: the AI reviewer on PR #1306 found the T1 row ("Remove the production-order feed service key", `popcre/designflow-tracking#239`) marked done with S2's evidence — migration `20261225091103`, whose own header says "stage S2" and which drops the five copy tables — while S2 still showed open. Since then S2 was marked done correctly, but the T1 row still carries the S2 evidence and is a malformed 4-cell row.
- #1335 (folded here): after C2–C4 went live, the "Fresh session starts at" line still says C2+C3 then C4 remain.
- The reviewer also noted `docs/SCHEMA.md` and generated types still describe the three dropped tables; types are now clean, SCHEMA.md is not.

## 4. Scope

In: the T1 row, the start line, front-matter/handoff status of the no-copies plan, `docs/SCHEMA.md` §2.15, and a read-only check of the shared-db sibling plan's S2 row (a PR in `popcre/shared-db` only if that row is still wrong — docs only, no migration).

NOT in this plan: any database change; any change in `designflow-tracking`; re-running any stage; editing another session's handoff body (only its `status:` front-matter is set to `complete`, which the handoff standard allows for closing a finished plan — if unsure, add a closing line in your own handoff instead).

## 5. Current state (origin/main 787c20b8)

- `plan_shared_data_no_copies.md` STATUS table: every row ✅; T1 row text: "✅ done 2026-11-23 — migration `20261225091103` (popcre/shared-db PR #7018; original 20261225090902 retired), production apply run 45314731038; re-check: 0 of the 5 tables…" — 4 cells, wrong evidence.
- S2 row: correct (migration 20261225091103, PR #7018, run 45314731038, proof on shared-db#6993).
- Start line: stale (see STATUS row 3).
- `docs/SCHEMA.md:259-275` documents the dropped tables under "2.15 Production PO Tables".
- `src/integrations/supabase/types.ts`: no `prod_order_*` / `production_order_snapshot` / `erp_item_snapshot` (verified by grep).

## 6. Key findings

T1's real evidence lives on popcre/designflow-tracking#239: revert PR popcre/designflow-tracking#238 merged 2026-11-23 3:23 PM EST; production build `d3095c71` SUCCESS; `helpers/auth.js` on main has no `authRoleOrFeedService`; a request with `X-Service-Authorization` gets 401; GCP secret `PROD_ORDER_FEED_TOKEN` NOT_FOUND; a later comment records PR #240 removing the stale Cloud Run secret binding (revision `00045-5gl`). That is the artifact set to cite.

## 7. Rejected approaches

- Setting T1 back to open (the reviewer's default suggestion): wrong now — T1's own issue carries verified proof. The reviewer allowed this exception explicitly ("unless the feed key really was removed … cite that instead").
- Deleting the plan: the plan stays as history; mark it `complete`.
- Rewriting SCHEMA.md §2.15 as "historical": the router rules say docs describe current state; remove the section and leave one line pointing to the drop migration.

## 8. Decisions

Locked: evidence cells cite artifacts (issue comment link, PR, build id, migration file), not bare counts. Open: whether the shared-db sibling row needs a PR — decided by Step 6's read.

## 9. Steps

### Step 1 — re-verify (`lead-only`: evidence judgment)
`gh issue view 239 --repo popcre/designflow-tracking --comments`; `gh issue view 6993 --repo popcre/shared-db --comments`. Copy the comment URLs (use `gh api repos/popcre/designflow-tracking/issues/239/comments --jq '.[].html_url'`).
Done when: you have the URL of the signed "T1 done" comment and the S2 proof comment. If T1's proof is absent or contradicted, set T1 to `⬜ open` instead and report `Blocked —` to the coordinator.

### Step 2 — T1 row (`helper-ok`: exact text given)
Replace the T1 row with five cells: `| T1 | designflow-tracking | Remove the production-order feed service key | ✅ done 2026-11-23 4:03 PM EST | popcre/designflow-tracking#238 revert merged; prod build d3095c71 SUCCESS; feed header now 401; GCP secret PROD_ORDER_FEED_TOKEN NOT_FOUND; Cloud Run binding removed by #240 (rev 00045-5gl); proof: <comment URL from Step 1> |`.
Done when: the table renders with 5 cells on every row (`grep -c '^| T1 |' plan_shared_data_no_copies.md` = 1 and the row has 6 `|`).
Stop-and-ask: if Step 1 did not produce a URL.

### Step 3 — start line (`helper-ok`)
Replace the "Fresh session starts at" line with: `Fresh session starts at: nothing — all 12 stages are done (closed out 2026-11-25 under #1307). Read only for history.` Set front-matter `status: complete`.
Done when: `grep -n 'C2+C3' plan_shared_data_no_copies.md` prints nothing.

### Step 4 — SCHEMA.md (`helper-ok`)
Delete `docs/SCHEMA.md` §2.15 table entries for the three `prod_order_*` tables (keep the following "OrderList contract (owned by shared-db)" heading intact); replace with one sentence: "Dropped 2026-11-23 by shared-db migration `20261225091103`; production orders are read through the shared read function (plan_shared_data_no_copies.md S1/P1)." Then `ai-doc-health --repo . --fix-index`.
Done when: `grep -n 'prod_order_headers\|prod_order_sync_runs' docs/SCHEMA.md` prints only the one sentence.
Stop-and-ask: if the section's boundaries differ from lines 259–275.

### Step 5 — handoff (`helper-ok`)
Set `status: complete` in `HANDOFF.d/2026-11-23T2010Z-hetz-claude-shared-data-no-copies.md` front-matter only. Done when the doc-health check passes.

### Step 6 — shared-db sibling (`lead-only`: other repo)
`gh api repos/popcre/shared-db/contents/plan_shared_data_no_copies_db.md --jq .content | base64 -d | grep -n 'S2'`. If S2 is not ✅ with evidence, open a docs-only PR there (branch, PR, merge per that repo's rules, load `shared-db-change` first even for docs). Done when the row is ✅ with the PR #7018 / run 45314731038 / #6993 proof.

### Step 7 — land (`lead-only`)
PR in popdam3 (`Fixes #1307`), required checks green, AI merges; comment the merge SHA on #1307 signed with `$AI_GH_SIGNATURE`.

## 10. Tests

Docs only: `.github/workflows/doc-health.yml` (advisory) and `ai-doc-health --repo .` locally must report no new errors.

## 11. Constraints

No database changes. Never re-run S2. Feature branch + PR. Sign GitHub posts. Quote times in EST.

## 12. Access

`gh` as `u2giants` with read on `popcre/designflow-tracking` and `popcre/shared-db`. No secrets needed.

## 13. Done, risks, open questions

Done: Steps 1–7, #1307 closed with the merge SHA. Risk: a wrong evidence citation misleads future sessions — mitigated by Step 1. Open: Step 6 outcome.

## Self-audit (2026-11-25)

1. Fresh session executes without asking: yes — §5/§6 give current text and the evidence source; §9 gives exact replacement text and gates.
2. Background carried: yes — §3 both findings, §7 why T1 is not reset.
3. Goal clear: yes — §1 (truthful, artifact-backed status; no re-run of destructive stages).

## Lead launch prompt

```text
Implement docs/plans/issue-1307-shared-data-no-copies-status-repair.md in u2giants/popdam3. Read its STATUS first.
You (lead) do Steps 1, 6 and 7 and verify everything; hand Steps 2–5 to your helper after Step 1 gives the comment URL.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design decisions, never merges or posts, asks you when a stop-and-ask trigger fires, and is taken back after 30 minutes stuck.
Re-run every step's grep gate yourself before the PR.
```
