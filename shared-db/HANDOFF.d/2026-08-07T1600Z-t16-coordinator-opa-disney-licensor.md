# Coordinator handover — Disney OPA lookup, licensor identity, ColdLion source

- **Session:** `774f5010-1b71-4c45-b45c-b250053f5c4d`, coordinator, machine **t16**
- **Coordinator marker:** GitHub issue **#473** (closed at handover)
- **Written:** 2026-08-07 ~16:00 UTC
- **Ended cleanly.** Not a crash, not a context-loss handover.

> **Read this before you read anything else in this file:**
> **`u2giants/shared-db` was a PUBLIC repository until 2026-08-07 ~15:10 UTC and
> contained Disney's confidential licensee data. It is now PRIVATE. See §1.**

---

## 0. If you read only one page

| | |
| --- | --- |
| **What was asked** | Build the Disney OPA property→character list as a lookup table |
| **What was delivered** | Five merged verification/design documents, one applied-to-preview migration, a private data repo, and a public-exposure containment |
| **What was NOT delivered** | **The lookup table itself. It does not exist.** No OPA table, no OPA data in any database |
| **Most urgent inherited item** | **R-SEC-1** in `COORDINATOR_INTAKE.md` — move Disney's CSV to the private repo and scrub it from history |
| **Most dangerous inherited item** | **No migration protects `core.property.licensor_id`.** Every curated licensor parent reverts when the DesignFlow pull is repaired |
| **Open PRs** | **0** |
| **Open `db-claim` issues** | **0** |
| **Live agents** | **0** |

---

## 1. THE SECURITY EVENT — read first, act first

**What happened.** `u2giants/shared-db` was created PUBLIC on 2026-06-20 and
remained public until **2026-08-07 ~15:10 UTC**. During that period it contained
`docs/verification/opa-characters-20260806/opa-characters.csv` — **10,262 rows of
Disney's property and character list, carrying Disney's own internal ID numbers**
— merged in PR #466 earlier that same day. The README committed beside it states
in its own words that the data is business-confidential and must not be
published. It was published anyway.

**It was found by an automated security warning on a sub-agent's PR**, not by any
person and not by any process in this repo. Nothing in `AGENTS.md`, the
orchestrator skill, or CI checks repository visibility before a commit. **That
gap is still open.**

**What was done.** The coordinator verified visibility with
`gh repo view u2giants/shared-db --json visibility` (returned `PUBLIC`), reported
it to Albert in plain English, and on his explicit instruction ran
`gh repo edit u2giants/shared-db --visibility private --accept-visibility-change-consequences`.
Verified `PRIVATE` immediately after.

**Exposure indicators at the moment of the flip — measured, not assumed:**

```
forks: 0    stars: 0    watchers/subscribers: 0
created: 2026-06-20T21:37:49Z    pushed: 2026-08-07T14:31:24Z
```

**Zero forks is the important one** — a fork of a public repo survives the parent
going private and would have retained the data permanently. There were none.
This is **not proof nobody read it**; crawlers and caches leave no trace.

**Albert's decision.** Private now; move the data to a private home and link to
it from here **so `shared-db` can be made public again**.

**What the next coordinator must do — this is R-SEC-1 in the REQUEST QUEUE:**

1. Move `opa-characters.csv` to **`u2giants/licensor-source-data`** — created by
   this session on 2026-08-07, **PRIVATE**, currently **EMPTY**.
2. Leave a **pointer only** in `shared-db`. No data.
3. **Scrub the CSV from `shared-db` git history.** Deleting the file is not
   enough — git keeps every version forever. Until this is done the repo can
   never go public again.
4. Only then consider restoring public visibility.

⚠️ **Step 3 rewrites history and breaks every existing clone and worktree,
including any live session's.** Do it once, deliberately, when nothing else is
running. Steps 1 and 2 are safe immediately.

⚠️ **Decide the scrub scope deliberately.** The raw CSV is the crown jewel, but
five merged documents also carry bulk licensor data, production project refs and
table UUIDs. Analysis *about* the data is not the same as the data; that is a
judgement call, not an automatic sweep.

⚠️ **Two live scraping sessions are producing MORE of this data right now** — one
on Disney OPA, one on Warner Bros (properties, characters, style guides, asset
file names). Albert took responsibility for telling both to hold and commit only
to `licensor-source-data`. **Verify they actually did before assuming it.** Two
paste-ready prompts and an addendum were supplied to Albert in chat; they are not
in the repo.

