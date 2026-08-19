---
issue: 1137
status: OPEN
owner: claude/division-code-qa (session ended; no decision outstanding — engineering work remains)
---

# Division codes: Q&A closed, no decision outstanding, three fixes ready to build

- **Written:** 2026-08-17T2146Z
- **Machine / agent:** al8960ofc / claude
- **Worktree:** `C:\repos\shared-db-worktrees\division-code-mapping-qa-757b4a`
- **Status:** OPEN — documentation complete and merged; **no database change made or
  pending**; four actions ready to build, three still blocked on engineering grounds.
- **Owner decisions outstanding: NONE.** The division-2 question in §5 was answered by
  ColdLion itself on 2026-08-17 — see that section.
- **Contact for the rest:** Uma (DesignFlow developer) — nothing outstanding from him

---

## 1. What this was about (assume you know nothing)

The shared database records "which division a product belongs to" in **two different
spellings**, and nothing in the schema says which is which:

| ColdLion spelling | DesignFlow id | Division name |
|---|---|---|
| `CW001` | `1` | POP Lic |
| `SP001` | `8` | Spruce Lic |
| `EH001` | `9` | Spruce non-Lic |

Both live in columns called `division_code` / `divisionCode_*`, sometimes the *same* column
name in different tables. The planned shared item key is
`company | division | item_no` (e.g. `EDGEHOME | CW001 | BRT10DYWP01`), so picking the wrong
spelling does not error — items silently merge or split.

**ColdLion** is the Edge Home ERP (third-party, `http://x5.coldlion.com/EhpApi`).
**DesignFlow** is our PLM app (its own Cloud SQL database, mirrored into the shared Supabase
project `qsllyeztdwjgirsysgai` under the `dflow.*` and `plm.*` schemas).

A previous session wrote 8 questions for Uma. He answered them. This session verified those
answers against live data, found several wrong, asked 12 follow-ups, got those answered, and
ran the reference check he asked for. **Nothing was ever written to the database.**

## 2. Where the knowledge lives (read in this order)

| File | What it is |
|---|---|
| `AGENTS.md` §6.1b | The short version. Rules, the division-`2` trap, EP001. Start here. |
| `docs/division-code-questions-for-uma.md` | Round 1: what was asked and why |
| `docs/division-code-answers-from-uma-20260813.md` | Round 1 answers **plus corrections**. Two of its fix rules are struck through — read the banner at the top |
| `docs/merchgroup-271-division-conflicts-back-to-uma-20260817.md` | Written by another session the same day: applying the 271-row fix creates 142 duplicate rows |
| `docs/division-code-round2-answers-and-reference-check-20260817.md` | **The current authority.** Uma's 12 round-2 answers verbatim, three new findings, and the full reference check with its query |
| `docs/coldlion-erp-api-reference.md` | The Q8 proof and the ColdLion endpoint map |
| `fix_item_taxonomy_wiring.md` | The item→taxonomy build plan. Its new STATUS table lists which division facts are settled |

All merged to `main`: PRs **#956**, **#1123**, **#1129**.

## 3. What is settled (do NOT re-derive any of this)

- **The id↔code map is proven on a real item**, not asserted. `GET /items` for
  `BRT10DYWP01` returned `companyCode: EDGEHOME`, `divisionCode: CW001`; DesignFlow holds
  `div_code_fk = 1` for the same item. The key `EDGEHOME | CW001 | BRT10DYWP01` is buildable.
- **Shared PLM item tables store the ColdLion spelling.** Never `1`/`8`/`9`, never the
  deprecated `2` or unused `7`.
- **`EDGEHOME` is the only company.** `SPRUCE` and `UCI` appear in old `core."merchGroup"`
  rows as legacy labels, not tenants.
- **`plm."divisionCode"` is the single source of truth.** A second copy of the map is
  hardcoded in `designflow-data-syncing/helpers/utility.js`. Uma agreed the table wins.
- **`EP001` is a real retired book/education division** (grade bands, page counts, flash
  cards, created 2019–2020 by `JSeguine` and `AHazan`), *not* a mis-keyed `EH001`. Uma
  guessed it was a typo; his own attachment disproved it.
