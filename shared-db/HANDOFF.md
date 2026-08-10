# HANDOFF — shared-db current state

> **Not the orchestrator session? Do not start or continue work here.** This repo
> runs one orchestrator, which dispatches everything to sub-agents in isolated
> worktrees. **Open a GitHub issue and stop:**
> `gh issue create --repo u2giants/shared-db --label db-work --title "HANDOVER: …" --body-file <file>`.
> ⚠️ **`COORDINATOR_INTAKE.md` is RETIRED** (2026-08-07). Do not write into it.

> ## ⚠️ THE NEWEST HANDOVER IS **NOT** IN THIS FILE. (added 2026-08-06)
>
> The big green *"ORCHESTRATOR HANDOVER — START HERE"* section immediately below is
> dated **2026-07-31**. It is **not current.** The newest orchestrator handovers
> live in **[`HANDOFF.d/`](HANDOFF.d/)** and are **days newer**.
>
> **Filenames there come in TWO formats — PARSE the timestamp, never text-sort:**
>
> - `YYYY-MM-DDTHHMMZ-<machine>-<slug>.md` — e.g. `2026-08-06T0149Z-al8960ofc-…`
> - `YYYYMMDDTHHMMSSZ-<machine>-<slug>.md` — e.g. `20260731T231155Z-t16-…`
>
> A plain alphabetical sort ranks the **older** July file last and you will pick
> the wrong one. Strip the punctuation from the date-time portion and compare the
> parsed instants.
>
> **What this file IS still authoritative for:** the **`## BACKLOG`** section
> (items **B1–B14**) and the long-form history — the five defects, the chip
> incident, the Supabase-MCP-is-production warning. **What it is NOT:** the
> current handover, or a current inventory of anything.
>
> Standing rule (was `COORDINATOR_INTAKE.md` §B2.0, retired 2026-08-07): **no document wins by name or by date.**
> Where `HANDOFF.d/`, this file, and `COORDINATOR_INTAKE.md` disagree,
> **re-derive the fact from `git`/`gh`** rather than ranking the documents.

> ## OWNER RULING — the ColdLion API key rotation ask is WITHDRAWN (Albert Hazan, 2026-08-09)
>
> > "I am not in control of the ColdLion system, I cannot do anything with that right now."
> > — Albert Hazan, 2026-08-09
>
> **Stop asking the owner to rotate the ColdLion API key.** ColdLion is a third-party system
> he does not administer. The ask is **withdrawn as of 2026-08-09**: it is no longer an open
> owner gate, a blocker, or a next action anywhere. Issue #642 was closed under this ruling.
> Do not re-file it, do not re-escalate it, and do not carry it forward in a handoff.
>
> **The exposure itself remains a recorded fact.** The key was found hardcoded in the public
> repository `u2giants/popdam3`. That finding is written up in
> [`HANDOFF.d/2026-08-10T0130Z-al8960ofc-claude-orchestrator-addendum-late-findings.md`](HANDOFF.d/2026-08-10T0130Z-al8960ofc-claude-orchestrator-addendum-late-findings.md)
> §1 and in its item 0.1. Those are **write-once records and were deliberately left intact.**
> This ruling supersedes the *action* they call for; it does not rewrite the history, and no
> one should delete the security record. Never write the key value into any file or message.
>
> **What is still actionable** (neither is a credential action, and neither needs the owner):
> the missing `COLDLION_API_KEY` row in PopDAM's `public.admin_config`, and removing the
> hardcoded literal from `u2giants/popdam3` source. Both live in that app repo, not here.

<!-- ============================================================================
     ORCHESTRATOR HANDOVER — FINAL — 2026-07-31 19:01 UTC
     This SUPERSEDES the 17:55 UTC handover immediately below it.
     Read this section first, then the 17:55 section for the detail it still owns.
     ============================================================================ -->

## 🟩 ORCHESTRATOR HANDOVER — FINAL — 2026-07-31 (written 19:01 UTC) — **START HERE, NOT AT 17:55**

You are taking over the **orchestrator** seat for `u2giants/shared-db`. This repo runs **one
orchestrator at a time**; the orchestrator does no work itself and dispatches every task to a
sub-agent in its own git worktree (skill `shared-db-orchestrator`). This section carries the two
halves that skill requires — **coordination state** and **one block per sub-agent** — as an
**UPDATE** on the 17:55 UTC handover directly below.

> **How to read this file.** The 17:55 section is **not deleted**, because most of it is still
> true and it holds the long-form explanations (the five defects, the chip incident, the
> installed-but-inert defects, the Supabase-MCP-is-production warning). It is **stale in
> specific, listed places**. §U0.1 below names every statement it makes that is now wrong. Where
> §U0.1 and the 17:55 text disagree, **§U0.1 wins**. Nothing else in the 17:55 section has been
> contradicted; treat it as still authoritative.

### U0. Ground truth, re-derived at write time — 2026-07-31 **18:55–19:01 UTC**

Every row below was produced by a command run in this session, in this worktree, at the stated
minute. **No database of any kind was contacted** — no Supabase MCP, no psql, no `db push`, no
1Password read. Anything that would require database access is marked **UNVERIFIED** with the
date it was last claimed by someone else.

| Fact | Value | How verified | When |
| --- | --- | --- | --- |
| `origin/main` tip | **`768594e762c09ff2beb19902289608c4842572ff`** — *"Merge pull request #354 from u2giants/codex/phase6-monitor-20260731"* | `git ls-remote origin refs/heads/main` (the true remote tip, **not** a local ref) | 18:55 UTC |
| Migration files in `supabase/migrations/` | **385** | `ls supabase/migrations \| wc -l` on a checkout of `768594e` | 18:56 UTC |
| **Max migration version** | **`20260731220000`** (`..._licensor_alias_owner_approval_remaining_five.sql`) | same listing, sorted | 18:56 UTC |
| Next free migration version | **`20260731230000`** or later | derived from the above | 18:56 UTC |
| Open PRs | **NONE.** `gh pr list --state open` returns empty. | `gh pr list --state open` | 18:55 UTC |
| PRs merged since the 17:55 handover | **#345, #348, #349, #350, #351, #352, #353, #354** — all MERGED | `gh pr list --state all --limit 45` | 18:55 UTC |
| CI on `main` @ `768594e` | **GREEN** — `Tools Offline Tests` success, `ColdLion Promotion Contract Tests` success, `Sync shared-db to consumers` success | `gh run list --branch main` | 18:56 UTC |
| Worktrees present | **22** (full table in §U1.6) | `git worktree list --porcelain` | 18:56 UTC |
| Git identity | `Albert Hazan <u2giants@users.noreply.github.com>` — correct | `git var GIT_COMMITTER_IDENT` | 18:55 UTC |
| Step 8 approval artifact | **STILL NONE.** No `docs/verification/coldlion-licensor-property-step8-approval-*/approval.json` exists. | directory listing | 18:57 UTC |

> **The brief that opened this session said `main` "should be at or after `4612689`". It was
> already past it — at `768594e`, one merge further on (#354), landed by a concurrent Codex
> session while this session was reading.** That is the third time today a snapshot went stale
> inside the hour. **Re-derive everything; trust no number in any document in this repo,
> including this one.**

---

### U0.1 — EXACTLY WHICH EARLIER STATEMENTS ARE NOW SUPERSEDED

These are statements in the **17:55 UTC handover below** (and in `HANDOFF.md` generally) that
were true when written and are **false now**. This list is exhaustive as far as this session
could verify.

| Where | It said | The truth at 19:01 UTC |
| --- | --- | --- |
| 17:55 §0 table | `origin/main` tip is **`defcb20`** | **`768594e`** — nine merges further on |
| 17:55 §0 table | **383** migration files | **385** |
| 17:55 §0 table | Max migration version **`20260731200000`** | **`20260731220000`** |
| 17:55 §0 table | Highest version pending in an open PR: `20260731210000` (#345) | **#345 is MERGED**; `20260731210000` and `20260731220000` are both on `main`. Nothing is pending. |
| 17:55 §0 table | Open PRs: **#345, #348, #349** | **There are NO open PRs.** All three merged, plus #350–#354. |
| 17:55 §0 table | **18** worktrees | **22** |
| 17:55 §1.3 item 2 | "**Six remaining licensor-alias rulings:** Marvel, One Piece, Peanuts, Sesame Workshop, Paramount, plus the dormant Nickelodeon/Viacom pair" | **CLOSED. Albert ruled on all five live aliases on 2026-07-31 ("all correct"), recorded by migration `20260731220000` (PR #352).** Nickelodeon and Viacom deliberately remain `inherited_unverified` — dormant, no ruling needed. **Do not re-ask him about any licensor alias.** |
| 17:55 §1.4 (whole section) | A merge-order plan for open PRs #349 → #348 → #345 → the handover | **Obsolete.** That order was executed exactly as written and all four landed. There is nothing to merge. |
| 17:55 §1.5 | Single-writer ownership: `supabase/migrations/` held by #345; `HANDOFF.md` contended; `AGENTS.md` and `COORDINATOR_INTAKE.md` held by #348 | **Obsolete. Every file in this repo is UNOWNED and free** as of 19:01 UTC, with the sole exception of `HANDOFF.md`, held by *this* handover PR until it merges. |
| 17:55 §1.6 | `core.licensor_alias` on preview: **3 `owner_approved`, 7 `inherited_unverified`** | Still 10 rows, but now **8 `owner_approved`, 2 `inherited_unverified`** after `20260731220000`. **UNVERIFIED by this session** (no database contact); last claimed 2026-07-31 by the agent that applied it. |
| 17:55 §1.7 | The 18-worktree table | Superseded by **§U1.6** below (22 worktrees). |
| 17:55 §2 blocks for #345, #348, #349 | Described as "**STILL OPEN**" / "LIVE" | All three **MERGED**. Their findings stand; their PR states do not. |
| 17:55 §4 agenda items 2, 3, 4, 5 | Update the shared checkout; merge #349, then #348, then #345, then the handover; reconcile `nbc-alias-work` | Items 3 and 4 are **done**. Item 2 (stale shared checkout) is **still true and still outstanding** — see §U1.6. Item 5 is **done**: `nbc-alias-work` content shipped inside #345. |
| Backlog **B5** bullet "PopSG PSG-5 — the eight Licensor aliases remain a blocking owner gate" | blocking owner gate | **NO LONGER BLOCKING.** Gate closed by PR #352. |

**Everything else in the 17:55 handover — §1.1, §1.2 (Step 8 NOT YET), the five Step 8
prerequisites, §3.1–§3.6, §5 — remains accurate and is NOT superseded.**

---

# HALF ONE (UPDATE) — COORDINATION STATE AT 19:01 UTC

### U1.1 — The four workstreams

**1. Poppim ClickUp importer — COMPLETE, merged, nothing outstanding. Unchanged.**
The importer would have inserted a **duplicate row for every one of the 17,859 products that
already existed**: it relied on a backfill claiming rows where `external_source IS NULL`, and
**production has zero such rows**, so the backfill claimed nothing and every product looked new.
Fixed to match on trimmed `clickup_task_id` first, backed by a partial unique index, plus five
further correctness defects (PRs #311, #314 re-issue, #324, #330). Rehearsed **twice** on
preview: **52 minutes, 22 net inserts, 17,909 → 17,931 rows, zero duplicates**, then a second run
of **7 seconds with nothing to do** — that second run is the proof the incremental watermark
works. **Do not reopen this.**

**2. ColdLion recurring Licensor/Property feed — Step 7A merged (`0798c095`) plus four
corrective migrations. STEP 8 IS NOT YET. This remains the loudest thing in this document.**
See §U1.2. Nothing about this changed between 17:55 and 19:01 except that PR #354 added one more
piece of *historical preview* monitoring evidence, which is **not** evidence for the current
function body.

**3. PopSG PSG-5 — database work merged (`691d5ea`, PR #338). THE OWNER GATE IS NOW CLOSED.**
Albert ruled on **all eight licensor aliases** on 2026-07-31. See §U1.3 — and read §U1.4, because
the **next concrete step is not in this repository at all**.

**4. Repo health / coordination — materially advanced.** Migration timestamp/backdating guards
live (#322, #325); Step 7A tool tests wired into CI (#340); `COORDINATOR_INTAKE.md` now carries
**both** a REQUEST queue (for people who need database work but have not started it) **and** an
INTAKE queue (for sessions that started and were told to stop), plus a full lifecycle and
retention discipline (#348, #351); two skills — `shared-db-orchestrator` and `shared-db-handover`
— exist locally and are **pending in `ai-devops` PR #1, which is still OPEN**; backlog grew to
**B1–B11** *(**SUPERSEDED 2026-08-06** — the `## BACKLOG` section now runs **B1–B14**. `B12`,
`B13` and `B14` were added after this snapshot was written.)*.

---

### U1.2 — ⛔ UNCHANGED AND STILL THE MOST IMPORTANT THING: Step 8 is **NOT YET**, and the reason is easy to miss

Every ColdLion document celebrates the same evidence: *"14/14 rehearsal cases passed, two
identical consecutive cycles."* **That evidence describes the promotion function as it existed at
migration `20260730000500`.**

**Four further `CREATE OR REPLACE` of that same function landed afterwards:**

| Version | What it changed | PR |
| --- | --- | --- |
| `20260731163000` | removed dead in-function failure recording | #341 |
| `20260731180000` | serialized promotion behind an advisory lock | #343 |
| `20260731190000` | **widened the cross-check predicate** (source_code + held-row provenance) | #342 |
| `20260731200000` | **changed fan-in curated-name selection** to be deterministic | #344 |

All four **were applied to preview**. **The rehearsal was never re-run against them.**

> ### APPLIED ≠ REHEARSED.
> A migration being present on preview proves only that the SQL parsed and ran. It proves
> **nothing** about whether the function still behaves correctly. This one sentence is the reason
> production is not on today.

The suite is now **18 cases**. **14 passed against an older function body.** Four —
**`10a`–`10d`, at `tools/rehearse-coldlion-recurring-cycles.mjs` lines 398–442** — **have never
executed at all.** The two migrations that changed the most (`190000`, the fan-in cross-check
predicate; `200000`, fan-in name selection) touch **exactly the machinery whose earlier bugs only
the rehearsal caught**. An independent GLM 5.2 review reached the same verdict: **NOT YET.**

The **five prerequisites** before Step 8 can even be *proposed* are unchanged and are written out
in full in the 17:55 section §1.2 — fresh 18-case rehearsal with a committed dated artifact; an
approval package naming **every** migration by exact version (re-derived from a live ledger
comparison, **not** copied from any document here, because the plan says four and the true
manifest is roughly eighteen); proof via the read-only `production-dry-run` lane that the ~15
unrelated pending production migrations stay out; a production backup and a written "before"
baseline (last claimed **26 licensors, 256 properties, 542 links** — **UNVERIFIED**, last claimed
2026-07-31); and Albert's written acceptance of the monitoring gap (the alert-monitor workflow is
**preview-only** and hard-refuses the production ref).

**Until all five exist: do not create, do not set, and do not ask anyone to set
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`.**

#### 🛑 The switch-on ORDER warning — still live, still critical

The production workflow **already carries live cron schedules**. They are gated **only** on the
absence of `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`. **Arming production is therefore a
single command** — there is no second safety catch. And **the four corrective migrations are on
preview but NOT on production**. Therefore the order is, without exception:

1. **Promote** the migrations to production (through the sanctioned lane).
2. **Verify** them on production.
3. **Only then enable** the variable.

**Never use `--include-all`**, which would sweep in the ~15 unrelated pending migrations. See
backlog **B9**: there is currently **no "armed but read-only" state** — setting the variable to
run a read-only readiness check simultaneously arms the 06:00 snapshot, the 06:30 promotion
(which **writes to production**), the 07:00 comparison and the hourly health lane.

---

### U1.3 — NEW SINCE 17:55: Albert ruled on the licensor aliases. The gate is CLOSED.

On **2026-07-31, in session**, Albert was shown this exact table and asked verbatim *"Is that
correct?"*:

| Folder says | Filed under canonical Licensor | Files (frozen measurement) |
| --- | --- | --- |
| Marvel Style Guide | Marvel | 14,636 |
| One Piece | TOEI - ONE PIECE | 8,383 |
| Peanuts | Peanuts Worldwide | 3,509 |
| Sesame Workshop | Sesame Street | 1,630 |
| Paramount | Viacom Multi | 9,052 |

He answered, verbatim: **"all correct"**.

**Before** he answered he was told explicitly that **Sesame Workshop → Sesame Street was the one
mapping that would be scrutinised hardest, because it is the only mapping from a COMPANY name to
a SHOW name while the other four run the other way.** He approved it anyway with that flag in
front of him. That caveat is stored **verbatim** in the `approval_evidence` of all five rows and
pinned by contract test **H2**. **Do not re-open Sesame Workshop on the grounds that it looks
inconsistent** — the inconsistency was named to the owner and accepted.

How it was recorded (PR #352, migration `20260731220000`):

- A **new forward migration**. `20260731210000` (PR #345) was **not** edited — it is merged and
  already applied to preview, so editing it is both forbidden (`AGENTS.md` §4 rule 4) and inert
  (the ledger keys on the version, so an edited file at a recorded version never re-runs).
- Approval goes through **`public.approve_licensor_alias()`**, the table's only sanctioned path —
  not by writing the four approval columns directly.
- `approved_by = 'Albert Hazan'`; `approved_at` pinned to **`2026-07-31 12:00:00+00`** — **midday
  UTC on purpose**, see the timezone finding in §U2.
- End state of `core.licensor_alias`: **10 rows — 8 `owner_approved`** (NBC Universal, NBCU,
  NBCUniversal from the NBC ruling in `20260731210000`, plus the five above) and **2
  `inherited_unverified`** (Nickelodeon, Viacom — dormant, deliberately untouched, no ruling
  required).

---

### U1.4 — ⚠️ THE ALIAS APPROVALS HAVE **ZERO RUNTIME EFFECT** TODAY

Read this before telling anyone PSG-5 is finished.

`core.licensor_alias` and `core.property_alias` are **tables nothing reads yet**. The **PopDAM
worker in `u2giants/popdam3`** still resolves aliases from its **own hard-coded arrays**.

**The next concrete step for this workstream is therefore NOT IN THIS REPOSITORY.** In
`u2giants/popdam3`, someone must:

1. Change the worker to read `core.licensor_alias` and `core.property_alias` instead of its
   hard-coded arrays.
2. **Prove `normalizePopSGTag` (the worker's JavaScript normaliser) is byte-identical in
   behaviour to `core.normalize_popsg_property_observation` (the SQL normaliser) across all 21
   frozen fixtures.** Two normalisers that disagree by one character silently file assets under
   the wrong Licensor.

**Until that lands, every alias approval recorded here changes nothing a user can see.** That
work is a **separate task in a separate repo and has not been started.** It is also, correctly,
**not** something a shared-db orchestrator starts on its own.

---

### U1.5 — What is waiting on Albert

1. **`ai-devops` PR #1 — OPEN.** It carries the two new skills, `shared-db-orchestrator` and
   `shared-db-handover`. They exist **locally on this machine only**. **Albert must merge PR #1
   and then run "sync my dotfiles" on his other machines**, or every other machine will keep
   running shared-db sessions without the coordination rules — which is the exact condition that
   produced the chip incident.
2. **Step 8 production switch-on** — not until the five prerequisites in §U1.2 exist. Do not ask
   yet.
3. ~~**Laura's reply.** The round-2 licensing xlsx was **SENT 2026-07-31**. Awaiting response.
   Nothing to do but wait.~~ **✅ CLOSED 2026-08-06 — NOT waiting on Laura, and never again.**
   Round 2 returned 2026-08-04 (157/166) and **round 3 returned 2026-08-06 with 8 of 8 answered,
   zero blanks.** **The licensing question stream is CLOSED; there is no round 4.** Detail and the
   eight settled rulings: `fix_characters_style_guides.md` § *"Licensing round 3 — RETURNED"*.
   The blocker on this workstream moved from **Laura** to **Albert** (item 4 below, and the
   `EX`/`LB`/`JL` policy decision).
4. **The property codes `EX` / `LB` / `JL`, and the 66 unmatched ColdLion codes.** Inherited from
   an earlier session. **⚠️ Nobody has yet framed these as an answerable question.** There is no
   document that puts them to Albert in a form he can rule on — no list, no proposed mapping, no
   "is this correct?" table like the one in §U1.3 that worked. **Producing that question is
   itself a task for the next session, and it must happen before Albert is asked anything.**
   Asking him an unframed question wastes the one resource that cannot be parallelised.

**Nothing else is blocked on Albert.** The licensor aliases are no longer on this list.

---

### U1.6 — Worktrees: 22, all accounted for; **NOTHING was retired** (`git worktree list --porcelain`, 18:56 UTC)

**This session retired NO worktree and deleted NO branch. That was a decision, not an oversight**
— the three reasons are below the table.

| # | Worktree | Branch | HEAD | Lock | Tip an ancestor of `origin/main`? | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `C:/repos/shared-db` | `main` | `6720511` | no | n/a | **THE SHARED CHECKOUT IS STALE** — its local `main` is at `6720511` while `origin/main` is `768594e`, **nine commits behind**. First action for the next session: `git -C C:/repos/shared-db pull`. |
| 2 | `agent-a471c39b395fb07f4` | `docs/orchestrator-final-handover-20260731` | this handover | **LOCKED** (pid 24420) | no | **THIS SESSION.** Retire after its PR merges. |
| 3 | `agent-a9b9b048681d1744f` | `worktree-agent-a9b9b048681d1744f` | `510c3a6` | no | no | **CHIP-INCIDENT REMNANT** — duplicate authoring of the fan-in tiebreak fix, superseded by merged `cc0d1dd`. Believed safe to clean; **left in place**, see reason 2. |
| 4 | `elastic-babbage-df8f2e` | `claude/elastic-babbage-df8f2e` | `3222667` | no | no | **CHIP-INCIDENT REMNANT** — a *third* authoring of the same fix. Superseded. **Left in place**, see reason 2. |
| 5 | `agent-a8fd75e9b517885c6` | `nbc-alias-work` | `7390e5a` | no | no | Held the NBC ruling work; **its content shipped inside merged PR #345**. Believed safe to clean; **left in place**. |
| 6 | `agent-a2209c948a524d76a` | `docs/handoff-corrections-20260731` | `dfb91a0` | no | no | PR **#349 MERGED**. Finished. |
| 7 | `agent-a18e8dbd5e9f2a218` | `docs/orchestrator-intake-20260731` | `a6077a8` | no | no | PR **#348 MERGED**. Finished. |
| 8 | `agent-ae7a53ae600b5b683` | `feat/core-licensor-alias-20260731` | `e0855ef` | no | no | PR **#345 MERGED**. Finished. |
| 9 | `agent-a7c7145b2908491b5` | `docs/orchestrator-handover-20260731-1755` | `0c77618` | no | no | PR **#350 MERGED** (`80db8e8`) — the previous handover. Finished. |
| 10 | `agent-a89327b8bdc3cad66` | `docs/orchestrator-intake-lifecycle-20260731` | `aed9ad9` | no | **YES** | PR **#351 MERGED**. Finished. |
| 11 | `agent-licensor-approve` | `feat/licensor-alias-owner-approval-20260731` | `0b08ecf` | no | **YES** | PR **#352 MERGED**. Finished. |
| 12 | `agent-a34d0b857a86a8e5a` | `backlog/paused-agent-worktree-sweep` | `de076b7` | no | **YES** | PR **#353 MERGED** (backlog B11). Finished. |
| 13 | `agent-a9b5bd066c13f571c` | `docs/psg5-entry-record-slot-blocked-20260731` | `f14c1b7` | no | no | PR **#338 MERGED**. Finished. |
| 14 | `agent-acdee405d4b4b9701` | `docs/ci-stale-verdict-paths-filter-20260731` | `04b5e9e` | no | no | PR **#336 MERGED**. Finished. |
| 15 | `agent-aed50174cbc6255a3` | `docs/handoff-improvement-plan-20260731` | `80b1e03` | no | no | PR **#347 MERGED**. Finished. |
| 16 | `happy-proskuriakova-a20b47` | `claude/coldlion-promotion-dead-failure-update-20260731` | `6f8d8f7` | no | no | PR **#341 MERGED**. Finished. |
| 17 | `intelligent-benz-f7502b` | `claude/intelligent-benz-f7502b` | `7930332` | no | no | PR **#342 MERGED**. Finished. |
| 18 | `adoring-bose-f6e5ef` | `claude/adoring-bose-f6e5ef` | `209d695` | no | no | PR **#343 MERGED**. Finished. |
| 19 | `intelligent-bhabha-81eb99` | `fix/wire-coldlion-step7a-tests-ci` | `e030fb5` | no | no | PR **#340 MERGED**. Finished. |
| 20 | `admiring-mestorf-037019` | `fix/clickup-runner-confirm-clean-run` | `48fcb80` | no | no | PR **#330 MERGED**. Finished. |
| 21 | `cool-morse-9da2b5` | `fix/duplicate-migration-version-20260728160000` | `35e48a3` | no | no | PR **#322 MERGED**. Finished. |
| 22 | `wizardly-montalcini-ffdabe` | `docs/handoff-public-schema-anon-lockdown` | `80daeec` | no | **YES** | PR **#333 MERGED**. Finished. |

**Why nothing was retired — three independent reasons, any one of which is sufficient:**

1. **Backlog B11, a real incident from earlier today.** A cleanup agent deleted the worktree of
   an agent that had deliberately **PAUSED awaiting re-dispatch**. The cleanup agent broke no
   rule — the worktree was clean, unlocked, and held no unmerged work. **A paused agent is
   indistinguishable from a finished one.** Nothing was lost that time. There is still no
   mechanism to tell them apart, so this session did not gamble.
2. **This session was isolated to its own worktree** and its tooling **refused every git command
   targeting another worktree's path**. It could therefore establish path, branch, HEAD and lock
   state for all 22, but **could not check whether any of the other 21 has uncommitted or
   untracked files**. Retiring a worktree whose dirty state you cannot see violates the one
   absolute rule: *a worktree is never removed if it is dirty*.
3. **Another agent is concurrently active**, diagnosing a long-running preview job (read-only).
   Which worktree it holds is not determinable from here. Deleting the wrong one would destroy a
   live session's working directory.

**Stale local branch labels — REPORTED, NOT DELETED.** `git branch --merged origin/main` lists
**42** local labels whose tips are already contained in `origin/main`, including ~20 machine-named
`worktree-agent-*` labels and orphans such as `claude/docs-migration-timestamp-collision`,
`verify-clickup-watermark`, `codex/coldlion-phase6-workflow-proof`, `claude/cool-morse-9da2b5`,
`claude/admiring-mestorf-037019`, `docs/clickup-handoff`, `docs/psg5-fresh-session-blocked-20260729`,
`fix/clickup-importer-correctness`, `fix/production-safe-execute-lockdown`,
`fix/revoke-anon-style-tracker-execute`. **Deleted none.** A label is deletable only when it is
merged into `origin/main` **AND** checked out in no worktree, and this session could not verify
the second condition for the 21 worktrees it could not inspect. This sweep is already recorded as
a backlog item in `COORDINATOR_INTAKE.md` ("Backlog — sweep ~30 stale local branch labels"); the
count is now **~42**.

> **Note on "an ancestor of `origin/main`".** Most merged branches show **no** in the ancestry
> column because this repo squash-merges: the PR content is on `main` under a *different* commit,
> so the branch tip is not literally an ancestor. **Ancestry is therefore NOT a safe merged-test
> here.** Use `gh pr view <n> --json state` — which is what the table's disposition column uses.

---

### U1.7 — Preview `rjyboqwcdzcocqgmsyel` is **NOT a clean baseline**

Anyone who rehearses against it assuming a virgin database will get a false result. **Everything
in this list is UNVERIFIED by this session** — it made no database contact of any kind. These are
the last claims of the agents that did the writing; **last claimed 2026-07-31**. Re-measure before
relying on any figure.

- The two **ClickUp** migrations **and importer data rows** in `pim.product` and `ingest.sync_run`.
- **All ColdLion migrations through `20260731200000`** — including the four never re-rehearsed.
- ColdLion **audit table: 0 rows**; **quarantine table: 180 rows**.
- The **PSG-5** objects: `core.property_alias`, `dam.popsg_property_resolution`.
- **`core.licensor_alias` with 10 rows** — **8 `owner_approved`, 2 `inherited_unverified`** after
  `20260731220000`.
- `plm.taxonomy_breaker_enforcement_status()` reports **`expected_count: 11`**. **THAT IS
  EXPECTED, NOT DRIFT. Do not "fix" it.**

**Production `qsllyeztdwjgirsysgai` is never touched from a session.** ⚠️ **The Supabase MCP is
bound to PRODUCTION and takes NO project parameter** — every call through it hits production. If
you must know where you are, call `get_project_url` **first**. For preview work use the Supabase
CLI or psql against `rjyboqwcdzcocqgmsyel`, never the MCP.

---

### U1.75 — ⚠️ LIVE ENVIRONMENT QUIRK: four orphaned `psql` processes on this machine

You will hit this. Budget five minutes for it rather than an hour.

Albert reported a process that had been *"running 25 minutes"*. It was diagnosed on 2026-07-31,
**read-only**, and the answer was **not** what it looked like:

- **It was NOT a GitHub Actions job.** Actions was **entirely clear** at that moment. The real
  `ColdLion Promotion Contract Tests` workflow completes in **~15–25 SECONDS** and last succeeded
  at **18:58 UTC**. Anything appearing to run for 25 minutes is therefore **not** that workflow.
- **It was a local `psql` launched through WSL** from `C:\repos\shared-db` at **14:32** by a
  sub-agent. Windows PIDs **19072 / 61204**, Linux PID **17739**.
- **It was holding nothing.** Read-only inspection of preview `rjyboqwcdzcocqgmsyel` showed
  **zero active queries and zero advisory locks**, including `720260729` — the ColdLion promotion
  lock. It was **not** mid-`db push` and **not** inside a transaction.
- **It was genuinely STUCK, not working.** The SQL file it had been given (`/tmp/t.sql`) and its
  password file had **already been deleted**, so it had nothing left to send.
- **Two further identical orphans from the evening of 2026-07-29 were found alongside it —
  1 day 18 hours old, same state. Four in total.** This is a **recurring leak**, not a one-off.
- A diagnostic command that tried to read the stuck process's file handles **also hung** — same
  symptom, so do not chase it that way.

**Status at handover:** **four** such orphaned processes existed on this machine. **Albert was
given the `Stop-Process` commands to clear them. Whether he ran them is UNVERIFIED.** Check for
them before concluding anything is running.

**Why this matters, and why it is not merely cosmetic:** a stuck process is **indistinguishable at
a glance from a long-running legitimate one** — and a legitimate ClickUp importer run really did
take **52 minutes** today, so the ambiguity is real. These orphans accumulate silently across
sessions, and the next one may coincide with an actual migration, where the safe/unsafe judgement
is far harder.

**The read-only diagnostic recipe that resolved it, in order:** (1) check **GitHub Actions**
first — if it is clear, it is not CI; (2) check **local processes** on the machine; (3) check
**`pg_stat_activity` and `pg_locks` on preview** for active queries and held advisory locks.
Three steps, minutes, no writes. Recorded as backlog **B12**.

### U1.8 — Single-writer ownership right now

**Everything is unowned and free**, except `HANDOFF.md`, which is held by this handover PR until
it merges. There are **no open PRs** and **no in-flight migrations**. The next free migration
version is **`20260731230000`**.

This is the cleanest the repo has been all day. It is also the moment of maximum risk: with
nothing owned, two dispatched agents will happily collide again. **Backlog B6 — the cross-PR
object collision guard — is STILL UNFIXED**, so §U1.8 discipline is a *convention*, not a
*mechanism*. Before dispatching anything, write down who owns which file.

---

# HALF TWO (UPDATE) — ONE BLOCK PER SUB-AGENT

Roughly **35 agents** ran across this orchestrator seat and the one immediately before it.
**The 17:55 section below already carries a full block for ~25 of them** — Workstreams 1–4,
lines covering PRs #297–#349 — and **those blocks are not repeated here.** What follows is:
**(U2.A)** a full block for every agent that ran **after** 17:55 or was not previously blocked;
**(U2.B)** a status delta for the previously-written blocks whose PR state changed; and
**(U2.C)** a consolidated ledger of the findings that must survive, so that no future edit to
either section can lose them.

Reconstructed from `gh pr list --state all`, `git log`, and `git worktree list`. **Where an agent
survives only as a merged PR, that is stated. No detail has been invented.**

## U2.A — Agents not previously blocked, or that ran after 17:55

### Agent: five-alias owner approval — `feat/licensor-alias-owner-approval-20260731` (PR #352, MERGED `be74979`)
- **Asked to do:** put the five remaining live Licensor aliases to Albert, and record his ruling
  durably in the database.
- **Actually did:** presented the exact five-row table in §U1.3, obtained the verbatim ruling
  **"all correct"**, and authored **a new forward migration `20260731220000`** recording it
  through `public.approve_licensor_alias()` with `approved_by = 'Albert Hazan'` and `approved_at`
  pinned to **`2026-07-31 12:00:00+00`**. Added contract assertions including **H2**, which pins
  the verbatim caveat text.
- **Found:** that **Sesame Workshop → Sesame Street is the odd one out** — the only COMPANY-name→
  SHOW-name mapping in a set that otherwise runs the other way. Rather than hide it, the agent put
  the objection **to Albert before he ruled**, and then stored the objection **verbatim** in every
  row's `approval_evidence`. This is the pattern to copy: an owner decision is only durable if the
  reader can see what the owner was warned about.
- **PR / branch:** #352, MERGED. Migration `20260731220000`.
- **Worktree:** `agent-licensor-approve` — finished.
- **Deliberately did NOT do:** did **not** edit `20260731210000` (merged and already applied —
  editing a recorded version is forbidden *and* inert); did **not** write the four approval
  columns directly, going through the sanctioned RPC instead; did **not** touch **Nickelodeon** or
  **Viacom**, which are dormant and stay `inherited_unverified` with no ruling; and did **not**
  change any consuming code — see §U1.4, the approvals are inert until popdam3 changes.

### Agent: intake lifecycle and request queue — `docs/orchestrator-intake-lifecycle-20260731` (PR #351, MERGED `33d36c9`)
- **Asked to do:** make `COORDINATOR_INTAKE.md` self-cleaning, and give people who need database
  work a way to *ask* rather than *start*.
- **Actually did:** added **Part 0 (the REQUEST path)** with its own template and a copy-paste
  message Albert can send to any session that needs database work; and **Part B2**, a full
  lifecycle: `REQUEST QUEUE → IN PROGRESS → COMPLETED` and `INTAKE QUEUE → TAKEN OVER`, with
  **only the orchestrator** moving blocks between sections; a retention rule (prune past **30 days
  or the most recent 10** per section, **archived verbatim** to
  `docs/intake-archive/YYYY-MM-DD-intake-archive.md`, **never deleted**); branch/worktree hygiene
  rules; and a periodic sweep run at **session start and again at handover**.
- **Found:** the most valuable content the intake process produces is the **"what did NOT work"**
  section of each block — hence archive-verbatim rather than delete.
- **PR / branch:** #351, MERGED.
- **Worktree:** `agent-a89327b8bdc3cad66` — finished.
- **Deliberately did NOT do:** did **not** build any CI enforcement of the lifecycle. That is
  backlog **B10**, and the item explicitly warns that thresholds live in `COORDINATOR_INTAKE.md`
  and **must not be duplicated into a workflow that then drifts**.

### Agent: B11, the paused-agent worktree incident — `backlog/paused-agent-worktree-sweep` (PR #353, MERGED `4612689`)
- **Asked to do:** record what happened when a cleanup sweep deleted a live agent's worktree.
- **Actually did:** wrote backlog **B11**.
- **Found — MUST SURVIVE:** an agent had deliberately **stopped and was awaiting re-dispatch**
  (it had correctly refused to race an unmerged PR) and a concurrent cleanup agent **deleted its
  worktree**. **The cleanup agent broke no rule** — the worktree was clean, unlocked, and held no
  unmerged work. The affected agent recovered by creating a fresh worktree, so **nothing was lost
  this time**. The gap: *clean + unlocked + merged* is **necessary but not sufficient**; it must
  also be established that **no orchestrator intends to re-dispatch that agent**, and **a paused
  agent is indistinguishable from a finished one**.
- **PR / branch:** #353, MERGED.
- **Worktree:** `agent-a34d0b857a86a8e5a` — finished.
- **Deliberately did NOT do:** proposed a fix (a orchestrator-maintained resumable-agent list, or a
  marker a sweep can see) but **built nothing**, and deliberately did **not** restate the retention
  thresholds, which live in `COORDINATOR_INTAKE.md` Part B2.

### Agent: Codex phase-6 monitor — `codex/phase6-monitor-20260731` (PR #354, MERGED `768594e`)
- **Actually did:** preserved July 30–31 **preview** monitoring observations in
  `docs/verification/coldlion-licensor-property-phase6-20260726/README.md`. Documentation only —
  no SQL, no migration, no code. Landed **after** the 17:55 handover was written, which is why
  that handover's `main` SHA was already wrong.
- **Found:** nothing new; it is a record, not an investigation. **⚠️ Critically: this evidence
  describes preview cycles under the OLD function body and is NOT evidence for the current one.**
  Do not let its freshness be mistaken for a fresh rehearsal.
- **Worktree:** not present in the local list — this ran from a different session/machine.
- **Deliberately did NOT do:** claimed **no** readiness, **no** accelerated exit, and **no**
  production cutover. The file says so in its own header.

### Agent: previous orchestrator handover — `docs/orchestrator-handover-20260731-1755` (PR #350, MERGED `80db8e8`)
- **Actually did:** wrote the two-halves handover that sits immediately below this section.
- **Found:** that its own inherited snapshot was **eight commits stale** by the time it wrote —
  the finding that produced the re-verify-everything discipline this session inherited and
  repeated.
- **Worktree:** `agent-a7c7145b2908491b5` — finished.
- **Deliberately did NOT do:** deliberately did **not** restate PR #349's content, to avoid a
  `HANDOFF.md` merge conflict, and deliberately did **not** merge anything on its way out. **This
  session was instructed to merge its own PR instead** — an explicit, deliberate departure from
  that convention, made by Albert's brief, so the seat does not close with an open PR.

### Agent: concurrent preview-job diagnosis (identity unknown to this session)
- **Asked to do:** diagnose a long-running preview job. **Read-only.**
- **Actually did:** unknown — it is running **concurrently with this session** and has filed
  nothing yet.
- **Worktree:** **unknown.** It is one of the 22 in §U1.6 and cannot be identified from here. This
  is the third independent reason nothing was retired.
- **Deliberately NOT done by this session:** **did not interfere with it in any way**, per the
  brief. The next orchestrator should **look for its intake block in `COORDINATOR_INTAKE.md`
  before assuming any worktree is abandoned.**

### Agent: this session — final orchestrator handover (`docs/orchestrator-final-handover-20260731`)
- **Asked to do:** run the hygiene sweep, then write the final handover superseding the 17:55 one,
  and **merge its own PR**.
- **Actually did:** re-derived all ground truth at 18:55–19:01 UTC; enumerated all 22 worktrees;
  retired nothing; reported 42 stale local branch labels; wrote this section; merged its own PR.
- **Deliberately did NOT do:** **no database contact of any kind** (no Supabase MCP, no psql, no
  `db push`, no 1Password read); **no task chips**; touched **only `HANDOFF.md`** — no
  `AGENTS.md`, no `COORDINATOR_INTAKE.md`, no migration, script, workflow or `tools/` file; did
  **not** approach Step 8; did **not** create or set
  `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`; and did **not** delete the 17:55 handover,
  superseding it in place instead.

## U2.B — Status delta for blocks already written in the 17:55 section

These agents already have full blocks below. **Only their PR state changed.** Their findings, and
their "deliberately did NOT do" lines, stand unaltered.

| Agent / branch | 17:55 said | Now |
| --- | --- | --- |
| licensor alias table + NBC ruling — `feat/core-licensor-alias-20260731` | PR **#345 OPEN** | **MERGED** as `a1848c1`. Migration `20260731210000` is on `main`. Its warning that the table **has zero runtime effect until popdam3 reads it** is unchanged and is now §U1.4. |
| orchestrator intake — `docs/orchestrator-intake-20260731` | PR **#348 OPEN** | **MERGED** as `cac46ff`. |
| handoff corrections — `docs/handoff-corrections-20260731` | PR **#349 OPEN** | **MERGED** as `32e62b7`. It carried the ColdLion switch-on ORDER warning and backlog **B6/B7**. |
| `nbc-alias-work` loose worktree | "LIVE, and NOT on any PR — confirm it is represented in #345" | **Confirmed represented**: #345 merged carrying the NBC ruling and the two missing variants. The worktree is believed safe to clean but was **left in place** (§U1.6). |
| everything else (#297–#347, Grok, GLM, the ClickUp agents, the ColdLion agents, the lockdown agents) | as written | **unchanged.** |

## U2.C — THE FINDINGS LEDGER — these must survive every future edit

Each is written out in full in the 17:55 section; this is the index that makes losing one
impossible.

1. **Duplicate migration version = silent skip.** Two migration files sharing one version cause
   the second to be **silently skipped** — Supabase records the *version*, not the file, and
   **nothing errors**. **Remedy: re-issue under a NEW version. Never rename the old file** —
   renaming does not make an already-recorded version re-run. (PRs #322, #314.)
2. **The five ColdLion rehearsal defects.** Above all: **(a)** the collision rule would have
   **quarantined 542 of 542 approved rows — the entire feed — while reporting the run healthy**,
   because the approved mapping deliberately fans 542 source rows into 271 canonical rows and the
   rule treated any multiply-reachable canonical row as a collision; and **(b)** the **alert path
   never actually recorded, so the circuit breaker could never trip.** Plus an ambiguous column,
   wrong absence detection, and dead in-function failure recording.
3. **The self-inflicted chip incident.** Five background chips spawned five independent sessions
   with no shared register. **Four each authored a `CREATE OR REPLACE` of the SAME function**, and
   **three chose the identical version `20260731170000`**. Every one **passed CI alone**, because
   the guards are branch-local. Untangled by **merging one at a time and RE-DERIVING each change
   on top of the previous merged function body** — never replaying the original diff. **ROOT CAUSE
   STILL UNFIXED — backlog B6.**
4. **Blind rebasing of competing `CREATE OR REPLACE` migrations applies with NO textual
   conflict**, because each migration is a **new file**. **Git cannot warn you.** You get a stack
   of clean-looking files and a function body that is whichever one ran last.
5. **The three "installed but inert" defects**, and the rule they produced: a **`BEFORE` trigger
   reading a `GENERATED ... STORED` column** (always NULL at `BEFORE` time — never fired, never
   errored); a **function that failed on every call**; the **dead alert path**. All three passed
   existence checks. **The rule: PROVE IT FIRES, not that it exists** — commit the violation and
   assert the observable consequence. Backlog **B7**.
6. **The stale-red-CI trap.** A repo-wide checker behind a **narrow `paths:` filter** reports a
   **stale verdict**: fixing the offending line in an unwatched file triggers no run, so `main`
   stays red indefinitely. **Before debugging a red check, confirm it actually ran against the
   current commit.** `AGENTS.md` §5.2; backlog **B2**.
7. **The Supabase MCP is bound to PRODUCTION and takes no project parameter.** Call
   `get_project_url` first if unsure. Use the CLI/psql for preview.
8. **The NBC normalization finding.** All **four spellings normalise to four DIFFERENT keys**;
   **`NBCU` and `NBCUniversal` matched nothing at all**; and **`NBC` itself must NOT be an alias
   row**.
9. **The `America/New_York` midnight-UTC misdating.** The database runs `America/New_York`; a
   midnight-UTC timestamp read back through `::date` returns the **previous day**. It would have
   recorded **Albert's ruling as 2026-07-30**. **Pin owner approvals to midday UTC** and assert
   the date in **both** UTC and server-local time.
10. **The null-permissive guard.** `if not ( … or auth.role() = … )` **never fires when
    `auth.role()` is NULL**, as it is inside a migration — the guard silently admits the call.
    Present in the approval RPC. Recorded, **not fixed**.
11. **Grok's one-way alias shadowing finding.** The guard stops a *new alias* colliding with an
    *existing licensor name*, but **nothing stops a later licensor RENAME colliding with an
    existing alias**. **The same gap already exists in the shipped `core.property_alias`** — so it
    is **repo-wide, not a regression**, and must not be used to block alias work.
12. **GLM produced two "High" findings, BOTH wrong on inspection**, one **contradicting its own
    earlier conclusion in the same review**. **The protocol: treat every Critical/High from any
    reviewing model as a HYPOTHESIS requiring line-level evidence before it blocks a merge. The
    gate is "no UNRESOLVED findings", not "zero findings".**

---

# U3. WHAT WE TRIED THAT DID **NOT** WORK

The 17:55 section §3.1–§3.6 covers the earlier dead ends in full. This is the complete list, with
the two new entries marked **NEW**.

### U3.1 Background task chips for shared-db work — never again
Chips create **independent sessions with no shared register**, invisible to each other and to the
orchestrator. This is the single largest source of waste in this repo and it produced the four-way
`CREATE OR REPLACE` collision. **The orchestrator dispatches sub-agents in worktrees; it never
creates chips.** If a chip is ever genuinely unavoidable, its title **must** begin
`DO NOT START —`. Backlog **B4**; skill `shared-db-orchestrator`.

### U3.2 Blind rebasing / cherry-picking of competing `CREATE OR REPLACE` migrations
Applies with **no textual conflict**, because each migration is a **new file**. **Git cannot warn
you.** What worked: **merge one at a time, and re-derive each change on top of the previous merged
function body.**

### U3.3 Trusting plan documents over the live repo
Repeatedly wrong. The plan and the Step 7 package each name **four** migrations where the true
manifest is roughly **eighteen**. Documents here go stale **within the hour** — three times today.
Always `git fetch`, `git ls-remote`, `gh pr list`, `git worktree list`, and re-derive.

### U3.4 Assuming an installed thing works
See finding 5 in §U2.C. Existence checks are worthless against this class of defect.

### U3.5 GLM on large exploratory briefs
GLM **hung for roughly 40 minutes** on large open-ended briefs. What works: **compact,
self-contained briefs**; if it hangs, **retry once, tighter**; then **fall back to your own review
rather than waiting.** Never block a merge on a hung reviewer.

### U3.6 The Supabase MCP as a preview tool
It is bound to **production** and takes no project parameter. Use the CLI/psql for preview.

### U3.7 **NEW —** Deleting a paused agent's worktree
A sweep applying the documented, correct criteria (clean + unlocked + merged) **deleted the
worktree of an agent that had deliberately paused awaiting re-dispatch.** The sweep broke no rule.
**The criteria themselves are insufficient.** Until B11 has a mechanism, **bias hard toward
leaving worktrees alone and listing them.** This session retired nothing for exactly this reason.

### U3.8 **NEW —** Using branch-tip ancestry as a merged-test
`git merge-base --is-ancestor <branch-tip> origin/main` returns **false for most merged branches
in this repo**, because merges are squashed and the content lands under a different commit. A
sweep that treats "not an ancestor" as "unmerged" will conclude that almost every finished
worktree still holds unmerged work — and one that treats it as authoritative in the other
direction could delete live work. **Use `gh pr view <n> --json state`.**

---

# U4. THE NEXT ORCHESTRATOR'S OPENING AGENDA, IN ORDER

1. **RE-VERIFY EVERY NUMBER IN §U0 AND EVERY "UNVERIFIED" FIGURE IN §U1.7 BEFORE ACTING.**
   `git fetch --all`, `git ls-remote origin refs/heads/main` (**not** a local ref), `gh pr list
   --state open`, `git worktree list`, and re-derive the migration count and max version. This
   document was true at **19:01 UTC on 2026-07-31** and **nothing keeps it true** — the SHA in the
   brief that opened this session was already stale when the session started.
2. **Update the stale shared checkout:** `git -C C:/repos/shared-db pull`. Its local `main` is
   nine commits behind at `6720511`.
3. **Read the open issues** — `gh issue list --repo u2giants/shared-db --label db-work`.
   *(Was "read `COORDINATOR_INTAKE.md` top to bottom"; that file was retired 2026-08-07.)* **Check whether the concurrent preview-diagnosis agent (§U2.A) has filed a block**
   before assuming any worktree is abandoned. Run the Part B2 session-start sweep.
4. **Dispatch ONE sub-agent to run the full 18-case rehearsal** against the **current** promotion
   function on preview, and to **commit a dated evidence artifact to the repo** — a file, not a
   chat message. Cases **10a–10d have never executed**. This is the gate on everything ColdLion.
5. **Dispatch ONE sub-agent to re-derive the true production migration manifest** from a **live
   ledger comparison** (production `supabase migration list` vs. the repo), and to run the
   **read-only `production-dry-run` lane** to prove the ~15 unrelated pending migrations stay out.
   Never hand-run `supabase db push`; never `--include-all`.
6. **Only after 4 and 5**, assemble the Step 8 approval package for Albert. Remember
   `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` lines 399–407 **refuses** an
   enabled production variable until `docs/verification/coldlion-licensor-property-step8-approval-*/approval.json`
   exists — **the paperwork is a functioning interlock, not a formality.**
7. **Frame the `EX` / `LB` / `JL` property codes and the 66 unmatched ColdLion codes as an
   ANSWERABLE QUESTION for Albert** — a table he can rule on, in the style of §U1.3, which is the
   format that has actually worked. Do not ask him anything until that exists.
8. **Chase `ai-devops` PR #1.** Until Albert merges it and runs "sync my dotfiles" elsewhere, the
   coordination skills exist on **one machine only**.
9. **Dispatch the popdam3 alias cutover** (§U1.4) — a **different repo**, so it needs its own slot
   and its own owner. Until it lands, the alias approvals are inert.
10. **Do NOT start opportunistically:** characters Phase 3 (it writes rows into three shared
    tables), the PSG-5 rebuild, or backlog **B1** (`.gitattributes` rewrites every open
    worktree — land it when few sessions are open).
11. **When the repo is quiet, sweep the 22 worktrees and ~42 stale local branch labels** using the
    **`cleanup-worktree`** skill, from a session that can actually inspect each worktree's dirty
    state — and only after confirming no agent is paused awaiting re-dispatch (B11).

---

# U5. THE EXACT PROMPT TO START THE REPLACEMENT SESSION

Copy the block below verbatim into a fresh session.

```text
You are the single ORCHESTRATOR for u2giants/shared-db. Invoke the `shared-db-orchestrator`
skill FIRST and follow it. You do no work yourself: you dispatch every task to a sub-agent in
its own git worktree. Never create background task chips — that pattern is what broke this repo.

START BY READING, IN THIS ORDER:
  1. HANDOFF.md — the section headed "ORCHESTRATOR HANDOVER — FINAL — 2026-07-31 (written 19:01
     UTC)". It supersedes the 17:55 section below it; its §U0.1 lists exactly which earlier
     statements are now wrong.
  2. The open issues — `gh issue list --label db-work`. *(Was COORDINATOR_INTAKE.md, retired 2026-08-07.)*
  3. AGENTS.md — only the sections your first task touches.

VERIFY BEFORE YOU ACT — every document in this repo has gone stale within the hour, three times
on 2026-07-31 alone. Re-derive all of this yourself and do not trust the numbers below:
  git fetch --all --prune
  git ls-remote origin refs/heads/main     # the TRUE tip, not a local ref
  gh pr list --state open
  git worktree list --porcelain
  ls supabase/migrations | wc -l ; ls supabase/migrations | sort | tail -3
  git var GIT_COMMITTER_IDENT              # must be Albert Hazan <u2giants@users.noreply.github.com>

STATE AS OF 2026-07-31 19:01 UTC (verify, do not trust):
  origin/main = 768594e762c09ff2beb19902289608c4842572ff ; CI green
  385 migrations ; max version 20260731220000 ; next free 20260731230000
  NO open PRs ; 22 worktrees, NONE retired ; ~42 stale local branch labels, NONE deleted
  Every file is unowned and free. Nothing is in flight.

THE FOUR WORKSTREAMS:
  1. Poppim ClickUp importer — COMPLETE. Do not reopen.
  2. ColdLion recurring feed — Step 7A merged; STEP 8 IS "NOT YET". The celebrated "14/14
     rehearsal" describes the function at migration 20260730000500. FOUR further CREATE OR
     REPLACE landed after it (20260731163000 / 180000 / 190000 / 200000). They were APPLIED to
     preview but THE REHEARSAL WAS NEVER RE-RUN. APPLIED IS NOT REHEARSED. The suite is now 18
     cases: 14 passed against an older body and cases 10a-10d (tools/rehearse-coldlion-recurring
     -cycles.mjs lines 398-442) HAVE NEVER EXECUTED. Running them is your first dispatch.
     SWITCH-ON ORDER, ABSOLUTE: the production workflow already carries live crons gated only on
     the ABSENT variable COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED, so arming production is
     ONE command. The four corrections are on preview but NOT on production. Order is
     promote -> verify -> enable. NEVER --include-all. Do NOT create or set that variable.
  3. PopSG PSG-5 — database work merged (691d5ea). The owner gate is CLOSED: Albert ruled on all
     eight licensor aliases on 2026-07-31. DO NOT RE-ASK HIM. The next concrete step is NOT in
     this repo: the PopDAM worker in u2giants/popdam3 must read core.licensor_alias and
     core.property_alias instead of its hard-coded arrays, and must prove normalizePopSGTag is
     byte-identical to core.normalize_popsg_property_observation across all 21 frozen fixtures.
     UNTIL THEN EVERY ALIAS APPROVAL HAS ZERO RUNTIME EFFECT.
  4. Repo health — backlog B1-B11 [SUPERSEDED 2026-08-06: the backlog is now **B1–B14**] in HANDOFF.md. B6 (cross-PR object collision guard) is the
     root cause of the chip incident and is STILL UNFIXED.

AWAITING ALBERT: merge ai-devops PR #1 then "sync my dotfiles" on his other machines; ~~Laura's
reply (round-2 xlsx sent 2026-07-31)~~ [CLOSED 2026-08-06 — round 3 returned 8/8; licensing is
DONE, no round 4]; the EX/LB/JL property codes and the 66 unmatched ColdLion
codes — nobody has yet framed those as an answerable question, and doing so is a task for you.

PREVIEW rjyboqwcdzcocqgmsyel IS NOT A CLEAN BASELINE: ClickUp migrations plus importer data
rows; all ColdLion migrations through 20260731200000; ColdLion audit 0 rows and quarantine 180
rows; the PSG-5 objects; core.licensor_alias with 10 rows (8 owner_approved, 2
inherited_unverified). plm.taxonomy_breaker_enforcement_status() reports expected_count: 11 —
that is EXPECTED, not drift. All of it UNVERIFIED as of 2026-07-31; re-measure before relying on
it.

HARD RULES: the Supabase MCP is bound to PRODUCTION and takes no project parameter — call
get_project_url first if unsure, and use the CLI/psql for preview. Never touch production from a
session. One writer per file; write down who owns what before dispatching, because B6 means CI
cannot catch a collision. Bias hard toward leaving worktrees alone (backlog B11: a sweep deleted
a paused agent's worktree earlier today). Use `gh pr view` to test whether work is merged —
branch-tip ancestry is unreliable here because merges are squashed.

FIRST ACTION: run the COORDINATOR_INTAKE.md Part B2 session-start sweep, check whether the
concurrent preview-diagnosis agent filed an intake block, then dispatch ONE sub-agent to run the
full 18-case ColdLion rehearsal against the CURRENT function body on preview and commit a dated
evidence artifact to the repo.
```

---

# U6. FRESH-DEVELOPER SELF-AUDIT

**Question:** could a developer who walked in off the street this morning — zero knowledge of this
application, this session, this chat, or what was tried and failed — continue from here with **NO
questions**, as effectively as this session can right now?

**Answer: yes for the coordination work, and here is the evidence rather than the assertion.**
Every moving fact in §U0 carries the exact command that produced it and the minute it was checked.
§U0.1 names, line by line, every earlier statement that is now false — so the newcomer cannot be
misled by the older section that is deliberately left in place. All 22 worktrees are enumerated
with path, branch, HEAD, lock state and disposition, and the three reasons nothing was retired are
stated so the leftovers read as a decision rather than neglect. Every agent that ran after 17:55
has a full block including what it deliberately did **not** do; the ~25 earlier agents keep their
existing blocks and get an explicit status delta. The twelve findings that must survive are
consolidated into a single numbered ledger (§U2.C) so no future edit can quietly drop one. The
eight dead ends are written with their **mechanism**, not just their conclusion — the newcomer
learns *why* a rebase of competing `CREATE OR REPLACE` migrations produces no conflict, not merely
that it should be avoided. §U4 gives an ordered agenda whose first item is re-verification, and
§U5 gives a verbatim, self-contained starting prompt.

**Where it is honestly incomplete, and the newcomer is told so explicitly, in place:** every figure
requiring database access — the 26/256/542 production baseline, all the preview row counts, the
`core.licensor_alias` status split, the ~15 pending production migrations — is marked
**UNVERIFIED** with the date last claimed, because **this session made no database contact of any
kind**. And this session **could not inspect the dirty state of 21 of the 22 worktrees**, because
its tooling confined it to its own; that limitation is stated as the reason nothing was retired,
rather than hidden behind a cleaner-looking sweep. **An unverified number that is labelled
unverified costs an hour. One presented as fact costs a production incident.** The newcomer's
first agenda item is to re-measure, and §U4 item 1 says exactly that.

**Grade: PASS.**

<!-- ============================================================================
     END ORCHESTRATOR HANDOVER — FINAL — 2026-07-31 19:01 UTC
     Everything below is the 17:55 UTC handover. It is superseded ONLY where
     §U0.1 above says so; the rest of it remains authoritative.
     ============================================================================ -->

---
<!-- ============================================================================
     ORCHESTRATOR HANDOVER — 2026-07-31 17:55 UTC
     Read this whole section before anything else in this file.
     ============================================================================ -->

## ⚠️ SUPERSEDED IN PART — ORCHESTRATOR HANDOVER — 2026-07-31 (written 17:55 UTC)

> **This is NOT the current handover.** It was superseded at **19:01 UTC on 2026-07-31** by the
> FINAL orchestrator handover at the top of this file. **Read that first.** Its **§U0.1** lists
> every statement below that is now wrong — chiefly the `main` SHA, the migration count and max
> version, the list of open PRs (there are none), the worktree table, the file-ownership map, and
> the claim that six licensor-alias rulings are outstanding (**all are now ruled and the gate is
> CLOSED**). Everything **not** named in §U0.1 remains accurate, which is why this section is kept
> rather than deleted — it holds the long-form explanations the newer section only indexes.

You are taking over the **orchestrator** seat for `u2giants/shared-db`. This repo runs
**one orchestrator at a time**; the orchestrator does no work itself and dispatches every
task to a sub-agent in its own git worktree (skill `shared-db-orchestrator`). This section
has the two halves that skill requires: **coordination state** and **one block per
sub-agent**. If you only read the first half you will undo work.

### 0. Ground truth, verified at write time (re-verify before you act — this goes stale within the hour)

Everything below was re-derived by this session at **2026-07-31 17:54–17:55 UTC**
(`git fetch --all`, `git ls-remote`, `gh pr list`, `git worktree list`). **No database was
contacted.** Anything needing production is marked UNVERIFIED.

| Fact | Value | How verified | When |
| --- | --- | --- | --- |
| `origin/main` tip | `defcb20a11c98f34e2c85e5363bc881d7f691dd9` — *"docs: plan for making ColdLion the source of truth for every core table it feeds (#335)"*, committed 2026-07-31 13:43:24 -0400 | `git ls-remote origin refs/heads/main` (not just the local ref) | 17:54 UTC |
| Migration files on `origin/main` | **383** | `git ls-tree -r --name-only origin/main supabase/migrations/ \| wc -l` | 17:54 UTC |
| **Max migration version on `main`** | **`20260731200000`** (`..._coldlion_recurring_promotion_fanin_name_tiebreak.sql`) | same listing, sorted | 17:54 UTC |
| Highest version **pending in an open PR** | **`20260731210000`** (`core_licensor_alias.sql`, PR #345) — allocate `20260731220000` or later for anything new | `gh pr view 345 --json files` | 17:55 UTC |
| Open PRs | **#345, #348, #349** — all three still OPEN, all three `MERGEABLE` | `gh pr list --state open` | 17:55 UTC |
| Worktrees present | **18** (list in §1.6) | `git worktree list` | 17:54 UTC |
| Git identity | `Albert Hazan <u2giants@users.noreply.github.com>` — correct | `git var GIT_COMMITTER_IDENT` | 17:54 UTC |
| Step 8 approval artifact | **NONE EXISTS.** `docs/verification/` contains only `db-data-admin-step8-*` files, which are an unrelated UI feature. There is no `coldlion-licensor-property-step8-approval-*/approval.json`. | `ls docs/verification/` | 17:55 UTC |

> **A worked example of why you must re-verify:** this session was handed a snapshot saying
> `main` was at `6720511` (the #339 merge). By the time it wrote, `main` was **eight commits
> further on**, at `defcb20`. Nothing warned anyone. Believing the snapshot would have meant
> re-doing merged work.

---

# HALF ONE — COORDINATION STATE

### 1.1 The four workstreams, and where each actually stands

**1. Poppim ClickUp importer — COMPLETE, merged, nothing outstanding.**
The importer was going to insert a **duplicate row for every one of the 17,859 products that
already existed**. It relied on a backfill that claimed rows where `external_source IS NULL`;
production has **zero** such rows, so the backfill claimed nothing and every product looked
new. Fixed to match on trimmed `clickup_task_id` first, plus a partial unique index and five
further correctness defects (PR #311, plus #314 re-issue, #324, #330). Rehearsed **twice** on
preview: first run 52 minutes, 22 net inserts, 17,909 → 17,931 rows, zero duplicates; second
run **7 seconds with nothing to do**, which is the proof that the incremental watermark works.
Do not reopen this.

**2. ColdLion recurring Licensor/Property feed — Step 7A merged (`0798c095`), plus four
corrective migrations. Step 8 (switching production on) is Albert's gate, and the answer today
is NOT YET.** See §1.2 — it is the single most important thing in this handover.

**3. PopSG PSG-5 — database contracts MERGED (`691d5ea`, PR #338).** Built `core.property_alias`
and `dam.popsg_property_resolution`, with a **structural** cross-parent guard (a composite
foreign key) so a Property physically cannot be filed under the wrong Licensor — not even by a
direct privileged write that bypasses the application. **The rebuild has NOT been run.**

**4. Repo health and cross-session coordination.** Timestamp/backdating guards merged (#322,
#325); the ColdLion Step 7A tool tests are now actually wired into CI (#340); `main` is green;
two skills written and tuned; stale worktrees swept; `COORDINATOR_INTAKE.md` authored (PR #348,
still open).

---

### 1.2 ⛔ THE MOST IMPORTANT THING HERE — Step 8 readiness is **NOT YET**, for a reason that is easy to miss

Everyone who reads the ColdLion docs finds the same celebrated evidence: *"14/14 rehearsal
cases passed, two identical consecutive cycles."* **That evidence describes the promotion
function as it existed at migration `20260730000500`.**

**Four further `CREATE OR REPLACE` of that same function landed afterwards:**

| Version | What it changed | PR |
| --- | --- | --- |
| `20260731163000` | removed dead in-function failure recording | #341 |
| `20260731180000` | serialized promotion behind an advisory lock | #343 |
| `20260731190000` | **widened the cross-check predicate** (source_code + held-row provenance) | #342 |
| `20260731200000` | **changed fan-in curated-name selection** to be deterministic | #344 |

Those four **were applied to preview**. The rehearsal was **never re-run against them**.

> **Applied ≠ rehearsed.** This is the trap. A migration being present on preview says the SQL
> parsed and ran. It says nothing about whether the function still behaves correctly.

The suite is now **18 cases**: 14 passed against an **older function body**; four —
**`10a`–`10d`, in `tools/rehearse-coldlion-recurring-cycles.mjs` lines 398–442** (verified
present at those lines, 17:55 UTC) — **have never executed at all**. And the two migrations
that changed the most (`190000` fan-in cross-check predicate, `200000` fan-in name selection)
touch **exactly the machinery whose earlier bugs only the rehearsal caught**. An independent
GLM 5.2 review reached the same verdict: **NOT YET**.

#### The five things required before Step 8 can even be proposed

1. **A fresh, dated, 18-case rehearsal against the CURRENT function body**, with a durable
   evidence artifact committed to the repo. Not a chat message — a file.
2. **A written approval package naming EVERY migration by exact version.** The plan document
   and the Step 7 package each list **four**; the true manifest is roughly **eighteen**. The
   real list **must be re-derived from a live ledger comparison** (production `supabase
   migration list` vs. the repo), not copied from any document in this repo.
   **This paperwork is a functioning interlock, not a formality:**
   `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` **lines 399–407** (verified
   17:55 UTC) refuses to accept an enabled production variable unless a directory matching
   `docs/verification/coldlion-licensor-property-step8-approval-*/` containing `approval.json`
   exists. **None exists today.** The code comment says it plainly: *"With none present, the
   variable must still be off."*
3. **Proof that the ~15 unrelated pending production migrations stay out.** Use the
   **read-only `production` dry-run lane** in `.github/workflows/shared-supabase-migrations.yml`
   (job `production-dry-run`, verified 17:55 UTC). That workflow **can never apply to
   production** — it hard-refuses `apply` — and it enforces an explicit
   `production_allowlist` of exact versions, a pinned `origin/main` SHA, and a typed
   confirmation string `DRY-RUN <sha>`. Use it. Do not hand-run `supabase db push`.
4. **A production backup, and a written "before" baseline.** Last claimed baseline:
   **26 licensors, 256 properties, 542 links** — **UNVERIFIED by this session** (requires
   production access, which this session correctly did not use). Last claimed 2026-07-31.
   Re-measure it yourself before the window.
5. **Written acceptance of the monitoring gap.**
   `.github/workflows/coldlion-licensor-property-alert-monitor.yml` is **PREVIEW-ONLY** — its
   own header says so and it **hard-refuses the production ref** `qsllyeztdwjgirsysgai`
   (verified 17:55 UTC). So on the day production is switched on, production has only the
   hourly `health` lane plus whatever issue the failing run raises for itself. Albert must
   accept that in writing, or a production monitor must be built first.

**Until all five exist: do not create, do not set, and do not ask anyone to set
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`.**

---

### 1.3 What is waiting on Albert (and nothing else is blocked on him)

1. **Step 8 approval** — the production switch-on above. Not until §1.2 is satisfied.
2. **Six remaining licensor-alias rulings:** Marvel, One Piece, Peanuts, Sesame Workshop,
   Paramount, plus the dormant Nickelodeon/Viacom pair. **NBC is already ruled and recorded**
   (in PR #345) — do not re-ask him.
3. **The property codes `EX` / `LB` / `JL`**, and the **66 unmatched ColdLion codes** inherited
   from an earlier session.
4. ~~**Laura's reply.** The round-2 licensing xlsx was **SENT 2026-07-31**; awaiting response.~~
   **✅ CLOSED 2026-08-06.** Round 2 returned 2026-08-04; round 3 returned 2026-08-06, 8 of 8
   answered. **Licensing is CLOSED — no round 4, nothing outstanding with Laura.** See
   `fix_characters_style_guides.md` § *"Licensing round 3 — RETURNED"*.

---

### 1.4 Open PRs — state, what each holds, and the order they must land

All three verified OPEN and MERGEABLE at 17:55 UTC. **All four open PRs including this one
touch `HANDOFF.md`**, so they will conflict if merged carelessly. Merge **one at a time**,
oldest first, and let each re-run CI.

| PR | Branch | Files it holds | Notes |
| --- | --- | --- | --- |
| **#349** | `docs/handoff-corrections-20260731` | `HANDOFF.md` | **Must land first.** Corrects three stale sections, adds the CRITICAL ColdLion switch-on ordering warning, and adds backlog items **B6/B7**. This handover deliberately **does not restate its content** — read #349 itself. |
| **#348** | `docs/orchestrator-intake-20260731` | `AGENTS.md`, `COORDINATOR_INTAKE.md`, `HANDOFF.md` | Creates the intake queue other sessions file into. |
| **#345** | `feat/core-licensor-alias-20260731` | `HANDOFF.md`, `fix_popsg_property_taxonomy_reconciliation.md`, `supabase/migrations/20260731210000_core_licensor_alias.sql`, `supabase/tests/core_licensor_alias_contracts.sql` | The only open PR carrying a **migration**. Moves eight hard-coded licensor aliases into `core.licensor_alias`, adds the two missing NBC variants, records Albert's NBC ruling. |
| **this one** | `docs/orchestrator-handover-20260731-1755` | `HANDOFF.md` only | Rebase after the other three. |

> **Known stale text this handover does NOT fix, because #349 owns it:** the section headed
> *"OPEN, NOT MERGED — ColdLion promotion serialization lock (2026-07-31)"* near the top of
> this file is **wrong** — that work merged as PR #343 (`6a00e31`). Land #349; do not fix it
> in a competing PR.

---

### 1.5 Single-writer ownership right now

The repo's rule is **one writer per file at a time**. As of 17:55 UTC:

- **`supabase/migrations/`** — held by **PR #345** (`20260731210000`). Nobody else may add a
  migration until #345 lands or is closed. Next free version: **`20260731220000`**.
- **`HANDOFF.md`** — contended by **#349, #348, #345 and this PR**. #349 has priority.
- **`AGENTS.md`** — held by **PR #348**. Do not edit it.
- **`COORDINATOR_INTAKE.md`** — held by **PR #348** (it creates the file). Do not edit it.
- **`tools/`, `scripts/`, `.github/workflows/`** — unowned and free.

---

### 1.6 Preview `rjyboqwcdzcocqgmsyel` is **NOT a clean baseline**

Anyone who rehearses against it assuming a virgin database will get a false result. What is
sitting on it (as last relayed by the agents that put it there — **UNVERIFIED by this session,
which made no database contact**; last claimed 2026-07-31):

- The two **ClickUp** migrations **and importer data rows** in `pim.product` and
  `ingest.sync_run`.
- **All ColdLion migrations through `20260731200000`** — including the four that were never
  re-rehearsed (§1.2).
- ColdLion **audit table: 0 rows**; **quarantine table: 180 rows**.
- The **PSG-5** objects (`core.property_alias`, `dam.popsg_property_resolution`).
- **`core.licensor_alias` with 10 rows** — 3 `owner_approved`, 7 `inherited_unverified`.
- `plm.taxonomy_breaker_enforcement_status()` now reports **`expected_count: 11`** (was 9).
  **That is EXPECTED, not drift.** Do not "fix" it.

**Production `qsllyeztdwjgirsysgai` is never touched from a session.** The Supabase MCP is
bound to **PRODUCTION** and takes **no project parameter** — see §3.6.

---

### 1.7 Worktrees — all 18 accounted for (`git worktree list`, 17:54 UTC)

| Worktree | Branch | State |
| --- | --- | --- |
| `C:/repos/shared-db` | `main` | the shared checkout — its local `main` was **stale at `6720511`**; run `git pull` there |
| `agent-a2209c948a524d76a` | `docs/handoff-corrections-20260731` | **LIVE** — PR #349 open |
| `agent-a18e8dbd5e9f2a218` | `docs/orchestrator-intake-20260731` | **LIVE** — PR #348 open |
| `agent-ae7a53ae600b5b683` | `feat/core-licensor-alias-20260731` | **LIVE** — PR #345 open |
| `agent-a8fd75e9b517885c6` | `nbc-alias-work` (`7390e5a`) | **LIVE, and NOT on any PR.** Holds *"record Albert's NBC ruling and add the two variants that matched nothing"*. Confirm it is fully represented in #345 before anyone retires it. |
| `agent-a7c7145b2908491b5` | `docs/orchestrator-handover-20260731-1755` | **LIVE** — this handover; **locked** |
| `agent-a9b9b048681d1744f` | `worktree-agent-a9b9b048681d1744f` (`510c3a6`) | **CHIP-INCIDENT REMNANT** — a duplicate authoring of the fan-in tiebreak fix. Superseded by merged `cc0d1dd`. Safe to clean. |
| `elastic-babbage-df8f2e` | `claude/elastic-babbage-df8f2e` (`3222667`) | **CHIP-INCIDENT REMNANT** — a *third* authoring of the same fan-in tiebreak fix. Superseded. Safe to clean. |
| `happy-proskuriakova-a20b47` | `claude/coldlion-promotion-dead-failure-update-20260731` | finished — #341 merged |
| `intelligent-benz-f7502b` | `claude/intelligent-benz-f7502b` | finished — #342 merged |
| `adoring-bose-f6e5ef` | `claude/adoring-bose-f6e5ef` | finished — #343 merged |
| `intelligent-bhabha-81eb99` | `fix/wire-coldlion-step7a-tests-ci` | finished — #340 merged |
| `agent-a9b5bd066c13f571c` | `docs/psg5-entry-record-slot-blocked-20260731` | finished — #338 merged |
| `agent-acdee405d4b4b9701` | `docs/ci-stale-verdict-paths-filter-20260731` | finished — #336 merged |
| `agent-aed50174cbc6255a3` | `docs/handoff-improvement-plan-20260731` | finished — #347 merged |
| `admiring-mestorf-037019` | `fix/clickup-runner-confirm-clean-run` | finished — #330 merged |
| `cool-morse-9da2b5` | `fix/duplicate-migration-version-20260728160000` | finished — #322 merged |
| `wizardly-montalcini-ffdabe` | `docs/handoff-public-schema-anon-lockdown` | finished — #333 merged |

**Do not bulk-prune.** Two of these (`nbc-alias-work`, and the three open-PR worktrees) hold
work that is not on `main`. Use the `cleanup-worktree` skill, which never treats age as proof.

---

# HALF TWO — ONE BLOCK PER SUB-AGENT

Roughly 25 agents ran across this and the immediately preceding orchestrator seats. The blocks
below are reconstructed from `gh pr list --state all`, `git log`, and `git worktree list`. **Where
an agent's work survives only as a merged PR, that is stated** — no detail has been invented.
The **"deliberately did NOT do"** line is the one that stops the next session undoing good work.

## Workstream 1 — Poppim ClickUp importer (COMPLETE)

### Agent: ClickUp importer correctness — `fix/clickup-importer-correctness` (PR #311)
- **Asked to do:** review and fix the incremental ClickUp task importer before it ran against production.
- **Actually did:** rewrote the matching strategy and landed six fixes; merged as `833f134`. Superseded and closed the original PR #300 (`claude/clickup-incremental-import-20260728`).
- **Found — the headline finding of the whole session:** the importer would have inserted **17,859 duplicate products**. It matched existing rows via a backfill that claimed rows where `external_source IS NULL`; **production has zero such rows**, so nothing was ever claimed and every existing product presented as new. Fixed by matching on **trimmed `clickup_task_id` first**, backed by a **partial unique index** so the database refuses a duplicate even if the code regresses. Four other reviews had passed this code.
- **PR / branch:** #311, MERGED.
- **Worktree:** not present in the current list — retired.
- **Deliberately did NOT do:** did not run against production. Rehearsal was preview-only.

### Agent: migration re-issue — `fix/duplicate-migration-version-20260728160000` (PR #322)
- **Asked to do:** work out why a merged migration had had no effect.
- **Actually did:** merged as `df69c72`; the ClickUp migration was re-issued under a fresh version as PR #314 (`79581e2`).
- **Found — MUST SURVIVE:** **two migration files sharing one version number cause the second to be silently skipped.** Supabase records the version, not the file; the second never runs and **nothing errors**. Confirmed **read-only against production**. The remedy is **re-issue under a new version, never rename the old file** — renaming does not make an already-recorded version re-run, and rewriting history breaks every other clone.
- **PR / branch:** #322 (fix) and #314 (re-issue), both MERGED.
- **Worktree:** `cool-morse-9da2b5` — finished, safe to clean.
- **Deliberately did NOT do:** did **not** rename or delete the original migration file, precisely because that would have looked fixed while changing nothing.

### Agent: migration-version CI guards — `ci/migration-version-guards-20260729` (PR #325)
- **Asked to do:** make the above impossible to repeat.
- **Actually did:** added **Guard B** (backdated migration) on top of #322's duplicate check. Merged `c37af1b`.
- **Found:** only visible as the merged PR.
- **Worktree:** not present — retired.
- **Deliberately did NOT do, and this is the gap:** these guards are **branch-local**. They compare a PR against `main`. They **cannot see a second PR** doing the same thing at the same time — which is exactly how the chip incident (§3.3) slipped through. See backlog **B6**.

### Agents: ClickUp runner hardening — PRs #324, #330
- **Asked to do:** stop the runner reporting success it had not verified.
- **Actually did:** #324 (`1fa95cc`) exits non-zero when the importer result cannot be parsed; #330 (`86bc012`) **positively confirms a clean run** instead of assuming one. Both MERGED.
- **Found:** the runner previously treated "no error" as "success" — a silent-failure pattern.
- **Worktree:** `admiring-mestorf-037019` — finished, safe to clean.
- **Deliberately did NOT do:** did not change importer logic; scope was the runner's reporting only.

## Workstream 2 — ColdLion recurring Licensor/Property feed

### Agent: Step 7A build — `codex/coldlion-step7a-recurring-production-feed` (PR #331)
- **Asked to do:** build the real recurring production Licensor/Property feed and prove it on preview.
- **Actually did:** built it; merged as **`0798c095`** (commit `2c89664`). This is the Step 7A body of work.
- **Found — the five defects the rehearsal caught (MUST SURVIVE):**
  1. **The collision rule would have quarantined 542 of 542 approved rows — the entire feed — while the run reported healthy.** The approved mapping deliberately **fans 542 source rows into 271 canonical rows**; the rule treated any canonical row reachable from more than one typed key as a collision. Fixed by `20260729234500`.
  2. **The alert path never actually recorded**, so the circuit breaker could never trip — a monitor that looked installed and was inert.
  3. An **ambiguous column** reference (`20260729235500`).
  4. **Absence detection** was wrong (`20260730000500`).
  5. Plus the dead in-function failure recording later removed by #341.
- **PR / branch:** #331, MERGED.
- **Worktree:** not present — retired.
- **Deliberately did NOT do:** did **not** switch production on. Step 8 was left as an explicit owner gate — correctly, see §1.2.

### Agent: dead failure recording — `claude/coldlion-promotion-dead-failure-update-20260731` (PR #341)
- **Asked to do:** remove failure-recording code inside `plm.promote_coldlion_source_owned` that could never run.
- **Actually did:** merged `01f0214`. Migration `20260731163000`.
- **Found:** one of the **three "installed but inert" defects** (§3.4) — code present, never reached.
- **Worktree:** `happy-proskuriakova-a20b47` — finished, safe to clean.
- **Deliberately did NOT do:** did not re-run the rehearsal after changing the function body. **This is part of why Step 8 is NOT YET.**

### Agent: cross-check provenance coverage — `claude/intelligent-benz-f7502b` (PR #342)
- **Asked to do:** extend the Step 5.6 plan cross-check to every write path.
- **Actually did:** merged `49d2ac1`. Migration `20260731190000` — widened the cross-check to the `source_code` and held-row provenance paths.
- **Found:** **two blind spots** in the old, narrower assertion, both now encoded as rehearsal cases **10b** and **10c**: (b) a **`source_code`-only drift** where all names agree, so the curated-name set is empty and the old cross-check saw a perfectly quiet cycle while the database was still rewriting `core.taxonomy_source_ref.source_code`; (c) a **row held for review** still has its provenance refreshed by design, but the old assertion required `quarantine_reason IS NULL`, so that write fell outside it. Case **10a** refuses an out-of-date runner (a plan with no `provenance_refreshes` key); case **10d** proves the new guard does **not cry wolf** on a healthy cycle — *"a guard that fails on a healthy cycle gets switched off, which is the same outcome as having no guard."*
- **Worktree:** `intelligent-benz-f7502b` — finished, safe to clean.
- **Deliberately did NOT do:** **wrote cases 10a–10d but never executed them.** They sit at `tools/rehearse-coldlion-recurring-cycles.mjs` lines 398–442 and **have never run**. Running them is task #1 for the next orchestrator.

### Agent: serialization lock — `claude/adoring-bose-f6e5ef` (PR #343)
- **Asked to do:** stop two promotion runs overlapping.
- **Actually did:** merged `6a00e31`. Migration `20260731180000` — an advisory lock around Step 7A promotion.
- **Worktree:** `adoring-bose-f6e5ef` — finished, safe to clean.
- **Deliberately did NOT do:** did not re-rehearse. Note the top of this file still describes this PR as *"OPEN, NOT MERGED"* — stale text that **PR #349 corrects**.

### Agents: fan-in name tiebreak — `fix/coldlion-fanin-name-tiebreak-20260731` (PR #344) **and two duplicate authorings**
- **Asked to do:** make the fan-in curated-name winner deterministic.
- **Actually did:** merged as `cc0d1dd`, migration `20260731200000`.
- **Found — this is the physical evidence of the chip incident (§3.3):** **three separate worktrees each independently authored this same fix.** Verified at 17:54 UTC: `agent-a9b9b048681d1744f` holds `510c3a6` and `elastic-babbage-df8f2e` holds `3222667`, both titled *"fix(coldlion): make the fan-in curated-name winner deterministic"*, alongside the merged `cc0d1dd`. Two are dead duplicates.
- **Worktree:** the merged branch's worktree is gone; the two duplicates are **live and safe to clean** once someone confirms nothing unique is in them.
- **Deliberately did NOT do:** did not re-rehearse — this is the migration that changed name selection, i.e. the one **most** in need of a fresh rehearsal.

### Agent: wire Step 7A tests into CI — `fix/wire-coldlion-step7a-tests-ci` (PR #340)
- **Asked to do:** make the ColdLion Step 7A tool tests actually run.
- **Actually did:** merged `36c50a9` — they now run on every PR and every push to `main`.
- **Found:** the tests existed but **were not executed by CI** — another "installed but inert" instance (§3.4).
- **Worktree:** `intelligent-bhabha-81eb99` — finished, safe to clean.
- **Deliberately did NOT do:** did not widen coverage; scope was wiring only.

### Agent: Windows vendor-sync no-op — `fix/coldlion-vendors-windows-noop-20260731` (PR #334)
- **Asked to do:** find why the ColdLion vendor sync did nothing.
- **Actually did:** merged `400b590` — *"stop the ColdLion vendor sync silently doing nothing on Windows"*.
- **Found:** a **silent** platform-specific no-op — it reported success while syncing nothing.
- **Worktree:** not present — retired.

### Agent: source-of-truth plan — `docs/coldlion-source-of-truth-plan-20260731` (PR #335)
- **Actually did:** merged `defcb20` — currently the `main` tip. A plan for making ColdLion the source of truth for every core table it feeds.
- **Deliberately did NOT do:** authored **no SQL and no migration**. Plan only. Do not treat it as executed work.

### Agents: ColdLion health monitors — PRs #306, #317, #329
- **Actually did:** recorded preview cycle health on 2026-07-29 (`d8ad7bb`, `3002490`, `7111fdd`). All MERGED, all documentation.
- **Found:** those recordings describe the **pre-`20260731` function body** and are **not** evidence for the current one.

## Workstream 3 — PopSG PSG-5

### Agent: PSG-5 database contracts — `docs/psg5-entry-record-slot-blocked-20260731` (PR #338)
- **Asked to do:** build the PopSG Property reconciliation contracts.
- **Actually did:** merged **`691d5ea`**. Migrations `20260731150000_popsg_property_resolution_contracts.sql` and `20260731153000_popsg_property_alias_redundancy_trigger_fix.sql`. Created `core.property_alias` and `dam.popsg_property_resolution`.
- **Found:** the cross-parent guard had to be **structural**, not procedural — implemented as a **composite foreign key**, so a Property cannot be filed under the wrong Licensor **even under a direct privileged write** that bypasses every application check. The second migration fixed a redundancy trigger the tests caught.
- **Worktree:** `agent-a9b5bd066c13f571c` — finished, safe to clean.
- **Deliberately did NOT do:** **did not run the rebuild.** The contracts exist; the data has not been reconciled. Do not assume PopSG properties are resolved.

### Agents: earlier PSG-5 attempts — PRs #310, #312
- **Actually did:** recorded a fresh-session authorization (#310) and then recorded that PSG-5 **stopped before schema work** because of a collision with PR #300 (#312). Both MERGED, both documentation.
- **Deliberately did NOT do:** wrote **no SQL** — correctly refused to author schema while the slot was occupied. This is the behaviour to copy, not the exception.

### Agent: licensor alias table + NBC ruling — `feat/core-licensor-alias-20260731` (PR #345, **STILL OPEN**)
- **Asked to do:** move the eight hard-coded Licensor aliases into a real table and record Albert's NBC ruling.
- **Actually did:** authored `supabase/migrations/20260731210000_core_licensor_alias.sql` and `supabase/tests/core_licensor_alias_contracts.sql`. **NOT MERGED.**
- **Found — the NBC finding, MUST SURVIVE:** all four spellings **normalise to four DIFFERENT keys**; **`NBCU` and `NBCUniversal` matched nothing at all**; and **`NBC` itself correctly must NOT be an alias row**. Also caught a **timezone bug** that would have dated Albert's ruling **2026-07-30 instead of 2026-07-31** — i.e. the audit trail would have recorded the wrong day for an owner decision. Also found the approval RPC's guard is **null-permissive** (a null slips past it) — recorded to backlog, not fixed here.
- **Worktree:** `agent-ae7a53ae600b5b683` — **LIVE**. Related loose worktree `agent-a8fd75e9b517885c6` (branch `nbc-alias-work`, `7390e5a`) is **also live and on no PR**.
- **Deliberately did NOT do — READ THIS BEFORE CELEBRATING:** **`core.licensor_alias` has ZERO runtime effect until the PopDAM worker in `u2giants/popdam3` is switched over to read it.** That worker still reads **its own hard-coded array**. Landing #345 changes nothing user-visible. The popdam3 change is a **separate task in a separate repo** and has not been started.

### Agent: Grok — independent review of the alias work
- **Asked to do:** independently review the alias shadowing guard.
- **Found:** the guard is **one-way**. It stops a new alias colliding with an existing licensor name, but **nothing stops a later licensor RENAME colliding with an existing alias**. Crucially, Grok also established that **the same gap already exists in the already-shipped `core.property_alias`** — so this is a **repo-wide pattern, not a regression introduced by #345**, and must not be used as a reason to block #345.
- **Deliberately did NOT do:** did not fix it. Backlog item.

### Agent: GLM 5.2 — independent reviews (ColdLion readiness, and the alias work)
- **Found (correct):** independently returned **NOT YET** on Step 8 readiness, agreeing with §1.2.
- **Found (WRONG — and this matters more):** GLM produced **two "High" severity findings that were both wrong on inspection**, and **one of them contradicted GLM's own earlier conclusion in the same review.**
- **The protocol this produced, which must survive:** treat **every** Critical/High finding from any reviewing model as a **hypothesis requiring line-level evidence before it blocks a merge**. The merge gate is **"no UNRESOLVED findings"**, not **"zero findings"**. A wrong "High" that nobody checks costs a whole session.

## Workstream 4 — repo health and coordination

### Agent: stale CI verdict — `docs/ci-stale-verdict-paths-filter-20260731` (PR #336)
- **Actually did:** merged `1f2af58`, documented as **`AGENTS.md` §5.2** (verified present at line 360, 17:55 UTC).
- **Found — the stale-red-CI trap:** a repo-wide checker sitting behind a **narrow `paths:` filter** reports a **stale verdict**. A correct fix can leave the light **red** simply because **nothing re-ran**. Before you debug a red check, confirm it actually ran against the current commit. See backlog **B2**.
- **Worktree:** `agent-acdee405d4b4b9701` — finished, safe to clean.

### Agent: improvement backlog — `docs/handoff-improvement-plan-20260731` (PR #347)
- **Actually did:** merged `3635a16` — recorded backlog **B1–B5** and marked the Laura round-2 sheet **SENT**.
- **Worktree:** `agent-aed50174cbc6255a3` — finished, safe to clean.

### Agent: handoff corrections — `docs/handoff-corrections-20260731` (PR **#349, STILL OPEN**)
- **Asked to do:** correct stale sections of `HANDOFF.md` and add the ColdLion switch-on ordering warning.
- **Actually did:** authored corrections to three stale sections, the **CRITICAL ColdLion switch-on ordering warning**, and backlog items **B6** (cross-PR object guard) and **B7** (prove it fires).
- **PR / branch:** **#349, OPEN, MERGEABLE, `HANDOFF.md` only.**
- **Worktree:** `agent-a2209c948a524d76a` — **LIVE**.
- **Deliberately NOT duplicated here:** this handover **references** #349 rather than restating it, to avoid a merge conflict on the same file. **#349 must land first.**

### Agent: orchestrator intake — `docs/orchestrator-intake-20260731` (PR **#348, STILL OPEN**)
- **Actually did:** authored `COORDINATOR_INTAKE.md` plus `AGENTS.md` and `HANDOFF.md` edits — the queue and template non-orchestrator sessions use to hand work in.
- **Worktree:** `agent-a18e8dbd5e9f2a218` — **LIVE**.

### Agents: public-schema lockdown — PRs #316, #318, #319, #320, #326, #327, #332, #333
- **Actually did:** closed anonymous EXECUTE and anonymous READ leaks in the `public` schema; **live on production**; documented in `fix_public_schema_anon_lockdown.md` and `AGENTS.md` §10.2.
- **Found:** the anon key could execute `SECURITY DEFINER` functions in `public` (#316), and three RLS-bypassing views plus `style_groups` leaked reads (#326).
- **Standing consequence:** new functions in `public` are **locked down by default**, so **every** new migration must state its grants **explicitly** or the function will be unusable.
- **Worktree:** `wizardly-montalcini-ffdabe` — finished, safe to clean.
- **Deliberately did NOT do:** left five non-urgent follow-ups open, listed in that file.

### Agents: characters / style guides and licensing sheets — PRs #297–#299, #321, #323, #339, #346
- **Actually did:** Phase 3 identity rules, owner answers, the 195-question licensing sheet for Laura, the round-2 xlsx with locked dropdowns, and session close-outs. All MERGED.
- **Deliberately did NOT do:** **Phase 3 has not run.** It **writes rows into three shared tables**, so it must be scheduled by whoever owns collision control — **do not start it opportunistically.** Read the STATUS table at the top of `fix_characters_style_guides.md`; do not re-derive the phases.

---

# 3. WHAT WE TRIED THAT DID **NOT** WORK

### 3.1 Background task chips — never again
Spawning background task chips for shared-db work **created independent sessions with no shared
register**. This is the single largest source of waste in this repo. The rule is in backlog
**B4** and in `shared-db-orchestrator`: **the orchestrator dispatches sub-agents in worktrees; it
never creates chips.**

### 3.2 Trusting plan documents over the live repo
Repeatedly wrong. The plan and the Step 7 package each name **four** migrations where the true
manifest is roughly **eighteen**. Documents here go stale **within the hour**. Always
`git fetch`, `gh pr list`, `git worktree list`, and re-derive.

### 3.3 The self-inflicted chip incident, and blind rebasing — the expensive one
Five background chips spawned five independent sessions. **Four of them each authored a forward
migration doing `CREATE OR REPLACE` on the SAME function**, and **three of them picked the same
version, `20260731170000`**. Every one **passed CI on its own**, because the migration guards
are **branch-local** and compare only against `main` — they cannot see a sibling PR.

Then the attempted fix made it worse: **blind rebasing / cherry-picking of competing
`CREATE OR REPLACE` migrations applies with NO textual conflict**, because each migration is a
**new file**. **Git cannot warn you.** The result is a stack of files that all look fine and a
function body that is whichever one ran last.

**What actually worked:** merge **one at a time**, and after each merge **RE-DERIVE the next
change on top of the previous merged function body** — never replay the original diff. That is
how `20260731163000` / `180000` / `190000` / `200000` ended up as a coherent sequence.

**The root cause is STILL UNFIXED.** There is no cross-PR guard that detects two open PRs
replacing the same database object. That is backlog **B6**. Until it exists, **§1.5
single-writer ownership is the only protection**, and it is a convention, not a mechanism.

### 3.4 Assuming an installed thing works — three "installed but inert" defects
1. A **`BEFORE` trigger reading a `GENERATED ... STORED` column.** The column is always NULL at
   `BEFORE` time, so the trigger **never fired — and never errored.** Perfectly silent.
2. A **function that failed on every single call.**
3. The **ColdLion alert path that never recorded**, so the circuit breaker could never trip.
   A monitor that cannot fire is worse than no monitor, because everyone believes it.

**The rule (backlog B7): prove it FIRES. Not that it exists.** Every guard, trigger, monitor and
test must be demonstrated triggering on a deliberately broken input before it counts as done.

### 3.5 GLM on large exploratory briefs
GLM **hung for roughly 40 minutes** on large open-ended briefs. What works: **compact,
self-contained briefs**; if it hangs, **retry once, tighter**; then **fall back to your own
review** rather than waiting. Budget for this — do not block a merge on a hung reviewer.

### 3.6 The Supabase MCP is bound to PRODUCTION
It takes **no project parameter**. Anything you run through it hits
**`qsllyeztdwjgirsysgai` — production**. If you must know which project you are on, call
**`get_project_url` FIRST**. For preview work, use the **Supabase CLI / psql against
`rjyboqwcdzcocqgmsyel`**, never the MCP. **This session made no database contact of any kind.**

---

# 4. THE FRESH ORCHESTRATOR'S OPENING AGENDA, IN ORDER

1. **Re-verify §0.** `git fetch --all`, `git ls-remote origin refs/heads/main`, `gh pr list`,
   `git worktree list`, and re-derive the max migration version. Do not trust the table above;
   it was true at 17:55 UTC on 2026-07-31 and nothing keeps it true.
2. **Update the shared checkout.** `C:/repos/shared-db` had a **stale local `main` at
   `6720511`** while `origin/main` was at `defcb20`.
3. **Merge PR #349 first.** It corrects stale text including the wrong *"OPEN, NOT MERGED —
   serialization lock"* section, and adds backlog B6/B7.
4. **Then #348**, then **#345**, then **rebase and merge this handover PR**. One at a time; let
   CI re-run after each; remember §3.4 — a red light may be a **stale verdict** (`AGENTS.md` §5.2).
5. **Reconcile the loose `nbc-alias-work` worktree** against #345 before anyone cleans it.
6. **Dispatch ONE sub-agent to run the full 18-case rehearsal** against the current promotion
   function on preview, and commit a dated evidence artifact. This is the gate on everything
   ColdLion. Cases 10a–10d have **never executed**.
7. **Dispatch ONE sub-agent to re-derive the true production migration manifest** from a live
   ledger comparison, and to run the read-only `production` dry-run lane to prove the ~15
   unrelated pending migrations stay out.
8. **Only then** assemble the Step 8 approval package for Albert — and remember the evaluator
   at lines 399–407 will refuse an enabled variable until `approval.json` exists.
9. **Do not start** Phase 3 (characters), the PSG-5 rebuild, or the popdam3 alias cutover
   opportunistically. Each writes to shared tables or another repo and needs its own slot.
10. **Retire the two chip-incident worktrees** (`agent-a9b9b048681d1744f`,
    `elastic-babbage-df8f2e`) via the `cleanup-worktree` skill.

---

# 5. FRESH-DEVELOPER SELF-AUDIT

**Question:** could a developer who walked in this morning with zero knowledge of this
application, this session, or what was tried and failed, continue with **no questions**?

**Answer: yes, for the coordination work**, and here is the evidence: every moving fact in §0
carries the command that produced it and the minute it was checked; every open PR has its
branch, its files, its merge position and its blocking relationship; every one of the 18
worktrees is classified live/finished/remnant with a reason; every sub-agent block states what
it deliberately did **not** do; and the four traps that cost this team the most time — the
silently-skipped duplicate migration version, the applied-but-never-rehearsed function, the
chip incident with its no-textual-conflict rebase trap, and the three inert-but-installed
guards — are each written out with the mechanism, not just the conclusion.

**Where it is honestly incomplete, and the newcomer is told so explicitly:** every figure that
requires production or preview database access — the 26/256/542 baseline, the preview row
counts, the ~15 pending production migrations — is marked **UNVERIFIED** with the date it was
last claimed, because this session made **no database contact**. The newcomer's **first** action
on that material is to re-measure it, and §4 says so. That is the correct outcome: an unverified
number that is labelled unverified costs an hour; one presented as fact costs a production
incident.

<!-- ============================================================================
     END ORCHESTRATOR HANDOVER — 2026-07-31 17:55 UTC
     ============================================================================ -->

---

> **Separate workstream, also read if you are touching privileges or promoting to production:**
> [`fix_public_schema_anon_lockdown.md`](fix_public_schema_anon_lockdown.md) (2026-07-30) — the
> `public`-schema anonymous-access lockdown. That work is **complete and live on production**;
> the file covers five non-urgent follow-ups. Two things in it affect *this* workstream:
> **(a)** `20260729120000` is still pending on production and must be promoted **with or after**
> the ClickUp migrations (`20260728174500`), never before, or the apply aborts with
> `undefined_function`; **(b)** new functions in `public` are now locked down by default, so
> every migration must state its grants explicitly — see `AGENTS.md` §10.2.

> **Separate workstream, unfinished, does NOT touch this one's migrations:** characters and style
> guides. Phases 0–2 are complete (schema live and **empty** on preview, production untouched);
> **Phase 3 is blocked** on a second licensing round sent 2026-07-31 and on an owner ruling for
> the missing property codes `EX` / `LB` / `JL`. **Read the STATUS table at the top of
> [`fix_characters_style_guides.md`](fix_characters_style_guides.md) first — do not re-derive the
> phases.** Cross-workflow context, including the failed paths, is in
> [`orchestrator_take_over.md`](orchestrator_take_over.md). **Phase 3 writes rows into three shared
> tables when it runs, so it must be scheduled by whoever owns collision control — do not start
> it opportunistically.**

## 🛑 BLOCKING — Step 8 readiness verdict is **NOT YET**: the 14/14 rehearsal does NOT describe the function that would run in production (2026-07-31)

**This is the single most important fact in this file. It outranks the ordering warning below —
both apply, but this one says Step 8 cannot be approved at all yet.** Verdict from a Step 8
readiness assessment (GLM 5.2 plus independent verification), 2026-07-31.

**The problem.** The rehearsal evidence everyone cites — "14/14, two identical cycles" in
[`docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md`](docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md)
§4 — was run against `plm.promote_coldlion_source_owned` **as of migration `20260730000500`**.
**Since then FOUR further `create or replace` of that same function landed:** `20260731163000`,
`20260731180000`, `20260731190000`, `20260731200000`. The rehearsed body no longer exists.

**Applied ≠ rehearsed — state this precisely, the nuance matters:**

- Those four migrations **WERE** subsequently applied to preview (the preview ledger confirms
  `20260731163000 / 180000 / 190000 / 200000`). The line in
  [`docs/verification/coldlion-promotion-crosscheck-coverage-20260731/README.md`](docs/verification/coldlion-promotion-crosscheck-coverage-20260731/README.md)
  saying "**NOT yet applied to preview, NOT rehearsed against a database**" is therefore **half
  stale**: the "not applied" half is out of date, **the "not rehearsed" half is still true.**
- **The rehearsal was never re-run.** That same README adds **four new fault cases `10a`–`10d`**
  to `tools/rehearse-coldlion-recurring-cycles.mjs` (lines 398–442) — refusal of an out-of-date
  runner plan, the `source_code`-drift blind spot, the held-row provenance blind spot, and a
  don't-cry-wolf healthy-cycle case. **None of the four has ever been executed.**
- So the suite is now **18 cases: 14 passed against an older function body, 4 never run.**
  There is **zero** rehearsal evidence for the body that is live on preview today.

**Why that is not a paperwork quibble.** `20260731200000` changes the **fan-in name-selection**
logic and `20260731190000` changes the **cross-check predicate** and adds a **fail-closed
refusal of out-of-date runner plans**. That is precisely the machinery whose earlier bugs the
rehearsal was **the only thing that caught**. Reasoning about it offline is what produced those
bugs in the first place.

**Also a discoverability failure:** versions `20260731163000`, `20260731190000` and
`20260731200000` appear **nowhere** in `HANDOFF.md` (before this correction) or in
`plan_coldlion_licensor_property_accelerated_cutover.md` — only inside their own migration files
and that one README. Anyone building the Step 8 migration list from the plan would silently omit
them.

**REQUIRED NEXT ACTION:** a **fresh, dated rehearsal against the CURRENT function body, all 18
cases green, with a durable evidence artifact** committed under `docs/verification/`. Until that
exists, Step 8 is not approvable.

### The five things Albert should require before approving Step 8

1. **The fresh 18-case rehearsal above**, against the current body, dated, with the artifact
   committed.
2. **A written, dated approval package naming EVERY migration by exact version.** The plan and
   the Step 7 change package each list **four**; the true manifest is roughly **18**. It must be
   **re-derived from a live ledger comparison, never counted from memory or from the plan.**
   Note this is a real interlock, not bureaucracy:
   `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` (lines 399–407) scans for
   `docs/verification/coldlion-licensor-property-step8-approval-*/approval.json` and **blocks an
   enabled variable when none exists**. **No such directory exists today** (verified by listing
   `docs/verification/`).
3. **Proof the ~15 unrelated pending production migrations stay out.** A cheap, read-only proof
   already exists: `.github/workflows/shared-supabase-migrations.yml` refuses a production apply
   outright and offers a `production` **DRY-RUN** that runs
   `scripts/production_migration_guard.py prepare` with an explicit **comma-separated version
   allowlist**. **Require that dry-run output before the window opens.**
4. **A production backup plus a "before" baseline capture** — **26 licensors, 256 properties,
   542 links** — so that "did anything change?" is answerable with a fact rather than an opinion.
5. **An explicit written acceptance of weaker production alerting.**
   `.github/workflows/coldlion-licensor-property-alert-monitor.yml` is **PREVIEW-ONLY and
   hard-refuses the production ref** (verified: it hard-codes the preview ref and aborts if it
   equals `qsllyeztdwjgirsysgai`). In production the **only** channels are the hourly `health`
   lane and the failing run's own GitHub issue — **so a durable alert recorded by a run that
   exits 0 can sit unseen for up to an hour.** Albert should accept that in writing, or the gap
   should be closed first.

### Open items that are RESOLVED — do NOT carry these forward (corrected 2026-07-31)

- **`SUPABASE_DB_PASSWORD_PRODUCTION` already exists** (created 2026-07-10). Step 8's "create
  the secret" step is **moot**; what is actually needed is **validation** that it works.
- **The four Step 7A test files ARE wired into CI.**
  `.github/workflows/tools-offline-tests.yml` globs `tools/*.test.mjs` on **every pull request
  and every push to `main`**, with an explicit guard that fails if any of the four goes missing
  (verified at lines 34–35, 64–93). All green. Earlier text in this file saying the suite is
  "not enforced by CI" is **stale** — see the note in B1/B5.
- **The "ColdLion Phase 6 Parallel Run (preview)" failure is resolved.** The **16:54 run on
  2026-07-31 succeeded**; the 14:35 failure was a one-off. Do not re-investigate it.
- **CRLF is a non-issue for automation.** Nothing in `tools/`, `scripts/`, or any workflow calls
  `pg_get_functiondef`. It is a **manual-comparison nuisance only**. Keep backlog item B1
  (`.gitattributes`), but **its stated impact is downgraded** — it is tidiness plus local test
  noise, not a correctness risk to the lane.

### For accuracy — the rollback tool is genuinely good, with one honest limit

`tools/emit-coldlion-rollback-sql.mjs` **refuses to emit for anything other than exactly 542
mappings**, rejects unsafe composite keys, deletes **only** those 542 `core.taxonomy_source_ref`
rows, and clears the mirror link and `resolution_status` together. **It touches no canonical row,
no status and no parent.** Its one real limitation: **it does NOT restore an overwritten name** —
those must be reconstructed by hand from the audit log. Because only normalization-equivalent
name changes are possible, that is **cosmetic cleanup rather than a crisis** — but say it plainly
rather than implying a full restore. **It also has no unit test (see B8).**

---

## 🛑 CRITICAL — ColdLion production switch-on ORDER (read before touching anything ColdLion)

**Corrected 2026-07-31. Do not shorten this section. Getting the order wrong writes bad data to
production overnight, unattended, with nobody watching.**

> **Read this together with the 🛑 BLOCKING section immediately above.** That one says Step 8 is
> **not approvable yet** (the rehearsal does not cover the current function body). This one says
> that **when** it becomes approvable, the switch-on has a mandatory order. Both apply.

**The trap.** `.github/workflows/coldlion-licensor-property-production.yml` is **already on
`main` and already carries live `schedule:` crons** — `0 6 * * *` (coldlion snapshot),
`30 6 * * *` (**promote — this one WRITES to production**), `0 7 * * *` (compare) and
`45 * * * *` (health, hourly). Those crons fire today. They no-op for exactly **one** reason:
the repository variable `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` does not exist, so the
`gate` job short-circuits. **Arming the whole thing is therefore a single `gh variable set`
command**, after which all four lanes — promote included — go live within 24 hours with no
human present.

**What is NOT in production yet.** The four ColdLion correctness migrations
`20260731163000`, `20260731180000`, `20260731190000`, `20260731200000` are merged to `main`
and **applied to PREVIEW only**. **Production still holds the OLD function body** of
`plm.promote_coldlion_source_owned` — unserialized, without the provenance cross-check, without
the fan-in tie-break, and with the dead failure-recording handler.

**Therefore the switch-on order is MANDATORY and is three steps, in this order:**

1. **Promote exactly those four migrations to production** using the bounded procedure in
   `AGENTS.md` §5. **NEVER `--include-all`** — production also holds roughly **15 deliberately
   unpromoted migrations** belonging to other workstreams, and `--include-all` would apply all
   of them in one unreviewed shot.
2. **Verify the production function body actually contains all four changes** before trusting
   it: advisory lock **`720260729`**, the **`v_server_prov_keys`** cross-check, the
   **`arm_rank`** tie-break, and **NO `exception when others` handler** in the function body.
   Read the deployed definition — do not infer it from the ledger.
3. **Only then** set `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`.

**Plainly: if the variable is flipped first, the OLD, unserialized function body runs against
live production data nightly and unattended** — reintroducing exactly the skipped-cycle and
fan-in hazards that the 2026-07-31 rehearsal was run to remove.

**Step 8 is Albert's approval gate — and "Step 8 = approval" must NOT be read as "enable the
workflow."** Approval *precedes* the careful promotion sequence above; it does not replace it.
Nobody may set that variable as the first action after an approval.

---

## RESOLVED — ColdLion promotion serialization lock, MERGED and APPLIED TO PREVIEW (2026-07-31)

**Corrected 2026-07-31.** This section previously read "OPEN, NOT MERGED", claimed migration
`20260731180000` was sitting unmerged on branch `claude/adoring-bose-f6e5ef`, and listed two
gates ("land PR #338 first", "then preview-prove it"). **All of that is now false. Both gates
were satisfied and the work shipped.** The stale text caused at least one later session to
re-plan work that was already done.

**What actually happened, with evidence:**

- **PR #338** (PSG-5, `20260731150000` + `20260731153000`) **merged** — merge commit
  `691d5ea`. Gate 1 satisfied.
- **`20260731180000_coldlion_recurring_promotion_serialization_lock.sql` is on `main`**, landed
  as commit `6a00e31` via **PR #343**. The branch `claude/adoring-bose-f6e5ef` is no longer the
  place to look for it.
- **All four ColdLion correctness migrations were then APPLIED TO PREVIEW:**
  `20260731163000`, `20260731180000`, `20260731190000`, `20260731200000`. The preview ledger
  reads `20260731150000, 20260731153000, 20260731163000, 20260731180000, 20260731190000,
  20260731200000`. Gate 2 satisfied.

**What each of the four does** (all four are `create or replace` on
`plm.promote_coldlion_source_owned`, so the LAST one, `20260731200000`, defines the body that
is live on preview):

- `20260731163000` — removes the dead in-function failure recording; no body-level
  `exception when others` handler remains.
- `20260731180000` — transaction-scoped advisory lock **`720260729`**, so a manual ColdLion
  drill and the scheduled promotion can no longer promote the same rows at once. A skip returns
  `mode = skipped_already_running` and must be recorded `cancelled`, never `failed`.
- `20260731190000` — the two-set §5.6 cross-check (`promotions` AND `provenance_refreshes`) via
  `v_server_prov_keys`.
- `20260731200000` — the fan-in name tie-break (`arm_rank`), carrying the other three forward
  unchanged.

Rationale, the skip contract, and why a skip must be `cancelled`:
[`docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md`](docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md)
§ "Fault 6" and [`docs/advisory-lock-registry.md`](docs/advisory-lock-registry.md).

**Still deliberately NOT done:** none of the four is promoted to **production**, the production
lane is still disabled, and `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` was **not** created.
Step 8 (Albert's production approval) is unchanged. **See the 🛑 CRITICAL section immediately
above for the mandatory order — it is not "flip the variable".**

**Depends on a sibling branch:** `origin/fix/wire-coldlion-step7a-tests-ci` adds
`.github/workflows/tools-offline-tests.yml`, which runs `tools/*.test.mjs` on every pull
request via a glob. The new `tools/coldlion-promotion-serialization-lock.test.mjs` is picked up
by that glob automatically — no CI wiring was duplicated here. **That branch has no PR open
yet.** Until it lands, these tests are not enforced by CI on pull requests.

---

## BACKLOG — repository-level improvements, NOT STARTED (recorded 2026-07-31)

> ⛔ **OBSOLETE 2026-08-07 — DO NOT DO THIS.** This used to require every `B<n>` to ALSO appear
> as an entry in the `## REQUEST QUEUE` of `COORDINATOR_INTAKE.md`. **That file is retired and
> the CI check that enforced this is deleted.** Re-seeding it would rebuild the queue, which is
> exactly what backlog B10's closure above exists to prevent. Backlog items are tracked as
> issues: `gh issue list --label db-work`.
>
> *Original wording, kept for the record:* ~~Every `B<n>` below must ALSO appear as a short
> entry in the `## REQUEST QUEUE` of `COORDINATOR_INTAKE.md`, and keeping that true is the
> outgoing orchestrator's responsibility at handover.~~

> ## ⛔ THIS BACKLOG IS A POINTER NOW. Do not track work here. (2026-08-09, plan item E)
>
> **All 14 `B<n>` items are accounted for. Eight are open GitHub issues; six are closed.
> Nothing here is outstanding-but-untracked, and no new `B<n>` may be added.**
>
> The one list is:
>
> ```bash
> gh issue list --repo u2giants/shared-db --label db-work
> ```
>
> **Why this changed.** This section was a SECOND tracker running alongside Issues, which is the
> exact thing `plan_coordinator-queue-to-github-issues.md` §1 forbade in its own words: *two
> tracking systems is strictly worse than the one bad system we have, because "which is right?"
> stops being rhetorical.* It was already producing that ambiguity — the retired intake pointer
> told readers to check both places by written instruction.
>
> **Re-derived live on 2026-08-09, not copied from the plan:**
>
> | Item | State | Evidence |
> |---|---|---|
> | B1 line endings / `.gitattributes` | **TRACKED** | issue #545 |
> | B2 repo-wide checkers behind narrow `paths:` | **CLOSED — done** | Its own recommended fix shipped: the standalone, unfiltered `.github/workflows/domain-ownership.yml`, whose `Domain ownership` context is required. B2's own stated verification test — a PR touching only `HANDOFF.md` shows the ownership check while the Docker build, Playwright and `deploy-development` stay silent — is the PR that introduced this pointer |
> | B3 `SECURITY DEFINER` exposure | **TRACKED** | issue #546 |
> | B4 never create background task chips | **CLOSED — standing policy** | Not a task. Lives in `AGENTS.md` §12 and the `shared-db-orchestrator` skill |
> | B5 carried-forward constraints | **TRACKED** | issue #547 |
> | B6 cross-PR object collision guard | **TRACKED** | issue #529 — and the guard itself now exists as a required context |
> | B7 negative-path assertions | **CLOSED — standing policy, sub-item verified** | The rule is policy. Its one concrete LOW sub-item asked whether `main` requires branches to be up to date, which would close Guard B's strict-`<` hole. Verified 2026-08-09 via `gh api repos/u2giants/shared-db/branches/main/protection`: `strict: true`. The hole is closed; do **not** edit `scripts/check-sql.sh` |
> | B8 no unit test for `emit-coldlion-rollback-sql.mjs` | **TRACKED** | issue #520 |
> | B9 no armed-but-read-only state | **TRACKED** | issue #548 |
> | B10 intake lifecycle/retention | **CLOSED 2026-08-07** | ⛔ Do not implement — it would rebuild the retired queue |
> | B11 paused agent vs finished agent | **TRACKED** | issue #549 |
> | B12 WSL `psql` orphaned processes | **TRACKED** | issue #550 |
> | B13 CI check tying `B<n>` to the queue | **RETIRED 2026-08-07** | The queue it checked no longer exists |
> | B14 ENOBUFS cliff | **RESOLVED 2026-07-31** | No longer a Step 8 blocker |
>
> **Zero new issues were created by this change**, which was the point: eight already existed, and
> "open an issue per item" would have manufactured eight duplicates while claiming to reduce sprawl.
>
> ⚠️ **An empty issue list still does not mean there is no work** — it means nothing is filed.
> Read the newest `HANDOFF.d/` files before concluding the project is idle.

<details>
<summary><strong>Original B1–B14 backlog text, kept verbatim for the record. It is HISTORY, not a queue — do not add to it and do not act from it without checking the issue above.</strong></summary>

**Status: documentation only. Nothing in this section has been implemented.** It was written by
a planning session that was explicitly forbidden from changing anything except this file — no
`.gitattributes`, no workflow, no migration, no script, no database contact.

**This is also the place follow-up work goes from now on.** Read
[§ Backlog discipline](#b4--backlog-discipline--never-create-background-task-chips-for-shared-db-work)
below before you create a task chip, spin up a parallel agent, or "just quickly" fix one of
these. Items are ordered by value. Each one is written for a developer who has never seen this
repository and has no memory of any prior chat session.

---

### B1 — Line endings: add `.gitattributes` and force LF (IMPACT DOWNGRADED 2026-07-31 — still worth doing, no longer "highest value")

> **Impact downgraded, corrected 2026-07-31.** **CRLF is a non-issue for automation.** Nothing
> in `tools/`, `scripts/`, or any workflow calls `pg_get_functiondef`, so the "byte comparison
> of function definitions" worry below is **manual-comparison nuisance only** — it is not a
> correctness risk to the ColdLion lane or to any shipped guard. The local Windows test-noise
> problem described below is real and worth fixing; the severity framing is not. Keep the item,
> do it when convenient, do not treat it as blocking anything.

**The problem.** This repository has **no `.gitattributes` file at all**, and the Windows
checkouts run with `core.autocrlf=true` (verify with `git config core.autocrlf` — it prints
`true`). Git therefore stores LF in history but **writes `.sql` files to disk with CRLF** on
Windows. `supabase db push` sends the file bytes verbatim, so a function pushed from a Windows
machine lands in preview with `\r` embedded in its `prosrc`; the same function pushed from
Linux does not. Postgres does not care — the SQL executes identically — but **anything that
reads the text does.**

**The concrete evidence that this is real, not theoretical.**
`tools/promote-coldlion-source-owned.test.mjs` reads the migration file and strips SQL comments
before asserting on it, so that a sentence of English prose in a comment cannot accidentally
satisfy an assertion about SQL. The stripper is:

```js
.split("\n")
.map((line) => line.replace(/--.*$/, ""))
```

In JavaScript regex, `.` does **not** match `\r`. With CRLF line endings, `split("\n")` leaves
every line ending in a trailing `"\r"`, so `.*` stops before that `\r`, the unanchored `$` never
matches, and **the comment is silently not stripped**. Commented-out prose then leaks into the
text the assertions scan. Measured on the live file: the quarantine predicate matched **3 times
with CRLF vs 2 with LF**, and `contains 'grant'` was **true with CRLF and false with LF**. That
is the exact and complete explanation for the two test failures that reproduce locally on
Windows but pass in CI on Linux. Nobody should burn another session rediscovering this.

**Also affected (same root cause):** byte comparison of `pg_get_functiondef` output between an
environment pushed from Windows and one pushed from Linux; any checksum or hash taken over a
function definition; and ordinary diff noise on `.sql` files.

**Exactly what to do.**

1. Add a `.gitattributes` at the repository root. Minimum viable content:
   ```
   * text=auto eol=lf
   ```
   If a narrower change is preferred, `*.sql text eol=lf` is the strict minimum, and `*.mjs`,
   `*.yml`, `*.sh` should be included too — the test tooling, the workflows and the shell
   scripts have the same exposure.
2. In the **same** PR, harden the comment stripper in
   `tools/promote-coldlion-source-owned.test.mjs` — either drop the `$` anchor (`/--.*/`) or
   normalize the file on read (`.replace(/\r\n/g, "\n")`). Sweep for the same
   `.split("\n")` + `$`-anchored-regex pattern in the other `tools/*.test.mjs` files and fix
   every occurrence.
3. Renormalize the working tree once: `git add --renormalize .` and commit whatever it changes.

**Two caveats that must be respected — this is why it is its own PR and not a drive-by.**

- **(a) It rewrites the working tree on the next checkout of every clone and every live git
  worktree.** Multiple agent worktrees are routinely open against this repo at once. Land this
  when **few or no other sessions are open**, announce it, and expect every other worktree to
  need a fresh checkout afterwards. Do not bundle it with unrelated changes — the diff must be
  reviewable as "line endings only".
- **(b) The `.gitattributes` alone is not the fix.** Without step 2 the regex stays fragile and
  breaks again the moment CRLF reappears on any machine (a new clone before the attributes file
  is fetched, an editor that rewrites endings, a zip download). Both halves ship together or
  neither does.

**How to verify it worked.**
- `git config core.autocrlf` may still say `true`; that is fine — `.gitattributes` overrides it.
- `node -e "const b=require('fs').readFileSync('supabase/migrations/<file>.sql');console.log(b.includes(13))"`
  prints `false` on a fresh checkout on Windows.
- The `tools/*.test.mjs` suite passes on Windows **and** on Linux, and still passes if you
  deliberately convert a migration to CRLF locally before running it (that is the real proof the
  stripper was hardened, not just the file).

**Priority: HIGH.** It is the only item here that is actively costing debugging time today.

---

### B2 — Repo-wide checkers are gated behind narrow `paths:` filters (a guard that cannot re-run)

**The problem.** The `DB Data Admin` GitHub Actions workflow has a `verify` job that runs
`scripts/check-domain-ownership.mjs`. That script scans **every tracked text file** in the repo
via `git ls-files`. But the workflow itself only triggers on a narrow `paths:` filter, and that
filter **does not include `HANDOFF.md`**. The result is a guard that can be tripped by a file it
does not watch, and — worse — **cannot be un-tripped**: fixing the offending line in an unwatched
file triggers no run, so `main` keeps displaying a stale red verdict indefinitely. This trap is
written up in `AGENTS.md` §5.2, added by **PR #336, which is still OPEN** at the time of writing.

**The concrete evidence.** PR #328 fixed the offending line (commit `53f849f`) and fired **no
workflow run at all**. What actually turned `main` green again was the unrelated PR #307
(commit `f1b9e8b`), which happened to touch `AGENTS.md` — a path that *is* in the filter.

**Exactly what to do (assessed and recommended, deliberately not implemented here).**
Add a **separate, tiny `domain-ownership` workflow** with **no `paths:` filter**, running only
the two `node` commands for the ownership check. It is cheap, it runs on every push and pull
request, and it is decoupled from anything heavy.

**Why the obvious fix is the WRONG fix — do not do this.** Widening the existing `paths:`
filter looks like a one-line change, but that same filter also gates a **Docker image build**,
the **Playwright browser tests**, and the Coolify **`deploy-development`** job. Widening it
would fire a full build-and-deploy on every unrelated documentation PR. The cost lands on every
future contributor. Keep the heavy workflow narrow; give the cheap repo-wide guard its own
trigger.

**How to verify it worked.** Open a pull request that changes **only** `HANDOFF.md` and confirm
the new `domain-ownership` check appears and runs on it, while the Docker build, the Playwright
job and `deploy-development` do **not**.

**Priority: MEDIUM.** No data is at risk; the cost is a misleading red/green signal on `main`.
Note the sequencing: `AGENTS.md` §5.2 describing this lives in the still-open PR #336, so land
or close that first to avoid conflicting edits.

---

### B3 — `SECURITY DEFINER` default-privilege exposure across the existing database

**The problem.** The production Supabase advisors report a large, long-standing backlog of
privilege findings — all of it **predating** the current workstreams:

| Advisor finding | Approximate count |
|---|---|
| `anon_security_definer_function_executable` | ~88 |
| `authenticated_security_definer_function_executable` | ~118 |
| `function_search_path_mutable` | ~38 |
| `security_definer_view` (ERROR level) | 15 |

**What has already been fixed, and what has not.** Migration `20260729120000` (PR #316) fixed
the **root cause going forward**: it stripped default `EXECUTE` privileges in the `public`
schema and installed a `ddl_command_end` event trigger,
`lock_down_new_public_function_execute_trg`, which auto-revokes `EXECUTE` on newly created
`public` functions. See `AGENTS.md` §10.2 — every new migration must now state its grants
explicitly. **The roughly 200 pre-existing functions were never swept.** That sweep is the
outstanding work.

**The nuance that makes this an audit and not a script — do not skip this paragraph.**
A grant to `authenticated` is **not automatically a defect.** This was established by a
three-way review (Claude + Grok 4.5 + GLM 5.2). Many of these functions gate their own body
with `app.has_role('administrator')`, which resolves the caller through the **request JWT**
(`auth.uid()`), not through `current_user`. Such a function is correctly secured even though
`authenticated` can execute it — revoking the grant would simply break a working admin screen.
A blanket `REVOKE` sweep is therefore **the wrong answer and will cause an outage.**

**Exactly what to do.** Enumerate the flagged functions; for each one classify it as
(a) genuinely exposed — no in-body role gate — or (b) correctly gated by `app.has_role(...)` or
equivalent. Only category (a) gets revoked. Handle `function_search_path_mutable` separately and
mechanically (`SET search_path` on the function). Treat the 15 ERROR-level `security_definer_view`
findings as their own sub-task; views do not have the same gating story as functions. Do this in
small batches with a preview apply and a functional check of the affected admin screens between
batches — never one giant migration.

**How to verify it worked.** The advisor counts fall batch by batch (Supabase advisors), and the
DB Data Admin screens plus each consuming app still work after every batch. The end state is
zero ERROR-level findings and every remaining `authenticated` grant individually justified in
writing.

**Priority: MEDIUM–HIGH by severity, LOW by urgency.** It is long-standing, the bleeding has
already been stopped for new code, and doing it carelessly is more dangerous than leaving it.

---

### B4 — Backlog discipline: never create background task chips for shared-db work

**The rule.** Follow-up work for `shared-db` is recorded **in this backlog section**, where it
sits inert until a orchestrator deliberately dispatches it to a sub-agent in its own git
worktree. Do **not** create background task chips. If a chip is ever genuinely unavoidable, its
title **must** begin `DO NOT START —` so that nobody launches it by accident. See the
`shared-db-orchestrator` skill for the full coordination model.

**Why — the incident this rule comes from.** After a review, five follow-up chips were created.
Each chip launches an **independent session outside any orchestrator's control**, and none of
them can see the others. **Four of the five** authored forward migrations doing
`CREATE OR REPLACE` on the **same** function, `plm.promote_coldlion_source_owned`, and **three
of them chose the identical migration version `20260731170000`.**

`CREATE OR REPLACE` is last-writer-wins. Merging any two of those branches would have **silently
erased** the other's work — no conflict, no error, no failing test. Each pull request passed CI
on its own, because the duplicate-version guard only ever sees a single branch at a time; the
collision is invisible until after the merge.

Untangling it required merging **one at a time** and **re-deriving** each change on top of the
previous merged function body. Merge commits: `691d5ea`, `01f0214`, `6a00e31`, `49d2ac1`,
`cc0d1dd`.

**How to verify the rule is being followed.** No open task chips referencing `shared-db`; every
follow-up appears as a written item in this section; and before any dispatch, the orchestrator
confirms that no two in-flight branches touch the same function or claim the same migration
version.

**Priority: HIGH — process, effective immediately.** It costs nothing to follow and the failure
mode is silent data-logic loss.

---

### B6 — Cross-PR object collision guard (HIGH — recorded 2026-07-31, NOT implemented)

**The problem.** `scripts/check-sql.sh` cannot see a sibling **open** PR, so two PRs that both
`create or replace` the same database object both pass CI, and whichever merges second silently
overwrites the first.

- **Guard A** only de-duplicates migration **filenames within the working tree** — it compares
  the files present in one checkout.
- **Guard B** only compares the **branch's new migration versions against the base branch's
  newest** version.

Neither guard queries GitHub for other open pull requests. The **four-way `CREATE OR REPLACE`
collision on `plm.promote_coldlion_source_owned` that actually happened on 2026-07-31 would
pass CI again today, unchanged.**

**Proposed fix (two parts, not yet built).**

1. A CI check that extracts the set of database objects a PR creates-or-replaces (parse
   `create or replace function|view|procedure` plus `create trigger` out of the PR's new
   migration files) and **fails if any other open PR touches the same object**. It needs
   `gh pr list` + per-PR changed-file inspection, so it must run with a token that can read
   the repo's PRs.
2. A rule, enforced by that same check: **a migration containing `create or replace function`
   must be rebased onto the current `origin/main` immediately before merge.** A stale base is a
   failure, not a warning — a stale base is exactly how a lost overwrite happens.

**Do not implement this opportunistically.** It changes CI for every workstream; it needs its
own coordinated PR.

### B7 — Mandatory negative-path assertions: prove the guard FIRES (MEDIUM — recorded 2026-07-31, NOT implemented)

**The problem.** Three separate defects during the 2026-07-31 session **installed cleanly,
compiled, passed review — and did absolutely nothing.** Each was "present" and inert:

1. A **`BEFORE` trigger reading a `GENERATED ... STORED` column.** The generated value does not
   exist yet at `BEFORE` time, so the column read as NULL, the trigger's condition never held,
   it never fired — and it never raised an error either.
2. A **function that failed on every single call.** Nothing tested a real call, so nothing
   noticed.
3. An **alert path that never recorded**, so the circuit breaker it fed could never trip.

Existence checks (`does the trigger exist?`, `does the function compile?`) passed for all three.
That class of check is worthless for this class of defect.

**The rule to adopt:** *every guard, trigger and alert ships with a test that **commits the
violation** and asserts the **observable consequence***. Not "the object exists" — insert the
row that should be rejected and assert it was rejected; force the condition that should raise
the alert and assert the alert row landed; call the function with real arguments and assert the
returned shape. Prove it **fires**, not that it exists.

**Also (LOW).** **Guard B in `scripts/check-sql.sh` uses a strict `<` comparison**, so a
migration whose version **exactly equals** the base branch's newest version passes the guard.
Action: confirm that branch protection on `main` requires branches to be **up to date** before
merge (which would close the practical hole), and if it does not, either enable it or change
the comparison to `<=`. **Verify before changing — do not edit `scripts/check-sql.sh` as a
drive-by.**

### B8 — `tools/emit-coldlion-rollback-sql.mjs` has NO unit test (HIGH — recorded 2026-07-31, NOT implemented)

**No `tools/emit-coldlion-rollback-sql.test.mjs` exists** (verified by listing `tools/`). Every
other Step 7A tool has one, and `.github/workflows/tools-offline-tests.yml` would pick a new test
up automatically via its `tools/*.test.mjs` glob — so this is a gap, not a design decision.

**Why HIGH:** this is the **emergency lever**. It is the thing somebody runs **under pressure,
during an incident, against production**, probably at night. It has been executed **exactly
once** — against preview, inside a rolled-back transaction — and never since. A tool whose only
proof of correctness is a single manual run a week earlier is not a rollback plan.

**What the test must cover** (all offline, no database): the exactly-542-mapping refusal, the
unsafe-composite-key rejection, that the emitted SQL deletes **only** those 542
`core.taxonomy_source_ref` rows, and that it clears the mirror link and `resolution_status`
together. Follow B7 — assert it **refuses**, do not merely assert it emits.

### B9 — The enable variable is over-coupled: there is no "armed but read-only" state (MEDIUM — recorded 2026-07-31, NOT implemented)

In `.github/workflows/coldlion-licensor-property-production.yml` the **`readiness` lane sits
inside the `production` job**, which is gated on `needs.gate.outputs.enabled == 'true'`
(verified: job `production` at line 204, `if:` at line 206, the readiness step at lines 323–327).
`readiness` is dispatch-only and read-only — it just runs
`tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` — **but it cannot run at all
until the variable is set.**

**Consequence:** there is **no intermediate state**. Setting
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` to run a read-only readiness check
**simultaneously arms the 06:00 snapshot, the 06:30 promotion (which writes to production), the
07:00 comparison and the hourly health lane.** The one thing you would want to run *before*
committing is only available *after* committing.

**Fix:** decompose the gate so `readiness` can run against production **read-only without arming
the crons** — e.g. a separate job not gated on the enable variable, or a distinct
`..._READINESS_ONLY` mode. This must be done in its own PR with its own review; it changes the
production workflow.

### B10 — Orchestrator intake lifecycle/retention — ⛔ CLOSED 2026-08-07, DO NOT IMPLEMENT

> ## ⛔ STOP. Implementing this item rebuilds the thing that was just removed.
>
> **B10 asked for CI that enforces the lifecycle and retention rules of
> `COORDINATOR_INTAKE.md`. That file has been retired.** Its 63 open work items became
> GitHub issues on 2026-08-07
> ([`plan_coordinator-queue-to-github-issues.md`](plan_coordinator-queue-to-github-issues.md)).
> Building CI to enforce the lifecycle of a retired file would recreate the file, which is
> exactly the failure this item is being closed to prevent: **a faithful future session
> reads B10, implements it in good faith, and the queue comes back.**
>
> **Work now lives here:** `gh issue list --repo u2giants/shared-db --label db-work`.
>
> **If you want the underlying good idea** — mechanical enforcement instead of written
> discipline — it already exists in a better form: the required
> [`Intake pointer guard`](.github/workflows/intake-pointer-guard.yml) check fails any PR in
> which the retired file starts growing a queue back. That is B10's intent, aimed at
> preventing the queue rather than maintaining it.
>
> **Why it was manual and never enforced, kept because it is the actual lesson:** the file's
> Part B2 defined a full lifecycle and retention discipline, and it **never once fired** —
> `docs/intake-archive/`, the directory the retention rule archived into, was never created.
> Two of its rules deadlocked: retention required archiving blocks that a CI check required
> stay present. The file grew from 0 to 89 blocks in eight days and never shrank. **Rules
> that depend on a human remembering them do not happen in this repo.** That is why the
> replacement is a detector, not a discipline.

<details>
<summary>The original B10 text, kept for the record. It describes a system that no longer exists.</summary>

#### B10 (original, 2026-07-31) — Orchestrator intake lifecycle/retention is MANUAL; CI could enforce it

`COORDINATOR_INTAKE.md` at the repo root is the mailbox for (a) **requests** for database work
from anyone who has not started it, and (b) **handovers** from sessions that had started and
were told to stop. Its Part B2 now defines a full lifecycle and retention discipline:

- `REQUEST QUEUE` → `IN PROGRESS` → `COMPLETED`, and `INTAKE QUEUE` → `TAKEN OVER`. **Only the
  orchestrator moves a block between sections.**
- Blocks in `COMPLETED` / `TAKEN OVER` are pruned once older than **30 days** or outside the
  **most recent 10** in their section, and are **archived verbatim** to
  `docs/intake-archive/YYYY-MM-DD-intake-archive.md` — never deleted. The "what did NOT work"
  section of each block is the most valuable content the process produces.
- When a block reaches `COMPLETED`, its branch must be **verified merged** to `origin/main`, its
  worktree retired via the **`cleanup-worktree`** skill, and its **local** label deleted with
  `git branch -d` only when merged and checked out nowhere. Remote branches are deleted by the
  merge, never by hand. A worktree is **never** removed while dirty, locked, or held by a live
  process.
- The orchestrator runs this sweep **at session start and again at handover**.

**Backlog item (not built, deliberately):** all of the above is manual discipline with no
enforcement — which is exactly how one day's work left 23 worktrees and ~30 stale local branch
labels behind. A CI job could enforce it mechanically: fail or warn when `COMPLETED` /
`TAKEN OVER` blocks exceed the 10-block / 30-day threshold, and warn when a local branch has
been merged to `origin/main` for more than 30 days and still exists. Nobody should build this
without reading `COORDINATOR_INTAKE.md` Part B2 first; the thresholds live there and must not
be duplicated into a workflow that then drifts.

### B11 — A paused agent looks exactly like a finished one to a worktree sweep (MEDIUM — recorded 2026-07-31, NOT implemented)

**Real incident, this session.** An agent had deliberately **stopped and was awaiting
re-dispatch** — it had correctly refused to race an unmerged PR — and a concurrent cleanup agent
deleted its worktree. The cleanup agent broke no rule: the worktree was clean, unlocked, and held
no unmerged work. The affected agent recovered by creating a fresh worktree, so nothing was lost
this time; it easily could have been.

**The gap:** the cleanup criteria in `COORDINATOR_INTAKE.md` Part B2 and the `cleanup-worktree`
procedure treat *clean + unlocked + work merged* as sufficient to retire a worktree. That is
**necessary but not sufficient** — it must also be established that **no orchestrator intends to
re-dispatch that agent**. A paused-awaiting-redispatch agent is indistinguishable from a finished
one.

**Proposed fix (not built):** the orchestrator maintains the authoritative list of agents it may
still resume and no sweep runs without checking it; or an agent awaiting re-dispatch marks its
worktree in a way a sweep can see. `COORDINATOR_INTAKE.md` Part B2 remains the authority for
retention numbers — do not restate thresholds here.

### B12 — The WSL `psql` wrapper leaks orphaned processes that hang forever (MEDIUM — diagnosed 2026-07-31, NOT implemented)

**The problem.** Something in the local tooling launches `psql` **through WSL** and, when that
invocation goes wrong, leaves the process alive **indefinitely**. It is a **recurring leak**, not
a one-off: **four** such orphans were found on one machine on 2026-07-31 — one from **14:32 that
day** (Windows PIDs **19072 / 61204**, Linux PID **17739**, launched from `C:\repos\shared-db` by
a sub-agent) and **two more from the evening of 2026-07-29, then 1 day 18 hours old and in exactly
the same state.**

**What the diagnosis established (all read-only).**

- **It was NOT a GitHub Actions job.** Actions was **completely clear**. The real
  `ColdLion Promotion Contract Tests` workflow completes in **~15–25 SECONDS** and last succeeded
  at **18:58 UTC** that day. A "long-running job" that is not visible in Actions is not CI.
- **It was holding nothing.** Preview `rjyboqwcdzcocqgmsyel` showed **zero active queries and zero
  advisory locks**, including `720260729`, the ColdLion promotion lock. Not mid-`db push`, not
  inside a transaction. **Nothing was at risk and nothing was blocked.**
- **It was genuinely STUCK, not working.** The SQL file it had been handed (`/tmp/t.sql`) and its
  password file had **already been deleted**, so it had nothing left to send and could never
  finish.
- A diagnostic command that tried to read the stuck process's **file handles also hung** — the
  same symptom. Do not investigate it that way.

**Why it matters.** A stuck process is **indistinguishable at a glance from a legitimate
long-running one** — and on the same day a real ClickUp importer run genuinely took **52 minutes**,
so the ambiguity is not hypothetical. It burns the orchestrator's and Albert's attention, it
**accumulates silently across sessions**, and the next occurrence may coincide with a real
migration, where the safe-versus-unsafe judgement is much harder and the cost of guessing wrong is
much higher.

**Proposed fix — DO NOT IMPLEMENT OPPORTUNISTICALLY.** Identify what invokes `psql` via WSL in the
tooling and give it **an explicit timeout plus guaranteed cleanup of its temporary SQL and
password files**, so a hung invocation **dies rather than lingering**. This touches shared local
tooling and needs its own coordinated change.

**Also worth doing in the same item:** document the **read-only diagnostic recipe** that resolved
this, so the next orchestrator can answer *"is it stuck or is it working?"* in minutes instead of
guessing:

1. **Check GitHub Actions first.** If Actions is clear, it is not CI.
2. **Then check local processes** on the machine.
3. **Then check `pg_stat_activity` and `pg_locks` on preview** — active queries and held advisory
   locks. If both are empty, nothing is being held and nothing is at risk.

**Status at the 2026-07-31 handover:** four orphaned processes existed on the machine and **Albert
was given the `Stop-Process` commands to clear them. Whether he ran them is UNVERIFIED.**

</details>

### B13 — CI check: every BACKLOG `B<n>` should have a `REQUEST QUEUE` entry — ⛔ RETIRED 2026-08-07

> **The check has been DELETED, and so has the `REQUEST QUEUE` it read.**
> `scripts/check-backlog-queue-sync.mjs`, its tests and
> `.github/workflows/backlog-queue-sync.yml` were removed on 2026-08-07, and the required
> status context `Backlog / queue sync` was removed from branch protection by owner
> instruction naming it (Albert Hazan, 2026-08-07).
>
> **It was retired rather than repaired, for two reasons.** It only ever verified that each
> of the 14 `B<n>` items had a mention in the queue — it never looked at the 60+ queue items
> that were the actual sprawl. And it **false-passed**: its `B(\d{1,3})` pattern matched
> a bare number anywhere in prose, so it printed "OK B8 — found in `## REQUEST QUEUE`" for
> B8, B13 and B14, none of which had an entry in that section at all. A small, broken check
> with a big name, carrying authority on every pull request that it had not earned.
>
> **Do not rebuild it.** Backlog items are tracked as GitHub issues now:
> `gh issue list --repo u2giants/shared-db --label db-work`.

<details>
<summary>The original B13 text, kept for the record. Every file it names has been deleted.</summary>

#### B13 (original, 2026-07-31) — CI check: every BACKLOG `B<n>` should have a `REQUEST QUEUE` entry

> **DONE — implemented 2026-07-31.** The check is
> [`scripts/check-backlog-queue-sync.mjs`](scripts/check-backlog-queue-sync.mjs), unit-tested by
> `scripts/check-backlog-queue-sync.test.mjs`, and wired into CI by
> [`.github/workflows/backlog-queue-sync.yml`](.github/workflows/backlog-queue-sync.yml) — its own
> small workflow with **no `paths:` filter**, per AGENTS.md §5.2, because the check reads both
> `HANDOFF.md` and `COORDINATOR_INTAKE.md` and widening the `DB Data Admin` filter would fire a
> Docker build, the Playwright tests and the Coolify deploy on every docs PR.
>
> **Two deliberate departures from the assessment below.** (a) It **fails** on a genuinely
> unqueued item rather than only warning — an empty queue is the exact defect, and a warning is
> just more prose to ignore. The false-positive risk the assessment worried about is handled
> instead by making the check *refuse to judge* whenever it cannot parse either document with
> confidence: missing file, renamed `## BACKLOG` or `## REQUEST QUEUE` heading, or no `### B<n>`
> items found all produce a loud warning and **exit 0**, mirroring Guard B in
> `scripts/check-sql.sh`. (b) The opt-out marker is `no-queue-entry-needed: <reason>` written
> inside the `### B<n>` item itself, and the check **reports** every exclusion, so a parked item
> stays visible instead of silently disappearing. An item the orchestrator has already moved to
> `## IN PROGRESS` / `## COMPLETED` / `## TAKEN OVER` counts as queued. The reverse direction — a
> queue entry naming a `B<n>` that no longer exists — is reported and never fails.

**The problem it would solve.** On 2026-07-31 a fresh orchestrator read the empty queues in
`COORDINATOR_INTAKE.md` and reported "there is no pending work" while ~20 jobs sat in this
BACKLOG. The fix shipped that night is documentation — this file's banner, the
`COORDINATOR_INTAKE.md` § B2.0 ownership statement, and a required completion criterion in the
`shared-db-handover` skill. **All three are prose, and prose rots.** The only fix that cannot
rot is mechanical.

**Feasibility: YES, narrowly, and only in warn-mode.** Both documents are prose, so any general
"is this item queued?" matching is hopeless. But there is one workable anchor: the queue already
uses the heading convention `### REQUEST — Backlog B<n> — …`. That makes the check a heading-to-
heading comparison, not prose matching:

1. From `HANDOFF.md`, collect every `^### B(\d+) —` under the `## BACKLOG` section.
2. From `COORDINATOR_INTAKE.md`, collect every `B(\d+)` appearing in a `^### REQUEST — Backlog
   B(\d+) —` heading, in **any** section (`REQUEST QUEUE`, `IN PROGRESS`, `COMPLETED`) — an item
   that has been dispatched or finished must NOT be flagged as missing.
3. Report the set difference as a **warning**, and post it as a PR comment / job summary.

**Recommendation: implement it as a WARN-ONLY job that never fails a PR** — the same deliberate
posture as Guard B in `scripts/check-sql.sh`, which skips with a warning rather than blocking.
A blocking check here would gate unrelated database work on documentation bookkeeping, and the
first time it fired spuriously somebody would add `--no-verify` or delete the job, leaving us
worse off than with no check at all. Warn-only still solves the actual failure: it makes the
drift **visible at review time**, which is the one thing prose could not do.

**Failure modes to accept going in:**

- **Heading-convention drift.** A future orchestrator titles an entry `### REQUEST — B7 …` or
  `### REQUEST — line endings …` and the check reports a false "missing" even though the work is
  queued. Mitigation: the convention is now written down in § B2.0 and in the skill; and warn-only
  means a false positive costs a glance, not a blocked PR.
- **Deliberately unqueued items.** Some `B<n>` may be intentionally parked (obsolete,
  superseded, or an owner decision). The check cannot know. Needs an opt-out marker — e.g. the
  literal text `NOT QUEUED (deliberate)` in the item's heading line — or it will nag forever.
- **Renumbering / retired items.** If a `B<n>` is deleted from this file, a stale queue entry
  for it is invisible to a one-directional check. The reverse direction (queue entry with no
  backlog item) is a separate check and is **not** worth adding — those are legitimate: most
  queue entries are ordinary requests that were never backlog items.
- **`paths:` filter trap (see B2).** If the workflow is gated on
  `paths: [HANDOFF.md, COORDINATOR_INTAKE.md]`, editing only one of the two files still triggers
  it (either path matches), so that is fine — but a PR that touches **neither** file cannot
  surface pre-existing drift. That is acceptable: the check exists to catch drift **as it is
  created**, at handover time, which is exactly when one of these two files changes.
- **Section-boundary parsing.** `## BACKLOG` is followed by ~400 lines and then unrelated `##`
  sections; the extractor must stop at the next `^## ` heading, and must not be confused by the
  `### B2.x` sub-headings that exist inside `COORDINATOR_INTAKE.md`'s Part B2 (they are `B2.0`,
  `B2.1` — not `### REQUEST — Backlog B2 —`, so the anchored regex above already excludes them,
  but a looser `grep -o 'B[0-9]'` would produce a flood of false matches; do not write it that
  way).

**Effort:** roughly 40 lines of shell or Node plus a small workflow, no database contact, fully
testable offline against the two committed files. **Explicitly not implemented in the session
that assessed it** — that session's scope was limited to `HANDOFF.md` and `COORDINATOR_INTAKE.md`
and was forbidden from adding scripts or workflows.

</details>

### B14 — The ENOBUFS fix MOVES the cliff, it does not remove it — and it still auto-trips the breaker (**RESOLVED 2026-07-31** — no longer a Step 8 blocker)

> **RESOLVED 2026-07-31 in PR `fix/b14-coldlion-probe-bounded`.** Both halves were implemented;
> the item below is kept in full because it is the reasoning that produced the design, and
> because a future reader must be able to see WHY the cheap fix was not enough.
>
> **Half 1 — the probe no longer returns the whole mirror.** `buildCycleStateSql` in
> `tools/promote-coldlion-source-owned.mjs` now takes `{ offset, limit }` and applies an
> explicit `order by … offset … limit …` window **inside the `mirror` CTE**, before the lateral
> and provenance joins. That placement is the whole reason the change is small: the selection
> predicate uses only `mirror` columns, so the window can sit there without touching a single
> pinned expression in the outer `jsonb_build_object`. The new `readCycleState()` reads
> successive pages of `CYCLE_STATE_PAGE_SIZE` (1000) rows and stops on the first short page,
> so the payload is bounded by a constant instead of by the row count. At roughly 700 bytes of
> JSON per row a full page is ~0.7 MB — it would fit **even under Node's 1 MiB default**, which
> makes the 256 MiB `maxBuffer` a second line of defence rather than the only one. It is kept
> for that reason, and because `runSql` is generic.
>
> **Server-side aggregation was considered and REJECTED, with evidence.** The "aggregates and a
> hash" option in the list below cannot work here: `planRecurringPromotion` in
> `tools/coldlion-recurring-promotion.mjs` decides **row by row** (curated-name equivalence,
> quarantine reasons, per-row provenance fields), and `splitCycleState` consumes **every key**
> the probe emits. There is no aggregate that preserves what the planner needs. Paging is the
> smallest change that actually removes the cliff.
>
> **Offset paging is only safe if you check the window did not move**, so `readCycleState` fails
> CLOSED on two conditions: every page must report the **same `snapshot_run_id`** (a change means
> a new mirror snapshot landed mid-read and the pages describe different cycles), and **no typed
> key may appear twice** (a duplicate is the observable symptom of a shifted window, which means
> some other row was skipped entirely — and a skipped row looks to the planner exactly like a
> record ColdLion stopped sending). There is also a max-page guard so a database handing back
> endlessly full pages cannot spin forever.
>
> **Half 2 — a client-side fault can no longer trip the breaker.** `runSql` now tags every
> spawn-boundary fault (ENOBUFS, ENOENT, EACCES, a kill) with `code = "CLIENT_SPAWN_FAULT"` via
> `clientSpawnFaultError()`, and the runner's catch block checks `isClientSpawnFault(error)`
> **first**, printing a loud `CLIENT TOOLING FAULT` and returning the new
> `EXIT_CLIENT_TOOLING_FAULT` = **4** — distinct from success (0), failure (1), unparseable (2)
> and lane skip (3). It records **no** durable failed `ingest.sync_run` row and **no** critical
> alert, so it cannot contribute to the two-consecutive-failure autotrip. If the CLI could not
> be executed, the database was never asked anything and cannot have failed. The same tagging
> was applied to the `psql` branch, where a non-ENOENT spawn error previously surfaced as the
> undiagnosable `"psql failed"`.
>
> **Proof, all offline.** `tools/coldlion-cycle-state-paging.test.mjs` (14 tests) pins both
> halves. The breaker half is proved against the **real** `main()` across the **real** spawn
> boundary: with `PATH` pointing at an empty directory the CLI genuinely ENOENTs, and the test
> asserts exit 4, the absence of the two `could not record …` warnings, and that **zero** SQL
> statements of any kind were sent — with a contrast test that a genuine non-zero CLI exit
> still attempts both `record_taxonomy_sync_alert` and the failed `ingest.sync_run` insert, so
> the new guard is not too wide. Every assertion was mutation-tested: 12 separate mutations of
> the code under test each made a test fail, and both source files were restored byte-identical
> (verified by SHA-256).
>
> **REVIEW ROUND 2 (Kimi K3, MERGE WITH CHANGES) — three further corrections, all real.**
>
> An independent review confirmed the primary safety property (no path to a wrong canonical
> write; the total ordering holds, the joins cannot drop a page row, a short page is a sound
> termination signal, and the NUL separator in the duplicate-key guard is injective at byte
> level). It also found three defects in the first version of the fix:
>
> 1. **The fix had installed a NEW healthy-race breaker trip.** A snapshot change or a duplicate
>    key threw a plain `Error`, which the catch recorded as a durable failed row plus a critical
>    alert — so two unlucky overlaps with the mirror lane in consecutive cycles would auto-trip
>    the breaker on a healthy feed. That is the same defect class B14 exists to fix, arriving
>    through another door. Now: the read **restarts from page 0 once**
>    (`CYCLE_STATE_MAX_ATTEMPTS` = 2; the collected pages are discarded whole, never stitched,
>    never partial). A snapshot race that survives the retry is tagged `CYCLE_STATE_RACE` and
>    exits **5**, recording nothing. A DUPLICATE that survives a clean restart is deliberately
>    treated differently — it stays a real, recorded fault, because the snapshot held still and
>    the window shifted anyway, which means the read itself is broken and a row was silently
>    skipped.
> 2. **The psql path still had the original 1 MiB cliff.** `maxBuffer` had been applied only to
>    the Supabase-CLI spawn, so wherever `DATABASE_URL` is set the ENOBUFS cliff was completely
>    untouched. Both spawns now take the same `SPAWN_MAX_BUFFER_BYTES` constant, and a test
>    asserts it appears on both and that no hand-written literal returns. An asymmetry between
>    two branches doing the same job is how this defect survived in the first place.
> 3. **The page size rested on a GUESS.** It was derived from an estimated "~700 bytes/row".
>    It is now **measured**: the test rebuilds the exact probe row shape from the 570 REAL
>    ColdLion rows committed under
>    `docs/verification/coldlion-licensor-property-phase2b-20260724/` — mean **496 B**, p95 536,
>    **max 581**. That mean independently reproduces the incident figure (1,305,075 / 496 =
>    ~2,630 mirror rows), which is what makes it evidence rather than another guess. The budget
>    is `CYCLE_STATE_MAX_ROW_BYTES` = 2048 (~3.5x the largest real row) and
>    `CYCLE_STATE_PAGE_SIZE` = 256 is **derived** from it, never hand-tuned. CI re-measures on
>    every run, so growth in the real data fails the test before it can be wrong in production.
>
> A Low finding was also corrected: the comments claimed a killed process is tagged a client
> fault. On Linux — which CI and the production lane both run on — an external SIGKILL leaves
> `error` undefined and takes the ordinary recorded-failure path. The comments now say so
> rather than manufacturing false confidence.
>
> **22 mutations** were watched to fail across the two rounds (12 for the round-2 behaviour, 10
> re-verifying the round-1 guards after the restructure), with both sources restored
> byte-identical each time.
>
> **No existing test was weakened or deleted.** `tools/coldlion-sync-common-runsql.test.mjs`
> still passes unchanged: the argv, `--output json`, the raised `maxBuffer` and the diagnosable
> spawn-fault message are all preserved.

**Read this as a correction to the defect-1 fix in PR #362, not as a complaint about it.** The
fix is right and should stay. What it is NOT is a resolution of the underlying problem, and the
PR's own wording ("sized well above any plausible payload") reads more final than the facts
support.

**What the fix actually did.** `runSql` in `tools/coldlion-sync-common.mjs` now passes
`maxBuffer: 256 * 1024 * 1024` to `spawnSync`. Node's default is exactly **1 MiB**. The real
cycle-state probe returned **1,305,075 bytes** on the **preview** clone, which overflowed the
default: `error` came back **ENOBUFS**, `status` came back **null** and `stderr` came back
**EMPTY**, so a client-side buffer overflow was reported as the generic
`supabase db query failed` — a database failure that had not happened.

**Why that is a raised limit, not a removed one.**

- 1,305,075 bytes is **today's** size, on **preview**, which is already production-scale data.
  256 MiB is roughly **200× headroom** — comfortable, but finite and undated. Nothing measures
  it, nothing alerts as it approaches, and nothing fails a build when it grows. The number of
  ColdLion licensors, properties and source refs only goes up.
- **Crucially, the fix does NOT stop an ENOBUFS from auto-tripping the circuit breaker.** Trace
  it: an overflow still sets `result.error`, `runSql` still **throws**, the throw still lands in
  the **same catch**, that catch still records a **durable failed `ingest.sync_run` row**, and
  **two consecutive failures still auto-trip** the `coldlion_licensor_property` breaker. All the
  fix changed is that the operator now gets a message naming ENOBUFS instead of a misleading one.
  **The blast radius is identical.** A better diagnostic on an outage is not the absence of an
  outage.

**The real root cause.** The cycle-state probe returns **the entire ColdLion mirror as ONE JSON
document**, fully buffered in memory, marshalled through a child process's stdout pipe and then
`JSON.parse`d whole. Every layer of that — the CLI's buffer, Node's `maxBuffer`, the string, the
parsed object — scales linearly with the mirror. `maxBuffer` is the only one of those with a knob
on it, so it is the only one that got turned. The others are still there.

**What "resolved" would look like** (design not yet chosen — do not treat any of these as the
decision):

- Have the probe return **aggregates and a hash** rather than the whole mirror, so the payload
  size is bounded by the schema instead of by the row count. This is the direction that actually
  removes the cliff.
- Or **page/stream** the probe, so no single response has to fit in any one buffer.
- Or, at minimum, **classify a spawn-level fault as NOT a sync failure**: an ENOBUFS/ENOENT/timeout
  is a client-side fault and must not write a durable `failed` row or count toward the two
  consecutive failures that trip the breaker. That alone would decouple a tooling defect from a
  production outage, and is the cheapest of the three.

**Why this must be settled before Step 8.** Once the production lane is enabled, this path runs
against the **production** mirror on a schedule, unattended. A payload that outgrows the ceiling
there trips the breaker on a **real** feed, out of hours, for a reason that has nothing to do with
the data being wrong. Enabling the lane while the failure mode is merely better-labelled is
accepting a known, dated outage.

**What IS now pinned** (so nobody re-derives this): `tools/coldlion-sync-common-runsql.test.mjs`
(added in PR #362) proves offline that `runSql` still passes `--output json`, that `maxBuffer` is
above the 1 MiB default, and that a spawn fault produces a diagnosable error. Those tests pin the
**current** behaviour deliberately. They will keep passing after this item is fixed properly, and
they are not evidence that it has been.

### B5 — Other items carried forward from elsewhere in this file

These are already documented in detail in their own sections above; they are listed here only so
that one place answers "what is outstanding?".

- **ColdLion promotion serialization lock — DONE, no longer outstanding** (corrected
  2026-07-31). `20260731180000` merged to `main` as `6a00e31` (PR #343) and, with
  `20260731163000`, `20260731190000` and `20260731200000`, applied to preview. Both former
  gates are satisfied. What IS outstanding is the **production** promotion of those four, which
  must follow the mandatory order in the 🛑 CRITICAL section at the top of this file.
- ~~**`origin/fix/wire-coldlion-step7a-tests-ci` has no PR open** and the `tools/*.test.mjs`
  suite is not enforced by CI.~~ **RESOLVED — corrected 2026-07-31.**
  `.github/workflows/tools-offline-tests.yml` is on `main` and globs `tools/*.test.mjs` on
  **every pull request and every push to `main`**, with an explicit guard that fails if any of
  the four Step 7A test files goes missing. All green. Do not carry this forward.
- **`20260729120000` is still pending on production** and must be promoted **with or after** the
  ClickUp migrations (`20260728174500`), never before, or the apply aborts with
  `undefined_function`. See `fix_public_schema_anon_lockdown.md`.
- **Characters and style guides, Phase 0** — blocked on an **owner decision** (promote DAM's
  existing character→property mapping vs the ~~174-row~~ licensing-team review). Phase 1 is
  read-only and can start now regardless.
  > **CORRECTED 2026-08-06 — there is no live "174-row licensing review".** That sheet was
  > **replaced on 2026-07-26** with a single 335-row list, because the 367-agreement track and the
  > 174-row track did not cover the same population
  > (`fix_characters_style_guides.md:640`, and the "what did not work" entry at `:615`). The track
  > it belonged to **closed on 2026-07-27** when licensing returned all 153 uncertainty rows
  > (`:641`). The real lineage is **round 1 (195 questions, 2026-07-29) → round 2 (166 rows,
  > 2026-07-31, returned 2026-08-04) → round 3 (8 rows, returned 2026-08-06 — CLOSED)**. Do not
  > carry the 174-row framing forward; it has already produced a wrong premise once.
- **PopSG PSG-5 — the eight Licensor aliases** remain a blocking owner gate; that is Albert's
  call, not an AI's.

</details>

---

## FRESH-SESSION BOUNDARY — ClickUp importer + duplicate-timestamp remediation (2026-07-29)

**Written:** 2026-07-29. **Author:** AI session working from `/worksp/poppim-web`.
**Read this whole file before touching anything.** Two of the items below are blocking, and one of them is a data-loss risk on a database three live apps depend on.

---

### 1. What this application is

`u2giants/shared-db` is the **canonical repository for a single Supabase Postgres database that four applications share**:

| App | What it is | Status |
|---|---|---|
| **Poppim** (`poppim-web`) | Product information manager, `pm.designflow.app` | in development, not launched |
| **PopCRM** (`popcrm-web`) | CRM | live |
| **PopDAM** (`popdam3`) | Digital asset manager, `dam.designflow.app` | live |
| **DesignFlow PLM** (`designflow-*`) | Product lifecycle management | live |

Supabase project refs:
- **production** `qsllyeztdwjgirsysgai`
- **preview** `rjyboqwcdzcocqgmsyel` (branch `shared-db-schema-rehearsal`, a **persistent clone of production including data** — treat its data and credentials as production-sensitive)

Because the database is shared, a bad migration breaks all four apps at once. That is why `AGENTS.md` in this repo mandates: branch + PR + timestamped migration + preview-first, never edit a landed migration, one schema change in flight.

Consumer repos (e.g. `poppim-web`) carry a **read-only mirror** at `<repo>/shared-db/`. Never author schema changes there; CI (`.github/workflows/shared-db-guard.yml` in the consumer repo) enforces it. All schema work happens in the canonical repo, then flows back to consumers via `chore: sync shared-db @ <sha>` commits.

**Key table for this work:** `pim.product`. Its identity/dedupe key is `unique nulls not distinct (external_source, external_id)`. It also carries legacy `clickup_task_id`, `clickup_parent_id`, `clickup_status` columns and a `metadata jsonb` blob from a one-time historical import.

---

### 2. What we set out to do, and why

**Business goal:** Poppim's product data came from a one-time historical ClickUp import. There was no ongoing sync, so anything changed in ClickUp since then never reached Poppim. The owner asked to "pull in everything from the ClickUp API since the last time we imported."

**Technical objective:** a repeatable, incremental importer — pull only ClickUp tasks changed since the last successful run, upsert into `pim.product`, track the watermark durably, never clobber curated Poppim data.

**Scope deliberately excluded:** mapping ClickUp custom fields (buyer / licensor / customer / factory) into first-class product relationships. Raw task payloads are stored in `ingest.raw_record`, so a later pass can map them **without re-pulling from ClickUp**.

---

### 3. Current state — what is true right now

#### Open PRs — REPOSITORY-WIDE, not just this session

> ### ⚠️ DO NOT TRUST THIS TABLE. RE-RUN `gh pr list` INSTEAD.
>
> **Accurate as of 2026-07-31, 18:0x UTC — and only as of that instant.** This repository runs
> several concurrent sessions, so this table goes stale **within hours**, sometimes within
> minutes. It has already caused real damage once: it listed **#311 and #307 as open long after
> both were merged**, and listed none of the PRs that were actually open. **Before you act on
> any row, re-verify with `gh pr list --state open`. Never plan work from this table alone.**

| PR | Branch | State | Notes |
|---|---|---|---|
| [#348](https://github.com/u2giants/shared-db/pull/348) | `docs/orchestrator-intake-20260731` | open, mergeable | docs only — `COORDINATOR_INTAKE.md` |
| [#345](https://github.com/u2giants/shared-db/pull/345) | `feat/core-licensor-alias-20260731` | open, mergeable | PSG-5 — moves the eight hard-coded Licensor aliases into `core.licensor_alias`; still being extended |

**Merged earlier the same day (do not re-open or re-plan these):** #311 and #307 (both merged —
the previous version of this table wrongly showed them open), #331, #334, #335, #336, #337,
#338 (`691d5ea`), #339, #340, #341, #342, #343 (`6a00e31`), #344, #346, #347.

`fix/clickup-importer-correctness` is pushed, 2 commits ahead of `main`:
- `cab6813` forward migration fixing 5 correctness defects
- `0783254` fix the legacy-row matching (the duplicate-products bug)

Nothing from this session has been applied to preview or production. **Zero database writes were made.** Every database interaction was read-only.

#### What is on `main` right now, and it is wrong

`supabase/migrations/20260728160000_clickup_incremental_task_import.sql` — the **original, defective** ClickUp importer — is merged to `main`. It got there via **unrelated PR #305** ("feat(db-data-admin): name the PLM divisions instead of printing raw ids"), which swept in all three ClickUp files without them being reviewed as ClickUp changes. It carries all 5 correctness defects listed in §5.

#### The migration on `main` never actually executed

`20260728160000` is a **duplicate timestamp**. Two files share it:

- `20260728160000_clickup_incremental_task_import.sql` (added by `8a7197f`, via PR #305)
- `20260728160000_popdam_user_tables_foreign_keys.sql` (added by `0b8425b`)

Supabase's ledger (`supabase_migrations.schema_migrations`) keys on the **version** (the leading 14-digit timestamp), not the filename. It recorded the version once and executed **one** file. Verified read-only against preview on 2026-07-29:

- PopDAM side **ran**: `profiles_user_id_fkey`, `user_roles_user_id_fkey`, `app_access_user_id_fkey` all present (3/3); `user_roles_user_id_idx`, `app_access_user_id_idx` present (2/2).
- ClickUp side **did not run**: `pim.sync_clickup_tasks` does not exist (0 rows in `pg_proc`); 0 of the 7 new `clickup_*` columns exist on `pim.product`.
- The ledger nonetheless reports `20260728160000` as applied, so it will **never be retried**.

This is currently the **only** duplicate in the repo — verified with
`ls supabase/migrations/ | awk -F_ '{print $1}' | sort | uniq -d` (returns exactly one value).

#### Verified working (local only)

On the `fix/clickup-importer-correctness` branch:
- `node --test tools/sync-clickup-tasks.test.mjs` → **40 pass, 0 fail**
- `scripts/check-sql.sh` → clean, exit 0
- `supabase/tests/clickup_task_import_contracts.sql` → **7/7 PASS** against a throwaway Postgres with the fix applied

Critically, the same contract suite was run against the **pre-fix** state to prove the tests actually catch the bugs:
```
C1 PASS  C2 PASS
ERROR:  C3: watermark advanced on partial failure
ERROR:  C4: unchanged row bumped updated_at
C5 PASS
ERROR:  C6: DUPLICATE PRODUCT — expected exactly 1 row for clickup_task_id dir9001, got 2
ERROR:  C7: unique index on btrim(clickup_task_id) is missing
```
A test suite that passes both before and after a fix proves nothing. These fail before, pass after.

**Never rehearsed against hosted Supabase.** All runs were stock Postgres 15/16 with an `auth`/roles shim. The preview apply is still the real gate and has not happened.

---

### 4. Everything we tried that did NOT work

Read this section. It is the difference between a two-hour session and a two-day one.

#### 4.1 A code review that returned zero findings, and was wrong

The first adversarial review of the importer (Grok, default non-reasoning model) read all 1,354 lines and returned **zero findings**, declaring every area correct — backfill, watermark, locking, tests, conventions.

A second pass at the same task (`grok-4.5`, `--reasoning-effort medium`), explicitly told not to anchor on the first result and to assume at least one defect existed, found **five real defects**, two of which were then confirmed by reading the code directly.

**Lesson:** a zero-finding review on a large diff touching a shared production database is evidence of a weak reviewer, not of good code. Do not accept "all clear" without spot-checking the claims yourself.

#### 4.2 Three reviews missed the biggest bug entirely

The duplicate-products bug (§5.1) — the one that would have inserted 17,859 junk rows — was missed by:
1. the implementing agent,
2. the zero-finding review,
3. the thorough adversarial review that found five other defects,
4. and this session's own verification of all of the above.

Every one of them reasoned about the logic against the **assumed** data shape. The bug only surfaced when the actual preview database was queried. **Reason about schemas from the data, not from the DDL.**

#### 4.3 Trying to replay all migrations locally

Applying every migration in filename order against an empty Postgres fails. Two separate sessions independently diagnosed this as "an ordering bug in the `assets` migrations" and reported it as a defect. **That diagnosis is wrong and was retracted.**

Roughly **170 of the 366 migration files are intentionally empty markers** for objects created before `shared-db` became canonical. Nothing in the repo ever creates those objects, so on a from-scratch database every later migration referencing one fails — ~63 failures, all of that class. The two `assets` files that look misordered are both empty and cannot fail.

Deploys are unaffected: CI links to a live project and `supabase db push` applies only migrations missing from that project's ledger. The markers are already recorded there.

**This is documented in PR #307.** Merge it so nobody rediscovers this a third time.

**To test a migration locally**, apply only the dependency closure:
```
supabase/migrations/20260621150714_foundation.sql
supabase/migrations/20260621150815_app_core.sql
supabase/migrations/20260621151024_domain_tables.sql
supabase/migrations/20260621151155_api_rls_realtime.sql
<your migration>
```
plus this shim (stock Postgres lacks what hosted Supabase provides):
```sql
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'authenticated') $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin; end if;
end $$;
create extension if not exists dblink;  -- needed for contract test C5
```
Without `dblink`, contract case C5 (advisory lock) SKIPs rather than fails. Install it, or verify the lock by hand with two connections.

#### 4.4 `op read` secret references that silently fail to parse

`op://vibe_coding/<item title>/<field>` **fails to resolve** when the item title contains parentheses — e.g. `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`. The error is a generic parsing failure that looks like a permissions problem.

**Use the item ID instead:** `op://vibe_coding/qbvfk7umc3n75ejekd65zwd4ty/DB_PASSWORD`. Also note the field is `DB_PASSWORD`, not `password`.

#### 4.5 Merging `main` into the original ClickUp branch

Produced add/add conflicts on our own files, which looked like corruption. Cause: PR #305 had already put identical copies of those files on `main`. Aborted the merge and branched fresh from `main` instead. Do not try to reconcile `claude/clickup-incremental-import-20260728` — it is abandoned and its PR is closed.

---

### 5. Root causes and key findings

#### 5.1 The importer would have created 17,859 duplicate products (fixed in #311)

**This is the most important finding of the session.**

The original design upserts on `(external_source, external_id)` and relied on a backfill to first claim legacy rows by setting `external_source='clickup', external_id=clickup_task_id` **where `external_source IS NULL`**.

Actual preview data (read-only query, 2026-07-29):

| `external_source` | rows | have `clickup_task_id` | `external_id = clickup_task_id` |
|---|---|---|---|
| `directus_product` | 17,859 | 17,859 | **0** |
| `clickup` | 50 | 50 | 50 |
| `NULL` | **0** | — | — |

There are **no** rows with a null `external_source`. The backfill claimed nothing. The 17,859 legacy products are keyed to Directus and were unreachable by the ClickUp key — so the importer would have **inserted a duplicate row for every one of them**.

Data quality made the fix safe: **17,909 distinct `clickup_task_id` values over 17,909 rows, zero duplicates, and no id appearing under more than one `external_source`.**

**Fix (commit `0783254`):** resolve each incoming task by trimmed `clickup_task_id` **first** and update that row in place, leaving `external_source`/`external_id` untouched (the legacy identifier written by the one-time, long-since-decommissioned Directus import is left in place on the row as historical data). The ClickUp-key upsert remains but only as the new-task path. The dead backfill is removed. New counters `rows_matched_by_clickup_task_id`, `rows_matched_by_clickup_key`, `rows_matched_foreign_source` plus a per-source breakdown make legacy matching **visible** rather than inferred.

Also adds a **unique index on `btrim(clickup_task_id)`** (non-null, non-blank) so this cannot silently recur. **This is a shared-schema change affecting all four apps** — see §7.

#### 5.2 Five correctness defects in the original importer (fixed in #311)

1. **Watermark stamped after the fetch.** `v_started_at := now()` was evaluated *inside* the SQL function, which runs only after the Node script finishes pulling every list (minutes). Anything edited mid-run was stamped as already-synced and **never re-fetched**. Fix: script passes a pre-fetch `fetch_started_at`, used minus a 60s overlap (`date_updated_gt` is strict; the upsert is idempotent so re-reading a boundary task is harmless).
2. **Partial failure advanced the watermark.** A task that failed once fell behind the cutoff forever; a total-failure batch still reported `succeeded`. Fix: watermark does not advance when `rows_failed > 0`; run marked `outcome='succeeded_with_failures'` / `partial_failure=true` (the `ingest.sync_status` enum has no `partial` value). `snapshot.skip_task_ids` is the explicit escape hatch so a permanently-malformed id cannot wedge the sync — that was the original author's legitimate concern, now handled without silent data loss.
3. **Backfill wrote untrimmed ids.** Guard used `btrim(...)` but the assignment wrote the raw value, so `'123 '` and `'123'` could coexist and fork a product.
4. **No-op upserts bumped `updated_at`**, making every task look freshly edited and poisoning the `(clickup_list_id, updated_at)` index.
5. **Runner exited 0 when nothing happened** — on `locked = true` and on `rows_failed > 0`. A cron job would report green while data did not move.

**Follow-up to defect 5 (2026-07-29, after #311 merged).** A GLM-5.2 review of #311 found one remaining hole: when `parseImportResult` returned `null` (an unparseable but non-exceptional importer result) the runner only printed a warning and still exited **0** — the exact "green when unconfirmed" failure defect 5 was meant to close. The `--apply` exit decision now lives in one pure exported function, `classifyApplyOutcome(result)`, which returns `null` **only** for a confirmed-clean run (`locked === false && rows_failed === 0`) and otherwise a `{exitCode, message}`. Exit codes on the `--apply` path:

| code | constant | meaning |
| --- | --- | --- |
| 0 | — | confirmed clean: `locked=false` and `rows_failed=0` were both parsed from the result row |
| 1 | `EXIT_PARTIAL_FAILURE` | `rows_failed > 0`; watermark NOT advanced, those rows retry next run |
| 2 | `EXIT_LOCKED` | another importer held the advisory lock; no data moved, re-run later |
| 3 | `EXIT_UNVERIFIED` | result row unparseable, **or** parsed but not positively confirming `locked === false` and a numeric `rows_failed === 0` — the write may or may not have happened; inspect the raw output and the latest `ingest.sync_run` row for `source_name='clickup_tasks_api'` before re-running |

Note that exit **1** is shared with the top-level `catch` (any thrown fetch/SQL/validation error). That predates this work; codes 2 and 3 are unambiguous.

**Grok-4.5 review of #324 (read-only)** returned PASS WITH CONCERN — no correctness hole on the real `--apply` path, locked-vs-partial precedence preserved from #311, and no in-repo consumer of these exit codes to break. Its three low-severity items were all fixed in the follow-up [#330](https://github.com/u2giants/shared-db/pull/330): the file-header and "two outcomes" comments now list all three non-zero codes; `classifyApplyOutcome` now *positively confirms* clean instead of treating "nothing matched above" as success (so a half-shaped row like `{}` or `rows_failed: null` exits 3, not 0), with both `locked === true` and `locked === false` compared strictly; and tests now cover locked-over-`rows_failed` precedence plus nine half-shaped inputs. 44 tests pass.

#### 5.3 Duplicate migration timestamps silently skip a migration

Root cause of §3. `20260728160000_popdam_user_tables_foreign_keys.sql` landed first (`0b8425b`); the ClickUp migration was authored on a branch cut **before** that commit and merged later via PR #305. Nothing caught the collision: `scripts/check-sql.sh` has no duplicate-version check, and no workflow in `.github/workflows/` does either.

**Symptom to recognise:** objects missing from the database while the ledger reports the version as applied.

#### 5.4 PR #305 swallowed files from an unrelated branch

PR #305 was titled "name the PLM divisions instead of printing raw ids" and its commit `8a7197f` added `tools/sync-clickup-tasks.mjs`, `tools/sync-clickup-tasks.test.mjs`, and the ClickUp migration. **Not investigated.** This is a process defect that will recur — see §6 step 6.

---

### 6. Exact next steps

Execute in this order. Steps 1–3 are sequential and blocking.

#### Step 1 — Confirm production's actual state (READ-ONLY)

Everything in §3 was measured on **preview**. Production has not been checked. Determine whether it shows the same split.

```sql
-- does the PopDAM half exist?
select count(*) from pg_constraint
 where conname in ('profiles_user_id_fkey','user_roles_user_id_fkey','app_access_user_id_fkey');
-- does the ClickUp half exist?
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'pim' and p.proname = 'sync_clickup_tasks';
select count(*) from information_schema.columns
 where table_schema='pim' and table_name='product'
   and column_name in ('clickup_creator_id','clickup_folder_id','clickup_list_id',
                       'clickup_space_id','clickup_status_type','clickup_time_estimate_ms',
                       'clickup_orderindex');
-- and the real data shape, which drives everything in 5.1
select external_source, count(*),
       count(*) filter (where clickup_task_id is not null) as with_task_id,
       count(*) filter (where external_id = clickup_task_id) as id_matches_taskid
  from pim.product group by 1 order by 2 desc;
select count(*) from (select btrim(clickup_task_id) t from pim.product
  where clickup_task_id is not null group by 1 having count(*) > 1) x;  -- must be 0
```

**Reads only. No writes, no apply, no `migration repair`.** Use the read-only AI identity per the standing infrastructure rule; never Owner/Editor or Terraform-admin credentials.

**You'll know it worked when:** you can state, with numbers, whether production matches preview (PopDAM applied / ClickUp skipped) and whether the zero-duplicate-`clickup_task_id` precondition holds there. If it does **not** hold, **stop** — the unique index in #311 will fail and §5.1's fix needs rethinking.

#### Step 2 — Re-issue the skipped ClickUp migration (unblocks #311)

**Do not rename `20260728160000_clickup_incremental_task_import.sql`.** It is landed on `main`, `AGENTS.md` forbids editing prior migrations, and renaming changes a version the ledger already holds.

**Do not use `supabase migration repair`.** It rewrites ledger state on a shared production database to paper over a repo-side naming mistake. Forward migrations are auditable; ledger surgery is not.

Add a **new** migration carrying the skipped file's DDL, fully idempotent:
- Timestamp **between `20260728171500` and `20260728181500`** — e.g. `20260728174500` — so it lands before #311 without renumbering #311.
- Every statement guarded: `add column if not exists`, `create index if not exists`, `create or replace function`. It must be a clean no-op where the original somehow did run.
- Header comment stating it re-issues `20260728160000`, why (duplicate version → silently skipped), and how the ledger behaves — so nobody later "cleans up" the apparent redundancy.

**You'll know it worked when:** applied to the local dependency closure it creates all 7 `clickup_*` columns and `pim.sync_clickup_tasks`; applying it a second time prints no changes and errors nothing; and the PopDAM foreign keys and indexes are still present afterwards.

#### Step 3 — Land #311, then rehearse on preview

1. Merge Step 2's migration to `main`.
2. Rebase `fix/clickup-importer-correctness` on `main`. Remove the "blocked" comment on #311.
3. `supabase db push --dry-run --linked` (must be linked to preview `rjyboqwcdzcocqgmsyel`, confirm via `cat supabase/.temp/project-ref`).
4. `supabase db push --linked`.
5. Run `supabase/tests/clickup_task_import_contracts.sql` against preview.
6. Run the importer `--dry-run` against preview, review the snapshot.
7. Run `--apply --linked`. Confirm from `ingest.sync_run` metadata: `rows_matched_by_clickup_task_id` is large, `rows_inserted` is near zero, product row count is unchanged.
8. Re-run immediately — expect `rows_unchanged` high and `rows_updated` ≈ 0, proving the incremental watermark works.

**You'll know it worked when:** `pim.product` row count before and after the first `--apply` is identical, and step 8 shows a near-empty second run.

#### Step 4 — Merge docs PR #307

Independent of everything above, mergeable now. Documents why clean-slate local replay cannot work (§4.3), so the next session does not burn an hour re-diagnosing it.

**You'll know it worked when:** `AGENTS.md` on `main` contains the `## 10.1` section.

#### Step 5 — Add CI guards against duplicate timestamps

Implement in `scripts/check-sql.sh` (already the repo's static gate, referenced throughout `AGENTS.md`) so it runs locally and in CI:
- **Guard A:** extract the leading `\d{14}` from every filename in `supabase/migrations/`; fail on any repeated value and print both offending filenames.
- **Guard B (recommended, catches the actual cause):** fail when a PR adds a migration whose timestamp is **earlier than the newest already on `main`**. That is precisely how this bug arose — a branch cut before another migration landed. Legal for Supabase, but dangerous in a repo with several parallel AI sessions.
- Add a unit test following the existing `scripts/*.test.mjs` pattern: no duplicates → pass; one duplicate → fail and name both files.
- Wire `check-sql.sh` into `.github/workflows/shared-supabase-migrations.yml` on `pull_request` if not already invoked there.

**You'll know it worked when:** deliberately duplicating a timestamp makes `scripts/check-sql.sh` exit non-zero and name both files; removing it passes.

#### Step 6 — Investigate PR #305

Find out how a PR titled "name the PLM divisions instead of printing raw ids" came to add three unrelated ClickUp files in commit `8a7197f`. Likely candidates: a branch cut from another session's branch instead of `main`, a bad rebase, or an over-broad `git add`. This is a process defect that will recur and it is how unreviewed code reached `main`.

**You'll know it worked when:** you can state the mechanism and either fix the process or document the trap in `AGENTS.md`.

#### Step 7 — Production sign-off (owner decision, not yours)

Only after Steps 1–3 are green on preview. Production apply requires the owner's **explicit** go-ahead naming the exact resource and action. "Fix deploys" or "apply the migration" is not approval.

#### Step 8 — Downstream sync

After the migration merges, regenerate `poppim-web/src/lib/database.types.ts` so the new columns are typed, and land the usual `chore: sync shared-db @ <sha>` mirror commit in `poppim-web`.

---

### 7. Constraints and gotchas in force

- **Never edit a landed migration.** Forward migrations only (`AGENTS.md`).
- **Never author schema changes in a consumer repo's `shared-db/` mirror** (e.g. `/worksp/poppim-web/shared-db/`). CI enforces this.
- **Preview-first, always.** Production is dry-run + allowlist bounded. Never push straight to `qsllyeztdwjgirsysgai`.
- **AI sessions are read-only against production and shared cloud infrastructure by default.** No `terraform apply`, no mutating `gcloud`, no ledger surgery. Never disable/delete/recreate a `*-prod` Cloud Build trigger unless the owner names the exact resource and action in the current chat.
- **Preview contains a full production data clone.** Treat its data and credentials as production-sensitive. Never paste values into chat, files, logs, or commits.
- **Land shared-db PRs promptly.** The preview branch is shared and persistent; a stuck unmerged push blocks every other workstream.
- **The unique index added by #311 affects all four apps**, not just Poppim. Any app inserting a `pim.product` row with an already-used `clickup_task_id` will now get a unique violation instead of silently forking the product. That is the intent, but PopCRM / PopDAM / DesignFlow owners should be aware.
- **Curated Poppim fields must never be overwritten by the importer:** `project_id`, `licensor_id`, `property_id`, `factory_id`, `company_id`, `stage`, `cover_url`. They are excluded from the upsert `SET` list. `metadata` is **merged**, not replaced.
- **Git author must be** `Albert Hazan <u2giants@users.noreply.github.com>` — GitHub blocks the gmail address.
- **Commit style:** short imperative subject (`add`/`fix`/`update`/`remove`), no trailing period; body only for non-obvious rationale. No force push.
- **`date_updated_gt` is strict (`>`)**, hence the deliberate 60s watermark overlap. Re-reading a boundary task is harmless because the upsert is idempotent.

---

### 8. Access and environment

- **Repos on this machine:** canonical at `/worksp/shared-db`; consumer at `/worksp/poppim-web` (its `shared-db/` subdir is the read-only mirror).
- **`gh` CLI:** authenticated for `u2giants`. Used to open PRs #307 and #311 and close #300.
- **1Password MCP:** connected. Vault `vibe_coding` (id `pimcaogmxxzoafh7lsluj6uxkq`). Relevant items — **reference by location, never paste values**:
  - Supabase CLI PAT — item `3t2xoqk5luyz7ffgdhj24gvtpq`, field `credential`
  - Preview branch credentials — item `qbvfk7umc3n75ejekd65zwd4ty`, field `DB_PASSWORD` (see §4.4: use the **item ID**, the title has parentheses that break `op://` parsing)
  - ClickUp API credentials — item `vd5q2ryp7rm3fytxl65pkx5ysu`
  - xAI / Grok key — item `w62tejbutu42ryo6d3pr62a3iy`, field `api key` (note: `credential` is stale/invalid)
- **Supabase CLI** 2.98.2, currently linked to **preview** `rjyboqwcdzcocqgmsyel` (`cat supabase/.temp/project-ref` to confirm before any push).
- **Docker** 29.6.0 available for throwaway Postgres.
- **ClickUp list IDs** (discovered live from the API, already the documented default in `tools/sync-clickup-tasks.mjs`, overridable via `CLICKUP_LIST_IDS`): Licensing Management `13194624`, Sourcing/Sampling Projects `901104141567`, New Prod Development `901103451188`, Edge Generic `15061776`, Sprint 1 `901113451000`.
- **Untracked file** `/worksp/shared-db/.ai/reviews/clickup-import-fixes-glm.md` — a GLM implementation report, left uncommitted deliberately. Commit or delete as you prefer.

---

### 9. Open questions and risks

| Item | Detail | Dated |
|---|---|---|
| **Production state unknown** | All measurements are from preview. Production may differ. Step 1 resolves this and must run first. | 2026-07-29 |
| **Zero-duplicate precondition** | The unique index in #311 requires no duplicate `btrim(clickup_task_id)` in `pim.product`. Verified on preview (0). **Unverified on production.** If it fails there, #311's migration will abort — by design, it raises and names up to 50 offending ids. | 2026-07-29 |
| **Never rehearsed on hosted Supabase** | All verification was stock Postgres with an `auth`/roles shim. Hosted Supabase differs (RLS, roles, PostgREST schema exposure, pooler behaviour). Preview apply remains the real gate. | 2026-07-29 |
| **Ledger completeness unverified** | The claim that ~170 marker migrations are all recorded in the production ledger comes from the migration files' own comments and is consistent with CI behaviour, but was never confirmed against the live ledger. | 2026-07-29 |
| **PR #305 mechanism unknown** | How unrelated files entered that PR is not established. Until it is, assume it can happen again. | 2026-07-29 |
| **Disaster-recovery gap** | Because ~170 migrations are empty markers, this repo **alone cannot rebuild the shared database from nothing**. Closing that needs a checked-in baseline schema dump (a new file outside `migrations/`, so it would not violate the no-editing rule). Not done. | 2026-07-29 |
| **No ClickUp rate-limit backoff** | `fetchListTasks` has no 429 retry. Judged acceptable at current volume (5 lists, low change rate); a single 429 aborts the run **without** advancing the watermark, so it fails safe. Revisit if task counts grow. | 2026-07-29 |
| **Decision: match on `clickup_task_id`, do not re-key** | Owner chose to leave the 17,859 Directus keys intact rather than re-key them to ClickUp, to avoid rewriting the identity of every existing product. | 2026-07-29 |
| **Decision: `succeeded_with_failures` rather than a new enum value** | `ingest.sync_status` has no `partial`. Adding an enum value to a shared type was judged riskier than marking `metadata`. Revisit if the distinction needs to be queryable. | 2026-07-29 |

---

### Self-audit

**1. Could a brand-new developer with no project knowledge pick up and not skip a beat?**
Yes. §1 defines the apps, the shared-database risk, and the project refs. §2 gives the business goal. §3 gives exact PR/branch/commit state and what is on `main`. §6 gives numbered steps with verification gates. §8 names every credential by vault location and the exact CLI state.

**2. Could they continue as effectively as this session can right now?**
Yes. The non-obvious, hard-won findings are all written down: the real `external_source` data distribution that invalidated the design (§5.1), the duplicate-timestamp ledger behaviour and how to recognise it (§5.3), the `op://` parenthesis parsing trap (§4.4), the empty-marker migrations and the correct local test recipe including the `dblink` requirement (§4.3), and the fact that three prior reviews missed the biggest bug (§4.2).

**3. Is every detail needed for flawless execution present?**
Yes. Background §1–2; current state §3; failures §4; root causes with evidence §5; ordered next steps with gates §6; constraints §7; access §8; risks and dated decisions §9. Verification evidence is quoted verbatim, including the **pre-fix** contract-test failures that prove the tests are meaningful.

**Gaps found and fixed during audit:** added the `dblink` requirement for contract case C5; added the explicit "do not use `migration repair`" rationale to §6 step 2; added the unique-index cross-app impact to §7; added the stale `credential` field note for the xAI item to §8.


---


## FRESH-SESSION BOUNDARY — PopSG PSG-5 DATABASE CONTRACTS APPLIED AND PROVEN ON PREVIEW (2026-07-31)

**This is the newest PopSG/PSG section.** Full record:
`fix_popsg_property_taxonomy_reconciliation.md` §22 (§21 below is the earlier same-day entry record
and remains valid history).

**Status:** the PSG-5 **database half is COMPLETE and proven on preview**. PSG-5 as a whole is NOT
complete — it is stopped at a business-decision gate (§4 below) and at the PopDAM worker boundary.
**PSG-6 not started. Production `qsllyeztdwjgirsysgai` never linked, queried, or pushed to. No
Supabase MCP tool was called.**

### What this application is

PopSG is POP's internal style-guide library at `https://sg.designflow.app`, served by
`u2giants/popdam3`. A NAS crawler derives Licensor and Property names from folder paths into
`public.style_guide_files`; a deterministic worker resolves them against the shared canonical
catalogue (`core.licensor`, `core.property`) and writes accepted tags to
`public.style_guide_file_tags`. This workstream reconciles folder text to the canonical catalogue
with no fuzzy matching, no cross-Licensor links, and no silent tag loss. The schema lives here.

### 1. What was applied to preview

ColdLion PR #331 merged (`0798c095`), freeing the one-schema-change-in-flight slot and raising the
version floor to `20260730000500`. Two migrations were then applied to `rjyboqwcdzcocqgmsyel` only,
each preceded by a `--dry-run` that listed exactly one file (its own) and by re-reading
`supabase/.temp/project-ref`:

- `20260731150000_popsg_property_resolution_contracts.sql`
- `20260731153000_popsg_property_alias_redundancy_trigger_fix.sql`

Created, and verified by `to_regclass` / `pg_proc` / `pg_constraint` rather than by ledger row:
`core.normalize_popsg_property_observation(text)`; `core.property_alias` (**0 rows**);
`dam.popsg_property_resolution` (**0 rows**); the three guarded RPCs
`public.propose_popsg_property_resolution`, `public.activate_popsg_property_decision_batch`,
`public.promote_property_alias_batch`; two trigger functions; and a unique index on
**`core.property (id, licensor_id)`** — the one change to a pre-existing shared table.

**No canonical Property created, no mapping activated, no tag written or removed, no decision row
seeded.** `supabase/tests/popsg_property_resolution_contracts.sql` — **27 assertions, all passing**
— runs inside `begin … rollback` and left nothing behind.

### 2. The bug the tests caught — a whole class, remember it

The first migration passed `check-sql.sh`, applied cleanly, and reported success. Test F3 then
failed: **every redundant alias was being accepted.** `core.reject_redundant_property_alias()` is a
**BEFORE** row trigger that read `new.normalized_alias`, a `GENERATED ALWAYS … STORED` column —
which Postgres populates *after* BEFORE-row triggers run. The value was always NULL, the guard never
fired, and nothing errored.

**Never read a generated column inside a BEFORE trigger.** Compute it from the source column with
the same function. Fixed forward in `20260731153000`; the applied `20260731150000` was not edited.

### 3. Everything that did NOT work / was deliberately declined

1. **Reading `new.normalized_alias` in a BEFORE trigger** — see §2. Silent, not an error.
2. **`aws-1-us-east-1.pooler.supabase.com` for preview** — rejects the preview tenant with
   `FATAL: (ENOTFOUND) tenant/user postgres.rjyboqwcdzcocqgmsyel not found`. **Preview's pooler is
   `aws-0-us-east-1.pooler.supabase.com`**, port 5432, user `postgres.rjyboqwcdzcocqgmsyel`.
   AGENTS.md §9 documents `aws-1-…` for *production* only. Preview is a Supabase **branch**, so it
   also does not appear in `supabase projects list`.
3. **`op_run` with `shell: "wsl"`** — mangles arguments into UTF-16 and fails with
   `Invalid command line argument`. Use the `argv` form
   `["wsl","-e","bash","-lc", "..."]` with `forwardEnvToWsl: true`.
4. **Deciding the eight Licensor aliases** — deliberately not done; it is a business judgement (§4).
5. **Editing the already-applied migration** to fix §2 — forbidden by AGENTS.md §4 rule 4; a
   corrective forward migration was landed instead.

### 4. BLOCKING OWNER GATE — the eight Licensor aliases (Albert's call, not an AI's)

26 of Albert's 51 approved rows — **15,816 of 44,331 files (35.7%)** — sit under a Licensor that the
eight hard-coded worker aliases feed. From the frozen PSG-1 blast-radius evidence (a production
measurement; **not** re-measured live, and no session should claim it was):

| Alias | Resolves to | Active files | Accepted relationships |
|---|---|---:|---:|
| NBC Universal | NBC | 25,731 | 14,931 |
| Marvel Style Guide | Marvel | 14,636 | 7,474 |
| One Piece | TOEI - ONE PIECE | 8,383 | 2,471 |
| Peanuts | Peanuts Worldwide | 3,509 | 3,705 |
| Sesame Workshop | Sesame Street | 1,630 | 77 |
| Paramount | Viacom Multi | 9,052 | 5,524 |
| **Nickelodeon** | Viacom Multi | **0** | **0** |
| **Viacom** | Viacom Multi | **0** | **0** |

Per alias Albert chooses **(a)** migrate into a durable approved contract, or **(b)** retain in
worker code with recorded sign-off plus a test. Two facts narrow it without deciding it:
`Nickelodeon` and `Viacom` are **dead** (retiring them changes nothing today), so the
"three-to-one Viacom mapping" flagged in plan §13 decision 7 **is effectively one-to-one** via
`Paramount`.

**The preview rebuild must not run until this is decided** — a later alias change would silently
re-parent 26 of the 51 approved decisions.

### 5. Exact next steps

1. Get Albert's per-alias ruling on the eight (§4). **Pass when:** all eight have a recorded (a)/(b).
2. Do the PopDAM worker work in `u2giants/popdam3` — load the new tables scoped by Licensor, drop
   the frozen-empty `PROPERTY_ALIASES`, and prove `normalizePopSGTag` is byte-identical to
   `core.normalize_popsg_property_observation` across all 21 frozen fixtures.
3. Seed the 51 as `pending` under `batch-01-exact-existing` / `f59118aa…643e`, then activate via
   `activate_popsg_property_decision_batch(..., 51)`. **Pass when:** it returns exactly 51 and a
   deliberate wrong-count call is refused.
4. Pre-rebuild snapshot **from preview at rebuild time**, rebuild, prove zero unexplained tag loss.
5. **Stop at the PSG-6 production gate.** PSG-6 must promote **both** migrations in order — shipping
   only the first ships the silently-broken trigger from §2 — and must re-run the contract suite
   against production, since an object can exist, be attached, and still do nothing.

### 6. Constraints in force

Only `batch-01-exact-existing` (51 rows / 44,331 files / `f59118aa…643e`) is approved. **Not
approved:** Batch 02, canonical creates, the 6,961 at-risk removals, all ambiguous rows including
`the lion king`, all deferred rows, CHEERS and THE EXORCIST (ColdLion Phase 5 gate, zero approved
creates). Production holds ~15 deliberately unpromoted migrations from other workstreams — never
`--include-all` against the full repo set.

### 7. Preview baseline changes (relay to other sessions)

Preview gained exactly the two migrations and the objects in §1. Both new tables are **empty**. The
test suite rolled back. **No existing table's data was read, modified, or deleted**; ColdLion's
audit/quarantine tables and the ClickUp importer rows were untouched.

### 8. Open questions and risks

- The eight-alias decision (§4) blocks both the rebuild and PSG-6.
- Normalizer parity is proven on the SQL side only; the TypeScript side is worker work. Exotic
  case-folding (`İ`, `ß`) is not in the frozen corpus — recorded as a known limit, not a proven
  equivalence.
- No at-risk removal subset has owner approval and none should be inferred.

### Self-audit

A developer with zero prior context can identify the application, what is now in preview and how it
was verified, the exact test evidence, five failed/declined paths with root causes, the blocking
owner gate with its evidence table, numbered next steps with pass conditions, the standing
exclusions, and the open risks — without reading any chat.

---

## PRIOR — PopSG PSG-5 non-schema entry record, slot occupied (2026-07-31, earlier the same day)

**Superseded by the section above; kept because it records the ColdLion checkpoint and the four
findings that shaped the implementation.** Full record: plan §21.

**Status at the time:** PSG-5 authorized (Albert, 2026-07-29) but not started as an implementation
phase. No database writes, migrations, preview access, or secrets.

### What this application is

PopSG is POP's internal style-guide library at `https://sg.designflow.app`, served by the
`u2giants/popdam3` application. A NAS crawler derives Licensor and Property names from folder path
segments into `public.style_guide_files`; a deterministic worker resolves those observations against
the shared canonical catalogue (`core.licensor`, `core.property`) and writes accepted relationships
to `public.style_guide_file_tags`. The PSG workstream reconciles the folder-derived names to the
canonical catalogue **without fuzzy matches, cross-Licensor links, or silent tag loss**. Schema for
that catalogue is owned here in `u2giants/shared-db`.

### 1. The blocker changed — the old one is gone, a new one took its place

The §20 blocker (duplicate migration version `20260728160000`) **is resolved.** PR #322 deleted the
never-applied ClickUp copy; the popdam foreign-keys file keeps the version because the production
ledger row belongs to it. On `origin/main` tip `75066fe`,
`ls supabase/migrations | cut -c1-14 | sort | uniq -d` prints nothing.

**But the one-schema-change-in-flight slot is still occupied.** ColdLion Step 7A is in **open
PR #331** (`MERGEABLE`), carrying four migrations that are **already applied to the shared preview
branch but not merged to `main`**:

```text
20260729230000_coldlion_licensor_property_recurring_promotion.sql
20260729234500_coldlion_recurring_promotion_collision_rule_fix.sql
20260729235500_coldlion_recurring_promotion_ambiguous_column_fix.sql
20260730000500_coldlion_recurring_promotion_absence_detection_fix.sql
```

`main`'s current maximum migration version is `20260729210000`; it becomes `20260730000500` when
#331 merges. This session therefore authored **no SQL, no migration, and no preview change**, per
`AGENTS.md` §4 rule 1 and its explicit instruction to report a detected collision rather than
resolve it unilaterally.

### 2. Recorded ColdLion checkpoint (required by plan §7/§11 before any preview work)

The STATUS table in `plan_coldlion_licensor_property_accelerated_cutover.md` **lags reality** — it
still describes Step 7A as blocked by the stale PR #311/#314 context. Cross-checked ground truth as
of 2026-07-31: Steps 0–6 complete/preview-proven; Step 7 production package complete but **not
applied** (production still holds zero ColdLion Licensor/Property mirror rows); **Step 7A built and
in open PR #331**; Steps 8–10 open, awaiting Albert's production approval; ColdLion **Phase 7 not
started**, so plan §11's "PSG-6 must not overlap Phase 7" is not yet triggered.

### 3. Non-schema PSG-5 work completed and verified

All three frozen inputs re-hashed and matching (use LF-canonical bytes — `tr -d '\r' < FILE |
sha256sum` — because the Windows checkout is CRLF, the §17 caveat):

| Artifact | SHA-256 |
|---|---|
| `batch-01-exact-existing.csv` (approved) | `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e` |
| `proposals.csv` (372-row ledger) | `cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4` |
| `currently-tagged-at-risk.csv` (6,961 rows — **evidence only**) | `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6` |

`node scripts/popsg-property-psg4-decision-package.test.cjs` → PASS (51 rows, 44,331 files,
parent_edges 51/51, package `e4ad02fd…0f68`). `node scripts/popsg-property-psg2-proposals.test.cjs`
→ passed. Independently re-derived from the CSV: 51 rows summing to 44,331 files, with
`currently_tagged_at_risk = false` and `cross_parent_proposal = false` on **all 51**.

### 4. Everything that did NOT work / was deliberately not attempted

1. **Authoring the PSG-5 migrations now.** Rejected twice over: PR #331 owns the schema slot, and
   CI Guard B compares against `main`'s newest version *at PR-open time* — so any timestamp chosen
   today would be stale the moment #331 merges.
2. **Using the Supabase MCP tools to inspect state.** Those tools are bound to **production** in
   these sessions and take no project parameter, so any call would have hit
   `qsllyeztdwjgirsysgai`. Not called at all. Use the Supabase CLI against preview instead.
3. **Hashing the frozen CSVs as checked out.** Produces wrong values (e.g. `4ce9a85f…` for
   Batch 01) because of CRLF. Strip `\r` first. Two sessions have now hit this.
4. **Trusting the ColdLion STATUS table alone** for the checkpoint. It lags; cross-check `gh pr`.

### 5. Key findings

- **The eight hard-coded `LICENSOR_ALIASES` are load-bearing for a third of the approved batch.**
  26 of the 51 approved rows — **15,816 of 44,331 files (35.7%)** — resolve under a Licensor the
  alias list feeds (NBC 19, VIACOM MULTI 6, MARVEL 1). Plan §7 step 6 reads like a tidy-up; it is
  actually a **prerequisite** to activating Batch 01 correctly.
- **Two of the eight aliases are dead.** `Nickelodeon` and `Viacom` measure 0 files / 0 accepted
  relationships. The whole three-to-one Viacom mapping's blast radius is `Paramount` alone (9,052
  files, 5,524 relationships) — so it is effectively one-to-one plus two no-ops. This simplifies
  the plan §13 open decision 7 that Albert must make.
- **The 2026-07-29 `public`-schema lockdown (`AGENTS.md` §10.2) changes PSG-5's DDL.** The plan's
  guarded RPCs live in `public`, so the event trigger will revoke EXECUTE from `anon`/PUBLIC and
  they will be callable by nobody but `postgres`/`service_role` unless the migration states grants
  explicitly. Its failures are `raise warning` only — a silent failure mode.
- **Preview is not a clean baseline.** It holds #331's four migrations, ClickUp importer rows in
  `pim.product` / `ingest.sync_run`, and 180 rows in `plm.coldlion_promotion_quarantine`. None
  touch the PopSG tag tables, but the PSG-5 pre-rebuild snapshot must be taken **from preview at
  rebuild time**, never reusing the 2026-07-26 production baseline, or the delta is fictional.

### 6. Exact next steps

1. `gh pr view 331 --json state,mergedAt` — **pass when** `MERGED` and no other open PR carries a
   migration (docs-only PRs do not occupy the slot).
2. Re-read the ColdLion STATUS table; §2 above will be stale.
3. Re-check the version floor, then author the `core.property_alias` /
   `dam.popsg_property_resolution` migrations restricted to `batch-01-exact-existing`, with the
   explicit grants from plan §21.6. **Pass when** `scripts/check-sql.sh` passes and
   `supabase db push --dry-run --linked` against `rjyboqwcdzcocqgmsyel` lists only those files.
4. Settle the eight `LICENSOR_ALIASES` **before** the rebuild, and assert parent-stability on the
   26 alias-dependent rows.
5. Take the preview pre-rebuild snapshot, rebuild, and prove **zero unexplained accepted-tag loss**.
6. **Stop at the PSG-6 production gate.**

### 7. Constraints in force

Only `batch-01-exact-existing` is approved. **Not approved:** Batch 02, canonical creates, the
6,961 at-risk removals (`batch-06` is explicitly non-approvable), all ambiguous rows including
`the lion king` (521 files, locked), all deferred rows, and CHEERS / THE EXORCIST (routed to the
ColdLion Phase 5 gate, which still has zero approved creates). Production `qsllyeztdwjgirsysgai`
holds ~15 deliberately unpromoted migrations from other workstreams — never `--include-all`.

### 8. Open questions and risks

- PSG-5 implementation remains authorized but unstarted; it is gated only on PR #331 merging.
- Albert must still decide the fate of the eight Licensor aliases (plan §13 decision 7).
  **UPDATE 2026-07-31 — half-answered, see PSG-5a below.** Albert chose to MIGRATE them into
  `core.licensor_alias` (plan §22.13). He did NOT ratify that any individual mapping is correct;
  all eight were recorded `inherited_unverified`. **Then, later the same day, he ruled on the NBC
  family only — see PSG-5b below.** **UPDATE 2026-07-31, LATER STILL — NOW FULLY ANSWERED, see
  PSG-5c below.** Albert then ruled "all correct" on the five remaining LIVE aliases (Marvel Style
  Guide, One Piece, Peanuts, Sesame Workshop, Paramount). Current state: **10 rows, 8
  `owner_approved`, 2 `inherited_unverified`** — and the two remaining (`Nickelodeon`, `Viacom`) are
  dormant with a measured zero files, were presented to him as needing no decision, and were
  deliberately left unruled. **This owner gate is CLOSED; do not re-ask Albert about it.**
- No at-risk removal subset has owner approval, and none should be inferred.

### PSG-5a (2026-07-31) — the eight `LICENSOR_ALIASES` moved from code into `core.licensor_alias`

**What it is.** Migration `20260731210000_core_licensor_alias.sql` on branch
`feat/core-licensor-alias-20260731` (PR left OPEN, not merged) creates `core.licensor_alias` and
seeds the eight aliases that until now lived only in a hard-coded array in the PopDAM worker
(`u2giants/popdam3`, `apps/worker/src/handlers/popsg-tags.ts`; frozen mirror at
`scripts/popsg-property-psg1-inventory.cjs` lines 8-17). Full design rationale: plan §22.13.

**The distinction that matters.** Albert approved MOVING these into the database. He did NOT
approve that each mapping is factually correct — nobody knows who wrote the original eight, when,
or on what authority. Every seeded row is `approval_status = 'inherited_unverified'`, and the table
makes `owner_approved` structurally unrepresentable without a named approver, a timestamp AND an
evidence reference (enforced by CHECK constraints, so even a `service_role` write cannot fake it).
`public.approve_licensor_alias()` is the only promotion path. **Do not read the existence of these
rows as owner sign-off.**

**Shape.** Mirrors `core.customer_alias` / `core.factory_alias` / `core.property_alias`. Uses the
PSG-5 normalizer `core.normalize_popsg_property_observation`, not the simple `lower()` one. One
deliberate divergence from `core.property_alias`: **uniqueness is GLOBAL on `normalized_alias`**
because a Licensor alias is the top-level lookup key with no parent scope to disambiguate it. A
trigger also refuses any alias that would shadow a real canonical Licensor's name or code.
`Nickelodeon` and `Viacom` are flagged `is_dormant` (0 files in the frozen measurement) — recorded
as insurance, not live behaviour.

**Read path:** `public.resolve_licensor_alias(text)`, `public.list_licensor_aliases()`,
`public.approve_licensor_alias(text,text,text)` — all with grants stated explicitly against the
§10.2 lockdown event trigger, and all asserted `auth_exec=t`/`svc_exec=t`/`anon_exec=f`.

**All six target names resolved to exactly one `core.licensor` row each** (NBC, MARVEL,
TOEI - ONE PIECE, PEANUTS WORLDWIDE, SESAME STREET, VIACOM MULTI). No licensor was created or
guessed.

**PREVIEW — SUPERSEDED, now APPLIED.** This paragraph originally read "PREVIEW WAS NOT TOUCHED":
at the time, four foreign ColdLion migrations (`20260731163000`, `20260731180000`, `20260731190000`,
`20260731200000`) were merged to `main` but not yet pushed to `rjyboqwcdzcocqgmsyel`, so pushing
would have moved another session's baseline and was refused. **Those four have since been applied to
preview by their own session.** As of 2026-07-31, `supabase db push --dry-run --linked` lists only
`20260731210000_core_licensor_alias.sql`, and it **has been applied to preview**. See PSG-5b for the
current preview state.

**popdam3 is UNCHANGED and the code array is still live.** Cutover steps are in plan §22.13: worker
reads the table, asserts parity with the frozen array and fails loudly on mismatch, runs both paths
in parallel for a full production sync cycle, and only then may the array be deleted — never in the
same release that introduces the table read. Until that happens this migration is additive and
inert; it changes no worker behaviour.

**Sharp edge now locked by test:** camel-case splitting fires only on a lower/digit -> UPPER
boundary, so `NBCUniversal` normalizes to `nbcuniversal`, NOT `nbc universal`. Fixture
`caps_run_no_split` in `supabase/tests/core_licensor_alias_contracts.sql` prevents anyone
"fixing" this and silently re-parenting 25,731 files.

### PSG-5b (2026-07-31) — Albert's NBC ruling, the two missing variants, and the FIRST owner approval

**The ruling, verbatim, given by Albert in session on 2026-07-31:**

> "NBC Universal really means NBC, really means NBCU, really means NBCUniversal"

Four observed strings denote the one canonical Licensor **`NBC`** (id
`154bf54b-6f7d-4999-b0fb-c2828b12b56a`, code `NB`). Implemented in the SAME migration as PSG-5a
(`20260731210000`, sections 6b and 7) on the SAME branch `feat/core-licensor-alias-20260731` — the
migration had not yet been applied to preview or merged to `main`, so extending it was legal and
preferable to a second forward migration. Full detail: plan §22.14.

**Why this was not a one-line change.** The inherited code array had only
`["NBC Universal", "NBC"]`. The normalizer splits camel case only on a lower/digit → UPPER boundary,
so the four strings have **four different** normalized forms:

| string | normalized | matched before? |
| --- | --- | --- |
| `NBC Universal` | `nbc universal` | yes (the code array's one alias) |
| `NBC` | `nbc` | yes (it is the canonical Licensor's own name) |
| `NBCU` | `nbcu` | **NO — matched nothing at all** |
| `NBCUniversal` | `nbcuniversal` | **NO — matched nothing at all** |

`NBCU`/`NBCUniversal` do NOT collapse into `nbc universal`. They are now alias rows. All four
normalized forms are pinned as fixtures (tests §G1/G1b) so a later normalizer "fix" cannot silently
merge them.

**`NBC` is deliberately NOT an alias row.** It is the canonical Licensor's own name; resolution
tries a direct canonical name/code match *before* aliases, and the redundancy trigger correctly
refuses an alias equal to its own target's name. So the ruling's four strings map to **three** alias
rows plus the canonical record. Test G4 pins this so nobody "fixes" the apparent off-by-one.

**Blast radius of the two new variants: ZERO today, by measurement.** The frozen PSG-1 corpus
(`docs/verification/popsg-property-reconciliation-20260727-psg1/inventory.csv`, 372 observation
rows) holds 21 distinct normalized folder-level Licensor strings: `nbc universal` in **55** rows,
`nbcu` and `nbcuniversal` in **ZERO**. (The one `NBCU` string in that corpus is a *property* folder,
`_NBCU CLEARED EDITORIAL`, under licensor `NBC UNIVERSAL` — already resolved.) **No PopSG
folder/file is going unaliased today** because none exists. Production was NOT queried. Both rows
are therefore `is_dormant` with that measurement as evidence, and carry
`source_system = 'owner_ruling'` (not `'popdam_worker_code'`) so a reader can tell a human decision
from inherited folklore.

**How the approval was recorded — the FIRST use of the owner-approved path.** Through
**`public.approve_licensor_alias()`**, the table's only sanctioned approval mechanism, NOT by writing
the approval columns directly. The two new variants are seeded `inherited_unverified` and promoted
by the RPC inside the same migration, so the mechanism is exercised rather than bypassed.
`approved_by` = `Albert Hazan`; `approval_evidence` quotes the ruling verbatim and cites that it was
given in session on 2026-07-31.

Three things a future session must not "tidy up" without reading why:

1. **`approved_at` is set explicitly after the RPC call, to the RULING date.** The RPC can only
   stamp `now()`, which would make preview say 2026-07-31 and production say whatever day it was
   promoted — two answers to "when did Albert decide this" for one decision.
2. **It is stored at 12:00 UTC, not midnight, and that is load-bearing.** This database's session
   TimeZone is `America/New_York`. At `2026-07-31 00:00:00+00`, `approved_at::date` renders as
   **2026-07-30** — the audit trail would name the wrong day for the owner's decision. Caught by
   contract test G3 during the preview rehearsal, not in review. G3 now asserts the date in explicit
   UTC *and* in server-local time, which is what forces the value off the midnight boundary.
3. **The migration sets a transaction-local `request.jwt.claims` before calling the RPC.** The RPC's
   guard is `if not (app.has_role('administrator') or auth.role() = 'service_role')`. In a migration
   there is no JWT, `auth.role()` returns NULL, the expression is NULL, and `if NULL then` does not
   fire — so the guard would admit the call *by accident*. The claim asserts service-level authority
   explicitly instead of building on a null hole. It is reset immediately after.

**Scope — the NBC family ONLY.** Seven aliases were NOT touched and remain `inherited_unverified`:
Marvel Style Guide, One Piece, Peanuts, Sesame Workshop, Paramount, Nickelodeon, Viacom. Tests
A2/A3/A4 assert this **by name, not by count**, so no later session can quietly ratify Marvel on the
back of Albert's NBC ruling.

**⚠️ ADDING THESE ROWS IS NECESSARY BUT NOT SUFFICIENT — `NBCU`/`NBCUniversal` DO NOT WORK YET.**
The PopDAM worker still resolves Licensor strings from its own hard-coded `LICENSOR_ALIASES` array
in `u2giants/popdam3` (`apps/worker/src/handlers/popsg-tags.ts`). It does not read
`core.licensor_alias`, and nothing in `shared-db` can make it. Until the popdam3 cutover in PSG-5a /
plan §22.13 is done, these two rows are a **recorded decision with no runtime effect**. That
repository was deliberately not modified.

**Preview state.** `20260731210000` is APPLIED to preview `rjyboqwcdzcocqgmsyel` (pushed
2026-07-31 after a full `BEGIN … ROLLBACK` rehearsal; dry-run listed only that file; `--include-all`
never used). `core.licensor_alias` now holds **10 rows: 3 `owner_approved`, 7
`inherited_unverified`.** All **34** contract assertions pass against the applied baseline.
Production `qsllyeztdwjgirsysgai` was never linked, queried or pushed to, and no Supabase MCP tool
was called. **The PR is left OPEN and unmerged.**

**Backlog (recorded, deliberately NOT fixed here):**

- Give `public.approve_licensor_alias()` an optional approval-timestamp parameter, so recording a
  historical owner decision does not need a follow-up `update` to correct `approved_at`.
- Make that RPC's privilege guard NULL-safe (`coalesce(auth.role(), '') = 'service_role'`). Not
  exploitable through PostgREST today — `anon` has no EXECUTE and a real `authenticated` caller
  always carries a role claim — but the guard currently passes on NULL rather than failing closed.
- Consider a single `public.resolve_licensor(text)` that does canonical-name/code match first and
  alias fallback second, mirroring the worker. Today callers must implement that two-step order
  themselves, which is exactly how `NBC` could be mistaken for an unresolved string.

### PSG-5c (2026-07-31) — Albert's SECOND ruling: the five remaining LIVE aliases approved

**⚠️ This supersedes the "7 still `inherited_unverified`" statements in PSG-5a and PSG-5b above.**
Current state is **10 rows: 8 `owner_approved`, 2 `inherited_unverified`.** The owner gate on the
Licensor aliases (plan §13 decision 7 / §22.6) is **CLOSED**.

**The ruling, verbatim, given by Albert in session on 2026-07-31.** He was shown this exact table:

| Folder says | Filed under canonical Licensor | Files (frozen measurement) |
| --- | --- | --- |
| Marvel Style Guide | Marvel | 14,636 |
| One Piece | TOEI - ONE PIECE | 8,383 |
| Peanuts | Peanuts Worldwide | 3,509 |
| Sesame Workshop | Sesame Street | 1,630 |
| Paramount | Viacom Multi | 9,052 |

and asked, verbatim, **"Is that correct?"**. He answered, verbatim:

> "all correct"

**THE CAVEAT HE WAS GIVEN BEFORE HE RULED — AND RULED ANYWAY.** He was told explicitly, before
answering, that **Sesame Workshop → Sesame Street was the one mapping that would be scrutinised
hardest, because it is the only mapping from a COMPANY name to a SHOW name while the other four run
the other way.** He approved it anyway, with that flag in front of him. This is recorded verbatim in
the `approval_evidence` of all five rows and pinned by contract test **H2**, so a future reader can
see the odd one out was named as odd and accepted with eyes open — not slipped through in a batch.
**Do not "re-open" Sesame Workshop on the grounds that it looks inconsistent. That inconsistency was
put to the owner and accepted.**

**Implemented as a NEW FORWARD migration**, `20260731220000_licensor_alias_owner_approval_remaining_five.sql`,
branch `feat/licensor-alias-owner-approval-20260731`. `20260731210000` was NOT edited — it is merged
to `main` and already applied to preview, so editing it is both forbidden (AGENTS.md §4 rule 4) and
inert (the ledger keys on the version, so an edited file at a recorded version never re-runs).

**Recorded through `public.approve_licensor_alias()`**, the sanctioned path, not by writing the
approval columns. `approved_by` = `Albert Hazan`. `approved_at` pinned to
`2026-07-31 12:00:00+00` — **midday UTC, not midnight, for the same load-bearing reason as PSG-5b
item 2**: the database runs `America/New_York`, so a midnight-UTC value reads back through
`approved_at::date` as **2026-07-30** and would misdate the owner's decision. Contract test **H3**
asserts the date in explicit UTC *and* in server-local time simultaneously, which is what forces the
value off the midnight boundary. Verified on preview: `show timezone` → `America/New_York`, and all
eight approved rows read `2026-07-31` in both.

**Nickelodeon and Viacom were deliberately NOT approved** and remain `inherited_unverified` with all
three approval fields NULL. Both are dormant with a measured **zero** files in the frozen PSG-1
corpus; they were presented to Albert as needing no decision and **he did not rule on them.**
Approving them would invent a ruling he never gave. Tests **A4** and **H4** pin this **by name**.

**Tests.** `supabase/tests/core_licensor_alias_contracts.sql` extended with **section H** (H1–H6) and
sections A2/A3/A4 updated to the new expected state. All assertions are by name, never by count
alone. **All 40 assertions pass** against the applied preview baseline (`BEGIN … ROLLBACK`). H5
specifically re-asserts that the NBC family's earlier approval is untouched — same approver, same
date, still quoting the NBC ruling and not the five-alias one. H6 asserts that approving changed
**routing not at all**: approval is an audit act, and each alias still resolves where it always did.

**Preview.** Dry-run listed **only** `20260731220000_…`; applied to `rjyboqwcdzcocqgmsyel` with
`project-ref` confirmed before every push; `--include-all` never used. Production
`qsllyeztdwjgirsysgai` was never linked, queried or pushed to, and **no Supabase MCP tool was
called**. **The PR is left OPEN and unmerged.**

**⚠️ STILL NO RUNTIME EFFECT — READ BEFORE ASSUMING ANYTHING CHANGED.** The PopDAM worker
(`u2giants/popdam3`, `apps/worker/src/handlers/popsg-tags.ts`) continues to resolve Licensor strings
from its own hard-coded `LICENSOR_ALIASES` array. It does not read `core.licensor_alias`, and nothing
in `shared-db` can make it. Until that worker is switched over to `public.resolve_licensor_alias()`
(plan §22.13 cutover), this migration changes the **audit record only** — it records that a human
ratified five mappings that were already in force. No file is re-routed and no tag is recomputed.
That repository was deliberately not modified.

**What this unblocks.** The owner gate was the last *decision* blocking the PSG-5 rebuild. Every
alias now either carries an owner ruling or is dormant-with-zero-files by measurement. The remaining
PSG-5 work is execution, not authorisation — see the updated open-questions bullet above.

### Self-audit

A developer with zero prior context can identify the application, the exact approved scope and its
hashes, the recorded ColdLion checkpoint, why no schema work happened, the four paths that failed
or were deliberately declined, the five key findings, the numbered next steps with pass conditions,
the standing exclusions, and the open risks — without reading any chat. Every next step has a
verification condition. This section adds no code, schema, or database state to reproduce.

---

## FRESH-SESSION BOUNDARY — PopSG Property reconciliation PSG-5 BLOCKED BEFORE SCHEMA WORK (2026-07-29)

**Status:** PSG-5 authorized by Albert on 2026-07-29 but stopped before any migration, branch, or
preview change. Full record: `fix_popsg_property_taxonomy_reconciliation.md` §20.
**Database writes / migrations / rebuilds / activation / deployment:** none.

### What this session did

Re-read `AGENTS.md`, the newest PSG section of this file (PSG-4 APPROVED, below), and the full
reconciliation plan. Recorded the current ColdLion checkpoint: Steps 0–6 complete/preview-proven,
Step 7 production package complete but unapplied, **Step 7A open and explicitly blocked by the
live ClickUp correctness PR #311**. PR #300 is closed. The historical duplicate migration version
`20260728160000` is shared by
`20260728160000_clickup_incremental_task_import.sql`, already on `main` via `8a7197f`, and
`20260728160000_popdam_user_tables_foreign_keys.sql`, already on `main` via `0b8425b`.
PR #314 re-issued the skipped ClickUp SQL as
`20260728174500_clickup_incremental_task_import_reissue.sql`; the historical filenames remain
immutable. Production remains untouched; Steps 8–10 remain blocked.

A second agent was assigned ColdLion Step 7A but stopped without changes after inspecting stale
state. Ground truth on `origin/main` confirms Step 7A and this handoff exist. No Step 7A agent is
currently assumed active; a fresh implementing session must still serialize behind PR #311 and
verify the #314 reissue on preview. Because PSG-5 also needs
new files in `supabase/migrations/` (the `core.property_alias` / `dam.popsg_property_resolution`
contracts), this session treated the schema-change-in-flight slot as occupied and **stopped
before creating any PSG-5 branch, migration, or preview change**, per the one-schema-change-in-
flight rule and this session's explicit instruction to report rather than silently resolve a
detected collision.

All PSG-4 limits are preserved: only `batch-01-exact-existing` (51 rows / 44,331 files, SHA-256
`f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`) is approved. Batch 02,
canonical creates, the 6,961-row at-risk removals, ambiguous/deferred rows, and the eight
hard-coded `LICENSOR_ALIASES` remain untouched and unresolved.

Rereading PSG-6/PSG-7 found one new drift to record: PSG-6's "physically bounded production
migration runner if unrelated migrations remain pending" step must treat the ClickUp/foreign-keys
timestamp collision as immutable history. PR #314 re-issued the skipped SQL under a new version;
future bounded-checkout verification must include the reissue and verify real objects rather than
trust the duplicated ledger version alone. No other PSG-6/PSG-7 drift was found.

### Exact next steps

1. Before starting PSG-5 implementation, confirm with a fresh `gh pr list` that PR #311 has landed
   or closed, and verify the `20260728174500` ClickUp reissue objects on preview. Do not require the
   historical `20260728160000` filenames to disappear; applied migrations are immutable.
   **Pass when:** no open PR owns a shared-db schema change and preview has no unmerged rehearsal.
2. Only then create a PSG-5 branch and continue exactly at
   `fix_popsg_property_taxonomy_reconciliation.md` §7 "PSG-5 — preview implementation and
   rebuild," restricted to `batch-01-exact-existing`.
3. Recheck the ColdLion checkpoint again immediately before that preview work, since it is a
   moving target (currently Step 7A open).
4. Stop at the PSG-6 production-approval gate; do not begin PSG-6.

### Access and environment

No secret was read or created; neither Supabase project was accessed. This session ran in an
isolated git worktree fast-forwarded to `origin/main` (`fa890ae`) and made no push.

---

## FRESH-SESSION BOUNDARY — real recurring ColdLion Licensor/Property feed (2026-07-29)

> ### ✅ STEP 7A IS BUILT AND PREVIEW-PROVEN (2026-07-29 evening). Next action: **Step 8**.
>
> The recurring lane now exists. `.github/workflows/coldlion-licensor-property-production.yml`
> targets production only and is **DISABLED**; the repository variable
> `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` was **not** created, no production secret was
> created, and **no production write, link or query occurred**. Four migrations
> (`20260729230000`, `20260729234500`, `20260729235500`, `20260730000500`) are applied to
> **preview only**.
>
> Two-cycle + fault rehearsal **14/14**, readiness **`ready=true`**, offline suite **192/192**.
>
> **A one-time 542-link run does NOT complete the feed switch** — that statement is now removed
> or corrected wherever it appeared.
>
> The rehearsal found **four SQL defects and one runner defect that all the unit tests missed**,
> including a collision rule that would have quarantined **542 of 542 rows (the entire feed)** and
> a silent failure that made records ColdLion stopped sending simply vanish. Read
> [`docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md`](docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md)
> **before touching this workstream**, and read the "Steps 8–10 drift review" section of the plan
> before starting Step 8.
>
> **Preview coordination:** preview is additive-schema-ahead of `main`. Two things another session
> should expect and not treat as drift: `plm.taxonomy_breaker_enforcement_status()` now reports
> `expected_count: 11` (was 9), and the promotion lane writes append-only rows to
> `plm.coldlion_promotion_audit` / `plm.coldlion_promotion_quarantine`. No canonical row, name,
> status, parent edge or UUID was changed; health is green (38 / 504 / 542).

### 1. What this application is

`u2giants/shared-db` owns the one Supabase database shared by POP's CRM, DAM, PM/PIM,
DB Data Admin, PopSG, and DesignFlow PLM applications. Production is
`qsllyeztdwjgirsysgai`; preview is `rjyboqwcdzcocqgmsyel`. `core.licensor` and
`core.property` are stable master tables whose UUIDs are used across those apps.

DesignFlow is the current production feed. Its 468 Property staging rows collapse to 256
canonical Properties. ColdLion is POP's ERP and the intended recurring source for source
identity, codes, and source descriptions. Supabase must continue to own Property-to-Licensor
parents and active/inactive status because ColdLion does not provide those facts.

### 2. What we set out to do this session, and why

Albert asked whether the 256 Properties came from DesignFlow and whether a ColdLion switch was
planned. After confirming both, he requested a GLM-5.2 critique. GLM found the prepared package
was a safe one-time mirror plus 542 source links, including 504 Property links, but not a recurring
feed. It had no production schedule, monitoring, or canonical-field update path. Albert decided
on 2026-07-29 to build a **real recurring ColdLion feed switch**, not a one-time link.

### 3. Current state

- The corrected plan merged through [PR #308](https://github.com/u2giants/shared-db/pull/308),
  commit `3dac90bb2360529e6bc56243f1a33c6f88f361a1`.
- [`plan_coldlion_licensor_property_accelerated_cutover.md`](plan_coldlion_licensor_property_accelerated_cutover.md)
  starts the next session at Step 7A and blocks Step 8 production approval.
- Step 7A specifies a separate production workflow, schedule map, guarded promotion, quarantine,
  readiness checks, two preview cycles, fault tests, monitoring, alerts, and rollback.
- The successful GLM review is
  [`.ai/reviews/glm52-coldlion-recurring-feed-plan-review.md`](.ai/reviews/glm52-coldlion-recurring-feed-plan-review.md).
- No recurring workflow, migration, database write, production secret, variable, schedule, or
  production action was created in this session.
- The checkout was clean on `main` after PR #308 merged.
- Implementation is blocked until shared schema work is serialized. PR #300 is closed and
  superseded. PR [#311](https://github.com/u2giants/shared-db/pull/311) remains open. The two
  immutable historical files with timestamp `20260728160000` are:
  `20260728160000_clickup_incremental_task_import.sql` and
  `20260728160000_popdam_user_tables_foreign_keys.sql`. Supabase keys migrations by timestamp
  alone, so the ClickUp file silently skipped. PR #314 added
  `20260728174500_clickup_incremental_task_import_reissue.sql` to execute it safely under a new
  version.

### 4. Everything we tried that did NOT work

1. The first GLM run returned an unrelated `CLAUDE.md` draft. It was rejected. A corrected brief
   explicitly blocked that task, and the second GLM-5.2 run produced the committed review.
2. The old plan treated one-time links as enough for production approval. GLM proved that did not
   switch the routine feed. Do not restore the old Step 8 starting point.
3. Relaxing the preview-only workflow for production is rejected. Preview and production need
   separate workflows and schedule maps so delayed events cannot cross environments.
4. Starting database implementation now was rejected because the ClickUp work owns the schema
   slot. The skipped migration was fixed forward by PR #314; never rename applied history or hide
   it with migration repair.

### 5. Root causes and key findings

- A ColdLion source link is provenance, not a recurring feed.
- A real switch needs scheduled refresh, guarded promotion, monitoring, alerting, and a defined
  rule for source-owned description changes.
- Canonical UUIDs, status, and `core.property.licensor_id` must never change from feed presence.
- Merch-group identity requires `(company, division, mgTypeCode, mgCode)`. Code alone is unsafe.
- New, missing, ambiguous, cross-typed, re-keyed, or parentless ColdLion rows must quarantine.
  Missing rows must never auto-delete or auto-inactivate canonical records.
- DesignFlow remains temporary corroboration for parent/status facts until separate Phase 8 work.

### 6. Exact next steps

1. Sync `origin/main`; re-run `gh pr list`; inspect PR #311 and the preview ledger.
   **Pass when:** no other schema work owns preview and no unmerged rehearsal row remains.
2. Verify the real objects from `20260728174500_clickup_incremental_task_import_reissue.sql`.
   Keep both historical `20260728160000` files unchanged and never use migration repair.
   **Pass when:** PopDAM foreign keys and ClickUp reissue objects both exist as intended.
3. Re-read the full Step 7A plan, the original cutover plan, Phase 6 handoff, and Step 7 production
   package. **Pass when:** the implementation checklist covers every deliverable and exclusion.
4. Build Step 7A on a new `codex/` branch. Do not create or enable production secrets or variables.
   **Pass when:** offline tests and SQL checks pass and production remains disabled.
5. Apply any new additive migration to preview only after a bounded dry run. Rehearse two cycles
   and all named fault cases. **Pass when:** cycle two is idempotent; allowed changes are audited;
   unsafe cases fail or quarantine; protected hashes stay unchanged.
6. Obtain an independent review with no Critical or High issue. Update the plan, handoff,
   evidence, and production package, then merge the PR. **Pass when:** Step 7A records the PR,
   merged SHA, tests, preview runs, and evidence while production remains untouched.
7. At Step 7A closeout, re-read every downstream section from Step 8 to plan end. Correct or report
   all drift before handoff. **Pass when:** docs and code agree and no one-time-link claim remains.
8. Stop and use another fresh session for Step 8 approval. **Pass when:** Albert receives one exact
   request covering migrations, schedules, secrets, variables, modes, monitoring, and rollback.

### 7. Constraints and gotchas

- Shared-db uses branch + PR; preview first; one schema change in flight at a time.
- Never edit an applied migration, reuse a timestamp, or use `--include-all` on the full set.
- Never run direct shared-database DDL or use dashboard edits.
- Preserve UUIDs, statuses, parents, and DesignFlow refs.
- Never match merch groups by code alone or auto-create/delete/inactivate canonical rows.
- Production and preview workflows must stay separate.
- Production stays read-only until an exact later Step 8 approval.
- Step 7A must not overlap PopSG PSG-6 or another shared schema rehearsal.

### 8. Access and environment

- Repo: `C:\repos\shared-db`; GitHub: `u2giants/shared-db`.
- Start from clean `main`, then create a `codex/` branch after serialization.
- Verify commit identity is `Albert Hazan <u2giants@users.noreply.github.com>`.
- `gh` worked for fetch, PR, merge, and verification.
- Preview: `rjyboqwcdzcocqgmsyel`. Production: `qsllyeztdwjgirsysgai`.
- Secrets live in 1Password vault `vibe_coding`: Supabase CLI token, production DB password,
  preview credentials, and ColdLion API key. Never expose values.
- Future GitHub secret names are `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_DB_PASSWORD_PRODUCTION`, and `COLDLION_API_KEY`. Creating or filling the production
  secret waits for Step 8 approval.
- This is Windows PowerShell. POSIX commands must explicitly use Git Bash, never WSL.

### 9. Open questions and risks

- PR #311 and preview state may change. Re-check ground truth in the fresh session.
- Preview evidence established that PopDAM claimed `20260728160000` and ClickUp skipped; PR #314
  supplied the forward reissue. Production object state still requires read-only verification
  before any later production package. Verify objects, not only the ledger.
- The schema may need an explicit source-description/audit field rather than overloading a curated
  display name. Step 7A must inspect and choose the smallest additive design.
- Recurring GitHub Actions needs durable production credentials. Build and preview-test the
  workflow now; secret creation, enabling, and first production use wait for Step 8.
- GitHub cron is not exact. Select work from `github.event.schedule`, not wall-clock time, and
  deliver failure alerts from the detecting run.

### Fresh-session self-audit

1. **Street-newcomer continuation: Yes.** Sections 1–3 define the system, decision, current state,
   environments, merged commit, and blocker. Section 6 gives ordered work with pass gates.
2. **Equal effectiveness: Yes.** Sections 3–5 preserve both GLM outcomes, the stopped stale-state
   agent, rejected approaches, source ownership, identity rules, and the fixed-forward timestamp
   history.
3. **Failed work included: Yes.** Section 4 records the unrelated first GLM result, invalid
   one-time framing, rejected workflow reuse, and why database work stopped.
4. **Concrete next steps: Yes.** Every item in Section 6 names the action and its proof.
5. **Terms and access explained: Yes.** Sections 1, 3, 7, and 8 define repos, projects, tables,
   PRs, commit, secrets, shells, and phase boundaries.

Final synthesis:

1. **Comprehensive for a brand-new developer: Yes.** Sections 1–9 cover all required knowledge.
2. **Detailed enough to continue as well as this session: Yes.** The merged plan plus Sections
   3–6 preserve the full decision and implementation boundary.
3. **Every relevant detail is present: Yes.** Changing external facts are explicitly routed to
   fresh read-only verification rather than guessed.

**Self-audit result: PASS — 2026-07-29.**

> **COMPLETED — DB Data Admin guarded in-table editing (2026-07-28):**
> Development at `https://data-dev.designflow.app` now supports an **Edit table** mode
> for Customer/Vendor status fields, strict dropdown values, RevoGrid copy/paste and
> drag-fill, and up to 10 audited undo actions. Name is read-only. The circular-arrows
> button is explicitly labelled and tooltipped **Refresh table**. A multi-row drag-fill
> is one undo step; refresh/entity changes clear local history. PRs
> [#293](https://github.com/u2giants/shared-db/pull/293),
> [#294](https://github.com/u2giants/shared-db/pull/294), and
> [#296](https://github.com/u2giants/shared-db/pull/296) merged; live build
> `c005516a18e405642934ef7050c022ff2cf5b50f` returned HTTP 200 and was verified from
> the HTML `build-sha`. Final checks: 77 unit tests, 9 Chromium browser tests, lint,
> audit, and production build passed. This workstream has no open next step and must
> not be confused with the unrelated open workstreams below. Canonical behavior is in
> `DB_Data_Admin.md` §3 and `apps/db-data-admin/README.md` → “In-table editing.”
>
> **Fresh-developer self-audit for this completed workstream:** yes, with evidence.
> The application/purpose and environment are defined in the existing DB Data Admin
> handoff §§1–3; the exact shipped behavior, allowed fields, undo semantics, PRs, live
> SHA, and verification are in the banner above; failed paths are recorded in GitHub
> history and no failed implementation remains to continue; next action is explicitly
> “none.” The existing unrelated handoff sections retain their own background, failures,
> exact next steps, constraints, access notes, risks, and self-audits.

## OPEN FIX — `search_style_tracker_link_candidates` is blind to alias rows and to master rows with no PLM source ref (2026-07-27)

**Status:** NOT STARTED. Spec only — no branch, no migration, no DB write yet.
**Scope:** one shared-db migration replacing `public.search_style_tracker_link_candidates`,
plus two small canonical data adds. Does not supersede the PSG-3 boundary below.
**Found by:** PopDAM Master Data → "Master Data matching" review queue (`/styles`),
triaged 2026-07-27 against live prod `qsllyeztdwjgirsysgai`.

### Symptom

Values in the review queue show **no candidate at all** even when the correct canonical
row exists and matches the raw string *exactly*. The reviewer's only options become
"Dismiss: Keep In Master Data" or a manual search that also returns nothing — so
correct data gets recorded as unmatchable.

Reproducer, verified in prod:

```sql
-- The canonical row exists, name is an exact case-insensitive match:
select id, name, status from core.licensor where name = 'NASA';
--  dd9d7be2-6f77-4183-8e41-3e57a7a20f8b | NASA | active

-- The matcher returns nothing:
select * from public.search_style_tracker_link_candidates('licensor','NASA',8,'fuzzy');
--  (0 rows)
select count(*) from public.search_style_tracker_link_candidates('licensor','NASA',500,'all')
  where target_label = 'NASA';
--  0            -- 'all' returns 20 unrelated score-0 licensors but never NASA itself
```

44 `License.Style` tracker rows carry licensor `NASA` and were unmatchable because of this.

### Root cause

Two independent defects in `public.search_style_tracker_link_candidates`
(current definition: `select pg_get_functiondef('public.search_style_tracker_link_candidates'::regproc)`).

**(1) The source-ref joins are INNER joins, so they act as a filter on the master table.**

- `customer` branch: `from core.customer c join core.company_source_ref csr on csr.company_id = c.id
  where csr.source_system = 'designflow_plm' and csr.source_table = 'customers'`
- `licensor` branch: `from core.licensor l join core.taxonomy_source_ref tsr on tsr.entity_id = l.id
  where tsr.entity_schema='core' and tsr.entity_table='licensor'
  and tsr.source_system='designflow_plm' and tsr.source_table='merchGroup'`
- `property` branch: same shape as `licensor`.

The joins exist only to surface the PLM `source_name`/`source_code` as extra things to score
against. But because they are INNER joins with a `where` on the joined table, **any canonical row
that was not created by the DesignFlow PLM sync is excluded from the candidate set entirely** —
it can never be matched, at any score, in any `p_match_mode`. `core.licensor.NASA` has no
`core.taxonomy_source_ref` row, which is exactly the reproducer above. The same hole applies to
every hand-added or non-PLM-sourced customer, licensor, and property. Note `p_match_mode='all'`
does **not** rescue these rows: `use_all` only bypasses the `score >= min_score` filter, it does
not touch the join — the fallback in PopDAM's `searchCandidates` therefore returns a page of
unrelated score-0 licensors and still not the right one.

**(2) The dedicated alias tables are never consulted.**

`core.customer_alias` (100 rows) and `core.factory_alias` (8 rows) both exist, both have
`alias` / `normalized_alias` / `alias_type` / `source_system`, and **neither is referenced by the
matcher**. The `factory` branch scores against `f.name` and `f.code` only; the `customer` branch
scores against `c.name` plus the PLM source ref only. So the one mechanism the schema already
provides for "this string means that row" is inert for this feature.

This is why the tracker's vendor column is ~2,240 unmatched rows across 29 values: the sheet
records the **sales rep**, not the factory (`Jerome Chen` 431, `Alice zhu` 379, `Lucy Wang` 304,
`Chloe Huang` 244, `Mr Ying` 141, …). Rep→factory is precisely an alias relationship, and
`core.factory_alias` is where it belongs.

### The fix

One migration under `supabase/migrations/`, `create or replace function
public.search_style_tracker_link_candidates(...)` keeping the exact same signature and
`returns table(target_schema text, target_table text, target_id uuid, target_label text, score real)`
contract — PopDAM calls it as-is from `src/pages/StylesPage.tsx` (`searchCandidates`,
`searchManualCandidates`) and must need no client change.

1. **Convert every source-ref join to a `left join`** and move the `source_system` /
   `source_table` / `entity_*` predicates from the `where` clause **into the join condition**.
   A `where` on a left-joined table silently degrades it back to an inner join — this is the
   trap that must not be reintroduced.
2. **Fold the alias tables into the candidate set**, `left join`ed the same way:
   - `customer` branch → `core.customer_alias ca on ca.customer_id = c.id`
   - `factory` branch → `core.factory_alias fa on fa.factory_id = f.id`
   Score against `ca.alias` / `fa.alias` with the same `greatest(similarity(...), case ... end)`
   ladder already used for `name` / `code` / `source_name`. Keep `target_label` as the **canonical
   name**, never the alias, so the reviewer approves a row they can recognize; if a UI hint is
   wanted later, add it as a separate column in a follow-up rather than mangling `target_label`.
3. **Keep the existing dedupe** — the `row_number() over (partition by target_schema,
   target_table, target_id order by score desc, target_label) ... where rn = 1` block already
   collapses multiple scoring paths for the same row. Adding alias rows multiplies the candidate
   rows per master row, so verify this still yields one row per `target_id` (it is the reason the
   partition exists; do not drop it).
4. **Leave the `sku` branch alone** — it reads `public.style_groups` directly with no join and no
   alias table, and has neither defect.

### Canonical data adds that belong with this change

Owner-confirmed 2026-07-27:

- **`Frida Kahlo`** and **`ZAG Miraculous`** are real licenses that were **not renewed**. They
  should exist in `core.licensor` with `status = 'inactive'` (not absent). 4 and 1 tracker rows
  respectively. Once added, defect (1) must already be fixed or they will still be invisible to
  the matcher — they will have no `taxonomy_source_ref` either.
- **Five rep→factory aliases** for `core.factory_alias`, confirmed correct by the owner. Insert
  with `alias_type = 'other'` (matching the existing 8 rows) and
  `source_system = 'style_tracker'`:

  | alias | factory (`core.factory.name`) |
  |---|---|
  | `Rita Okay Home` | HangZhou Okay Home Products Co., Ltd. |
  | `Henry Newdeco` | NEW DECO ARTS AND CRAFTS CO.,LTD |
  | `Rex EVERICH` | SUZHOU EVERICH CO.,LTD |
  | `King Sofine` | Ningbo Sofine Framing Co.,Ltd. |
  | `King Pharos` | Pharos Artcraft Co., LTD |

  These are worth ~140 tracker rows immediately, and they establish the pattern for the
  remaining rep names (`Jerome Chen`, `Alice zhu`, `Lucy Wang`, `Chloe Huang`, `Mr Ying`,
  `Tom Zhang`, …), which the owner can map in bulk once the matcher actually reads aliases.

- **Open question for the owner — `DCR`.** 17 tracker rows on `License.Style` carry licensor
  `DCR`. No `core.licensor` row matches; the only near hit is `DC` (similarity 0.400). It has not
  been confirmed as either a `DC` alias or a separate lapsed license. **Do not guess.** Ask before
  adding a row or an alias.

### Verification

1. `scripts/check-sql.sh`.
2. Apply to the preview branch `rjyboqwcdzcocqgmsyel` and run there first (§5).
3. Regression — these must all return the canonical row after the fix, and are the exact cases
   that fail today:
   ```sql
   select * from public.search_style_tracker_link_candidates('licensor','NASA',8,'fuzzy');
   select * from public.search_style_tracker_link_candidates('factory','Rita Okay Home',8,'fuzzy');
   select * from public.search_style_tracker_link_candidates('licensor','Frida Kahlo',8,'fuzzy');
   ```
4. No-regression — these already work and must be unchanged in both result and rank order:
   ```sql
   select * from public.search_style_tracker_link_candidates('licensor','One Piece (Toei)',8,'fuzzy'); -- TOEI - ONE PIECE, 1.0
   select * from public.search_style_tracker_link_candidates('licensor','Coca-Cola',8,'fuzzy');        -- COCA COLA, 1.0
   select * from public.search_style_tracker_link_candidates('customer','Burlington, Ross',8,'fuzzy'); -- Burlington, 0.9
   select * from public.search_style_tracker_link_candidates('sku','VSZ93DA',8,'fuzzy');
   ```
5. Confirm one row per `target_id` in every result (the alias join must not duplicate candidates).
6. Exercise the real screen against preview: PopDAM `/styles` → Master Data matching, confirm the
   NASA and rep-name values now offer a candidate and that Approve writes the expected
   `plm.style_tracker_value_resolution` row.

### Context — what was already resolved by hand, so do not re-derive it

On 2026-07-27, 196 review values were resolved directly through
`public.upsert_style_tracker_value_resolution` (service path, so those audit rows have
`changed_by is null`):

- 11 designer values → `core.creative_designer` by unique first name (`Sarbani`→Sarbani Ghosh,
  `James`→James Ashley, `Steve`→Steve Savitsky, `Theo`→Theo Kim, `Tanisha`→Tanisha Shah,
  `Siyuan`, `Érica`→Erica Perestrelo, `Leonard`→Leonard Boone), 3,841 rows.
- 4 licensor values (`Warner Brothers`, `Coca-Cola`, `One Piece (Toei)`, `NASA`), 1,840 rows.
  NASA had to be linked by id because of the defect above.
- 2 factory values (`JieDa Fech Art`, `Dawang`), 34 rows.
- 177 SKUs with an exact, unique `public.style_groups.sku` hit that had never been linked.
- Dismissed into Master Data: `Stallion Wholesale Art` / `Stallion Art Wholesale`, and all
  remaining designer values (retired designers who are intentionally absent from
  `core.creative_designer`).

**Related PopDAM-side observation, not part of this migration:** the designer picker in
`src/pages/StylesPage.tsx` (`fetchDesignerRecords`) filters `status = 'active'`, so retired
designers are offered as candidates nowhere in the UI even when they are the historically correct
answer. That is why the largest designer values had no candidate. It is a PopDAM app change, not
a shared-db one.

---

## FRESH-SESSION BOUNDARY — PopSG Property reconciliation PSG-4 APPROVED

**Date:** 2026-07-28
**Status:** PSG-4 COMPLETE. Stop before PSG-5.
**Database writes / migrations / rebuilds / activation / deployment:** none

**Fresh-session update, 2026-07-29:** Albert explicitly authorized PSG-5 by asking Codex to
spin up a PSG-5 implementation sub-agent. That sub-agent remained `pending_init` and performed
no work. It was stopped when Albert invoked the fresh-session check, so PSG-5 is authorized but
not started. Begin it in one clean session only.

### What this application is

PopSG is POP's internal style-guide library at `https://sg.designflow.app`, served by the
`u2giants/popdam3` application. Its folder-derived Property names are being reconciled to the
shared canonical Property catalogue in `u2giants/shared-db` without fuzzy matches,
cross-Licensor links, or silent tag loss.

### What this session did

This session built the PSG-4 owner decision package for the frozen
`batch-01-exact-existing` evidence. The package adds the missing per-row reason, parent proof,
evidence reviewer, and timestamp without changing the frozen Batch 01 bytes.

GLM 5.2 independently reviewed the complete package in read-only mode and returned `APPROVE`
with zero Critical or High findings. Albert then replied `Approves` to the exact approval or
rejection choice. The durable record is
`docs/verification/popsg-property-reconciliation-20260728-psg4/owner-approval.json`.

### Current state

PSG-4 package SHA-256:
`e4ad02fd19491cef12a9a78204e7fca457c0ebefcc5197099e30cd39a64e0f68`.
Frozen Batch 01 SHA-256:
`f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
The approval covers exactly 51 same-parent `exact_existing` decisions affecting 44,331 active
files. All 51 parent edges pass. No proposal is effective or activated.

The complete package is under
`docs/verification/popsg-property-reconciliation-20260728-psg4/`.
The reproducible generator and test are
`scripts/popsg-property-psg4-decision-package.cjs` and
`scripts/popsg-property-psg4-decision-package.test.cjs`.

The PSG-4 package, test, approval record, GLM review, and completion record were committed as
`896cfa22071e954b1d70c201d6073b6c9117e2a1`, merged through
[`shared-db` PR #302](https://github.com/u2giants/shared-db/pull/302), and reached `main` as
`a1b0c441b4704b9628daf50473afaaca644d82b2`. No database migration, deployment, mapping
activation, rebuild, or ColdLion production action was part of that merge.

### Everything that did not work

1. The package could not reuse the frozen Batch 01 CSV for owner audit fields because changing
   it would break the already-approved source hash. The permanent solution is a separate PSG-4
   decision package bound to the unchanged source hash.
2. GLM 5.2 could not execute the Node test inside its locked review mode. It independently
   checked the hashes and code instead. Codex ran the test separately and it passed.
3. The owner did not repeat the long formal approval sentence. The approval record preserves
   the verbatim `Approves` response and the exact package, source, scope, exclusions, GLM review,
   and preceding approve-or-reject context so the bounded intent is unambiguous.

### Root causes and key findings

- The original PSG-2 proposal rows proved the target parent IDs but did not include PSG-4's
  reviewer and timestamp fields.
- A separate immutable decision package closes that audit gap without changing the frozen source.
- Approval records a business decision only. No backend activation path exists yet.

### Exact next steps

1. Start PSG-5 in one clean session from this handoff and the full reconciliation plan.
   **Pass when:** only one implementing session is active and it has read both files end to end.
2. Re-read the current ColdLion accelerated-cutover status and record its
   checkpoint before any preview work.
   **Pass when:** the dated PSG-5 evidence names the current phase, observation, and gates.
3. Implement only the separately approved preview contracts and rebuild path.
   **Pass when:** preview tests prove exact same-parent behavior, role limits, manual/rejected
   preservation, and zero unexplained tag loss.
4. Do not treat the 6,961-row risk file as approved removal evidence.
   **Pass when:** every removed accepted tag belongs to a separately approved signed subset.
5. Before closing PSG-5, re-read PSG-6 and PSG-7 through plan-end and record any downstream
   drift in the plan and handoff.
   **Pass when:** the PSG-5 completion record explicitly reports the forward-impact audit.
6. Stop before PSG-6 production work.
   **Pass when:** no production change occurs without a named window and separate approval.

### Constraints and gotchas

- PSG-5 preview implementation is authorized as of 2026-07-29. Batch 02, canonical creates,
  6,961 at-risk removals, ambiguous/deferred rows, production changes, and PSG-6 remain
  unapproved.
- CHEERS and THE EXORCIST remain routed to the ColdLion Phase 5 gate.
- `the lion king` remains ambiguous and locked.
- PSG-5 must resolve all eight hard-coded Licensor aliases and refresh the worker baseline.
- PSG-6 must not overlap ColdLion Phase 7.

### Access and environment

No secret was read or created. Neither Supabase project was accessed. Canonical refs remain
preview `rjyboqwcdzcocqgmsyel` and production `qsllyeztdwjgirsysgai`.

### Open questions and risks

- PSG-5 is authorized but has not started.
- The moving ColdLion checkpoint must be re-read at PSG-5 entry.
- No at-risk removal subset has owner approval.

### Self-audit

The handoff self-audit passes. A new developer can identify the application, exact approved
scope, immutable hashes, failed paths, current limits, next gates, environment, and open risks
without prior chat context. Every next step has a verification condition.

The canonical five-question audit passes:

1. **Yes.** The application, repos, URL, session goal, exact approved scope, hashes, local Git
   state, and next actions are in the sections above.
2. **Yes.** The package construction rule, GLM result, frozen-source constraint, approval
   context, exclusions, and downstream gates preserve everything known in this session.
3. **Yes.** All failed paths are recorded with why they failed and the permanent resolution.
4. **Yes.** Every next step is numbered and has a concrete pass condition.
5. **Yes.** Every phase, hash, path, URL, database ref, and approval boundary needed next is
   defined or linked.

The three final synthesis checks also pass:

1. **Yes.** A brand-new developer can continue without prior project or chat knowledge.
2. **Yes.** They can continue as effectively as this session because the complete evidence,
   decisions, limits, current local state, and future gates are preserved.
3. **Yes.** Background, goal, outcome, current state, failed attempts, decisions, constraints,
   risks, next actions, and verification evidence are present.

---

## PRIOR FRESH-SESSION BOUNDARY — PopSG Property reconciliation PSG-3 UI SHELL

**Date:** 2026-07-27
**Status:** PSG-3 pending-only UI shell deployed and healthy; stop before PSG-4
**Shared-db remote:** `main` contains the verified closeout through direct GitHub commit
`a4a99fa266ea6ea6ba070b3a67bf762d35bdb3b7`
**Shared-db local checkout:** `C:\repos\shared-db` still has stale read-only Git metadata at
`78d0130` and therefore reports the three closeout files as modified even though their clean
bytes match remote; this restricted session could not create `.git/index.lock`
**PopDAM checkout:** `C:\repos\popdam3`, `main`, clean at `b4bf454b`
**Database writes / migrations / rebuilds / activation:** none

### What this work is

PopSG is POP's internal licensor style-guide library. Folder-derived Licensor and Property names
currently drive deterministic tags. This workstream reconciles those observed names to canonical
master data without cross-Licensor matches or silent tag loss. PSG-3 is the administrator review
screen only. PSG-5 owns future database contracts and preview rebuild behavior.

### Exact owner approval

Albert approved only `batch-01-exact-existing`, 51 rows covering 44,331 files, SHA-256
`f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
The immutable record is
`docs/verification/popsg-property-reconciliation-20260727-psg3/approval.json`.

This approval does not cover batch 02, canonical creates, the 6,961 at-risk removals, schema or
mapping activation, database writes, migrations, rebuilds, deployment, production, PSG-4, or any
later phase.

### Current state

PopDAM has the frozen 372-row / 216,417-file pending-only UI shell at Settings → File Tags →
Property reconciliation. It shows five separate business queues, filters, bounded redacted
path evidence, canonical candidate/parent proof, exact owner hash and exclusions, affected-file
preview, and a stable pending-decision export. Administrator preparation is restricted to
same-parent exact-existing rows in the approved batch. Viewer/designer cannot prepare or export.
All proposals stay in browser memory and disappear on refresh or role downgrade. No activate
action or backend adapter exists.

Verification passed: 19 focused tests, all 93 PopDAM tests, production build, seven
headed-Chromium screenshots, and zero browser console errors. The screenshots and complete
evidence are under `docs/verification/popsg-property-reconciliation-20260727-psg3/`.

Albert approved the pending-only UI deployment after the evidence PR merged. PopDAM commits are:

- `e72ec107`: PSG-3 pending-only UI shell;
- `8d8ce361`: direct `@testing-library/dom` test dependency;
- `b4bf454b`: Bun 1.3.14 lockfile regeneration.

CI run `30263977784` passed. Final publish/deploy run `30264180552` passed from
`b4bf454bd7d660dcc375001549324f418667663d`. The running Coolify container was healthy and used
image digest `sha256:a850c64f3a5ead1c26f5a20b405e1bb22697507516e333c10b628b26721a6684`,
which exactly matched the published GHCR `latest` digest. Both `https://dam.designflow.app` and
`https://sg.designflow.app` returned HTTP 200.

Two Grok reviews required corrections. The final Grok follow-up returned PASS with no Critical,
High, or Medium findings.

### Failed paths that must not be repeated

1. Windows CRLF made raw PSG-0/1 hashes look wrong. Canonical LF bytes match every signed manifest.
2. A no-write scan over the data fixture matched ordinary text. Scan executable source only.
3. The dev role switcher initially retained administrator memory after switching to designer.
   Pending memory now clears on downgrade and export disables.
4. The first create screenshot retained a search filter. The final screenshot shows both locked
   ColdLion Phase 5 candidates.
5. The first Grok review found overclaimed phase status, a dead ambiguity filter, unsafe
   mixed-Licensor export, incomplete signed-key enforcement, thin security tests, and hidden rows.
   The code now fails closed, derives the signed key set, tests the boundaries, and exposes all
   rows through paging.
6. The second Grok review found a stale prepare-dialog screenshot plus three hardening gaps.
   The screenshot now starts empty on Winnie the Pooh / 6,887 files; synthetic off-key rows fail
   closed; parent proof text is conditional; and a started set immediately locks other Licensors.
7. The first GitHub CI run failed because npm had supplied `@testing-library/dom` indirectly but
   Bun's frozen install did not. Declaring it directly fixed dependency ownership.
8. Hand-editing only the Bun root dependency was insufficient. Bun rejected the missing package
   record. Regenerating `bun.lock` with the same Bun 1.3.14 used by CI fixed the lock permanently.

### Exact next steps

1. In a normal-authority session, reconcile the stale local shared-db Git metadata with remote
   `main` after confirming the three local file bytes match GitHub. Do not discard unrelated work.
   **Pass when:** `C:\repos\shared-db` is clean at the remote closeout head.
2. Obtain Albert's explicit instruction to start PSG-4.
   **Pass when:** the current chat says to start PSG-4.
3. Execute PSG-4 as decision-package work only: preserve the frozen proposal hash, add reviewer
   and timestamp evidence, and keep canonical creates at zero unless separately named.
   **Pass when:** every proposed approved row has disposition, reason, parent evidence, reviewer,
   and timestamp, with no changed proposal bytes.
4. Do not activate mappings or write either database in PSG-4. Database contracts, RLS, RPCs,
   persistence, and preview rebuild proof remain PSG-5 work under separate authority.
   **Pass when:** PSG-4 produces no migration, database write, rebuild, or deployment.
5. Stop at PSG-4's exact-hash owner decision gate.
   **Pass when:** Albert receives one business-readable package and no later phase has started.

### Constraints and moving state

- The accelerated ColdLion plan still shows Steps 1–10 open. Production Phase 7 is forbidden.
- CHEERS and THE EXORCIST remain locked and routed to ColdLion Phase 5.
- `the lion king` remains ambiguous and locked.
- The 6,961-row signed risk file remains evidence only.
- PSG-5 must decide all eight hard-coded Licensor aliases and take a fresh worker behavior baseline.
- PSG-6 still needs the moving ColdLion checkpoint, Albert sign-off, and a named production window.
- ColdLion Phase 6 does not block PSG-4 decision-package work. It blocks later preview/production
  cutover gates.
- The PSG-3 plan text names RLS/RPC/preview proof in its full gate, while PSG-5 owns those objects.
  Treat that proof as a PSG-5 entry/exit obligation, not permission to add backend work to PSG-4.

### Access and environment

No new secret value was encountered. GitHub and Coolify used their existing stored credentials.
Canonical database refs remain preview `rjyboqwcdzcocqgmsyel` and production
`qsllyeztdwjgirsysgai`; PSG-3 did not connect to either.

### Self-audit

The fresh-developer handoff audit passes:

1. A newcomer can continue with no questions because this section records the application,
   approval, deployed commits, CI/deploy evidence, current gate, and exact next action.
2. A newcomer can continue as effectively as this session because the frozen hashes, role and
   activation limits, ColdLion boundary, and every PSG-4 verification condition are explicit.
3. Failed attempts are preserved with causes and permanent fixes, including both Grok correction
   rounds and the two Bun/CI dependency failures.
4. Every next step is concrete and has a pass condition.
5. Every path, URL, phase boundary, commit, run, and digest needed to resume is named.

---

## FRESH-SESSION BOUNDARY — PopSG Property reconciliation PSG-2 AT OWNER GATE

### 1. What this application is

PopSG is the style-guide library at `https://sg.designflow.app`, served by
`u2giants/popdam3`. NAS crawlers record folder-derived Licensor and Property observations in the
shared Supabase production project. `u2giants/shared-db` owns the canonical Licensor and Property
catalogue used by PopSG and every other POP application.

### 2. What this session set out to do, and why

The session executed PSG-2 only from
[`fix_popsg_property_taxonomy_reconciliation.md`](fix_popsg_property_taxonomy_reconciliation.md).
It had to turn every signed PSG-1 observation into one deterministic proposal, preserve the
6,961-row at-risk set unchanged, prove parent scoping and strict rule order, prepare an immutable
owner decision package, and stop before schema, UI, activation, or PSG-3.

### 3. Current state

The corrected proposal package passed its second Grok review with no Critical, High, or Medium
findings. PSG-2 remains draft and incomplete at Albert's exact-hash gate:

[`docs/verification/popsg-property-reconciliation-20260727-psg2/`](docs/verification/popsg-property-reconciliation-20260727-psg2/README.md)

- All eight PSG-1 artifact Git blobs match their signed manifest.
- The immutable at-risk input remains 6,961 rows with SHA-256
  `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
- Every one of 372 inventory rows has exactly one proposed disposition.
- All 216,417 active file occurrences are represented exactly once.
- Proposed rows/files are: exact existing 51/44,331; non-Property 36/20,309; create candidate
  2/293; ambiguous 43/33,416; deferred 239/118,067; Licensor unresolved 1/1.
- Approved-alias, Disney Classics, and documented no-code exact proposals are each zero.
- There are zero cross-parent proposals, fuzzy-selected targets, unresolved-Licensor Property
  proposals, and activated/effective decisions.
- Every proposal requires owner activation. Automatic classification is recorded separately.
- Every existing target is checked against authoritative parent edges and includes canonical code
  and parent ID. Missing or wrong parent/name/code proof fails closed.
- Proposal ledger SHA-256:
  `cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4`.
- Owner batch-index SHA-256:
  `78afa12f5edf4ac56f00d8fad592b6c6c2bcb128730ed5c837ad29270931976d`.
- Recommended first bounded decision:
  `batch-01-exact-existing`, 51 rows / 44,331 files, SHA-256
  `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
- The owner index includes non-approvable `batch-06-at-risk-observation`, which points to the
  immutable 6,961-row PSG-1 risk file and signed hash. It cannot approve removals.
- Two proposed create candidates, `CHEERS` / `CHR` and `THE EXORCIST` / `EX`, are exact
  overlaps with the existing ColdLion Phase 5 ledger. No create is approved.
- `the lion king` affects 521 files but remains open because the approved owner-list text is
  `lion king`; it also has multiple same-parent reviewer candidates, so it is `ambiguous`.
- ColdLion Phase 6 remains IN PROGRESS on preview. Accelerated readiness Steps 1–10 remain open.
- PSG-1's PopDAM worker hash used raw CRLF working-tree bytes:
  `1fe0f7214cabf15bd0cd5035c95897d40f18c8990172fa394bfb654c796f2ce3`.
  The current canonical LF hash is
  `76579ecba08ae1a5207bbe2f2d3a4e23a8979ad050ceb69cff11dba29c75d255`;
  reconstructed CRLF reproduces PSG-1 exactly, so no behavior drift is present.
- PSG-2 made no database query/write, migration, rebuild, deployment, canonical creation,
  proposal activation, fuzzy automatic mapping, or PopDAM UI/code change.

### 4. Everything tried that did not work

- Direct working-tree hashes failed because Git checked text files out with Windows CRLF endings.
  The exact Git blobs matched every PSG-1 hash. The final engine canonicalizes CRLF to LF before
  verifying immutable inputs.
- The first summary inferred at-risk removals from an inventory aggregate and got 7,182 instead
  of 6,961. That aggregate includes accepted relationships beyond the signed removal set. The
  final engine counts rows in the immutable at-risk CSV.
- The first deterministic rerun test used the wrong in-memory shape. The corrected test reruns
  the generator from the signed files and compares output bytes.
- The first Grok review found that parent safety was asserted as a constant, create candidates
  accepted bare codes, the copied normalizer changed ampersand behavior, activation authority was
  unclear, and fixture/hash coverage was too weak. All are corrected in the current draft.
- After PR #256 merged, a clean Windows checkout exposed a test-only CRLF mismatch: the source
  comparison normalized PSG-1 but not the loaded normalizer. The follow-up canonicalizes both
  strings. Proposal rows, owner batches, and their frozen hashes did not change.

### 5. Root causes and key findings

- Same-parent deterministic evidence settles only 51 rows. Similarity hints cannot settle the
  remaining observations.
- The strict approved Classics list produces no exact proposal. Owner review must decide whether
  `the lion king` is the same approved title as `lion king`; code must not assume it.
- Fifteen blank Property observations are explicit non-Property candidates rather than silent
  gaps. Twenty-one more rows came from PSG-1 structural-pattern evidence.
- The two PopSG create candidates already exist in ColdLion's Phase 5 candidate set. A separate
  PopSG create ledger would duplicate authority and violate the plan.
- Phase 5 create candidates now match exact normalized names only. Codes are metadata.
- None of the 6,961 at-risk removals is approved. The signed file remains risk evidence only.
- The eight hard-coded Licensor aliases remain unresolved future authority work for PSG-5.
- PSG-5 must take a new worker behavior baseline if the canonical content hash changes.

### 6. Exact next steps

1. Present the exact owner batch index to Albert.
   **Pass when:** he names an exact batch ID and SHA-256 and explicitly approves or rejects it.
2. Recommended first decision: review `batch-01-exact-existing.csv`.
   **Pass when:** Albert accepts or rejects SHA-256
   `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
3. Keep `batch-02-non-property` separate because it needs business review.
   **Pass when:** each approved row is covered by an unchanged human-approved hash.
4. Route `batch-03-create-candidates` through ColdLion Phase 5 only.
   **Pass when:** no second ledger exists and no create occurs without separate owner approval
   plus an approved parent.
5. Do not start PSG-3 until the plan's owner gate passes.
   **Pass when:** approval is durable and bound to an unchanged batch hash.

### 7. Constraints and gotchas

No proposal activation, schema, migration, canonical creation, preview/production write, rebuild,
deployment, fuzzy automatic mapping, or PopDAM UI change is authorized. Do not treat
`batch-04-open-review` as mappings. Do not approve mixed dispositions in one bulk action. PSG-5
still needs the Licensor-alias decisions. PSG-6 cannot overlap ColdLion Phase 7.

### 8. Access and environment

Shared-db branch: `codex/popsg-property-psg2-20260727`. Phase-start shared-db base:
`f530c424b00ddd91eef4c0f8d172eeb451551f82`. PopDAM main was clean and fast-forwarded to
`c8ce9624`; PSG-2 changed no PopDAM source. Production ref: `qsllyeztdwjgirsysgai`. Preview ref:
`rjyboqwcdzcocqgmsyel`. No secret was read, printed, or committed.

### 9. Open questions and risks

Albert has not approved any PSG-2 batch. The most important open title is `the lion king`
(521 files). The 36 non-Property candidates need business confirmation. Cheers and The Exorcist
need the existing ColdLion Phase 5 create/parent decision if they are ever to become canonical.
ColdLion accelerated readiness remains a moving parallel workstream and must be rechecked before
every later PSG phase.

### PSG-3 through PSG-7 forward-impact audit

- PSG-3 must show the five immutable queues separately, route create candidates to Phase 5, and
  keep `the lion king` ambiguous. It must separate automatic classification from owner activation.
- PSG-4 must approve exact unchanged hashes.
- PSG-5 has no approved at-risk removal subset, must keep batch-06 non-approvable, and still owns
  all eight Licensor aliases. It must rebaseline if PopDAM worker behavior changes.
- PSG-6 remains blocked by ColdLion checkpoint/sign-off and a production window.
- PSG-7 must report zero alias/Classics/no-code proposal categories honestly.
- No other later-phase assumption, sequence, rollback, or production boundary drifted.

### Handoff self-audit

Passed after the second Grok review on 2026-07-27. Residual notes are non-blocking owner/phase
gates, not code findings. A developer with no chat context can identify the application, goal,
signed inputs, exact proposal state, failed attempts, root findings, owner gate, constraints,
access boundary, downstream impact, and next verifiable action.

## Prior boundary — PopSG Property reconciliation PSG-1 COMPLETE

### 1. What this application is

PopSG is the style-guide library at `https://sg.designflow.app`, served by the PopDAM codebase
`u2giants/popdam3`. NAS crawlers record folder-derived Licensor and Property observations in the
shared Supabase production project. `u2giants/shared-db` owns the canonical Licensor and Property
catalogue used by PopSG and every other POP application.

### 2. What this session set out to do, and why

Albert asked for PSG-1 evidence work only from
[`fix_popsg_property_taxonomy_reconciliation.md`](fix_popsg_property_taxonomy_reconciliation.md).
The goal was to build a reproducible read-only inventory, balance every active file in the
required 2×2 matrix, enumerate the accepted tags threatened by safe parent scoping, measure the
eight Licensor aliases, and stop before proposals or implementation.

### 3. Current state

PSG-1 is complete. The authoritative package is
[`docs/verification/popsg-property-reconciliation-20260727-psg1/`](docs/verification/popsg-property-reconciliation-20260727-psg1/README.md).

- Production still has 216,417 active files. The count did not drift from PSG-0.
- The 2×2 current-behavior matrix balances exactly to all 216,417 active files.
- Cells are 50,927 resolved/resolved, 165,489 resolved/unresolved, 0 unresolved/resolved, and
  1 unresolved/unresolved.
- The inventory has 372 normalized rows. One row has an unresolved Licensor and no candidates.
- Parent-scoped exact name/code matching safely resolves 44,331 file occurrences in 51 rows.
- `currently-tagged-at-risk.csv` contains all 6,961 accepted global exact-name relationships
  that parent scoping would remove. All are cross-parent matches.
- The signed at-risk SHA-256 is
  `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
- All eight Licensor alias counts reproduce PSG-0. None contributes an at-risk relationship.
- The extractor has a unit test and exports no full path or filename.
- `source-hashes.json` verifies every PSG-1 output plus the extractor, test, normalizer, and
  PopDAM worker source.
- ColdLion Phase 6 remains IN PROGRESS on preview. The latest non-drill comparison passed.
  Forced-failure drill rows are correctly marked. Production remains untouched by Phase 6.
- PSG-1 changed no PopDAM file and caused zero database writes.

### 4. Everything tried that did not work

- The first preview secret reference used the long item title. Parentheses made that reference
  fail parsing. The final run used the stable 1Password item ID and printed no secret.
- The first preview query assumed parent columns on `plm.erp_property`. ColdLion does not supply
  the parent relationship, so those columns do not exist. The final extractor uses only an
  already-linked canonical Property to obtain parent evidence.
- The first status query used friendly field names instead of the real Phase 6 column names.
  The final query uses `pass`, `unexplained_diff_count`, `finished_at`, and `metadata.mode`.
- Each failed database attempt was inside a read-only transaction and ended without a write.

### 5. Root causes and key findings

- Current Property matching is global and name-only. It resolves 50,927 file occurrences.
- Safe parent-scoped name/code matching resolves 44,331 occurrences. The difference is explained
  by the signed 6,961 accepted cross-parent relationships plus code/name behavior details.
- The only unresolved Licensor observation is a one-file `seafile-ignore.txt` structural row
  with a blank Property. It is excluded from all candidate evidence and proposals.
- The eight hard-coded aliases resolve 62,941 active files and remain business authority until
  Albert reviews them.
- **Migration counts — corrected 2026-07-31.** The repo has **383** migration files
  (`ls supabase/migrations | wc -l` on `main`, 2026-07-31). The figure of 336 previously written
  here was a snapshot from the PSG-1 session and had gone stale by 47 files. The production
  ledger count of **318 is UNVERIFIED** — that number was last claimed during PSG-1 (on or about
  2026-07-27) and has **not** been re-checked since; re-checking it requires production database
  access, which the correcting session deliberately did not use. Treat 318 as historical, not
  current. There were no duplicate 14-digit versions as of the last check. PSG-1 added no
  migration.
- Preview Phase 6 remains at 44 ColdLion Licensors and 516 ColdLion Properties.

### 6. Exact next steps

1. Start PSG-2 only in a fresh session after Albert asks for it.
   **Pass when:** the new session reads all authorities and the PSG-1 README.
2. Verify every PSG-1 artifact against `source-hashes.json`.
   **Pass when:** all eight artifact hashes and four source-file hashes match.
3. Recheck Git, PRs, migration versions, and the moving ColdLion Phase 6 header.
   **Pass when:** any dated change is recorded before proposals are built.
4. Treat `currently-tagged-at-risk.csv` as immutable input.
   **Pass when:** its SHA-256 remains
   `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
5. Build PSG-2 proposals in the strict plan order without activating anything.
   **Pass when:** unresolved Licensors have zero proposals and every resolved tuple has one
   proposed disposition.

### 7. Constraints and gotchas

No proposal activation, fuzzy automatic mapping, canonical creation, preview/production write,
migration, rebuild, deployment, or PopDAM UI change occurred or is authorized by PSG-1.
Shared-token candidate rows are review evidence only. Unresolved Licensors are never valid
Property tuples. PSG-5 needs a fresh ColdLion checkpoint and Albert's sign-off. PSG-6 cannot
overlap ColdLion Phase 7.

### 8. Access and environment

Shared-db branch: `codex/popsg-property-psg1-20260727`. PopDAM remained clean on `main`.
Production ref: `qsllyeztdwjgirsysgai`. Preview ref: `rjyboqwcdzcocqgmsyel`. Credentials are in
1Password vault `vibe_coding`; no value was printed or committed. Production and preview reads
used PostgreSQL-enforced `REPEATABLE READ READ ONLY` transactions and ended with rollback.
The `pg@8.16.3` package was installed only in the Windows temp folder
`C:\Users\ahazan2\AppData\Local\Temp\codex-psg1-pg`.

### 9. Open questions and risks

Albert has not approved any alias disposition, mapping, create candidate, schema, tag removal,
or rebuild. The 6,961-row signed delta is risk evidence, not approval. Shared-token candidates
are not safe matches. ColdLion accelerated readiness remains a moving parallel workstream and
must be rechecked before every later PSG phase.

### Handoff self-audit

Passed on 2026-07-27. A fresh developer can identify the applications, purpose, exact state,
failed attempts, findings, constraints, access path, risks, and executable PSG-2 entry gates
without chat history.

## CURRENT PRIORITY — ColdLion Licensor/Property accelerated readiness IN PROGRESS

**PLANNING UPDATE — 2026-07-26:** Albert rejected the 14-day elapsed-time wait because ColdLion
Licensor/Property data changes slowly and ColdLion is the canonical ERP source. The implementation
plan to replace that gate with deterministic readiness proof, an explicit production window,
fail-closed monitoring, operational rollback, and a 24-hour intensified watch is
[`plan_coldlion_licensor_property_accelerated_cutover.md`](plan_coldlion_licensor_property_accelerated_cutover.md).
Read its STATUS table first. This is a plan, not production authorization: until its preview
rehearsal and readiness steps are implemented, the current production prohibition remains in
force. Application verification must reflect reality: DesignFlow PLM is fully live, DAM is
partially live, and CRM/PM are in development.

**Phase 6A machinery and GitHub workflow proof are COMPLETE on preview
`rjyboqwcdzcocqgmsyel`. Production `qsllyeztdwjgirsysgai` remains untouched.** Migration
`20260726180000` is applied (do not edit). Parser fix PR **#233** /
`18ab164ce503ba875413a7d4573597032c56be81`. GHA lanes proven (DesignFlow
`30203333356`, ColdLion `30203361246`, green compare `30203975505` / observation
`16373e68-…`, green health `30204001916`, force-fail compare `30204031010` exit 1, force-fail
health `30204054859` exit 1). Pre-fix compare `30203386465` retained as caught parser
failure (DB observation `bf9e8daf-…` was green). Secrets `COLDLION_API_KEY` /
`DESIGNFLOW_API_KEY` set; **`PHASE6_SCHEDULE_ENABLED=true` since 2026-07-26T13:27:41Z** —
preview schedules **ACTIVE**.

**Historical gate retired 2026-07-26:** the earlier 14-day / 2026-08-09 waiting rule is no longer
an active exit condition. Its scheduled/manual successes, failures, drills, and append-only
observations remain evidence.

**2026-07-27 — PREVIEW READINESS GATES ARE NOW PROVEN.** The readiness command
`node tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs --apply --linked` returns
**`ready=true`** on preview. All **542** approved mappings were re-resolved **row by row** by full
typed source identity to the exact approved canonical UUIDs (271 distinct) — missing, extra,
duplicate, changed, cross-typed, link-mismatched, and canonical-missing counts are **all zero**,
and the mapping hash `1230f5a12d0f2a3029f1d3df17fc5b5f` was recomputed independently in SQL.
Counts alone can never pass: `row_counts_without_identity_proof_never_pass` is an explicit tested rule.

A fail-closed **circuit breaker** now stops unsafe ColdLion canonical changes at the trigger level
(`core.taxonomy_source_ref` ColdLion rows; `plm.erp_licensor`/`plm.erp_property` link changes), with
an append-only `plm.taxonomy_circuit_breaker_event` log. The 2026-07-27 preview drill tripped it,
watched a **real** promotion attempt fail (`run-coldlion-licensor-property-phase4.mjs` exit 1; failed
run `15c0b900-…` retained), refused an unauthorized reset, then rehearsed the authorized operational
rollback and proved recovery (`5676f13a-…`, **542 unchanged, 0 changed**). Every protected hash —
canonical UUIDs, status, Property-to-Licensor parents, approved source links — was byte-identical
before, during, and after. New migrations `20260727221500`, `20260727223000`, `20260727224500` are
applied to preview; **never edit them**.

Alert delivery: the plan named an "existing Codex heartbeat task" — **it does not exist in this
repo**. `.github/workflows/coldlion-licensor-property-alert-monitor.yml` (cron `*/10`, gated by
`COLDLION_ALERT_MONITOR_ENABLED`, default off) was built as the smallest durable path: it opens a
GitHub issue naming **Albert Hazan** as human response owner and fails red. **Measured on
2026-07-27:** alert `821d2c5b-…` fired 22:30:00Z, delivered to issue **#279** at 22:41:27Z by run
**30311589271** — **11m27s, inside the 15-minute target**. Alert acknowledged (never deleted),
breaker reset, readiness back to `ready=true`.

**Not yet proven (do not claim it):** that run was a `workflow_dispatch`. GitHub had fired **no
`schedule` run** of the new monitor as of 23:09Z, so the delivery *mechanism* is proven but the
*unattended cadence* is not. Check with `gh run list --repo u2giants/shared-db --workflow
coldlion-licensor-property-alert-monitor.yml --json event,createdAt` and record the observed
interval in evidence §4.7.6.

**2026-07-28 — CORRECTION, THEN HARDENING. Read this before trusting anything above.**
The 2026-07-27 claim that the breaker "blocks unsafe changes whether or not a human hears about
it" was **WRONG**. Nothing tripped it. Every trip was a person calling the function by hand,
including the 2026-07-27 drill, which tripped it *first* and then watched a promotion fail — so
the refusal was proven but the **arming never was**. In steady state the lane was **open**.
Caught by an independent GLM 5.2 review Albert commissioned, then confirmed in the code.

Migration **`20260728134500`** makes the claim true: the breaker now **trips itself** off the
detection path, in the same transaction that detects the failure. Proven on preview — a real
forced health failure auto-tripped it (`tripped_by: auto-trip`), which then refused a real
promotion (**exit 1**), refused a `DELETE` of an approved link, and refused a direct disarm;
every protected hash stayed identical, and the authorized rollback restored service (**542
unchanged**). Also added: `DELETE`/linked-`INSERT` gap closure, anti-disarm (a direct
`update ... state='closed'` is refused), and a **9-trigger enforcement watchdog** that blocks
readiness if any guard is dropped or disabled — a "closed" breaker on an unguarded database
otherwise looks perfectly safe. Alerts are now sent by the **detecting run itself** (seconds)
rather than the `*/10` cron GitHub throttled to **57–201 minute** gaps; health detection moved
to hourly. Readiness: **`ready=true`**, 8 checks. **129** offline tests green.

**Production was READ, read-only, with Albert's explicit authorization (2026-07-28).**
354 applied, 10 pending, **zero ledger corruption**. The bounded manifest is **9 ColdLion
migrations**, deliberately excluding `20260727230000` (another workstream) — never
`--include-all`. A read-only **542-row identity pre-proof against production** returned
**0 missing, 0 cross-typed, 0 code mismatch, 0 existing ColdLion refs**, with production's
canonical baseline identical to preview. **Nothing was written**, and the detached worktree used
for it was removed.

**2026-07-28 — STEPS 6 AND 7 ARE COMPLETE. The next gate is Albert's approval.**

Step 6, at the accuracy the evidence supports: **DB Data Admin is verified** as a real
signed-in user against preview (`data-dev.designflow.app` runs on preview) — tree of 26
licensors / 256 properties, filters work, every property shows its parent, **0** duplicates and
**0** cross-entity rows. ColdLion and DesignFlow provenance appear **side by side** (MARVEL
carries both ColdLion divisions and its DesignFlow refs), which is the parallel run working end
to end. **DAM's live subset is verified at the data-contract level** (0 orphans, 0
asset-vs-parent mismatches) and its **screens were deliberately not driven** — per `AGENTS.md`
§0.4 the Master Data grid is writable by any signed-in user and PopDAM has no read-only role,
so a tester login is not a safe read-only instrument. **DesignFlow PLM, CRM and PM hold zero
rows on preview**, so they were **not exercised**; that is recorded as untested, **not** as
passed, and their 40 foreign keys and `api.*` contracts are proven intact. The live PLM smoke
belongs in the Step 9 read-only production window.

Two traps worth keeping: the DB Data Admin functions are **role-gated** (calling them from the
CLI fails `42501` — a real JWT is required, which is correct), and their signature is
`(p_search, p_include_inactive, p_cursor, p_page_size)` returning a **jsonb envelope**, not a
row set. Also, the inactive-visibility rule could **not** be exercised — there are 21 active +
5 potential and **zero inactive** licensors, so there was nothing to hide.

Step 7 is written in full:
[`docs/verification/coldlion-licensor-property-step7-production-package-20260728/README.md`](docs/verification/coldlion-licensor-property-step7-production-package-20260728/README.md)
— bounded **9-migration** manifest (plus the 2026-07-28 hardening, which should go with it,
since without it the breaker exists but nothing arms it), every command naming
`qsllyeztdwjgirsysgai`, pre/post hash captures, the production secret **named but not created**,
a read-only smoke checklist by real maturity, and an operational rollback that drops no schema
and deletes no canonical row.

**Exact next action: Step 8 — put the production-window approval request to Albert**, naming the
exact project, migrations, data modes, secret action, window, monitoring, and rollback.
**Production writes remain prohibited. Do not execute Phase 7 without that named approval** —
a general "go ahead" does not count.

Full evidence: `docs/verification/coldlion-licensor-property-phase6-20260726/README.md`
**§4.7** (readiness/identity/breaker), **§4.8** (correction + auto-trip hardening), **§4A**
(Step 6 contracts and the Step 7 production inventory).

Authoritative Phase 6 handoff + evidence:
[`fix_coldlion_licensor_property_phase6_handoff.md`](fix_coldlion_licensor_property_phase6_handoff.md)
and
[`docs/verification/coldlion-licensor-property-phase6-20260726/`](docs/verification/coldlion-licensor-property-phase6-20260726/README.md).

Prior Phase 4 detail:
[`fix_coldlion_licensor_property_phase4_handoff.md`](fix_coldlion_licensor_property_phase4_handoff.md)
and
[`docs/verification/coldlion-licensor-property-phase4-20260725/`](docs/verification/coldlion-licensor-property-phase4-20260725/README.md).

Before writing code, the new agent must read, in order:

1. [`AGENTS.md`](AGENTS.md), especially §§6.1, 8.1, and the shared-db protocol.
2. [`fix_coldlion_licensor_property_phase4_handoff.md`](fix_coldlion_licensor_property_phase4_handoff.md)
   for the completed Phase 4 implementation, preview evidence, failures, and Phase 5/6 gates.
3. [`fix_coldlion_licensor_property_phase1_handoff.md`](fix_coldlion_licensor_property_phase1_handoff.md)
   for the exact shipped state, failures, evidence, access path, and next gates.
4. [`fix_coldlion_licensor_property_cutover.md`](fix_coldlion_licensor_property_cutover.md)
   **in full, including every phase after Phase 2**. Its session protocol and
   forward-impact audit are mandatory.
5. [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md)
   for division/type semantics, lifecycle behavior, and known defects.
6. [`docs/coldlion-erp-api-reference.md`](docs/coldlion-erp-api-reference.md)
   for endpoint, paging, response-shape, and Windows/1Password behavior.
7. [`docs/coldlion-direct-sync-and-taxonomy-plan.md`](docs/coldlion-direct-sync-and-taxonomy-plan.md)
   and [`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md)
   to prevent duplicate syncs or conflicts with item/taxonomy work.
8. [`docs/style-guides-characters-and-royalties.md`](docs/style-guides-characters-and-royalties.md)
   before changing anything involving style guides, characters, likeness, or royalties.

Phase 2 and its preview comparison should be separate fresh sessions. Phase 3
and every later phase also get separate fresh sessions unless a phase document
explicitly proves the work is small and inseparable. Every implementing session
must reread all later phases before coding, then update the plan and handoff if
its implementation or discoveries change a later phase's assumptions, schema,
tests, gates, rollback, or sequencing.

The residual Phase 0 baseline is complete under
[`docs/verification/coldlion-licensor-property-phase0-20260724/`](docs/verification/coldlion-licensor-property-phase0-20260724/).
It contains the per-division inventory, all 505 source references, all 256 parent edges,
the complete unmatched/ambiguous ledger, and the consumer dependency graph.

Authoritative current evidence:

- Implementation PR [#208](https://github.com/u2giants/shared-db/pull/208),
  merge `eda80e7e6fd420e53394dc2947c07d45fbadd44a`.
- Migration `20260724030000` applied to preview `rjyboqwcdzcocqgmsyel`
  and production `qsllyeztdwjgirsysgai`.
- Preview Phase 2A migrations `20260724060000` and `20260724061000` are applied.
- Phase 2B runs `a7eb9c1b-3868-46bc-8d9a-615c0b8c98e4` and
  `8a18acf5-0ce6-4be1-a522-85ba5478be43` share snapshot hash
  `a69332e05d9064723ffa1dfbd870506c`.
- Preview mirrors now contain 44 Licensor and 516 Property rows; run 2 reported all 560
  unchanged.
- 256 canonical Properties; 0 null Licensor parents; scalar FK is `NOT NULL`
  and `ON DELETE RESTRICT`.
- Canonical UUID/status/parent and all 505 source-reference hashes are unchanged; there are
  0 ColdLion source refs, 0 mirror canonical links, and 0 schedules.
- Corrected proof run `7fa7925a-4307-435d-ab3c-fcf99fa9a659` records
  `metadata.prior_run` as 44/516; the parser defect is resolved.
- Full evidence:
  [`docs/verification/coldlion-licensor-property-phase2b-20260724/README.md`](docs/verification/coldlion-licensor-property-phase2b-20260724/README.md).
- DesignFlow remains enabled.

Older workstreams below are retained as historical context. If they contradict
this section or the two dedicated ColdLion files above, this section and those
dedicated files win.

### Current-priority handoff completeness audit

After rereading the root routing section, dedicated handoff, full cutover plan,
Phase 1 migration/contracts, and the related architecture/API routers:

1. **Can a brand-new agent start Phase 2 without this conversation? Yes.** The
   required reading order above routes to the exact shipped state, environment,
   authority split, failures, implementation spec, and future phases.
2. **Can it continue as effectively as the current session? Yes.** The dedicated
   handoff preserves PR/merge/migration evidence, preview/production results,
   named risks, access path, failed attempts, and verified commands. The plan
   supplies Phase 2A/2B entry and exit gates.
3. **Is every relevant detail for flawless continuation present? Yes.** The plan
   explicitly assigns the residual Phase 0 baseline, future-phase impact,
   tests, rollback, production approval, DesignFlow coexistence, cross-app
   smoke tests, and Phases 3–8. Stale sections below are explicitly subordinate
   to this router.

## Active workstream — Characters and style guides → canonical (2026-07-26)

**Separate workstream from ColdLion Phase 6 above. Not blocked by it, but see sequencing.**

`core.character` is **0 rows**; characters and style guides exist only in legacy copies
(`dflow.properties_and_characters` 10,122; `public.characters` 9,622;
`public.style_guide_files` 279,783). Model, rules and a phased plan are merged; **no schema
change written, no database modified.**

- **Plan (Phases 0–7):** [`fix_characters_style_guides.md`](fix_characters_style_guides.md)
- **Handoff:** [`fix_characters_style_guides_handoff.md`](fix_characters_style_guides_handoff.md)
- **Model (read before touching anything):** [`docs/style-guides-characters-and-royalties.md`](docs/style-guides-characters-and-royalties.md)
- **Licensing-team review sheet + regenerator:** [`docs/verification/style-guide-property-mapping-20260726/`](docs/verification/style-guide-property-mapping-20260726/README.md)
- **Disney's OWN property→character list, captured from the OPA portal (2026-08-06):** [`docs/verification/opa-characters-20260806/README.md`](docs/verification/opa-characters-20260806/README.md) — 10,262 rows, 1,445 properties, 9,591 distinct character names, carrying Disney's own IDs. **Requested as a lookup table; NOT built.** Request + supplement in `COORDINATOR_INTAKE.md` `## REQUEST QUEUE`, PR #466. Reproducible in ~2 minutes (Albert's MFA login is the only manual step); the snippet is in that README.

> ### ❌ DISPROVED SAME DAY (2026-08-06) — do NOT re-raise "the OPA extract looks like `dflow.properties_and_characters`"
>
> The session that captured the OPA file noticed that its **10,262 rows / 9,591
> names** sit within ~1% of `dflow.properties_and_characters` (**10,122**) and
> `public.characters` (**9,622**), and floated that the legacy table might be a
> stale import of the same list. **That was wrong, and it is recorded here so the
> next session does not spend time re-deriving it.**
>
> The counts measure different things:
>
> - `dflow.properties_and_characters` — `type='PROPERTY'` rows are **style
>   guides**; `type='CHARACTER'` rows are character **appearances**, one per style
>   guide. It is the **style** axis (§6.1 of `AGENTS.md`).
> - `public.characters` — also **appearances**, but each row carries a
>   `property_id`. It is the **ownership** axis.
> - The OPA file — **distinct (property, character) pairs**. Neither of the above.
>
> This is exactly the trap `AGENTS.md` §6.1 warns about ("two AI sessions have
> already corrupted their understanding by reading those column names literally").
> **Numeric coincidence between these tables is not evidence of shared lineage.**
>
> **The real point, which survives:** `core.character` is **0 rows**, and it wants
> distinct characters parented to a property. Neither legacy table supplies that
> shape — the OPA extract does. That strengthens the case for landing it.
> Still unverified: whether OPA's `characterID` can serve as the stable identity
> key `core.character` needs. No database call has been made by any session in
> this thread.

Merged: PRs #197 `db97cd9`, #203 `31e6583`, #215 `f9c8758`, #236 `5bd2f5f`, #237 `1a9a4b1`.

> ### ✅ SUPERSEDED 2026-08-06 — LICENSING IS CLOSED, NOT "AWAITING LAURA".
>
> The status update immediately below is a **2026-07-31 snapshot** and its
> conclusion ("awaiting Laura's response; no further action is available to any AI
> session") is **no longer true.** Round 2 returned **2026-08-04** (157/166, zero
> format failures) and **round 3 returned 2026-08-06 with 8 of 8 answered and zero
> blanks. The licensing question stream is CLOSED. There is no round 4 and nothing
> is outstanding with Laura.** The eight settled rulings are recorded in
> `fix_characters_style_guides.md` § *"Licensing round 3 — RETURNED"*. The block
> below is kept for its lineage detail only.

**STATUS UPDATE — licensing coordination with Laura, round-2 sheet SENT (2026-07-31).** The
round-2 workbook
`docs/verification/character-identity-rules-20260728/licensing-questions-for-laura-round2-20260731.xlsx`
(166 open rows, every answer cell a locked dropdown — 166 data validations verified) was built
and merged, and **Albert sent it to Laura on 2026-07-31.** The workstream is now **awaiting
Laura's response**; no further action is available to any AI session until the completed sheet
comes back. Note that `orchestrator_take_over.md` §4.3 still reads "built, ready to send, NOT
sent" and "Owner still has to send it" — **that is now superseded by this entry**; it was left
unedited only because the session recording this was scoped to `HANDOFF.md` alone. No contact
with Laura happens from any session.

**Exact next action:** Phase 0 — blocking **owner decision** (promote DAM's existing
character→property mapping vs the ~~174-row~~ licensing-team review). Phase 1 is read-only and can
start immediately regardless.

> **CORRECTED 2026-08-06 — the "174-row licensing-team review" no longer exists as a live
> artifact.** Replaced 2026-07-26 by a single 335-row list; the track closed 2026-07-27
> (`fix_characters_style_guides.md:640` and `:615`, `:641`). The real lineage is round 1
> (2026-07-29) → round 2 (2026-07-31, returned 2026-08-04) → **round 3 (returned 2026-08-06 —
> CLOSED)**. Do not reintroduce the 174-row framing.

**Sequencing:** this touches the property spine, so **its Phase 5 production apply must not land
in the same window as the separately approved ColdLion production cutover**. There is no longer a
calendar-based 2026-08-09 gate; coordinate against the actual approved window. Phases 0–4 may
proceed.

**Naming trap that has already caused three modelling errors:** in
`dflow.properties_and_characters`, `type='PROPERTY'` rows are **style guides**, not properties, and
`type='CHARACTER'` rows are character **appearances** (one per style guide), not distinct
characters. Batman is one character in 15 style guides.

## PopSG Property taxonomy reconciliation — OPUS 5-REVISED FORMAL PLAN, NOT STARTED (2026-07-26)

### 1. What the application and workstream are

PopSG is the licensor style-guide library served by the PopDAM codebase at
`https://sg.designflow.app`. NAS crawlers populate
`public.style_guide_files`; its folder-derived `property_folder` values are
observations, not canonical master data. Canonical Property identity and the
Property→Licensor parent edge live in `core.property`.

The single formal execution plan is now
[`fix_popsg_property_taxonomy_reconciliation.md`](fix_popsg_property_taxonomy_reconciliation.md).
It unifies the previously split operational guidance from the ColdLion
source-cutover plan and the style-guide/character architecture document without
replacing either authority.

### 2. Goal and trigger

The 2026-07-26 production deterministic rebuild processed 216,417 active PopSG
files with zero technical failures, but 165,274 of 216,201 present raw Property
fields were unresolved (76.44%). The goal is to classify every distinct
Licensor-scoped observed value and apply only defensible canonical mappings.
The target is 100% classification coverage, zero structural cross-parent
violations, and zero unexplained accepted-tag loss—not 100% tag or terminal
settlement coverage, because structural folders, unresolved Licensors, open
decisions, and licensed titles without ERP codes may correctly remain untagged.

### 3. Current state

- Documentation/plan only; no schema, data, app, preview, or production mutation
  was authorized or performed by the planning session.
- Unified plan created in shared-db and routed from `AGENTS.md`,
  `fix_coldlion_licensor_property_cutover.md`, and
  `docs/style-guides-characters-and-royalties.md`.
- The plan defines nine controlled states (including `licensor_unresolved`), a
  read-only evidence inventory, deterministic proposals, an administrator
  review UI, hashed owner approvals, preview-first implementation, bounded
  production promotion, rebuild, rollback, tests, metrics, and acceptance
  gates.
- Exact-model `claude-opus-5` performed a read-only review. The plan now names
  phases `PSG-0`–`PSG-7` and incorporates every Critical/High finding.
- Current worker behavior is globally exact-matched, not Licensor-scoped.
  PSG-0/1 therefore require a `currently-tagged-at-risk.csv` and an approved
  signed accepted-tag delta before the safety correction can ship.
- Property reconciliation now explicitly separates the 2×2
  Licensor-resolved/unresolved × Property-resolved/unresolved populations.
  `licensor_unresolved` is routed out of Property mapping rather than forced
  into an invalid tuple.
- The eight live hard-coded Licensor aliases must be inventoried and either
  migrated to an approved contract or retained with explicit owner sign-off.
- Administrator UI actions are pending proposals only; only Albert's unchanged
  hash can activate decisions through a guarded RPC.
- PSG-6 applies and verifies production schema before deploying dependent app
  code, then captures a fresh accepted/manual/rejected tag snapshot before the
  rebuild.
- Recommended durable split: true cross-app aliases in a shared
  `core.property_alias` contract; PopSG-only structural/no-code/review decisions
  in an app-owned `dam.popsg_property_resolution` contract. Names/shapes remain
  provisional until PSG-1 proves no existing contract covers them.

### 4. Rejected approaches and why

- **Mass-create the formerly proposed ~186 “missing Properties”: rejected.**
  Canonical Properties follow ColdLion-coded business records; style-guide names
  and merely licensed titles are not automatically Properties.
- **Fuzzy automatic mapping: rejected.** Common titles and cross-entity code
  collisions make it unsafe. Similarity may be reviewer evidence only.
- **Drive the raw unresolved counter to zero: rejected.** It would misclassify
  intentional non-Properties/no-code titles. Metrics must separate mapped,
  intentionally untagged, actionable unresolved, and technical failures.
- **Hard-code a growing worker alias array: rejected.** Decisions must be durable,
  scoped by Licensor, reviewable, auditable, and reusable where genuinely shared.
- **Mix source cutover and PopSG mapping into one document: rejected.** The unified
  plan is one PopSG execution plan; the ColdLion cutover and style-guide model
  remain supporting authorities with different responsibilities.

### 5. Root findings and decisions

- The future resolver must resolve the canonical Licensor first, then Property
  only within that parent; this intentionally corrects today's global matcher
  and must have a signed, explainable tag-removal delta.
- Exact normalized name/code and approved aliases are allowed; cross-parent
  mappings must remain zero.
- Disney Classics map to `CP` only from the owner-approved list/rule in the
  style-guide authority doc; “titles like them” is not a fuzzy match license.
- A no-code title receives no invented canonical row.
- Canonical creates remain separately owner-gated; ColdLion Phase 5 is
  `NOT NEEDED / BLOCKED`, with zero approved creates and a documented candidate
  set, and cannot be reopened implicitly.

### 6. Exact next steps

1. Record Albert's §14 plan-entry acceptance; it authorizes evidence work only.
   **Pass when:** dated acceptance is preserved verbatim.
2. Enter `PSG-0`: create a dated zero-database-write evidence directory and
   record repo/PR/migration state, both Supabase refs, ColdLion phase, new
   production baseline, accepted/manual/rejected tag export+hash, all eight
   Licensor aliases/blast radius, and normalization fixtures. **Pass when:** the
   README contains every named artifact and reproduction command.
3. Build the tested read-only `PSG-1` inventory extractor. **Pass when:** the 2×2
   matrix balances, every active observation is represented once, and
   `currently-tagged-at-risk.csv` captures every accepted tag threatened by
   parent scoping.
4. Generate the frozen `PSG-2` proposal set. **Pass when:** every observation
   has one disposition, create candidates are diffed against ColdLion's
   existing set, the hash reproduces, and structural cross-parent proposals are
   zero.
5. Present the business-readable summary to Albert. **Pass when:** Albert
   approves the disposition vocabulary and first bounded decision hash.
6. Only then build `PSG-3` pending-proposal UI. `PSG-5` schema/rebuild work
   requires a recorded ColdLion checkpoint and owner sign-off; `PSG-6` must not
   overlap ColdLion Phase 7.

### 7. Constraints and gotchas

Shared-db owns all DDL and uses branch+PR+preview-first. PopDAM is a consumer and
must not author shared migrations. `dam` remains unexposed through PostgREST.
Do not bypass the active ColdLion Phase 6/Phase 5 gates, edit applied migrations,
use unrestricted `--include-all`, overwrite concurrent PopDAM edits, or treat
PopDAM `assets` as PopSG `style_guide_files`.

### 8. Access and environment

Preview: `rjyboqwcdzcocqgmsyel`. Production:
`qsllyeztdwjgirsysgai`. Canonical credentials remain in 1Password vault
`vibe_coding` under the item titles documented in `AGENTS.md`; no value belongs
in files or chat. PSG-0/1 begin read-only.

### 9. Open questions and risks

Albert has not yet accepted the revised plan-entry checklist. The exact
alias/decision table names remain provisional; the first review-batch size
depends on the distinct-value distribution. Folder drift will create an ongoing
small queue. Any canonical create requires an explicitly reopened and approved
ColdLion Phase 5 decision. Licensor-unresolved rows need a separate bounded
parent reconciliation. The eight hard-coded Licensor aliases need an explicit
owner ruling. The production tag-loss delta is unknown until PSG-1.

### PopSG Property plan handoff self-audit

1. **Could a street-new developer continue without chat context? Yes.** This
   section defines the app, authority, measured trigger, current plan-only state,
   rejected approaches, decisions, environments, and ordered next actions; the
   linked formal plan contains the complete implementation phases and gates.
2. **Could they continue as effectively as this session? Yes.** The precise
   production baseline, current global-matcher defect, required at-risk export,
   2×2 population split, Licensor-alias blast radius, authority split, metric
   definition, no-create boundary, production rollout order, snapshots, and
   required approval sequence are preserved.
3. **Are failures, constraints, risks, and verification gates complete? Yes.**
   §§4, 6, 7, and 9 preserve every rejected path, explicit blocker, and
   executable “Pass when” condition. No implementation or production action is
   falsely reported.

## DB Data Admin — non-SSO tester login (DONE — 2026-07-23)

Status: **done.** Owner approved "gate to data-dev only" on 2026-07-23. Shipped in
PR #195 (`3d3c434`); tester user created; flag live on data-dev; credential stored in
1Password as **"DB Data Admin AI tester login (data-dev.designflow.app) - non-SSO"**.

### What exists now

| Piece | State |
|---|---|
| `allowPasswordLogin` flag (`config.ts`, `nginx.conf`, `App.tsx`) | Merged in #195. Strict opt-in: only `true` / `"true"` enables it. |
| Coolify env `DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN=true` | Set on app `v6z1sveur7e32dub1dp3ao4v` (`db-data-admin-development`) **only**. |
| Tester auth user | `ai-tester@data-dev.designflow.app`, auth id `0a55652c-260e-41ac-aa8a-18636bcfab6b`, profile `098e5791-101b-4cf3-8a9e-8efccc2040d7`. Granted BOTH `administrator` role AND explicit `app_access('admin')` — see "two grants" section. |
| Invitation row | `public.invitations` id `f9b1301f-c1af-421e-8ad0-5c7c896c067e` (required — see gate below). |
| Credential | 1Password vault `vibe_coding`, item `agk4gstcwazitt76evs5r2agvi`. |

Verified end-to-end (2026-07-24, build `1fe8ad4`): logged in headlessly via the tester
credential (1Password-injected, browser automation), loaded **155 real rows**, opened the
Status Set Filter popover (options `active` / `potential`), confirmed the value-search box
narrows the list, and confirmed unchecking a value filtered the grid **155 → 15**. The
text filter also works (`155 → 3` on "a"). Production `data.designflow.app` has no server
running and never received the flag.

The Set Filter popover was also **clipped by RevoGrid's header overflow** on first live
test (only the first checkbox showed) — fixed by portalling it to `document.body`
(PR #211). This class of bug is invisible to the jsdom unit tests; always verify grid
overlays in a real browser.

### The invitation gate — READ THIS BEFORE RECREATING THE USER

`public.handle_new_user` (trigger on `auth.users`) makes **email/password signup
invitation-only**; only provider `azure` / `authentik` bypasses it. Creating an
email/password user without an invitation row fails with HTTP 500
`{"code":"P0001","message":"Access denied: no valid invitation found for …"}`.
**This is a deliberate guardrail — do not disable or edit the trigger.** Insert an
invitation first:

```sql
insert into public.invitations (email, role, apps)
values ('<email>', 'user', array['popdam']::public.app_name[]);
```

then create the user via the Auth Admin API with `email_confirm: true`, then grant access
(next section).

### The full authorization requires TWO grants, not one (learned the hard way)

The DB Data Admin RPCs do **not** gate on the administrator role alone. Every
`db_data_admin_*` RPC calls `app.require_db_data_admin_access()`
(`supabase/migrations/20260722005000_db_data_admin_read_contracts.sql:29`), which requires
**both**:

1. `app.has_role('administrator')` — the `app.user_role` row (trigger only auto-grants
   this to `u2giants@gmail.com` / `albert@popcre.com`, so insert it manually), **and**
2. `app.has_explicit_app_access('admin')` — a **non-revoked `app.app_access` row for app
   `'admin'`**. Note `has_explicit_app_access` (`…20260722002500…:5`) does NOT give
   administrators an implicit grant — the row must exist.

The signup trigger `app.handle_new_auth_user` only grants `app_access` for `'crm'`, so a
freshly created admin still gets **HTTP 403 `{"code":"42501","message":"db_data_admin:
not authorized"}`** and the UI shows "Data could not be loaded." Both grants for the live
tester:

```sql
-- role grant
insert into app.user_role (profile_id, role_id)
select p.id, r.id from app.profile p, app.role r
where p.auth_user_id = '<auth uid>' and r.slug = 'administrator'
on conflict do nothing;
-- explicit admin app_access — the piece that is easy to miss
insert into app.app_access (profile_id, app)
select p.id, 'admin'::app.app_name from app.profile p
where p.auth_user_id = '<auth uid>'
on conflict (profile_id, app) do update set revoked_at = null;
```

### How an AI session should use this credential

Use a 1Password-mediated path so the plaintext password never enters the AI's context.
Two that work:

1. **Browser + 1Password extension** — drive the owner's real Chrome (the
   `claude-in-chrome` tooling) and let the 1Password extension autofill the form.
2. **Programmatic session injection (best for automation)** — exchange the credential
   for a session token with the plaintext redacted, then drive the authenticated app:

   ```
   POST https://rjyboqwcdzcocqgmsyel.supabase.co/auth/v1/token?grant_type=password
   headers: apikey: <branch anon key>
   body:    {"email":"ai-tester@data-dev.designflow.app","password":"<op:// reference>"}
   ```

   Run it through `op_run` with the password supplied as an `op://` reference so the
   value is redacted from the transcript. Then set the returned session into the app's
   Supabase storage key before loading the page.

An earlier revision of this file claimed an AI session "cannot" use this login at all.
That was wrong — what is avoided is handling the plaintext password directly, not using
the credential.

### Original goal (kept for context)

Albert asked for "internal (non-SSO) credentials to `https://data-dev.designflow.app`
for testing purposes," stored in 1Password, so an AI session can log in and drive the UI
(the Multi Filter work shipped this session could not be visually verified for exactly
this reason).

### Why it had to be gated — read before changing it

1. **The app is Microsoft-SSO only.** `apps/db-data-admin/src/App.tsx` offers a single
   auth path: `supabase.auth.signInWithOAuth({ provider: 'azure' })`. There is **no**
   email/password form. A password user therefore cannot log in through the UI until the
   app gains a `signInWithPassword` form — this is an app **code** change, not just a
   user record.
2. **That code change would also reach production.** `data.designflow.app` (production)
   and `data-dev.designflow.app` (development) are built from the **same** codebase and
   the same GHCR image; only the injected `/config.js` differs (see `nginx.conf` →
   `DB_DATA_ADMIN_*` env). Adding a password form without an explicit environment gate
   would open a non-SSO door on **production** DB Data Admin.
3. **data-dev is NOT a throwaway sandbox.** It points at Supabase preview branch
   `rjyboqwcdzcocqgmsyel` (`shared-db-schema-rehearsal`), which the 1Password item
   "Supabase Preview Branch Credentials - shared POP database" documents as a
   *persistent production clone (`with_data=true`)* whose data is
   **"production-sensitive."** DB Data Admin can edit and **merge** records. A password
   credential with an Administrator grant there is effectively production-grade access.

### The design that was built (owner-approved)

- Add an email/password sign-in form **gated behind an explicit runtime flag**
  (e.g. `DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN`, surfaced through `/config.js` and
  `readConfig()`), set **only** on the data-dev Coolify application. Production stays
  SSO-only and the form never renders there.
- Enable the email provider on branch `rjyboqwcdzcocqgmsyel` only.
- Create one tester user with a long generated password, grant it Administrator, and
  store it in 1Password vault `vibe_coding` with full usage notes.

#### Exact Administrator grant chain (verified against migrations, 2026-07-23)

A Supabase auth user alone is **not** enough — every `db_data_admin_*` RPC ultimately
calls `app.has_role('administrator')`, which resolves through three tables. All of these
rows must exist or the app renders its "Access denied" screen:

1. `auth.users` — the tester user (created via the Admin API with the branch
   service-role key, `email_confirm: true`).
2. `app.profile` — a row with `auth_user_id = <that user's id>` **and
   `status = 'active'`**. `app.current_profile_id()` (`20260621150815_app_core.sql:351`)
   returns nothing without both, and every role check then fails.
3. `app.user_role` — a row joining that `profile_id` to `app.role` where
   `slug = 'administrator'`, with **`revoked_at is null`**
   (`app.has_role`, `20260621150815_app_core.sql:365`).

Definitions: `app.profile` and `app.user_role` in
`supabase/migrations/20260621150815_app_core.sql:12`; the `administrator` role is seeded
at `:340`; the `app.app_role` enum is in `20260621150714_foundation.sql:19`.

Per the shared-db rule, any DDL stays migration-authored — but this is **row data on a
preview branch**, so insert it directly there; do **not** add a migration that seeds a
tester account, and never create this user on production `qsllyeztdwjgirsysgai`.

#### Verification gate (do not report done without these)

1. `GET /config.js` on data-dev shows the password-login flag enabled, and production's
   `/config.js` does **not**.
2. Sign in at `https://data-dev.designflow.app` with the stored credentials and confirm
   the Customers grid renders — not the "Access denied" panel.
3. Confirm the same build on `data.designflow.app` still shows **only** the
   "Sign in with Microsoft" button.

### Access status

Access is **available** — no new credentials need to be requested:
- Preview branch service-role key + Postgres URL: 1Password →
  *"Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)"*.
- Supabase management PAT: 1Password → *"Supabase CLI Personal Access Token"*.
- Note: `rjyboqwcdzcocqgmsyel` is a **branch**, so it does **not** appear in
  `GET https://api.supabase.com/v1/projects`. Do not conclude the token is wrong —
  list branches instead.

### If you need to change this

Never set `DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN` on the production Coolify app. To revoke
the tester instead of deleting it, set `revoked_at` on its `app.user_role` row, or unset
the Coolify variable and redeploy to remove the form entirely.

## Historical Stage 0 — Safe DAM core licensor/property cutover (COMPLETED/SUPERSEDED)

This section preserves the pre-cutover failure history. Its local-worktree and
"not applied" state is obsolete. The current authoritative state is the
CURRENT PRIORITY section above plus
`fix_coldlion_licensor_property_phase1_handoff.md`.

Date: 2026-07-23 (revised implementation)
Repo: `u2giants/shared-db`
Worktree: `C:\repos\shared-db-worktrees\dam-core-taxonomy-safe-cutover-stage0`
Branch: `fix/dam-core-taxonomy-safe-cutover-stage0` (one commit behind main `a90846c` DB Data Admin domain reservation — do not overwrite that commit; port accepted changes onto a fresh `codex/*` branch after review)

**Stage 0 is NOT “repo-side done for production” until unit tests pass and a
later session lands the branch.** This coding pass revises an unacceptable
first draft: DDL must be migration-authored; the Node tool is DML-only.

### 1. What this application is

PopDAM is POP Creations’ internal digital-asset library (`dam.designflow.app`).
PopSG is its licensor style-guide mode (`sg.designflow.app`). Both apps, plus
CRM and PM/PIM, share one hosted Supabase Postgres project:

| Env | Project ref |
|---|---|
| Production | `qsllyeztdwjgirsysgai` |
| Preview (`shared-db-schema-rehearsal`) | `rjyboqwcdzcocqgmsyel` |

PopSG reads `style_guide_folders` and `style_guide_file_groups` through
PostgREST. Canonical taxonomy identity lives in `core.licensor` /
`core.property`. Legacy DAM tables `public.licensors` / `public.properties`
still exist for the character catalog only.

This repository (`u2giants/shared-db`) is the **only** place schema/DDL for
that shared database may be authored. Consumer apps must not invent migrations.
AGENTS.md: every DDL change is a new timestamped file under
`supabase/migrations/` — never ad-hoc Node-executed ALTER/CREATE/DROP/VALIDATE.

### 2. What we set out to do this session, and why

**Business goal:** finish moving PopDAM asset/style-group licensor+property
foreign keys onto the shared canonical `core.*` rows so every app agrees on
identity — without taking the Data API down again.

**Trigger:** production application of
`supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql`
timed out after 10 minutes, rolled back, and caused project-wide PostgREST
503 / `PGRST002` while the long transaction was open.

**Stage 0 technical objective (revised):**

- **DDL in migrations only** — bridge versions between `112900` and unsafe
  `113000`: drop legacy FKs → residual gate → finalize core FKs/view → ledger
  barrier.
- **Node tool = DML only** — read-only preflight/evidence + bounded residual
  batches; no schema DDL phases on the apply path.
- **Honest ledger order** — do not edit/rename/delete applied `113000`; do not
  repair `113000` before the equivalent end-state exists; barrier blocks linear
  push into re-running unsafe `113000` until that version is already in the
  ledger (preview already has it; production uses owner-approved repair
  **after** verification).
- Partial-resume fix: `COALESCE(existing valid core licensor, mapped legacy)`.
- Hard-fail unmapped **and** ambiguous licensors; property missing/ambiguous →
  NULL; durable text untouched.
- Lock safety: `lock_timeout` + `statement_timeout` per DML txn; advisory lock;
  forward-progress abort; transaction-safe trigger disable/enable.
- Dry-run: live query when `DATABASE_URL` set; offline never pretends counts are
  operational proof.

Later Licensor→Property authority stages remain **out of scope**.

### 3. Current state — what is true right now

**Production database**

- Ledger has `20260723112900` only among the taxonomy trio.
- Ledger does **not** have `20260723113000` or `20260723113100`.
- Canonical FK cutover is **not** applied (legacy targets after rollback).
- PopSG recovered after `notify pgrst` reload on 2026-07-23.

**Preview database**

- `20260723113000` **is** applied and verified (85,481 / 42,700 links, five
  core FKs, `dam_character_catalog`). File must not be edited/renamed/deleted.
- New bridge migrations `112910`–`112940` are **not yet applied** on preview
  (local worktree only). When landed, use out-of-order / `--include-all` so
  versions between already-applied ones can run; each is idempotent and the
  barrier passes because `113000` is already in the ledger.

**Repository (this worktree — uncommitted local revision)**

| Path | Status |
|---|---|
| `supabase/migrations/20260723112910_dam_core_taxonomy_drop_legacy_fks.sql` | **New** — idempotent drop of legacy-targeted FKs only |
| `supabase/migrations/20260723112920_dam_core_taxonomy_backfill_gate.sql` | **New** — refuses while residual non-core ids remain |
| `supabase/migrations/20260723112930_dam_core_taxonomy_finalize_core_fks.sql` | **New** — five core FKs + view; no bulk DML |
| `supabase/migrations/20260723112940_dam_core_taxonomy_ledger_barrier.sql` | **New** — refuses until `113000` is in ledger |
| `tools/dam-core-taxonomy-safe-cutover.mjs` | **Revised** — DML-only apply path |
| `tools/dam-core-taxonomy-safe-cutover.test.mjs` | **Revised** — DDL absence, partial-resume, gate/barrier, locks, progress |
| `scripts/dam-core-taxonomy-safe-cutover/README.md` | **Revised** — multi-pass db push + ownership split |
| `docs/app-migration-notes/popdam-core-licensor-property-20260723.md` | **Revised** |
| `supabase/migrations/20260723113000_*.sql` | **Unchanged** |
| Commit / push / PR / remote DB | **Not done** (explicit session boundary) |

**Dependent PopDAM app code:** must not deploy until production cutover +
verification + honest ledger.

### 4. Everything we tried that did NOT work

1. **Re-run unchanged `20260723113000` on production** — timed out, rolled
   back, PostgREST 503/PGRST002. **Do not retry.**

2. **Wait for PostgREST to self-heal** — required explicit `notify pgrst`
   reload. Recovery only, not a migration strategy.

3. **Edit / replace / empty-out `20260723113000`** — illegal (applied on
   preview).

4. **Silent `migration repair --status applied 20260723113000` before
   end-state** — **Forbidden.** Repair only after verified equivalent end-state
   + explicit owner approval for that metadata action.

5. **First-draft Node tool executing DDL (drop FKs / finalize) on apply** —
   violates AGENTS.md migration discipline. **Rejected.** DDL moved into
   `112910` / `112920` / `112930` / `112940`; tool is DML-only.

6. **Partial-resume mapping joining licensor map only on `row.licensor_id`** —
   if licensor was already a valid `core.licensor` UUID and property still
   legacy, map miss nulled **both**. Fixed with COALESCE in pure functions and
   every asset/style_group DML query.

7. **Illustrative dry-run residual counts presented as operational proof** —
   offline dry-run now prints architecture/SQL only with
   `operationalCounts: null`. Live evidence requires `DATABASE_URL`.

8. **Trust withdrawn “production promotion succeeded” docs** — superseded.

### 5. Root causes and key findings

- **Outage root cause:** one migration held DDL + ~85k rewrites long enough that
  PostgREST could not rebuild its schema cache globally.
- **Safe architecture (revised):**
  - Migrations own short DDL and gates (`112910`–`112940`).
  - Node tool owns residual DML only, with advisory lock, timeouts, and
    forward-progress checks.
  - Barrier owns honest refusal to reach unsafe `113000` until that version is
    already recorded applied (never via SQL writes to the ledger).
- **Mapping:** code aliases `DS→DY` / `WWE→WW`; hard-fail unmapped/ambiguous
  licensors; property code-then-name; missing/ambiguous property → NULL;
  durable text untouched; COALESCE preserves partial core ids.
- **Multi-pass production workflow:** push `112910` → DML tool → push
  `112920`+`112930` → barrier refuses → verify → owner repair `113000` → push
  barrier + `113100`. Preview uses `--include-all` for out-of-order bridge
  inserts; barrier passes immediately because `113000` is already applied.

### 6. Exact next steps

1. **Local gates (this worktree, before claiming Stage 0 repo-side complete):**
   ```bash
   node --test tools/dam-core-taxonomy-safe-cutover.test.mjs
   bash scripts/check-sql.sh
   ```
   Gate: all node tests pass; check-sql static pass.

2. **Land on a fresh branch after review** (later session): do not clobber main’s
   `a90846c`. Commit Stage 0 files only → PR → merge. No remote DB from the
   coding-only session.

3. **Preview out-of-order apply** of `112910`–`112940` (`db push --include-all`
   or platform equivalent). Gate: all four apply; barrier passes; tool `--apply`
   is `noop` or residual-clear; five core FKs still present.

4. **Production window (owner-approved):**
   - Pass 1: `db push` applies `112910`; stops at gate `112920`.
   - DML: `node tools/dam-core-taxonomy-safe-cutover.mjs --apply --batch-size=2000`
     with REST probes; abort on PGRST002.
   - Pass 2: `db push` applies `112920`+`112930`; stops at barrier `112940`.
   - Validate: zero residuals, `core_fk_count=5`, view exists; browser PopSG.
   - **Only then**, owner-approved:
     `supabase migration repair --status applied 20260723113000`
   - Pass 3: `db push` applies `112940` + `113100`. Dry-run must not treat
     `113000` as pending work to execute.

5. **Only then** deploy dependent PopDAM taxonomy app code.

6. **Do not start** later authority migrations until steps 3–4 are done.

### 7. Constraints and gotchas in force

- Shared-db branch + PR; AI merges after checklist; preview-first for schema.
- **Never edit applied migrations** (`113000` on preview).
- **Never repair `113000` before equivalent end-state exists.**
- **Never retry `113000` unchanged** on production.
- **Never Node-execute schema DDL** for this cutover.
- **Never write `schema_migrations` from SQL.**
- No consumer-repo DDL; `dam` not in `pgrst.db_schemas`.
- Windows: no `psql` — use Node + `pg` + pooler for apply.
- This coding session: no secrets, no remote DB, no commit/push/PR.

### 8. Access and environment

| Need | Where |
|---|---|
| Supabase CLI PAT | 1Password `vibe_coding` → “Supabase CLI Personal Access Token” |
| Production DB password | 1Password `vibe_coding` → “Supabase DB Password - shared POP database” |
| Preview DB password | 1Password `vibe_coding` → “Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)” |
| Pooler | `aws-1-us-east-1.pooler.supabase.com:6543` |
| CLIs on t16 | `gh`, `gcloud`, `supabase`, `op` (when toggled) |

Stage 0 revision session: **did not** open Supabase or read secrets.

### 9. Open questions and risks

| Item | Notes (dated 2026-07-23) |
|---|---|
| Production maintenance window | Owner-scheduled; not auto-booked. |
| Batch size default 2000 | Override with `--batch-size=`. |
| Repair approval | Only after verified end-state; barrier enforces sequencing. |
| Concurrent main commit `a90846c` | Port Stage 0 onto fresh branch; do not overwrite. |
| Window after `112910` before finalize | FKs briefly absent; resume DML ASAP; never run `113000`. |
| Concurrent DML operators | Advisory lock refuses second apply. |

### Self-audit (Stage 0 handoff)

1. Comprehensive for a brand-new developer? **Yes** — §§1–9 cover app, goal,
   dual-env ledger state, failed approaches (including first-draft DDL tool and
   partial-resume bug), architecture, ordered multi-pass gates, constraints,
   access, risks.
2. Detailed enough to continue without this chat? **Yes** — exact migration
   versions, tool commands, repair timing, preview `--include-all`, and
   `scripts/dam-core-taxonomy-safe-cutover/README.md`.
3. Execution honesty? **Yes** — no remote apply, no commit, no claim that
   production or preview bridge is applied; tests are the local completion gate
   for this revision.

---

## PopSG outage during DAM taxonomy migration — 2026-07-23 (historical incident summary)

The incident narrative that triggered Stage 0 is retained in condensed form.
Prefer the Stage 0 section above for execution.

- PopSG recovered (200/206 + cards) after PostgREST reload signals.
- Production cutover **not** applied; ledger has `112900` only among the trio.
- Unchanged single-transaction migration must not be retried.
- Detail + safe path: `docs/app-migration-notes/popdam-core-licensor-property-20260723.md`.

## Sample Tracking schema — 2026-07-22 update (APPLIED to preview AND production)

> ### 2026-07-23 follow-up — completion semantics + office inventory (APPLIED to production)
>
> Two further migrations are merged and **applied to preview AND production on 2026-07-23**:
> - `20260723230000_sample_tracking_completion_semantics.sql` — fixes two verified defects:
>   a sample with **zero movements** used to derive `complete` (now `uninitialized`), and a
>   stop closeout could **mask a remaining balance** and show `complete` while pieces
>   physically remained. Adds the **automatic office-inventory trigger**.
> - `20260723233000_sample_shipment_line_allow_inventory_origin.sql` — lets a shipment line
>   originate from an `*_office_inventory` bucket so parked stock can be **added to a new box**.
>
> **Business rule (confirmed by Albert 2026-07-23):** when pieces ship onward out of an office,
> the remainder is automatically moved into that office's own inventory bucket
> (`terminal/ningbo_office_inventory`, `terminal/nyc_office_inventory`) and leaves the tracking
> flow — pieces stay conserved. Delivered-to-customer is resolved. Inventory stock can be
> withdrawn into a new box (balance-checked). Canonical four-piece end state is now `complete`.
>
> Production apply was **deliberately bounded** to these two migrations using a clean temporary
> checkout, because production is missing **16 unrelated migrations** from other workstreams
> (DB Data Admin write paths, DAM taxonomy cutover, PopSG) — several deliberately unpromoted.
> `supabase db push` refuses to run while those gaps exist; **never** use `--include-all` to
> force it, or you will promote all 16. See "Production migration backlog" below.
>
> Tests: `sample_tracking_completion_semantics.sql`, `sample_tracking_quantity_contract.sql`
> (updated for the new rule), `sample_tracking_office_inventory_withdrawal.sql` — all pass
> against the applied schema.
>
> **Consumer work is NOT done.** The DesignFlow apps still run daily on the legacy scalar model
> and several of their endpoints hard-fail against the live constraints. The adoption plan lives
> in the tracking repo: `popcre/designflow-tracking` →
> [`fix_sample_tracking.md`](https://github.com/popcre/designflow-tracking/blob/sandbox-albert/fix_sample_tracking.md)
> (PR [#26](https://github.com/popcre/designflow-tracking/pull/26), Uma reviews). Shared-db
> copy of the same analysis:
> [`docs/verification/designflow-sample-tracking-consumer-fix-spec-20260723.md`](docs/verification/designflow-sample-tracking-consumer-fix-spec-20260723.md).

The full Sample Tracking schema is merged to `main` and **live on both preview
(`rjyboqwcdzcocqgmsyel`) and production (`qsllyeztdwjgirsysgai`)**. After the
`220000`-timestamp collision was found (PR #168), the whole block was re-timestamped
to a clean contiguous range **`20260722221000`–`20260722221700`** (PRs #168 and #170;
`221700` contract-hardening now sorts last because it ALTERs the tables created at
`221400`/`221500`). It covers the restored `sample_shipment_item` current-membership
table + uniqueness, durable box ownership, shipment intent, immutable/concurrency-safe
quantity movements, local closeouts, durable import audit records, permissions, and
five derived read views. Legacy samples remain explicitly `unknown`; none were
backfilled as quantity one.

**Verified on production 2026-07-22 (read-only):** ledger entries `221000`–`221700`
are all present, and every object exists — tables (`sample_shipment_item`,
`sample_movement`, `sample_import_row`, `sample_box`, `sample_stop_closeout`, …),
functions (`post_sample_movement`, `sample_movement_guard`, …), and the five read
views. Evidence: `docs/verification/sample-tracking-quantity-schema-20260722.md`.

**Trigram-ledger drift — RESOLVED 2026-07-23.** Production's ledger had recorded the
PopSG trigram migration under its **old** version `20260722220000` while on disk the
file is `20260722220800`. That single ledger row was reconciled (`220000` → `220800`,
name unchanged) with Albert's explicit approval; production's ledger now matches the
on-disk filenames exactly (`220800` + `221000`–`221700`, every version equal to its
file prefix), so a future `supabase db push` from `main` sees them all as applied and
re-runs nothing. No schema objects were touched. (The git-integrated `main` preview
branch may still report status `MIGRATIONS_FAILED` — a stale artifact of the original
collision; all objects did land.)

Date: 2026-07-22
Repo: `u2giants/shared-db`
Target branch: `main`; all completed work described here is merged and synchronized unless
a section explicitly says it remains preview-only or pending.

This file is the top-level "where are we" pointer for the next session. It is written
for a developer with **zero** prior context. Read it, then read the linked plan.

---

## 🚧 Production migration backlog — READ BEFORE ANY PRODUCTION APPLY (2026-07-23)

**Historical baseline (2026-07-23): production was missing 16 migrations that
sat *before* its last applied migration.** The exact backlog is dynamic and must
always be recalculated from the full local/remote ledger before a production
apply.
Because of that, `supabase db push` **refuses to run** against production and exits 1 with
*"Found local migration files to be inserted before the last migration on remote database.
Rerun the command with --include-all flag."*

**Do NOT rerun with `--include-all`.** That would promote every current gap at once, and several are
**deliberately unpromoted** — the DB Data Admin write paths (`20260722170000` single-record
updates, `20260722194000`/`194100` merge workflow, `20260722203000`/`203100` licensor tree),
plus the DAM taxonomy cutover (`20260723112910`–`112940`), `dam_customer_hub_wiring`,
`dam_path_facets_by_customer_id`, and `plm_import_master_data_preserve_customer_status`.
Promoting those is each workstream's decision, in its own window.

**PopSG correction (2026-07-26):** migrations `20260723170000`,
`20260723170100`, and `20260723170200` were promoted through an owner-approved
physically bounded runner and verified in production. The deterministic rebuild
then completed 216,417 active files with zero failures. Do not treat those three
as pending merely because this historical section once listed them.

**How to apply only your own migration (the bounded technique, used successfully 2026-07-23):**

1. `git worktree add --detach <tmp> origin/main`
2. In that temp checkout, **delete the migration files you are not promoting** (they stay in
   the repo; you are only shrinking the local set the CLI compares against).
3. `supabase link --project-ref qsllyeztdwjgirsysgai --password "$PROD_DB_PASSWORD"`
4. `supabase db push --dry-run` → **confirm it lists only your migrations**, then
   `supabase db push`.
5. Verify the real objects in the database (not just `supabase_migrations.schema_migrations`).
6. Remove the temp worktree.

**Gotcha found the same day:** comparing filenames "greater than the remote's highest version"
is **not** a valid way to compute what is pending — production had gaps far below its maximum.
Always diff the full local file list against every row in `supabase_migrations.schema_migrations`.

**Second gotcha — the ledger can lie.** Preview recorded `20260723233000` as applied while the
constraint it creates was **absent**. Always verify the actual object, and reconcile drift by
re-running the committed migration's (idempotent) SQL.

## Sample Tracking schema — DesignFlow (APPLIED preview + production, 2026-07-22)

The authoritative database implementation plan is
[`fix_sample_tracking_schema.md`](fix_sample_tracking_schema.md). Read it completely before touching
any Sample Tracking table, migration, constraint, view, RLS policy, grant, or legacy data.

### What this work is and why it exists

DesignFlow tracks physical product samples through factories, Ningbo, New York, and customers. One
sample batch may split: a factory can make four pieces; Ningbo can retain one and send three to New
York; New York can retain two and send one to the customer. The legacy scalar quantity/status/office/
box model cannot account for all four pieces simultaneously. The planned design uses immutable
positive movements between normalized typed locations, derived balances, durable box ownership,
explicit shipment intent, local-stop closeout distinct from global completion, and durable import
records.

### Current exact state (2026-07-22 — SCHEMA APPLIED to preview AND production)

- **Whole schema is merged to `main` and live on both preview (`rjyboqwcdzcocqgmsyel`) and
  production (`qsllyeztdwjgirsysgai`).** PRs #164, #166, #168, #170 are all merged. Migrations are
  re-timestamped to the clean contiguous range **`20260722221000`–`20260722221700`** (`221700`
  contract-hardening last, since it ALTERs the `221400`/`221500` tables).
- The originating read-only inventory (gates 1–3) confirmed the §3.2 defect: the restore migration
  `20260721201500_restore_dflow_sample_tracking_tables.sql` had recreated six tables in `dflow` but
  omitted the seventh, `sample_shipment_item`
  ([`docs/verification/sample-tracking-inventory-20260722.md`](docs/verification/sample-tracking-inventory-20260722.md)).
  That table has since been restored (`221000`) with `UNIQUE(sample_id_fk, box_id_fk)` (`221100`),
  which the tracking service itself anticipates (§15 Q1: it uses the table as current box membership,
  failing closed 409 when absent).
- **Production verification, read-only, 2026-07-22:** ledger entries `221000`–`221700` are all
  present and every object exists — tables (`sample_shipment_item`, `sample_movement`,
  `sample_import_row`, `sample_box`, `sample_stop_closeout`, …), functions (`post_sample_movement`,
  `sample_movement_guard`, …), and the five read views. Preview was proven earlier by rolled-back
  transactional rehearsal + the two-connection race test (evidence:
  `docs/verification/sample-tracking-quantity-schema-20260722.md`).
- Legacy samples remain explicitly `unknown`; none were backfilled as quantity one.

### How production got applied (note for the record)

The PR bodies (#164/#166/#168) were written before promotion and say "production still pending";
that wording is now **stale**. As of 2026-07-22 production carries the full `221000`–`221700` block.
No session log in this repo documents exactly when/how it was pushed, but the objects and ledger are
present and consistent. This section supersedes the earlier "not yet applied" claims.

### Trigram-ledger drift — RESOLVED 2026-07-23

Production's ledger had recorded the PopSG trigram migration under its **old** version
`20260722220000` (name `sgf_path_trgm_indexes`) while the on-disk file is `20260722220800`. With
Albert's explicit approval, that single ledger row was reconciled (`UPDATE … set version =
'20260722220800' where version = '20260722220000' and name = 'sgf_path_trgm_indexes'`). Production's
ledger now matches the on-disk filenames exactly (`220800` + `221000`–`221700`, every version equal
to its file prefix), so a future `supabase db push` from `main` sees them all as applied and re-runs
nothing. No schema objects were touched — this was a ledger-row reconciliation only. The
git-integrated `main` preview branch may still show status `MIGRATIONS_FAILED`, a stale artifact of
the original collision.

### Constraints, access, and risks

- All DDL belongs here; consumer repositories receive model/service changes only after shared-db.
- Preview project is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`. Reconfirm in
  `AGENTS.md` before linking.
- Credentials live in 1Password vault `vibe_coding` under the item names documented in `AGENTS.md`;
  never copy values into files or chat.
- Never assume an unknown legacy sample has quantity one, and never delete duplicate memberships
  with a blind row-number cleanup.

---

## Active workstream — DB Data Admin implementation (updated 2026-07-23)

### 1. What this application is

DB Data Admin is POP Creations' administrator-only control room for shared Customers,
Vendors, Licensors, and Properties. Its canonical code and database migrations live in this
repo. The React/TypeScript frontend is in `apps/db-data-admin/`; the development deployment is
`https://data-dev.designflow.app`; the reserved production URL is
`https://data.designflow.app`. `DB_Data_Admin.md` is the authoritative product and delivery
specification, and `docs/db-data-admin-inventory.md` is the verified implementation inventory.

### 2. What this work set out to do, and why

The project replaces scattered SQL/manual maintenance with one guarded interface while
preserving shared Core identities, per-application status overrides, immutable audit history,
and safe merges. Delivery Steps 1–10 now establish the repository/runtime foundation,
authorization/storage schema, merge coverage, protected reads, extension tables, controlled
Customer Channels, read-only Customer/Vendor grids, guarded single-record editing, and
protected duplicate merges with immutable audit history, and a read-only Licensor → Property
hierarchy with dated reconciliation and loud orphan handling. Production writes remain off.

### 3. Current state

- Repository mirroring excludes top-level `apps/` centrally; all nine consumer sync jobs test
  that boundary. No workstation-specific setup is required.
- PR #127 scaffolded React 19 + TypeScript 6 + Vite 8.1.5, pinned RevoGrid Core 4.23.22,
  Vitest, Playwright, Docker, and CI in `apps/db-data-admin/`.
- PR #129 configured the immutable GitHub Actions → GHCR → Coolify development path.
  `https://data-dev.designflow.app/` returned HTTP 200 and live HTML reported Step 10 merge
  build `39c2af6c704c41c5361fbbe33bcc71a3fe6b1348` on 2026-07-22.
- Microsoft SSO on development was repaired on 2026-07-22. Azure already contained the
  preview callback URI, but preview Supabase could not exchange the returned Microsoft
  code because its Azure credential value was invalid. A dedicated additive Azure
  credential named `supabase-preview-data-admin` now supplies preview Supabase only;
  production authentication was not changed. The frontend now displays OAuth callback
  failures and uses a short commit plus build date instead of the full SHA in the header.
- PR #130 added migrations `20260722002500` through `20260722003500` for explicit admin access,
  immutable audit events, per-profile grid state, CRM/PM/DAM extensions, and controlled
  Customer Channels. All seven are applied and contract-tested on preview
  `rjyboqwcdzcocqgmsyel`; they are intentionally not applied to production.
- Steps 5 and 6 are merged and tested on preview. PR #138 corrected deterministic PLM
  tri-state behavior, protected detail reads, and the Customer list signature; six database
  suites passed. Production stayed unchanged.
- Kimi K3 reviewed the complete plan/repository context and debated the implementation with
  Codex until both explicitly reached consensus: serialized schema/UI PRs, read-only Step 7,
  public RevoGrid templates, explicit cursor loading, lazy details, and no Step 8+ leakage.
- PR #139 delivered Step 7 Customer/Vendor RevoGrid Core views. PR #142 corrected the exact
  saved-view RPC contract and loud optimistic-conflict handling. Main CI passed lint, 10 unit
  tests, build, 3 Chromium tests, image publication, and Coolify deployment. Visual evidence
  is under `docs/verification/db-data-admin-step7-*`.
- Kimi K3 implemented the Step 8 schema/API migration and database contract suite. PR #147
  merged migration `20260722170000_db_data_admin_single_record_updates.sql`: protected
  Customer/Vendor update RPCs, an off-by-default write gate, optimistic concurrency,
  operation-id idempotency, structured expected failures, and immutable audit projections.
  The full preview database suite passed. Kimi's paid CLI quota was exhausted while correcting
  its final test fixture, so Codex completed that correction and the companion frontend.
- PR #148 delivered the Step 8 editor and audit timeline. It permits only curated display name,
  global status, CRM/PM/DAM status, and Customer Channels; every save requires a reason and
  stale records fail loudly. Main CI passed 13 unit tests, 3 Chromium tests, lint, build,
  container publication, and Coolify deployment. Visual evidence is under
  `docs/verification/db-data-admin-step8-*`.
- The `single_record_write` feature gate is enabled only on preview. The Step 8 migration and
  gate were not promoted to production.
- PR #150 delivered the Step 9 database workflow in migrations `20260722194000` and
  `20260722194100`: protected Customer/Vendor previews, exact FK counts, field-level extension
  conflicts, SHA-256 stale-preview protection, ordered advisory locks, explicit resolutions,
  operation-id idempotency, and immutable success/failure audit evidence. All eight rollback-
  safe DB Data Admin suites passed on preview; the final preview dry-run reported no drift.
- PR #151 delivered the merge dialog. It fixes the selected detail record as survivor, requires
  a duplicate, shows the direction and affected counts, requires every conflict choice plus a
  reason and irreversible confirmation, and refreshes the survivor/audit after success. Main
  CI passed 15 unit tests, 4 Chromium tests, lint, build, image publication, and Coolify deploy.
  Visual evidence is `docs/verification/db-data-admin-step9-merge-preview.png`.
- The `merge_execute` feature gate is enabled only on preview. Neither Step 9 migration nor
  merge execution was promoted to production.
- GLM 5.2 implemented Step 10 under Codex supervision. PR #153 added the protected read-only
  hierarchy RPC in migrations `20260722203000` and corrective `20260722203100`; PR #154 added
  the accessible Licensors tab. The contract reads the edge only from
  `core.property.licensor_id`, shows division/type-qualified PLM context, returns every orphan
  separately, and always states that live upstream reconciliation is not claimed. All nine
  rollback-safe DB Data Admin suites passed on preview. Main CI passed 22 unit tests,
  5 Chromium tests, lint, build, container publication, and Coolify deployment. Evidence is
  under `docs/verification/db-data-admin-step10-*` and
  `docs/verification/db-data-admin-licensor-property-tree-20260722.md`.
- A corrective pass over Steps 8–10 (2026-07-22, branch
  `claude/db-data-admin-steps8-10-perfect`) closed gaps against `DB_Data_Admin.md`: the merge
  preview now shows the exact token-covered aliases/source references that move (additive
  preview-first migration `20260722210000`, applied and verified on preview only); the merge dialog shows an accessible
  success receipt with the final survivor and audit/operation ID; merge candidates can be found
  beyond the loaded grid page; the Licensor tree makes every property reachable past the old
  24-item cap via a count-disclosing "show all"; the editor reflects an application's current
  status instead of defaulting to Active; and the stale concurrency-token save failure gained a
  one-click "Reload record" recovery. Dead CSS was removed and class mismatches reconciled.
  Local gates: lint, 29 unit tests, build, 6 Chromium tests, and `scripts/check-sql.sh` all pass;
  all nine rollback-safe DB Data Admin suites pass on preview and its final dry-run is clean.
  Production is unchanged, no previously applied migration was edited, and
  `fix_impl_visual_admin_page.md` remains untouched.
  Full evidence: `docs/verification/db-data-admin-steps8-10-corrections-20260722.md`.
- A same-timestamp collision was discovered immediately after PR #161 merged: the concurrently
  merged DAM migration and the DB Data Admin correction were both named `20260722210000_*`.
  Preview history proved the DB Data Admin migration owned `20260722210000`; the unapplied DAM
  migration was renamed to `20260722210100_dam_customer_hub_wiring.sql`. Preview then exposed and
  corrected generated-column writes, invalid/duplicate alias seeds, and a slow row-by-row asset
  backfill. The optimized distinct-name backfill applied successfully; both DAM and DB Data Admin
  rollback suites pass and the final preview dry-run is clean. Production remains untouched.
- Albert's active preview profile had the Administrator role and now has one explicit,
  non-revoked **preview-only** `admin` access row. It was added only after verifying the
  profile and role. No production grant or production database change was made.
- **Step 11 consumer enforcement is implementation-complete.** PM/PIM, CRM, and DAM picker
  changes are committed, deployed, and visually verified. Shared-db PR #188 (merge
  `437b69a`) added protected, explicit-app-access CRM/PM serving views and closed the two
  newly introduced DAM Customer merge FKs. PR #189 (merge `ade1b17`) records the complete
  evidence in
  `docs/verification/step11-enforcement-ledger-20260723.md`.
- Migrations `20260723223000_protect_app_picker_serving_contracts.sql` and
  `20260723223100_cover_dam_customer_fk_merges.sql` were applied preview-first, then promoted
  through a physically bounded production runner. `app_serving_status_contracts.sql` and
  `db_data_admin_merge_coverage.sql` pass on preview and production. The historical fixture
  assigns an inactive Customer UUID to `public.style_tracker_rows.customer_id` and
  `pim.product.company_id`; the merge fixture proves assignments repoint to the survivor and
  the loser identity remains through `core.company_source_ref` plus `core.customer_alias`.
- PM production visual acceptance passed in `TaskDetailModal`: the Retailer picker is
  populated and contains active-only labels. Evidence:
  `C:\Users\ahazan2\AppData\Local\Temp\codex-step11-browser\pm-task-detail-retailer-picker-final.png`.
  Production had no real inactive Customer assigned to `pim.product`, so no durable business
  row was fabricated merely for a screenshot; rollback-safe SQL proves that path.
- CRM production visual acceptance passed after app commit `66a2ed2`: active `Burlington`
  appears in Command Search, globally inactive `Midwest Marketing Associates, LLC` does not
  appear as a Customer, and a slow email-search group can no longer blank valid Customer
  results. CI built, published, deployed, and verified the commit. Evidence:
  `C:\Users\ahazan2\AppData\Local\Temp\codex-step11-browser\crm-search-active.png` and
  `crm-search-inactive.png`.
- DAM production acceptance passed for Licensed Originally Designed For, Licensed Sample
  Vendor, and Generic Special Customer. The final read contracts accept canonical DAM access
  or the live legacy PopDAM authority while exposing only picker-safe columns. Evidence and
  the failed attempts are in the Step 11 ledger.
- DesignFlow backend PR
  `https://github.com/popcre/designflow-backend/pull/64` is green and production-disabled,
  but remains open with no review. Its two commits add stable Customer/Factory master-data
  exports and an idempotent admin PLM-status operation. **Uma must review and merge it; the AI
  must not merge it.** This is the only formal Step 11 closure gate outside the AI's
  authority.
- Production remains safely read-only for DB Data Admin: `app.db_data_admin_feature_gate`
  is absent, no production `admin` grantee exists, and all six Step 8–10 write/merge/tree
  migration versions remain absent. Bulk operations (Step 12), production delivery
  (Step 13), optional grid consolidation (Step 14), and final superseded-plan removal
  (Step 15) remain.
- **2026-07-27 — the failing `DB Data Admin` check is fixed (PR #253, merge `0a87c20`).**
  `npm audit --audit-level=high` had been failing on every run, including commits that
  touched no code, with 5 high findings for `brace-expansion` (<=5.0.7,
  GHSA-mh99-v99m-4gvg) reaching the tree through eslint 9. The fix upgrades the lint
  toolchain only: eslint 9.39.2 -> 10.8.0, `@eslint/js` 9.39.2 -> 10.0.1,
  typescript-eslint 8.59.2 -> 8.65.0 (first line declaring eslint 10 support),
  eslint-plugin-react-hooks 7.0.1 -> 7.1.1, eslint-plugin-react-refresh 0.4.26 -> 0.5.3.
  No runtime dependency, migration, or schema change.
  **Do not "fix" this with an npm `overrides` pin on `brace-expansion@5.0.8`** — it clears
  the audit but breaks lint, because the bundled `minimatch` calls the v4 API and eslint
  dies with `TypeError: expand is not a function`. That path was tried and reverted.
  react-hooks 7.1.1 adds `set-state-in-effect`, which flags two pre-existing data-loading
  effects (`src/DataAdmin.tsx:299`, `src/LicensorTree.tsx:71`). Each carries a targeted
  `eslint-disable-next-line` and the reason, so the rule still errors on new code; the
  proper refactor (remount-by-`key`, which this screen cannot use until the cursor and
  grid-state refs stop needing to survive a tab switch) is open follow-up work.
  Verified before merge: `npm audit` 0 vulnerabilities, lint clean, build clean,
  55/55 unit tests, and main CI green.

### 4. What did not work

- The local Windows closeout could not run an `rsync` probe because `rsync` is not installed.
  The permanent answer is the real Ubuntu GitHub matrix test, which passed in all nine consumer
  repositories; do not add workstation setup for this.
- Playwright MCP left `.playwright-mcp/` logs in the repository root. They are generated
  scratch output, now ignored globally; durable screenshots belong under `docs/verification/`.
- The first closeout `npm` verification was mistakenly invoked from the repository root,
  which intentionally has no `package.json`, and returned `ENOENT`. Run frontend commands from
  `apps/db-data-admin/`; this was a working-directory error, not an application defect.
- Earlier handoff text said “PLAN ONLY” after PRs #127/#129/#130 had landed. This section
  supersedes that stale statement and records the actual verified state.
- The first Step 7 browser capture exposed a Customer column filter visually carrying into
  Vendors. Draft/applied filter state is now tab-isolated, and the final Vendor capture proves
  the input is cleared while rows remain visible.
- Mocked browser transport initially hid a saved-view RPC naming mismatch (`p_grid_key` versus
  real `p_entity_type`). Source-contract comparison caught it; PR #142 fixes it with a
  regression test and explicit version-conflict error.
- A synthetic HS256 user JWT made from the stored legacy JWT secret was rejected by current
  Supabase signing (`PGRST301`). Do not repeat that auth test; use real Microsoft SSO or
  current asymmetric signing tooling. The explicit preview grant itself was verified.
- During Kimi's non-interactive run, the Step 8 migration was unexpectedly applied to preview
  as timestamp `20260722170000` despite the prompt requesting no database mutation. Preview
  history was reconciled to the checked-in canonical file, the dry-run then reported no drift,
  and production was never linked or changed. Do not rename or edit that applied migration.
- Kimi's CLI remained blocked by its billing-cycle quota when Step 9 began, so its new read-only
  design check could not run. Codex proceeded from the previously Kimi-reviewed delivery plan.
- The first Step 9 preview test failed because hosted Supabase exposes pgcrypto under the
  `extensions` schema. The applied migration was not edited; corrective migration
  `20260722194100` qualified `extensions.digest`, after which all suites passed.
- GLM's first Step 10 preview execution used unsupported `max(uuid)` cursor aggregation. The
  applied migration was not edited; GLM added `20260722203100` using a deterministic text-cast
  UUID aggregate. The next run found a test-only nonexistent `jsonb_object_field_exists`
  helper; GLM corrected it to the native JSONB `?` operator. All nine suites then passed.
- A normal production `supabase db push --dry-run` from the full repository correctly refused
  because many older gated migrations sit before the production head. Do not respond with an
  unbounded `--include-all`. The successful Step 11 promotion used
  `C:\repos\shared-db-step11-promotion-runner`, whose migration directory physically contained
  the production ledger plus only `20260723223000` and `20260723223100`; its dry-run listed
  exactly those two files.
- The original CRM `crm_customer_picker_list` was `security_invoker=true`. In production this
  both excluded a valid PM/CRM test profile that had explicit app access but no shared role,
  and made bounded CRM `ilike` search exceed PostgREST's statement timeout. The protected
  security-barrier serving views in `20260723223000` fix both without exposing base tables.
- CRM Command Search initially remained stuck on “Searching…” even after the Customer view was
  repaired because `crm_email_routing_queue` independently timed out and `searchCrm` treated
  all four groups as one failure. Commit `66a2ed2` makes groups independent and reports each
  failed group loudly. Do not restore all-or-nothing search loading.
- The production dataset contained no inactive PM Customer assignment suitable for a
  historical-label screenshot. Creating fake durable production business data was rejected;
  preview and production rollback fixtures provide the required proof without persistence.

### 5. Root causes and key findings

- `shared-db` is both the canonical shared schema repo and the correct home for this app, but
  application source must never be mirrored into consumers. The checked-in sync exclusion is
  the automatic boundary.
- Production DesignFlow uses Cloud SQL for PLM Customer/Vendor status. DB Data Admin must use a
  protected DesignFlow operation and mirror the result back; it must not create a competing
  editable Supabase PLM status. See `docs/db-data-admin-inventory.md`.
- Merge engine coverage and the protected Step 9 workflow are complete. Production remains
  protected by the off-by-default database gates and the unpopulated production admin grant.
- App access and shared roles are separate concepts. Picker-safe serving contracts must check
  `app.has_explicit_app_access(<app>)` at the protected view boundary rather than accidentally
  inheriting broad base-table role policies.
- Stable DAM Customer UUIDs added to `public.assets` and `public.style_groups` created two new
  FKs after the earlier merge inventory. Migration `20260723223100` and the coverage suite now
  force `core.merge_customer` to repoint both before deleting a loser.

### 6. Exact next steps

1. Have Uma review and merge DesignFlow backend PR #64 into `develop`; do not self-merge.
   Re-run/confirm `forbid-shared-db-bypass` and the sandbox Cloud Build check after the merge.
   **Pass when** the PR is merged by the authorized reviewer and the sandbox endpoints still
   return stable IDs while production status writes remain disabled.
2. Implement Step 12 from `DB_Data_Admin.md`: bulk preview/count/confirm, mandatory reason,
   per-record audit, partial-failure reporting, and recovery/reactivation. Use a new
   shared-db branch, new migrations, preview dry-run/apply, database tests, frontend unit
   tests, and browser evidence. **Pass when** bulk success, partial failure, retry, audit, and
   reactivation all work on preview without changing production.
3. Prepare Step 13's explicit production manifest. Include only the reviewed DB Data Admin
   write/merge/tree/bulk migrations in a physically bounded runner; never run unrestricted
   `--include-all`. **Pass when** the production dry-run lists exactly the approved versions.
4. In Albert's approved production window, promote the bounded manifest, create only the
   approved explicit `admin` app-access grants, enable the production feature gates, and
   enable the reviewed DesignFlow Customer status path. Vendor PLM writes remain disabled
   until the stable `Factory.id` → `core.factory_source_ref` mapping is reviewed and
   populated. **Pass when** administrator writes/merges/bulk operations audit correctly,
   denied users remain denied, and every consumer picker still passes.
5. Complete the GitHub Actions → GHCR → Coolify production deployment at
   `https://data.designflow.app`. Verify Cloudflare DNS/TLS, Supabase Auth allowlist,
   Microsoft/Entra redirect URI, SSO callback, `/health`, administrator and denied-user
   behavior, and the live build SHA. **Pass when** the production URL serves the approved SHA
   and the full database/application/browser suite passes.
6. Treat Step 14 grid consolidation as optional post-launch product work; migrate an existing
   non-DesignFlow screen only for a real product reason and after parity tests.
7. Execute Step 15 only after every Definition-of-Done item is checked. Reconfirm every unique
   requirement in `fix_impl_visual_admin_page.md`, then delete that file and all inbound
   references in one final PR. **Pass when** the final audit proves nothing unique was lost.

### 7. Constraints and gotchas

Use a new shared-db branch and PR for each serialized schema tranche; preview first, additive
by default. Do not touch the separate ERP relocation objects. Do not seed a production admin
grantee without Albert's approval. Do not expose the `dam` schema through PostgREST. Keep
Licensor/Property read-only in v1. Do not delete `fix_impl_visual_admin_page.md` until every
final completion condition in `DB_Data_Admin.md` has passed.

### 8. Access and environment

GitHub CLI, Supabase CLI, Coolify orchestration, and Microsoft/Entra configuration paths have
been exercised. Database and deployment credentials belong only in the 1Password
`vibe_coding` vault or the documented GitHub/Coolify secret stores; no secret value belongs in
the repo. Preview is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`.

### 9. Open questions and risks

The production admin-grantee list remains deliberately empty; Albert's explicit grant exists
only on preview. Vendor PLM status cannot ship until PR #64 is reviewed and a one-time stable
Factory-ID mapping populates `core.factory_source_ref`. Coldlion corrected `/vendors` to 97
factory-only records on 2026-07-22, but `core.factory` still requires the separate reconciliation
described in `fix_vendor_reconcile.md`. Production promotion requires an approved window,
formal Step 11 closure, completed Step 12, and an exact bounded manifest.

### DB Data Admin handoff self-audit — 2026-07-23

1. **Could a street-new developer continue without questions? Yes.** Sections 1–3 define the
   application, repositories, URLs, completed delivery steps, exact migration/commit/PR
   evidence, and the one external review gate. Sections 6–9 provide ordered actions,
   verification gates, constraints, access locations, and risks.
2. **Could they continue as effectively as this session? Yes.** Sections 3–5 preserve the
   production/preview boundary, bounded-runner method, live browser findings, failed
   approaches, CRM/PM authorization root cause, and no-fabricated-production-fixture decision.
3. **Are failed attempts and their causes present? Yes.** Section 4 includes the earlier
   implementation failures plus the full-directory production dry-run refusal, CRM view
   timeout, all-or-nothing Command Search failure, and absent historical production fixture.
4. **Is every next step executable and verifiable? Yes.** Every numbered item in Section 6
   identifies the target, authority boundary, action, and an explicit “Pass when” condition.
5. **Are newcomer terms, paths, URLs, and identifiers explained? Yes.** Sections 1, 3, 7, and
   8 define the app, environments, project refs, repositories, migration paths, secret
   locations, production runner, and deployment route.

Final synthesis:

1. **Is `HANDOFF.md` comprehensive enough for a brand-new developer to continue without
   skipping a beat? Yes.** Supported by Sections 1–9 and the dated Step 11 ledger linked in
   Section 3; no gap remains.
2. **Could they continue as well as the current session with all relevant background? Yes.**
   Sections 2–5 contain the goals, history, failures, root causes, and evidence; Sections 6–9
   contain the operational continuation path.
3. **Is every relevant background, goal, outcome, state, failure, decision, constraint, risk,
   next action, and verification fact present? Yes.** Those categories map directly to
   Sections 1–9. The only unfinished external action—Uma's PR #64 review—is explicit rather
   than hidden or treated as AI-authorized.

---

## HTS RAG rulings table — complete in preview and production

### What this application and change are

`u2giants/shared-db` is the migration source of truth for the hosted Supabase database
shared by POP Creations applications. DesignFlow's backend is adding an AI-assisted HTS
classification workflow. When a CBP customs ruling is a useful match, the backend will cache
the public ruling text and classification metadata so later classifications can reuse a fast,
grounded result.

The additive migration
`supabase/migrations/20260721203000_hts_rag_rulings.sql` creates
`public.hts_rag_rulings`. It was merged through
[PR #128](https://github.com/u2giants/shared-db/pull/128) in commit
`be0162221fa3f952118abd6e13142f965fffc50e`. It was promoted to production on
2026-07-21 after the DesignFlow Sequelize model and upsert passed local preview testing.

### Current verified state

- Preview is project `rjyboqwcdzcocqgmsyel`, Supabase branch
  `shared-db-schema-rehearsal`. This persistent preview was rebuilt as a production data clone
  because legacy DAM objects predate replayable repository migration history.
- Preview now reports latest migration `20260721203000`; the table exists there.
- Production project `qsllyeztdwjgirsysgai` reports migration `20260721203000`; the table
  exists there. The production push was bounded to this migration only. Seven newer DB Data
  Admin migrations remained unpromoted by using a clean temporary checkout ending at the
  approved migration.
- The 1Password `vibe_coding` item
  `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`
  contains the working preview pooler tuple. Use `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
  `DB_NAME`, and `DB_PORT`; SSL is required. Never copy the password into Git or chat.
- The preview database password was deliberately reset on 2026-07-21 and the matching
  GitHub Actions secret `SUPABASE_DB_PASSWORD_PREVIEW` was updated.
- A Node `pg` connection using the exact 1Password pooler tuple completed transactional
  INSERT, UPDATE, SELECT, and DELETE against `public.hts_rag_rulings`, then rolled back.
  The connected `postgres` role owns the table, has direct CRUD privilege, has
  `BYPASSRLS`, and saw RLS inactive for that session. No test row persisted.
- The deployed DesignFlow services `popcre-albert-core-sandbox` and
  `popcre-albert-core-sandbox2` deliberately remain connected through the canonical
  `*_SANDBOX` GCP secret tuple to shared production Supabase project
  `qsllyeztdwjgirsysgai`. **Do not repoint those secrets to preview.** Preview is only for
  local model/upsert testing and may be rebuilt or reset. The production verification used
  this unchanged GCP sandbox connection tuple and successfully reached the new table.
- Production verification confirmed the expected primary/unique/date/revocation indexes,
  `service_role` CRUD privilege, revoked `anon`/`authenticated` access, enabled non-forced
  RLS, table ownership by `postgres`, JSONB arrays, unique enforcement, and direct CRUD.
  The `set_updated_at` trigger advanced the timestamp across separate committed statements.
  All verification rows were deleted; none remain.

### What failed and why

1. The old preview project had irreconcilable migration history, so it was replaced with
   `rjyboqwcdzcocqgmsyel`. A data clone was required because a schema-only replay could not
   reproduce legacy objects absent from repository migrations.
2. `supabase branches get` displays database passwords as the literal masked value `******`.
   An initial credential refresh mistakenly persisted that placeholder, making pooler login
   fail with PostgreSQL error `28P01`. The preview password was reset through the Supabase
   Management API, then the real value was written directly to 1Password and GitHub Actions
   without printing it.
3. After valid pooler authentication was restored, a direct query showed preview stopped at
   migration `20260717163500` and lacked `hts_rag_rulings`. Running preview dry-run exposed
   eight pending migrations; all eight were applied in repository order. The final migration
   is now `20260721203000`, and the CRUD proof passes.
4. Investigation confirmed deployed sandbox points to production, not preview. This is the
   intended architecture, not a defect: local tests use preview; approved migrations then
   move to production, where deployed sandbox sees them with zero secret changes.

### Exact next steps and verification gates

The shared-db portion is complete. Continue in `popcre/designflow-backend` under its normal
DesignFlow sandbox/Uma-review workflow. **Pass when:** the already preview-tested model and
upsert service are committed, pushed, reviewed, and deployed, then a backend-level smoke test
uses the production table through the unchanged `*_SANDBOX` connection tuple.

### Constraints, access, questions, and risks

- No shared-db production promotion remains for this HTS table.
- This is additive; do not edit the applied migration. Any correction must be a new timestamped
  migration and must follow preview-first workflow.
- `service_role` grants cover API/JWT access. Direct Sequelize pooler access uses the database
  `postgres` role, which was verified to own the table and bypass RLS.
- Authenticated tools exercised this session: `gh`, `gcloud`, `supabase`, and 1Password.
  Runtime secrets remain in 1Password vault `vibe_coding` and GCP Secret Manager; no secret
  value belongs in repository files.
- No open shared-db question remains. Application deployment belongs to the DesignFlow backend
  workflow and must not introduce startup DDL or change database secrets.

---

## 📌 Session 2026-07-20/22 — data/schema work (COMPLETED + OPEN ITEMS)

Full narrative: [`docs/app-migration-notes/session-2026-07-21.md`](docs/app-migration-notes/session-2026-07-21.md).

### Completed + deployed to prod this session (all verified)
- **PLM sync failure-logging** (PR #107) — the host wrapper now writes a committed `status='failed'`
  `ingest.sync_run` row + `systemd OnFailure` alert. **Merged to repo but NOT yet deployed on the hetz
  box** (see OPEN #4).
- **Vendor/factory schema** (PR #102) — `core.factory.display_name`, `core.factory_alias`,
  `core.merge_factory(p_loser, p_survivor, p_alias_loser_name)`. Was merged-but-unapplied; deployed.
- **Item→taxonomy Phase 2a/2b foundation** (PRs #110/#115) — `plm.merch_group_header`,
  `plm.item_import`, `plm.item_import_staging`, `plm.item_import_unresolved`,
  `plm.item_taxonomy_disagreement`, `plm.import_item_master_data(jsonb)`,
  `plm.import_merch_group_headers(jsonb)` + tooling. **`plm.item` is LIVE but 0 rows** — Phase 3 not run.
- **Vendor curation + dedup** (PRs #113/#115/#118) — status seed, 4 not-a-factory purges, directus
  reassignment (33 products + 20 style bridges, 0 orphans), 9 exact-name dup merges.
- **Coldlion `/vendors` wrong-table — RESOLVED.** Coldlion fixed it 2026-07-22: `/vendors` now serves
  **97 factory-only records** (was 539 mixed with freight/gov/bank/courier service-providers).
- **Vendor reconcile EXECUTED** (PRs #140/#141, migration `20260722140000_...`). **`core.factory` is now
  93 rows (91 active / 2 inactive)** — factories only. 418 stale old-feed rows purged; Anthony's
  Warehouse (`ANT001`) re-added **inactive** per Albert (kept, not excluded), mirror relinked; the blank
  `CNWAH` record skipped. Plan: [`fix_vendor_reconcile.md`](fix_vendor_reconcile.md) (marked executed).

### 🔵 OPEN ITEMS — exact next actions (data/schema side)

**OPEN #1 — Refresh the `plm.erp_vendor` mirror to the corrected 97. ✅ DONE 2026-07-22.**
- *Done:* migration `20260722171500_refresh_erp_vendor_mirror_to_corrected_vendors.sql` (PR #145,
  merged, applied to preview then **production**). The live `/vendors` feed was pulled and verified = 97
  (all active) before authoring; the mirror's own 97 *active* rows were already exactly those codes, so
  rather than a risky ad-hoc service-role re-pull, the migration deterministically **deletes the 442
  stale inactive service-provider rows** (guarded: asserts the allowlist = 97 and **aborts if any active
  mirror row falls outside it**) and records a completed `ingest.sync_run` (`mode=mirror_reconcile`).
  `core.factory` and bronze `ingest.raw_record` were untouched.
- *Prod verified:* `plm.erp_vendor` = **97**; `core.factory` unchanged at **93 (91/2)**; ANT001 still
  inactive; 0 factories lost mirror representation; prod sync_run `05d09a73-...` succeeded (before=539,
  deleted=442, after=97).
- *Known benign leftover (small follow-up, folded into OPEN #5):* **8 `core.factory_source_ref` rows**
  are mislabeled `source_system='coldlion'` with **numeric legacy IDs** (415, 99, 147, 403, 244, 457,
  476, 472) that were never real Coldlion vendorCodes. Their old mirror rows were correctly deleted, so
  these refs now point at no mirror row — but every one of the 8 factories still carries its **real**
  Coldlion code (CNJAM, SKPHL, CNHDL, CNRPH, CNDWG, …), which IS mirrored. Harmless; cleanup = either
  delete these duplicate numeric refs or relabel them `source_system='directus'`/`legacy`.

**OPEN #2 — Plan for a RECURRING vendor sync (two mandatory guards). ✅ DONE 2026-07-22 (plan written).**
- *Done:* [`fix_vendor_sync.md`](fix_vendor_sync.md) (PRs #145/#156/#157, merged; GLM-reviewed, review at
  `.ai/reviews/vendor-sync-plan-glm-2026-07-22.md`). Full design for the scheduled vendor sync: **weekly
  cadence on a Supabase Edge Function + scheduled invocation** (NOT the hetz systemd host — that box's PLM
  sync is broken/undeployed, OPEN #4), `ingest.sync_run` accounting with the **PR #107 durable-failure**
  pattern + empty/short-pull guard, **upsert by `(source_system, source_table, source_id)`** (prevents
  re-splitting merged dups / re-adding purged rows), and both mandatory guards:
  1. **Reject blank/nameless** (`CNWAH`, live-confirmed still blank) → loud `plm.vendor_quarantine`
     table + `rows_failed`; never into `core.factory`.
  2. **Persist "not a factory" exclusions** in a durable `plm.vendor_exclusion` table the importer
     consults every run — **seed the 418 purged service-provider codes too** (GLM S1: otherwise "no
     re-add" is only true because today's feed omits them), plus ANT001 and the re-review rulings
     (Buildasign, May Group Deco Sign, `FLGDS`, `INTUF`, Royal Packers, Royal Union). **Status is
     app-owned — set on INSERT only, never overwritten on re-pull.**
  The plan also **flags that the existing `plm.import_coldlion_vendors` VIOLATES guard 2** (it force-sets
  `status='active'` on matched rows) and must be superseded/dropped when the guarded importer is built.
- ⚠️ **Twin bug (record so it's not lost):** `plm.import_coldlion_customers` has the SAME status-clobbering
  flaw (`status='active'`, `is_potential=false` on matched rows). Customers are marked "done" but run on
  this flawed importer — open a twin fix when the guarded vendor importer lands.
- ✅ **Phase A DONE + PROD-VERIFIED 2026-07-22** (migration `20260722213000`, PR #160): `plm.vendor_exclusion`
  (seeded 435 = 434 purged + ANT001), `plm.vendor_quarantine`, guarded `plm.sync_coldlion_vendors` (M1/M2/
  S7/S8 fixes), `public.sync_coldlion_vendors` + `public.record_failed_sync_run` wrappers,
  `api.vendor_{quarantine,exclusion,sync_run}_list`, grants; old `plm.import_coldlion_vendors` dropped.
  `tools/sync-coldlion-vendors.mjs` (+tests). Validated on preview (rolled-back txn: full §7 gate +
  removal-safety). First prod run: `seen=97, inserted=0, updated=95, failed=1 (CNWAH quarantined),
  skipped=1 (ANT001), deleted=0`; `core.factory` unchanged 93 (91/2). The 6 borderline vendors are VALID
  factories (Albert), NOT excluded. **Bounded prod apply** (only 20260722213000; did NOT sweep the
  unrelated `194000`–`210000` migrations, which remain preview/other-workstream).
- 📋 **Phase B NOT built:** the scheduled Edge Function + alerting. First **verify pg_net/Vault are
  actually available** (they are unused in this project); build the overdue/failed-run alert BEFORE
  enabling the schedule. Full spec: `fix_vendor_sync.md` §6/§8.

**OPEN #3 — Item→taxonomy Phase 3+ (backfill then cutover).**
- *What/why:* `plm.item` is built but empty; items are still served from `public.erp_items_current`
  with text licensor/property codes (no FK). Coldlion `/items` is back to HTTP 200 (19,066 items /
  9,533 pages), so Phase 3 is unblocked.
- *Next step:* Phase 3 — run the item sync to backfill `plm.item` via `plm.import_item_master_data`
  (pull `/merchGroupHeaders` for ALL divisions first — the resolver needs the per-division dictionary).
  Then Phase 4 cutover: repoint `api.plm_item_list` from `public.erp_items_current` → `plm.item`, keep
  the legacy pull refreshed through the deprecation window, defer the style-bridge FK repoint to Phase 5.
- *Gate before Phase 4:* row-parity check + grants/RLS on the new `plm.*` tables + an **app-repo grep**
  (`erp_items_current`, `licensor_code`, `property_code`, name-based lookups) in popdam/popcrm/dflow/
  poppim. Full spec + locked decisions: [`fix_item_taxonomy_wiring.md`](fix_item_taxonomy_wiring.md) §7b.

**OPEN #4 — Deploy PR #107 on the hetz box + the upstream PLM 502.**
- *What/why:* the PLM master-data sync (`getLicensorsWithProperties`) has returned HTTP 502 since
  2026-07-08 — licensors/properties can't refresh. PR #107 fixes the silent-failure logging but must be
  deployed where the sync runs.
- *Next step:* on hetz — `cd /worksp/shared-db && git pull && sudo systemctl daemon-reload` (deploys the
  wrapper + `plm-sync-alert.service`). Separately, the upstream 502 is a DesignFlow/Cloud Run problem
  (api.designflow.app), not ours — raise it. *Verify:* force a failed run and confirm a `status='failed'`
  `ingest.sync_run` row + the alert fire.

**OPEN #5 — Residual fuzzy vendor duplicates + mislabeled source-refs (low priority).**
- The fuzzy-dup sheet (`docs/vendor-review/vendor_fuzzy_dupes.csv`) is mostly MOOT now — most of its 69
  pairs were the service-providers Coldlion removed. But a few genuine Chinese-factory dups may remain
  among the clean 93 (Taizhou Meihua / Xianju Fenda variants etc.). Optional: re-run exact + fuzzy
  detection on the 93 and merge any confirmed pairs via `core.merge_factory`.
- *Added 2026-07-22 (from OPEN #1):* clean up the **8 mislabeled `core.factory_source_ref` rows** with
  numeric legacy IDs (415, 99, 147, 403, 244, 457, 476, 472) recorded as `source_system='coldlion'` but
  which were never real Coldlion vendorCodes. Either delete them (each factory keeps its real Coldlion
  code) or relabel `source_system='directus'`/`legacy`. Benign — no factory lost mirror representation.

**OPEN #6 — Carried-forward security item.** Production DB password possibly exposed 2026-07-10; rotation
status unverified. Confirm and close.

> **Cross-workstream note:** the **DB Data Admin** app (its own workstream at the top of this file) is the
> serving/UI layer for these curated Customers/Vendors/Licensors/Properties. The **DesignFlow production
> DB-port incident** (its own section) is a separate infra workstream with its own open steps.

---

## 🔴 DesignFlow production DB-port incident — remediation state 2026-07-20

**Read the comprehensive incident record first:**
[`docs/incidents/20260717-designflow-production-db-port.md`](docs/incidents/20260717-designflow-production-db-port.md).
Detailed GCP source-of-truth and operations live in `popcre/infrastructure`:
`popcre/gcp/live/production-database-safety-plan.md` and
`popcre/gcp/live/production-db-secret-break-glass.md`.

### What happened and why

`fix_connection_pool.md` generalized a sandbox hosted-Supabase pooler design to
production without first inventorying each environment. A later Codex session
changed unsuffixed production `DB_PORT` from Cloud SQL port `5432` to Supabase
pooler port `6543`. Production used the correct Cloud SQL host with the wrong
port and failed. The plan-writing failure mattered as much as the later command:
no provider-by-environment inventory, complete-tuple comparison, production
approval gate, numeric version pin, negative build fixture, startup rejection,
or zero-traffic connection proof stopped the error.

### Correct contract and ownership

- Develop/staging/sandbox: hosted Supabase pooler, `6543`, SSL on, complete
  `_DEV`/`_STAGING`/`_SANDBOX` tuple.
- Production: Cloud SQL, `5432`, SSL off under the current contract, private VPC,
  complete unsuffixed tuple, numeric versions only.
- `shared-db` owns schema/migrations/data contracts. `popcre/infrastructure`
  owns GCP Secret Manager IAM, Cloud Build triggers, Cloud Run bindings, VPC
  routing, and version pins. App repos own startup validation/readiness/tests.
  `ai-devops` owns universal external-state rules and pointers.

### What is complete and live

- Infrastructure PRs #12–#14: machine-readable connection contract; nine
  passing positive/negative fixtures; explicit five-secret substitutions;
  numeric production version pins; four production triggers disabled; sandbox
  secret boundary repaired; critical secret-version alert enabled.
- A deliberate Cloud SQL + `6543` build
  (`c266a112-eaea-4dd9-997a-a7f66ac3d310`) failed in step 0 before image or
  deploy.
- Corrected application commits: Backend `1a28265` PR #62, Item Master
  `1afb25b` PR #37, Tracking `ed2ff6d` PR #25, Data Syncing `a48b8a7` PR #16.
  Combined proof: 109 suites / 741 tests. All four PRs are green, open, and now
  request review from Uma's GitHub user `devopswithkube`.
- Production reused its known images in zero-traffic candidates, proved Cloud
  SQL `10.75.208.4:5432`, SSL off, private VPC, and numeric DB secret version
  `1`, then moved 100% traffic to `core-00010-bof`, `item-00010-ben`,
  `tracking-00010-riv`, and `sync-00007-suh`. `https://designflow.app` returned
  HTTP 200.
- Infrastructure PRs #15–#17 culminated in `9ad06f1`. Terraform applied 24
  additions, zero changes, zero destroys: scoped nonproduction and reserved
  production writers, 20 secret IAM bindings, one nonproduction impersonation
  binding, and critical access-control alert `10443910794556794963`. Final plan:
  no changes.
- Read-only IAM tests prove the nonproduction writer can version `DB_PORT_DEV`
  but not production `DB_PORT`; the production writer has no impersonator.
- 1Password vault `vibe_coding` contains a non-secret recovery note titled
  `DesignFlow production DB secret approval gate`, ID
  `iwmlvzmx3acqknbktnwuu5x5bi`. Runtime values remain in GCP Secret Manager;
  recovery values/notes belong in 1Password, never Git or chat.

### What failed and why

The first hard-gate design planned a project deny policy plus a one-hour PAM
entitlement. Google rejected the temporary `roles/iam.denyAdmin` bootstrap
binding before Terraform apply because Deny Admin can be granted only at
organization level. The project has no parent and the authenticated account
sees no Google Cloud organization. PAM also requires an organization-level
service agent. No temporary role remained, no partial deny/PAM resource was
created, and no secret or workload changed. PR #16 removed the undeployable
resources before safely applying the 24 foundations.

The first acceptance-script run also exposed a PowerShell representation issue:
an empty denied permission response arrived as `null`, not an empty array. PR
#17 fixed null/empty handling. The script now proves the scoped identities, then
intentionally returns `BLOCKED` because Albert's project Owner role still grants
direct secret-version mutation.

### Exact remaining steps and verification gates

1. Create/select the company-controlled Google Cloud organization and move
   `lithe-breaker-323913` beneath it without changing project ID, billing,
   services, data, or secret values. **Pass:** project parent is the intended
   organization and production remains HTTP 200 on the same revisions.
2. Configure organization Deny Admin and Google's PAM service agent through
   infrastructure Terraform. **Pass:** plan contains only intended IAM/PAM
   additions, zero unrelated changes/destroys.
3. Restore the deny policy and one-hour entitlement: Albert requester, Uma
   (`devopswithkube@gmail.com`) sole approver, mandatory reasons, Token Creator
   restricted to the exact production break-glass writer. **Pass:**
   `Test-DbSecretGuardrails.ps1` reports every check passed instead of the
   intentional Owner blocker.
4. Conduct a no-secret-change request/approve/expire exercise. **Pass:** Albert
   cannot impersonate before/after; can during the approved window; both alerts
   identify the actors; no secret version is added.
5. Uma reviews the four application PRs. **Pass:** Uma—not an AI—merges approved
   changes to `develop`. Production continues using Cloud SQL/`5432`; these PRs
   add safe pool/readiness behavior, not a provider migration.

### Non-negotiable constraints

Do not self-approve, make Albert a deny exception, create a service-account key,
grant standing production impersonation, put database values in GitHub inputs,
re-enable production triggers early, or follow the historical production steps
inside `fix_connection_pool.md`. Unsuffixed secrets are production-only and no
schema task or sandbox task implicitly authorizes touching them.

---

## 🟠 Two live outages found 2026-07-19 — `/items` + alerting FIXED; PLM upstream 502 still open

Both were discovered while answering a documentation question. **Neither has been repaired,
and neither is alerting.** They are the highest-priority items in this file.

### Outage 1 — the PLM master-data sync has been dead since 2026-07-08

**What is broken.** `tools/sync-plm-master-data.mjs` runs nightly at 03:30 via
`systemd/plm-sync.timer` on the `hetz` VPS. It pulls licensor/property master data from
DesignFlow PLM and loads it through `plm.import_master_data()` into `core.licensor` /
`core.property`. Its last successful run was **2026-07-08**. As of 2026-07-19 that is
**11 days stale**.

**Why it is broken.** The upstream endpoint is down:

```
GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties
→ HTTP 502 after ~31 seconds  (retried; consistent)
```

The ~31s latency before the 502 looks like the origin timing out rather than a bad key or a
gateway rejection. The API key at
`op://vibe_coding/DesignFlow PLM Canonical Master Data API/api_key` was used and is not
implicated — a bad key returns a fast 401/403, not a slow 502.

**Why nobody noticed — this is the more serious bug.** `ingest.sync_run` holds 15 runs for
`source_system='designflow_plm'` and **every single one has `status='succeeded'`**. There
are zero failure rows. The sync did not record an error; it simply stopped appearing.
Verify with:

```sql
select now()::date as today, max(started_at)::date as last_sync,
       (now()::date - max(started_at)::date) as days_since,
       count(*) filter (where status <> 'succeeded') as non_success_runs
from ingest.sync_run where source_system='designflow_plm';
```

This violates the house "no silent failures" rule. **A failed run must write a row with
`status <> 'succeeded'` and a populated `error` column, and must alert.** Fixing the
alerting matters more than fixing the outage — the outage is visible once alerting exists.

> **UPDATE 2026-07-20 — the alerting half is FIXED (PR #107, merged).** Root cause found:
> `plm.import_master_data()` set `status='failed'` then re-raised, so the aborted
> transaction rolled the failed row back; and the 502 fails in `fetchJson()` before the
> import transaction even starts — so failed runs left **no** row (not a false success).
> The host wrapper (`tools/sync-plm-master-data.mjs`) now writes a **committed**
> `status='failed'` row (separate transaction) capturing error + stage, and
> `systemd/plm-sync.service` gained `OnFailure=plm-sync-alert.service` (journal +
> `/home/ai/plm-sync-failures.log`). Unit tests in `tools/sync-plm-master-data.test.mjs`.
> **Remaining:** (a) the upstream 502 itself is still unfixed — the sync still cannot pull;
> (b) the fix must be deployed on the `hetz` sync box (`cd /worksp/shared-db && git pull &&
> sudo systemctl daemon-reload`) before it takes effect there.

**A second thing to look at while you are in there.** Every historical run recorded
`rows_seen=560, rows_inserted=560, rows_updated=0`. A daily reconciling sync that has
*never once* recorded an update strongly suggests wholesale re-insert rather than
reconciliation. Worth understanding before trusting the loader.

**Where to start.** Check whether `api.designflow.app` is up at all, then the Cloud Run
service behind it. Note DesignFlow runs on **Cloud SQL, not Supabase** — do not go looking
for this in the Supabase dashboard.

### Outage 2 — Coldlion `GET /items` returns a server-side 500

```
GET http://x5.coldlion.com/EhpApi/items?companyCode=EDGEHOME&divisionCode=CW001&size=5
→ 500  {"exception":"java.lang.NullPointerException","path":"/EhpApi/items"}
```

Reproduced with and without `divisionCode`, with `modifiedFrom`, with `merchGroup05`, and at
several page sizes. **It is server-side and unconditional.** It was working 2026-07-15 per
`docs/coldlion-erp-api-reference.md`, so it broke within four days.

> **UPDATE 2026-07-20 — FIXED upstream.** `GET /items` now returns **HTTP 200** (verified
> live: 19,066 items across 9,533 pages, `size=2&page=0`). The NullPointerException is gone.
> This **unblocks the item→taxonomy wiring** (Phase 2+ of `fix_schema_for_api.md`), which is
> now the active build (see the new item→taxonomy plan referenced below).

Every other read endpoint was verified healthy the same day — `/customers`, `/vendors`,
`/inventory`, `/merchGroupHeaders`, `/merchGroupDetails`, `/seasons`, `/itemDetails` all
200. (`/salespersons` returns 400 without extra params; that is a parameter issue, not an
outage.)

**Impact.** `/items` is the only endpoint carrying `hasImage` and the `merchGroup01–14`
pointers on each item. It also blocks the co-occurrence approach described in
`docs/merch-group-taxonomy-architecture.md` §10.2. **This is Coldlion's server, not ours —
it likely needs to be raised with them rather than fixed here.**

---

## Merch-group taxonomy — now fully documented (2026-07-19)

**Read [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md)
before touching anything named licensor, property, big theme, little theme, style guide, art
type, art source, artist, age group, or `mgTypeCode`.** It was written from live Coldlion API
calls, live Supabase queries, and a full read of all six `popcre/designflow-*` repos.
Shipped in [PR #103](https://github.com/u2giants/shared-db/pull/103).

**The short version.** Coldlion owns the *vocabulary*, DesignFlow owns the *relationships*,
Supabase is a downstream mirror of both. Coldlion does have explicit licensors and properties
(22 and 258 in CW001) — what it lacks is any link between them and any active/inactive flag.

**Three rules that cause real damage when ignored:**

1. `mgTypeCode` has **no fixed meaning**. `05` is Licensor in CW001/SP001 but "Big Theme" in
   EH001 and "Product Line" in EP001. Resolve through `(divisionCode, mgTypeCode) → mgTypeDesc`.
2. Coldlion has **no hierarchy and no active flag**. Both are DesignFlow-owned. A direct
   Coldlion sync cannot reproduce either, and would resurrect dead licenses.
3. Codes are unique **only within `(division, mgTypeCode)`**. `FR` is a licensor in our DB and
   a *property* in Coldlion. Never look up by `mg_code` alone.

### Corrections this made to earlier docs

Prior documentation was wrong on two points, both now fixed in-place:

- `coldlion-erp-to-supabase-field-mapping.md` said "Coldlion has no explicit licensor." It
  does. The gap is the relationship, not the entity.
- Several docs stated `merchGroup05 = licensor` / `merchGroup06 = property` flatly. True for
  two of four divisions only.
- The "partial licensor import (37 PLM vs 20 core)" was **not** partial. 37 staging rows hold
  20 distinct codes; `core.licensor`'s `unique nulls not distinct (code)` deliberately
  collapses the division dimension. Nothing is dropped.

### Open decision that needs a human — `FR` / FRIENDS TV

`core.licensor` carries `FR` = FRIENDS TV (1 property), from `plm.licensor_import` id 199,
division 1. **Coldlion has no `FR` licensor** in either licensed division — there, `FR` is a
*property* meaning "1ST ORDER TROOPER."

Because the ETL has no delete or tombstone path, either it was created directly in PLM or it
was removed from Coldlion after an earlier sync. **The data cannot distinguish these.** It is
the only licensor in our canonical table with no upstream ERP anchor. Someone who knows the
licensing history needs to decide whether it stays.

### Open design question — the division collapse

`core.licensor` merges POP Lic and Spruce Lic into one row per code. That is correct if a
licensor is a company (Disney is Disney). It is **wrong the moment division 9 is imported**,
because MG05 there means "Big Theme," not "Licensor." Decide before importing EH001.

### What was NOT done

- Neither outage fixed (see above).
- **15 defects catalogued in §9 of the taxonomy doc are documented, not fixed.** Notable:
  a `vendor`-role authorization gap letting external vendors create/soft-delete taxonomy;
  a dedup key including `mg_desc` so renames create duplicate rows; the merch-group *header*
  sync hard-coded to `divisionCode=EH001` so the CW001/SP001 definitions are never fetched.
- The co-occurrence approach for deriving the hierarchy from Coldlion alone is **untested** —
  `/items` was down.

### Gotchas that cost time this session

- **The six `designflow-*` repos are at `C:\repos\dflow\designflow-*`**, not siblings of
  `shared-db`. All on branch `sandbox-albert`.
- **Do not route Coldlion calls through `bash` on Windows.** A bare `bash` resolves to WSL,
  which does not inherit injected env, so the API key arrives empty and Coldlion answers
  `400 Missing request header 'X-API-Key'` — which looks like a broken tool but is not. Use
  `op_run` with `shell: powershell` and `$env:VAR`.
- **`cmd.exe` cannot expand `%%VAR%%` loops** outside a batch file. Use PowerShell for any
  loop over divisions or type codes.
- `/merchGroupDetails` returns a **plain JSON array**, not the paged `{content:[...]}`
  envelope most Coldlion endpoints use. Parsers written for the envelope will break.

---

## RETRACTED workstream — DesignFlow database connection architecture

> **STOP — the remainder of this section is an incident artifact, not a current
> implementation guide.** It incorrectly generalized the sandbox hosted-Supabase
> connection to production, which remains on Cloud SQL. A Codex session then
> changed the unsuffixed production `DB_PORT` from `5432` to `6543` and broke the
> live site. Do not merge any historical PR head based on this section's old
> evidence, do not follow the production steps below, and do not mutate
> unsuffixed GCP DB secrets. The current PR heads have since been revalidated and
> are assigned to Uma; the authoritative current state is at the top of this
> handoff and in the incident record.

### What this is

DesignFlow is POP Creations' product-lifecycle-management system used by staff to manage RFQs,
items, licensing/tracking, and ERP synchronization. Its Angular frontend and BFF call four Node.js
/ Express / Sequelize services (Core Backend, Item Master, Tracking, and Data Syncing), deployed
to Google Cloud Run. The app repos are the six `popcre/designflow-*` repositories under
`C:/repos/dflow`; their sandbox branches serve `https://sandbox-albert.designflow.app`. All four
services share application data governed by this `u2giants/shared-db` repo, but
their database provider is environment-specific: sandbox/develop/staging use
hosted Supabase while production uses Cloud SQL.

The durable portion separates schema control from runtime connections:
shared-db migrations own all DDL, and applications use small validated
per-process pools. Supavisor transaction mode applies to hosted-Supabase
nonproduction environments; production remains Cloud SQL.

### What we set out to do, and why

Implement [`fix_connection_pool.md`](fix_connection_pool.md) v3.0: move Core's legacy startup
DDL under shared-db ownership, use transaction pooling for Cloud Run, bound and validate every
client pool, gate traffic on readiness, label connections, and drain owned connections cleanly.

### Current state

Schema, code, automated tests, transaction-mode compatibility, and sandbox acceptance are
complete. Uma's normal PR review/merge and post-merge production verification remain.

- Migration `20260717163500_reconcile_dflow_backend_startup_contract.sql` was checked,
  dry-run/applied to preview, proven compatible with the old Core boot, merged in shared-db PR
  [#97](https://github.com/u2giants/shared-db/pull/97), applied to production by successful run
  `29611459054`, and audited live. Merge SHA: `293fd90697bb0a0024e196d6b4a2da2e298dbd15`.
- App heads are pushed on `sandbox-albert`: Item Master `bca5f16`
  ([PR #37](https://github.com/popcre/designflow-item-master/pull/37)), Tracking `a14afc1`
  ([PR #25](https://github.com/popcre/designflow-tracking/pull/25)), Data Syncing `509c010`
  ([PR #16](https://github.com/popcre/designflow-data-syncing/pull/16)), and Core `b4a015a`
  ([PR #62](https://github.com/popcre/designflow-backend/pull/62)). Uma has not merged them;
  the AI must not merge DesignFlow PRs.
- All four full unit suites passed: 693 tests. Preview port-6543 checks passed for all four
  services, including a real Sequelize transaction.
- Historical incident evidence includes an unsafe unsuffixed `DB_PORT` version
  containing `6543`; do not use it. Production is pinned to numeric version `1`
  and Cloud SQL/`5432`. The four corrected sandbox builds use the complete
  `_SANDBOX` tuple and deployed ready transaction-mode revisions. Each emitted a validated application name and
  `db_ready` before HTTP listen. Login, token, Item Library, and Tracking checks returned 200;
  logs had zero acquire-timeout, ceiling, or startup-fatal matches.
- Exact builds, revisions, and timings are in
  [`docs/verification/supabase-pooler-idle-connection-drop-20260623.md`](docs/verification/supabase-pooler-idle-connection-drop-20260623.md).

### Everything tried that did not work

- `api.sandbox-albert.designflow.app` did not resolve from this machine. The deployed smoke test
  used the canonical public Cloud Run BFF URL instead; all checks passed. This was a DNS-name
  issue, not an application failure.
- A local preview `supabase db push --dry-run` listed ten migrations because preview lagged
  production. The GitHub preview workflow applied the backlog plus reconciliation cleanly. No
  applied migration was edited.
- Cloud Run rejected two attempts to change `DB_PORT` from a secret reference to
  a literal in the same revision. The later unsuffixed secret-version approach
  was not a safe atomic solution—it crossed the environment boundary and caused
  the production outage. The corrected route uses `_SANDBOX` outside production
  and keeps production on its pinned unsuffixed Cloud SQL tuple.

### Root causes and key findings

- Core boot previously launched `sequelize.sync()` plus 43 unawaited DDL/data statements against
  its max-5 pool. That block is gone and a regression test prevents its return.
- Session-mode clients unnecessarily reserved database backends across idle Cloud Run sessions.
  Transaction mode now shares backends only while queries/transactions are active.
- Live preview/production audit found every expected Core model table, column, and index already
  present, no lowercase orphan, and no pending factory-country backfill. The migration therefore
  reconciles/asserts canonical state without a destructive drop.
- All services now use validated max-5/min-0 pools, bounded deadlines, application labels,
  readiness gates, ceiling-aware retry, and graceful owned-pool shutdown. The code audit found no
  prepared statements or session-local features that would require session affinity.

### Exact next steps

1. Uma (`devopswithkube`) reviews the four corrected PRs already assigned to
   her. **Pass when** Uma merges each to `develop`; the AI does not merge them.
2. Watch each normal production deployment. **Pass when** the latest revision is ready, carries
   its production application name, and logs `db_ready` before HTTP listen.
3. Run production login, token, Item Library, and Tracking smoke checks. **Pass when** all return
   200 and logs contain no acquire timeout, ceiling, startup fatal, forced shutdown, or relevant
   5xx.
4. Review Cloud SQL/Cloud Run connection telemetry after real production
   traffic. **Pass when** backend/client pressure stays within platform capacity
   and pool snapshots show no sustained waiters.
5. Complete the organization-backed IAM Deny + PAM gate described at the top of
   this handoff. **Pass when** the read-only acceptance script fully passes and
   an approval/expiry exercise changes no secret value.

### Constraints and gotchas

Keep transaction mode for hosted-Supabase nonproduction traffic, and keep the
current Cloud SQL production provider unless a separate migration is explicitly
approved. Pool max 5/min 0, idle 10s, evict 5s, keep-alive, and BFF normal
timeout 30s remain the guarded application settings. Never add app-repo/startup
DDL, broad session termination, unbounded pools, or session-local features
without an architecture review.

### Access and environment

`gh`, `gcloud`, `supabase`, and `op` were exercised successfully on this Windows machine.
Secrets and the test login are in 1Password vault `vibe_coding`; no value was logged or
committed. shared-db is on `main`; DesignFlow repos are on `sandbox-albert`. Preview ref:
`xjcyeuvzkhtzsheknaiu`; production ref: `qsllyeztdwjgirsysgai`; Cloud project:
`lithe-breaker-323913`, region `us-east4`.

### Open questions and risks

Open risks are (1) Albert's project Owner role retains direct secret-version
mutation until organization-backed Deny/PAM is active, and (2) a future feature
could silently depend on session affinity (prepared statements, temp tables,
session `SET`, advisory locks, LISTEN/NOTIFY, or cross-request state). Such a
feature must trigger an explicit connection-architecture review. No schema
rollback is needed: the reconciliation migration is additive/assertive.

---

## Active workstream — ERP mirror relocation (`fix_schema_for_api.md`)

### What this is
The Coldlion ERP data (items + production orders) is pulled from an external API and
mirrored into this database. Today the mirror sits in seven `public.*` tables with an
`erp_*` / `prod_order_*` name prefix — the legacy PopDAM location. We are relocating it
into the database's designed layers: raw pulls → `ingest.*`, typed authoritative mirror →
`plm.*`, browser/read contracts → `api.*`. This mirrors the already-proven customer path
(`plm.customer_import` → `plm.import_master_data()` → `core.customer` → `api.crm_customer_list`).

**The complete, detailed, 5-phase plan is [`fix_schema_for_api.md`](fix_schema_for_api.md)
(repo root).** It contains: exact current state (tables, row counts, columns, every inbound
dependency), what is correct vs. incorrect about the current design, the target design and
why, and the phase-by-phase migration with reversibility and risk notes. **Do not start ERP
schema work without reading it, and continue the phases in order.**

**The drill-down for the item→taxonomy resolver (Phases 2–4) is
[`fix_item_taxonomy_wiring.md`](fix_item_taxonomy_wiring.md) (repo root).** This is the "items
aren't joined to the taxonomy" fix: `erp_items_current` stores `licensor_code`/`property_code`
as text with no FK, while the correct FK table `plm.item` exists but is empty. The plan is under
Kimi-K3 review → Codex implementation as of 2026-07-20 (now unblocked because `/items` returns 200
again). It carries the `(division, mg_type, code)` composite-key rule and the lapsed-license guard.

### Status
| Phase | State |
|---|---|
| 1 — Serving layer (`api.plm_item_list` + repoint `style_tracker_rows_with_bridge`) | ✅ **DONE, live in production 2026-07-15** |
| 2 — Stand up `ingest.*` + `plm.item_import` / `plm.production_order_import` + resolver (additive, no cutover) | ⏳ not started |
| 3 — Dual-write + backfill items (**first phase that touches live data**) | ⏳ not started |
| 4 — Cutover reads + repoint bridge FK to `plm.item` | ⏳ not started |
| 5 — Retire legacy `public.erp_*`/`prod_order_*` + build prod-orders native | ⏳ not started |

### Phase 1 — what shipped (done)
- Migration `supabase/migrations/20260715193000_erp_phase1_api_plm_item_list.sql`, PR
  [#70](https://github.com/u2giants/shared-db/pull/70) (merged), applied to preview then
  production (prod apply run 29445431196, success).
- Added `api.plm_item_list` (`security_invoker` view over `public.erp_items_current`,
  `external_id` exposed as `source_id`). Repointed `public.style_tracker_rows_with_bridge`
  to read ERP columns through it. **No behavior change** — pure decoupling.
- **Intentionally NOT done:** `plm.refresh_style_tracker_item_bridge()` still reads
  `public.erp_items_current` directly (it writes the physical ERP `id` into FK
  `plm.style_tracker_item_bridge.erp_item_id`; a view buys no decoupling). It moves in Phase 4.
- Evidence: [`docs/verification/erp-phase1-api-plm-item-list-20260715.md`](docs/verification/erp-phase1-api-plm-item-list-20260715.md).

### Next action (Phase 2)
Author a new additive migration creating `plm.item_import` and `plm.production_order_import`
(typed ERP mirrors modeled field-for-field on the existing `plm.customer_import`), confirm
`ingest.raw_record` / `ingest.sync_run` cover the item payload, and write
`plm.import_item_master_data(p_sync_run_id uuid)` modeled on `plm.import_master_data()`.
Additive only — nothing reads the new tables yet. Follow the shared-db protocol below.
**Verification gate for Phase 2:** the new objects exist on preview, `check-sql.sh` passes,
preview dry-run lists only the new migration, and no existing reader changes behavior.

### Open decision that blocks Phase 3 (not Phase 2)
The live item pipeline is **Coldlion → dflow (Cloud SQL + enrichment) → dflow item API →
Supabase** (`source_system = 'designflow'`), **not** a direct Coldlion pull — the raw payload
is DesignFlow's shape, not Coldlion's `CLAPIServerEhp` shape. Phase 3 must choose: keep
sourcing through dflow (free merch-group → licensor/property enrichment) or pull Coldlion
`/items` directly (fresher, no dflow dependency, but re-implement enrichment). This also fixes
the `source_system` label choice. Analysis:
[`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md).

**DECIDED 2026-07-15 — Option B (direct Coldlion).** The full build plan, the item→taxonomy
wiring, and the taxonomy-table de-duplication analysis are in
**[`docs/coldlion-direct-sync-and-taxonomy-plan.md`](docs/coldlion-direct-sync-and-taxonomy-plan.md)**.
Highlights the next session must know:
- Sync becomes a Supabase **Edge Function in shared-db + `pg_cron`** (no Google Cloud), key in
  **Vault**, **data-only (no images — DesignFlow owns images)**, plus a new **weekly full
  reconciliation** to stop silent incremental drift.
- The strict parent-child **taxonomy already exists** in `core.*` (sourced from DesignFlow);
  the real work is wiring items to it with **FKs** (Coldlion `merchGroup05`=licensor,
  `merchGroup06`=property — confirmed). Coldlion does **not** expose the hierarchy.
- ⚠️ **Taxonomy "empty duplicate" cleanup is NOT a blind delete.** The empty snake_case tables
  (`core.merch_group`, `core.product_category/type/subtype`) are the *planned canonical target*
  per [`docs/unified-supabase-schema-map.md`](docs/unified-supabase-schema-map.md), not strays.
  The genuinely-redundant set is the `dflow.*` taxonomy island (0 external FKs), pending a
  Sequelize-model check in the 6 `designflow-*` repos. **Open decisions block build — see
  Part F of the plan.**

---

## Active workstream — Coldlion customer/vendor hub cleanup + extension-table design (2026-07-17)

### What this is
The Coldlion ERP customers (836) and vendors (539) were imported into the shared hubs, then the
**customer** side was de-duplicated and status-curated. `core.customer` is now 859 rows
(**140 active / 12 potential / 707 inactive**) with short `display_name`s, a `core.customer_alias`
table, and `core.merge_customer()`. Status is app-owned (survives Coldlion re-pulls). CRM pickers
now show `display_name` and hide inactive customers.

### Reference docs (read these before continuing)
- **[`DB_Data_Admin.md`](DB_Data_Admin.md)** — **approved 2026-07-21 product and
  implementation plan** for the shared administrator application at
  `https://data.designflow.app`. The application is owned and developed in this repo
  (frontend: `apps/db-data-admin/`) and initially manages Customers, Vendors,
  Licensors, and Properties. It standardizes DB Data Admin on MIT RevoGrid Core with our
  own header filtering — since 2026-07-23 a per-column **Multi Filter (Text + Set)**, see
  [`docs/db-data-admin-column-multi-filter.md`](docs/db-data-admin-column-multi-filter.md).
  DesignFlow keeps AG Grid; PopCRM's custom DataTable
  is legacy and should not become a third shared grid platform. **This plan supersedes the
  older direction below that placed the admin page in PopCRM. Implementation is underway;
  development is live at `https://data-dev.designflow.app`, while production remains gated.**
- **[`docs/coldlion-customer-dedupe-review.md`](docs/coldlion-customer-dedupe-review.md)** — the
  full customer dedup ruling ledger + final state (what merged, statuses, aliases, the Amazon
  1P/3P split, defects found).
- **[`docs/coldlion-customers-vendors-20260715.md`](docs/app-migration-notes/coldlion-customers-vendors-20260715.md)**
  — the import/pipeline app-migration note.
- **[`fix_vendor_review.md`](fix_vendor_review.md)** (repo root) — detailed cold-start handoff to do
  the **vendor** (`core.factory`) equivalent (schema merged; curation pass pending, see Status below).
- **[`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md)** (repo root) — historical
  PopCRM-hosted admin-page proposal. **Do not implement its PopCRM ownership/location.** Its
  database-surface and cutover-safety research may still be useful, but
  [`DB_Data_Admin.md`](DB_Data_Admin.md) is now authoritative for product ownership, URL, grid,
  architecture, and delivery.
- **[`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md)** —
  implementation plan for per-app extension tables (`crm/pim/dam/plm.customer_ext` etc.) so
  app-specific attributes never bloat the shared `core.*` tables. Decision made 2026-07-17,
  reviewed by Kimi K3.

### Status
- **Customers: DONE + merged** (shared-db PRs #83, #84, #85, #86, #88, #91, #94, #96; all applied
  to prod). CRM picker frontend (`picker-autocomplete-display-name`) is **MERGED** — there is no
  open popcrm-web PR (an earlier note here referencing "popcrm-web PR #3, open" was stale).
- **Vendors: SCHEMA MERGED, curation pending.** **shared-db PR #102 is MERGED** (commit `14da5c5`)
  — `factory.display_name`, `core.factory_alias`, `core.merge_factory` are all live. What remains
  is the **curation pass** (`fix_vendor_review.md` §6 steps 5–7): apply Albert's CSV rulings.
  Rulings received 2026-07-20:
    - `docs/vendor-review/vendor_multicode.csv` — statuses set (Action Printing INACTIVE, MIRAE
      ACTIVE, XIANJU SHAOFENG INACTIVE, XIANJU YINTAI ACTIVE, all "one vendor Y").
    - **"Not a factory" rows → PURGE from `core.factory` entirely:** ABF FREIGHT SYSTEM (205, 206),
      DIGITAL PHOTOGRAPHIC (16, 207), ANTHONY'S WAREHOUSE & DISTRIBUTION (458, ANT001), WALMART
      (369, 459 — actually a customer).
    - `docs/vendor-review/vendor_directus.csv` — **all 6 rows are garbage** (Directus test data:
      Bill, Chloe, Jerome, Lucy, Tom, Wendy Sunway); exclude all from `core.factory`.
  Next action: author one migration doing status-seed + purge, apply preview-first, merge.
  Full spec: [`fix_vendor_review.md`](fix_vendor_review.md).
- **Extension tables: DAM/CRM/PM implemented on preview; PLM uses a separate single-writer path.** Migration
  `20260721143000_dam_master_data_customer_id.sql` creates `dam.customer_ext`,
  `api.dam_customer_list`, the `/styles` “Originally Designed For” canonical Customer FK,
  safe backfill, and audit coverage. Migrations `20260722003000` through `20260722003400`
  add CRM/PM Customer and Vendor extensions plus DAM Vendor on preview. PLM stays Cloud-SQL-owned
  and must use the protected single-writer integration in `docs/db-data-admin-inventory.md`.
- **DB Data Admin: FOUNDATION IMPLEMENTED, FEATURE WORK PENDING.** The scaffold, development
  deployment, SSO routing, and preview-only foundation schema are complete as recorded in the
  dedicated active-workstream section above. Target production URL: `https://data.designflow.app`.
- Frontend "hide inactive" for **poppim-web / popdam3** pickers: not started (same pattern as
  popcrm-web PR #3).

---

## How to ship a shared-db schema change (the sanctioned flow, proven this session)

Full rules in [`AGENTS.md`](AGENTS.md) §4–§9. The mechanics that worked on 2026-07-15:

1. New timestamped file under `supabase/migrations/`. Never edit an applied migration.
2. `bash scripts/check-sql.sh` — needs `rg` on PATH (Git Bash lacks it; a bundled ripgrep
   exists at `.../AppData/Local/OpenAI/Codex/bin/*/rg.exe` — prepend its dir to `PATH`).
3. Branch + PR to `main`. PR CI runs only static SQL checks.
4. Apply to **preview** first, via GitHub Actions:
   `gh workflow run shared-supabase-migrations.yml -r <branch> -f target=preview -f mode=dry-run`
   then `... -f mode=apply`. (There is no auto-apply on merge; apply is always a manual
   `workflow_dispatch`.)
5. Merge PR → `main` (auto-syncs `shared-db/` into all consumer repos).
6. Apply to **production**: `gh workflow run ... -r main -f target=production -f mode=apply`.
7. Verify on production (Supabase MCP is bound to prod `qsllyeztdwjgirsysgai`).

Project refs: preview `xjcyeuvzkhtzsheknaiu`, production `qsllyeztdwjgirsysgai`.

---

## Completed earlier workstream — production schema reconciliation (2026-07-10)

Done and verified. The eight `20260710135*_reconcile_*` migrations are confirmed present in
the **production** `supabase_migrations.schema_migrations` history (checked 2026-07-15), so the
prior handoff's "promote reconciliation to production" loose end is **resolved**. Durable audit
note: [`docs/verification/production-schema-reconciliation-20260710.md`](docs/verification/production-schema-reconciliation-20260710.md).

## Carried-forward security item (verify, then close)

**Production DB password possible exposure.** During the 2026-07-10 reconciliation audit, a
Supabase CLI command printed the production DB password into local tool output (never
committed). It was flagged for rotation. **Status unverified as of 2026-07-15.** Action: check
the 1Password item `Supabase DB Password - shared POP database` (vault `vibe_coding`)
last-changed date; if it predates 2026-07-10, rotate it and update the item. If already rotated
after 2026-07-10, delete this section. Do not rotate the 1Password service-account token.

---

## Documentation completeness self-audit — 2026-07-22

### 1. Could a brand-new developer with no project or session context continue without questions?

**Yes.** The incident section at the top explains the business impact, the exact
Cloud SQL/`5432` versus Supabase/`6543` boundary, why the planning process failed,
which repo owns each layer, every live safeguard, every relevant PR/commit/build/
revision/alert identifier, Uma's two identities, the still-open Owner risk, and
five ordered next steps with explicit pass conditions. It routes to the full
incident record and the two canonical infrastructure documents rather than
requiring chat history.

The customer/vendor section also records the completed DAM customer-reference
migration, the still-pending app extension work, and routes the developer to the
authoritative `DB_Data_Admin.md` implementation plan. That plan contains the
product scope, data ownership rules, security model, audit/merge semantics,
delivery order, verification gates, repository boundaries, and the required
eventual deletion of the superseded visual-admin planning file.

The dedicated DB Data Admin workstream now records the actual post-implementation state:
merged PRs, preview-only migrations, live development SHA, failed attempts, exact next steps,
security/deployment boundaries, and remaining production risks. It replaces the stale
“plan only” statement that would otherwise send a fresh developer backward.

### 2. Could that developer continue as effectively as the current session?

**Yes.** They have the implementation evidence (9 infrastructure fixtures; 109
suites / 741 tests; deliberate failed build; zero-traffic production revisions;
24-resource IAM apply; zero-drift plan; HTTP 200), the exact identities and
scopes of both writer service accounts, the 1Password note identifier, the
current PR-review owner, and the precise organization/PAM/Deny acceptance test.
They also know which tempting shortcuts are forbidden and why the hard gate was
not forced through a standalone project.

For DB Data Admin, they also have the decisions reviewed by Kimi K3, the completed
first prerequisite (the centralized mirror excludes and purges top-level `apps/`,
with an automated boundary check on every consumer sync), and
an ordered implementation sequence that distinguishes completed schema work
from planned work.

### 3. Is every relevant detail needed for flawless execution present?

**Yes, after revision.** The first audit found and corrected four gaps: the
handoff still described all environments as hosted Supabase, still treated the
unsafe unsuffixed version as a valid atomic transition, omitted the 24 live IAM
resources and alert evidence, and did not explain the Deny Admin/PAM
organization constraint. The current top section and linked incident/runbook now
include background, goal, intended outcome, current live state, failed attempts,
root causes, ownership, constraints, risks, access boundaries, exact next
actions, and a verification gate for every remaining action. No secret value is
present.

### Sample Tracking workstream self-audit (2026-07-22)

1. **Is this handoff comprehensive enough for a brand-new developer with no project knowledge or
   chat context? Yes.** The active Sample Tracking section explains the application and four-piece
   split scenario, names the authoritative plan, states the exact plan-only status, identifies the
   omitted table and concurrent-insert defect, and gives the first verification gate. The linked
   plan's Sections 1–4 provide complete background and decisions.
2. **Could that developer continue as effectively as the originating session? Yes.** The handoff
   preserves both failed publication paths and the eventual clean GitHub path; the plan's Sections
   5–13 preserve the data contract, conservation rules, tenancy, legacy policy, migration sequence,
   preview procedure, tests, rollback, and observability knowledge.
3. **Is every relevant detail needed for flawless execution present? Yes.** The plan's Section 14
   gives ordered next steps with a success gate for each; Sections 15–16 preserve open decisions and
   definition of done; the handoff names environments, the exact restore migration and runtime
   error, access location without secret values, and explicitly distinguishes a merged plan from
   authorization to mutate preview or production.