---

## 2. Coordination state — half (a)

### Live facts, stamped

| Fact | Value | Checked |
| --- | --- | --- |
| `origin/main` tip | `a109703105be6417a0caaa9673d69146ffd064cb` | 2026-08-07 ~15:55 UTC |
| Max migration version | `20260807030000` | 2026-08-07 ~15:55 UTC |
| Duplicate migration versions | **none** | 2026-08-07 |
| Open PRs | **0** | 2026-08-07 ~15:50 UTC |
| Open `db-claim` issues | **0** | 2026-08-07 ~15:50 UTC |
| Repo visibility | **PRIVATE** | 2026-08-07 ~15:10 UTC |

**`origin/main` moved roughly a dozen times during this session**, largely from
other uncoordinated sessions merging docs PRs. Re-derive everything above before
acting. Do not trust this table.

### File ownership at handover

| File | Owner |
| --- | --- |
| `supabase/migrations/` | **NONE** |
| `HANDOFF.md` | **NONE** |
| `AGENTS.md` | **NONE** |
| everything else | **NONE** |

All agents finished. Nothing is held.

### Preview state — honestly

**NOT clean.** Preview `rjyboqwcdzcocqgmsyel` carries migration
**`20260807030000`**, applied by this session's agent at **2026-08-07 03:07 UTC**
and re-verified at 03:27 UTC (`"Remote database is up to date"`). State on
preview: `core.property` COCO re-parented to DISNEY, plus one
`core.taxonomy_owner_ruling` row.

⚠️ **The Supabase branch named `main` reports `status: MIGRATIONS_FAILED`**
(observed via `list_branches` metadata, 2026-08-07). **Nobody investigated it.**
Look before the next promotion — a promotion planned against a broken preview
proves nothing.

⚠️ **`core.taxonomy_owner_ruling` exists on preview but NOT on production.** A
static `INSERT` against it would pass every preview test and fail at promotion.
This is a class of failure preview structurally cannot catch.

### Worktrees

| Path | Branch | Status |
| --- | --- | --- |
| `C:/repos/shared-db` | `main` | the shared checkout — **do not work in it** |
| `C:/repos/shared-db-worktrees/order-list-plan` | `codex/plan-popdam-order-list` | **another session's, left deliberately.** Has one untracked file, `.ai/reviews/glm-popdam-order-list-plan-review-20260807T120915Z.md`. **NOT mine. Do not clean it up.** |

Every worktree this session created has been retired. All were clean and fully
pushed at removal; nothing was lost.

### Blocked on Albert

Four decisions, itemised in the `⛔ ALBERT` block in `COORDINATOR_INTAKE.md`.
**Do not act on any without a fresh answer in the current chat.**

1. Whether the many-to-many junction is still wanted (its premise collapsed — §4)
2. How far Disney may overwrite our curated names
3. Whether "follow ColdLion into deletion" applies to licensors/properties
   (**asked and dismissed without answering — still open**)
4. Whether to download actual asset files from the licensor portals

---

## 3. Half (b) — every sub-agent, separately

### Agent: intake/doc summariser (`Explore`, read-only, no worktree)

- **Asked to do:** summarise the OPA request + supplement + closing note, the
  REQUEST/INTAKE queues, the `HANDOFF.md` backlog, the characters workstream, and
  dedupe against PR #468.
- **Actually did:** returned the three blocks verbatim with line anchors, a
  66-row queue inventory, the B1–B14 backlog list, and a full read of PR #468.
- **Found:** PR #468 **OVERLAPS but does not duplicate** the OPA request — its
  diff is one file, +188/−0, prose only, **no DDL, no table design**. Flagged two
  live contradictions in `COORDINATOR_INTAKE.md` without resolving them, and
  found `HANDOFF.md:4281` already carried an OPA pointer, contradicting the
  supplement's claim that it did not.
- **PR / branch:** none (read-only).
- **Worktree:** none.
- **Deliberately did NOT do:** resolve the contradictions it flagged — correct;
  the coordinator re-derived them.

### Agent: OPA lookup design (`agent/opa-lookup-design-20260807`)

- **Asked to do:** read-only design for landing the OPA extract; find the real
  vendor-landing pattern; answer §7 Q3 (Disney as licensor) without choosing.
- **Actually did:** commit `c829f6a` → **PR #476, MERGED** 2026-08-07 02:13 UTC.
  One file, `docs/verification/opa-characters-20260806/DESIGN.md`.
