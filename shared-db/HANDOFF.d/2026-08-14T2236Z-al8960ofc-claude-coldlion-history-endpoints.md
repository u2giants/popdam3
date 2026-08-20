---
issue: 1031
status: OPEN
owner: al8960ofc/claude-coldlion-history-endpoints-13b4f3 (session ended)
---

# ColdLion history endpoints (`prodHistory` / `orderHistory`) — shape probed, loader NOT built

**Written:** 2026-08-14T2236Z · **Updated:** 2026-08-17 (same session — ColdLion answered two
questions; see §0) · **Machine:** al8960ofc · **Agent:** claude · **Status:** OPEN

## 0-B. UPDATE 2026-08-19 (later) — NOTHING IS BLOCKED ANY MORE

ColdLion answered the last two open questions. Both verified.

1. **"all The stages are: ISS, INTRAN, REC."** The list is authoritative and closed — nothing is
   being silently missed. All three carry real rows. `INTRAN` had looked dead (0 rows in four
   windows) but returned **129 rows for 2024-07-01**; it is transient, so a few quiet weeks are not
   evidence of an unused stage. **The historical pull is 3 stages × ~370 windows for `prodHistory`
   plus ~370 for `orderHistory` — about 1,480 requests, not 740.**
2. **`AMA030` is Amazon, and Amazon production is stock**, made for their warehouse rather than
   presold, so it has no customer PO. That was the last unexplained group of unlinked rows
   (10 of 10 unlinked, verified). Rules §8.

**Four distinct causes of `salesOrderNo = 0` are now documented**, and they are economically
different — samples (no revenue ever), Amazon stock (revenue later), historical rows and
`INTRAN`/`REC` lines (linked in reality). A report treating them alike is wrong three ways.
**Do not infer stock production from `prodTypeCode`:** `Stock*` rows are 92% linked.

**Residual, tiny:** 6 unlinked lines out of 803 in 2024+ non-`COS` non-Amazon data (0.7%), three of
them quantity-1 charge-like lines. Not worth chasing.

**State of the work:** the shape is fully documented and every blocking question is answered. What
remains is building the loader, which is another session's job (issue #1031), and Albert sending a
short courtesy note that blocks nothing.

## 0-A. UPDATE 2026-08-19 — READ THIS FIRST: the feed is bigger than this handoff says

Three ColdLion answers (JamieLynn, via Albert) and the follow-up probing changed the picture again.
**Everything below §0-A is still true but no longer sufficient.**

