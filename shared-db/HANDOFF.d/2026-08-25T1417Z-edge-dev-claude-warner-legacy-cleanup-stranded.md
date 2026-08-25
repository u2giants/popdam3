---
issue: 1517
status: BLOCKED
owner: claude/warner-stranded-handoff-20260825
---

# Warner legacy cleanup `20260814170749` is stranded — needs an owner ruling, then a fresh migration

**Blocked on:** owner decision (see §0). No engineering work can start until it is answered.
**Do not** rehearse `20260814170749` on preview. Doing so strands it permanently — see §7, trap 1.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put **all** of these to Albert in ONE message, before starting work. Do not trip over them one at a time.

### Blocking — nothing can proceed until answered

1. **Reissue the Warner cleanup as a fresh migration, or retire it entirely?**
   The original file cannot reach production (§5). The only route left is to author a new migration
   carrying identical SQL under a new version number, rehearse it today, and promote it normally.
   **Recommendation: reissue.** The change is safe, reviewed, and finishes a cleanup already half-done.
   Retiring instead is defensible — nothing is broken without it (§6) — but leaves sixteen retired
   loader functions callable and two API views lying to anyone who queries them.
   *Blocks: everything in §6.*

2. **Does reissuing override the standing "promote the original file" advice?**
   `docs/production-promotion-procedure.md` says explicitly: *"promote the original file — do not
   hand-copy it into a new 'bounded forward' migration."* That advice predates both the byte-binding
   gate and the 2026-08-18 preview rebuild, which together make it impossible to follow here.
   **Recommendation: rule that a stranded migration — merged without a preview rehearsal, whose
   producer code has since moved on — is an explicit exception, and record it in that document.**
   Without this, the next session re-derives this whole analysis from scratch. #679 already hit the
   identical wall on 2026-08-25 and resolved it ad hoc.
   *Blocks: step 1 of §6, and recurs for every remaining stranded migration.*

### A wrong guess is recoverable, but rework is wasteful

3. **Should a replacement API view ship in the same window?**
   After the drop, the only browser-reachable Warner property→character view is
   `api.wb_inferred_property_character` — co-occurrence *guesses*, explicitly not the direct
   assertions. The 4,158 real assertions would live only in `plm`, which browsers cannot reach.
   **Recommendation: no — ship the cleanup alone.** No application reads either view today, so
   nothing breaks, and adding a view is a new structure decision deserving its own issue.
   Both the 2026-08-23 audit and Muse Spark 1.2 reached this conclusion independently.
   *Affects: scope of §6 only.*

### Not part of this work, and nobody is on it

4. **Two stale `HANDOFF.d/` files whose issues are already closed.** Target for stale files is ZERO.
   Neither is mine to delete (I did not finish their next step), so they need their owners or a ruling:
   - `2026-08-19T1500Z-al8960ofc-claude-coldlion-phases-2-6-plan.md` — issue **#1184 CLOSED**,
     owner `claude/plan-coldlion-landing-phases-2-6`
   - `2026-08-24T2355Z-edge-dev-claude-orchestrator-1419-closeout.md` — issue **#1419 CLOSED**,
     owner `claude/shared-db-orchestrator-3925aa`
   **Recommendation: authorize any session to delete a `HANDOFF.d/` file whose contract-block issue
   is closed, without needing to be its successor.** The current successor rule means a file whose
   workstream simply ended has nobody entitled to remove it.

