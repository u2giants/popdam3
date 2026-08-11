# ORCHESTRATOR HANDOVER — session f3fbdd0a — al8960ofc — 2026-08-11T01:18Z

**Marker issue:** #714 (closed at the end of this session — a clean handover, not a dead orchestrator).
**Status:** OPEN. Read this whole file before dispatching anything.

You are reading this because you are the next orchestrator of `u2giants/shared-db`.
Assume you know nothing about this session. Everything you need is here.

---

## 0. THE 60-SECOND VERSION

The production promotion was frozen. It is not any more. Six PRs merged, each
independently reviewed, none self-merged on a subagent's say-so.

| # | What | Merged as |
|---|---|---|
| #715 | The HTTP 403 that froze the production promotion | `6578935` |
| #717 | PG17 MAINTAIN revokes on 39 tables + the plm default-privilege hole | `1913f08` |
| #722 | First-ever schema capture of DesignFlow production (Cloud SQL) | `2e3ae23` |
| #719 | Runnable post-batch app verification (Albert's D7 ruling) | `0a5bf04` |
| #723 | `AGENTS.md` §0.1-A.1 — the Cloud SQL read-gate exception | `f3a2d7d` |
| #726 | Disney DCP Vault landing schema (#665) | `960f45a` |

**The single most important thing on this page:** batch **B2** is now unblocked
and nobody has run it. See §3.

---

## 1. GROUND TRUTH — re-verified at 2026-08-11T01:18Z

Re-derive all of these yourself before you act. They go stale within the hour.

```
origin/main tip:        960f45a9de5857b761ddee653bf4cd66be80fe6d   (01:18Z)
max migration version:  20260810190100_dcp_vault_chunked_loader    (01:18Z)
duplicate 14-digit versions: NONE
open PRs:               #728 — NOT MINE, see §2
open db-claim issues:   NONE (all mine closed: #716, #725)
production ledger:      373 applied, ~53 remaining  (measured 2026-08-10, NOT re-checked at 01:18Z — treat as stale)
preview ledger:         425 applied, max 20260810170000 (measured 2026-08-10, NOT re-checked — treat as stale)
```

⚠️ **`git ls-tree origin/main` is the source of truth for the migration maximum,
NOT `ls supabase/migrations/`.** The shared checkout at `C:/repos/shared-db` is
sitting on a stale branch (see §6) and its working tree shows `20260810180000` as
the maximum. That is wrong. It cost me a confused minute; it will cost you more if
you allocate a version from it.

---

## 2. ⚠️ ANOTHER SESSION WAS LIVE IN THIS REPO — RESOLVED AT 01:20Z, READ THIS ANYWAY

> **UPDATE 2026-08-11T01:22Z, written before this file was merged.** PR #728
> **merged itself at 01:20Z** as `63d262e`, two minutes after I first saw it —
> which is the correct behaviour for a docs-only PR under the handover standard.
> **`origin/main` is now `63d262ef612520193cd1a4059beca6b097a74526`, not the
> `960f45a` quoted in §1.**
>
> I verified the thing I was worried about rather than assuming it was fine:
> the diff is **46 insertions and zero deletions**, it adds a new `## 0.0-A`
> owner ruling at line 86, and **my §0.1-A.1 survives intact at line 218** with
> its closure rule (`waives the read-only proof and nothing else`, catalog-only,
> no row contents, `pg_stats` excluded) and the "its own ruling from Albert"
> wording both present. **No clobber, no contradiction.** Issue #735 has been
> updated and can be closed.
>
> The section below is left as written because **the lesson in its last two
> paragraphs still stands and is not fixed by anything**.


At 01:17Z, one minute before I began this handover, **PR #728** appeared:

- **Title:** `docs(AGENTS): read-only inspection of the shared database is allowed from every app repo`
- **Branch:** `claude/global-ai-database-rules-44090f`
- **Worktree:** `C:/repos/shared-db-worktrees/global-ai-database-rules-44090f` (note: OUTSIDE `.claude/worktrees/`)
- **Files:** `AGENTS.md` only
- **State at 01:18Z:** open, `BEHIND` main

**I did not review it, did not merge it, and did not touch its worktree or
branch.** It is not mine. The handover rule is explicit that a docs-only PR is
merged by the session that wrote it, and that session is still running.

