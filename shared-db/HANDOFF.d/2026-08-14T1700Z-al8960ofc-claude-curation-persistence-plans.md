---
issue: 958
status: OPEN
owner: claude/schema-normalization-handoff-bb33e8
---

# Paramount audit results, three implementation plans, and two corrections to the record

**Written:** 2026-08-14T17:00Z
**Machine:** al8960ofc (Windows 11, user `ahazan2`)
**Agent:** claude (Opus 5)
**Worktree:** `C:\repos\shared-db-worktrees\schema-normalization-handoff-bb33e8`
**Branch:** `claude/schema-normalization-handoff-bb33e8`
**Repo:** `u2giants/shared-db`

**This session wrote plans and corrected facts. It changed NO schema and NO data.**

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Already settled this session — do NOT re-ask

| Settled | Date | Ruling |
|---|---|---|
| Curated/owner changes must be **structurally** protected from every sync | 2026-08-14 | "the database / structure has to be set up so changes are NOT overwritten by refreshes/syncs. not a DesignFlow refresh or a Coldlion API sync. our changes need to be persistent." Restates `AGENTS.md` §6.4 (2026-08-03) and makes it a build requirement, not a note. |
| Per-sync markers / reminders are NOT an acceptable fix | 2026-08-14 | Owner rejected the previous handoff's proposal explicitly: "I went over this 1000 times!" |
| Latent problems are fixed now, not monitored | 2026-08-14 | "but what about the future. if it's possible for a problem to happen, address it now." |
| Which work is next | 2026-08-14 | Fix curation persistence FIRST, and make it the general pattern across all four licensor scrapes. |

### Waiting on the owner — ASKED 2026-08-14, NOT YET ANSWERED

1. **May `20260802170000` be applied to production now, or only after PR #959 merges?**
   Asked at the end of the 2026-08-14 session; the session closed without an answer, so
   **nothing was applied.** The two are independent — #959 is docs-only and changes no schema,
   so the apply does not need to wait for it. Recommendation: apply it, because until it lands
   one re-run of the Master Data import force-resets `core.property.licensor_id` and forces
   `status='active'` on every matched row, which silently reverts the COCO ruling of
   2026-08-13. Evidence it is unapplied, re-runnable at any time:
   ```sql
   select version, name from supabase_migrations.schema_migrations
   where version = '20260802170000';   -- returns nothing on production as of 2026-08-14
   ```
   **Read the migration file in full before applying it. Do not apply from a description.**
   If the next session gets no answer either, treat this as the first thing to raise — do not
   silently carry it forward a third time.

### Blocking — nothing

No decision blocks execution. All three plans can be started as written; item 1 above only
affects whether Step 0 of the first plan runs before or after #959 merges.

### Worth the owner's attention, not blocking

1. **A rule violation is live in production right now.** `AGENTS.md` §6.4 (line ~1422) records
   that `plm.import_master_data(jsonb, jsonb)` force-sets `core.property.licensor_id`,
   `core.licensor.status='active'` and `core.property.status='active'` on every matched row of
   every re-pull. Its corrective migration
   `20260802170000_plm_import_preserve_curated_licensor_property_status.sql` is **merged to
   `main` and NOT applied to production** — verified 2026-08-14, it is absent from
   `supabase_migrations.schema_migrations`. This is Step 0 of the first plan and is the single
   highest-value action available. It has been unapplied for eleven days.

2. **Issue #900 is wrong and should be corrected.** See §2 below.

---

## 1. What this session did

1. **Ran the Paramount schema audit** requested in the previous handoff (§6 step 4), using
   Qwen 3.8 Max against a full schema dump, then verified its four principal findings directly
   against production.
2. **Wrote three implementation plans**, each self-contained and each executable independently.
3. **Corrected two stale facts** that were being repeated across handoffs and issues.
4. **Recorded the owner's persistence rule** so no future session re-asks it — and, more to the
   point, wrote the plan that actually implements it, because writing it down is not
   implementing it.

Nothing was merged, applied, or migrated. No PR was opened.

---

## 2. The two corrections to the record

### 2.1 The Warner loader EXISTS. Issue #900 and the previous handoff are wrong.