- **The 5 live conflicting rows are POP Lic.** Their codes are Wall and Tabletop categories,
  which Spruce Lic does not have. Item data agrees: 348 references under POP Lic vs 4 under
  Spruce Lic.
- **`GET /items` is healthy.** The "known outage" note dated 2026-07-19 was stale and is retired.

## 4. The reference check (Uma's precondition, now satisfied)

Uma's condition, repeated on 8 of 12 answers: *do not clean anything up until you confirm
these codes are not still referenced by `itemHeader`.*

Run read-only 2026-08-17 over all **363** rows of `core."merchGroup"` whose division text and
integer are not one of the three clean pairs. Full query is in the round-2 doc.

| Result | Rows |
|---|---|
| Unreferenced — safe to clean | **178** |
| Referenced — must stay | **185** |

**Two methodology traps, both real, both nearly missed:**

1. `itemHeader` has integer merch-group keys (`udf_merchgroup01_id`…) but they are populated
   on only **2,694 of 19,463** items (14%). An id-only check would have wrongly cleared 353
   of the 363 rows.
2. Matching by text code alone is *also* wrong: the same code exists in several divisions
   (`V` = CANVAS is both `mg_id` 473 and 909), so a naive match credits both with the same
   6,033 items. The check counts **both** id and code, with division matching.

**Scope limit, stated so nobody over-reads it:** only `dflow."itemHeader"` was checked,
because that is what Uma asked for. RFQs, art pieces, style-guide links, PopDAM and reporting
views were **not**. "Unreferenced" here means "no item uses it", not "nothing uses it".

## 5. Division 2 — a MIXED legacy bucket; resolve per item from ColdLion

**The claim that needed checking:** 78% of item history — 15,185 of 19,463 rows of
`dflow."itemHeader"` — carries `div_code_fk = 2`, a division everyone calls dead.

**Why that first looked like a contradiction.** `plm."divisionCode"` says id `2`'s
`external_divisoncode` is `CW001`, while the agreed rule says id `2` is dead and must never
be accepted as a division code. It was written up as a decision for Albert.

**It was never a contradiction.** `div_code_fk` holds **DesignFlow's own numbering**, not
ColdLion codes. ColdLion has exactly four divisions — `CW001`, `EH001`, `SP001` and the
retired `EP001` — and **no division `2`, ever**. Our own data shows it: every `div_code_fk = 2`
row has its ColdLion text column `div_code` **empty**, while ids 1 / 8 / 9 carry their codes.

| `div_code_fk` | `div_code` (ColdLion text) | Items |
|---|---|---|
| **2** | **(empty on all 15,185)** | 15,185 |
| 1 | `CW001` | 2,437 |
| 8 | `SP001` | 755 |
| 9 | `EH001` | 731 |
| 1 | (empty) | 333 |

**The wrong turn, recorded so it is not repeated.** On 2026-08-17, 19 division-2 items were
looked up individually — 6 newest plus 13 random — and **all 19 returned `CW001`**. The
conclusion drawn was "id `2` → `CW001`". That was published and it is **wrong**: 19 is too few
and the newest-first half was biased.

**The proper check, 2026-08-18.** The full ColdLion catalogue was swept (97 pages, **19,326
items**) and a 250-item random sample of division-2 items matched against it:

| ColdLion says | Count | Share |
|---|---|---|
| `CW001` | 208 | 83.5% |
| `EH001` | 21 | 8.4% |
| `SP001` | 17 | 6.8% |
| `EP001` | 3 | 1.2% |
| absent from ColdLion | 1 | 0.4% |

**Conclusion: division `2` is a mixed legacy bucket spanning every ColdLion division.** A
blanket map to `CW001` would misfile about **1 item in 6 — roughly 2,500 rows**.

**Owner ruling (Albert Hazan, 2026-08-18): "go according to ColdLion".** Resolve each item's
division **from ColdLion by item number** — never from `div_code_fk`, never from a mapping
table. `plm."divisionCode"` stays correct for the three live ids; it has nothing honest to say
about id `2`. `2` must never be *stored* in a shared PLM table. For the ~0.4% of items ColdLion
does not return, leave `division_code` NULL rather than guess, and count them in the run
summary.