- **Found:** `core.character` = **0 rows, measured**. **There is no `coldlion`
  schema** — the real pattern is `plm.erp_*` raw mirrors + `api.*` views.
  **Corrected three README claims:** the (property name, character name) pair is
  **NOT** unique (10,240 distinct vs 10,262 rows, 22 collisions); it is the **ID**
  pair that is unique; 1,444 property names vs **1,445** IDs; "roughly 670"
  recurring names is really **609**. `characterID` is a usable identity key
  (9,613 distinct, none mapping to two names). **The coordinator re-verified every
  one of these against the CSV independently — all exact.**
  Also: **`pg_stat_user_tables.n_live_tup` is STALE on this database** (returned
  0 for tables holding thousands). One row carries negative sentinel IDs
  (`Special Projects`, `-9999`/`-9998`).
- **PR / branch:** #476 merged; branch deleted.
- **Worktree:** finished, retired.
- **Deliberately did NOT do:** choose the Disney licensor (owner gate — presented
  four options, recommended storing none); the `core.property` reconciliation
  (deferred by brief as a cross-app contract); sample the exact OPA ↔
  `public.characters` intersection.

### Agent: Disney licensor identity (`agent/disney-licensor-identity-20260807`)

- **Asked to do:** read-only census; establish whether `DY` and `DS` are one
  company; map the blast radius; frame Marvel/Star Wars; report `NO LICENSE`.
- **Actually did:** commit `6897b82` → **PR #479, MERGED**. One file,
  `docs/verification/disney-licensor-identity-20260807/README.md`.
- **Found:** **`DY` and `DS` are the same company**, on four independent proofs.
  The decisive one: `supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql`
  hard-codes `case … when 'DS' then 'DY' when 'WWE' then 'WW'` at lines 19, 27 and
  221, and **136,697 `public.assets` plus 10,618 `public.style_groups` rows were
  rewritten on that basis**. **The coordinator verified this line first-hand.**
  Also: 8 of 10 codes match byte-for-byte; 4,048 `plm.style_tracker_item_bridge`
  rows carry both UUIDs; `core.licensor` is authoritative (20 FKs vs 2).
  **Our database contradicts itself about Coco** — `core.property` has it under
  `DTR - NO LICENSE` while `public.properties` already has it under Disney.
  **Marvel/Star Wars evidence points AGAINST merging them** — ColdLion, which pays
  the royalties, lists DISNEY/MARVEL/STAR WARS as three separate licensors.
- **PR / branch:** #479 merged; branch deleted.
- **Worktree:** finished, retired.
- **Deliberately did NOT do:** choose whether `DY` or `DS` is the canonical *code
  string* (owner gate). Left untouched: 103 `public.assets` under `NO LICENSE`
  with no property; the `WWE`/`WW` twin; `MIRACULOUS` filed under Disney though it
  is a ZAG property. **Its §3.2 app read/write map was inferred from schema and
  migrations with NO app repo read** — it said so.

### Agent: Coco reparent (`agent/coco-disney-reparent-20260807`) — the only WRITE agent

- **Asked to do:** apply Albert's Coco ruling; add the `DY`-is-canonical note to
  `AGENTS.md`; rehearse on preview; leave the PR open for review.
- **Actually did:** `150d6dc` → `beaef31` → `e0709e7` → **PR #481, MERGED**
  2026-08-07 03:42 UTC. Three files, **+1058/−0**: migration
  `20260807030000_owner_ruling_coco_is_a_disney_license.sql`, its contract tests,
  and `AGENTS.md` (**one hunk at line 1242, 58 added, 0 deleted** — byte-compared
  either side and verified by the reviewer).
- **Found:** **`AGENTS.md` §6.6 rule 5 was factually WRONG** — it claimed
  `20260802170000` stops `plm.import_master_data` overwriting
  `core.property.licensor_id`; that migration preserves **status only** and says
  so at its own line 36. **No parentage-durability migration exists anywhere.**
  Corrected in new §6.12. Also: the evidence doc's prediction that 15
  `public.assets` needed moving was **wrong in our favour** — all 15 already
  carried `licensor_id = DISNEY` while their property pointed at `ZZ`; they were
  self-contradictory and the migration removes the contradiction rather than
  writing any asset row.