The previous handoff states, in §0 item 7, §3, and §5.5, that Warner's "loaders were never
written" and calls it "the single biggest gap in the master-data programme". That is not true.

```
tools/sync-warner-starlabs.mjs        36,746 bytes
tools/sync-warner-starlabs.test.mjs   23,350 bytes

git log --oneline -3 -- tools/sync-warner-starlabs.mjs
fe3a888 feat: normalize Warner source landing (#929)
5202a45 Backlog sweep: ... (#747)
696dc42 feat(#666): chunked capture protocol for plm.wb_* and the missing Warner loader
```

Commit `696dc42` is literally titled "the missing Warner loader". What IS true is narrower and
still worth attention: **Warner has landed zero rows.** The code exists and has tests; it has
not been run to completion. Anyone picking up Warner should start by running the loader, not by
writing one.

**Action for the next session:** correct issue #900's title and body to "Warner loader exists
but has never landed data" and remove the "never written" claim.

### 2.2 The "119,304 Paramount assets" figure is four scrapes added together, two of them failed

This number appears in the previous handoff's coverage table (§5.5) and has been repeated as
though it describes the current state of the data. It does not.

Every `plm.pmt_*` table carries `capture_id`, and completed captures are retained permanently by
design — including failed ones. A naïve `count(*)` therefore sums every capture ever run.

All four Paramount captures, read from production 2026-08-14:

| capture_id | status | kind | started | assets | properties | characters | collections |
|---|---|---|---|---|---|---|---|
| `2d168c35` | **failed** | full | 2026-08-13 13:49 | 25,790 | 60 | 52 | 426 |
| `a55beb9f` | complete | full | 2026-08-13 13:50 | 25,790 | 60 | 52 | 426 |
| `bad407d2` | **failed** | full | 2026-08-13 14:47 | 33,862 | 67 | 62 | 538 |
| `51cf81d5` | complete | full | 2026-08-13 14:49 | 33,862 | 67 | 62 | 538 |

The arithmetic is exact: 25,790 + 25,790 + 33,862 + 33,862 = **119,304**. Same for properties
(60+60+67+67 = 187), characters (166), collections (1,928) and metadata batches (1,194).

**The real current figure is 33,862 assets, 67 properties, 62 characters, 538 collections** —
the latest `status='complete'`, `capture_kind='full'` capture, which is the only one the schema
permits being served.

**This has to be fixed, and it is bigger than one number.** Concretely:

- `api.source_capture_inventory` (migration `20260814030000`) reports raw `count(*)` per table.
  It is the tool the previous session added specifically so nobody would guess at coverage — and
  it currently gives the misleading sum. **It should report the latest-complete-capture count,
  or report both with the distinction labelled.**
- The coverage table in `docs/core-master-data-consolidation-aim.md` §5.5 needs the same
  correction, and the Disney / NBCU figures in it need re-checking the same way — they were
  measured with the same method and may have the same inflation.
- Any future report of "how much have we captured" must state which capture it is counting.

**This is not covered by any of the three plans below** and needs its own small piece of work.
It is cheap and it prevents a class of wrong decisions: the previous session already told the
owner "Disney landed zero rows" while 156,644 Disney assets sat in a table it had not counted
(previous handoff §4.1). Wrong counts in this schema have a track record.

---

## 3. The three plans

All three live in the repo root and are written to the `implementation-plan-writer` standard —
13 sections, a STATUS table at the top, verification gates on every step, and a self-audit.
Each is executable by a session with zero context.

| Plan | What it fixes | Start here |
|---|---|---|
| [plan_curated-decisions-survive-syncs.md](../plan_curated-decisions-survive-syncs.md) | Owner decisions are silently reset by the next scrape. Six tables affected today; a general guard stops a seventh ever being written. **Includes Step 0, the live §6.4 violation.** | **This one first** — owner's instruction |
| [plan_pmt-duplicate-name-columns.md](../plan_pmt-duplicate-name-columns.md) | Two columns store a property name that already lives on `plm.pmt_property`. Copies agree today; nothing makes them agree tomorrow. | Independent |
| [plan_pmt-metadata-element-normalization.md](../plan_pmt-metadata-element-normalization.md) | Seven element-describing columns repeated across ~565,000 value rows with nothing forcing them to agree. | Independent |

