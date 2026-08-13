# HANDOVER — orchestrator session 44090f (marker #855)

**Machine:** al8960ofc · **Agent:** Claude Opus 5 · **Written:** 2026-08-13T00:15Z
**Role:** ORCHESTRATOR. Dispatched 16 sub-agents; performed no implementation work itself.

---

## 0. READ THIS FIRST — the three things that will bite you

1. **There is NO OrderList migration left to promote.** All four OrderList migrations
   (`20260810010000`, `20260810060000`, `20260810100000`, `20260810110000`) are applied to
   **both** preview and production, verified by CATALOG (`to_regclass`, `pg_get_viewdef`,
   `reloptions`, `pg_proc`), not by ledger row. The only outstanding production write is the
   **DATA import** of 3,212 orders / 24,010 lines. Do not build a migration promotion package.

2. **An independent adversarial review caught TWO CRITICAL defects behind 118 green tests.**
   The importer never causally proved which database it was writing to, and every balance
   check ran *after* commit. Both are fixed and re-reviewed. **The lesson generalises: a green
   suite is not evidence. Have consequential work adversarially reviewed against the artefact.**

3. **Several "facts" this repo teaches are wrong, and I corrected them at source.** The
   "86 object / 38 behavior assertions" preview rehearsal **does not exist** — no artifact, no
   run ID, no date, and the only primary source says *33* behaviour tests on a different date
   about different work. It had been restated as fact in three documents. Assume other
   frequently-quoted numbers in this repo have the same provenance until checked.

---

## 1. Coordination state (verified at write time)

| Fact | Value | Verified |
|---|---|---|
| `origin/main` tip | `d54e021113bf3a5e21bc984ea4e9c9ae7cb49ea5` | 2026-08-13T00:11Z |
| max migration version | `20260812211000` | 2026-08-13T00:11Z |
| migration files on disk | 437 | 2026-08-13T00:11Z |
| duplicate 14-digit versions | none | 2026-08-13T00:11Z |
| open `db-claim` issues | **none** — no schema object is locked | 2026-08-13T00:11Z |
| open issues (`shared-db`) | 108 | 2026-08-13T00:11Z |

**Preview `rjyboqwcdzcocqgmsyel` — NOT clean, but for the first time FULLY ENUMERATED.**
430 migrations applied, max `20260812211000`. **Production `qsllyeztdwjgirsysgai`: 426 applied,
max `20260812020000`.** No orphan ledger rows on either.

⚠️ **Preview is NOT a superset of production, and this invalidates a common assumption.**
`20260810140000` and `20260810180000` are on **production but NOT preview**. Six others are on
preview but not production. **A preview rehearsal therefore does not prove a production
outcome.** Treat every "we rehearsed it on preview" claim accordingly.

**Single-writer ownership at handover: ALL FREE.** No agent owns `supabase/migrations/`,
`HANDOFF.md` or `AGENTS.md`. I retired every claim I opened.

---

## 2. Open PRs — merge order matters

| PR | What | State | Action for you |
|---|---|---|---|
| **#874** | Collision tooling: DDL-aware parser (#563), **atomic version reservation** (#670), Guard B live-ledger (#651) | OPEN, 8 checks green, BEHIND | **Needs independent review before merge.** Then merge. |
| **#867** | `plm.item` Phase 2 finding + Phase 3/4 execution plan + contract tests (#853) | OPEN, green | Review, then merge. **Contains no migration** — see §4. |
| **#864** | ColdLion alert dedupe (#551) + armed-but-read-only preflight (#548) | OPEN, green | Review, then merge. |

**Merged this session:** #858, #859, #860, #869, #872, #873.
None of these three carries a migration, so **there is no version-ordering constraint between
them.** Merge one at a time: `strict: true` means each merge invalidates the next PR's
up-to-date check. Use `gh pr update-branch`, wait for checks, then merge.

---

## 3. What is waiting on Albert

