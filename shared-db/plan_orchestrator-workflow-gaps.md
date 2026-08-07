# Implementation plan — three gaps in the orchestrator workflow

**File:** `plan_orchestrator-workflow-gaps.md` · **Repo:** `u2giants/shared-db` · **Created:** 2026-08-07
**Status:** WRITTEN, NOT STARTED. **Reviewed by Kimi K3 over two rounds** (2026-08-07); round 2 read the file itself and its one blocking finding — E creating duplicate issues — is fixed. Its verdict: executable, A and E first.

Three gaps Albert asked to have fixed, found while finishing the intake-to-Issues migration
on 2026-08-07. They are independent of each other and are listed worst-first.

| # | Gap | Phase | State |
|---|---|---|---|
| A | Production migrations: the lane is **built but never exercised**, and there is no apply path | 1 | ⬜ open |
| E | **The 14 `HANDOFF.md` backlog items are a SECOND tracker** — added after review | 1 | ⬜ open |
| B | Nothing mechanically stops two orchestrators running at once | 2 | ⬜ open |
| C | A session already running never learns of a new owner ruling | 3 | ⬜ open |
| D | 71 open issues with no ordering — no single "what is next" | 3 | ⬜ open |

> **Do A and E first.** A is why the database five applications share has not received a
> migration since **2026-08-02**. E is the unfinished half of the migration that just
> shipped, and Kimi K3 was right that it outranks B, C and D.

**Reviewed by Kimi K3, two rounds, 2026-08-07.** Round 1 could not read the file — it was on
an unmerged branch — so it reviewed the design as described and, more usefully, read the
**code** directly. Round 2 read the file. Its findings are folded in below and attributed.
**Its one blocking finding, that E would create duplicate issues, is fixed.**

---

## Correcting the framing this plan was born from

I told Albert the production lane "has never worked" and quoted *281 runs, 142 skipped, 1
failed, 0 succeeded*. **That reading was wrong and the plan must not inherit it.**

Read live 2026-08-07 from `.github/workflows/shared-supabase-migrations.yml`:

- The `production-dry-run` job runs **only** on `workflow_dispatch` with `target=production`.
  On a pull request its `if` is false, so it does not run. **The 142 "skips" are pull
  requests, which is correct behaviour, not failure.**
- The job is **deliberately dry-run only**. Its first step is *"Refuse production apply"*,
  which exits 1 whenever `mode == apply`. That is an intentional interlock.
- It is well-built: exact-SHA confirmation, a typed confirmation string
  (`DRY-RUN <sha>`), a `production` GitHub environment, the ledger captured before
  anything runs, a **bounded allowlist** enforced by `scripts/production_migration_guard.py`,
  and the dry-run output verified against that allowlist afterwards.

**The true statement is narrower and still serious: nobody has ever run it.** Zero
successes means the mechanism is unproven against real production, and there is no apply
path at all — by design, pending a process nobody has yet written.

---

## Measured starting position

Read read-only from production (`qsllyeztdwjgirsysgai`) on 2026-08-07, after confirming the
target with `get_project_url` per `AGENTS.md` §12 standing fact 6:

| | |
|---|---|
| Production ledger | **361** rows, head **`20260802194100`** |
| Migration files on `main` | **405** |
| **Pending** (newer than head) | **11** |
| ⚠️ **Older than head, absent from the ledger** | **33** |

**The 33 are the whole difficulty.** The Supabase CLI refuses migrations sorting older than
the ledger head unless given `--include-all`, and `--include-all` would sweep all 33 into a
single unreviewed apply against the shared database. **This plan never uses that flag.**

The 11 pending, in order — the five OPA migrations are only the last five:

```
20260803150000  itemdetail coldlion item identity and UPC contract
20260803200000  temp status watch snapshot and change log
20260803201000  temp status watch hardening
20260804120000  taxonomy baseline pins table
20260804120100  taxonomy breaker environment and provenance
20260807030000  owner ruling — Coco is a Disney license
20260807170000  opa property/character landing
20260807170100  opa property/character importer
20260807180000  opa sync reentrancy fix
20260807190000  opa security and view corrections     ← security fix, NOT optional
20260807200000  opa comment corrections
```