**What the next orchestrator must do:** claim the marker first (#714 is closed, so
the board should be clear), then establish whether that session is still alive
before doing anything with #728. If it is alive, leave it alone and coordinate. If
it is dead, ingest #728 as a handover and verify its claims against the repo
before merging.

**Why this matters more than it looks:** #728 edits `AGENTS.md`, and so did my
#723 (merged `f3a2d7d`). #728 was cut BEHIND main. Whoever merges it must confirm
it does not clobber or contradict the new §0.1-A.1. Two sessions editing
`AGENTS.md` unaware of each other is exactly the collision this repo's
single-writer rule exists to prevent, and the rule did not catch this one because
that session is outside my register.

---

## 3. THE CRITICAL PATH — batch B2 is unblocked and unrun

Production has had exactly two writes ever: the canary `20260810140000` and batch
B1 (11 migrations), both on 2026-08-10. Ledger went 361 → 362 → 373.

**B1 IS APPLIED. NEVER RE-APPLY IT.**

B2 was blocked on #709 (a 403) and on D7 (nobody assigned to the post-batch app
checks). **Both are now cleared.** Nothing else stands in the way.

**B2 = `20260728171500`, `20260728174500`, `20260728181500`.**

Two things the previous orchestrator flagged and I am carrying forward verbatim,
because they are still true:

1. `20260728171500` is the **highest-abort-probability migration in the whole
   backlog**. It string-patches a live catalog function body and references
   `plm."divisionCode"`, which nothing in the repo creates.
2. **#709 stays OPEN until a real production run proves the fix.** The User-Agent
   fix is merged and reviewed, but it has never executed against production. B2 is
   the proof. Do not close #709 on the strength of the merge.

**Run the app checks after it** — that is the whole point of #719:

```bash
export SUPABASE_ACCESS_TOKEN='<PAT: 1Password vibe_coding, item 3t2xoqk5luyz7ffgdhj24gvtpq, field credential>'
python scripts/post_batch_app_verification.py --batch B2 --project-ref qsllyeztdwjgirsysgai --output-dir artifacts/post-batch
```

---

## 4. WHAT EACH SUB-AGENT DID — one block per agent

Nine agents. Every "actually did" below was verified against the diff, the PR or a
live command, **not** against the agent's own report.

### Agent: startup summarizer (read-only, no worktree)
- **Asked to do:** read `HANDOFF.d/` (19 files) and `HANDOFF.md`'s BACKLOG, pinned to exact SHAs, return line anchors and flag contradictions without resolving them.
- **Actually did:** delivered it. Correctly identified the newest handover by parsing timestamps rather than sorting filenames.
- **Found:** 12 contradictions between live documents. Most consequential: `HANDOFF.md:24-26` declares itself authoritative for the BACKLOG while `HANDOFF.md:1577` declares the same section a pointer that must not be tracked in. Both written as canonical, in one file.
- **PR / branch:** none (read-only).
- **Worktree:** none.
- **Deliberately did NOT do:** resolve any contradiction. Correct — I re-derived each from `git`/`gh` instead.

### Agent: preview observer (read-only)
- **Asked to do:** establish preview's real state.
- **Actually did:** reached preview `rjyboqwcdzcocqgmsyel` via the Management API. 425 rows in `supabase_migrations.schema_migrations`, min `20260220125350`, max `20260810170000`, no duplicates.
- **Found:** preview is **one migration behind main**, and that one is `20260810140000_production_lane_canary.sql` — deliberately never applied there. **Nothing foreign is parked on preview.** Every one of the 425 ledger versions maps to a file on origin/main.
- **Found (important):** the **Supabase MCP `get_project_url` returns PRODUCTION** (`qsllyeztdwjgirsysgai`). It ran no queries through it and routed via the Management API instead. Treat the MCP as a live production connection.
- **PR / branch:** none. **Worktree:** none.
- **Deliberately did NOT do:** use the MCP for preview work.

### Agent: #709 diagnosis (read-only)
- **Asked to do:** root-cause the HTTP 403 on post-apply catalog verification (run 31430916078).
- **Actually did:** reproduced it live and found the cause.
- **Found:** **Cloudflare error 1010**, not a credential problem. `scripts/production_catalog_verification.py` sent no `User-Agent`, so Python stamped `Python-urllib/3.x` and Cloudflare banned it at the edge **before Supabase ever evaluated the token**. Proof table: default UA → 403; UA `shared-db-catalog-verification/1.0` → 201 with real data; explicit `Python-urllib/3.12` → 403; empty UA → 201. Same ban hit unrelated `GET /v1/organizations`.
- **Found (secondary):** the script printed only `str(exc)` and never read `HTTPError.read()`, which is why a Cloudflare body was invisible in the logs for a day.
- **PR / branch:** none (diagnosis only). **Worktree:** none.
- **Deliberately did NOT do:** propose softening the hard-fail. It was explicitly forbidden and it correctly did not.