**The one that matters: `GET /prodHistory` without `stageCode` returns ONLY the `ISS` (issued)
lines.** `stageCode=REC` returns **receipt** lines that appear nowhere in the default response —
zero key overlap across four windows. Order 22717 ordered 4,800 (`ISS`) and received 4,548 (`REC`),
and only the first half was visible. **A load built on the default response has no receipts in it
and looks complete.** The stage is not in the payload; the loader must stamp it from the request.
Full evidence, method and reproduction:
[`docs/verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](../docs/verification/coldlion-prodhistory-stage-discovery-20260819/README.md).

Also now answered and documented (all verified live, all in
[`docs/business-rules-erp-data.md`](../docs/business-rules-erp-data.md)):
- **§6** `merchGroup*` = assortment SKU, `ppkMerchGroup*` = component SKU. The **assortment** groups
  are the blank ones on prepack rows; never fall back to them.
- **§7** `lineInvoiceQty` is not carried at component level; use `unshippedQty` / `linePickQty`.
  **`lineOpenQty` is NOT always zero** — an earlier claim in this repo was sample-limited.
- **§4–§5** `salesOrderNo = 0` has three causes: age (hard-linking began ~2022–2023), stage (the
  link never carries down to `INTRAN`/`REC`), and `COS` samples.

**Every open ColdLion question is now in one register:**
[`docs/coldlion-open-questions.md`](../docs/coldlion-open-questions.md). The blocking one is the
authoritative list of `stageCode` values.

**Another session has drafted the landing schema** — `docs/coldlion-raw-landing-schema-design.md`.
It predates the stage finding, so this session added a correction block at its top: it needs a
`stage_code` column and a stage-aware fetch plan. **Its keys do not collide across stages**, which
makes the omission silent rather than loud — totals would simply be double-counted.

## 0. UPDATE 2026-08-17 — the blocker is GONE, and a new constraint arrived

ColdLion acted on the note's first two questions before it was even sent. Albert relayed both;
**both are verified live** and merged into
[`docs/coldlion-history-endpoints-shape.md`](../docs/coldlion-history-endpoints-shape.md).

1. **`prodLineSeq` added to `prodHistory`, and the fan-out fixed at source** (they now select the
   maximum `lastProdDate`). Row identity is `(prodOrderNo, prodLineSeq, prepackItemNo)`. The old
   ambiguity described in §4 below **can no longer occur**. Verified: `prodLineSeq` on 1,475/1,475
   rows across nine 7-day windows; order 23825 dropped from 8 rows to 4.
2. **A hard 7-day window cap on both endpoints** (`fromDate`–`toDate` within 7 days inclusive),
   ~2s per window from their office, ~0.1–1.4s from here. **Month-wide calls now fail**, which
   invalidates the fetch pattern used for the original census.

**What this changes for the next session:** §4 below is now history, not instruction — do **not**
build the quantity-comparison heuristic it describes. §3.2's requirement list is superseded by
§3 and §4.3 of the shape doc, which carry the 7-day arithmetic and the current dedupe rule. The
malformed error contract on the cap (HTTP 400 on the wire, `"status": 500` in the body) is a real
trap for retry logic and is documented in §2 of the shape doc.

The remaining questions to ColdLion have been rewritten accordingly: the two answered ones are
removed, and **nothing left in that note blocks the load**.

**Tracking issue:** [#1031](https://github.com/u2giants/shared-db/issues/1031) — carries both open
actions. **Owners:** Albert (send the note to ColdLion) and the next AI session (build the
puller). Neither is blocked on the other.

**Note on the issue number:** this session made no structural database change, so no orchestrator
issue was required for the work itself. #1031 exists because the repo's handoff-contract guard
(`scripts/check-handoff-contract.mjs`) requires every `HANDOFF.d/` file to name a bare issue
number, and because the open work genuinely needs a tracker. Close #1031 when the puller is
built and proven.

---

## 1. Background — what this is and why anyone cares

POP Creations runs its merchandise business on a third-party ERP called **ColdLion**
(`x5.coldlion.com`), which Albert does **not** administer. ColdLion exposes a read API
(`/EhpApi`) that we already use to sync customers, vendors, items and merch-group taxonomy into
the shared Supabase backend (`qsllyeztdwjgirsysgai`).

On 2026-08-14 Albert reported that **two new endpoints** are now available to us:

- **`prodHistory`** — *purchase* history: orders **we placed with factories** to buy merchandise.
- **`orderHistory`** — *sales* history: orders **customers placed with us**.

These are the first endpoints that expose transactional history rather than master data. The
business goal Albert stated: **pull the full history in, in small chunks over a weekend, so as
not to disrupt anyone using the ERP.** That "do not disrupt" constraint is a real requirement,
not a nicety — see §5.

This session's scope was deliberately narrow and is now **complete**: query the endpoints,
learn the shape of the data, and write it down. **No loader was built. No database structure
was designed or changed.**

## 2. What was done, and where it landed

Everything is merged to `main` in `u2giants/shared-db`:

| PR | Contents |
|---|---|
| [#1020](https://github.com/u2giants/shared-db/pull/1020) | `docs/coldlion-history-endpoints-shape.md` (new), both endpoints added to `docs/coldlion-erp-api-reference.md` endpoint map + paging-exception warning, `docs/_drafts/coldlion-history-endpoints-questions.md` (new, unsent) |
| [#1028](https://github.com/u2giants/shared-db/pull/1028) | Records Albert's confirmation that `1900-01-01` is the empty-date marker; removed from the draft questions |

**Read [`docs/coldlion-history-endpoints-shape.md`](../docs/coldlion-history-endpoints-shape.md)
first.** It is the deliverable. This handoff does not repeat it; it covers what the doc cannot:
what is left, what was tried, and what nearly went wrong.

`AGENTS.md` §6 carries a short router entry pointing at that doc with the three traps, so a
future session hits the warning before writing a loader.

## 3. The two open actions

### 3.1 Albert: send the note to ColdLion (not blocked, not urgent)

`docs/_drafts/coldlion-history-endpoints-questions.md` is a **complete, unsent draft** for Albert
to review and send **in his own name** (an AI session must not email a third-party vendor).
It asks six questions, most important first. Only **Q1 is a true blocker** — see §4.

Do not send it as-is without Albert reading it. Do not include the API key, its 1Password
location, or internal system names; the draft's closing note says so.

### 3.2 Next AI session: build the chunked puller

**Not started.** No code exists. Albert's last words on it: *"Say the word and I will write it"* —
so treat this as approved in intent but **confirm scope with Albert before writing**, especially
how far back the history should go (see §6, unknown #1).

Requirements gathered this session, all evidence-backed in the shape doc:

0. **SUPERSEDED IN PART — read §0 first.** Items 1–3 below are now governed by the 7-day cap:
   windows are exactly 7 days, non-overlapping, and item 5's dedupe rule is replaced by the
   `prodLineSeq` identity rule. Items 4 and 6 stand unchanged.
1. **Chunk by date window only.** No paging exists (§4.2 of the shape doc).
2. **One request at a time. Never parallel.** Response times ranged from under 1s to **51s**
   unpredictably. Parallel fan-out against a slow window is exactly how we would disrupt their
   users, which is the one thing Albert asked us not to do.
3. **Per-request timeout ≥120s**; pause ~3s between requests (used throughout probing, no
   complaints).
4. **Run as a background task that writes each chunk to disk as it lands**, so a stall loses one
   window, not the whole run (global rule 9, and see §5 for how this bit us).
5. **Implement the §4.3 dedupe rule with a loud alert on the ambiguous case.** Silent
   collapse would erase real purchases; silent keep would double-count them. Global rule 11:
   no silent failures.
6. **Add unit tests** (global rule 13). `tools/*.test.mjs` in this repo is the established
   pattern; `tools/coldlion-sync-common.mjs` has `fetchPaged` and API-key handling to reuse —
   **but note `fetchPaged` is wrong for these two endpoints** (it assumes paging).

**Where structure goes:** any Supabase tables for this are a **structural change** and must be
authored in `u2giants/shared-db` through the orchestrator/issue workflow — never inline from an
app repo. This session deliberately produced **zero** schema.

## 4. (HISTORICAL — resolved 2026-08-17, see §0) The finding that mattered most

`prodHistory` returns the same `(prodOrderNo, itemNo, prepackItemNo)` more than once, for **two
different reasons that are indistinguishable in shape**:

- **Cause A (collapse):** same purchase, differs only in `last*` lookup fields. Verified on
  prod order **23825** / AAW2A02 — 8 rows for 4 components, differing only in `lastProdDate`.
- **Cause B (keep):** two real buy lines on one order. Verified on prod order **20907** /
  VSZ4803 / PPK1020 — 8 rows for 4 components, one set 1,600 packs, the other 3,000.

Measured: **261 repeated groups — 131 cause A, 130 cause B.** Almost exactly 50/50, so no blanket
rule is safe. **There is no line-number field** — confirmed against the live OpenAPI spec, not
assumed. The residual hole: two lines with *identical* quantities would be indistinguishable
from a duplicate. Not yet observed; nothing prevents it. That is why Q1 asks ColdLion for a line
number, and why the loader must alert rather than guess.

## 5. What did NOT work / went wrong this session

Recorded so nobody repeats it.

- **First curl attempts returned HTTP 400, not 401.** Cause: missing `X-API-Key`. The 400 status
  makes it look like a malformed request rather than an auth failure. The key is in 1Password,
  vault `vibe_coding`, item *"Coldlion ERP API key x5.coldlion.com"*, field `credential`; use it
  via `op run` / `op_run` with the `op://` reference and **never** paste the value.
  `tools/coldlion-sync-common.mjs` already encodes this.
- **I asked for `page=0&size=5` and got 265 rows back.** The endpoints accept and ignore paging
  params silently. This is how a future paging loop would spin forever.
- **The 1Password MCP `op_run` call timed out** on the 7-window census — the MCP has its own
  request cap independent of the `timeout_ms` argument. Fix that worked: run via the Bash tool as
  a **background task** with `COLDLION_API_KEY="$(op read '<op:// ref>')"` inline, writing to a
  log file. Do the same for the bulk pull.
- **I told Albert a wrong dedupe rule and had to correct it.** After a 10-day sample I concluded
  the repeated rows differ *only* in `lastProdDate` and could be collapsed. The 7-month check
  proved that true for only half of them. **Lesson: a 10-day window is not enough to characterize
  this data.** Anything asserted from one short window should be re-checked across years before
  it is built on.
- **Two `gh pr merge` failures worth expecting:** (a) squash-merging PR #1020 while keeping the
  branch made the branch conflict with `main` on the same files — resolved with
  `git checkout --ours` on the two docs (correct here because the branch content *was* main's
  content plus the new edits; verified with `git diff --stat origin/main` before committing);
  (b) `--auto` is **not enabled** on this repo (`Auto merge is not allowed`), and `main` moves
  fast enough that the branch went `BEHIND` twice. Merge `origin/main`, push, wait for checks,
  then merge — expect to repeat it.
- **A commit message came out mangled** because I used PowerShell here-string syntax (`@'…'@`) in
  the Bash tool. Use a `<<'EOF'` heredoc in Bash. Fixed by amending before push.

## 6. Unknowns — stated so nobody assumes coverage that does not exist

1. **How far back the history goes.** Earliest probed is **2019-06** and it returned data. No
   earlier boundary was searched. **This directly determines the size of the weekend pull and
   must be settled before building.** Now also asked of ColdLion directly (Q6 of the draft note),
   which is cheaper than scanning. If scanning: probe single 7-day windows going backwards
   (2015, 2010) and see where rows stop — **not** month windows, which are now refused.
2. **Whether repeated calls for the same window return the same rows.** Every window was fetched
   once. Nothing proves stability over time. **This matters for the recurring incremental sync,
   not the one-time load** — test it before designing the recurring lane.
3. **`stageCode`** (`prodHistory`) and **`divisionCode` / `salesOrderNo`** (`orderHistory`) filter
   params exist in the spec but were **never exercised**. The latter two are a possible second
   chunking axis if date windows prove too coarse.
4. Sample is 10 months of roughly 80. Patterns held across all seven census windows spanning
   seven years; exact percentages are indicative, not exhaustive.

## 7. Reproducing the probes

Scratch scripts used this session were written to the session scratchpad and are **not** in the
repo (deliberately — they were throwaway probes, and the findings they produced are in the doc).
To reproduce, the shape doc §2 gives the exact request contract. Minimal form:

```bash
COLDLION_API_KEY="$(op read 'op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential')" \
  node -e 'fetch("http://x5.coldlion.com/EhpApi/orderHistory?companyCode=EDGEHOME&fromDate=2026-01-01&toDate=2026-01-31",{headers:{"X-API-Key":process.env.COLDLION_API_KEY}}).then(r=>r.json()).then(j=>console.log(j.length))'
```

## 8. Repo state

Clean. Everything this session produced is merged to `main`. No untracked files, no pending
migrations, no uncommitted work. This worktree
(`C:\repos\shared-db-worktrees\coldlion-history-endpoints-13b4f3`, branch
`claude/coldlion-history-endpoints-13b4f3`) can be removed once this handoff is closed.

**Governance note:** this session was **not** the shared-db orchestrator and had no sub-agents.
It made **no structural database change** — documentation only, plus read-only calls to a
third-party API — so no orchestrator issue was required. If the next session builds tables for
this data, that **is** structural and must go through the orchestrator workflow.

## 9. Completeness self-audit (gate required by `session-docs-update`)

Re-read this file and `docs/coldlion-history-endpoints-shape.md` as if the session never happened.

**Q1 — could a brand-new developer with no project or session context pick this up without
skipping a beat?** Yes. §1 explains what ColdLion is, what the two endpoints mean in business
terms, and why the work exists, assuming no prior knowledge. §2 gives the merged PRs and points
at the deliverable. §3 names the two open actions, who owns each, and that neither blocks the
other. §7 gives a runnable command. The one thing they must not skip — the repeated-row trap — is
in §4 here, §4.3 of the shape doc, and `AGENTS.md`, so all three entry points lead to it.

**Q2 — detailed enough to continue as well as I could right now?** Yes. Every non-obvious thing
I learned is written down rather than held in context: the auth 400-not-401 quirk, the ignored
paging params, the `op_run` timeout workaround, the 50/50 duplicate split with both verified
order numbers, the four divisions, the always-zero quantity fields. §5 records the wrong
conclusion I reached from a short window and the general lesson, which is the piece most likely
to be repeated otherwise. §6 states the four unknowns and how to close the two that matter.

**Q3 — is every detail needed for flawless execution present?** Yes, with named limits.
Background §1; goal and intended outcome §1, §3.2; current state §2, §8; failures §5; decisions
(alert-don't-guess; no schema this session; Albert sends the vendor note) §3, §4; constraints
(one request at a time, ≥120s timeout, background+disk, orchestrator for structure) §3.2, §8;
risks (identical-quantity ambiguity §4; unknown history depth §6.1; unproven repeat-call
stability §6.2); exact next actions §3; verification evidence §2 (both PRs merged, all required
checks passed) and the sample sizes stated in the shape doc.

Gaps found on re-read and since fixed: the first draft omitted **who owns** each open action
(added to the header and §3), omitted that the probe scripts are **not** in the repo (added §7),
and did not say the loader work needs **scope confirmation from Albert** before starting (added
§3.2). No remaining gap known.

**Delete this file when:** the puller is built, tested and proven, and ColdLion has answered (or
Albert has decided to proceed without) the line-number question.