- **PR / branch:** #481 merged; branch deleted.
- **Worktree:** finished, retired.
- **Deliberately did NOT do:** promote to production; retire `public.licensors`;
  touch Marvel/Star Wars; the 103 `NO LICENSE` assets; `MIRACULOUS`.
  **It pushed back on a coordinator instruction and was right** — told to move the
  audit block before the early `return`, it refused with reasoning: by the time
  `core.taxonomy_owner_ruling` exists on production this migration will already be
  in the ledger and will never re-run, so only a separate forward migration can
  backfill. Accepted.
- **Machine change:** installed a PostgreSQL 18.4 client via `scoop` (user-space,
  no admin, no system binary touched) plus an idle local cluster under `~/scoop`,
  to build a disposable local database for the test rewrite. **It was not there
  before. Remove it if unwanted.**

### Agent: independent review of PR #481 (read-only, no worktree)

- **Asked to do:** obtain an independent model's review, then verify every finding
  against the code before relaying it.
- **Actually did:** Codex `gpt-5.6-sol`, **medium** reasoning effort (header
  verified on both runs). Verdict REQUEST CHANGES → **APPROVE** after rebuttal.
- **Found:** two "High" findings **refuted or downgraded** with live schema
  evidence (both null-permissive examples impossible — the columns are `NOT NULL`;
  the concurrency finding real but the only automated writer dormant since
  2026-07-08). **Three CONFIRMED:** the negative tests were a **false safety
  signal** — the file's header claimed savepoints and re-execution of the
  migration's `DO` block, and there were **zero savepoints**; `E4` queried
  `pg_proc.prosrc` for an **anonymous `DO` block, which never lands in
  `pg_proc`**, so it would have passed with the bug present. Also refuted the
  author's stated reason for the dynamic `EXECUTE` (PL/pgSQL plans embedded SQL
  lazily, so a static `INSERT` would not fail at parse time) while confirming the
  guard itself is correct.
- **Deliberately did NOT do:** merge anything; treat any model finding as true
  without checking it against the code.
- **Coordinator action:** independently confirmed the zero-savepoint and
  `pg_proc` defects, **refused to merge**, and sent it back. The agent rewrote the
  tests to load and execute the **real migration file** via a `pg_temp` helper —
  no second copy of the guard logic — with paired triggering/control fixtures in
  real savepoints, then **observed each guard FAILING when neutralised** (5 of 5,
  including the timezone trap producing `2026-08-05`). Only then merged.

### Agent: DS→DY at source (`agent/ds-to-dy-20260807`)

- **Asked to do:** prove where the source of `DS` actually is; full blast radius
  **including app repos**; plan the forward migration; do not execute.
- **Actually did:** commit `faef19b` → **PR #483, MERGED**. One file,
  `docs/verification/ds-to-dy-at-source-20260807/README.md`.
- **Found:** **"at its source" really is the `public.licensors` row** — no
  migration creates or seeds it, no function writes it, rows predate
  `core.licensor` by three months, and the only live writer is a human PopDAM
  admin via RLS policy `Admin write licensors`. **The hard-code survives in
  exactly one live object**, the view `public.dam_character_catalog`, and degrades
  to a pass-through. **A trap that would have corrupted data:** 30 `public.assets`
  and 6 `public.style_groups` carry `licensor_code = 'DS'` that is **not Disney**
  — the letters are a substring of the SKU (`MCZ6X**DS**PT01`); a blanket sweep
  would have labelled 30 unlicensed products as Disney. Also found
  `tools/process-style-guide-licensing-review.mjs:123` uses `'WW'` for **Wonder
  Woman** while `core.licensor` uses `WW` for **WWE**.
- **PR / branch:** #483 merged; branch deleted.
- **Worktree:** finished, retired.
- **Deliberately did NOT do:** execute anything. **Named one honest blocker:
  `popdam3` is not on this machine and was NOT read**, and it owns the only live
  write path. Read it before executing.
- ⚠️ **This agent triggered the security warning that exposed the public-repo
  problem.** Its PR was legitimate work; the warning was correct about the
  underlying condition.

### Agent: OPA as source of truth (`agent/opa-truth-20260807`)

- **Asked to do:** redesign on Albert's "OPA is the source of truth" ruling; then,
  after a mid-run ruling, design the many-to-many junction.
- **Actually did:** commit `1be69cd` → **PR #485, MERGED**. One file,
  `docs/verification/opa-source-of-truth-20260807/README.md`. **Supersedes**
  `DESIGN.md` from PR #476.