### Agent: #709 implementation → **PR #715, MERGED `6578935`**
- **Asked to do:** explicit User-Agent, truthful HTTP errors, unit test. Never weaken the hard fail.
- **Actually did:** all three. +131/−3 across `scripts/production_catalog_verification.py` and its test. New `build_query_request()` split out so tests can inspect headers with no network call; `read_error_body()` with defensive decode.
- **Found:** only one HTTP call site in the file; the sibling `scripts/production_apply_model_review.py` has the same UA-less `urllib` POST but targets `api.anthropic.com`, so it is not hit by this Cloudflare rule. **Still an unfixed latent bug — see issue seeded in §7.**
- **PR / branch:** #715, merged, branch deleted. **Worktree:** retired.
- **Deliberately did NOT do:** touch the workflow, or make the failure non-blocking. The reviewer independently confirmed `GuardError` was already in both `except` tuples before the PR, so wrapping `HTTPError` swaps one already-caught type for another — behaviour unchanged.

### Agent: licensor production-readiness scoping (read-only)
- **Asked to do:** establish, per licensor, what exists on production vs only in migrations vs only designed.
- **Actually did:** live production catalog read plus a full pass over the four licensors' migrations.
- **Found:** **zero licensor objects exist on production.** All four landing schemas sit unapplied. Disney rides batch B7 (6 migrations); Paramount, Warner and NBCU ride atomic B9 (14). Confirmed `plm` is NOT in production's `pgrst.db_schemas` (`public, graphql_public, api, crm, pim, core, app`). Produced the authoritative list of the 53 unapplied versions.
- **Found (wrong, and corrected later):** it suggested #709's 403 might be a token difference because its own PAT worked. That was wrong — the #709 agent's controlled UA toggle is decisive. Recorded here so nobody re-opens it.
- **PR / branch:** none. **Worktree:** none.
- **Deliberately did NOT do:** touch anything; it was scoped read-only.

### Agent: Cloud SQL migration scoping (read-only, resumed twice)
- **Asked to do:** where does the Cloud SQL → Supabase move stand, and what is genuinely next.
- **Actually did:** three passes. Established that the move was frozen by **our own rulebook**, not by any missing capability.
- **Found:** `AGENTS.md` §0.1-A demands a read-only proof that `albert_read_only` cannot pass on its attributes (`rolcreatedb`, `rolcreaterole`, `cloudsqlsuperuser`). Every alternative route is closed: only two Cloud SQL users exist, no read replica, **zero exports ever run**, no migration history in any of the four services, and the Sequelize models describe under a third of the 386 relations.
- **Found:** the ruling everyone cites as **"R5"** exists in **no file in this repo** — six documents cite it as canonical. It contradicts `SUPABASE-MIGRATION.md` on the fundamental shape of the migration (table-by-table with `dflow.*` retired, vs lift-and-shift with `dflow.*` preserved). **Still unreconciled — see §7.**
- **PR / branch:** none. **Worktree:** none.
- **Deliberately did NOT do:** propose fixing #705 after Albert ruled it out of scope; it correctly refused to smuggle "ignore it" into "use it" and put the interpretation back to me. That was the right call and Albert then authorised the read explicitly.