⚠️ Without `20260807190000` the landing table ships `using (true)`, letting **every**
authenticated account — including `vendor` and `viewer` — read the entire Disney extract.
`20260807180000` must precede it.

---

## A. Production migrations: prove the lane, explain the 33, then define an apply path

**A1 — Explain the 33 orphans before anything else. Read-only.**
For each of the 33, establish which it is — (a) applied to production by
some other route and never recorded; (b) genuinely never applied and no longer wanted;
(c) genuinely never applied and still wanted. **The method must be object existence, not
inference from the filename** — check whether the objects the migration creates exist on
production. Output: a committed table under `docs/verification/`, one row per migration,
with the evidence. **No promotion decision can be trusted until this exists**, because
"pending" currently means "not in the ledger", which is not the same as "not applied".

⚠️ **Object existence alone is NOT sufficient, and treating it as sufficient is dangerous.**
Kimi K3, 2026-08-07, and it is right. It cannot see:
- a migration whose job was to **DROP** something — absence is exactly what success looks
  like, so "object absent" reads as "never applied" when the opposite is true;
- **DML, grants and revokes**, which create no object at all;
- **`create or replace` drift** — the object exists, but as some other migration left it;
- **partial application**, where a migration got halfway.

So A1 needs **per-statement** checks, not per-object, and a **third bucket**:
**APPLIED OUT-OF-BAND → record it in the ledger, never re-run it.** Re-running an applied
migration is how this repo corrupts things. The two-bucket version of A1 would have pushed
every such migration into "apply it".

*Gate:* all 33 classified into applied-out-of-band / never-applied-and-wanted /
never-applied-and-unwanted, with per-statement evidence a stranger can re-derive. Any
UNKNOWN stays UNKNOWN — an honest unknown is safe, a guessed "already applied" is not.

**A2 — Exercise the existing dry-run for the first time.** ✅ **Kimi verified the mechanism
in code and it holds:** `production_migration_guard.py` **deletes** anything outside the
allowlist from the bounded checkout, and `verify-dry-run` then demands an exact match
against the allowlist. So the 33 orphans below the head do not silently ride along — this
was the question I was least sure of, and the answer is that the design already handles it.
⚠️ Note the verifier is coupled to the CLI's **output wording** (`:417`); a Supabase CLI
upgrade can break it, and the failure would look like a migration problem rather than a
parsing one. `workflow_dispatch`, `target:
production`, `mode: dry-run`, the exact `main` SHA, confirmation `DRY-RUN <sha>`, and
`production_allowlist` set to the **11** versions above and nothing else.
This writes nothing. It proves the allowlist mechanism, the guard script and the
credentials all work, and it produces the first real evidence of what an apply would do.

*Gate:* the run succeeds, and the verified dry-run output lists exactly those 11 and no
others. **If it lists anything else, stop — that is the `--include-all` failure mode
appearing, and it is the reason for the allowlist.**

**A3 — Decide the apply path, and write it down before building it.** Two candidates:
- **(i) Add an `apply` mode to the same workflow**, behind the `production` environment's
  required reviewer, the same allowlist, the same typed confirmation, plus a mandatory
  fresh dry-run in the same run whose output must match the allowlist before apply.
- **(ii) A documented manual window** — a human-run, recorded procedure, no new automation.

**Recommendation: (i), but ONLY behind the `production` GitHub environment with required
reviewers naming Albert.** Kimi's condition, and it is the right one: without a human
approval gate on the environment, (i) is just an apply button, and an apply button reachable
by any session with `workflow_dispatch` is worse than the manual window. **If the required
reviewer cannot be configured, take (ii).**

(ii) otherwise puts the most dangerous operation this project performs into a hand-typed
sequence, which is what this repo's rules exist to prevent. But (i) adds an apply path to
production, so it is an owner decision, not an engineering one.