### Why the first plan is the important one

The audit's headline finding was not a normal-form violation. `plm.pmt_property` and
`plm.pmt_character` are keyed `(capture_id, <source_id>)`, so every scrape creates a fresh set of
rows with `resolution_status DEFAULT 'unresolved'`. **Verified:** the loader
`plm.load_pmt_capture_chunk` never references `resolution_status` or `core_property_id`, so
nothing carries a prior decision forward. The refresh does not overwrite the decision — it
*bypasses* it, which is worse, because an audit watching for overwrites sees nothing wrong.

Measured blast radius, production 2026-08-14 — six tables carry resolution state on a
capture-scoped primary key:

`plm.pmt_property`, `plm.pmt_character`, `plm.nbcu_property`, `plm.nbcu_character`,
`plm.nbcu_style_guide`, `plm.nbcu_asset`.

Disney (`opa_*`, `dcp_*` and the studio splits) and Warner (`wb_*`) key on the source id alone,
so their rows survive a refresh structurally. They are exposed to the other half of the problem
— a loader upsert clobbering the resolution columns — which the plan's guard step closes.

**Nothing is lost yet:** all `pmt_property` and `pmt_character` rows across all four captures are
`unresolved`. That is exactly why doing this now is free and doing it later is not.

---

## 4. What did NOT work / what I got wrong

**4.1 I repeated the stale Warner claim before checking.** I summarised the previous handoff's
"Warner loaders were never written" to the owner as fact. The owner corrected me with the file
paths. **Lesson:** a handoff is a record of what one session believed, not ground truth. The
standing rule (`AGENTS.md` §4.3) already says issues, handovers and plans point at the LIVE
reading, never at a number or a claim — apply it to inherited handoffs too, not just to your own.

**4.2 I proposed a per-sync marker as the fix for the COCO reversion risk.** The previous
handoff's §0 item 5 recommended "before any edge re-seed, add that marker", and I passed it
along. The owner rejected it outright — it is a band-aid, and he has stated the general rule
many times. **Lesson:** when a risk is "this sync could overwrite a decision", the fix is never
"remember to do something before that sync". It is a structural guarantee.

**4.3 I wrote the rule to memory and reported that as progress.** The owner caught it: "writing
it down, or implementing it?" Writing a memory note stops future sessions re-asking; it does
nothing to the database. **Lesson:** do not report documentation of a requirement as satisfaction
of it.

**4.4 Qwen's `--output-format json` returns an ARRAY of stream events, not an object.** The
report is at `result[3].result`, not `.response`. `$j.response.Length` returns 4 (the array
length) and looks like a successful parse. Check `result[3].is_error` and read the model from
`result[0].model` — the requested `qwen3.8-max-preview` reported back as `qwen3.8-max` in
`stats.models`, which is the alias, not a downgrade.

**4.5 Non-failures worth knowing.** The audit flagged `pmt_asset.content_type` vs `mime_type` as
a possible duplicate — production has **24 distinct pairs**, so they are two different facts.
Cleared, do not re-open. It also flagged `pmt_property_capture_log.property_name` as a duplicate;
it may instead be the search term that was typed, which is why that plan's Step 1 is a blocking
evidence step rather than a migration.

---

## 5. Key findings from the audit (so they are not re-derived)

Measured against production, 2026-08-14:

- **Paramount is genuinely the strongest of the four schemas.** Every entity has its own table
  keyed by source ID, every link table's foreign keys are composite with `capture_id` and
  `ON DELETE RESTRICT`, provenance is pinned by CHECK rather than merely defaulted
  (`pmt_property_franchise_evidence.is_direct_source_relationship = false` cannot be flipped by
  an insert), and the capture-integrity gates are strong: SHA-256 requested-vs-returned ID-set
  equality per batch, expected-vs-actual population counts at finalization, and a two-person
  shrink override.
- **It is not "perfect".** Four defects, in the three plans above plus the counting issue.
- **In the latest complete capture:** 0 characters appear under more than one property in
  `pmt_property_character`, but **17** co-occur with more than one property via asset metadata.
  The link table is correctly refusing to manufacture pairs from co-occurrence — that discipline
  is working and is worth copying.