### Agent: Cloud SQL capture → **PR #722, MERGED `2e3ae23`**
- **Asked to do:** run `scripts/capture-postgres-schema.sql` against DesignFlow production, read-only, and commit the raw output plus a divergence report.
- **Actually did:** exit 0 in 1.3 seconds, connected first try, no allowlist change needed or made. Committed the raw 4,006-line capture to `docs/verification/cloudsql-designflow-capture-2026-08-10/`.
- **Found — this is the headline:** **the real divergence is 3 objects, not 18 migrations.** One unique constraint (`productUserAssignment_item_role_key`) and two indexes on `RFQItem` and `RFQVendor`. **Zero Cloud SQL-only tables.** Every Supabase-only object is Sample Tracking, which #707 already ruled deliberate.
- **Found:** the #696 office/language columns are **NOT** on Cloud SQL — and **not on Supabase production either**, since `20260810160000` is merged but unapplied. #696 is bigger than it was written to be.
- **Found:** `art_piece.age_group_id` has an enforced FK pointing at **`merchGroup`, not `age_group`** — contradicting the stated foundation of the age-group-first plan.
- **Found:** zero triggers and two trivial read-only functions in the entire production schema, which closes the licensor plan's Track 3B Q1: nothing inside the database writes `parent_id`.
- **Found (trap):** Supabase production ALSO has a schema named `designflow`, distinct from Cloud SQL's. `AuditLog` is 400 MB of the schema's 542 MB.
- **PR / branch:** #722, merged, branch deleted. **Worktree:** retired.
- **Deliberately did NOT do:** read any table data (`exact_count_max_bytes=0`), touch `lithe-breaker-323913`, or run any `gcloud` beyond describe/list.