*Gate:* Albert has chosen, in writing.

**A4 — OWNER GATE.** Applying to production needs him to name the project and the action.
The exact sentence is written in §Owner gates below. **Nothing in A applies to production
before A1, A2 and A3 are complete.**

**A5 — Apply, verify, record.** Ledger before and after, object existence checked for each
of the 11, and the `20260807190000` policy verified as role-gated rather than `using (true)`.

---

## E. The `HANDOFF.md` backlog is a SECOND tracker — finish the migration

**Added after review. Kimi K3, 2026-08-07, ranked it above B, C and D, and it is right.**

`HANDOFF.md` still carries **14** `### B<n>` backlog items as their own tracker, while all
other work now lives in issues. That is two tracking systems for one project.

**This is not a new problem — it is the unfinished half of the migration that just shipped.**
`plan_coordinator-queue-to-github-issues.md` §1 says, in its own words:

> *If a step would leave us maintaining **both** the file and Issues, do not do it. Two
> tracking systems is strictly worse than the one bad system we have, because "which is
> right?" stops being rhetorical.*

The migration then closed B10 and B13 — the two that would have rebuilt the queue — and
**left the other twelve exactly where they were.** Defensible at the time, because B10 and
B13 were the dangerous ones. Not defensible as an end state.

⚠️ **It is already producing the ambiguity the goal warned about.** The retired pointer file
tells a reader that an empty issue list is not proof there is no work, and to *also* read
`HANDOFF.md ## BACKLOG`. So the answer to "what is outstanding?" is currently two places,
by written instruction.

> ## ⚠️ E IS MUCH SMALLER THAN I FIRST WROTE. Read this before doing anything.
>
> My first draft of E said "open an issue per surviving item". **That would have created
> duplicates.** Kimi K3 caught it; checking live, it is worse than it flagged — **eight** of
> the 14 already have issues, not six:
>
> | Already an issue | | Closed or resolved |
> |---|---|---|
> | B1 #545 · B3 #546 · B5 #547 · B6 #529 | | B2 (PR #445) · B4 (nothing to do) |
> | B8 #520 · B9 #548 · B11 #549 · B12 #550 | | B7 (standing policy) · B10 · B13 · B14 |
>
> **That is all 14.** The migration already carried the backlog across as work items
> WI-43 to WI-48 and closed the rest. **Nothing needs migrating.**
>
> **E is therefore a documentation task, not a migration.** The tracker duality is real —
> `HANDOFF.md` still *presents* `## BACKLOG` as a place to read outstanding work — but the
> work itself is already in one place. Sizing it as a migration would have produced eight
> duplicate issues and made the sprawl worse while claiming to fix it.

**E1 — Verify, do not create.** For each of the 14, record one of: **ALREADY-TRACKED**
(with the issue number), or **CLOSED** (with the PR or reason). The table above is the
starting draft and **must be re-derived live**, not copied — it was true at the moment it
was written and this repo's standing rule is that no document wins by date.

**E2 — Link, retitle if needed. Create nothing.** Confirm each existing issue keeps its
`B<n>` in the title so old references resolve. `migrate-intake-to-issues.mjs` already
produced that title shape, so this is a check rather than an edit.

**E3 — Replace `## BACKLOG` with a pointer** to `gh issue list --label db-work`, listing
the `B<n>` → issue-number mapping and nothing else.

⚠️ **The pointer MUST keep the word "backlog".** `scripts/check-intake-pointer.mjs:123-125`
is a **required** check and it fails the retired intake pointer if the word disappears — and
that pointer's "empty is not idle" warning names `HANDOFF.md ## BACKLOG` as a place to look.
Removing the section without updating that warning breaks a required check. *(Kimi K3.)*

⚠️ **Do NOT delete the B-number history.** Keep the originals under `<details>`, the same
treatment B10 and B13 received.

*Gate:* all 14 accounted for as ALREADY-TRACKED or CLOSED with evidence; **zero new issues
created**; `HANDOFF.md ## BACKLOG` is a pointer; and both required checks still pass.

