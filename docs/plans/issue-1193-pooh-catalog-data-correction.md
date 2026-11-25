---
summary: "Issue 1193: check the artwork and remove stray Winnie the Pooh tags from a Disney Princess pencil-cup product."
kind: plan
status: open
read-when: "correcting wrong character tags or descriptions on specific products; working on issue 1193 or the 'pooh clock' search test case"
---

# Stray Winnie the Pooh data on two non-Pooh products (issue #1193)

Issue: [#1193](https://github.com/u2giants/popdam3/issues/1193), found on 2026-11-19 during the #1037 search live proof.
Handoff registration: [HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md](../../HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md).

Product codes and IDs are intentionally left out of this public repo. Every product is found by query (§5) as a signed-in viewer.

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| A. Shrek wall clock description | ✅ already correct | Read-only production query, 2026-11-25 ~4:05 PM EST: the Shrek clock group (property "SHREK FRANCHISE ASSET") has no "pooh" in `item_description`, `item_short_description` or `cover_description`, and has zero Pooh tags. Re-run query Q2 in §5 to re-derive. |
| B. Test-set labels | ✅ already correct | In `admin_config.SEARCH_EVAL_SET_V1`, case `mng-003` ("pooh clock"): both products sit in `dam.irrelevant`, not `must_find`, and all 8 `must_find` groups have property "Winnie The Pooh". Re-run query Q1. |
| 1. Check the Princess pencil-cup artwork | ⬜ open | — |
| 2. Reject the wrong Pooh tags and correct the cover description | ⬜ open | — |
| 3. Live proof | ⬜ open | `- [ ] live proof` on #1193 |

A fresh session starts at step 1.

## 1. Ultimate goal

Searching PopDAM for Winnie the Pooh products returns real Pooh products, not unrelated products that carry a wrong Pooh label. Product records describe what is actually on the artwork. The search quality test keeps measuring real Pooh products as must-find.

**If a step conflicts with this goal, the goal wins. Stop and flag it on the issue.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed product artwork, at https://dam.designflow.app. Each product (SKU) is a **style group** of files.

- AI tagging adds tags (for example a character name) and descriptions to each file. "Group" tags are copied from the cover file to its group.
- Descriptions come from ColdLion, POP's ERP system (`item_description`), and from AI (`item_short_description`, `cover_description`).
- Search ranks partly by these tags and descriptions.
- `admin_config.SEARCH_EVAL_SET_V1` is a private test set of search queries with judged results. It is documented in `docs/SEARCH_EVAL.md`, run by `scripts/search-eval/run.mjs`, and must never be copied into this repo.

Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3). This plan changes **data**, not code, and needs no PR except updating this plan's STATUS.

## 3. What triggered this work

The issue reported two problems:
- a Shrek wall clock whose description said "Disney's Winnie the Pooh";
- a Disney Princess calendar pencil cup whose cover image was tagged "Winnie The Pooh".

Both showed up in "pooh clock" results and were labelled must-find in the search test case. It asked for the artwork to be verified, the data corrected and the must-find labels removed.

## 4. Scope

**In:** the Pooh tags and Pooh wording on the Disney Princess pencil-cup style group, after visual verification.

**NOT in this plan:**
- A library-wide sweep for wrong character tags. If step 1 shows the AI model mislabels Pooh systematically, raise that as a new issue with the evidence.
- ColdLion data. The Shrek description is already correct.
- Code changes.
- Re-running the full search evaluation. Case `mng-003` is already relabelled.

## 5. Current state (verified 2026-11-25, read-only)

Queries; run them through the Supabase Management API read-only endpoint (§12):
- **Q1, test-set labels.** Read the case with `c->>'id' = 'mng-003'` from `jsonb_array_elements(value->'cases')` of `admin_config` key `SEARCH_EVAL_SET_V1`. List the `dam.must_find` and `dam.irrelevant` IDs, joined to `style_groups.property_name`.
  Result: 8 `must_find`, all "Winnie The Pooh"; 5 `irrelevant`, which include the Shrek clock ("SHREK FRANCHISE ASSET") and the Princess pencil cup ("Disney Princess").
- **Q2, the Shrek clock.** Use the `irrelevant` group with property "SHREK FRANCHISE ASSET". Result: no Pooh text in any description, and zero active Pooh tags.
- **Q3, the Princess pencil cup.** Use the `irrelevant` group with property "Disney Princess". It has 10 live files and 4 active `asset_tags` rows with `tag = 'winnie the pooh'` and `source = 'ai'`:
  - one on the **cover** file, with model `z-ai/glm-5.3-flash`; that file's `ai_description` also mentions Pooh;
  - three on other files, with `model` null, which marks legacy group-propagated tags (one of those files was last tagged by `qwen/qwen3-vl-32b-instruct`).
  No file is linked to a Pooh character in `asset_characters`. None of the group-level descriptions mention Pooh.
- The app has a tag-review path: `admin-api` routes `review-scoped-tag` and `remove-scoped-tag` (`supabase/functions/admin-api/index.ts:2133-2137`), used by `src/components/library/ScopedTagSections.tsx`, which shows rejected tags.