5. **`2026-08-24T1526Z-edge-dev-codex-paramount-preview-capture.md` is now finished but still present.**
   It points at issue #949 (open, but as the drift alarm, not that workstream). Its Paramount preview
   capture work completed, and the production window landed 2026-08-25 (#679).
   **Recommendation: its owner (`codex/closeout-paramount-preview-capture`) deletes it.**

6. **Two branches carry one unmerged documentation commit each**, from sessions that stopped:
   - `claude/paramount-doc-production-caveat` (`26828c9`) — adds a production caveat to
     `fix_Paramount_capture_against_preview.md` that **today's window resolved**. Merging it now would
     put a false warning into the record. **Recommendation: drop it.**
   - `claude/lastrun-pmt-json-null` (`ada0298`) — records preview rehearsal evidence in
     `supabase/tests/pmt_raw_value_json_null_contracts.sql`. Harmless. **Recommendation: merge or drop,
     owner's choice.**

### Already settled — do NOT re-ask

- **2026-08-25** — the four-version Paramount window was authorized and **completed**. Paramount is
  fixed. Not part of this workstream (§1).
- **2026-08-24** — `20260814233342` and `20260814233423` are **retired** and hard-blocked (PR #1402).
  Settled; do not revisit.
- **2026-08-25** — the #1459 supersession route was **killed** and PR #1491 closed unmerged. Do not
  resurrect the `20260825102727` approach.
- **2026-08-13 (#892) standing rule** — a missing object in the live catalog is **not** proof the work
  was never done. Read the SQL on `main` first.

---

## 1. What this application is

**POP Creations** is a licensed-merchandise business: it designs and sells product under licences from
brands such as Disney, Paramount, Warner Bros., NBCU, Sega and Peanuts.

**`u2giants/shared-db`** is the single source of truth for the **structure** of the shared Supabase
(PostgreSQL) database that nine applications read — CRM, DAM, PIM, DesignFlow PLM and others. Its
entire contents are mirrored into a `shared-db/` folder inside every consumer repo on each push to
`main`, so an `api.*` view here is externally visible to four consumer applications.

- **Repo:** `u2giants/shared-db` (private). Governing document: `AGENTS.md`.
- **Production database:** Supabase project ref `qsllyeztdwjgirsysgai`.
- **Preview database:** project ref read from the repository variable `PREVIEW_PROJECT_REF`.
  The previous preview `rjyboqwcdzcocqgmsyel` was **deleted on 2026-08-18** — this fact matters
  enormously here (§5).
- **Schemas:** `plm` holds licensor source-capture landing tables and is **not** browser-reachable.
  `api` is the browser-reachable layer (`AGENTS.md` §8.1). `core` is canonical master data.
- **Warner source system** is called **STARLABS** — Warner's licensee portal. Its scraped data lands
  in `plm.wb_*` tables.

**The owner, Albert Hazan, is not a programmer.** Write for him in plain business English.

## 2. What we set out to do this session, and why

**Trigger.** Issue **#949** is an automated "migration ledger drift" alarm: it fires when migrations
are merged to `main` but not applied to a database. Six migrations merged on 2026-08-14 had never been
applied **anywhere** — not even to preview, so they had never been rehearsed. The alarm had been red
since the day they merged and nobody had read it, because a verdict bug (fixed in `1920ec6`,
2026-08-23) made it impossible for the check to ever pass.

**Business goal.** Tell Albert, in plain English, whether anything was actually broken in production,
and give a clear apply / retire / needs-decision recommendation for each of the six.

**Technical objective.** Re-derive the drift numbers from fresh workflow runs, read the SQL on `main`
for each migration, check for supersession by later work, and determine whether anything downstream
was silently broken by their absence.

**That work is COMPLETE.** Five of the six are resolved. **This handoff carries the one that is not.**

## 3. Current state — what is true right now

### Done and merged (this session)

| Artifact | State |
|---|---|
| `docs/verification/unapplied-20260814-migrations-status-20260825.md` | Merged — PR #1494, corrected by #1497, resolution banner #1514 |
| Issue **#1517** | **Opened** — the governed home for the Warner work. This handoff's contract issue. |
| #949 comments (2026-08-25) | Two comments recording the stranding finding and the Option A test |
| #1459 comment | The ordering contradiction that got PR #1491 closed unmerged |

All committed and pushed to `main`. Nothing of this session's work is uncommitted.

### The six migrations, final state

| Version | State |
|---|---|
| `20260814193351` pmt duplicate name columns | **Applied to production** 2026-08-25 (#679 window) |
| `20260814213043` pmt metadata element | **Applied to production** 2026-08-25 |
| `20260814223552` pmt collection term | **Superseded** by `20260825124200` — stranded, same cause as Warner |
| `20260814233342` source capture inventory | **Retired** (owner ruling 2026-08-24, PR #1402) |
| `20260814233423` remaining source resolution | **Retired** (owner ruling 2026-08-24, PR #1402) |
| **`20260814170749` wb retire legacy capture paths** | **STRANDED — this handoff** |

### Verified read-only against production, 2026-08-25

Identity was proved in the same statement each time (see §7, trap 3).

- All eight legacy Warner tables hold **0 rows**.
- `plm.wb_property_character_normalized` holds **4,158 rows** — the real relationships.
- No legacy-target capture is in flight (`plm.wb_capture`, status `loading`/`validating`).
- `api.wb_property_character` and `api.wb_property_reconciliation` **still exist** and return zero rows.
- `20260814170749` is in **neither** the production nor the preview ledger. On preview it is still
  `[GENUINELY-PENDING]` — **its one rehearsal chance is unspent.**

### Not started

The Warner reissue itself. Blocked on §0 item 1.

## 4. Everything we tried that did NOT work

**Read this section before proposing anything. Each of these cost real time.**

1. **Recommending that the three Paramount migrations be RETIRED. Wrong — reversed.**
   The reasoning ("they sort below an applied repair and would revert it") was correct but incomplete.
   `20260825094455` already existed to close that trap, and retiring the trio would have left
   Paramount permanently broken, because the forward repair only rewrites the loader function — it
   does not create `plm.pmt_metadata_element` or relax the `NOT NULL` columns. Only the trio does that.
   Caught by an independent Grok 4.6 review, verified against the SQL, and corrected in PR #1497.
   **Lesson: check what a migration actually *creates*, not only which function body wins.**

2. **A single broad Grok review covering both decisions at once. Failed, cost $0.18 for nothing.**
   Session `unapplied-20260814-decisions` exhausted its 20-turn budget without producing a verdict.
   Splitting into two tightly-scoped briefs naming exact files produced a verdict in 4 turns for $0.04.
   **Lesson: one decision per review session, name the exact files to read.**

3. **Option A — rehearsing at the authoring commit. Impossible, not merely disallowed.**
   The idea: dispatch the preview rehearsal at PR #979's merge commit `5d17cbe`, so the producer files
   match the byte binding by construction. It cannot work — the workflow at that commit hard-codes
   `PREVIEW_PROJECT_REF: rjyboqwcdzcocqgmsyel` and asserts it on its first step, and that project was
   **deleted on 2026-08-18**. Authoring-era machinery has no live database to write to.
   **Do not re-test this.** It is closed for every stranded 2026-08-14 migration, not just Warner.

4. **Assuming `types/` had zero references to the dropped views. Slightly wrong.**
   `types/database.types.ts:28883` does carry a `wb_property_character` entry — the *generated table
   definition*, not a query. Caught by Muse Spark 1.2. It disappears on regeneration, which makes
   regenerating `types/` a required follow-up step, not an optional tidy-up.

5. **Applying the Warner cleanup when Albert authorized it. Deliberately NOT done — see §7 trap 1.**
   The authorized "preview rehearsal first" step would have permanently stranded the migration. Stopping
   and reporting was the correct action, and the option remains open only because of it.

## 5. Root causes and key findings

### Why the Warner migration cannot be promoted through its original file

The production business-risk gate — `scripts/production_business_risk_gate.py`, function
`prove_preview_producer_matches_main` — requires that the preview-apply evidence come from commits
carrying the **same producer files as the merge commit of the pull request that authored the version**.
The gate states its own purpose plainly:

> *"A version whose file changed after its rehearsal can no longer be recovered. That is the correct
> outcome and the entire point: preview never ran those bytes, so production must not be told that it did."*

`20260814170749` was authored by PR **#979**, merge commit **`5d17cbe8b6d9325bcd56ddfbb0e6a435facfb926`**,
merged 2026-08-14T19:06Z. Comparing the producer workflow blob:

```
PR #979 merge commit : d40f3c2a3fbb424654c566aeef29a2a88e85f00d
exact main today     : 1721b9d618888afce1e2db81adfdf35171802978
```

Different. So a rehearsal today yields evidence the gate must refuse.

### The root cause is two good changes colliding

Neither is a defect on its own:

1. **The byte-binding gate** (#1200, #1208, #1213) — a migration must have been rehearsed under the
   machinery that approved it.
2. **The preview rebuild of 2026-08-18** — the old preview project was deleted and replaced, so that
   machinery has no target left.

Together they leave **every migration merged without a preview rehearsal before 2026-08-18** with no
recovery path through its original file. `20260814223552` proved it on #679; Warner is the same class.

### What the migration actually does

Finishes retiring the first-generation Warner tables after the data moved to the normalized set. It
tightens the capture contract so new scrapes can only target current tables, then drops:

- **8 tables** — `plm.wb_asset`, `wb_style_guide`, `wb_character`, `wb_franchise_property`,
  `wb_property_character`, `wb_asset_character`, `wb_asset_style_guide`, `wb_asset_franchise_property`
- **18 functions** — `sync_wb_*` × 8 in `public`, × 8 in `plm`, plus `begin_wb_capture_legacy` and
  `finalize_wb_capture_legacy`
- **2 views** — `api.wb_property_character`, `api.wb_property_reconciliation`

No column renamed, no data rewritten. It also replaces the `wb_capture_target_chk` constraint
`NOT VALID` deliberately, to preserve historical capture headers.

**It is self-protecting.** Lines 4–46 are a `do $$` preflight that takes an advisory lock on
`plm.wb_capture_import`, refuses if any legacy-target capture is `loading`/`validating`, and refuses if
the eight tables hold a single row between them.

### Nothing later conflicts with it

Only two later migrations touch Warner objects, and both read **only** the normalized tables:
`20260816045120_wb_inferred_relationship_views.sql` and
`20260823175638_wb_canonical_relationship_edges.sql`. Nothing recreates what this file drops.

## 6. Exact next steps

**Do not start until §0 items 1 and 2 are answered.**

1. **Author the replacement migration.** New governed version (reserve it through the normal claim
   process — do not pick a timestamp by hand), carrying the SQL of
   `supabase/migrations/20260814170749_wb_retire_legacy_capture_paths.sql`.
   Re-derive from the file on `main`; do not retype it.
   *You'll know it worked when:* `scripts/check-sql.sh` passes and a byte-comparison against the
   original shows only the header/version differing.

2. **Do NOT edit the original merged file.** `tools/sync-warner-starlabs.test.mjs` (lines 47, 54)
   asserts its contents and will fail.
   *You'll know it worked when:* `node --test tools/sync-warner-starlabs.test.mjs` passes.

3. **Add `20260814170749` to the retirement set** — `RETIRED_VERSION_REASONS` in
   `scripts/post_batch_app_verification.py` and `HARD_BLOCKED` in
   `scripts/production_migration_guard.py` — with the reason: stranded, unrehearsable, replaced by
   `<new version>`. Follow the shape already used for `20260814233342`. Add a refusal test.
   *You'll know it worked when:* `python -m pytest scripts/test_production_migration_guard.py` passes
   and the next drift run labels it `[RETIRED]` rather than `[GENUINELY-PENDING]`.

4. **Open a PR, get the claim, merge through the guarded lane.** Nine required checks (§7 trap 5).
   *You'll know it worked when:* all checks green and the PR merges.

5. **Rehearse the NEW version on preview** through
   `.github/workflows/shared-supabase-migrations.yml`, `target: preview`, `mode: apply`, naming the
   new version in `preview_allowlist`, with `claim_pr` and `claim_head_sha`.
   *You'll know it worked when:* the run succeeds, preview's ledger holds the new version, and the
   eight tables plus two views are gone from preview.

6. **Promote to production** through the three gates of `AGENTS.md` §5.1-A — `production-apply-review`,
   immutable review evidence (`production-apply-review-evidence.yml`, verdict `APPROVE`), and the
   `production` environment. **This is a separate owner-authorized action; Albert must name it in chat.**
   *You'll know it worked when:* production's ledger holds the new version, `to_regclass` returns NULL
   for all eight tables, and `api.wb_inferred_*` views still work.

7. **Regenerate `types/`.** `types/database.types.ts:28883` still carries the legacy table definition.
   *You'll know it worked when:* no `wb_property_character` table entry remains and the file builds.

8. **Publish the completion record, then close #1517.** Closure alone no longer releases dependent work
   (#1366 Step 3):
   `node scripts/manage-migration-author-lanes.mjs --complete-work --issue 1517 --report-file <path>`
   Record needs `schema_version: 1`, `work_issue: 1517`, `outcome: "merged"`, `pr`, `merge_sha`
   (GitHub's own `merge_commit_sha`), `migration_versions: [<new version>]`.
   *You'll know it worked when:* it prints `Completion recorded on #1517 ... You may now close the issue.`

9. **Delete this handoff file** in the same commit that closes #1517.

## 7. Constraints and gotchas in force

1. **⛔ NEVER rehearse `20260814170749` on preview.** A migration gets **one** preview apply. Once
   applied it can never re-apply, so non-qualifying evidence strands it permanently — exactly how
   `20260814223552` died. Its chance is currently unspent. **Protect that.**
2. **Never apply, promote, or push any migration to preview or production without Albert naming the
   exact action in chat.** Preview rehearsal and production promotion are separate authorizations.
3. **Prove the target database before every write, and in the same statement as the write.** A useful
   production tell: `to_regclass('plm.pmt_metadata_element')` was NULL only on production before
   2026-08-25 — that specific tell is now dead, so pick a fresh one and state it.
4. **Work in an isolated worktree**, never the shared `C:\repos\shared-db` checkout — other sessions
   churn its branch and untracked files between turns (`AGENTS.md` §2.1-W).
5. **Nine required checks on `main`; no direct commits.** Never diagnose a stuck check from its name,
   and never propose `paths:` filters as a fix. Beware stale red verdicts (`AGENTS.md` §5.2) — check
   the run's commit SHA, not just the red X.
6. **Never `--include-all` against the full repo set** when promoting. Only inside the pruned bounded
   temp checkout (`docs/production-promotion-procedure.md`).
7. **"PREFLIGHT OK" is not an approval.** `strip_sql` removes dollar-quoted bodies, so a `do $$` block
   hides its apply-time references from the scanner completely. This migration's entire safety check
   lives inside a `do $$` block — the preflight cannot see it.
8. **`db push` is atomic per FILE, not per batch.** A batch that dies on file 40 leaves 1–39 applied
   and ledgered. Promote in small bounded batches.
9. **Do not edit another session's handoff, worktree, branch, or claim.** `.ai/*.md` in the shared
   checkout belongs to other sessions.
10. **Git identity** must read `Albert Hazan <u2giants@users.noreply.github.com>` — check with
    `git var GIT_COMMITTER_IDENT` before the first commit.
11. **On Windows Git Bash, `git rev-parse "ref:path"` mangles the colon.** Export
    `MSYS_NO_PATHCONV=1` first or you will silently compare a literal string instead of a blob.
12. **Do not route this to the shared-db orchestrator as repo-maintenance.** Issue #1517 is
    `work_type: structural`, which *does* route to the orchestrator. The 2026-08-21 ruling (#1366)
    only excludes repo-maintenance and documentation work.

## 8. Access and environment

- **`gh` CLI** — authenticated as `u2giants`. Used for issues, PRs, workflow dispatch, run logs.
- **Supabase MCP** — connected and **read-only**. Sufficient for every verification in this handoff.
  It cannot apply migrations; applying goes through the GitHub workflow.
- **Workflows:** `migration-ledger-drift.yml` (`-f target=production|preview`) — read-only, safe to run
  freely; `shared-supabase-migrations.yml` — the apply lane, gated;
  `production-apply-review-evidence.yml` — the non-writing evidence gate.
- **Secrets** live in 1Password vault **`vibe_coding`**. Never place values in chat, arguments, logs or
  commits. Database passwords reach CI through GitHub Actions secrets, not through a session.
- **Machine:** `edge-dev`. **Worktree used:** `shared-db-unapplied-migrations-287f13`.
- **Independent reviewers available:** `ai-grok-review` (Grok 4.6, real money — record the cost),
  `ai-muse` (Muse Spark 1.2), `ai-glm`, `ai-kimi`, `ai-qwen`, `codex-cli`. One decision per session,
  name the exact files, and never start a second review while one is running in the same repo.

## 9. Open questions and risks

- **Risk: someone rehearses the original on preview and strands it permanently.** The single largest
  risk here, and it looks like helpfulness. Mitigated only by §7 trap 1 and by #1517 saying so in its
  body. *(2026-08-25)*
- **Risk: other stranded migrations exist that nobody has enumerated.** Warner and `20260814223552`
  were found individually. Nobody has swept `main` for *every* version merged without a preview
  rehearsal before 2026-08-18. **Recommend that sweep as separate work** — the answer determines
  whether this is two migrations or twenty.
- **Open question: does the reissued version need a fresh independent review?** The SQL is unchanged and
  was reviewed twice (2026-08-23 audit; Muse Spark 1.2, 2026-08-25). My view: no new review of the SQL
  is needed, but the *reissue mechanics* — version, retirement entries, tests — should get one.
- **Decision, 2026-08-25: ship the cleanup without a replacement API view.** Both the 2026-08-23 audit
  (which reversed its own first instinct) and Muse Spark 1.2 concluded independently that adding a view
  is scope creep on a cleanup. Recorded so a later session does not silently re-add it.
- **Decision, 2026-08-25: do not weaken the byte-binding gate.** It is the last gate before a write to a
  database nine applications share. Every remedy here works *with* it.
- **Uncertainty: whether Albert wants the promotion-procedure exception written down** (§0 item 2). If
  he declines, expect this analysis to be re-derived from scratch by the next stranded migration.

---

## Self-audit (run 2026-08-25, all four questions answered against the file)

1. **Could a brand-new developer with no context continue without skipping a beat?** Yes. §1 defines the
   business, the repo, both databases, every schema, and what STARLABS is. §5 gives the root cause with
   the exact function name, both blob hashes, and the gate's own stated purpose. §6 gives nine numbered
   steps each with a verification gate.
2. **Could they continue as effectively as I can right now?** Yes. §4 carries all five dead ends
   including the two where I was wrong and had to reverse, with the reasoning that caught each. §5
   carries the non-obvious finding — that the stranding is two good changes colliding, not a defect —
   which took the whole session to isolate.
3. **Is every detail needed for flawless execution present?** Yes. Background §1, goal §2, current state
   §3 with commit/push status per artifact, failures §4, root cause §5, exact steps §6, constraints §7
   including the Windows `MSYS_NO_PATHCONV` trap that silently corrupts comparisons, access §8, risks §9.
4. **Would the owner see every decision he must make from §0 alone?** Yes — verified the hard way by
   walking §1–§9 line by line. Six items promoted: the reissue ruling (from §5/§6), the
   promotion-procedure exception (from §5), the replacement-view question (from §9), the two stale
   handoff files and the finished Paramount handoff (from the §0 sweep — none of these appear elsewhere
   in the document and would otherwise never have been raised), and the two unmerged doc commits (out of
   scope entirely, and exactly the category this rule exists to catch).