---

## F. Stale `AGENTS.md` KNOWN LIMITATION — small, and it misleads item A

Found by Kimi in the same round. `AGENTS.md:1130-1136` states that
`shared-supabase-migrations.yml` is `paths:`-filtered and therefore cannot be a required
check without deadlocking every unrelated PR.

**Verify it against the workflow before acting on either.** If the workflow is no longer
path-filtered, that limitation is stale and has been discouraging exactly the hardening item
A needs. If it is still accurate, item A must not propose making that workflow required.

**Either way one of the two documents is wrong, and this is cheap to settle.**

---

## B. Make the single-orchestrator rule mechanical

Today the marker is an honour-system GitHub issue. A session that misreads it, queries the
**old** `coordinator-marker` label and sees an empty list, or simply skips step 0, just
carries on. Two orchestrators dispatching at once is how this repo produced four competing
migrations on one function.

**B1** — `scripts/check-orchestrator-marker.mjs`: fails when **more than one**
`orchestrator-marker` issue is open, and fails when a `gh` call errors rather than treating
an error as zero. Wire it as a **required** check with no `paths:` filter, like the intake
pointer guard, **and on a schedule** — Kimi's point: a PR-only check sees nothing during the
hours when two orchestrators are actually colliding, because neither may open a PR.
⚠️ **The scheduled leg needs an alarm path that reaches a human.** A failed scheduled run
mails the commit author, and the mandated committer identity is a `noreply` address, so by
default nobody is told. Use a throttled, deduplicated issue — **not** an unthrottled one:
this repo has already produced 25 duplicate issues from a monitor with no dedupe. *(Kimi.)*

**B1b** — ⚠️ **Neither leg can see a second orchestrator that never claims a marker at all.**
If the old-label create errors, a session may simply proceed unmarked. This is detection of
the *marked* collision only, and the limit must be stated wherever the check is documented.

**B1a** — Add an **old-label tripwire**: fail if any issue still carries `coordinator-marker`,
or if that label is ever recreated. Querying the retired label returns empty, and step 0
treats empty as permission to start.

⚠️ **This does not prevent a second orchestrator from starting** — nothing in CI can, since
a session claims its marker outside any pull request. It makes the collision **visible on
the next PR** instead of silent. Say that plainly rather than overselling it.

**B2** — Negative-path tests: two open markers must fail, a `gh` error must fail, zero open
must pass, one must pass.

---

## C. Reach a session that is already running

**Proven twice on 2026-08-07.** Albert ruled the Disney extract is not sensitive at ~17:00.
At 22:26 a live session filed issue #578 asking for the git-history scrub that ruling had
cancelled. The rule reached the next session; it did not reach the running one.

**There is no mechanism that reaches a running session, and this plan should not pretend
to invent one.** What it can do is make the next thing that session *does* fail loudly.

**C1** — A `ruling-supersedes` convention: when an owner ruling cancels open work, the
ruling's PR must also close or retitle every issue it invalidates, in the same PR. Today
that happened by hand and only because someone noticed.

**C2** — `scripts/check-cancelled-work.mjs`: a committed table of
`(cancelled instruction, ruling reference, reason)` — **per-row reasons, not a bare list** —
that fails a PR reintroducing a cancelled instruction. Seed it with the two known ones: the
R-SEC-1 history scrub, and making the repo private.

⚠️ **Kimi's objection, accepted: a hand-maintained table is a rot trap.** Two mitigations,
both required or do not build it:
- **The table lives only where the check consumes it.** No second copy in prose. A list
  nothing reads is a list nothing updates.
- **A rot-valve test:** the check must fail if the table is empty or if a row lacks a
  reason, so silently gutting it is not a quiet way to make the check pass.

