---
issue: 1184
status: OPEN
owner: claude/plan-coldlion-landing-phases-2-6
---

# OPEN — ColdLion landing phases 2-6: plan written, no code started

**Opened:** 2026-08-19 · **Machine:** al8960ofc · **Agent:** Claude (Opus 5)
**Repo:** `u2giants/shared-db` · **Branch:** `plan-coldlion-landing-phases-2-6`

## 1. What this workstream is

Build the ColdLion landing tables — phases 2 to 6 of issue
[#1184](https://github.com/u2giants/shared-db/issues/1184). Phase 1 (the spine) is already merged.

**The plan is the deliverable of this session and it is complete:**
[`../docs/plan_coldlion-landing-phases-2-6.md`](../docs/plan_coldlion-landing-phases-2-6.md).
Read its STATUS table first. Do not re-plan or re-derive its numbers.

## 2. Why it exists

Albert asked which product categories each division sells. Answering it needs an item's division.
Our stored item copy has the division column empty on all 17,703 rows, because the loader was
pointed at DesignFlow rather than ColdLion. That exposed a wider problem: the ingest tables are not
shaped to receive ColdLion's data at all — wrong identity key, wrong grain on production orders, and
sales history missing entirely.

## 3. State right now

| Thing | State |
|---|---|
| `docs/plan_coldlion-landing-phases-2-6.md` | Written, committed on the branch. Not merged yet |
| `docs/coldlion-field-decisions-20260819.csv` | Albert's per-field ingest/ignore decisions, sanitised of sample values |
| Two owner rulings (D1 all-14 slots, D3 division letter code) | Committed on the branch |
| Any migration or loader code | **None. Nothing built.** |

**Nothing is deployed. No database object was created or changed by this session.** Every database
call was read-only.

## 4. Decisions Albert made this session (all locked, all in §8 of the plan)

D1-D6 below plus D10-D13 added later the same day. Full table with authority and dates is §8 of the
plan; this list is the plain-English version.

- Land all 14 merch-group slots even though 11-14 measure 0% populated.
- Drop merch-group codes and their `Desc` twins from both history feeds — they are item attributes.
  Verified identical on 519 of 519 order lines.
- Division identity is the letter code (`CW001`), never a number.
- Only fields marked `ingest` get a typed column.
- **No raw JSON archive.** He weighed this against the planner's recommendation and rejected it on
  query-performance grounds. Accepted consequence, stated to him explicitly: an `ignore` decision on
  the history feeds is effectively permanent.
- `dimCode` on itemDetails: ignore.
- **D10** `change_log` keeps the complete payload but ONLY for rows that actually changed. This is
  the agreed reconciliation of "no raw archive" with the already-shipped phase 1 spine, which has
  `new_raw NOT NULL`.
- **D11** exclude retired division `EP001`, filtered at the loader. Consequence he accepted: totals
  will not tie out to a ColdLion report run across all four divisions.
- **D12** colour and size stay out of `item_detail` — reaffirmed after the consequence was put to
  him explicitly. *"We don't make clothing."*
- **D13** `orderHistory.lineCancelledQty` flipped from ignore to ingest.
- **Priority:** build these tables next. He saw that the item sync is still broken and did not
  schedule it — that is a choice, not an oversight.

## 5. What did NOT work — do not repeat these

- **`gh pr merge` in a retry loop.** `main` has 9 required checks and other sessions merge often, so
  the branch kept going stale and the loop burned ~35 minutes. Use
  `gh api -X PUT repos/u2giants/shared-db/pulls/<n>/update-branch`, then poll `mergeStateStatus`
  until `CLEAN`. Do not `git checkout` to update the branch — the working tree may belong to another
  session, and it did change underneath this one mid-task.
- **Per-item ColdLion lookups** to compare order fields against the item master. Many returned no
  rows and it wasted calls. Pull the full item master per division (`size=2000`) and join locally.
- **Reading stored payloads to decide what a feed contains.** That is how this session initially and
  wrongly concluded division was absent from the item feed. Albert corrected it. Read
  `GET /EhpApi/v2/api-docs` — it also disagreed with our own docs about writable endpoints.
- **Trusting `pg_stat_user_tables.n_live_tup` for row counts.** It reported 0 for tables holding
  17,703 rows. Use `count(*)`.
- **Assuming your commits went to your own branch in this shared checkout.** They did not. Another
  session switched the working tree to its branch mid-session, and two commits authored afterwards
  attached to *that* branch's HEAD and never reached this one. `git push` reported success. The
  commits were recovered from the reflog and grafted on with `git commit-tree` against a temporary
  `GIT_INDEX_FILE`, which never touches the working tree. **After every commit here, verify with
  `gh pr view <n> --json changedFiles` that the file count is what you expect** — the branch name in
  your prompt is not proof of anything.
- **Deciding a field is worthless from one small sample.** `lineCancelledQty` measured 0.8% in a
  two-window sample, 11.5% in a six-window sample, and 24% in the 5,874-row census. The owner
  originally dropped it on the 0.8% figure and reversed once shown the others. Under the no-raw
  ruling that drop would have been permanent. Sample widely before presenting a fill rate as a
  reason to discard.
- **Applying a ruling wider than its evidence.** The 519/519 merch-group match covered *line-level*
  groups only. The first draft used it to justify dropping `subMerchGroup*`/`ppkMerchGroup*` too,
  which are a different grain and which our own history-shape doc calls the better record. Grok
  caught it. Nothing was lost because no code was written, but under D5 it would have been a
  permanent discard of seven years of assortment taxonomy.

## 6. Open items for the next session

1. Start at **step 1** of the plan: supersede the design doc for the 2026-08-19 rulings. It is
   documentation only and unblocks steps 2-6, which are independent of each other.
2. **The Grok review is DONE.** It returned REJECT on the first draft and found three real defects,
   all verified against the owner's field list and all corrected in the plan. Do not re-run it on
   the same draft. Cost $0.24, 972k tokens, session `coldlion-phases-2-6-plan-review` — resume that
   session with `ai-grok-review ask` rather than starting a new one.
3. ⛔ **Step 4 is blocked until the `orderHistory` line key is resolved from a live pull.** There is
   no `lineNo` in the payload. Do not guess one; every obvious candidate silently merges real sales
   lines. This is step 4a in the plan's STATUS table.
4. Two questions are with Albert and unanswered:
   - Should we ask ColdLion for a **vendor write endpoint**? He wants to own FEMA/NBC certificate
     expiry dates but there is no write path. They added the 7-day cap and `prodLineSeq` on our
     request, so asking is plausible. Not blocking.
   - A drafted question to ColdLion about **`lineInvoiceQty` and `lineOpenQty` always reading zero**
     was given to him on 2026-08-19 with two real order examples (7124957, 7124958). Unknown whether
     he has sent it. **Until answered, never build a report on "invoiced" or "open" quantity from
     `orderHistory`** — it would read zero for everything and look plausible.
5. **The item sync is still broken** (403 since 2026-05-21, out of scope for this plan). Actively
   losing data. Albert has seen it and has not scheduled it. Raise it again if this plan runs long.

## 7. Where the evidence lives

All measurements are in §6 of the plan with the method to re-derive them. The sample-bearing CSVs
Albert marked up are **not in the repo** — this repo is public and they carry licensor names, item
descriptions, vendor emails and customer names. They are in Albert's Dropbox at `ai/`.

## 8. Delete this file when

Steps 1-7 of the plan are done and its STATUS table shows every row complete with an artifact. If
the plan is abandoned instead, say so here with the reason before deleting.