- **Found — and this is the most consequential finding of the session:**
  **the premise of Albert's many-to-many ruling does not survive measurement.**
  Of the 609 `characterID`s under more than one property, **561 are the same
  property written twice** (`- No Likeness` / `- With Likeness`) and **42 are one
  Disney data-entry error** (`Morbius Movie 2020 - No Likeness` holds 32
  characters, **30 named `( MS Disney Plus TV Shows )`**). **Genuine residual: ~6
  of 9,613 — 0.06%.** One property per character survives Disney's own data.
  Also verified the prior review's numbers exactly: 2,951 canonical Disney-family
  names, 2,743 in OPA (93.0%), 208 misses, **147 pure surname ordering, 61 real**;
  destructive following would delete **58** rows, several of which are our own
  defects (`agony (symbiote` with an unclosed bracket; `baxter building`, a
  location).
- **It raised, then RETRACTED, its own conclusion — record this so nobody
  restarts it.** It first argued OPA's "property" **is** a style guide, on an
  exact-key join: 178/178 `licensedPropertyID`s present with byte-identical names,
  168/178 with identical character-ID sets. **The coordinator verified the
  measurements** (`92` → `101 Dalmatians`, `1159115273` → the Marvel "No Likeness"
  entry, 147 likeness properties) **and then challenged the inference**, requiring
  three discriminating tests. **All three went against it:** cardinality is
  strictly **1:1**; 1,444 names collapse to only **1,354** base names; and the
  ~1,267 unmatched OPA nodes are largely 20th Century Fox / ABC titles (`24`,
  `28 Days Later`, `ABC News`). **Retracted in its §3.6: OPA lists properties at
  contract granularity.** This agrees with Laura at the licensing company.
  It states plainly that it **cannot** distinguish "OPA is upstream" from "a newer
  snapshot of a shared feed" and does not claim it.
- **PR / branch:** #485 merged; branch deleted.
- **Worktree:** finished, retired.
- **Deliberately did NOT do:** choose either owner gate; edit the merged
  `DESIGN.md` (wrote a superseding document instead). **Designed the junction
  table as ruled but recommends NOT building it**, because it would duplicate
  `core.style_guide_character`.

### Agent: ColdLion as source (`agent/coldlion-source-20260807`)

- **Asked to do:** answer "what is needed to have ColdLion API as the source
  without breaking anything?"; size the mapping; refresh the nine blockers; read
  the app repos; do not soften the verdict.
- **Actually did:** commit `2576ae2` → **PR #484, MERGED**. One file,
  `docs/verification/coldlion-as-source-20260807/README.md`.
- **Found:** **there is no name-mapping problem** — across all **271** entities in
  both systems (19 licensors, 252 properties) **not one name differs**. The
  mapping is **47 rows**: 33 ColdLion-only properties, 4 Supabase-only, 3
  ColdLion-only licensors, 7 Supabase-only. **ColdLion licensor/property has never
  reached production at all**; production is **39 merged migrations behind
  `main`**. **The dead PLM feed reports `succeeded` on all 15 `ingest.sync_run`
  rows** — a silent failure on the most important feed in the project. **The famous
  "111 unparented properties" is NOT a Supabase condition** — Supabase has zero
  orphans; they are in DesignFlow's Cloud SQL, and every document repeating it
  reads as ours. **92,173 `public.assets` rows carry a `core.licensor` id with
  `ON DELETE SET NULL`** — the concrete meaning of "breaking something".
  **`core.character` is `ON DELETE CASCADE` on `core.property`** — empty today,
  about to be filled, never flagged before. **15 of 22 ColdLion licensor codes are
  also property codes**, so a code-keyed mapping is guaranteed to corrupt.
  **Killed a stale plan:** `docs/coldlion-source-of-truth-plan.md`'s headline
  blocker was PR #331, which **merged 2026-07-31T13:59:05Z** — coordinator
  verified that timestamp exactly.