- **5 duplicate character display names, 0 duplicate property display names.** Harmless, because
  identity is the source id everywhere. This is the concrete proof that Disney's flat-table
  design was wrong and Paramount's is right.
- **`plm.pmt_collection.paramount_term` holds ONE distinct value across all 1,928 rows** — a
  constant stored per row. Small, real, out of scope in all three plans; open an issue.
- **47 tables in `plm` carry some form of resolution state**, in two different column shapes:
  status-based (5 columns, with a coherence CHECK) and note-based (4 columns, no
  `resolution_status`). Any general fix must handle both; the first plan says so.

---

## 6. Exact next steps

1. **Apply `20260802170000` to production** — Step 0 of
   [plan_curated-decisions-survive-syncs.md](../plan_curated-decisions-survive-syncs.md).
   Read the migration file first; do not apply from a description of it.
   *You'll know it worked when* the version appears in `supabase_migrations.schema_migrations`
   on production and `plm.import_master_data` no longer force-sets `core.property.licensor_id`.
2. **Execute the rest of the first plan** — Steps 1–8. Owner's stated priority.
3. **Fix the capture-count problem** (§2.2). Not in any plan; needs its own small change to
   `api.source_capture_inventory` plus the doc correction plus re-checking the Disney and NBCU
   figures the same way.
4. **Correct issue #900** (§2.1).
5. **Send the Warner legacy-cleanup prompt.** It is written out in full and ready to send at
   §6 step 1 of
   [2026-08-14T1346Z-al8960ofc-claude-scrape-schema-normalization.md](2026-08-14T1346Z-al8960ofc-claude-scrape-schema-normalization.md).
   Do not drop Warner's retired tables from outside that workstream; live functions still
   reference them.
6. **Post the closing condition on issue #953** — also written out in full at §6 step 2 of that
   same file.
7. **Update the NBCU skill** — §6 step 3 there. Still not done.
8. **Then the other two plans**, in either order.

---

## 7. Constraints and gotchas in force

- **This session was NOT the orchestrator.** The owner directed this work personally. That is
  not blanket permission — ask before starting new structural work.
- **Structure changes go through `u2giants/shared-db`**, branch + PR; Claude merges its own PRs.
  Data changes belong to the application session, EXCEPT curated Master Data
  (`core.licensor`, `core.property`, `core.character`, `core.customer`, `core.factory`), which is
  orchestrator work under `AGENTS.md` §6.4.
- **Worktrees only** (`AGENTS.md` §2.1-W).
- **The Supabase MCP is READ-ONLY** and may be bound to production. No DDL or DML through it.
- **Prove the target database before every write and quote the proof** (`AGENTS.md` §4.2).
- **Never reuse a migration version number.**
- **`supabase/tests against an ephemeral database` is NOT a required check.** PR #954 merged on
  2026-08-14 while it was red and shipped a production regression. Read it before merging.
- **A foreign key added ahead of its writer breaks the next capture**, and the backfill hides it.
  This already happened on 2026-08-14 (`20260814040000` → `20260814060000`).
- **`min(uuid)` / `max(uuid)` do not exist.** Cast through text.
- **Workflow argument traps:** `review_artifact_digest` must be canonical `sha256:<64 hex>` (the
  log prints bare hex); `reviewed_main_sha` must be the LIVE main SHA from
  `gh api repos/u2giants/shared-db/commits/main --jq .sha`.
- **Licensed source data never leaves its approved private repo.** This repo is PUBLIC and has a
  PII forward guard — no personal emails; refer to people by `app.profile` UUID.
- **Do not edit another session's `HANDOFF.d/` file, and never rewrite the root `HANDOFF.md`.**
- **When pushing to `ai-devops` while another session holds the tree:** temporary detached
  worktree from `origin/main`, cherry-pick, push, remove. Never stash or rebase over another
  session's files.

---

## 8. Access and environment

