# HANDOVER — orchestrator session 0814ad

**Machine:** al8960ofc · **Agent:** Claude Opus 5 · **Written:** 2026-08-13T15:35Z
**Role:** ORCHESTRATOR. Dispatched 8 sub-agents; performed the production applies itself.

---

## 0. READ THIS FIRST — the four things that will bite you

1. **"Merged but not applied" is NOT the same as "forgotten." I got this wrong THREE
   TIMES in one session.** Every time, a guard was right and I was wrong. Before you
   report a schema gap or push to apply a pending migration, run
   `node scripts/check-migration-ledger-drift.mjs --target production` and then **read
   why each pending version is pending**. Three of them are pending ON PURPOSE and one
   of those would REGRESS production if applied. Details in §5.

2. **A number in this repo is copied until you prove otherwise — including MINE.**
   I corrected two figures from the previous handover, and a sub-agent then corrected
   one of mine (271 vs 359 contradictory rows). An issue's own table list was wrong
   (#866 omitted two tables). Re-derive every count from the live database.

3. **Preview is now TEN migrations behind production, and the gap is one-directional
   for the first time.** Production is at 437 applied, preview at 430, and preview is
   missing everything this session applied plus `20260810140000` and `20260810180000`.
   **A preview rehearsal proves less than ever right now.** Do not treat preview as a
   stand-in for production.

4. **The four licensor landing table sets are COMPLETE and EMPTY.** Schema work is done
   for Warner, NBCU, Paramount and Disney. **Zero rows in every one of them.** The
   loaders were never written. That is the single biggest outstanding piece of work and
   it has no issue-level owner.

---

## 1. Coordination state — verified at write time

| Fact | Value | Verified |
|---|---|---|
| `origin/main` tip | `c288bd59efd93aa8ff43830670273565a0d96a9b` | 2026-08-13T15:30Z |
| max migration version | `20260813180000` | 2026-08-13T15:30Z |
| migration files on `main` | **440** | 2026-08-13T15:30Z |
| duplicate 14-digit versions | **none** | 2026-08-13T15:30Z |
| production applied | **437** | 2026-08-13T15:30Z |
| preview applied | **430** | 2026-08-13T15:30Z |
| open `db-claim` issues | **none** — no schema object is locked | 2026-08-13T15:30Z |
| open PRs | **#874, #864** — both deliberately held, see §4 | 2026-08-13T15:30Z |

**Single-writer ownership at handover: ALL FREE.** No agent owns `supabase/migrations/`,
`HANDOFF.md` or `AGENTS.md`. Every claim I opened (#886, #888, #895) is closed.

---

## 2. What was WRITTEN TO PRODUCTION this session

This session made **four** production writes. All were owner-approved in-session.

### 2.1 The OrderList data import — DONE
The importer had never been run in any mode. It ran once, successfully.

| table | rows |
|---|---|
| `plm.production_order` | **3,212** |
| `plm.production_order_line` | **24,010** |
| `plm.production_order_source_ref` | 3,212 (all `source_system = 'google_order_list'`) |
| `plm.production_order_line_source_ref` | 24,010 |

Balance checks BALANCED (12,354 staged vs 12,354 declared). Idempotency PASS — the
second identical run changed 0 business rows. Evidence merged in PR #890. Issue #877 closed.

**24 of the 3,212 orders have no lines.** They are header-only rows in the source
workbook, imported faithfully. Not a defect. Do not "fix" it.

### 2.2 Six licensor landing migrations — DONE (run `31710331822`)
`20260810190000`, `20260810190100`, `20260811030000`, `20260811050000`, `20260811060000`,
`20260811070000`. Verified live: **20 `plm.dcp_*` tables** (Disney), plus
`plm.nbcu_asset_ip_family` and `plm.pmt_asset_metadata_value`.

### 2.3 Two security fixes + the PopPIM grants — DONE (run `31714556376`)
`20260813020000`, `20260813030000`, `20260813180000`. Verified live: 5/5 functions have
a pinned `search_path`; 4/4 null-permissive guards now deny a NULL role; 18 `pim` tables
gained INSERT/UPDATE/DELETE for `authenticated`.

---

## 3. Sub-agents — one block each

### Agent: review PR #874 (collision tooling)
- **Asked to do:** independent adversarial review.
- **Found:** `extractOperations` strips every `$$…$$` body, which also strips `DO $$`
  blocks — the repo's dominant idempotent-DDL idiom. **60 literal DDL statements across
  the real migrations are invisible to it**, producing the exact false clear #563 exists
  to fix. Its own anti-regression test applies the same strip, so it is structurally
  blind to the gap. The documented superset invariant at `:616-620` is false on 21 of 440
  migrations.
- **PR:** #874, still OPEN. Full review posted as a PR comment.
- **Deliberately did NOT do:** did not fix it. A false clear on a collision guard is a
  no-silent-failure violation and the author should decide the fix.

### Agent: review PR #867 (plm.item docs + tests)
- **Found:** every number with a primary source checked out. But the execution plan it
  adds is **already non-executable**: it keys on `erp_items_current.division_code`, which
  is **NULL on all 17,703 rows**. I re-verified this myself. Also, its Section C tests are
  refusal-only — a resolver with its entire promotion body deleted passes all 28 assertions.
- **PR:** #867, **MERGED** (docs-only, zero production risk).
- **Deliberately did NOT do:** did not block the merge on findings that are about the
  plan's future execution rather than the merge's safety.

### Agent: review PR #864 (ColdLion dedupe + preflight)
- **Found:** the armed preflight runs `sync-coldlion-licensors-properties.mjs` with **no
  `COLDLION_API_KEY` in the step env**, so it falls back to `op read` — and the 1Password
  CLI does not exist on a GitHub runner. The step dies at exit 1 and the five lanes it
  exists to prove are skipped. "Verified locally to exit 0" was true only on a machine
  with `op`. Also: dedupe lookup limit is 100 and the repo has 109 open issues, so the
  `DEDUPE CHECK FAILED` alarm fires on every normal delivery.
- **Verdict: DO NOT MERGE.** PR #864 still OPEN, review posted as a comment.

### Agent: fix #861 (null-permissive SECURITY DEFINER guards)
- **Actually did:** forward migration, landed as `20260813030000` (PR #887).
- **Found (the best evidence of the session):** applying the fix turned the **existing**
  `popsg_property_resolution_contracts.sql` suite RED. Its C3/C4/C7 assertions had been
  calling the guarded RPCs with no JWT claims and getting through — **the suite had been
  relying on the hole.** Callers were given an explicit `service_role` claim; the test
  diff is purely additive, zero deleted lines (I verified).
- **Worktree:** retired. **Claim #888 closed.**

### Agent: fix #862 (mutable search_path)
- **Actually did:** `alter function ... set search_path` on 5 functions, landed as
  `20260813020000` (PR #889).
- **Judgment call worth keeping:** used `pg_catalog, public`, NOT the `public, pg_catalog`
  the issue suggested — with `public` first, a role with CREATE on `public` could shadow a
  built-in like `count()` and have a `postgres`-owned definer function call it.
- **Worktree:** retired. **Claim #886 closed.**

### Agent: build the migration-ledger drift guard
- **Actually did:** `scripts/check-migration-ledger-drift.mjs` + 13 tests +
  `.github/workflows/migration-ledger-drift.yml` + an `AGENTS.md` warning block. PR #893
  **MERGED**.
- **Found beyond the brief:** 11 pending, not the 8 I had briefed. Three
  (`20260729120000`, `20260802170000`, `20260802171000`) were in nobody's list.
- **Deliberately did NOT do:** no `pull_request:` trigger, because a PR adding a migration
  is drift by definition and that leg would be red every time and get ignored.

### Agent: research division codes for Uma
- **Actually did:** the briefing now at `docs/division-code-questions-for-uma.md` (PR #894,
  merged).
- **Note:** its headline figure (359 contradictory rows) was **wrong**; my own re-derivation
  gives **271** out of 3,553 fully-populated rows. The doc carries the corrected number.

### Agent: fix #866 (all 21 pim write grants)
- **Actually did:** `20260813180000` (PR #896), granting INSERT/UPDATE/DELETE on **18**
  tables, with hard post-conditions that raise if a narrow table is ever widened.
- **Deliberately did NOT do:** did not widen `product`, `customer_ext`, `factory_ext`
  despite the owner saying "all 21". Its first revision DID widen the two `_ext` tables and
  **CI caught it** — `supabase/tests/db_data_admin_extensions.sql:26-30` asserts
  `authenticated` must have no direct DML there.
- **Found:** #866's own table list is copied from the June migration and **omits
  `customer_ext` and `factory_ext`**.

### External review: Grok 4.6 (session `pim-grant-scope-866`, $1.07, 1.55M tokens)
- **Agreed** with holding all three narrow, with a better reason than mine: **13 tables
  cascade-delete with `pim.product`**, so one browser DELETE would erase a product and its
  entire history.
- **Raised the real risk, which is in the 18 I DID open** — see #898.
- **One concern I checked and dismissed:** it flagged the missing
  `notify pgrst, 'reload schema'`. Not needed — the `pgrst_ddl_watch` event trigger is
  present and enabled on production and fires on `ddl_command_end`.

---

## 4. Open PRs — BOTH deliberately held

| PR | State | Why held |
|---|---|---|
| **#874** | OPEN | False-clear class in the collision parser (§3). Fix findings 1 and 2 first. |
| **#864** | OPEN | Preflight cannot succeed on GitHub Actions at all (§3). Blocking. |

Neither carries a migration. **Neither is urgent.** Full reviews are PR comments.

Merge mechanics confirmed: strict mode means each merge flips the others to BEHIND and
requires `gh pr update-branch` plus a full re-run. Auto-merge is off. One at a time.

---

## 5. The three migrations that are pending ON PURPOSE — do not "fix" this

Production drift is **3**, down from 11. All three are deliberate holds:

| version | why it is pending |
|---|---|
| `20260729120000` | **RETIRED. Applying it would REGRESS production.** Its end state is already live via `20260729130000` and `20260729180000`. `scripts/production_migration_guard.py:91` blocks it; `RETIRED_VERSIONS` in `post_batch_app_verification.py:345` names it. **Nothing is exposed.** I wrongly told the owner this was a two-week-old security hole. |
| `20260802170000` | Blocked by **AGENTS.md 6.5, OWNER RULING 2026-08-03**: may not reach production until the FR 'FRIENDS TV' removal work ships **with it, as ONE bounded apply**. |
| `20260802171000` | Same ruling. **No FR removal migration exists yet**, so the combined change cannot be assembled. Author the removal migrations and register them in `FR_REMOVAL_VERSIONS`. **Do NOT edit the guard to unblock them.** |

---

## 6. What is waiting on Albert

Each has an open issue labelled `needs-albert`.

- **#868 / the Uma questions** — `division_code` is NULL on all 17,703 rows. He said it
  comes from ColdLion and that DesignFlow also has divisions. They are **two different
  encodings**, joined many-to-one, already contradicted by 271 live rows. 8 questions are
  drafted at `docs/division-code-questions-for-uma.md`. **This blocks #853 and #867's plan.**
- **#865** — which property universe is canonical (256 vs 500-inside-10,122).
- **#898** — DELETE now live on `pim.stage`, `product_update`, `product_time_entry`.
  Recommendation: revoke it on those three.
- **#875** — ColdLion is plain HTTP. **The owner called this question "meaningless" but it
  was asked ambiguously alongside #866; it has NOT actually been answered.** Re-ask it cleanly.
- Plus the pre-existing `needs-albert` set (#736 indexes it).

**Rulings GIVEN this session — do not re-ask:**
- `core.properties_and_characters` is a MIXED table; the property count is **500**, not
  10,122. Documented at `docs/core-properties-and-characters-what-it-actually-is.md`.
- Fix **all 21** pim tables (delivered as 18 + 3 held; see §3 and #866).
- Switch Disney on. **Done.**
- Approve the OrderList production import. **Done.**

---

## 7. What we tried that did NOT work — MANDATORY

- **Priority-1 "rescue" from the previous handover was based on a backwards diff.** The
  staged tree in `C:\repos\licensor-source-data-warner` was **byte-identical to
  `origin/main`** (`git diff --cached origin/main` empty). Nothing was unique. No PR was
  needed. **Then I over-corrected** and claimed `main` was missing 3,118 Warner rows — also
  wrong; I had read a clone whose `origin/main` ref was stale. Warner is fully on `main`.
  Both errors are corrected on #884. **Lesson: re-resolve the remote ref before declaring
  anything missing.**
- **Migration version numbering, first attempt.** I assigned `20260813010000` to #861 and
  `20260813020000` to #862, then merged #862 first. The SQL guard correctly refused the
  backdated file. Renumbered to `20260813030000` — a pure rename. **Assign versions in the
  order you intend to MERGE, not the order you dispatch.**
- **`op_run` + bare `python`.** The op_run PowerShell resolves `python` to
  `…\Python313\python.exe`, which lacks `openpyxl`. Git Bash resolves it to
  `C:\Python314\python.exe`, which has it. **Pass the explicit interpreter path.**
- **Transaction-mode pooler (port 6543) for the import.** Correctly refused — it cannot
  hold the single transaction, so a failure would have left orders committed without their
  lines. **Use the session pooler on 5432.**
- **`op_run` timed out at 600s while the import was still running.** The process survived
  and completed. **A timed-out op_run does NOT mean the work stopped.** Check
  `Get-CimInstance Win32_Process` and `pg_stat_activity` before concluding anything. Also:
  an in-flight transaction is invisible to a separate connection, so "0 rows" proves nothing.
- **Production apply, first attempt:** omitted `review_artifact_digest`. It is REQUIRED and
  must be `sha256:<64 lowercase hex>`; get the hex from the review-evidence run's upload log.
- **`gh issue create --body "…"` with backticks** gets mangled by shell expansion. Always
  `--body-file`.
- **`ai-grok-review` is not on `PATH`** on this machine; it lives at
  `/c/repos/ai-devops/bin`. The wrapper pins `grok-4.5`; use `AI_GROK_MODEL=grok-4.6`
  (its supported knob) rather than calling `grok` directly.

---

## 8. Facts I believe that may already be stale

- Every count in §1 was checked at **2026-08-13T15:30Z**. `main` moved five times during
  this session; assume it has moved again.
- **PR #874 and #864 both showed `mergeStateStatus: UNKNOWN`** at write time (GitHub was
  still computing after the last merge). Re-check before acting.
- The **preview** figures are from one read at 15:30Z. Preview is shared and another
  session may be applying to it.
- **Grok's findings in #898 are Grok's**, not independently verified by me line by line. I
  verified the `pgrst_ddl_watch` claim and the cascade-delete claim's shape; I did not
  re-derive its file:line citations.
- `git branch -r --contains` reported the merged `docs/division-code-briefing-for-uma`
  branch as NOT merged. **That is the squash-merge trap** — the content IS on `main` (I
  confirmed the file). Compare file content, never `git cherry`.

---

## 9. Worktrees — every one accounted for

**20 worktrees.** I retired three of mine (`861-null-permissive-guard`,
`853-plm-item-phase2`, `orderlist-prod-run`, `uma-briefing`). The rest predate this session
and **issue #682 owns their retirement**.

- **`C:/repos/shared-db-worktrees/shared-db-orchestrator-scope-6b262a` is DIRTY** (2 tracked
  files). **It is another session's. I did not touch it.** Do not clean it without checking.
- `issue-727-design` still holds unmerged work (`824eee5`, +195 lines,
  `docs/design/popdam-order-list-idempotent-import.md`). Issue #727 is closed, so nobody is
  coming back for it. Decide keep-or-drop.
- **13 untracked files in the main checkout** (`.ai/deepseek-sessions/*`, `.ai/glm-*`,
  `.ai/grok-*`, `HANDOFF.d/start-phase-7a-prompt.md`). Left deliberately — several are the
  only copy of another session's model-review reasoning. **Not mine to commit or delete.**

---

## 10. The biggest thing nobody owns

**Every licensor landing table is empty.** Warner (9 tables), NBCU (16), Paramount (17),
Disney OPA (1) and Disney DCP Vault (20) all exist, all are correct, all hold **zero rows**.
The schema is finished; **the loaders do not exist**.

Meanwhile the captures are large and real: `warner-bros/assets.csv` 147,538 rows,
`disney-dcpvault/assets.csv` 156,645, `nbcu/asset-index.csv` 113,332, plus Paramount.

And Disney's own capture is **incomplete** — the DCP crawl stopped at 3 of 22 portal
sections (#878).

⚠️ **Two Disney documents warn that DCP Vault's `properties[]` must NEVER be paired with
its `character[]`** — that relationship is valid only from OPA. Whoever writes the loaders
needs to know this before they start.