Two rulings **were given this session and are CLOSED — do not re-raise them**:
- **The four `USING (true)` OrderList read policies are ACCEPTED AS-IS.** Every authenticated
  user may read the full order list. This is **not** a blocker on the import. (#863, closed.)
- **The approved populated-row count is 12,354.** The five-row question is **closed by
  decision**; itemisation is not required. (#871.)

Still open and owed by him — each has an issue, all labelled `needs-albert`:
- **#865** — which list is the reconciliation target (see §5, the numbers changed).
- **#866** — scope of the `pim` grant fix: 5, 9, or all 21 tables.
- **#868** — is `company_code` really the constant `EDGEHOME`? If wrong, every canonical key is wrong.
- **#875** — ColdLion is plain HTTP; does an HTTPS endpoint exist?
- **#861 / #862** — the two live security findings (see §6).
- Plus the pre-existing `needs-albert` set (#736 indexes them).

---

## 4. The OrderList lane — where it actually stands

**Schema: DONE.** Four migrations, both databases, verified by catalog. Preview and production
are **behaviourally identical** on every OrderList object — three RPC bodies, `pg_get_viewdef`,
`security_invoker`, all four NULLS-DISTINCT indexes checked at `pg_index.indnullsnotdistinct`
level (constraintdef alone would hide a divergence), and all 12 RLS policies — compared by md5,
**zero differences**.

**Production holds ZERO OrderList rows** and zero `google_order_list` source refs. Approval
gate 3 is satisfied.

**Importer: BUILT AND MERGED (PR #860), NEVER RUN against production.** 157 offline tests.
Single transaction — failure at any point leaves zero rows. Gates: `--production`/`--preview`
mutually exclusive; `--dry-run` refused with either; workbook SHA-256 pinned to
`68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe`; `--reviewed-commit`
verified against `git rev-parse HEAD` with a clean-tree requirement; project ref recovered from
the **live libpq connection** and re-asserted before every batch; zero-existing-rows
precondition; session advisory lock; `--replace-source` structurally impossible in production.

**The exact production command (NOT run, and not approved to run):**
```
python scripts/import-order-list-xlsx.py --workbook /path/to/OrderList.xlsx --production \
  --reviewed-commit <MERGE_COMMIT_SHA> --expected-populated-rows 12354 --batch-size 500 \
  --verify-idempotency --confirm "I approve one production import of OrderList.xlsx SHA-256 \
68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe into Supabase project \
qsllyeztdwjgirsysgai using reviewed shared-db commit <MERGE_COMMIT_SHA>"
```
`PRODUCTION_DATABASE_URL` supplies the credential; it never appears on the command line.

**Residual risk accepted, not fixed:** the target proof is `connection.info.host`/`.user` plus a
content precondition. **Supabase exposes no project ref through SQL**, so no server-attested
proof exists. A tunnel/proxy host *plus* a username of the literal form
`postgres.qsllyeztdwjgirsysgai` *plus* a zero-row database would still pass. Judged contrived.

**`/orders` deployment is NOT approved** and the page is not built. Blocked on §5.

---

## 5. `plm.item`, the bridge, and the property-list question — the numbers CHANGED

**`fix_schema_for_api.md` Phase 2 was ALREADY SHIPPED** — `plm.item_import`,
`plm.item_import_staging`, `plm.import_item_master_data()` have been live on both databases
since **2026-07-20** via `20260720120000` / `20260720121000`, delivered under the *item-taxonomy*
workstream. The plan listed it pending only because it landed under a different name. The agent
found this by writing the migration, applying it to preview, and hitting `already exists`; the
apply **rolled back cleanly** and it deleted the draft rather than ship a competing definition.
**PR #867 contains zero migration files.**

**The Phase 3 blocker (#868).** The resolver builds `plm.item.source_id` as
`companyCode|divisionCode|itemNo`, but `erp_items_current.external_id` is a **bare item number** —
**0 of 17,703 contain a pipe** — and `erp_items_current` has **no `company_code` column at all**.
The two key spaces cannot be joined directly.

**Why that is dangerous:** `plm.style_tracker_item_bridge.erp_item_id` is FK'd to
`erp_items_current(id)` `ON DELETE SET NULL`, and those ids are random UUIDs that do not survive
a truncate-and-re-pull. A guessed mapping **silently NULLs 13,701 bridge links, raises nothing,
and leaves row counts identical** — so a count-based check passes. Recommend the new FK be
`ON DELETE RESTRICT`.

### The three property lists — corrected numbers

I gave the owner two wrong figures this session. Both are corrected here.

| List | Count | Grain | Source |
|---|---|---|---|
| `core.property` | 256 | franchise / merch group | **DesignFlow PLM `merchGroup`** (NOT ColdLion) — `plm.import_master_data()`, migration `20260624173000:507`, all stamped `plm_import_source: designflow_plm`, all created in one instant 2026-06-25, last refreshed 2026-07-08 |
| ColdLion properties | **300** (live, 2026-08-12) | franchise / merch group | ColdLion `/merchGroupDetails` type `06`. Preview holds a 285-row snapshot from 2026-07-31 |
| `core.properties_and_characters` | 10,122 rows = **500 style guides + 9,622 character appearances** (9,386 distinct characters) | title / edition | one-off legacy load Feb–Mar 2026, no loader in this repo, untouched since |

**ERROR 1 — I said "about 10,000 properties to match by hand".** Wrong. It is
**~500 properties and a separate ~9,386-character problem**. Appearance rows are not entities.

**ERROR 2 — I said "only 40 of 256 overlap".** That was exact-match only, a **62% undercount**.
Honest identity overlap is **65 of 256**. Everything past ~70 is parent/child, not identity.

**The decisive result: `core.property` IS ColdLion's list, joined on CODE.**
**252 codes agree on code AND name, with ZERO disagreements.** 4 of ours absent from ColdLion;
**48 ColdLion codes unmatched**. 252+4=256, 252+48=300 — the arithmetic closes exactly.
⚠️ **Issue #539 says 33 unmatched. It is now 48.** I commented; re-scope before asking Albert.

**The 500 are style guides, confirmed from the source.** ColdLion has a dedicated style-guide
slot (`07`) and it **returns 0 rows**, so ColdLion is not their origin. 134 of the 500 are six-plus
words; 83 of ColdLion's are one word. 50 ColdLion properties each containment-match *multiple*
rows of the 500 — the signature of many guides per property. **210 of the 500 roll up to a known
property.** Treating the 500 as the property list would leave **137 of ColdLion's 300 homeless.**

**Recommendation on record: keep `core.property` canonical; ColdLion is the FEED, not the list.**
ColdLion has no parent field, **no active/inactive/expiry field of any kind**, and 642 codes
reused across slots (17 are both a licensor and a property inside `CW001` alone). Adopting it as
canonical would resurrect lapsed licences across all four apps.

---

## 6. Security findings raised this session

- **#861 — HIGH, live.** Four `SECURITY DEFINER` functions use the null-permissive guard
  `if not (app.has_role('administrator') or auth.role() = 'service_role')`. When `auth.role()`
  is NULL the whole condition is NULL, `IF NULL` is not true, **the raise is skipped and the
  function proceeds**. Verified against live `pg_proc.prosrc`, not files:
  `public.propose_popsg_property_resolution`, `public.activate_popsg_property_decision_batch`,
  `public.promote_property_alias_batch` (all `20260731150000`), `public.approve_licensor_alias`
  (`20260731210000`). **The repo documents this trap in three places and every later migration
  uses the correct form — these four originals were simply never corrected.** Not reachable via
  a normal PostgREST call (an `authenticated` JWT sets the role claim); the NULL path is
  claimless sessions. `anon` has no EXECUTE. Fix pattern already exists:
  `plm.assert_taxonomy_alert_ack_authority()`. **Test the NULL case** — a wrong-role test passes
  against the broken form.
- **#862 — MEDIUM.** Five `SECURITY DEFINER` functions have a mutable `search_path`, all called
  live from popdam3.
- **#875 — owner.** ColdLion is `http://x5.coldlion.com/EhpApi` — plain HTTP, `X-API-Key` in
  clear text on every call. Becomes continuous once the mirror is scheduled.
- **Accepted, do not re-raise:** #863, the four `USING (true)` OrderList policies.

---

## 7. Sub-agent ledger — 16 dispatched

### Agent: OrderList state scout (read-only)
- **Asked:** find the plan, its STATUS table, `fix_schema_for_api.md`, the preview report, and read #727/#852/#853/#809/#818.
- **Found:** Steps 1 and 2 had already been partly corrected on 2026-08-12, but each still carried one misleading claim. Confirmed all four OrderList migrations applied to production via MCP ledger.
- **Deliberately did NOT:** open run `31620553795`; flagged it as unverified rather than repeating the "verifier-only" story.

### Agent: Open issue triage (read-only)
- **Asked:** classify all 114 non-OrderList open issues into dispatchable buckets with collision groups.
- **Did:** full classification — 16 read-only-ready, 36 write-ready, 37 blocked on Albert, 15 blocked on other, 11 obsolete, 6 duplicates — plus a collision-free dispatch grouping and 17 deduplicated owner questions.
- **Value:** this is the map. **Its collision groups are what made a 16-agent fan-out safe.**

### Agent: Preview state observer (read-only)
- **Did:** first full end-to-end enumeration of preview's ledger (430) against production (426). Established the both-ways drift and that neither has orphan rows. Confirmed the `designflow` orphan schema still live on production: 7 tables, 1,385 rows.
- **Deliberately did NOT:** object-level drift diff inside schemas — so hand-made non-migration objects on preview are **not** ruled out.

### Agent: Backlog and handover summarizer (read-only)
- **Found:** **two disjoint `B<n>` namespaces** — `HANDOFF.md` backlog B1–B14 (repo improvements) vs production batches B1–B10d. Issue #809 means the batches. Also surfaced 15 document contradictions.

### Agent: Approval evidence verifier (read-only)
- **Did:** closed all seven evidence gaps. Proved B9 run `31620553795` is verifier-only-red (step 9 `db push` SUCCEEDED; only step 11 failed; trigger was **`20260810020000` Paramount**, not OrderList; `20260810180000` was already applied so the demand was false; PR #843 / `d451d6e` fixed it). Proved preview↔production behavioural identity by md5. **Refuted the 86/38 rehearsal.** Found the four `USING (true)` policies.

### Agent: OrderList STATUS correction → PR #858 (MERGED)
- **Did:** rewrote every STATUS row with checkable evidence; added an OPEN QUESTIONS section.
- **Pushed back correctly** on being asked to call the five-row question resolved, on the grounds that the counting-definition explanation answers a different question than the one asked. It was right.

### Agent: Production importer → PR #860 (MERGED)
- **Did:** built the fail-closed production path; then fixed **two Critical, three High and three Medium** review findings across two rounds; caught and fixed a bug it had introduced (`target_guard()` outside the `try`, so a drift abort skipped `rollback_batch()`); chose single-transaction over per-batch commits and explained why. Corrected its own overstated test claim.
- **Deliberately did NOT:** run the importer in any mode against any database. Never touched the approval package (not its file).

### Agent: Importer adversarial reviewer (read-only, two rounds)
- **Round 1: DO NOT MERGE** — two Criticals. **Round 2: APPROVE** with two must-fix-before-run.
- **This agent is the reason a bad merge did not happen.** It verified fixes in code, ran the suite itself, and proved the write-spy empirically by patching the same name.

### Agent: `plm.item` Phase 2 → PR #867 (OPEN)
- **Did:** discovered Phase 2 already shipped; deleted its draft migration; 28/28 preview assertions; wrote the Phase 3/4 execution plan; found the key-space blocker (#868).
- **Also found, not fixed:** the resolver's missing-field check is dead code (columns are `NOT NULL`, so `23502` raises first), and the `SECURITY DEFINER` resolver has **no in-body role guard** — its only defence is the absence of EXECUTE grants.

### Agent: Production guard hardening → PR #869 (MERGED, reviewed APPROVE)
- **Did:** #672 item 1, #784, #819, #609 F5, #805 item 1. Tests 276 → 484.
- **Behaviour change you must know:** co-presence now fires when the create is in the **ledger**, not only the allowlist — so a partial repair is refused. Reviewer enumerated the newly-failing set and found **no false positive**; every refusal is satisfiable by completing the batch.
- **Deliberately did NOT:** fix the case where production already rests inside a half-applied batch (filed as **#870**) — the obvious fix would wedge the lane, so it is an owner call.

### Agent: Collision tooling → PR #874 (OPEN)
- **Did:** #563 parser blindness (60 tests, was 45/41-RED), **#670 atomic version reservation via `refs/db-claims/<version>` created by `POST /git/refs`** — a genuine server-side create-if-absent, no read-then-write window — and #651 Guard B2 against live ledgers.
- **Scope deviation, disclosed:** edited `scripts/check-pr-object-collisions.mjs`, outside its file list, because the RED tests call that shared parser. Additive; a test proves the merge guard is unchanged.
- **Deliberately did NOT:** enable Guard B2 in CI (needs one `env:` block in a workflow another agent was touching — exact YAML is in the PR body); did not reinstate `--allocate-version`.

### Agent: ColdLion dedupe → PR #864 (OPEN)
- **Did:** content-addressed dedupe with four distinct exit codes so that **deduplicating the issue never deduplicates the failure**; 42 new tests, 760 in the suite.
- **Found, not fixed:** the failure-alert fallback path files a generic issue whose title carries `run_id`, so it carries no dedupe marker — an hourly lane failing that way would file 24 issues a day. Same flood, different door.
- **Confirmed nothing was enabled:** both feed variables remain `false`.

### Agent: Small verified fixes → PR #872 (MERGED)
- **Did:** #702, #526(a), #518, #655, #619 partial. Proved its tests by mutation on throwaway copies.
- **Refused #584 item 3 and reverted its own fix:** the premise was wrong — the name is in 17 tracked files, 74 occurrences, and a prior scrub deliberately left it. Fixing one instance would be a band-aid creating false assurance.
- **Flagged:** #655's SQL was never executed (CI aborts earlier on a pre-existing quarantined fixture defect), and two guards are advisory until an admin adds them as required contexts.

### Agent: Docs corrections → PR #859 (MERGED)
- **Did:** #513, #772, #520; resolved the dangerous **§5.1 vs §5.1-A #611 contradiction** (§5.1 said no licensor batch may promote; §5.1-A said the gate was discharged 2026-08-10 — a reader would block a cleared promotion or clear a blocked one). Re-derived branch protection live and found the **warning above the table was itself the stale part**.
- **Left #529 open deliberately** — one genuine question remains.

### Agent: Read-only audits (#546, #561, #788, #814, #512)
- **Found:** 246 `SECURITY DEFINER` functions; the four null-permissive guards (#861); five mutable-`search_path` (#862); **#788's premise is stale** — the four "unbatched" migrations *are* batch B10 per the contract; **#814 is zero findings, nothing to fix**; popdam3 depends on 57 RPCs and ~1,048 hard-coded UUIDs no catalog query can see.
- **Could NOT inspect:** `hiclaw` and `monitor` are not checked out on this machine. #512 is narrowed from 4 repos to 2, **not closed**.

### Agent: Schema fit reviews (#640, #724, #720, #811)
- **Found:** the two-universe problem (#865); **#720 understates itself — 21 tables have `pm_write` policies with no write grant, root-caused to `20260621151155:349` policy vs `:471` grant, and PopPIM fails at 11 live call sites**; Paramount's bigint→text is **future-proofing, not observed loss** (zero leading zeros, zero values >2^53 in the whole extract); #811's design memo already exists in the repo.

### Agent: Licensor readiness + scraper questions + DCP verification + repo reconciliation
- **Produced** the scraper question list (published as a private artifact for the owner to forward; no licensed names in it).
- **Corrected me three times, and this is the important part.** I told the owner Disney DCP needed an expensive re-scrape; **wrong** — the missing fields come from a documented per-asset endpoint at ~3 KB / 125 ms, and `20260811050000` already creates the enrichment tables that expect exactly those fields. **Nobody has ever run it.** I said the capture was untracked and at risk; **wrong** — committed across 12 checkpoints. I raised a Warner two-captures alarm; **false alarm** — a dirty local working tree, and the 4,301-character capture on `main` is authoritative.
- **Real finding that stands:** the DCP crawl **stopped at job 23 of 34**; 10 of 22 tiles have zero rows. `gaps: []` only tracks gaps *within attempted sections* and is silent about sections never started.

---

## 8. What I tried that did NOT work [MANDATORY]

- **Merging several PRs in one pass fails every time.** `strict: true` means each merge
  invalidates the next PR's up-to-date check, and `--auto` is **disabled on this repo**
  (`enablePullRequestAutoMerge` → GraphQL error). The only thing that works:
  `gh pr update-branch`, **wait for checks to settle**, merge, repeat. Budget ~4 min per PR.
- **`gh issue view --comments` returns silent empty output on this machine.** The plain form
  works. An agent hit this live. "Empty" is not "none" — the same class of bug as the DCP
  `gaps: []` misread, twice in one session.
- **`node scripts/check-dispatch-collision.mjs` prints a bash-heredoc claim recipe that does
  not work in PowerShell.** Use Git Bash, or `--claim-body-file`.
- **The Supabase MCP is bound to PRODUCTION and takes no project parameter.** Every agent that
  needed preview had to use psql (`C:\Program Files\PostgreSQL\17\bin\psql.exe`, pooler
  `aws-0-us-east-1` port **5432** — the 6543 transaction-mode port breaks single-transaction
  work). **There is no WSL on this machine.**
- **`service_role` lacks SELECT on `core.properties_and_characters`** — PostgREST returns 42501.
  An agent had to use the Management API query endpoint instead.
- **CRLF bit an agent twice:** JS `.` does not match `\r`, so line-based regexes silently
  misbehave on Windows checkouts.
- **The guards were spawning 437 processes per pass** (`find -exec basename`) — 90s on Git Bash.
  Fixed in PR #874 to ~26s.
- **Assuming local folders are the authoritative data source was wrong.** All seven
  `C:\repos\licensor-source-data-*` folders are clones of ONE repo,
  `u2giants/licensor-source-data`, each parked on a different branch. Two entire captures were
  invisible because no local folder was checked out to their branch.

---

## 9. Facts that may already be stale

- Every SHA, count and PR state above: verified 2026-08-13T00:11Z. **Re-derive before acting.**
- **ColdLion returns 300 properties as of 2026-08-12; preview holds a 285-row snapshot from
  2026-07-31.** The list is actively growing (59 created in 2026), so **300 will drift.**
- **Only 4 ColdLion divisions were queried** (`CW001,SP001,EH001,EP001`) because the API exposes
  no division-listing endpoint. **If a fifth licensed division exists, its properties are
  invisible to us.** UNVERIFIED.
- The 108 open-issue count moves as agents file findings.
- Preview object-level (non-ledger) state is **not** fully enumerated — only the ledger is.
- Issue **#516** was not retrieved in the ColdLion pass. UNVERIFIED.

---

## 10. Deliberately left behind — decisions, not oversights

- **13 pre-existing worktrees** not created by this session, left untouched:
  `automatic-production-gates`, `b3-truncate-fix-821`, `codex-issue-782-final` (detached),
  `csv-findings`, `issue-727-design`, `issue-727-orderlist`, `issues-614-617-reconcile`, and six
  under `C:\repos\shared-db-worktrees\`. Issue **#682** owns their retirement.
  ⚠️ **`issue-727-design` holds commit `824eee5`, +195 lines
  (`docs/design/popdam-order-list-idempotent-import.md`), which is NOT on `main` and #727 is
  closed.** Decide keep-or-drop before anyone cleans it.
- **~18 untracked `.ai/` review files** in the main checkout, plus
  `HANDOFF.d/start-phase-7a-prompt.md`. Left as-is — several are the only copy of a model
  review's reasoning. Not mine to commit.
- **`C:\repos\licensor-source-data-warner` has a DIRTY working tree** whose staged change would
  **downgrade `characters.csv` from 4,301 characters to 1,184**. Not mine to reset. **Do not
  commit it.**
- Three worktrees kept because their PRs are open: `853-plm-item-phase2`, `coldlion-dedupe`,
  `collision-tooling`.
- **#870** filed rather than fixed — the half-applied-batch guard gap is an owner trade-off.
- **#584 item 3** left unfixed on the agent's correct reasoning.

---

## 11. Outside this repo — `u2giants/licensor-source-data`

On the owner's explicit instruction I merged **PR #9** (full Paramount capture, 592 files) and
**PR #1** (Disney DCP, 156,644 rows), then docs PRs **#10, #11, #12**, and **closed PR #2**
without merging.

**Why #2 was closed, not merged:** it is an early Warner stub —
`assets.csv` **2,242 bytes vs 62,573,505** on `main`. Merging it would have destroyed the
capture. Its two documents were verified already present on `main` first.

PR #1's conflicts were add/add and resolved by keeping both sides; **`assets.csv` merged with no
conflict and was verified byte-identical**. PR #12's branch claimed two folders were "not present"
— true on that branch, false after the merges — so those lines were dropped.

**All five captures are now on `main` and no PRs remain open there.** Before this, two entire
captures were invisible to anyone reading the default branch, which is why several documents
this week described Paramount as missing.

---

## 12. Recommended first moves for the next orchestrator

1. Claim the marker. Re-derive §1 from `git`/`gh` — **do not trust this file's numbers.**
2. Get **#874, #867, #864** independently reviewed and merged, one at a time.
3. Put the four owner questions to Albert as **one list**, with #539 re-scoped to **48**.
4. If he approves the OrderList import: the package is `docs/verification/popdam-order-list-production-approval-2026-08-12/README.md` (corrected this session) plus §4 above. **The command must be run at the exact merge commit of #860 on a clean tree.**
5. **Do not** treat a preview rehearsal as proof of a production outcome (§1).