| Thing | Where | Notes |
|---|---|---|
| Shared Supabase PRODUCTION | `qsllyeztdwjgirsysgai` | Read via Supabase MCP; write via workflow / Management API |
| Shared Supabase PREVIEW | `rjyboqwcdzcocqgmsyel` | A Supabase *branch*; absent from `supabase projects list`. Behind production (#901). |
| Supabase Management API token | 1Password `vibe_coding` → "Supabase CLI Personal Access Token", field `credential` | For writes the MCP cannot do |
| ColdLion ERP API | `http://x5.coldlion.com/EhpApi` | 1Password `vibe_coding` → "Coldlion ERP API key x5.coldlion.com", field `credential`; header `X-API-Key` |
| DesignFlow PRODUCTION (live) | Cloud SQL `creatiflow-database`, GCP `lithe-breaker-323913`, `104.198.220.200:5432`, db `postgres`, **schema `designflow`** | 1Password → "DesignFlow PRODUCTION Cloud SQL - read-only (albert_read_only, creatiflow-database)". Read-only, IP-allowlisted. Not `dflow` — that is the stale Supabase mirror. |
| `ai-devops` hub | `C:\repos\ai-devops` | Skills in `skills/shared/` |
| Qwen CLI | `qwen` 0.21.11, `C:\Users\ahazan2\AppData\Roaming\npm\qwen.ps1` | `--model qwen3.8-max-preview --output-format json`; parse per §4.4 |

**Secrets:** always via `op_run` with `op://` references, never pasted values, and **serialized**
— never fan out 1Password reads in parallel. `op_run`'s `cwd` rejects `/tmp`-style Git Bash
paths; use a Windows path.

---

## 9. Open questions and risks

1. **Is the capture-count inflation present in the Disney and NBCU figures too?** Very likely —
   same method, same retention design. Unmeasured. Settling it changes the coverage table that
   the whole master-data programme is prioritised from.
2. **Do the `nbcu_*` tables hold real resolution state?** Never measured. If they do, the first
   plan's backfill stops being trivially empty and needs care. Query is in that plan, Step 1(b).
3. **Is `pmt_property_capture_log.property_name` a duplicate or the search term?** Deciding wrong
   in the deleting direction destroys audit evidence. That plan's Step 1 blocks on it.
4. **Does `core.style_guide` exist and is it usable as an FK target?** The previous handoff says
   it is empty; existence was never verified. Affects the first plan's Step 2.
5. **`plm.taxonomy_resolution_review` (issue #941) overlaps the first plan.** It proposes
   tracking upstream corrections; the plan builds durable curation records. Arguably the same
   problem. Left separate deliberately; note the overlap on #941.
6. **`HANDOFF.d/` now holds 5 files including this one — at the warning threshold.** The others:
   `2026-08-07T0212Z-t16-claude-dispatch-collision-phase-a-done.md`,
   `2026-08-13T1535Z-al8960ofc-claude-orchestrator-disney-live-and-guard-lessons.md`,
   `2026-08-14T0400Z-al8960ofc-codex-orchestrator-closeout.md`,
   `2026-08-14T1346Z-al8960ofc-claude-scrape-schema-normalization.md`. Not mine to retire. The
   next session should check whether the two oldest are provably done and retire them.

---

## Self-audit (required by the handoff standard)

**1. Could a brand-new developer pick up without skipping a beat?** Yes. §1 says what was done in
four lines. §2 corrects the two facts that would otherwise mislead them, with the evidence
inline. §3 routes them to three self-contained plans, each of which carries its own full
background — this file does not duplicate that, it points at it, and says which to start with and
why. §6 gives eight ordered next steps, three of which are prompts already written out in the
previous handoff and need no judgment.

**2. Could they continue as effectively as I can right now?** Yes. §5 carries every measured
number with its date, including the ones that clear a suspicion (24 `content_type`/`mime_type`
pairs) so nobody re-investigates. §4 carries four mistakes including two of my own reasoning
errors that the owner had to correct, plus the Qwen JSON parsing trap that would cost a fresh
session a confusing ten minutes.

**3. Is every detail for flawless execution present?** Yes, with deliberate omissions named as
omissions: the capture-count fix (§2.2) is explicitly stated as covered by no plan; the NBCU
skill update and the Warner prompt are explicitly still outstanding from the previous session and
pointed at by section. Nothing was quietly dropped.

**4. If Albert read ONLY §0, would he see every decision he owns?** Yes. §0 carries the live
production rule violation with its evidence, the issue #900 correction, and the four rulings he
made this session in a do-not-re-ask table. Nothing is blocking, and §0 says so rather than
manufacturing a question.