### Agent: D7 app-check harness → **PR #719, MERGED `0a5bf04`**
- **Asked to do:** turn Albert's D7 ruling into a runnable artifact — PASS/FAIL per app, failing loudly when it cannot verify.
- **Actually did:** `scripts/post_batch_app_verification.py` + 141 tests + `docs/post-batch-app-verification.md`. **Ran it read-only against production: B1 = PopCRM PASS, PopDAM PASS, PopPIM PASS, exit 0** — the check D7 required and nobody had ever run.
- **Found (live, filed as #720):** `authenticated` holds SELECT and nothing else on `pim.checklist_item`, `pim.product_assignee`, `pim.product_sample`, `pim.product_submission`, `pim.revision_request` — PopPIM's code inserts/updates/deletes against all five. Pre-existing, not batch damage.
- **Found (live, filed as #721):** `core.product_size` does not exist and PopDAM's `StylesPage.tsx` swallows the error onto a hardcoded fallback — a live silent failure. Plus `core.product_material` has no reader, and `dam_character_catalog` is read from `public`, not `api`.
- **PR / branch:** #719, merged, branch deleted. **Worktree:** retired.
- **Deliberately did NOT do:** wire itself into `.github/workflows/shared-supabase-migrations.yml` — out of its file scope, and I agreed. **See §7: CI still does not run these tests.**

### Agent: #664/#649 privilege fix → **PR #717, MERGED `1913f08`**
- **Asked to do:** revoke the PG17 `MAINTAIN` set on the 39 `plm.pmt_*`/`plm.nbcu_*` tables and close the `plm` schema default-privilege hole.
- **Actually did:** `20260810180000`, plus a contract test, plus a co-presence rule in `scripts/production_migration_guard.py`.
- **Found:** production `pg_default_acl` for `plm` was exactly one row, `{service_role=arwdDxtm/postgres}` — all eight bits including MAINTAIN. Root cause confirmed live, not inferred.
- **Found:** **#649 is NOT closed by this.** Live measurement: 106 `plm` tables, **32** still holding both TRUNCATE and MAINTAIN; `erp_*` is only 4 of the 32. Filed as **#718**.
- **PR / branch:** #717, merged, branch deleted. **Worktree:** retired.
- **Deliberately did NOT do:** couple Warner's `20260810030000` to `20260810180000`. It **argued against my explicit instruction** and was upheld on review: `20260810110000` already revokes the full PG17 set on all 8 `wb_*` tables, so the co-presence claim would be FALSE for Warner, and a false rule is one operators learn to route around. Pinned by `test_warner_is_deliberately_not_coupled_to_180000`.
- **Also disclosed, unprompted:** it once edited `scripts/production_migration_guard.py` in the SHARED checkout instead of its worktree, caught it immediately, reverted with `git checkout --`, and told me. I verified the shared checkout independently — clean, matching session start. Good behaviour; record it as such.

### Agent: `AGENTS.md` §0.1-A amendment → **PR #723, MERGED `f3a2d7d`**
- **Asked to do:** amend §0.1-A so the next agent does not freeze at the Cloud SQL read gate.
- **Actually did:** new §0.1-A.1 recording Albert's ruling as a standing, bounded exception, with both his sentences quoted verbatim and cited to #705.
- **Found / fixed on review:** its own hostile-reader pass caught three stretches; the reviewer caught a **fourth and worse** one — the section ENUMERATED what it did not permit, and **row reads were not on the list**, while the only preservation sentence pointed at a list that did not contain the row-data rules. Three parked plans queue exactly that read next. Fixed with a **closure rule**, not a longer list.
- **Found (second round):** **"owner" is overloaded inside `AGENTS.md`** — every ruling heading means Albert, but §0.1-A:152 assigns Cloud SQL schema changes to Uma and #705 twice says "instance owner". An agent could have asked Uma, got a legitimate yes, and proceeded. Now reads "its own ruling from Albert. Not from the Cloud SQL instance owner."
- **PR / branch:** #723, merged, branch deleted. **Worktree:** retired.
- **Deliberately did NOT do:** touch `docs/verification/.../README.md` (merged evidence, out of scope) or delete/weaken any existing rule. One line removed across the whole diff, and it was replaced with itself plus a pointer.

### Agent: Disney DCP Vault design analysis (read-only)
- **Asked to do:** read `C:/repos/licensor-source-data-disney/disney-dcpvault/NORMALIZED-database-schema-design-20260810.md` and hand me a declarable object list.
- **Actually did:** full analysis. Confirmed this is issue **#665**.
- **Found:** the design specifies **only tables** — zero functions, zero views, zero triggers, zero RLS, zero grants. Every safety mechanism Paramount and Warner carry would have to be invented.
- **Found:** it targeted `ingest`, where the #649 default-privilege hole is **still fully open**, so every table would be born with TRUNCATE for `service_role` — and TRUNCATE does not fire row triggers, which would void every immutability guarantee in the design.
- **PR / branch:** none. **Worktree:** none.
- **Deliberately did NOT do:** author anything. Correct — the collision gate cannot run until objects are declarable, so the read-only routing was the rule working as intended.

### Agent: Disney DCP Vault build → **PR #726, MERGED `960f45a`**
- **Asked to do:** build it, to my rulings (see §5).
- **Actually did:** `20260810190000` (9 tables, 5 functions, 9 triggers, RLS, PG17 revokes) and `20260810190100` (`plm.dcp_chunk_ledger` + 8 SECURITY DEFINER functions), plus `supabase/tests/dcp_vault_landing_contracts.sql` and a co-presence rule.
- **Found — and it corrected me:** I ruled that `plm` was already narrowed by `20260810180000` so new tables inherit the fix. **Wrong.** Two independent live `pg_default_acl` reads showed `plm` AND `ingest` both still `{service_role=arwdDxtm/postgres}` on production and preview, because `20260810180000` is merged but **unapplied everywhere**. The explicit section-7 revoke is load-bearing.
- **Found (self-review, before submitting):** two bugs it caught itself — an immutability trigger reading `new.crawl_id` on a table with no such column (would have raised on every write while applying clean), and no way to close a section, so no crawl could ever have finalized.
- **PR / branch:** #726, merged, branch deleted. **Worktree:** retired.
- **Deliberately did NOT do:** `dam.style_guide_file.style_guide_id` (shared table PopDAM reads, separate review track, not needed until promotion); any `api.*` views (explicit recorded decision, not silence); any promotion path into `core.*`.

### Agents: NBCU census + licence reconciliation (read-only, resumed three times)
- **Asked to do:** settle #675 (the "75 vs 57" rule), then reconcile against the real contract.
- **Actually did:** read Schedule "B" (2024-11-05, Universal Studios Licensing LLC / Edge Home d/b/a Comicwalls, contract 201310576) in full.
- **Found:** the count is **58** — 55 in Schedule B plus three amendments (Scarface 1983-only, Minions 3, The Mummy Franchise which REPLACES the typed #56). Ordinals become 1..58; `right_key` `rights-list:001`..`058`; the existing `^rights-list:[0-9]{3}$` check still passes, so **no migration change is needed**.
- **Found:** contract restrictions nobody had ever transcribed — **Halloween II is US & Canada ONLY** (the only territory limit), the **term ends 2026-12-31**, Wicked excludes the stage play and novel, Little Golden Books is 18 enumerated titles, Felix the Cat excludes every screen production, Santa Claus Is Comin' to Town excludes Fred Astaire's likeness. `plm.nbcu_right.restriction_text` and `global_rule_applied` are currently empty.
- **Found:** two working-list restrictions ("An American Werewolf in London — restrictions apply"; "Field of Dreams — higher-end specialty accounts only") appear **nowhere in Schedule B**. Do not load them as contract restrictions without establishing their source.
- **Found (transcription trap):** the contract spells entry 32 **"Lamp Chop"**. The spec requires `business_title` to be exact source text — someone must rule on transcribe-vs-correct.
- **PR / branch:** none. **Worktree:** none.
- **Deliberately did NOT do:** decide the `rights_scope` classification — it produced a proposal (11 franchise / 10 all_related / 37 title) explicitly for Albert.

### Agent: NBCU capture-vs-licence check (read-only, resumed twice)
- **Asked to do:** find anything captured outside the licence, before an insert-only load makes it permanent.
- **Actually did:** parsed all 108,133 index rows and 135,641 link rows. **Then corrected its own conclusion**, which is the most valuable thing in this block.
- **Found (first pass, WRONG):** ~7,071 assets out of licence, and the 107 "exclusions" were lost captures. **Albert overruled the licensing half entirely** — see §5 — and the second pass overturned the rest.
- **Found (second pass, and this stands):** there were **zero fetch failures**. All 108,026 detail records are `status: 200` with non-empty metadata. The 107 were **deliberate denylist removals**. `nbcu/scripts/build-outputs.mjs:121-128` relabels parse FAILURES as licence EXCLUSIONS whenever the two counts happen to be equal, then empties `failures.csv`.
- **Found (the real defect):** that pipeline discards records at **three** stages and not one writes a per-record reason. `clean-detail-checkpoints.mjs:19-20` drops silently with **no counter at all**; `:32` uses `Math.max` so the exclusion count can only **ratchet up** (this will sabotage the recovery unless a stale summary file is deleted first); `:41-48` `--replace` **deletes the source evidence**, which is why the question could only be answered by inference.
- **PR / branch:** none — findings are in the scrape repo, not this one. **Worktree:** none.
- **Deliberately did NOT do:** any repo write. All output is in a scratch dir; the recovery prompt was handed to Albert for the scrape agent.

---

## 5. OWNER RULINGS FROM THIS SESSION — do not re-litigate

| Ruling | Albert's words | Consequence |
|---|---|---|
| **D7** (#711) | "assign an ai agent to do the checks" | The manual nine-times checklist is retired. Built as PR #719. D7 no longer blocks B2. |
| **#705** | "ignore the 'read only is not read only' issue" | Stop trying to fix `albert_read_only`. Do not re-raise it as a blocker. |
| **#705 scope** | "yes, use it to read production" | The account MAY be used to READ, read-only, catalog-only. Recorded as `AGENTS.md` §0.1-A.1. It authorises a read and nothing else. |
| **NBCU licence** | "assume if they made it available for us to download, we're licensed for it" | The ~7,071-asset exclusion analysis is VOID. No filtered load, no quarantine. Portal availability is the test. |

**A correction Albert made that I got wrong, recorded so it is not repeated:** I
told him Jurassic Park was out of licence because we only license Jurassic World.
Both halves were wrong — the contract explicitly grants *"The 1993 live-action
feature-length motion picture entitled 'Jurassic Park'"*, and the other entry is
**Jurassic World Franchise**. The root cause was mine: I briefed an agent to make
licence calls while it had no access to the signed contract, it said so plainly in
its report, and I relayed its conclusions anyway. **Never ask an agent for a legal
determination without giving it the instrument.**

**My rulings on the Disney build** (recorded on #665 and in the migration headers):
`plm.dcp_*` not `ingest.portal_*`; `api.*` views deliberately omitted; privilege
posture copied from Warner's `20260810110000`; RLS from `20260807190000`;
immutability adapted from Paramount's freeze pair.

---

## 6. WORKTREES, BRANCHES AND THE SHARED CHECKOUT

**Retired by me** (all verified clean AND ancestors of `origin/main` before
removal, both conditions checked, not assumed): `fix-709-ua`,
`fix-664-maintain`, `d7-app-checks`, `cloudsql-capture`, `agents-rule-0-1-a`,
`dcp-landing`. Their branch labels were deleted the same way.

**Worktree count: 36 → 30.** The remaining 29 under `.claude/worktrees/` are
**NOT MINE** — they predate this session. I deliberately did not touch them.
**#682 tracks retiring them and is still open.** Three are detached HEADs
(`hardening-663`, `preview-653`, `preview-690`).

⚠️ **The shared checkout `C:/repos/shared-db` is on branch `pr717b` at `7ac4e37`,
not on `main`.** Not mine — it was like that when I arrived and I left it alone
rather than move another session's checkout. **Consequences you will hit:**
`git branch -d` compares against HEAD and will refuse to delete branches that ARE
merged to `origin/main`; and `ls supabase/migrations/` shows a stale maximum. Use
`git ls-tree origin/main` and `git merge-base --is-ancestor <sha> origin/main`.

**Untracked files in the shared checkout, not mine, unchanged since session start:**
`.ai/deepseek-sessions/` and `.ai/reviews/glm-gate-611-atomicity-pg17-20260810T170046Z.md`.
**#558 already tracks deciding their fate.**

---

## 7. WHAT I DID NOT DO — every item has an open issue

**Issues I seeded at handover, so nothing outstanding lives only in this file:**

| Issue | What |
|---|---|
| **#730** | Run batch B2 — the critical path, now unblocked and unrun |
| **#731** | Two merged test suites have NEVER run — CI executes neither |
| **#732** | `needs-albert` — NBCU is 58 Properties, plus the untranscribed contract restrictions |
| **#733** | NBCU capture: three silent drop points and a mislabelled exclusion count |
| **#734** | Write R5 down and reconcile it against `SUPABASE-MIGRATION.md` |
| **#735** | PR #728 is another live session's work on `AGENTS.md` — do not merge blind |
| **#736** | `needs-albert` — index of every open owner decision as of 2026-08-11 |
| **#737** | `production_apply_model_review.py` has the same UA-less `urllib` POST as #709 |

Filed earlier in the session: **#718** (32 plm tables still holding TRUNCATE+MAINTAIN),
**#720** (PopPIM writes to five `pim.*` tables it cannot write), **#721** (three
app-tolerance-contract claims no longer match the code).

All eight `HANDOFF.md` `## BACKLOG` items already have open issues and were verified
open at handover: B1 #545, B3 #546, B5 #547, B6 #529, B8 #520, B9 #548, B11 #549,
B12 #550. B2, B4, B7, B10, B13 and B14 are closed or retired.


Everything below is seeded as a `db-work` issue. Nothing outstanding exists only
in this file.

**Blocked on Albert (`needs-albert`):**
- Amendment paperwork for Scarface, Minions 3 and The Mummy Franchise. Three of the 58 Properties rest on his word alone, going into tables whose design is source-pinned immutability.
- The `rights_scope` classification proposal for all 58.
- Whether "Lamp Chop" is transcribed or corrected.
- The source of the two unsupported restrictions (American Werewolf, Field of Dreams).
- Older, untouched by me: #675, #676, #643, #644, #618, #515, #516, #521, #531, #539, #541, #551, #582, #665.
- From #711, still unanswered: **D2** (how long a resting point may persist), **D5** (DesignFlow non-production drift), **D6** (whether `20260810170000`'s read-widening is still wanted — it rides inside atomic B9).

**Ready to dispatch, nobody on it:**
- **Run B2.** The critical path. §3.
- **Wire `supabase/tests/` and the new script tests into CI (#695).** `20260810190000`'s contract test and #719's 141 tests have **NEVER EXECUTED**. A green PR is not evidence they ran. This is the single largest unverified surface I am leaving.
- Apply `20260810190000`/`190100` to preview and RUN the DCP contract test.
- `scripts/production_apply_model_review.py` has the same UA-less `urllib` POST (**#737**).
- #718 — the 32 `plm` tables still holding TRUNCATE+MAINTAIN.
- #720, #721 — the live PopPIM and PopDAM findings. **#721 should be settled BEFORE the harness is relied on for B2-B9**: a stale contract makes the check confidently wrong.
- Write down **R5**, and reconcile it against `SUPABASE-MIGRATION.md` (that file is in a `popcre` repo — PR to `develop`, never self-merged).
- #658 — `HANDOFF.d/` now holds 20 files against a threshold of 5.
- #682 — the 29 remaining worktrees.

**Deliberate omissions, flagged as decisions not oversights:**
- I did not review or merge **PR #728** (§2). Another session's live work.
- I did not touch the 29 pre-existing worktrees or the two untracked `.ai/` paths.
- I did not close **#709** despite merging its fix. It needs a real production run.
- I did not close **#705** or **#680**; both carry standing rulings and stay open as the record.
- I did not dispatch the Disney→`core.*` promotion path. It needs Albert's approval of a reviewed tile-to-property mapping.

---

## 8. WHAT WE TRIED THAT DID **NOT** WORK — read this before you repeat it

1. **`gh issue create` with a bash heredoc fails on this machine.** PowerShell-first shop. Use `--body-file`. The collision checker still prints a heredoc recipe; ignore it.
2. **`node scripts/check-dispatch-collision.mjs --allocate-version` exits 2.** Withdrawn 2026-08-07 — it never reserved anything, it printed a suggestion, so two orchestrators in the same minute got the same number. **Allocate versions by hand.**
3. **`ls supabase/migrations/`** gave a stale maximum because the shared checkout is on `pr717b`. Cost me a confused minute. Use `git ls-tree origin/main`.
4. **`git branch -d`** refused branches that WERE merged to `origin/main`, for the same reason. Use `git merge-base --is-ancestor` then `-D`, with the worktree check.
5. **`$TMPDIR` is empty in this Bash tool** — `cat > "$TMPDIR/x.md"` wrote to `/x.md` and failed with permission denied. Use the scratchpad path explicitly.
6. **Asking an agent for licence determinations without the contract** produced a confidently wrong 7,071-asset exposure analysis that Albert had to overturn. Entirely my briefing error.
7. **A first-pass conclusion that "the denylist matched nothing"** was circular — it checked the denied labels against `observed_property_labels`, which is computed only from RETAINED assets, so of course they were absent. The agent found and corrected this itself.
8. **`max(version)` to detect the applied batch is WRONG.** B0's canary `20260810140000` sorts numerically above every version in B1–B8, so it reported "you are at B0" on a database where B1 had landed. #719 now uses presence-per-resting-point.
9. **`information_schema.role_table_grants` is blind from the read-only connection** — it only shows grants involving currently enabled roles, so `not exists(...)` was unconditionally TRUE forever. Use `has_table_privilege(role, oid, priv)`.
10. **A "two-zone" clock check that casts `timestamptz` to `date` twice is a tautology.** `::date` already converts using `TimeZone`, so both legs computed the same thing and the check could never fire. Needs an explicit `at time zone 'UTC'`. Found in #719, and a sibling bug in #726 stored `waived_at` at 20:00Z instead of midday.
11. **`exception when others` in a test passes for the wrong reason** — a NOT NULL or unique violation satisfies it as readily as the guard under test. #726 now asserts `sqlstate = 'P0001'` across all 14 handlers.
12. **Reviewing a PR once is not enough on this repo.** #719 took three rounds (a Critical that printed "all three apps PASS" on a database where two were dead), #726 took four (the same input-vs-stored hash defect found in two slots, fixed, then found in three siblings). **Budget for it.**

---

## 9. FACTS HERE THAT MAY ALREADY BE STALE

- The production ledger (373/53) and preview ledger (425) were measured 2026-08-10 and **not** re-checked at 01:18Z.
- **PR #728's state** — read at 01:18Z, one minute after it appeared. It will have moved.
- Whether that other session is still alive. I could not tell.
- Everything in §5's "older, untouched by me" list is inherited, not verified by me.
- The 29 remaining worktrees were enumerated at 01:18Z; another session may be adding or retiring them right now.
- **Every SHA and count on this page.** Re-derive from `git`/`gh` before you act on any of them. That is the standing rule in this repo and it exists because documents here have gone stale within the hour.

---

## 10. SECRETS SWEEP AND DOCS PASS

**Secrets sweep: swept, nothing new.** No credential appeared in this session that
is not already in `vibe_coding`. Everything used was referenced by 1Password item
ID and never by value: preview DB password `qbvfk7umc3n75ejekd65zwd4ty`
(`DB_PASSWORD`), Supabase CLI PAT `3t2xoqk5luyz7ffgdhj24gvtpq` (`credential`), and
the Cloud SQL read-only credential referenced on #705. No value was written to any
file, commit, report or chat. The two untracked `.ai/` paths were inspected and
contain no credentials. **Nothing new to store.**

**Docs pass:** `AGENTS.md` was updated in-session by PR #723 (§0.1-A.1), which is
the one standing fact this session changed. The NBCU contract findings supersede
`nbcu/SUPABASE-IMPORT-SPEC.md:83` — that file is in the **private scrape repo, not
this one**, and the required change is recorded on the seeded issue rather than
made here. Nothing else outside this handover is now wrong.

**One evidence obligation, stated plainly:** no test in `supabase/tests/` has ever
been executed, including both new ones from this session. CI does not run them
(#695). Every claim those tests make is **unproven code** until someone applies to
preview and records the result.
