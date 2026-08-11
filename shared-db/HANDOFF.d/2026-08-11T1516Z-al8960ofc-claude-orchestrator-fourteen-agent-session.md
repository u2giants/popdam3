# Orchestrator handover — session d152a272, 2026-08-11

**Machine:** al8960ofc · **Marker issue:** [#739](https://github.com/u2giants/shared-db/issues/739)
**Session ran:** 2026-08-11, roughly 01:30Z to 15:20Z · **Sub-agents dispatched:** 16

> **Read this first if you are picking up cold.** The single most important thing this
> session found is in §7 and it overturns the framing of the whole Cloud SQL programme:
> **Supabase `dflow` is not a stale copy of DesignFlow's database. It is a LIVE database
> with an application connected to it right now, writing to it.** Every migration plan
> written before 2026-08-11 assumed otherwise. Do not act on any of them without reading
> §7 first.

---

## 0. Moving facts, stamped

Re-derived from `git`/`gh` at **2026-08-11T1516Z**. Everything here goes stale within the
hour — re-derive, do not trust.

| Fact | Value |
|---|---|
| `origin/main` tip | `e1fd1a3d9503fa718097b89541d83709612ca118` |
| Migration files on main | 433 |
| Max migration version | `20260811070000` |
| **Production ledger** | **376 applied**, max applied `20260810140000`, **APPLIED OUT OF ORDER** |
| Production unapplied | **53 total** — 50 inside batches B3..B9, 3 in no batch at all |
| Preview ledger | 426 rows after this session's single bounded apply |
| Open `db-work` issues | 103 |
| Open `needs-albert` issues | 19 |
| Open `db-claim` issues | 0 — all four closed at handover |

**A high max version does NOT mean everything below it is applied.** Production's ledger is
out of order in both directions, and so is preview's. This has misled at least three
sessions.

---

## 1. What this session was asked to do

Albert opened it with two goals:

1. Get the shared database ready to accept **all four licensors' scrapes in production**
   (Disney/OPA, Paramount, NBCU/Universal, Warner/STARLABS).
2. Take **the next step in moving DesignFlow from Cloud SQL to supabase.com**.

Mid-session he added five named workstreams (Paramount schema review, PopDAM OrderList,
Master Data / Product Depth, data.designflow.app, and "every issue with nothing blocking
it"), then two more (DCP Vault redesign, NBCU asset-to-franchise), and finally challenged
the practice of filing issues instead of finishing work — which changed how the rest of the
session was run. See §9.

---

## 2. What actually happened — the headline results

**PRODUCTION WAS WRITTEN ONCE.** Batch B2 applied: `20260728171500`, `20260728174500`,
`20260728181500`. Ledger 373 → 376. That is the only production write of the session.

**Ten PRs merged:** #742, #743, #746, #747, #750, #751, #752, #753, #755, #756, #759, #760,
#761, #762. (Fourteen — count them from the merge list, not from this sentence's opener.)

**Sixteen issues closed**, several because they described work finished days earlier and
were actively misdirecting fresh agents.

**Preview was written once**, deliberately and narrowly: migration `20260811030000` only,
ledger 425 → 426.

---

## 3. Coordination state (handover half (a))

### 3.1 Open PRs at handover

Both were being merged as this file was written; **verify their state, do not trust this
table.**

| PR | What | State at 1516Z |
|---|---|---|
| #746 | Batch B2 production evidence | merging |
| #751 | data.designflow.app production release path, gated shut | merging |

### 3.2 File ownership — ALL RELEASED

No agent holds an exclusive file lock at handover. `supabase/migrations/`, `HANDOFF.md` and
`AGENTS.md` are all unowned. **Two agents were still running when this file was written**
(§4.15, §4.16); both are read-only and own no files.

### 3.3 Migration versions allocated this session

| Version | Workstream | Status |
|---|---|---|
| `20260811030000` | Paramount lossless landing | **used**, merged in #752, applied to preview |
| `20260811040000` | PopDAM OrderList | **allocated, NEVER USED — free for reallocation** |
| `20260811050000` | DCP Vault Phase 2 metadata landing | used, merged in #756 |
| `20260811060000` | DCP Vault Phase 2 chunked loader | used, merged in #756 |
| `20260811070000` | NBCU asset-to-IP-family | used, merged in #761 |

**Never let an agent choose its own version from `now()`.** Two agents dispatched in the
same minute pick the same number and one migration is then silently skipped. That has
happened twice historically. Every version above was allocated by the orchestrator.

### 3.4 Preview state — NOT clean, and stated honestly

Preview `rjyboqwcdzcocqgmsyel`:

- Ledger **426** rows. This session added exactly one: `20260811030000`.
- Still missing four migrations that are on main: `20260810140000`, `20260810180000`,
  `20260810190000`, `20260810190100`.
- **Preview's ledger is out of order.** `20260810140000` sorts BELOW preview's ledger head
  (`20260810170000`, already applied there), so a bare `supabase db push` refuses the whole
  queue and exits 1.
- **Preview and production have diverged IN BOTH DIRECTIONS**, verified by object:
  preview holds all 23 `plm.pmt_*` tables and production holds ZERO, while `20260810140000`
  is applied on production and not on preview. **Neither environment predicts the other.**
  Any rehearsal claim resting on "preview is production minus N" is wrong.

### 3.5 The bounded preview lane — new this session

PR #762 (merged) gives the preview job a **named allowlist**, reusing
`scripts/production_migration_guard.py` unchanged against preview's own ledger. Before this,
the preview lane could only apply *everything pending* or nothing — which is why one agent
had to temporarily move four other workstreams' migration files out of its worktree to get
a single migration in. **Use the lane now; do not repeat that manoeuvre.**

---

## 4. Every sub-agent, separately (handover half (b))

### Agent: startup summarizer (read-only)
- **Asked to do:** produce a decision-ready picture of licensor production readiness and the Cloud SQL cutover.
- **Actually did:** delivered an ordered dependency list, contradiction list, and a first-six dispatch recommendation.
- **Found:** the #674 "HARD GATE" was already discharged; batches B2..B9 had never run; three migrations belong to no batch at all.
- **Worktree:** none (read-only). **Finished.**
- **Deliberately did NOT do:** resolve the contradictions it flagged — it reported them for the orchestrator to re-derive from `git`, correctly.

### Agent: preview/production observer (read-only)
- **Asked to do:** establish the real production ledger position and whether licensor tables exist.
- **Actually did:** confirmed 373 applied, listed all 56 unapplied files by name, proved zero licensor landing tables in production.
- **Found:** the ledger is applied OUT OF ORDER — the fact that has since misled several documents.
- **Worktree:** none. **Finished.**
- **Deliberately did NOT do:** query preview — the MCP is production-bound and it refused to go hunting for credentials. Correct.

### Agent: app-tolerance contract (#721) → PR #742, MERGED
- **Asked to do:** correct three stale claims in `docs/production-promotion-app-tolerance-contract.md`.
- **Actually did:** corrected all three; touched `scripts/post_batch_app_verification.py` in **comment strings only**.
- **Found:** **the harness was already correct — no assertion changed.** So no false PASS was possible during B2..B9. The stale side was the document. Also found PopDAM's size picker is NOT running on the hardcoded `COMMON_SIZE_OPTIONS` as claimed — `core.product_size` is absent from production so tier 1 errors and it runs on **TIER 2: `public.style_groups.size_name`, 316 distinct free-text values**. That is why the old B8 eyeball check ("does it look like a short generic list?") could never have detected the failure.
- **Worktree:** `.claude/worktrees/issue-721` — **finished, safe to clean.**
- **Deliberately did NOT do:** items 3 and 4 of #721 (the swallowed error in popdam3, and a mechanical contract-vs-code drift check). **#721 remains OPEN for those two.**

### Agent: CI test wiring (#731, #695) → PR #741, MERGED
- **Asked to do:** make two merged-but-never-executed test suites actually run in CI.
- **Actually did:** wired both. **308 Python tests now run and pass** (including the 141 that had never executed). 40 SQL contract files execute against a from-empty ephemeral database.
- **Found — the biggest structural finding of the session:** replaying all 429 migrations into an empty database **applies 363 and fails 66**, because this repo was adopted on top of an already-populated database. `public.assets`, the legacy popdam tables and the `dflow.*` mirrors exist in preview and production with no migration here creating them. 26 of 40 contract files were quarantined as a result.
- Also closed a hole on its own initiative: a stale quarantine line now **fails** the job, and a quarantined-but-passing file **warns** — otherwise the quarantine list rots into a graveyard.
- **Worktree:** `.claude/worktrees/issue-731` — **finished.**
- **Deliberately did NOT do:** auto-wire `post_batch_app_verification.py` as a post-apply step. Correct call — its own tests were hours old and automating an untrusted check is worse than not automating it.

### Agent: Cloud SQL R5 reconciliation (#734) → PR #743, MERGED
- **Asked to do:** write down the cited-but-missing "R5" owner ruling and reconcile it against `SUPABASE-MIGRATION.md`.
- **Actually did:** wrote `docs/owner-ruling-r5-core-is-source-of-truth.md` (clause by clause, each tagged **[QUOTED]** or **[INFERRED]**) and `docs/r5-vs-supabase-migration-reconciliation-20260811.md`.
- **Found:** **R5 EXISTS IN NO FILE AND NO COMMIT.** Searched the full tree and full history (`git log --all -S"R5" --pickaxe-all`) plus the retired `COORDINATOR_INTAKE.md` at three revisions. Six citations, zero sources — and **the two earliest were written FOUR MINUTES APART on 2026-08-03**, so everything since may descend from one afternoon. Also: `SUPABASE-MIGRATION.md` (in `popcre/designflow-backend`, blob `24c9cdc4`, 347 lines) **never mentions `dflow.*`, never mentions `core.*`, and never says DesignFlow's copies are preserved** — the "lift-and-shift, `dflow.*` preserved" framing is an AI restatement, not its text. The real conflict is only about which move goes first.
- Also found a live **naming collision**: `AGENTS.md` §6.10 has its own numbered "ruling 5" (a different ruling, "STOP THE DATA LOSS FIRST", `AGENTS.md:1603`), and a third numbering exists at `AGENTS.md:1357`. Three schemes, one label. **Retire the label `R5` in favour of a name.**
- **Worktree:** `.claude/worktrees/issue-734` — **finished.**
- **Deliberately did NOT do:** open the supersession PR against `popcre/designflow-backend`. It is DRAFTED only, and should be a short dated pointer rather than a rewrite — and only after Albert rules.

### Agent: batch B2 production apply → PR #746
- **Asked to do:** stage and apply production batch B2.
- **Actually did:** applied it, after **three** staging attempts (see §8). Verified by object AND behaviour.
- **Found:** both documented traps cleared. The string-patch migration **landed** — `api.db_data_admin_licensor_property_tree` went 13,802 → 14,888 chars, `division_name` 0 → 6 occurrences. Behavioural proof: division code `8` now resolves to **"Spruce Lic"**, a real name. Both data-repair blocks were clean no-ops and wrote no audit row. Harness: PopCRM/PopDAM/PopPIM all PASS.
- **Also found:** the advisory model-review step reports **"NOT RUN — ANTHROPIC_API_KEY is not configured on this repository"** and is `continue-on-error`, making it a **permanent silent no-op on every production apply**. A green apply run does NOT mean a model reviewed the migrations. **#709 stays open.**
- **Worktree:** `.claude/worktrees/batch-b2` and `batch-b2-restage` — **finished.**
- **Deliberately did NOT do:** click the approval gate, though the local `gh` is authenticated as Albert and could. Correct — an approval relayed through an agent is not his action on the gate that exists to require it. Also did not start B3.

### Agent: Paramount lossless landing (#724) → PR #752, MERGED
- **Asked to do:** owner-authored spec — convert source IDs `bigint`→`text`, add a lossless repeated-metadata table, rebuild views, fix the loader and the private builder.
- **Actually did:** all of it. Migration `20260811030000` merged and **applied to preview**. Private builder committed to `licensor-source-data` as `6925627` on branch `codex/paramount-creative-library-20260807`, producing **150,430 metadata values**, deterministic (two runs byte-identical), 0 banned fields.
- **Found — the best catch of the session:** its predecessor's draft rewrote `plm.validate_pmt_capture` from scratch. `create or replace function` swaps the WHOLE body, so that would have **silently deleted 12 of 13 finalization checks** and renamed six manifest populations whose names the loader emits — failing every finalization forever while looking fine. It rebuilt from the original text and proved checks 1–13 byte-identical.
- **Found:** the spec's own §4 was wrong. Production has **ZERO** `plm.pmt_*` tables; `20260810020000`, `20260810090000` AND `20260810180000` are all unapplied. Preview, by contrast, has all 23 tables with both prerequisites applied.
- **Worktree:** `.claude/worktrees/pmt-lossless` — **finished.**
- **Deliberately did NOT do:** apply to production (owner gate). Did not load the 150,430 values — blocked on `PMT_PORTAL_GLOBAL_ASSET_COUNT`; see §6.

### Agent: PopDAM OrderList (#727) → PR #750, MERGED
- **Asked to do:** Step 3, the idempotent preview import.
- **Actually did:** built `scripts/import-order-list-xlsx.py` (~1,950 lines) and 78 synthetic tests, all passing. Production ref refused unconditionally — there is no flag that turns production writes on.
- **Found:** **the Google source sheet has been edited since the approved snapshot.** 12,323 rows today against the 12,328 baseline; neither the whole-workbook nor the single-tab export matches SHA-256 `4958B4B7…FC6ABBE4`. The checksum gate refused it, correctly.
- **Worktree:** `.claude/worktrees/issue-727-orderlist` — **finished.**
- **Deliberately did NOT do:** run the real import. **#727 stays OPEN.** Migration version `20260811040000` was never used.

### Agent: order-sheet version history (read-only, browser)
- **Asked to do:** find what the five-row edit was.
- **Actually did:** established version history IS on and goes back to July; four people edit the sheet (Yuchen Zhou by far the most, then Fabiola Rivas, Jack Safdieh, Adam Dweck); the most recent edit (2026-08-10 18:52, Yuchen Zhou) was a single-row two-column change, **not a deletion**.
- **Found:** Google's version viewer would not render the older versions of this heavy 16-tab workbook — two to three minutes of spinner each, repeatedly. **Could not identify the five-row edit.**
- **Worktree:** none. **Finished.**
- **Deliberately did NOT do:** guess from the row count. Recommended a row-level diff against the approved snapshot instead — but **that snapshot exists nowhere**, so the practical next step is a targeted question to Yuchen Zhou.

### Agent: Product Size & Depth / B8 (#597) → PR #753, MERGED
- **Asked to do:** continue Phase 1, prepare B8, build the Product Depth grid, provision Carlos.
- **Actually did:** Product Depth grid built and **visually verified** against preview through a real browser — add, rename, activate, deactivate, plus both guards firing. Wrote the B8 runbook with 14 post-apply checks.
- **Found two defects only visible by looking:** the detail form was unreadable because the stacked-label CSS rule was only ever written for the modal selector (`.editor > label`) while Product Depth's form lives in `.detail-panel` — every caption rendered *beside* its input. And the test harness could never complete (fixed test code, a filter box that only exists once opened, a locator resolving to RevoGrid's invisible header pin).
- **Found:** the remote branch `feat/597-product-size-depth-phase1` is a **stale pre-merge branch, 93 commits ahead** of its local. It renamed rather than force-pushing. **Left that branch untouched.**
- **Corrected itself:** it reported `src/lib/config.test.ts` red on main. **That was wrong** — its own `.env.local` was leaking `VITE_` variables into the test environment. It withdrew the claim after CI passed. The orchestrator had already relayed it to another agent and had to retract.
- **Worktree:** `.claude/worktrees/b8-product-size-depth` — **finished.**
- **Deliberately did NOT do:** apply B8 (blocked — B3..B7 unrun and unapproved). Did not hand-insert an `app_access` row for Carlos.

### Agent: data.designflow.app launch (#729) → PR #751
- **Asked to do:** the production launch of DB Data Admin.
- **Actually did:** built the gated deploy path, made the workspace label environment-driven, created Coolify app **`zeoy8qfjqffu8ym533cc7dl4`** in the production environment **with fqdn EMPTY** (approved by the orchestrator as a zero-exposure staging proof).
- **Found — the blocker:** production `app.app_access` has **ZERO admin rows** (crm 27 active / 4 revoked, dam 3, pm 2, admin 0). Every DB Data Admin RPC calls `app.require_db_data_admin_access()`, so **every screen returns Access denied for every user, Albert included.** The fix is `20260810050000`, unapplied.
- **Found — DNS is a non-issue:** `data.designflow.app` ALREADY resolves to the Coolify VPS `178.156.180.212`. The 503 is Traefik with no route. There is **no DNS change to make**; the single irreversible step is attaching the fqdn.
- **Found — two near-misses:** Coolify silently attached a public `sslip.io` domain it never requested (stripped immediately; that hostname now 404s), and `POST /envs` returned HTTP 422 **while creating the record anyway**, so its retry made duplicates.
- **Proved access control against production:** anonymous → 401 on all three RPCs; the dedicated production test account (identified by its `app.profile` UUID per `AGENTS.md` §6.14 — the address is deliberately not written here), which **holds the administrator role but has `app_access = pm` only**, → 403 on every contract. That is the strongest form of "a role alone is not sufficient".
- **Worktree:** `.claude/worktrees/issue-729-launch` — **finished.**
- **Deliberately did NOT do:** attach the fqdn (Albert's call alone). Did not sign in as a real user to prove the authorized-administrator case — that one needs a human.

### Agent: DCP Vault Phase 2 (#748) → PR #756, MERGED
- **Asked to do:** execute the private 49 KB redesign plan.
- **Actually did:** built 10 tables and 9 functions across `20260811050000` and `20260811060000`. **All three DCP contract files now execute and PASS in CI from empty** — including the 860-line `dcp_vault_landing_contracts.sql` that had never run in its life.
- **Found:** the plan is **NOT stale** (unlike #712/#674/#579) — it was written as an additive Phase-2 on top of the merged Phase 1. But its STATUS table says "Nothing in this plan has been implemented", which is wrong and would make the next agent rebuild Phase 1. Corrected in the private repo as `a7cfc90`.
- **CI caught four real defects**, the best being a success CHECK that was **impossible to satisfy**: it required `normalized_hash`, a digest specified to read back STORED values, which cannot exist until after the row is stored. Both in-place fixes were traps.
- **Worktree:** `.claude/worktrees/dcp-redesign` — **finished.**
- **Deliberately did NOT do:** touch `plm.dcp_asset_row_hash` (the one-way door). Did not edit the promotion contract doc. Did not apply to preview.

### Agent: NBCU asset-to-franchise (#757) → PR #761, MERGED
- **Asked to do:** owner-authored spec — add the missing Asset-to-IP-Family relationship.
- **Actually did:** `plm.nbcu_asset_ip_family` as the 17th NBCU table, migration `20260811070000`. Replaced `finalize_nbcu_capture` by slicing the original **byte-for-byte** out of `20260810070000`, applying two additive edits mechanically, then **round-tripping**: removing the additions reproduced the original exactly at 8,294 bytes.
- **Pushed back correctly on an orchestrator instruction:** told "add the counts, change nothing else", it added block `F2` because the spec separately requires rejecting an unresolvable IP Family LABEL — which the count check cannot deliver, since the FK proves the KEY resolves, not the label. **Orchestrator upheld it.**
- **Found a spec error:** the expected 16→17 edit to `docs/production-promotion-app-tolerance-contract.md` is **unnecessary** — both "16" figures are window-scoped statements describing the state between `070000` and `080000`. Editing them would have made the doc wrong.
- **Worktree:** `.claude/worktrees/nbcu-asset-ipfamily` — **finished.**
- **Deliberately did NOT do:** apply to preview (argued convincingly that CI-from-empty is stronger proof). Did not touch `scripts/`.

### Agent: backlog sweep → PRs #747 (merged) + triage
- **Asked to do:** classify all 129 open issues, then finish the READY ones.
- **Actually did:** delivered the full triage, and fixed #593, #669, #670, #671, #609, #672, #540 in PR #747.
- **Found — a live defect that mattered:** `versionsOnDisk()` in `check-dispatch-collision.mjs` was **exported but never called**, so `--version` was never compared against migrations already in the checkout. Verified: `--version 20260810140000` now exits 1; before the fix it cleared.
- **Ran a differential** of the pre- and post-change guard over all 429 real migrations: **0 differences**, proving the guard changes could not affect the in-flight B2 promotion. Verified, not assumed.
- **Worktree:** `.claude/worktrees/backlog-sweep` — **live, may have uncommitted Tier-A work.** CHECK BEFORE CLEANING.
- **Deliberately did NOT do:** #672 item 1 (ledger-aware co-presence) — it changes PASS/FAIL for the Warner batch. Did not retire any worktree.

### Agent: hygiene cluster → PR #760, MERGED
- **Asked to do:** finish 13 tooling and doc issues.
- **Actually did:** finished 8 (#654, #530, #550, #549, #533, #547, #534, #688), proposed 3 for closure (#540, #564, #545).
- **Found — the most serious defect of the session:** the **orchestrator marker query in the `shared-db-orchestrator` skill was the only labelled `gh issue list` missing `--repo u2giants/shared-db`.** That skill loads into sessions working in OTHER repos. Without `--repo`, `gh` queries whatever repo you are in, **exits 0**, and returns zero markers — **indistinguishable from a clear board. A second orchestrator would start while one was live.** Fixed, and #654's new drift check now fails CI if any skill regrows it. Pushed to `ai-devops` as `a700b48`.
- **Refused to do #545** (`.gitattributes` / force LF) and was right: the defect it was filed for is already fixed (10/10 on Windows with `core.autocrlf=true`), only ONE committed blob contains CR, and shipping it would re-normalise **1,010 of 1,038 files across 46 live worktrees** — several holding uncommitted agent work.
- **Worktree:** `.claude/worktrees/hygiene-cluster` — **finished.**
- **Could not do #688's last step:** the CLI pin is asserted in `docs/verification/**`, owned elsewhere. Checksums recorded: `supabase.exe` `da4948c1…` (the pin), `supabase-go.exe` `9aedef98…`; **both print 2.105.0**, and `supabase-go.exe` emits an update notice the other does not — exactly what breaks a literal-string parser.

### Agent: from-empty baseline (#754) → PR #759, MERGED
- **Asked to do:** finish the issue rather than document it.
- **Actually did:** **quarantined files 26 → 11. Contract tests passing 14 → 29. From-empty replay failures 66 → 10.** Built `supabase/ci-bootstrap/010_pre_adoption_baseline.sql` (126 tables, 509 grant/RLS statements, **zero rows**) and `020_test_fixture_seed.sql` (all synthetic, `.invalid` emails, workflow fails on any other domain).
- **Chose a CI-only bootstrap over a migration** — correct: a file at the front of an applied sequence cannot re-run, and a back-dated version is exactly what Guard B stops. **Allocated no migration version.**
- **Its own fixture broke a passing test** (`core.licensor` is `unique nulls not distinct (code)` — the seed took the single NULL slot). Fixed properly.
- **Found 3 candidate REAL defects** among the remaining 11: tests whose fixtures contradict the current schema, e.g. `db_data_admin_read_contracts` builds an orphan property with `licensor_id = null` against a column that is now `NOT NULL`. **Recorded, not edited into passing.**
- **Worktree:** `.claude/worktrees/issue-754-baseline` — **finished.**

### Agent: bounded preview lane → PR #762, MERGED
- **Asked to do:** give preview a named-allowlist apply lane.
- **Actually did:** reused `production_migration_guard.py` **unchanged** against preview's ledger. Two independent ref checks (is preview / is not production) before any credential. Proved all six refusal cases offline **without touching a database**, by extracting the inline Python from the YAML and executing it.
- **Found:** the ban on `--include-all` is a **plain-text search**, and prose is not exempt — its own explanatory comment failed the test. Fixed in its own file, not by loosening the assertion.
- **Widened a safety assertion with orchestrator approval** and mutation-proved it: flag in `validate` → FAILS; preview push moved out of the bounded checkout → FAILS; unmutated → 308/308 pass.
- **Worktree:** `.claude/worktrees/preview-bounded-lane` — **finished.**

### Agent: Paramount rights reconciliation (read-only)
- **Asked to do:** determine whether the capture contains assets for unauthorized properties.
- **Actually did:** compared the capture against Albert's authoritative 35-property list.
- **Found — the licensing answer is CLEAN:** **zero unauthorized assets.** All 33 searched properties are inside scope. Names like PAW Patrol (12,235 in the portal facet) appear in the capture ONLY as co-tags on assets pulled for an authorized property — standalone count **0** for all 25 such names.
- **Found — the real problem is the opposite:** the capture was driven by a **stale `licensed-title-scope.csv` of 26 titles** that does not match the current 35. It contains South Park, MTV Logo, The Untouchables, Roman Holiday and Breakfast at Tiffany's (none authorized, none found) and **OMITS Garfield and Invader Zim entirely** — so roughly **8,076 authorized assets were never captured** (Garfield comic 6,986; Invader Zim 858; The Garfield Movie 232).
- **Solved the CBS/Pictures puzzle by arithmetic:** Albert's facet screenshots had a **Nickelodeon brand filter active**. Proof: SpongeBob facet 16,801 = our Nickelodeon-only count exactly, against a total of 16,818. Three properties, three exact hits on the filtered number.
- **Worktree:** none. **Finished.**

### Agent: GLM 5.2 consult (read-only)
- **Actually did:** got GLM's answer first try, no hang.
- **GLM picked Option A** (platform move first). Its strongest original point: **A is the only option that does not depend on the missing R5 ruling**, so it can start before R5 is found.
- **Where GLM was wrong, caught by the agent:** it **invented a table name** (`dflow.sample*`, never in the brief) and **assumed the direction of the three-object gap**. Both were later disproven — see §7.

### Agent: Kimi K3 consult (read-only)
- **Actually did:** confirmed model pin `kimi-code/k3`. Kimi picked a hybrid on Option A's spine and **rejected B and C by name**.
- **Kimi's best original point:** the "three objects" figure is a **SCHEMA** measurement and says nothing about whether the ROWS match. It built its whole plan around that gap and was right to.
- **Where Kimi was wrong, caught by the agent:** its rename-swap would have **quarantined live Sample Tracking data**, which exists only on the Supabase side by deliberate ruling (#707).

### Agent: dual-database feasibility (read-only)
- **Asked to do:** test Albert's own proposal — leave Cloud SQL intact, correct the Supabase table, repoint DesignFlow per table.
- **Found:** it works for **five tiny lookup lists** (`itemDepth`, `itemSize`, `FOBCountry`, `ProductCategory`, `age_group`) and **not** for anything that matters. Licensor, Property, Style Guide, Age Group, Art Type and Artist are all rows in **ONE table, `merchGroup`**, joined **ten times** into the Item Library grid query and **eight times** into Art Library, where they drive filtering, row count and paging.
- **Confirmed the age-group trap:** `art_piece.age_group_id` has an enforced FK to **`merchGroup`**, not `age_group`. `age_group` has **2 rows and zero inbound FKs**.
- **Found a genuine middle path** worth carrying forward: make Supabase the AUTHOR and Cloud SQL a FOLLOWER via one-way sync. DesignFlow's code changes not at all; every join and FK keeps working.

### Agent: dflow writer + row-diff verification (read-only) — **THE CRITICAL ONE**
- See §7. This agent's findings overturn the programme framing.

### Agent: copy timing and rehearsal design (read-only) — reported at 1522Z
- **Asked to do:** measure real table sizes, prove or disprove that `AuditLog` is append-only, give an honest window estimate, design (not run) a preview rehearsal, settle whether hosted Supabase permits inbound logical replication.
- **MEASURED SIZES:** `AuditLog` is **399.6 MB of 542 MB — 73.7%**. Everything else is **142.6 MB across 102 tables**. Only **16 non-AuditLog tables exceed 1 MB**; 86 are effectively free. All 186 indexes total **33.9 MB**, of which 20.9 MB is outside AuditLog — **index rebuild is not the bottleneck anyone feared.**
- **`AuditLog` IS append-only — proven three independent ways.** (1) The entire `designflow` schema has **ZERO triggers**; `AuditLog` has exactly one constraint and one index, both the PK, and no FK points at it. (2) Every write in all five backend repos is a `create` — there is no `.update`, `.destroy`, `.upsert`, no raw `UPDATE`/`DELETE`, and no retention job. (3) ids are **perfectly dense**: count 580,711, min 1, max 580,711. Not one row deleted in ~3.7 years.
- **THE CORRECTION THE PLAN NEEDS — the high-water mark must be on `id`, NOT on `actionDate`.** 32,823 rows (5.6%) have an `actionDate` EARLIER than the row before them by id, because timestamps are written by the application, not the database. A tail copy keyed on `actionDate > cutoff` would **silently miss thousands of rows**. Keying on `id > N` is correct AND fast — `AuditLog_pkey` is the only index and is exactly the right one; `actionDate` has no index and would force a 400 MB sequential scan.
- **HONEST WINDOW: ~18 to ~65 minutes, and NOT ONE SECOND OF IT HAS BEEN TIMED.** The only measured quantities are byte and row counts. The circulating 10-to-60-minute figure has no measurement behind it, and neither does this one. **The low end is not credible and the high end is not proven.** Two terms dominate and both are unmeasured: the 142 MB restore, and the checksum gate. A naive row-level checksum over AuditLog means a full 400 MB scan plus detoasting ~92 MB. **Recommendation:** checksum the 142 MB transactional set fully; gate AuditLog on `count(*)` plus `min(id)`/`max(id)` plus a tail hash — defensible precisely because the density check proves the history is gapless.
- **The tail is tiny:** at ~1,700 audit rows/day and ~755 bytes/row, a **one-week** tail is roughly **9 MB**.
- **LOGICAL REPLICATION: permitted on Supabase, but DO NOT USE IT.** GLM was right that presence is not capability, and the capability is genuinely there — `wal_level = logical`, 10 slots, 10 wal_senders, and role `postgres` is a member of `pg_create_subscription`. **The blockers are on the Cloud SQL side:** it needs `cloudsql.logical_decoding=on`, which **RESTARTS the production instance** Albert does not administer; it needs Supabase's egress address added to a production allowlist; and it copies neither sequences nor DDL, so the freeze and the 97 `setval` fixes remain anyway. **Verdict: side with Kimi against GLM.** Two production infrastructure changes including a restart, to shave 20–40 minutes off moving 142 MB, is a bad trade.
- **REHEARSAL DESIGNED AND NOT RUN**, for preview, scratch schema `zz_rehearsal_cutover_20260811`, nine phases, reversible by one `DROP SCHEMA … CASCADE`. Needs ~550 MB temporary space plus WAL. **Its single highest-value cheap answer:** building the `productUserAssignment (item, role)` unique constraint — if that fails, production has duplicate pairs and reconciliation step 1 blocks the entire cutover.
- **Worktree:** none (read-only). **Finished.**
- **Deliberately did NOT do:** run the rehearsal, or connect to Cloud SQL. Flagged that a **rehearsal part 2** is still needed — a timed `pg_dump`/restore — or the window keeps a large unmeasured term.
- **Also found, not blocking:** `audit.service.js` **swallows write failures** into a `console.error` and returns. Audit rows can be silently lost.
- **Could not answer:** what happens to the **580,711 AuditLog rows already sitting in Supabase `dflow`**. The plan does not say, and this must be decided before pre-staging starts.

---

## 5. What is blocked on Albert — 19 issues, and the ones that matter today

**The one that changes everything:** *is DesignFlow already pointing at Supabase, in whole or
in part?* An application is definitely connected and writing to `dflow` (§7). Nobody can tell
whether it is production, the sandbox, or something else. **If production is already partly
there, this is not a migration project — it is a half-finished one nobody documented.**

Also outstanding:

1. **Did Albert ever make the R5 ruling?** Four plans rest on it; no record exists.
2. **The 400 MB `AuditLog`** — Albert ruled 2026-08-11 that the **full history IS carried
   across**. SETTLED, recorded here so it is not re-litigated.
3. **TMNT scope** — Albert ruled 2026-08-11 that the licence covers **all TMNT series**,
   not just the classic. The 523 assets under the 2003 and "World Of" labels are
   **authorized and stay**. SETTLED.
4. **The three missing Paramount properties** — Albert approved scraping Garfield comic,
   Invader Zim and The Garfield Movie 2024. **He then reassigned the scrape away from this
   session** ("Paramount scrape is not for you to do, i assigned the proper agent"). Do not
   dispatch it.
5. **Two machines need `sync my dotfiles`** run on them: `916` (was powered off) and `4837`
   (never checked). Only Albert can.
6. **The fqdn attach for `data.designflow.app`** — his call alone.

---

## 6. Half-finished, and exactly where

| Item | State |
|---|---|
| **Paramount 150,430-value load** | Blocked on `PMT_PORTAL_GLOBAL_ASSET_COUNT`. See below. |
| **PopDAM OrderList real import** | Blocked on the changed source sheet. Code and 78 tests merged. |
| **B8 (Product Size/Depth)** | Runbook written, apply blocked behind B3..B7. |
| **data.designflow.app** | Built, gated shut, blocked on `20260810050000` reaching production. |
| **DCP Vault preview apply** | Never done; CI-from-empty passes, so it is optional confirmation. |

**On `PMT_PORTAL_GLOBAL_ASSET_COUNT`:** the loader requires a portal-wide asset count the
operator observed. It appears in **seven places**, all of which store or display it — it
touches **no validation, no reconciliation, no count check**. Albert has never seen such a
number in the portal, and the facet screenshots show only per-brand and per-property counts.
Summing the eight brand buckets gives 46,955 but is **wrong**: 223 assets carry more than one
brand, and there is an `undefined` bucket of 108. **Do not invent a value.** Either get the
unfiltered results-header total, or redefine the field as `library_view_asset_count` and
record it as not-observed with the reason in `PMT_NOTES`.

---

## 7. THE FINDING THAT OVERTURNS THE PROGRAMME

Verified read-only against production `qsllyeztdwjgirsysgai` on 2026-08-11.

**Supabase `dflow` is NOT a stale copy of DesignFlow's database. It is a live database with
an application connected to it right now.**

- **193,591 inserts into `itemAttachment`** since the stats epoch (2026-07-02 restart), 206
  into `AuditLog`, 105 updates on `RFQVendor`, 88 on `users`. **28 tables show write
  activity.**
- `pg_stat_statements` shows **thousands of Sequelize-shaped ORM queries** —
  `grid_cell_notes` 5,833 calls, `INSERT INTO "dflow"."AuditLog"` 203 calls, `UPDATE
  "dflow"."Factory"` 91 calls. That is DesignFlow's Node backend.
- **The app runs DDL on every boot**: ~30 distinct `ALTER TABLE "dflow".<t> ADD COLUMN IF
  NOT EXISTS …` plus `CREATE TABLE IF NOT EXISTS` for `ai_cache_events` and `app_settings`,
  each called 90–140 times. **This is the Sequelize startup-migration pattern the shared-db
  rules explicitly forbid** — `dflow`'s structure is being changed from application code,
  outside shared-db, continuously.
- Fresh rows: `sample_movement` 2026-08-10, `itemHeader` 2026-08-07, `AuditLog` 2026-08-07.
- **No `pg_cron` job touches `dflow`** — all 9 cron jobs work on `public.*`. The writer is
  an application, not the database.

**So it is NOT safe to load Cloud SQL data into `dflow`.** All three migration plans —
GLM's, Kimi's and the copy-first plan — would have destroyed live data.

**The data is divergent, not stale.** `itemAttachment`: **214,058 rows on Supabase against
~20,384 on Cloud SQL — ten times.** That is a different dataset, not drift. The whole
`sample_*` family is **0 bytes on Cloud SQL** and populated on Supabase.

**Supabase-native, must NEVER be clobbered** (5 tables, 5 views, 4 functions, 3 triggers, 4
columns): `sample_import_job`, `sample_import_row`, `sample_movement`,
`sample_shipment_line`, `sample_stop_closeout`, and their views/functions/triggers.
`sample_movement` was written **yesterday**.

**TWO LIVE BUGS, unrelated to any migration, biting on the next insert:**

- `dflow.LicensingTime` — max id **24**, sequence at **2**.
- `dflow.properties_and_characters` — max id **10,458**, sequence **never used**.

All other 63 sequence-backed tables are correctly positioned.

**The three-object direction was BACKWARDS.** All three objects
(`productUserAssignment_item_role_key`, `idx_dflow_rfqitem_style_number_normalized`,
`RFQVendor_item_vendor_summary_idx`) **already exist on Supabase and are missing on Cloud
SQL**. GLM built its step 1 on the opposite assumption and the orchestrator relayed it. The
real risk is the reverse: **Cloud SQL has 542 MB of `productUserAssignment` data that has
never been checked against a uniqueness rule Supabase already enforces.** That check has NOT
been run and needs a live Cloud SQL read.

---

## 8. WHAT WE TRIED THAT DID NOT WORK — MANDATORY

1. **Approving a production run while merges were flowing. Failed TWICE.** The apply is
   pinned to an exact `origin/main` SHA. Both times, PRs merged between staging and Albert's
   click, and `Verify exact main commit` refused before any credential was used. **Nothing
   was written — the guard worked.** It only landed on the third attempt, under a deliberate
   merge freeze. **Freeze merges before every production apply.**
2. **Telling agents preview is `xjcyeuvzkhtzsheknaiu`.** That was in an owner-supplied spec
   and is **wrong**. Preview is `rjyboqwcdzcocqgmsyel`, confirmed three independent ways.
3. **`supabase db push` against preview.** Fails with "Found local migration files to be
   inserted before the last migration on remote database" because `20260810140000` sorts
   below preview's ledger head. `--include-all` would sweep four other workstreams'
   migrations. One agent worked around it by temporarily moving foreign migration files out
   of its worktree — it worked, but **use the bounded lane (PR #762) instead**.
4. **Relaying an unverified "main is red" report.** An agent reported
   `src/lib/config.test.ts` failing; the cause was its own `.env.local` leaking `VITE_`
   variables. The orchestrator dispatched another agent to fix a non-existent bug before the
   retraction arrived. **Identical files plus a different result means the ENVIRONMENT
   differs, not the code.**
5. **Filing issues instead of finishing work.** Albert challenged this directly and was
   right. #754 was written up as a tidy issue and parked; when actually dispatched it took
   quarantined tests from 26 to 11. **Only two legitimate stops exist: an owner decision, or
   a real dependency.**
6. **Trusting GLM's and Kimi's claims.** GLM invented a table name and assumed the direction
   of the three-object gap. Kimi's rename-swap would have quarantined live Sample Tracking.
   Both were caught only because the dispatching agents were told to verify.
7. **Asking Albert to verify B2 on `data-dev.designflow.app`.** Wrong twice: the screen is
   the **Properties** tab (the "licensor property tree" is an internal function name he would
   never see), and **data-dev points at PREVIEW while B2 applied to PRODUCTION**. The change
   is not there and never will be.
8. **Reading the order sheet's version history.** Google would not render the older versions
   of a 16-tab workbook — 2–3 minutes of spinner each. Turning off "Highlight changes" did
   not help.
9. **A six-agent simultaneous session-limit kill.** All six died mid-run at once. Every
   worktree survived; only **uncommitted** work was at risk. Transcripts were gone, so none
   could be resumed — each needed a fresh agent briefed on the surviving files. **Tell every
   agent to commit often.**

---

## 9. Facts here that may already be stale

Everything in §0 (SHAs, counts, PR states) was true at **2026-08-11T1516Z** and this repo
has gone stale within the hour. **Re-derive from `git`/`gh`; do not trust this file.**

Specifically suspect: the two PRs in §3.1 were mid-merge as this was written; the two agents
in §4.15/§4.16 were still running; the open-issue count of 103 excludes the handover issues
seeded at closeout.

---

## 10. Worktrees

**`.claude/worktrees/backlog-sweep` is LIVE and may hold uncommitted Tier-A work. CHECK IT
BEFORE CLEANING ANYTHING.** Its agent was mid-way through the READY list.

All others named in §4 are finished and their PRs merged — safe to retire under the
`cleanup-worktree` skill. **Nothing was deleted this session, deliberately**: 46 worktrees
exist, several belong to other sessions, and issues #682 and #528 asking for retirement were
left alone precisely because agents were live in them. That was a decision, not an oversight.

---

## 11. Secrets sweep

**Swept, nothing new.** No credential appeared in chat, in a file, in a commit or in an
untracked file this session. Agents used 1Password vault `vibe_coding` serially by item ID
(preview DB password `qbvfk7umc3n75ejekd65zwd4ty`, Supabase CLI PAT
`3t2xoqk5luyz7ffgdhj24gvtpq`, plus a Coolify token) and injected them as environment values
only. No value appears in any artifact.

**Two licensed files were downloaded and then deleted** at Albert's instruction:
`OrderList.xlsx` and `OrderList - Order.xlsx` from `C:\Users\ahazan2\Downloads`. Confirmed
gone.

**The PII forward guard caught THREE PRs** heading into the public repo with a real
company email address — two sub-agents' PRs, and **this handover file itself**. All three
were fixed by removing the address and referring to the person by `app.profile` UUID per
`AGENTS.md` §6.14. None was fixed by loosening the guard or applying the `pii-guard-allow`
label. Worth noting that the orchestrator wrote the third one while documenting the first
two: the guard is load-bearing, not ceremonial.

---

## 12. Documentation pass

- `AGENTS.md` and `HANDOFF.md`: **not touched** by this session, and no agent owned them.
- **Superseded, not rewritten:** `docs/production-promotion-app-tolerance-contract.md` §3.2
  and §7.2/B8 now carry the corrected tier-2 finding (PR #742).
- **Void evidence:** none identified. No rehearsal was invalidated by a migration this
  session.
- **New standing facts that belong in `AGENTS.md` and are NOT there yet** — seeded as an
  issue at closeout:
  1. Preview and production have diverged in both directions; neither predicts the other.
  2. The advisory model review is a permanent silent no-op without `ANTHROPIC_API_KEY`.
  3. The migration history is not self-contained; a from-empty replay needs the CI bootstrap.
  4. Freeze merges before every production apply.
- Otherwise: **docs pass — nothing outside this handover is stale.**