## 6. Key findings and root cause

- Half of the issue is already resolved (STATUS rows A and B). The Shrek description no longer mentions Pooh, presumably corrected at its ColdLion source by a later sync. The test-set case was relabelled.
- What is left is the Princess group's AI Pooh tags. Probable cause: the cover is a multi-design concept or calendar sheet, the AI named a character it thought it saw, and the old group propagation copied the tag to three sibling files. This is unconfirmed until step 1.

## 7. Approaches considered and rejected

- **Deleting the tag rows with SQL.** Rejected. Ad-hoc writes bypass the app's tag history, and the AGENTS.md rules forbid one-off production writes outside the app's own paths. Use the app's tag review.
- **Force re-tagging the cover with AI.** Rejected as the first move. It costs a model call, may reproduce the same mistake, and replaces every AI tag on the file. Use it only if step 2 cannot correct the description any other way.
- **Removing the products from the test set.** Not needed. They are correctly labelled irrelevant.

## 8. Design decisions

Locked: the artwork decides. If the cover really shows Pooh (for example a multi-property sheet), the tag is correct and stays; document that and close the issue.

Open: whether to correct the cover's `ai_description` text. Do it only if the app offers an edit path for it. If not, record the stale sentence and leave it; the tag drives search more strongly.

## 9. The plan

**Step 1. Look at the artwork.** `lead-only`: a judgment on licensed artwork.
- Sign in as a viewer at https://dam.designflow.app, using the owner's existing browser session; never type a password. Search "pooh clock" and open the Disney Princess pencil-cup product, or open it from Q3's group ID.
- View the cover and the three files that carry the tag, at full size.
- Decide, for each file, whether Winnie the Pooh is actually depicted. Take one screenshot per file, kept privately (not in the repo or issue, because it is licensed art).
- Gate: a recorded yes/no per file in this plan's STATUS, by file position only, with no product code.

**Step 2. Correct the data.** `lead-only`: production data.
- For each file where Pooh is **not** depicted, use the app's tag review (the scoped tag section on the file's detail panel, which calls `review-scoped-tag` or `remove-scoped-tag`) to reject or remove the "winnie the pooh" tag.
- If the cover's AI description wrongly names Pooh and the app has a description edit, correct it; otherwise record it (§8).
- Gate: re-run Q3. There are zero active "winnie the pooh" tags on the files judged not-Pooh, and the rejected tags show as rejected in the file panel.
- Stop-and-ask trigger: the tag-review UI is not available to the signed-in role. Then use an admin session; never use SQL.

**Step 3. Live proof.** `lead-only`.
- As a viewer, search "pooh clock" and "winnie the pooh pencil cup". The Princess product no longer appears for its stray tag. Record the rank change in the issue comment, without product codes.
- Optionally, run `node scripts/search-eval/run.mjs` for case `mng-003` only, if the script supports a case filter (see `docs/SEARCH_EVAL.md`). Its must-find score must not drop.
- Comment the evidence on #1193 and close it.

## 10. Tests required

N/A for code; no code changes. The verification is queries Q1–Q3, before and after, plus the viewer search in step 3.

## 11. Constraints and gotchas

- The issue and this repo are public. Never post product codes, file names, paths or images; use positions and queries.
- No direct SQL writes to production; use only the app's own tag review.
- Licensed artwork screenshots stay private.
- A tagging run may re-tag the cover later and reintroduce the tag. If that happens after closure, it is a model-quality issue; open a new issue with the evidence.

## 12. Access and environment

- Read-only SQL: `POST https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/database/query/read-only`, with the bearer token from 1Password `vibe_coding` → "Supabase CLI Personal Access Token" (field `credential`), injected with `op run` and never printed. See `docs/MCP_SERVERS.md`.
- App: https://dam.designflow.app, using the owner's existing browser session.

## 13. Definition of done, risks, open questions

Done when:
- [ ] The step 1 judgments are recorded.
- [ ] Step 2's Q3 re-run shows no wrong Pooh tags.
- [ ] The step 3 search proof is commented on #1193.
- [ ] #1193 is closed.
- [ ] This STATUS is updated through a small docs PR, or noted in the closing comment.

Risk: rejecting a correct tag hides a real Pooh product from search. Step 1's visual check guards against that, and a rejected tag can be restored through the same review UI.

Open: none.

## Self-audit

1. *Could a fresh session execute this without asking?* Yes. §5 gives the exact queries and current results, §9 the UI path and gates, and §12 the access.
2. *Is all background captured?* Yes. STATUS rows A and B and §6 record what is already resolved, with evidence; §7 records the rejected options.
3. *Is the goal clear for judgment calls?* Yes. §1 says the artwork decides and search should return real Pooh products.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1193-pooh-catalog-data-correction.md in u2giants/popdam3. Read AGENTS.md, then the plan (STATUS first; rows A and B are done). Every step is lead-only: no helper is needed. If you use one for re-running queries Q1–Q3, your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md (finished work or an evidenced blocker; no decisions, merges or posts; taken back after 30 minutes stuck). Do steps 1–3 yourself, keep product codes and artwork out of public places, and close #1193 with evidence.
```