**Two working models already exist in this repo — follow one rather than inventing a shape:**
- `scripts/check-skill-drift.mjs`, added 2026-08-07. It is the closest match: a committed
  table of contradictions, each row carrying its reason and the rule it violates, consumed
  by exactly one check. It also demonstrates the two traps — it found three real defects on
  its first run *and* produced three false positives of its own, all from patterns that were
  line-scoped while the corrections wrapped onto the next line. **Budget for that.**
- The `HARD_BLOCKED` mechanism, for the shape of an owner-gated block list.

**C3** — Add to the handover skill: an orchestrator re-reads `AGENTS.md` §6 owner rulings
**at handover**, not only at session start, and states in its handover which rulings post-date
its own start time.

---

## D. Give 71 issues an order

The old file had a top; the issue list does not. Losing "what is next" was a real
regression and should be named as one.

**D1 — A `priority` label set, deliberately tiny: `now`, `next`, and nothing else.**
Anything unlabelled is "later". Three tiers, not five: a five-tier scheme becomes a
lifecycle, and design decision D7 of the migration plan rejected exactly that.

**D2 — GENERATED, not hand-maintained.** Kimi: a hand-kept `THE BOARD` issue is the old
file in miniature and will rot identically. Either a scheduled job regenerates its body from
`--label now` on every change, **or it is not built at all** and `gh issue list --label now`
is the board. **Recommendation: do not build it.** The command is the board; a rendered copy
of a query is a cache, and a stale cache here is exactly the failure being fixed.

**D3** — The orchestrator skill's session-start step reads `--label now` first.

⚠️ **The risk is honest: this is the queue's ordering problem in a new place, and it can rot
the same way.** The mitigation is that it holds ordering only and never detail, and that it
is small enough to re-derive from scratch in minutes.

---

## ⚠️ Required at the END of every phase

**Re-read every remaining item through the end of this plan, and record DRIFT into this
file before handing over.** If nothing drifted, write "no drift" — silence is not
information.

This is not ceremony, and it is kept against the general instinct to cut it. The identical
instruction on `plan_coordinator-queue-to-github-issues.md` produced **14 concrete drift
items**, including two that invalidated whole steps, and it was the highest-yield
instruction in that document measured against every other control it carried. **This plan
was written without it and the omission was caught by the `fresh-session` check, not by a
model review.**

Specifically, before you hand over, confirm for **every** later item:
- nothing you did changes a later item's assumptions without that being written here;
- nothing you *discovered* invalidates a later item's approach without it being flagged;
- every later item still has the identifiers, counts and decisions it needs.

**Counts in this plan go stale within the hour.** The ledger figures, the pending list, the
`B<n>` → issue mapping and the issue totals were all measured on 2026-08-07. **Re-derive
them; do not quote them from here.** That is this repo's standing rule and this plan is not
exempt from it.

---

## Owner gates

1. **A3** — which apply path: add `apply` to the workflow, or a documented manual window?
2. **A4** — verbatim, once A1–A3 are done:
   > Apply the 11 pending migrations listed in `plan_orchestrator-workflow-gaps.md` to the
   > production Supabase project `qsllyeztdwjgirsysgai`, in version order, using the
   > allowlist and **without** `--include-all`.
3. **D1** — are two priority labels enough, or do you want a third?
4. **E** — the 14 backlog items become issues like everything else. Say yes and it just
   happens; it needs no decision beyond confirming you want one list, not two.

---

## Constraints

1. Branch + PR; you merge it yourself. Never commit to `main`.
2. Commit identity `Albert Hazan <u2giants@users.noreply.github.com>` — check
   `git var GIT_COMMITTER_IDENT` before the first commit.
3. Six required contexts, `strict: true`, `enforce_admins: true`. Expect `gh pr update-branch`.
4. **Never `--include-all` against production.**
5. **The Supabase MCP is bound to PRODUCTION and takes no project parameter.** Call
   `get_project_url` first, every time. Preview work goes through the CLI or psql.
6. Read-only measurement of production is allowed and encouraged. Writes are not, until A4.
7. Other sessions share this checkout — `git diff origin/main --stat` before opening a PR,
   and never `git add -A`.
