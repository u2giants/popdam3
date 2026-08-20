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

**Everything this session produced is MERGED to `main`.** Nothing is left on a branch.

| Thing | State |
|---|---|
| `docs/plan_coldlion-landing-phases-2-6.md` | ✅ Merged (PR #1263). Step 4a since resolved — see §6 |
| `docs/coldlion-field-decisions-20260819.csv` | ✅ Merged. Albert's per-field decisions, sanitised of sample values |
| Owner rulings D1-D13 | ✅ Merged, recorded in §8 of the plan |
| `docs/coldlion.md` (new front door) + banners on 3 docs | ✅ Merged (PR #1311) |
| `docs/coldlion-open-questions.md` chase column + entries 2.7-2.10 | ✅ Merged (PRs #1316, #1323, #1325, #1329) |
| Branch protection `strict: false` | ✅ Applied. Revert criteria in issue #1286 |
| `AGENTS.md` split 234 KB -> 122 KB | ✅ Merged (PR #1336). **But see the collision note in §5 — PR #1212 was already doing this, better** |
| `scripts/check-cancelled-work.mjs` relocation exemption + 3 tests | ✅ Merged with #1336, 19/19 pass |
| ColdLion answers of 2026-08-20 (merch-group renumbering, active flag, line key) | ✅ Merged (PRs #1325, #1329, #1330, #1336) |
| Any migration or loader code | **None. Nothing built.** |

**Nothing is deployed. No database object was created or changed by this session.** Every database
call was read-only. The only non-documentation change was the branch-protection setting.

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

- **`gh pr merge` in a retry loop — the CAUSE IS NOW FIXED; read this before concluding the gate is
  broken again.** `main` has 9 required checks (~4 min). Until 2026-08-19 it ALSO required a branch
  to be up to date, so every merge by another session reset every waiting PR and restarted its
  checks — ~35 min lost on PR #1243 and ~25 min on #1263, with no check ever failing. Branch
  protection now has **`strict: false`** (owner-authorized 2026-08-19; recorded with revert criteria
  and the exact restore command in issue #1286). All 9 checks and `enforce_admins` are unchanged.
  If a PR still will not merge, diagnose the actual failing check — do not assume staleness, and do
  not loop.
- **Diagnosing a wedged check from its NAME.** On 2026-08-19 `SQL migration guards` sat pending for
  ~2 hours and this session reported "the guards check is hung". That was wrong: the guards *job*
  finished in 1 minute. The run was wedged on its step **"Install SQL check dependencies"** — an
  unbounded `apt-get` against slow Ubuntu mirrors. The same root cause failed the Playwright install
  on the `verify` check in the same hour, so what looked like two problems was one. **Already
  fixed:** PR #1265 (merged 2026-08-19) skips the install when the tool is present and bounds it at
  60s/120s; PR #1270 does the same for Playwright. Always open the failing STEP via
  `gh api repos/u2giants/shared-db/actions/runs/<id>/attempts/1/jobs` — never judge from the check
  name.
- **Proposing `paths:` filters so docs-only PRs skip the heavy checks.** This session recommended it
  to the owner before reading the workflows, and had to withdraw it. **The repo already forbids
  them**, in AGENTS.md §5.2 and in explicit comments in `shared-supabase-migrations.yml`,
  `tools-offline-tests.yml` and `coldlion-promotion-contract-tests.yml`. Two proven failure modes:
  a path-filtered workflow creates **no check run at all**, so a required context stays pending
  forever and can never block a merge (PRs #328/#307); and a guard that scans more than its trigger
  watches reports **stale verdicts** — the 2026-07-31 domain-ownership incident, where fixing
  `HANDOFF.md` did not re-run the check and `main` stayed red on an already-corrected failure.
  `scripts/check-domain-ownership.mjs` enumerates every tracked text file including `docs/**`, so a
  docs-only PR is precisely the case that must still be scanned. Do not re-propose this without
  reading §5.2 first.
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
- **Starting a refactor without checking for an open PR on the same file — the most expensive
  mistake of this session.** On 2026-08-20 I measured `AGENTS.md` at 234 KB, opened #1331 and split
  it in #1336. **PR #1212 had been open since 2026-08-19 doing the same job and doing it better** —
  78 KB (under the ceiling) versus my 122 KB, plus the `HANDOFF.md` pointer conversion that also
  closes #1083. My merge left it `CONFLICTING`. `AGENTS.md` §6 is literally titled *How to tell if a
  change is already in flight* and I did not run it. **One `gh pr list --repo u2giants/shared-db
  --state open` filtered on the file would have caught it**, and the checkout even contained a
  `.claude/worktrees/docs-slimming` directory for that branch. Before touching any shared document,
  list open PRs that touch it.
- **Recording ColdLion's answer without checking what it explains elsewhere.** Her prepack
  explanation was filed against the quantity question, and it also silently answered the *line
  identity* question that was blocking step 4. It took a second pass to notice. When an answer
  arrives, re-read the other open questions against it.
- **Applying a ruling wider than its evidence.** The 519/519 merch-group match covered *line-level*
  groups only. The first draft used it to justify dropping `subMerchGroup*`/`ppkMerchGroup*` too,
  which are a different grain and which our own history-shape doc calls the better record. Grok
  caught it. Nothing was lost because no code was written, but under D5 it would have been a
  permanent discard of seven years of assortment taxonomy.

## 6. Open items for the next session

1. **Start at step 1 of the plan** — supersede the design doc for the 2026-08-19 rulings.
   Documentation only, and it unblocks steps 2-6, which are independent of each other.
2. ✅ **Step 4a is DONE.** The `orderHistory` line key is resolved and is **not** a blocker any
   more: **line = `(salesOrderNo, itemNo, labelCode)`, component = `+ subItemNo`.** The unlock was
   ColdLion confirming that **`linePrice` is per COMPONENT, not per line**, so rows that looked like
   conflicting duplicate lines are one line's components priced individually. Verified on 1,671 rows
   across 8 windows 2019-2026. Full reasoning in
   [`../docs/coldlion-history-endpoints-shape.md`](../docs/coldlion-history-endpoints-shape.md) §4.4.
   **Do not re-derive this.**
3. **The Grok review is DONE** — REJECT on the first draft, three real defects, all verified and
   corrected. Do not re-run it on the same draft. Session `coldlion-phases-2-6-plan-review`; resume
   with `ai-grok-review ask` rather than starting a new one. Cost $0.24.
4. **Waiting on ColdLion** (register [`../docs/coldlion-open-questions.md`](../docs/coldlion-open-questions.md), §2):
   - **2.8** where invoiced/open quantity actually lives — JamieLynn is consulting her team.
   - **2.2** blank component merch groups. Her "expected for older stuff" does **not** fit: 624 rows
     across 2019-2023 have **zero** blanks, then 2024 is 11.7% and 2025 is 16.1%. Sample set is in
     the register, ready to send.
   - **2.6** licence expiry flag — asked once, never answered.
   - **2.10** expose `Line #` and `Prod Stage` in the API. Both exist inside ColdLion; neither is in
     the spec. Not blocking; we work around both.
5. **The item sync is still broken** — `403` since 2026-05-21, out of scope for this plan, actively
   losing data. Albert has seen it and has not scheduled it. Raise it again if this plan runs long.
6. **Issue #1322** — the DB Data Admin control to mark a property inactive. Must ship **with** the
   66-code admission, not after it. No schema change needed: `core.property.status` already accepts
   `inactive`.

## 7. Where the evidence lives — and what is NOT kept

Measurements are split across three files. Do not look for all of them in one place; an earlier
version of this section pointed only at the plan and would have sent a reader to the wrong file.

| Finding | Where it is recorded |
|---|---|
| The original 7 findings (division in the feed, wrong item key, 519/519 merch-group match, 26% orphan order lines) | §6 of [`../docs/plan_coldlion-landing-phases-2-6.md`](../docs/plan_coldlion-landing-phases-2-6.md), each with the method to re-derive it |
| **`linePrice` is per component**, and the sales-order line/component keys, verified on 1,671 rows | [`../docs/coldlion-history-endpoints-shape.md`](../docs/coldlion-history-endpoints-shape.md) §4.4, with the worked example |
| **Blank component merch groups by year** — 624 rows 2019-2023 with zero blanks, 2024 11.7%, 2025 16.1% | Register entry 2.2 in [`../docs/coldlion-open-questions.md`](../docs/coldlion-open-questions.md), with the sample orders |
| Every field's fill rate, per feed | [`../docs/coldlion-field-decisions-20260819.csv`](../docs/coldlion-field-decisions-20260819.csv) |

⚠️ **The raw API samples are NOT kept.** The 1,671-row `orderHistory` sample and the 2,088-row
`prodHistory` sample lived in a session scratchpad that is deleted when the session ends. Only the
conclusions survive. **To re-derive any of the above you must re-pull**, which is cheap for master
feeds and costs one request per 7-day window for the history feeds. The method is in each record
above; the numbers were never taken on faith.

⚠️ **The marked-up CSVs Albert filled in are NOT in the repo** — this repository is **public** and
the sample columns carry licensor names, item descriptions, vendor email addresses and customer
names. They are in Albert's Dropbox under `ai/`. The committed
`coldlion-field-decisions-20260819.csv` is the same decisions with every sample value stripped.
Do not commit the originals.

## 8. Delete this file when

Steps 1-7 of the plan are done and its STATUS table shows every row complete with an artifact. If
the plan is abandoned instead, say so here with the reason before deleting.