- **PR / branch:** #484 merged; branch deleted.
- **Worktree:** finished, retired.
- **Deliberately did NOT do:** move anything, resolve the §6.3 deletion conflict
  (owner gate), or investigate the `MIGRATIONS_FAILED` preview branch it spotted.
  **Held the verdict unsoftened:** still the hardest table set to move, and
  `age_group` (PR #435) should still be the rehearsal first. **Named its own gap:
  `popdam3` and `poppim-web` are not on this machine and were NOT read**, though
  it did read `popcrm-web` and all six `designflow-*` repos, finding ~150
  hard-coded brand/character strings in `desc-cleaner.ts`.

---

## 4. What we tried that did NOT work — MANDATORY

| Attempt | What happened | The lesson |
| --- | --- | --- |
| `gh issue list --label coordinator-marker --state open` | Returned **EMPTY** for a marker issue that provably carried the label (#473, verified by direct `gh issue view`). | **This command lies in this repo.** Use `gh api "repos/u2giants/shared-db/issues?labels=<label>&state=open"`. Trusting the empty result would let a second coordinator claim a marker while one is live. Same caveat for `db-claim`. |
| `check-dispatch-collision.mjs --allocate-version` | **Refused — the flag is WITHDRAWN.** It never reserved anything; two coordinators in the same minute got the same number. | Pick the migration version manually and rely on the `SQL migration guards` check. |
| Declaring the phase-2 object list up front | Could not be done honestly — the vendor-landing schema home is not derivable from repo docs. Guessing would have produced a wrong declaration that **reads as safety**. | Split into read-only design then build. A task that cannot declare its objects is dispatched **read-only**. |
| Merging PR #481 on the strength of a green review | Review said APPROVE, but its confirmed findings showed the negative tests **proved nothing**. | **Verify the reviewer's confirmed findings too.** "Zero Critical/High" is not the same as "the tests work". |
| Accepting the agent's "OPA property = style guide" conclusion | Measurements were correct; the **inference** was not. Three discriminating tests reversed it. | Correct data plus plausible reasoning still needs a discriminating test. Cardinality settled it, not argument. |
| Merging PRs #468 and #472 in sequence | #468 merged first; #472 immediately went `CONFLICTING`. Both append to `COORDINATOR_INTAKE.md`. | Append-only files still conflict. Resolution kept **both** blocks and deleted only the three marker lines. |
| `git push` after resolving that conflict | Rejected, non-fast-forward — `gh pr update-branch` had moved the remote underneath. | Re-fetch and merge the remote branch before pushing a conflict resolution. |
| Batching merge + worktree-remove + branch-delete in one command | Blocked by the permission classifier (transient). | Split into smaller commands; it succeeded. |
| `git worktree add` on a branch already checked out | `fatal: already used by worktree at …` | Reuse the existing worktree rather than adding a second. |
| Relying on the repo's own docs for row counts | `pg_stat_user_tables.n_live_tup` returned **0** for tables holding thousands. Several document counts were wrong. | **Always `count(*)`.** Every count in the OPA README §6a was read from documents and never measured until this session. |

---

## 5. Facts that may already be stale

- Every SHA, PR state and count in §2. `origin/main` moved ~12 times in one
  session. **Re-derive from `git`/`gh`.**
- The 33/4/3/7 ColdLion split is a **code-only** match, exact today only because
  production's `core.property` is crippled to one row per code. It becomes wrong
  the moment the feed is repaired.
- Preview state was last observed 2026-08-07 03:27 UTC.
- Whether the two scraping sessions actually complied with the private-repo
  instruction — Albert relayed it; **this session never verified it**.
- `u2giants/licensor-source-data` was empty at 2026-08-07 ~15:15 UTC.

---

## 6. Deliberately left behind — decisions, not oversights

- **`C:/repos/shared-db-worktrees/order-list-plan`** — another session's, with one
  untracked review file. Not touched on purpose.
- **The scoop PostgreSQL client** on t16 — left in place; harmless, user-space.
- **The 47-row decision-sheet CSV** — generated for Albert and delivered to his
  machine, **deliberately not committed** because of §1.
- **Disney's CSV still in `shared-db`** — moving it is safe, scrubbing history is
  not, and the two should be done together by a session that owns the quiet
  window. See R-SEC-1.
- **The `⛔ ALBERT` decisions** — not resolved by the coordinator on purpose.

---

## 7. Immediate next actions, in order

1. **R-SEC-1**, steps (a) and (b) — private repo move and pointer. Safe now.
2. Verify the two scraping sessions committed nowhere but `licensor-source-data`.
3. Put the four `⛔ ALBERT` decisions to him, **starting with #1** — his
   many-to-many ruling rests on a number that did not survive measurement.
4. **Build the OPA lookup table.** It is the original request and it does not
   exist. Use `opa-source-of-truth-20260807/README.md`, not the superseded
   `DESIGN.md`.
5. R-SEC-1 step (c), the history scrub, in a quiet window.

**Do not repair the DesignFlow master-data pull** until the parentage-durability
gap is fixed. Repairing it silently reverts every curated licensor parent,
including the Coco fix merged this session.