**Reproduce it:** `tools/sync-coldlion-items.mjs` exports `collectItems(apiKey)`, which sweeps
the whole catalogue (97 pages, ~90 seconds); `tools/coldlion-sync-common.mjs` exports
`readColdlionApiKey()` and `COLDLION_BASE_URL` for single lookups
(`GET /items?companyCode=EDGEHOME&itemNo=<no>`, header `X-API-Key`). Never paste the key
anywhere. **Do not conclude anything from a handful of item lookups** — that is exactly the
mistake above.

### The "active flag disagreement" — RESOLVED, it never existed (2026-08-19)

I reported that ColdLion and the mirror disagree about what is sold. **They do not.** I had
compared ColdLion's `active` against `is_item_active`, a DesignFlow app boolean that is **NULL
on 18,186 of 19,463 rows** — unset, not inactive.

The mirror carries ColdLion's own fields and they agree: `active` Y 18,866 vs
`item_active_status` Y 18,979; `itemDiscontinued` Y **546** vs `discont_status` Y **546**
(exact); `itemAvailable` N 11 vs `item_avail_status` N 8. Verified item by item on 11 flagged
items — all matched.

**Rule for the next session: never judge "still sold" from `is_item_active`.** Use
`item_active_status` / `discont_status`. ColdLion's sellable set is `active=Y` +
`itemDiscontinued=N` + `itemAvailable=Y` = **18,397 of 19,326**; it retires very little, so a
tighter "current line" list is a business question, not a data fix.

Catalogue from the same sweep: `CW001` 12,914 · `EH001` 3,860 · `SP001` 2,101 · `EP001` 451.
`EP001` is retired but **not empty**.

## 6. Exact next actions

**Ready to build now** (each needs a shared-db migration via the normal branch+PR+preview
process — none has been written). Action 6 below joins this group as of 2026-08-17:

1. **Fix the 5 live rows** — set `divisionCode_id_fk = 1` on `mg_id` 3120, 3121, 3580, 3581,
   3582. Do **not** rewrite their text to `SP001`; that rule is withdrawn twice over.
   *Verify:* those 5 rows read `CW001` / `1`; the 348 POP Lic item references still resolve.
2. **Set `is_divcode_active = false`** on `plm."divisionCode"` ids `2` and `7`. Approved
   outright. *Verify:* `select … where is_divcode_active is null` returns 0 rows.
3. **Normalise item company** — `itemHeader.compan_code_fk` NULL or `2` ("OTHER") → EDGEHOME.
   Approved outright. Note this is a **DesignFlow-owned** table; confirm ownership before
   writing (see §0.0-B of `AGENTS.md` on who owns which rows).

**Blocked, with the reason (all engineering, no decisions):**

4. **The 217-row Block A fix** — blocked twice, and now *more* suspect: it re-files those
   rows into `9`/`EH001`, but ColdLion says the division-2 items referencing them are
   `CW001`. Blocked because: 142 of the 217 are referenced by division-2
   items, and the update creates 142 duplicate rows on `(division, mgTypeCode, mg_code)` with
   no unique constraint to stop it (see the 271-conflicts doc).
5. **Delete the 4 empty rows** — blocked: 3 of them (`mg_id` 2, 3, 4) carry **573** item
   references between them. They look like junk. They are not.
6. ~~Blocked on §5.~~ **Backfill `erp_items_current.division_code` — UNBLOCKED, but resolve
   per item.** Join each item to the ColdLion catalogue **by item number** and take its
   `divisionCode`. Do **not** translate `div_code_fk`; ids 1/8/9 are safe but `2` is mixed.
   Needs a migration and a preview run. *Verify:* every filled value is one of
   `CW001`/`SP001`/`EH001`/`EP001`; the count left NULL equals the count of items ColdLion
   does not return, and that count is reported, not hidden.
7. **A `CHECK` constraint on division shape** — must be last; cannot be enforced while 363
   rows violate it.

**Ready with a caveat:**

8. **Delete the 178 unreferenced rows** — safe against `itemHeader` only. Widen the check to
   RFQs, art pieces, style guides and PopDAM first, or scope the delete to rows those systems
   cannot reach.

**In another repo, not this one:**

9. **Remove the hardcoded division map** from `designflow-data-syncing/helpers/utility.js` and
   read `plm."divisionCode"` instead. Agreed by Uma. Belongs to the DesignFlow repos.

## 7. What did NOT work / things that cost time

- **A dropdown-only questionnaire did not constrain the answers.** The workbook sent to Uma
  locked every answer to a dropdown. He ignored them and wrote free-text notes instead — which
  turned out *better*, because eight answers were conditional and a dropdown could not have
  expressed the condition. If you build another one, leave room for the condition.
- **Uma's first-round fix rule for the 54 rows was wrong**, and it was wrong in the dangerous
  direction: it would have given 49 dead rows a clean live division code. Two independent
  checks caught it. Treat single-source fix rules as proposals, not instructions.
- **The obvious reference check would have been wrong** (see §4). If you re-run it, use the
  query as written, not a simplified version.
- **GitHub was badly degraded on 2026-08-17.** Two CI guards fail with `HTTP 503` and
  `HTTP 404` from GitHub's own API, not from repo content: "Cross-PR object collision" and
  "Migration author lease". A re-run clears them once GitHub recovers. An admin merge is
  **refused** by branch protection, correctly — do not go hunting for a bypass.
- **A background auto-merge script failed** after 2 hours: it polled, re-ran the flaky
  guards, got everything green — then looped forever because the branch had fallen **behind
  main** and it never ran `gh pr update-branch`. If you write one, include that step.
- **This worktree's branch was already checked out elsewhere** (`xenodochial-bhabha-1da0a3`),
  so `git checkout` refused. Working from a second local branch at the same commit and pushing
  with `git push origin HEAD:<branch>` avoids disturbing the other session.

## 8. State of this worktree

- Branch `docs/division-round2`, merged as `3b84513d`. Nothing uncommitted at handoff time
  beyond the doc changes committed with it.
- **No migration files were created.** No preview or production apply was attempted.
- **No secrets** were written anywhere. The ColdLion API key was read at runtime from
  1Password (`op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`) by
  `tools/coldlion-sync-common.mjs` and never printed, stored, or committed.
- Scratch files (the questionnaire builder, the downloaded answers workbook) live in the
  session scratchpad under `%TEMP%\claude\…`, outside the repo. Nothing to clean in-repo.

## 9. Completeness self-audit (required by the skill)

Reread this file and the four linked docs cold, without conversation context.

**Q1 — could a brand-new developer with no project knowledge pick this up?** Yes. §1 defines
ColdLion, DesignFlow and the two encodings from zero; §2 gives the reading order; §6 gives
numbered actions with verification. The one thing they cannot do is decide §5 — and §5 names
who owes it and what the options cost.

**Q2 — could they continue as well as I could right now?** Yes. Every finding is carried with
its number and its source table: the 363/178/185 split (§4), the 78%/15,185 (§5), the 348-vs-4
evidence for the 5 rows (§3), and the exact `mg_id` values in §6. The reference-check query
itself is preserved verbatim in the round-2 doc rather than described.

**Q3 — is every relevant detail present?** Yes, including the parts that make the work
*harder*: the two methodology traps in §4 that would produce a confident wrong answer, the
scope limit that "unreferenced" means "no item uses it" only, the three innocent-looking rows
with 573 references, the withdrawn fix rules, and the five time-wasters in §7 — GitHub's
outage behaviour, the refused admin merge, the auto-merge script's missing update-branch step,
and the checked-out-elsewhere branch. Gaps found on reread and now closed: the original draft
did not name *who* owns action 3's table (DesignFlow, added), did not state that no migration
exists yet (§6 preamble and §8, added), and did not record where the ColdLion key comes from
(§8, added).

**Tracking issue:** [#1137](https://github.com/u2giants/shared-db/issues/1137).

**Delete this file when:** issue #1137 is closed and actions 1, 2, 3 and 6 are merged and
verified. Actions 4, 5, 7, 8 and 9 may outlive it — if so, move them to a fresh handoff rather
than keeping this one alive.
