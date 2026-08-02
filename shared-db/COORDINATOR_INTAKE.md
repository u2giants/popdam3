# COORDINATOR_INTAKE.md — hand your work over to the one coordinator

> # ⛔ AN EMPTY QUEUE DOES **NOT** MEAN THERE IS NO WORK.
>
> **Read this before you conclude anything about the state of this project.**
>
> The queues in this file track **incoming requests and handovers only**. They
> are frequently empty, and an empty `REQUEST QUEUE`, `INTAKE QUEUE` or
> `IN PROGRESS` section is **not** evidence that there is nothing to do. It has
> already happened once that a fresh coordinator read these three empty sections
> and reported "there is no pending work" while a large, urgent backlog was
> sitting in `HANDOFF.md`. Every word of that report was technically true and
> the conclusion was completely wrong.
>
> **`HANDOFF.md` is the authoritative record of outstanding work — not this
> file.** Before you decide the project is idle, before you tell anyone there is
> nothing pending, and before you plan a session, you **MUST** read:
>
> 1. the **most recent COORDINATOR HANDOVER section at the top of `HANDOFF.md`**,
>    including its opening agenda and its "waiting on Albert" list; and
> 2. the **`## BACKLOG` section of `HANDOFF.md`** (items **B1–B13**).
>
> If the queues below are empty and `HANDOFF.md` has a backlog, **the backlog is
> your work.** Never report "nothing to do" on the strength of this file alone.

**This repo runs ONE coordinator session at a time.** Every piece of work is
dispatched by that coordinator to sub-agents in isolated git worktrees. Nothing
happens outside it.

This file is the mailbox. Sessions that were started outside the coordinator
write what they know into the **INTAKE QUEUE** below and stop. The coordinator
reads the queue, verifies every claim against the live repo, dispatches the
work, and moves the block to **TAKEN OVER**.

Three audiences, three paths — read the one that describes you:

- **Part 0 — you NEED database work done and have not started it.** This is the
  path that should be taken most often. Submit a REQUEST. Do not start.
- **Part A — you are already doing work and are being asked to hand over.** Fill
  in the handover template, stop.
- **Part B — you are the coordinator.** Ingest, dispatch, and keep this file
  swept (Part B includes the lifecycle and retention rules).

Related skills: **`shared-db-orchestrator`** (how a coordinator session is
opened and run) and **`shared-db-handover`** (how a session that used sub-agents
or touched the shared database is closed out). If you are the coordinator, load
`shared-db-orchestrator` before dispatching anything.

---

## Part 0 — you NEED work done on the shared database

**If you need work done on the shared database, do not start it. Submit a
request instead.**

This is not a formality and it is not about permission etiquette. This database
is shared by four live applications. Two sessions editing the schema at the same
time is the single most common way this repo has been broken, and it has
happened repeatedly.

"Do not start it" covers **all** of the following, with no exceptions:

- any schema change — a column, a table, a type, a constraint, an index
- any migration file, even an empty placeholder
- any RLS policy, view, RPC, function, trigger, grant, or seed
- any push to the **preview** database, and any promotion to **production**
- any cross-app data contract — anything another application reads or writes

**"It's only a small change" is exactly the case that has caused the damage
here.** Every incident in this repo's history started as a small change someone
judged too minor to coordinate. A one-line `ALTER` is a schema change in flight,
and it collides with the other one in flight just as hard as a large one. The
size of the change is not the risk; the *concurrency* is.

**A requester can be a human or an AI session.** If you are an AI session and a
user asks you for database work, your correct action is to file the request
below and tell them you have done so — not to start the work, not to "just draft
a migration to save time", and not to create a background task chip (see
standing fact 5).

### The REQUEST template — fill in every heading

Append it as a new block under `## REQUEST QUEUE`, further down this file.

```markdown
### REQUEST — <short name for the outcome> — <YYYY-MM-DD> — <requester: person or session id>

**1. What outcome is needed, and why.**
<Business terms, not implementation. "Sales need to see which licensor owns a
style so they can filter the grid" — NOT "add a licensor_id uuid column". State
the problem; let the coordinator choose the design.>

**2. Which application(s) depend on this.**
<Name them: popdam3, popcrm-web, poppim-web, DesignFlow (dflow), monitor,
DB Data Admin, a report, a person's spreadsheet. If more than one app reads or
writes the affected data, say so — that makes it a cross-app data contract.>

**3. Is it blocking anything, and how urgently?**
<Blocking / not blocking. If blocking: what exactly is stopped, and who is
sitting idle because of it.>

**4. Deadline, if any.**
<A real date and what happens if it slips. "None" is a perfectly good answer and
is better than an invented urgency.>

**5. What I already know about the current schema.**
<Tables, columns, views, or functions you believe are involved, and how you know
— did you read them live, or read them in a document? Documents in this repo go
stale within the hour. Flag anything you did not verify yourself.>

**6. Confirmation of what I have NOT done. [MANDATORY]**
<Confirm, explicitly: no branch created, no migration file written, no push to
preview or production, no `supabase` CLI command run, no Supabase MCP call, no
psql, no background task chip. If you did any of these before reading this
file, say which — that is a handover, and you must ALSO fill in the Part A
template so the coordinator can clean up after you.>
```

### What happens next

1. The coordinator reads the `REQUEST QUEUE` and **verifies every claim against
   the live repo and the live schema** before believing any of it.
2. The coordinator dispatches the work to a **sub-agent in its own worktree**,
   serialized against any other schema change already in flight.
3. The coordinator **moves your block to `## IN PROGRESS`**, adding the branch
   name and the agent handling it, so you can see it is live.
4. When the PR merges, the coordinator **moves the block to `## COMPLETED`**
   with the PR number and the date.

Only the coordinator moves blocks between sections. As a requester you **append
once and then leave the file alone** — do not edit your block in place, do not
tidy it, do not move it. If something changed, append a new dated block saying
so. This file is a log, not a worksheet.

---

## Message Albert can send to any session that NEEDS database work (copy-paste, verbatim)

> I need something done to our shared database, but I do not want you to start
> it. That database is used by four different applications at the same time, and
> when two people change it at once things break — that has already happened
> here more than once. Only one session is allowed to make changes, and it is
> not you.
>
> So please do exactly one thing instead. Open the file `COORDINATOR_INTAKE.md`
> at the top level of the `shared-db` project, read the section called "Part 0",
> and fill in the request form at the bottom of it under the heading "REQUEST
> QUEUE". Describe what I need in plain business terms — what outcome I am
> after and why — rather than deciding how it should be built. Say which of our
> applications depend on it, whether anything is stopped while it waits, and
> whether there is a real deadline.
>
> While you do that, do not create a branch, do not write a migration file, do
> not run any `supabase` command, do not connect to the database, and do not
> create any background tasks. Even if the change sounds tiny — small changes
> are the ones that have caused the damage.
>
> Then commit just that one file change on its own branch, open a pull request,
> and leave it open without merging it. Send me the pull request link and stop
> there.

---

## Message Albert can send to any other session (copy-paste, verbatim)

> Stop what you are doing on the shared-db project. This database is shared by
> four applications and only ONE session is allowed to coordinate work on it —
> and that is not you. Do not start anything new, do not continue what you were
> doing, do not commit, merge, push, or touch the database.
>
> Instead, do exactly one thing: open the file `COORDINATOR_INTAKE.md` at the
> root of the `shared-db` repository, read the section called "Part A", and fill
> in the handover template at the bottom of that file with everything you know
> about what you were working on. Follow the template exactly — including the
> section about things you tried that did NOT work, which is mandatory, because
> that is what stops the next session wasting hours repeating a dead end. Be
> specific: branch names, pull request numbers, migration file names, and
> anything you changed on the preview database.
>
> Commit that change to `COORDINATOR_INTAKE.md` on its own branch, open a pull
> request, and leave it OPEN — do not merge it. Then tell me the pull request
> link and stop. Do not do any other work, and do not create background tasks.
>
> If you believe you have unfinished or half-applied work, say so plainly in the
> handover rather than trying to finish it.

---

## Standing facts an incoming session must know

Read these before you write anything. Several of them describe failures that
have already happened in this repo, more than once.

1. **One coordinator.** All work is dispatched to sub-agents in isolated
   worktrees. If you were not started as the coordinator, you are not it.
2. **One schema change in flight at a time.** Two simultaneous schema edits are
   the number-one cause of a broken shared database here.
3. **Never edit a migration that has already been applied.** The migration
   ledger already records that version as run, so editing the file changes
   nothing on any database that has seen it — it only makes the repo lie. Fix
   forward with a new migration.
4. **Duplicate 14-digit migration versions cause a SILENT SKIP.** Two files with
   the same version prefix: one applies, the other is quietly ignored with no
   error. This has happened twice — `20260722220000` and `20260728160000`. CI
   now blocks duplicate versions and backdated versions, but do not rely on CI
   to save you; pick a version above the current maximum in
   `supabase/migrations/`.
5. **Never create background task chips for this repo — banned.** Four
   chip-spawned sessions recently authored competing `CREATE OR REPLACE`
   migrations against the *same* database function, three of them sharing
   version `20260731170000`. Because of rule 4 those would have silently erased
   each other. Chips spawn sessions that cannot see each other; this repo cannot
   survive that.
6. **The Supabase MCP server may be bound to PRODUCTION, and it takes no
   project parameter.** There is no way to aim it at preview. Call
   `get_project_url` FIRST and confirm which project you are actually pointed at
   before any other MCP call. All preview work goes through the Supabase CLI /
   psql, and you must verify `cat supabase/.temp/project-ref` immediately before
   every push.
7. **Preview (`rjyboqwcdzcocqgmsyel`) is a SHARED, MUTABLE resource** holding a
   full clone of production data. It is currently **NOT a clean baseline** —
   other sessions have written to it. Never assume it is empty, never assume it
   matches production, and treat anything you apply there as visible to everyone
   else.
8. **Documents in this repo go stale within the hour.** Verify against the live
   repo, not against what a Markdown file says.

---

## Part A — you are handing over

You are not the coordinator. Therefore:

- **Do not start work. Do not continue work.** No commits to code, no
  migrations, no database contact, no merges, no PR merges, no deletions of
  branches or worktrees.
- **Do not create background task chips.** See standing fact 5.
- **Write one block per workstream** into the INTAKE QUEUE below, using the
  template exactly. If you were doing three unrelated things, that is three
  blocks.
- **Commit only your addition to this file**, on its own branch, open a PR, and
  leave it OPEN. Report the PR link and stop.
- **Be honest about half-finished work.** A block that says "I applied something
  to preview and I am not sure what state it left behind" is far more useful
  than a tidy block that hides it.

### The template — fill in every heading

```markdown
### INTAKE — <short workstream name> — <YYYY-MM-DD> — <session/agent identifier>

**1. What I was doing and why.**
<Plain English. What was the goal, and what problem was it solving? Assume the
reader has never heard of this workstream.>

**2. What I have actually DONE.**
<Facts only, not intentions. Commit SHAs. Branch names. PR numbers AND their
state (open / merged / closed / draft). Files created or changed. If nothing was
committed, say "nothing committed".>

**3. What I applied to PREVIEW (`rjyboqwcdzcocqgmsyel`).**
<Migrations pushed, with version numbers. AND data rows written, updated, or
deleted — data writes count and must be listed here, including one-off INSERTs,
UPDATEs, backfills, and test rows. Say "nothing" only if you are certain.
If you touched production, say so first and loudly.>

**4. What is half-finished or abandoned mid-way.**
<Anything started and not completed: a migration written but not pushed, a
backfill that ran partially, a script left mid-edit, a PR opened without CI
passing. Include anything you cannot prove either way.>

**5. What I own right now.**
<Branches, worktree paths, and files I am currently holding. For each: is it
DIRTY (uncommitted changes) or clean? Anyone taking over needs to know what
they must not pull out from under me.>

**6. What I was ABOUT to do next.**
<The exact next action, specific enough to execute.>

**7. What I am blocked on.**
<State the blocker AND its type: (a) blocked on another workstream — name it;
(b) blocked on a decision only Albert can make — state the decision in plain
English, with the options; (c) blocked on access/credentials.>

**8. What I tried that did NOT work, and why. [MANDATORY — do not skip]**
<Every dead end, failed approach, misleading error, and rejected design, with
the reason it failed. This section is the whole point of the handover: it is
what stops the next session burning a session repeating your dead end. If you
genuinely tried nothing that failed, write "nothing failed — this workstream
never got past planning" rather than deleting the section.>

**9. Facts I believe that may already be stale.**
<Anything I am relying on that I read from a document, or observed more than an
hour ago, or that another session may have changed since: migration versions,
PR states, preview contents, branch tips. Flag it so the coordinator re-checks
rather than inheriting my assumption.>
```

---

## Part B — you are the coordinator ingesting a block

There are two kinds of incoming block and they arrive in different queues:

- a **REQUEST** (Part 0) — someone who has *not* started; the good case
- an **INTAKE** (Part A) — someone who *has* started and is stopping; the
  clean-up case

Both are verified the same way, and both then follow the lifecycle in
"Part B2 — keeping this file swept" below. **Only the coordinator moves a block
between sections.**

**Do not trust the block.** Every incoming block is a claim about the world made
by a session that may have been wrong, may have been working from a stale
document, or may have been overtaken by another session in the meantime.
Documents in this repo have gone stale within the hour.

Verify before you act:

1. `git fetch --all --prune=false` — get the real remote state. (Do not prune
   or delete anything while agents may be live.)
2. `gh pr list --state all --limit 40` — confirm every PR number and state the
   block claims. "Merged" claims are wrong often enough to check every time.
3. `git worktree list` and `git branch -vv` — confirm who actually owns which
   branch and worktree, and whether anything is dirty.
4. `ls supabase/migrations/` — establish the **real** current maximum migration
   version, and check for any duplicate 14-digit prefixes before dispatching a
   migration task.
5. Confirm which Supabase project any tool is pointed at (`get_project_url`
   first for MCP; `cat supabase/.temp/project-ref` for the CLI) before letting
   any sub-agent near a database.

Then:

6. **Dispatch the work to sub-agents** in isolated worktrees, per the
   `shared-db-orchestrator` skill. The coordinator does not do the work itself.
   Serialize anything that touches schema — one schema change in flight.
7. **Move the ingested block to the TAKEN OVER section**, below, with the date
   it was taken over. **Do not delete it.** The dead-end history in section 8 of
   each block stays valuable long after the work lands.
8. When the coordinator session itself ends, close out with the
   `shared-db-handover` skill — a handover from a session that used sub-agents
   needs both the coordination state and a separate block per sub-agent. Run the
   sweep in Part B2 **before** writing that handoff.

---

## Part B2 — keeping this file swept (lifecycle, retention, and hygiene)

**Be honest about what this is: a MANUAL discipline, not automation.** Nothing
in CI enforces any of it today. If the coordinator does not do it, it does not
happen — and the evidence that it does not happen by itself is that a single
day's work left **23 worktrees and about 30 stale local branch labels** behind.

### B2.0 — WHOSE JOB IT IS TO KEEP THE `REQUEST QUEUE` CURRENT

The banner at the top of this file says an empty queue does not mean there is no
work. This is the other half of that: **someone is named and accountable for the
queue not being empty when there IS work.** Two owners, no gap between them:

- **The outgoing coordinator, at handover.** Before a coordinator session ends,
  it **MUST** seed or refresh the `REQUEST QUEUE` with **every** outstanding
  item — everything in `HANDOFF.md`'s most recent opening agenda, its
  waiting-on-Albert list, and **every `B<n>` in its `## BACKLOG`** — plus
  anything it dispatched that did not finish. This is a **required completion
  criterion** of the handover, carrying the same weight as the per-sub-agent
  blocks: a handover that leaves the queue un-seeded is **INCOMPLETE**. See the
  **`shared-db-handover`** skill, path (B), "Seed the queue".
- **The active coordinator, as work completes.** Every time an item lands, is
  dropped, or a new one appears, move or add its block the same session — not
  "at handover". The lifecycle in B2.1 is worked continuously, not in a batch at
  the end.

**Short entries, never duplicated detail.** A queue entry is a heading, one or
two sentences of the outcome needed, and a pointer to the section of
`HANDOFF.md` that holds the detail. Copying detail here is how the two documents
drift apart, which has already gone wrong repeatedly. **`HANDOFF.md` is
authoritative; where it and this file disagree, `HANDOFF.md` wins.**

**Why this is written down.** On 2026-07-31 a fresh coordinator read the three
empty queue sections, reported "there is no pending work", and was wrong by
about twenty jobs. The outgoing coordinator had written a long narrative
handover and never populated the queue — because at that time nothing required
it of anyone. Now it does, and it names who.

### B2.1 — Section lifecycle

Two tracks. A block only ever moves forward, and **only the coordinator moves
it**. Nobody else edits, tidies, reorders, or deletes a block — requesters and
handing-over sessions append once and stop.

Request track:

| Section | A block sits here when | Moved on by |
| --- | --- | --- |
| `REQUEST QUEUE` | Filed by a requester; not yet verified or dispatched | Coordinator, once verified and dispatched to a sub-agent |
| `IN PROGRESS` | A sub-agent is working it; annotate with branch name + agent id | Coordinator, once the PR is **merged to `origin/main`** (not merely open, not merely green) |
| `COMPLETED` | Landed; annotate with PR number and merge date | Coordinator, at the retention threshold below — archived, never silently deleted |

Handover track:

| Section | A block sits here when | Moved on by |
| --- | --- | --- |
| `INTAKE QUEUE` | A stopping session wrote its handover; not yet ingested | Coordinator, once every claim is verified and the work is dispatched or explicitly dropped |
| `TAKEN OVER` | Ingested; annotate with the date and what was done with it | Coordinator, at the retention threshold below — archived, never silently deleted |

A block that is dropped rather than done still moves to `COMPLETED` /
`TAKEN OVER`, with one line saying it was dropped and why. Silently deleting an
unwanted request is how the same request comes back three sessions later.

### B2.2 — Retention rule

Prune a block out of this file when **both** are true:

- it sits in `COMPLETED` or `TAKEN OVER`, **and**
- it is either **older than 30 days**, or **outside the most recent 10 blocks**
  in its section (whichever bites first).

*Why those two numbers:* 30 days is roughly the point past which nothing in this
repo's state is still verifiable from memory — PR states, preview contents, and
branch tips have all moved on, so the block has stopped being operational and
become history. 10 blocks is about one busy day of coordination here (this file
was created on a day that produced more than that), so the cap keeps the live
file readable at a glance while never dropping anything from the current or
previous session.

**Pruned content is ARCHIVED, never deleted.** Move the whole block, verbatim
and unedited, into a dated file:

```
docs/intake-archive/YYYY-MM-DD-intake-archive.md
```

One file per sweep date, newest blocks appended at the top, each with a one-line
header saying which section it came from and when it was pruned. Leave a single
line in this file pointing at the archive file so the trail is followable.

*Why archive rather than delete:* **section 8 of every handover block — "what I
tried that did NOT work" — is the most valuable content this repo produces.** It
is the only record of dead ends, and its whole purpose is to stop a future
session burning hours rediscovering them. That value does not expire when the
work lands; it is exactly what a session six weeks from now needs. Deleting it
would trade a permanent loss for a cosmetic gain. `docs/intake-archive/` is the
right home (rather than `docs/verification/`, which holds evidence that a
specific change was proven correct) because these are process records, not
verification artefacts.

### B2.3 — Branch and worktree hygiene

Every intake and every dispatched request spawns a branch, and usually a
worktree. Nothing retires them automatically.

When a block moves to `COMPLETED` or `TAKEN OVER`, the coordinator must, **in
this order**:

1. **Verify the branch actually merged** into `origin/main` — by commit, not by
   the PR page's word. `git branch --merged origin/main` and confirm the SHA is
   an ancestor of the tip. A block does not reach `COMPLETED` on an unmerged
   branch.
2. **Retire the worktree** — but **NEVER remove a worktree that is dirty, that
   is locked, or that a live process is holding.** Uncommitted work in an agent
   worktree is unrecoverable once removed, and an agent may still be running in
   it. If it is dirty, locked, or busy, leave it and record why. Use the
   **`cleanup-worktree` skill** as the procedure — it exists precisely because
   ad-hoc `git worktree remove` has destroyed work before. Do not improvise.
3. **Delete the LOCAL branch label only** — and only when it is fully merged to
   `origin/main` *and* checked out in no worktree. `git branch -d` (never
   `-D`, which discards unmerged commits without asking).
4. **Never delete a remote branch by hand.** The merge deletes it. A hand-
   deleted remote branch removes the only copy of work that may not have merged
   the way the PR page claimed.
5. **Never prune while agents may be live.** `git fetch --prune` and any branch
   sweep race sessions that are still creating branches. Sweep only when the
   repo is quiet.

### B2.4 — The periodic sweep

The coordinator performs the sweep **twice per session: at session start and
again at handover.** Both are checklist items, not optional tidying:

**At session start (before dispatching anything):**

- [ ] `git fetch --all --prune=false`, then `git worktree list` and
      `git branch -vv` — know what exists before adding to it.
- [ ] Move any `IN PROGRESS` block whose PR has merged to `COMPLETED`.
- [ ] Apply the retention rule (B2.2) — archive anything past threshold.
- [ ] Apply branch/worktree hygiene (B2.3) to everything now in `COMPLETED` /
      `TAKEN OVER`, **only if the repo is quiet**.

**At handover (before writing the handoff):**

- [ ] Same four steps again.
- [ ] Additionally: list every worktree left behind that was NOT retired, and
      say for each one *why* (dirty / locked / live agent), so the next
      coordinator does not have to work it out.

### B2.5 — Backlog: this should eventually be enforced by CI

Recorded as a backlog item, **not built** — see the `## BACKLOG` section of
`HANDOFF.md`. A CI job could enforce B2.2 and B2.3 mechanically: fail (or warn)
when `COMPLETED` or `TAKEN OVER` blocks exceed the 10-block / 30-day threshold,
and warn when a local branch has been merged to `origin/main` for more than 30
days and is still present. Until someone builds it, the discipline above is the
only control.

---

## REQUEST QUEUE

Work that has been **requested but not started**. Newest first. Append your
block using the Part 0 template — do not edit anyone else's, including your own
after it is filed. Only the coordinator moves a block out of here.

> **Seeded 2026-07-31 from `HANDOFF.md`.** The entries below are the real
> outstanding work of this project, transcribed into queue form so it is visible
> instead of buried in prose. **They are deliberately SHORT and they are NOT the
> authoritative detail** — for every one of them, `HANDOFF.md` is authoritative
> and must be read before acting. If an entry here and `HANDOFF.md` disagree,
> **`HANDOFF.md` wins** and this entry is stale. Do not copy detail back into
> this file; that is how the two documents drift apart, which has already gone
> wrong repeatedly in this repo.
>
> Priority order for the top of the session is the opening agenda in
> `HANDOFF.md` §U4. Items are listed here in roughly that order.

> **Refreshed 2026-07-31 23:11 UTC** by the outgoing coordinator. Six blocks were
> moved to `## COMPLETED` (rehearsal → #362, manifest → #360, EX/LB/JL framing →
> #369, B8 → #358, B13 → done, B14 → #367). The nine blocks immediately below are
> NEW this refresh. Everything else is carried forward unchanged. **Authoritative
> detail for all of it: `HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md`
> and `HANDOFF.md`. Do not act on the summaries here.**

---

> **Added 2026-08-02 by sub-agent `intake-ingest`.** The four entries immediately
> below fall out of ingesting intake PRs **#365, #366 and #373**. They are
> deliberately SHORT — the authoritative detail is the matching entry in
> `## TAKEN OVER` at the bottom of this file, and the PR it points at. Do not act
> on these summaries alone. Also note, from that ingestion: the *"⚠️ FIRST ACTION:
> un-park the shared checkout"* entry further down is **already satisfied** —
> `C:/repos/shared-db` is on `main` at `4444d72` — and the coordinator can retire
> it.

---

### REQUEST — Re-verify the master-data scoreboard counts merged unverified by PR #337 — 2026-08-02 — session: sub-agent `intake-ingest`

**1. What outcome is needed, and why.** PR #337 merged live row counts into
`docs/master-data-cutover-scoreboard.md` from an uncoordinated session that never
confirmed which Supabase project it read. Either re-verify them read-only or mark
them unverified in the doc — a scoreboard nobody can trust is worse than none.

**2. Which application(s) depend on this.** None at runtime; it is the document
sessions use to decide what is cut over to ColdLion.

**3. Is it blocking anything, and how urgently?** Not blocking. LOW.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** Nothing verified — this
agent made **no database call**. Detail: `## TAKEN OVER` → intake PR #365.

**6. Confirmation of what I have NOT done. [MANDATORY]** No branch beyond this
file's own, no migration, no preview or production push, no `supabase` CLI, no
Supabase MCP call, no psql, no chip, no database call of any kind.

---

### REQUEST — Document the MG07-becomes-populated reconciliation case (docs only) — 2026-08-02 — session: sub-agent `intake-ingest`

**1. What outcome is needed, and why.** ColdLion MG07 "Style Guide" (divisions
01/08) is empty and deliberately skipped, but **no document says what to do if it
is ever populated** — those rows would have to reconcile against the style guides
already in `core.style_guide`. One short section closes it, and stops the "nobody
has looked at MG07" claim resurfacing a third time.

**2. Which application(s) depend on this.** PopDAM and DesignFlow (the character /
style-guide taxonomy).

**3. Is it blocking anything, and how urgently?** Not blocking. LOW. ⚠️ Agent
`characters-phase1` currently owns `docs/characters-*` — coordinate before writing
near `fix_characters_style_guides.md`.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** No schema change involved.
MG07 being empty is **documented (2026-07-23), not verified live**. Detail:
`## TAKEN OVER` → intake PR #366, and
`docs/designflow-master-data-migration/README.md` §3.5.

**6. Confirmation of what I have NOT done. [MANDATORY]** No document written, no
branch beyond this file's own, no migration, no database call of any kind.

---

### REQUEST — Close the pre-link ColdLion alert-delivery gap (HOLD — may be the same defect `alert-diagnosis` is on) — 2026-08-02 — session: sub-agent `intake-ingest`

**1. What outcome is needed, and why.** When `supabase link` fails, the alert that
should announce the failure **cannot fire, because alerting depends on the link
that just failed** — a silent-failure path. Proven by run `30639230244`
(2026-07-31T14:35Z, `failure`).

**2. Which application(s) depend on this.** The ColdLion ingestion lane's own
alerting (preview today, production after Step 8).

**3. Is it blocking anything, and how urgently?** Not blocking. **HOLD — do not
dispatch yet.** Agent `alert-diagnosis` is live on the red hourly preview alert
monitor and this may be the same defect. Wait for its report, then decide.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** Nothing verified — no
database call was made. The block's preview health claims (`ready:true`, 542/542,
"no open critical database alert") are **UNVERIFIED and in tension with the live
red monitor**. Detail: `## TAKEN OVER` → intake PR #373.

**6. Confirmation of what I have NOT done. [MANDATORY]** Not diagnosed, not
dispatched, not acknowledged, no breaker touched. No branch beyond this file's
own, no migration, no database call of any kind.

---

### REQUEST — Restart ColdLion Phase 6 preview monitoring under the coordinator — 2026-08-02 — session: sub-agent `intake-ingest`

**1. What outcome is needed, and why.** The recurring preview-only monitor stopped
on 2026-08-01 when its session discovered the coordinator rule. Evidence has not
been recorded since **2026-07-31T18:56:08Z**. Someone must resume collecting it —
preview only, production untouched, Phase 7 untouched.

**2. Which application(s) depend on this.** The ColdLion licensor/property feed;
its evidence trail feeds the Step 8 approval package.

**3. Is it blocking anything, and how urgently?** Not blocking, but the evidence
gap widens hourly. MEDIUM. Sequence it **after** the alert entry above so two
agents are not on the same lane.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** The 8 most recent Phase 6
preview runs (to 2026-08-02T11:32Z) all concluded `success` — verified via
`gh run list`. All preview *database* state claims are **UNVERIFIED**. Detail:
`## TAKEN OVER` → intake PR #373.

**6. Confirmation of what I have NOT done. [MANDATORY]** No monitoring run, no
workflow dispatched, no evidence file written. No branch beyond this file's own,
no migration, no database call of any kind.

---

### REQUEST — Establish what the 3 UNATTRIBUTED worktrees are before anyone sweeps — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** `git worktree list` returns 34 entries. 31
are attributed to a named agent or session; **3 are not, and no PR has ever existed
for any of their branches** (`nbc-alias-work`, `worktree-agent-a9b9b048681d1744f`,
`claude/elastic-babbage-df8f2e`). They are clean, but **clean is not finished** —
that is exactly backlog **B11**. Establish what they are before any sweep touches
them. This supersedes the counts in the older "Sweep the 22 worktrees" block below.

**2. Which application(s) depend on this.** None — repository hygiene, but with a
real data-loss failure mode.

**3. Is it blocking anything, and how urgently?** Not blocking. **But it blocks the
sweep**, and a sweep run without it repeats the B11 incident (a sweep already
deleted a live agent's workspace today).

**4. Deadline, if any.** None. **Do not rush it — an honest unknown is safe, a
wrong "safe to clean" is not.**

**5. What I already know about the current schema.** N/A — no schema involved. All
34 worktrees verified CLEAN at 2026-07-31 ~23:20 UTC; merged-ness established via
`gh pr view`/`gh pr list --state all`, **not branch-tip ancestry** (this repo
squash-merges, so ancestry gives the wrong answer). Full ledger: handover §3.8.

**6. Confirmation of what I have NOT done. [MANDATORY]** **No worktree removed, no
branch deleted, no prune, no force — nothing was cleaned.** No branch created beyond
this handover's own, no migration, no preview or production push, no `supabase` CLI,
no Supabase MCP call, no psql, no chip, no database call of any kind.

---

### REQUEST — ⚠️ FIRST ACTION: un-park the shared checkout `C:\repos\shared-db` from an intake branch — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** The shared checkout is sitting on branch
`intake/coldlion-comparison-handover-20260731`, **not `main`**. It is clean, so
nothing is at risk of loss, but the next session that opens it and assumes `main`
will read stale files or branch from the wrong base. This supersedes the older
"Update the stale shared checkout" block further down, which described a
different (staleness) problem.

**2. Which application(s) depend on this.** None directly — it is a working-copy
hazard affecting every future shared-db session on `t16`.

**3. Is it blocking anything, and how urgently?** Not blocking, but it is the
single most likely way the next session goes wrong. **Do it before anything else.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A — no schema involved.
Exact commands and the verification gate: handover §3.2.

**6. Confirmation of what I have NOT done. [MANDATORY]** The outgoing coordinator
did not switch the shared checkout (its own work was done in an isolated
worktree). No branch deleted, no migration, no preview or production push, no
`supabase` CLI, no Supabase MCP call, no psql, no chip.

---

### REQUEST — Make the production migration lane able to produce a plan again (NEW Step 8 blocker) — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** The production lane **cannot produce a
plan today**: 6 of the 14 promotable ColdLion migrations sort older than
production's ledger head, so the Supabase CLI refuses them without
`--include-all`, which the workflow does not pass. This needs a **workflow
change**, bounded to an explicit file list — a blanket `--include-all` is exactly
how an unintended migration gets applied.

**2. Which application(s) depend on this.** All four — it gates the ColdLion
licensor/property taxonomy reaching production.

**3. Is it blocking anything, and how urgently?** **Blocking Step 8.** Nobody is
idle, but Step 8 cannot even be put to Albert until this is solved.

**4. Deadline, if any.** None stated.

**5. What I already know about the current schema.** Verified live at ~22:45 UTC:
production ledger 359 rows, head `20260731230000`, exactly **27 pending**. Related
ordering trap (`20260729120000` after `20260728174500` → `undefined_function`
42883) confirmed. Detail: handover §5.3, §5.4;
`docs/coldlion-production-migration-manifest-20260731.md`.

**6. Confirmation of what I have NOT done. [MANDATORY]** No design written, no
workflow edited, no branch, no migration, no production apply, no `supabase` CLI
run by this session, no Supabase MCP call, no psql, no chip.

---

### REQUEST — Ingest the two un-ingested intake PRs #365 and #366 — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** Both PRs are intake handovers from
uncoordinated sessions. Neither has been ingested. **Do not merge them
unverified** — that launders unchecked claims into `main`. Verify every claim
against the live repo and live schema, then dispatch or explicitly drop, then move
each block to `## TAKEN OVER` per Part B2.1.

**2. Which application(s) depend on this.** Unknown until the blocks are read;
both concern ColdLion.

**3. Is it blocking anything, and how urgently?** Not blocking, but they are open
PRs accumulating drift against a moving `main`.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** Nothing verified from these
blocks — that is the point. Both PRs re-checked as `MERGEABLE` at 23:11 UTC.
Detail: handover §3.5.

**6. Confirmation of what I have NOT done. [MANDATORY]** Not merged, not closed,
not ingested, not verified. No branch, no migration, no database call of any kind.

---

### REQUEST — Diagnose the hourly preview ColdLion alert-monitor failure (READ-ONLY FIRST) — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** The preview alert monitor has failed
**every hour since 20:02 UTC** with "An undelivered ColdLion taxonomy alert exists.
Human response owner: Albert Hazan." It is almost certainly residue of the ENOBUFS
breaker trip, but that is **unproven** and it names Albert. Establish what it is
before anything is acknowledged or cleared.

**2. Which application(s) depend on this.** None directly; it is the ColdLion
ingestion lane's own alerting in preview.

**3. Is it blocking anything, and how urgently?** Not blocking work, but it is a
**live red alarm** and every hour it repeats erodes trust in the alerting.

**4. Deadline, if any.** None, but it is noisy now.

**5. What I already know about the current schema.** Preview
`rjyboqwcdzcocqgmsyel` carries `ingest.sync_run` failure rows and breaker events
from the ENOBUFS defect, and the breaker was reset twice **by an agent** so
`reset_by` names a sub-agent, not a human. Read live by a sub-agent, not by this
session. Detail: handover §3.4, §3.6.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing touched: no alert
acknowledged, no breaker reset, no branch, no migration, no `supabase` CLI, no
Supabase MCP call, no psql, no chip, **no database call of any kind by this
session.**

---

### REQUEST — Put the 5 remaining ColdLion property-code contract questions to Albert (READY TO ASK) — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** Five unmatched ColdLion property codes
need an owner ruling before they can be admitted: `AM1`/`AM2` (Anchorman), `MGM`
(Mighty Mouse), `WND` (It's a Wonderful Life), `EP` (Emily in Paris). The
supporting table now exists, so this is **askable today**. Recommendation on
record: admit all 33 unmatched codes.

**2. Which application(s) depend on this.** PopDAM and DesignFlow most directly;
the taxonomy is shared by all four.

**3. Is it blocking anything, and how urgently?** Blocks admitting the unmatched
codes. Not urgent, but it is cheap and unblocks cleanly.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** 33 unmatched codes (not 66);
27 of them created in ColdLion on 2026-07-30. Artefact:
`docs/coldlion-unmatched-properties-by-licensor-20260731.md` (PR #369).
⛔ **Do NOT re-ask the six licensor-alias rulings (settled in PR #352), do NOT
re-open Sesame Workshop → Sesame Street, and do NOT re-ask `EX`/`LB`/`JL` — Laura
answered those correctly in round 1.** Detail: handover §5.7, §6 step 4.

**6. Confirmation of what I have NOT done. [MANDATORY]** Albert has not been
asked. No branch, no migration, no preview or production push, no `supabase` CLI,
no Supabase MCP call, no psql, no chip.

---

### REQUEST — Re-offer the "prove which database you are connected to" rule — Albert DECLINED TO ANSWER — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** A proposed `AGENTS.md` rule requiring an
agent to prove which database it is connected to **before any `DELETE` / `UPDATE`
/ `DROP`** was put to Albert and he **did not answer**. **Silence is not
approval.** It is open and must be re-offered plainly for an explicit yes or no.

**2. Which application(s) depend on this.** All four — it is a safety rule over
the shared database.

**3. Is it blocking anything, and how urgently?** Not blocking. But the 442-row
production delete this rule was prompted by has already happened once.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A — process rule, not
schema. The proposed text is in the 2026-07-31 coordinator session transcript.
Detail: handover §9 decision 4, §6 step 5.

**6. Confirmation of what I have NOT done. [MANDATORY]** The rule was **NOT**
added to `AGENTS.md` — deliberately, because it was not approved. No branch, no
migration, no database call of any kind.

---

### REQUEST — Characters / style-guides Phase 1 (read-only, dispatchable NOW) — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** Compare PopDAM's existing character /
style-guide mapping against the licensing team's 174-row review, as a **read-only**
document. **Phase 0** (reconciling the two into a decision) is blocked on Albert;
**Phase 1 is not blocked and can be dispatched immediately.**

**2. Which application(s) depend on this.** PopDAM primarily; the resulting
taxonomy is shared.

**3. Is it blocking anything, and how urgently?** Phase 1 is not blocking. Doing
it now shortens Phase 0 once Albert answers.

**4. Deadline, if any.** Laura's round-2 reply (166-row characters sheet, sent
2026-07-31) is awaited and may supersede parts of it.

**5. What I already know about the current schema.** Not verified live by this
session. `HANDOFF.md` is authoritative. Detail: handover §6 step 10, §9.

**6. Confirmation of what I have NOT done. [MANDATORY]** Not started. No branch,
no migration, no preview or production push, no `supabase` CLI, no Supabase MCP
call, no psql, no chip.

---

### REQUEST — Add supersession pointers to the 2 LIVE docs still asserting the bronze layer is immutable — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** Albert's ruling ("ColdLion ERP data is
canonical, follow it") is recorded in `AGENTS.md` §6.3, but **5 further places**
still assert the bronze layer is immutable. Two of them are **LIVE documents a
future session could act on** and still need a supersession pointer:
`HANDOFF.md:5381` and `fix_schema_for_api.md:40,159`.

**2. Which application(s) depend on this.** None directly — it prevents a future
session acting on a superseded rule.

**3. Is it blocking anything, and how urgently?** Not blocking. Low effort, real
contradiction risk.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A — documentation only.
⛔ **Do NOT edit the two applied migrations carrying stale comments
(`20260722171500`, `20260722213000`)** — editing an applied migration changes
nothing in the database and desynchronises the file from the ledger. That omission
was deliberate. Detail: handover §5.8, part (b) block 19.

**6. Confirmation of what I have NOT done. [MANDATORY]** No document edited beyond
this file and the handover. No branch touching those files, no migration, no
database call of any kind.

---

### REQUEST — PopDAM data quality: 8 Exorcist assets filed under NBCUniversal instead of Warner Bros — 2026-07-31 — session: outgoing coordinator (t16)

**1. What outcome is needed, and why.** PopDAM files 8 Exorcist assets under NBC
when **Warner Bros** is the correct licensor. Found incidentally while building the
unmatched-property table. Wrong licensor attribution on licensed assets is a
compliance-adjacent error, not cosmetic.

**2. Which application(s) depend on this.** PopDAM (`popdam3`); the licensor
taxonomy is shared with the other three.

**3. Is it blocking anything, and how urgently?** Not blocking. Small and
self-contained.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** ⚠️ **PopDAM's property codes
are a COLLIDING code space** — its `BB` is Big Bird, ColdLion's `BB` is The Brady
Bunch. Do not join PopDAM codes to ColdLion codes without an explicit mapping;
PopDAM asset counts were deliberately discarded from the #369 analysis for exactly
this reason. Detail: handover §5.7, §4.10.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing changed in
PopDAM or in the database. No branch, no migration, no preview or production push,
no `supabase` CLI, no Supabase MCP call, no psql, no chip.

---

### REQUEST — Assemble the ColdLion Step 8 approval package for Albert — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Give Albert a single package he can
approve or refuse. It must contain **all five prerequisites**: the fresh 18-case
rehearsal artifact; every migration named by **exact version** (from the live
ledger comparison, not counted from a document); the read-only bounded-promotion
dry-run proof; a **production backup and written "before" baseline** (last
claimed 26 licensors / 256 properties / 542 links — UNVERIFIED); and Albert's
**written acceptance of the weaker production alerting** (the alert-monitor
workflow is preview-only and hard-refuses the production ref).

**2. Which application(s) depend on this.** ColdLion feed into production
taxonomy; DesignFlow and popdam3 downstream.

**3. Is it blocking anything, and how urgently?** Blocked on the two entries
above — **do not start it before they land.** HIGH once unblocked.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** No Step 8 approval artifact
exists. `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` lines
399–407 **refuses** an enabled production variable until
`docs/verification/coldlion-licensor-property-step8-approval-*/approval.json`
exists — the paperwork is a working interlock. **Read the 🛑 CRITICAL switch-on
ORDER section of `HANDOFF.md` before touching anything ColdLion: promote →
verify → only then enable; arming production is a single command.**
Authoritative detail: `HANDOFF.md` §U1.2, the 🛑 CRITICAL section, and §U4 item 6.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; the
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` variable has not been created,
set, or requested.

---

### REQUEST — popdam3 worker alias cutover (DIFFERENT REPO) — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** The PopDAM worker in **`u2giants/popdam3`**
still resolves aliases from its own hard-coded arrays. It must read
`core.licensor_alias` and `core.property_alias` instead, and must **prove
`normalizePopSGTag` is byte-identical in behaviour to
`core.normalize_popsg_property_observation` across all 21 frozen fixtures** — two
normalisers disagreeing by one character silently file assets under the wrong
licensor. **Until this lands, every licensor-alias approval recorded in this
database has ZERO runtime effect** and nobody should be told PSG-5 is finished.

**2. Which application(s) depend on this.** popdam3 (PopDAM); PopSG tagging.

**3. Is it blocking anything, and how urgently?** Not blocking shared-db, but it
is the only thing standing between the completed alias work and any visible
benefit. **HIGH.** ⚠️ **Different repository** — it needs its own slot and its
own owner, and is not something a shared-db coordinator starts on its own.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** `core.licensor_alias` (10
rows, 8 `owner_approved`, 2 `inherited_unverified`) and `core.property_alias`
exist on preview — **UNVERIFIED, read from a document.** Authoritative detail:
`HANDOFF.md` §U1.4 and §U4 item 9.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started in
either repo; no database contact.

---

### REQUEST — PopSG PSG-5 rebuild — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** The PSG-5 database work is merged
(`691d5ea`, PR #338) and the **owner gate is now CLOSED** — Albert ruled "all
correct" on all eight licensor aliases on 2026-07-31. **Do not re-ask him, and do
not re-open Sesame Workshop → Sesame Street; the inconsistency was named to him
and accepted.** The actual next step for PSG-5 is the **popdam3 cutover above**,
not further work here. The rebuild itself is on the **do-NOT-start-
opportunistically** list because it competes for the same shared tables.

**2. Which application(s) depend on this.** popdam3 / PopSG.

**3. Is it blocking anything, and how urgently?** Not blocking. **LOW — hold.**
Start only on a deliberate, dedicated dispatch.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** As above; unverified.
Authoritative detail: `HANDOFF.md` §U1.3, §U1.4 and §U4 item 10.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no
database contact.

---

### REQUEST — Sweep the 22 worktrees and ~42 stale local branch labels — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** One day's work left **22 worktrees** and
**~42 local branch labels** already merged into `origin/main`. They were
**deliberately left**: the sweeping session was isolated to its own worktree and
**could not verify the dirty state** of the other 21, and a third-party agent was
concurrently live. ⚠️ **Backlog B11 caution: a PAUSED agent is indistinguishable
from a finished one** — a sweep earlier that day deleted a paused agent's
worktree while breaking no rule. Also: **branch-tip ancestry is NOT a valid
merged-test here** (squash merges); use `gh pr view <n> --json state`.

**2. Which application(s) depend on this.** None — repo hygiene only.

**3. Is it blocking anything, and how urgently?** Not blocking. **LOW.** Run
**only when the repo is quiet**, from a session that can actually inspect each
worktree's dirty state, using the **`cleanup-worktree`** skill. Delete **local
labels only** (`git branch -d`, never `-D`); never delete a remote branch.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` §U1.6, §U3.7, §U3.8, backlog **B11**, and §U4 item 11. Note the
older "sweep ~30 stale local branch labels" note at the bottom of this file is
the same item at an earlier count.

**6. Confirmation of what I have NOT done. [MANDATORY]** No worktree removed, no
branch deleted, no prune run.

---

### REQUEST — Update the stale shared checkout `C:/repos/shared-db` — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** The shared checkout's local `main` was
**nine commits behind** `origin/main` at the last handover. Every session that
starts there begins from a stale tree. One command: `git -C C:/repos/shared-db
pull`. **Check first that no agent is mid-edit in it.**

**2. Which application(s) depend on this.** None — local environment only.

**3. Is it blocking anything, and how urgently?** Not blocking, but it is
**agenda item 2** and takes seconds. **MEDIUM.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` §U1.6 row 1 and §U4 item 2.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing pulled, nothing
checked out, no worktree touched.

---

### REQUEST — Backlog B1 — add `.gitattributes` and force LF — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** No `.gitattributes` exists; Windows
checkouts write `.sql` with CRLF, which breaks a comment-stripper regex in
`tools/promote-coldlion-source-owned.test.mjs` and produces tests that fail on
Windows but pass in CI. **Both halves ship together** — the attributes file *and*
the hardened stripper — or neither. **Impact was downgraded 2026-07-31: CRLF is a
non-issue for automation.**

**2. Which application(s) depend on this.** None directly; developer tooling.

**3. Is it blocking anything, and how urgently?** Not blocking. **MEDIUM.** ⚠️ It
**rewrites the working tree of every clone and every live worktree** — land it
only when few sessions are open. Explicitly on the do-NOT-start-opportunistically
list.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B1**.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started.

---

### REQUEST — Backlog B2 — repo-wide checkers gated behind narrow `paths:` filters — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** `scripts/check-domain-ownership.mjs`
scans every tracked file but its workflow only triggers on a narrow `paths:`
filter that excludes `HANDOFF.md` — so the guard can be tripped by a file it does
not watch and **cannot be un-tripped**, leaving `main` stale-red indefinitely.
Fix is a **separate tiny workflow with no `paths:` filter**. ⚠️ **Widening the
existing filter is the WRONG fix** — it also gates a Docker build, Playwright
tests and a Coolify deploy.

**2. Which application(s) depend on this.** DB Data Admin CI.

**3. Is it blocking anything, and how urgently?** Not blocking. **MEDIUM.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B2**; `AGENTS.md` §5.2.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started.

---

### REQUEST — Backlog B3 — sweep pre-existing `SECURITY DEFINER` privilege exposure — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Roughly 200 pre-existing functions carry
default `EXECUTE` grants (advisors report ~88 anon, ~118 authenticated, ~38
mutable search_path, 15 ERROR-level security-definer views). The **root cause
going forward is already fixed** (`20260729120000`); the historical sweep is not.
⚠️ **This is an AUDIT, not a script** — a grant to `authenticated` is not
automatically a defect.

**2. Which application(s) depend on this.** All four apps.

**3. Is it blocking anything, and how urgently?** Not blocking. **MEDIUM** —
security debt, large, needs its own dedicated slot.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** Counts above read from a
document, **UNVERIFIED**. Authoritative detail: `HANDOFF.md` backlog **B3**;
`AGENTS.md` §10.2.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no
database contact.

---

### REQUEST — Backlog B4 — backlog discipline: never create background task chips — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Already **in force as a written rule**
(standing fact 5 above, and `AGENTS.md`). Listed here only so nothing in the
backlog is invisible. Four chip-spawned sessions authored competing
`CREATE OR REPLACE` migrations against the same function, three sharing one
version — they would have silently erased each other.

**2. Which application(s) depend on this.** N/A — process.

**3. Is it blocking anything, and how urgently?** Not blocking; **no action
required** unless someone wants to add enforcement. **LOW.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B4**; `HANDOFF.md` §U3.1.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no chip
created.

---

### REQUEST — Backlog B5 — items carried forward from elsewhere in HANDOFF.md — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** B5 is an index, not a task. It still
holds two live constraints worth surfacing: **`20260729120000` is still pending
on production** and must be promoted **with or after** the ClickUp migrations
(`20260728174500`), never before, or the apply aborts with `undefined_function`;
and **characters/style guides Phase 0 is blocked on an owner decision** while
**Phase 1 is read-only and can start now**. Its PSG-5 bullet ("eight licensor
aliases remain a blocking owner gate") is **STALE — that gate is closed.**

**2. Which application(s) depend on this.** Shared database; DesignFlow;
licensing team.

**3. Is it blocking anything, and how urgently?** The migration-ordering
constraint is a **hard constraint on any production promotion**. **MEDIUM.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** From documents only.
Authoritative detail: `HANDOFF.md` backlog **B5** and
`fix_public_schema_anon_lockdown.md`.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no
database contact.

---

### REQUEST — Backlog B6 — cross-PR object collision guard — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** CI cannot see a sibling **open** PR, so
two PRs that both `create or replace` the same database object both pass and
whichever merges second **silently overwrites** the first. The four-way collision
that actually happened on 2026-07-31 **would pass CI again today, unchanged.**
This is the root cause of the chip incident and the reason single-writer
ownership is a convention rather than a mechanism.

**2. Which application(s) depend on this.** All — it protects the shared schema.

**3. Is it blocking anything, and how urgently?** Not blocking, but **this and B7
are the highest-value items in the backlog. HIGH.** ⚠️ Do not implement
opportunistically — it changes CI for every workstream and needs its own
coordinated PR and a token that can read the repo's PRs.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B6**.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started.

---

### REQUEST — Backlog B7 — mandatory negative-path assertions (prove the guard FIRES) — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Three separate defects on 2026-07-31
installed cleanly, compiled, passed review — **and did nothing**: a `BEFORE`
trigger reading a `GENERATED ... STORED` column, a function that failed on every
call, and an alert path that never recorded. Existence checks are **worthless**
against this class of defect. Tests must assert the guard **refuses**, not merely
that it exists.

**2. Which application(s) depend on this.** All — test discipline for the shared
schema.

**3. Is it blocking anything, and how urgently?** Not blocking. **HIGH — joint
highest-value with B6.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B7**.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started.

---

### REQUEST — Backlog B9 — no "armed but read-only" state for the production enable variable — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** The read-only `readiness` lane sits
inside the `production` job, gated on the enable variable — so setting
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` **simultaneously arms the 06:00
snapshot, the 06:30 promotion (which WRITES to production), the 07:00 comparison
and the hourly health lane.** The one check you want to run *before* committing is
only available *after* committing.

**2. Which application(s) depend on this.** ColdLion production feed.

**3. Is it blocking anything, and how urgently?** Not formally blocking, but it
materially raises the risk of Step 8. **MEDIUM** — worth doing **before** switch-
on. Its own PR, its own review; it changes the production workflow.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B9** and the 🛑 CRITICAL switch-on ORDER section.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; the
variable has not been created or set.

---

### REQUEST — Backlog B10 — CI enforcement of this file's lifecycle and retention — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Part B2 of this file is **manual
discipline with no enforcement** — which is exactly how one day left 22 worktrees
and ~42 stale branch labels behind. A CI job could warn or fail when
`COMPLETED`/`TAKEN OVER` blocks exceed the 10-block / 30-day threshold, and when a
long-merged local branch still exists. ⚠️ **Do not duplicate the thresholds into a
workflow** — Part B2 is the authority and a copy will drift.

**2. Which application(s) depend on this.** None — coordination hygiene.

**3. Is it blocking anything, and how urgently?** Not blocking. **MEDIUM-LOW.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B10** and Part B2 above.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started.

---

### REQUEST — Backlog B11 — a paused agent is indistinguishable from a finished one — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** A cleanup agent deleted the worktree of an
agent that had deliberately **paused awaiting re-dispatch**, while breaking no
rule — the worktree was clean, unlocked and held no unmerged work. **The criteria
themselves are insufficient.** A mechanism is needed: either the coordinator keeps
the authoritative list of resumable agents and no sweep runs without checking it,
or a paused agent marks its worktree visibly.

**2. Which application(s) depend on this.** None — coordination safety.

**3. Is it blocking anything, and how urgently?** It **gates the worktree sweep
above** — until it exists, bias hard toward leaving worktrees alone. **MEDIUM.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** N/A. Authoritative detail:
`HANDOFF.md` backlog **B11** and §U3.7.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no
worktree removed.

---

### REQUEST — Backlog B12 — the WSL `psql` wrapper leaks orphaned processes — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Something launches `psql` **through WSL**
and, when the invocation goes wrong, leaves the process alive **indefinitely**.
It is a **recurring leak**, not a one-off. A stuck process is indistinguishable at
a glance from a legitimate long-running one — and a real ClickUp importer run
genuinely took 52 minutes the same day. Fix: an explicit timeout plus guaranteed
cleanup of the temporary SQL and password files, and document the read-only
diagnostic recipe (Actions → local processes → `pg_stat_activity`/`pg_locks`).

**2. Which application(s) depend on this.** None — local tooling; but it burns
coordinator and owner attention.

**3. Is it blocking anything, and how urgently?** Not blocking. **MEDIUM.** Do
**not** implement opportunistically — it touches shared local tooling.

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** ⚠️ **Count discrepancy, do
not assume either figure.** `HANDOFF.md` (both §U1.75 and B12) records **FOUR**
orphaned processes — one from 14:32 on 2026-07-31 (Windows PIDs 19072 / 61204,
Linux PID 17739) and two from the evening of 2026-07-29. A later report puts the
observed count at **SIX**. Nobody has reconciled the two, and whether Albert ran
the `Stop-Process` commands he was given is **UNVERIFIED**. **Re-count the live
processes before believing any number.** Authoritative detail: `HANDOFF.md`
backlog **B12** and §U1.75.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no
process killed; no database contact.

---


## IN PROGRESS

Requests the coordinator has verified and dispatched. Each block is annotated
with the branch name and the sub-agent handling it. Moved here and out again by
the coordinator only.

_(none yet)_

---

## WAITING ON OTHER PEOPLE — visible, but NOT actionable by a coordinator

These are genuinely outside the coordinator's control. They are listed here so
they are not forgotten and **so they are not mistaken for work that can be
dispatched.** Do not dispatch a sub-agent at any of them.

1. **Albert — merge `ai-devops` PR #1, then run "sync my dotfiles" on his other
   machines.** That PR carries the `shared-db-orchestrator` and
   `shared-db-handover` skills, which currently exist on **one machine only**.
   Until it lands, every other machine runs shared-db sessions without the
   coordination rules — the exact condition that produced the chip incident.
   *Coordinator's only action: chase it.* (`HANDOFF.md` §U1.5 item 1, §U4 item 8.)

2. **Laura — reply to the round-2 licensing xlsx, SENT 2026-07-31.** Nothing to
   do but wait. (`HANDOFF.md` §U1.5 item 3.)

3. **Albert — the ColdLion Step 8 production decision. ⛔ NOT YET ASKABLE.** The
   rehearsal prerequisite is unmet, so there is nothing to put to him. **Do not
   ask him about Step 8, and do not create or set
   `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`,** until the rehearsal and the
   approval package in the REQUEST QUEUE are complete. (`HANDOFF.md` §U1.2,
   §U1.5 item 2.)

**Note:** the `EX` / `LB` / `JL` property codes are deliberately **not** on this
list. They are not waiting on Albert — they are waiting on **us** to frame them
as an answerable question, which is a live item in the REQUEST QUEUE above.

---

## COMPLETED

Requests that landed, each annotated with the PR number and merge date. Pruned
to `docs/intake-archive/` under the retention rule in Part B2.2 — archived,
never deleted.

> **Refreshed 2026-07-31 23:11 UTC by the outgoing coordinator (`HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md`).** The six blocks below were moved here VERBATIM from `## REQUEST QUEUE` under the Part B2.1 lifecycle. Each is preceded by a single completion line naming the PR and merge date; the block body itself is unedited. Nothing was deleted. None is yet past the Part B2.2 retention threshold, so nothing was archived this sweep.

---

**[moved from `REQUEST QUEUE` 2026-07-31]** **COMPLETED 2026-07-31 — PR #362 (merged).** 18/18 PASS incl. cases 10a-10d (first execution ever); four tooling defects found and fixed. Conditions closed on the same PR; follow-on B14 raised and since resolved by PR #367. Detail: `HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md` part (b) blocks 5-8.

### REQUEST — Re-run the ColdLion 18-case rehearsal against the CURRENT function body — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Prove that the ColdLion licensor/property
promotion still behaves correctly *as it exists today*. The celebrated "14/14
passed" evidence describes the function at migration `20260730000500`; four
`CREATE OR REPLACE` migrations landed after it and were applied to preview but
never re-rehearsed. **Applied is not rehearsed.** Four cases (`10a`–`10d`) have
**never executed at all**. Output must be a **dated evidence artifact committed
to the repo**, not a chat message.

**2. Which application(s) depend on this.** ColdLion → DesignFlow → shared
Supabase licensor/property taxonomy; downstream popdam3 and PopSG.

**3. Is it blocking anything, and how urgently?** **BLOCKING.** This is the gate
on everything ColdLion, including Step 8 production switch-on. **HIGHEST
PRIORITY — dispatch this first.**

**4. Deadline, if any.** None stated. Production remains off until it is done.

**5. What I already know about the current schema.** Read from `HANDOFF.md`,
**not verified live**: preview holds all ColdLion migrations through
`20260731200000`; the four unrehearsed versions are `20260731163000`, `180000`,
`190000`, `200000`. Authoritative detail: `HANDOFF.md` §U1.2 and §U4 item 4;
cases at `tools/rehearse-coldlion-recurring-cycles.mjs` lines 398–442.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started: no
branch for this work, no migration, no preview or production push, no `supabase`
CLI, no Supabase MCP, no psql, no chip.

---

**[moved from `REQUEST QUEUE` 2026-07-31]** **COMPLETED 2026-07-31 — PR #360 (merged).** Truth is **27 pending**, not 4; the '~15 unrelated' figure was wrong (it is 9). Independently re-verified CORRECT by a second read-only agent, which also confirmed production was NOT mutated. Artefact: `docs/coldlion-production-migration-manifest-20260731.md`. Detail: `HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md` part (b) blocks 3-4.

### REQUEST — Re-derive the true production migration manifest + read-only dry-run proof — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** Establish, from a **live ledger
comparison** (production `supabase migration list` vs the repo) rather than from
any document, exactly which migrations Step 8 would promote — the plan says four,
the true manifest is roughly **eighteen** — and prove via the read-only
`production-dry-run` lane that the ~15 unrelated pending production migrations
stay out. Never `--include-all`.

**2. Which application(s) depend on this.** All four apps share the database that
would receive the promotion.

**3. Is it blocking anything, and how urgently?** **BLOCKING** Step 8. Can run in
parallel with the rehearsal. **HIGH.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** From documents only:
385 migration files, max version `20260731220000`, next free `20260731230000` —
**re-derive**. Authoritative detail: `HANDOFF.md` §U1.2 and §U4 item 5.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no
database contact of any kind.

---

**[moved from `REQUEST QUEUE` 2026-07-31]** **COMPLETED 2026-07-31 — PR #369 (merged).** Premise was stale: **33 unmatched codes, not 66.** Table delivered at `docs/coldlion-unmatched-properties-by-licensor-20260731.md`. Only 5 rows genuinely need Albert; a new REQUEST QUEUE entry now carries that ask. Detail: `HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md` part (b) block 17.

### REQUEST — Frame the `EX` / `LB` / `JL` property codes (and the 66 unmatched ColdLion codes) as an answerable question for Albert — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** These codes are inherited from an earlier
session and **nobody has yet put them to Albert in a form he can rule on** — no
list, no proposed mapping, no "is this correct?" table. **Producing that question
IS the task.** The format that has actually worked is the approval table in
`HANDOFF.md` §U1.3. Asking him an unframed question wastes the one resource that
cannot be parallelised.

**2. Which application(s) depend on this.** Shared licensor/property taxonomy;
ColdLion feed; DesignFlow.

**3. Is it blocking anything, and how urgently?** Blocked on **nothing** — it can
start immediately, and it must be finished **before** Albert is asked anything
about these codes. **MEDIUM-HIGH** (it unblocks an Albert decision).

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** Only what `HANDOFF.md` §U1.5
item 4 and §U4 item 7 state. Nothing verified live.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started; no
database contact.

---

**[moved from `REQUEST QUEUE` 2026-07-31]** **COMPLETED 2026-07-31 — PR #358 (merged).** 5 tests added, 4 mutations each watched fail, tool restored byte-identical. `compositeKeyOf`'s empty-segment behaviour pinned, not fixed (cannot occur against the frozen artifact). Detail: `HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md` part (b) block 2.

### REQUEST — Backlog B8 — unit test for `tools/emit-coldlion-rollback-sql.mjs` — 2026-07-31 — session: queue-seeding agent

**1. What outcome is needed, and why.** No test file exists, though every other
Step 7A tool has one and CI would pick it up automatically. **This is the
emergency rollback lever** — the thing somebody runs under pressure, during an
incident, against production, probably at night. It has been executed exactly
**once**. Follow B7: assert it **refuses**.

**2. Which application(s) depend on this.** ColdLion production promotion safety.

**3. Is it blocking anything, and how urgently?** Not formally blocking Step 8,
but it is the rollback plan for Step 8. **HIGH.**

**4. Deadline, if any.** Best done before production switch-on.

**5. What I already know about the current schema.** N/A — the test is fully
offline, no database. Authoritative detail: `HANDOFF.md` backlog **B8**.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started.

---

**[moved from `REQUEST QUEUE` 2026-07-31]** **COMPLETED 2026-07-31.** Marked DONE in `HANDOFF.md` (`### B13 ... (DONE 2026-07-31)`, line ~1909). The `Backlog / Queue Sync` check is live and was exercised this session.

### REQUEST — Backlog B13 — CI check that every BACKLOG `B<n>` has a queue entry — 2026-07-31 — session: handoff/intake-sync agent

**1. What outcome is needed, and why.** A **warn-only** CI job that lists any
`### B<n>` in `HANDOFF.md`'s `## BACKLOG` with no matching
`### REQUEST — Backlog B<n> —` heading anywhere in this file. It makes the
documentation rule in § B2.0 mechanical instead of a manual obligation nobody
owns. Authoritative detail, including the recommended design and its five known
failure modes: `HANDOFF.md` backlog **B13**.

**2. Which application(s) depend on this.** None — repo process hygiene only.

**3. Is it blocking anything, and how urgently?** Not blocking. **MEDIUM.**

**4. Deadline, if any.** None.

**5. What I already know about the current schema.** No schema involvement. Must
be **warn-only, never blocking** — same posture as Guard B in
`scripts/check-sql.sh`. A blocking version would gate database work on
documentation bookkeeping and would be disabled the first time it fired
spuriously.

**6. Confirmation of what I have NOT done. [MANDATORY]** Assessed only. **No
script, no workflow, and no `tools/` change was written** — that was an explicit
limit on the assessing session. No database contact.

---

**[moved from `REQUEST QUEUE` 2026-07-31]** **COMPLETED 2026-07-31 — PR #367 (merged).** Root-caused, not raised: paging + spawn-fault classification, `SPAWN_MAX_BUFFER_BYTES` on BOTH spawn paths, page size **measured** (mean 496 B from 570 real records) not estimated, 22/22 mutations killed, CI 428/428. **No longer a Step 8 blocker.** Detail: `HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md` part (b) block 18.

### REQUEST — Backlog B14 — remove the buffered cycle-state-probe cliff (not just raise it) before Step 8 — 2026-07-31 — session: B14 queue-entry agent

**1. What outcome is needed, and why.** A client-side tooling fault must stop
being able to take the ColdLion feed down. PR #362 raised the `runSql` output
buffer so an oversized cycle-state probe is now *diagnosable*, but the cliff was
moved, not removed: an overflow still throws, still writes a durable failed sync
run, and two in a row still auto-trip the circuit breaker — identical blast
radius, better message. The outcome needed is that the probe stops returning the
whole ColdLion mirror as one buffered document, and/or that a spawn-level fault
is not counted as a sync failure at all. **The design is not chosen — that is
the coordinator's call.** Authoritative detail: `### B14` in `HANDOFF.md`.

**2. Which application(s) depend on this.** ColdLion → DesignFlow → shared
Supabase licensor/property taxonomy; downstream popdam3 and PopSG. The same
`runSql` helper powers the real recurring production feed.

**3. Is it blocking anything, and how urgently?** **BLOCKING Step 8** — this must
be resolved **before the production lane is enabled**, because once enabled this
path runs unattended against the production mirror on a schedule. **HIGH.** Not
blocking anything today while production stays off.

**4. Deadline, if any.** None. It is a gate on Step 8, not a dated commitment.

**5. What I already know about the current schema.** No schema involvement — this
is tooling. Read from the repo on branch `rehearsal/coldlion-recurring-20260731`,
**not verified against any live database**: `runSql` in
`tools/coldlion-sync-common.mjs` now passes a 256 MiB `maxBuffer`, and
`tools/coldlion-sync-common-runsql.test.mjs` pins that **current** behaviour
offline — those tests will keep passing after a proper fix and are not evidence
of one. `HANDOFF.md` is authoritative for the rest; do not act on this summary.

**6. Confirmation of what I have NOT done. [MANDATORY]** Nothing started: no
branch created for this work, no migration file written, no push to preview or
production, no `supabase` CLI command, no Supabase MCP call, no psql, no
background task chip, and no database contact of any kind. The only file this
session wrote is this one.

---

---

## INTAKE QUEUE

Newest first. Copy the template from Part A and fill it in. The block below is
an empty example showing the required format — **leave it in place, do not
overwrite it.**

### INTAKE — ColdLion MG07 "Style Guide" doc lookup (read-only) — 2026-07-31 — session: unnamed Claude Code session, machine t16, shared checkout `C:\repos\shared-db`

**1. What I was doing and why.**
Albert asked me to do two things in sequence. First, "pull the latest repo" for
`shared-db`. Second, he relayed a claim made by **another AI session** — that
*"ColdLion has a 'Style Guide' merch group level, type 07. That is directly
relevant to the character work and nobody has looked at it"* — and asked me
whether any `.md` file in this repo already documents pulling that into
Supabase. This was a **documentation-research question only**. No schema change,
no migration, and no database work of any kind was requested or performed. Like
the session in the block below, **I was not started as the coordinator and did
not know this single-coordinator protocol existed** until Albert told me to stop.

**2. What I have actually DONE.**
- **`git pull --ff-only`** in the shared checkout `C:\repos\shared-db`, on
  `main`. It fast-forwarded `53f849f` → `75066fe`. This is the only mutating
  action I took, and it mutated a **local working copy**, not the remote and not
  any database. Nothing was pushed, merged, or rebased. (Note: this partially
  overlaps the existing REQUEST QUEUE entry *"Update the stale shared checkout
  `C:/repos/shared-db`"* — but see §9, it has since moved again and my pull
  should **not** be treated as closing that request.)
- **Read-only searches** of tracked `.md` files using `Grep` and `sed`/`grep`
  via the Bash tool. Files read: `docs/designflow-master-data-migration/README.md`,
  `docs/coldlion-erp-api-reference.md`, `fix_characters_style_guides.md`,
  `fix_characters_style_guides_handoff.md`, plus a repo-wide grep for
  `Style Guide` / `mgTypeCode`. No file was opened for writing.
- **Answered in chat only.** The finding, recorded here so it is not lost:
  MG07 **is** already documented and was **deliberately skipped**, not
  overlooked. `docs/designflow-master-data-migration/README.md` records MG07 as
  81 rows total but only **2 active**, and those 2 are *Art Type* in division 09
  (PHOTO `PH`, ARTIST `AR`), not Style Guide; it states Style Guide in divisions
  01/08 has **"no data yet (future)"** and an active import count of **0**.
  Separately, `docs/coldlion-erp-api-reference.md` shows `mgTypeCode=07` means
  Style Guide only in CW001/SP001 — it is *Art Type* in EH001 and **Character**
  in EP001 — so the relayed claim's "type 07 = Style Guide" is division-
  dependent and not globally true. And `fix_characters_style_guides.md` sources
  `core.style_guide` from `dflow.properties_and_characters` (500 style guides +
  9,622 appearances) plus the licensing sheet, **not** from ColdLion MG07 — so
  an empty MG07 leaves no gap in the character work.
- **Committed:** only this block, on branch
  `intake/coldlion-mg07-styleguide-readonly-20260731`, PR opened and left
  **OPEN — not merged**. Nothing else was committed by this session at any
  point.

**3. What I applied to PREVIEW (`rjyboqwcdzcocqgmsyel`).**
**Nothing.** I am certain: this session made **zero** database calls to any
project. I never invoked the Supabase MCP, never ran `psql`, never called the
ColdLion API, and never used `op_run`. No migrations pushed, no data rows
inserted, updated, or deleted, on preview **or** production
(`qsllyeztdwjgirsysgai`). The only tools used were `git`, `Grep`, `Read`, and
`sed`/`grep`.

**4. What is half-finished or abandoned mid-way.**
**Nothing is half-applied.** There is no partial migration, no partial backfill,
and no half-edited script anywhere from this session, because no such work was
ever started. The only thing left incomplete is a *question I raised and did not
pursue* — see §6. I want to state plainly, because the template asks for it:
I do **not** have unfinished or half-applied database work, and I am not
claiming completeness to look tidy — this session genuinely never touched a
database.

**5. What I own right now.**
- **Branch `intake/coldlion-mg07-styleguide-readonly-20260731`** — created by me
  from `origin/main` at `134ebf4`. Contains exactly one commit: this block.
- **Worktree `C:/Users/ahazan2/AppData/Local/Temp/claude/intake-mg07`** — created
  by me solely to write this handover **without disturbing the shared checkout**
  (see §8). **Clean** after the commit. Safe to retire once this PR is merged.
- **I do NOT own `C:\repos\shared-db`.** I found it on branch
  `intake/coldlion-comparison-handover-20260731` at `0441286`, belonging to the
  session whose block appears below this one (PR **#365**, OPEN). I deliberately
  did **not** switch branches, stash, or commit there. Do not attribute that
  branch or PR to me.
- No other files, branches, or worktrees held. Nothing dirty.

**6. What I was ABOUT to do next.**
I had offered Albert — and he had **not** accepted — to write up the one genuine
gap I found: **there is no document describing what happens if ColdLion ever
starts populating MG07 Style Guide rows in divisions 01/08.** Those rows would
need reconciling against the 335 style guides already established in
`core.style_guide` from the dflow spine, and no `.md` in this repo covers that
collision. If the coordinator wants it, the next action is a docs-only PR adding
that reconciliation note to `fix_characters_style_guides.md` (or a pointer in
`docs/coldlion-erp-api-reference.md`). **It is a documentation gap, not a schema
gap** — nothing in the database needs to change today.

**7. What I am blocked on.**
Nothing technical. I am stopped **by instruction**: Albert told me this repo has
one coordinator and it is not me. The only open item is type (b), a decision for
the coordinator or Albert, and it is low-urgency: *should anyone write the MG07-
becomes-populated reconciliation note described in §6, or is it correctly left
alone until ColdLion actually puts data there?* My own recommendation is that it
is worth one short paragraph now, because the "nobody has looked at it" claim
that started this will otherwise resurface in a future session.

**8. What I tried that did NOT work, and why. [MANDATORY]**
- **The relayed claim itself was the main dead end, and it is the one worth
  recording.** Another session asserted MG07/Style Guide was unexamined and
  "directly relevant to the character work". Both halves are misleading. It *is*
  examined — the migration README explicitly decided to skip it — and it is
  **not** the source for the character work, which comes from
  `dflow.properties_and_characters`. **A future session that hears "nobody has
  looked at MG07" should read `docs/designflow-master-data-migration/README.md`
  §3.5 before treating it as new work.** Following that claim into an actual
  ColdLion MG07 ingestion effort would be hours spent importing an empty slot.
- **Assuming `mgTypeCode` has a fixed meaning — nearly repeated the repo's
  best-documented trap.** My first instinct on reading "type 07" was to treat 07
  as globally meaning Style Guide. It does not: Art Type in EH001, Character in
  EP001. The repo warns about this in at least four places and I still had to
  catch it against the division matrix rather than from memory.
- **Grepping `.md` for `'07'` / `type 07` was near-useless** — it returned a
  35KB wall of unrelated hits that had to be dumped to a file. What actually
  worked was grepping the phrase **`Style Guide`** and the token `mgTypeCode`
  and then reading the division matrix table directly. Do that instead.
- **I did NOT verify any of this against the live ColdLion API.** Everything in
  §2 is what the *documents* say, and those numbers were captured **2026-07-23**.
  I did not re-pull `/merchGroupDetails?mgTypeCode=07` to confirm MG07 is still
  empty today. Treat "MG07 is empty" as **documented, not verified**.
- **The shared checkout was NOT safe to work in, which I discovered only by
  checking.** See §9 — this cost a detour and is the reason I built a worktree.

**9. Facts I believe that may already be stale.**
- **My `git pull` is already superseded — do not trust it.** I pulled `main` to
  `75066fe`. When I returned to the same directory minutes later it was on
  **another session's branch** (`intake/coldlion-comparison-handover-20260731`,
  `0441286`) and `origin/main` had advanced to at least `134ebf4`, having taken
  on PRs **#359, #360, #362, #363** — none of which existed at my pull. The
  shared checkout is therefore **still not in a known-good state for anyone
  else**, and the REQUEST QUEUE entry about it should stay open.
- **All MG07 facts in §2 are second-hand from documents**, principally counts
  dated **2026-07-23** in `docs/coldlion-erp-api-reference.md` and the migration
  README. ColdLion is a live third-party ERP; it could have been populated since.
- **`origin/main` at `134ebf4` was my reading at roughly 22:0x local on
  2026-07-31.** Given ~29 worktrees and multiple live branches in this repo, it
  is likely stale by the time this is read. Re-check with `git fetch` rather
  than inheriting my SHA.
- **PR #365's state (OPEN) is as I observed it via `gh pr list`** at the same
  moment; that session may have progressed it since.
- I have **not** verified whether the other session's claim about MG07 came from
  a live API call or from the same documents I read. If it came from a live call
  showing **non-empty** MG07, that would contradict §2 and would be the more
  recent fact — worth asking that session before acting on my version.

---

### INTAKE — EXAMPLE TEMPLATE BLOCK (not real work — do not action, do not delete) — YYYY-MM-DD — <session identifier>

**1. What I was doing and why.**
_(empty template)_

**2. What I have actually DONE.**
_(empty template — commits, branches, PR numbers + states)_

**3. What I applied to PREVIEW (`rjyboqwcdzcocqgmsyel`).**
_(empty template — migrations AND data rows; data writes count)_

**4. What is half-finished or abandoned mid-way.**
_(empty template)_

**5. What I own right now.**
_(empty template — branches / worktrees / files, and whether dirty)_

**6. What I was ABOUT to do next.**
_(empty template)_

**7. What I am blocked on.**
_(empty template — another workstream, or an Albert decision, or access)_

**8. What I tried that did NOT work, and why. [MANDATORY]**
_(empty template)_

**9. Facts I believe that may already be stale.**
_(empty template)_

---

## TAKEN OVER

Blocks the coordinator has ingested and dispatched, annotated with the date and
what was done with them. **Never deleted** — pruned to
`docs/intake-archive/` under the retention rule in Part B2.2 once past the
10-block / 30-day threshold. The "what did NOT work" section of each block is
the reason the archive exists.

> **How the three 2026-08-02 entries below work.** The verbatim handover blocks
> for intake PRs **#365, #366 and #373** live on those PRs' branches, **not** in
> `main` — they were never merged, so they cannot be physically "moved" into this
> section without merging them. Each entry below therefore records the ingestion
> (verification, disposition, what happened to the work) and **points at the PR,
> which holds the block verbatim and preserves its section 8**. Nothing was
> deleted or rewritten. If the coordinator later merges any of these PRs, the
> block will land in the `## INTAKE QUEUE` above already ingested — move it down
> here then and delete nothing.

### TAKEN OVER — 2026-08-02 — intake PR #365 — ColdLion vs Supabase comparison + vendor `raw_record` cleanup + scoreboard doc refresh

**Ingested by:** sub-agent `intake-ingest`, dispatched by the coordinator,
2026-08-02. **Verbatim block:** PR
[#365](https://github.com/u2giants/shared-db/pull/365), branch
`intake/coldlion-comparison-handover-20260731` (head `0441286`), still OPEN —
**do not merge it unverified; see disposition.**

**What the block reported.** An uncoordinated session (t16, shared checkout) that
(a) ran read-only ColdLion-vs-Supabase comparisons, (b) authored and
**self-merged** docs PR #337 refreshing `docs/master-data-cutover-scoreboard.md`,
and (c) dispatched a sub-agent that executed a **442-row `DELETE` against
`ingest.raw_record` on what it believed was production** — a delete it never
independently re-verified, and whose target project it admitted it could not
confirm because `get_project_url` was never called.

**Verified against ground truth (2026-08-02):**

- ✅ **PR #337 is MERGED** — squash-merged `5a54abb` at 2026-07-31T13:49:11Z,
  exactly as claimed. The block's honesty about self-merging it is accurate.
- ✅ **The 442-row production delete is REAL and has already been ruled on.**
  `AGENTS.md` §6.3 records Albert Hazan's 2026-07-31 owner ruling naming exactly
  442 deleted rows on `qsllyeztdwjgirsysgai` and stating it was **intended and
  correct**. That section is explicit: *"This is not an incident. Do not propose
  a restore, a PITR, or a corrective migration for it."*
- ✅ **Claim (5) — "the shared checkout is parked on this intake branch" — is now
  STALE.** `C:/repos/shared-db` is on `main` at `4444d72` (= `origin/main` tip).
  The REQUEST QUEUE entry *"⚠️ FIRST ACTION: un-park the shared checkout"* is
  therefore **already satisfied** and can be retired by the coordinator.
- ❌ **Claim about PR #331 ("open, CI-green, unmerged") is WRONG** — #331 was
  **MERGED** at 2026-07-31T13:59:05Z, ~9 minutes after #337. The block itself
  flagged this as second-hand and unverified; it was right to.
- ⚠️ **UNVERIFIED — the row counts.** `core.customer` 862 / `core.factory` 93 /
  `ingest.raw_record` 539→97, and the scoreboard numbers merged by #337, were
  **not** checked. This agent deliberately made **no database call of any kind**
  (see the note at the end of this section). Treat every count in the block, and
  in `docs/master-data-cutover-scoreboard.md`, as claimed-not-proven.

**Disposition of the work in this block.**

- (a) read-only comparison — **superseded.** Its findings are older and thinner
  than `docs/coldlion-production-migration-manifest-20260731.md` and the Step 8
  material already in the queue.
- (b) docs PR #337 — **already done** (merged), but its numbers are unverified;
  folded into the request below rather than re-done.
- (c) the 442-row delete — **closed by owner ruling**, `AGENTS.md` §6.3. No
  remediation, no restore, no corrective migration. Do not reopen it.
- The two follow-ons the session was "about to do" — **dropped as described.**
  Merging #331 is moot (merged). The dflow→Supabase item-sync `"not-a-date"` /
  HTTP 403 failure is a **different repo's** problem and was never verified here;
  it is carried into the REQUEST QUEUE as an unverified report, not as a task.

**Still needed → REQUEST QUEUE:** one entry, *"Re-verify the master-data
scoreboard counts merged unverified by PR #337"*.

---

> **Verbatim intake block for PR #365, moved into `TAKEN OVER` on 2026-08-02
> when that PR was brought up to date with `main`.** It is reproduced below
> exactly as its author wrote it, unedited — per Part B2.1 and the note at the
> top of this section (*"move it down here then and delete nothing"*). The
> ingestion, verification and disposition of this block are the entry
> immediately above; where the two disagree, the entry above is the
> coordinator's ruling and this block is the original, unverified claim.

### INTAKE — ColdLion vs Supabase comparison + vendor raw_record cleanup + scoreboard doc refresh — 2026-07-31 — session: unnamed Claude Code session, machine t16 (`C:\repos\shared-db`)

**1. What I was doing and why.**
The business owner (Albert) asked me to compare, for every table that is (or is
planned to be) fed by the ColdLion ERP API, what Supabase currently holds versus
what ColdLion's live API shows, and report the differences. I was **not started
as, and did not know I should be, the shared-db coordinator** — I discovered
this protocol only when Albert told me to stop, at which point I stopped
immediately. I had no idea a coordinator session might already be active; I now
know from `git log` that a large, clearly-coordinated body of work (dozens of
ColdLion/licensor-alias/PopSG migrations, all dated 2026-07-31) landed in
`origin/main` during or shortly before my session, which is strong evidence a
real coordinator **was** running concurrently with my uncoordinated work.

Over the course of the conversation this became three sub-actions, described
in order below.

**2. What I have actually DONE.**
- **(a) Read-only research**, via two `general-purpose` sub-agents (NOT
  background task chips — they were run in the foreground/synchronously via the
  `Agent` tool and I read their full output before proceeding). They ran
  `mcp__supabase__execute_sql` SELECT-only queries against project ref
  `qsllyeztdwjgirsysgai`, and live GET calls to the ColdLion API
  (`http://x5.coldlion.com/EhpApi/customers` and `/vendors`) via the 1Password
  `op_run` tool. No writes were made by these two agents. Findings (row
  counts, staleness, etc.) were reported to Albert in chat; nothing was
  committed from this step.
- **(b) Docs change, MERGED to `main` directly** (not left open — this is a
  deviation from what this file asks of me now, done before I knew the
  protocol existed). Branch `docs/refresh-master-data-scoreboard-20260731`,
  one commit, PR **#337** ("docs: refresh master-data cutover scoreboard with
  live counts"), **merged (squash) and branch deleted** by me. This updated
  `docs/master-data-cutover-scoreboard.md`: corrected stale canonical row
  counts (`core.customer` 929→862, `core.factory` 529→93), added sync-freshness
  dates, and added a status note about PR #331 (Step 7A, licensor/property
  cutover — unmerged as of my read). **This PR did not touch the database**,
  only a markdown file, and it had no CI checks configured on that branch (I
  confirmed with `gh pr checks 337 --watch`, which reported "no checks
  reported"). Local `main` is now at `origin/main` tip as of my last `git pull`
  (see fact 9 below for how stale that already may be).
- **(c) A live PRODUCTION database write** — see §3, this is the one that
  matters most for the coordinator to assess.

**3. What I applied to PREVIEW (`rjyboqwcdzcocqgmsyel`).**
**Nothing was applied to preview.** But — **I touched PRODUCTION, and I am
saying so first and loudly, per this template's instruction:**

I dispatched a third sub-agent (background, via the `Agent` tool — again NOT a
background task chip, but I acknowledge in hindsight that dispatching
uncoordinated production writes via a sub-agent while unaware of the
single-coordinator rule is exactly the failure mode this file exists to
prevent) to clean up `ingest.raw_record` in what I understood to be
**production** `qsllyeztdwjgirsysgai`. It executed, and reported completing:

```sql
DELETE FROM ingest.raw_record r
WHERE r.source_system = 'coldlion' AND r.source_table = 'vendors'
  AND NOT EXISTS (
    SELECT 1 FROM plm.erp_vendor v WHERE v.vendor_code = r.source_id
  );
```

Reported result: **442 rows deleted** from `ingest.raw_record` (bronze/raw
landing table only — the sub-agent reported it did NOT touch `plm.erp_vendor`
or `core.factory`, and reported unchanged counts of 97 and 93 respectively
before/after). These were rows the sub-agent characterized as orphaned
leftovers from a pre-2026-07-22 ColdLion `/vendors` feed bug (the endpoint used
to serve the wrong table). I have **not independently re-verified this delete
against the live database myself** — I am relying entirely on the sub-agent's
self-report, which this file explicitly warns not to trust without
verification (see Part B, "Do not trust the block"). **The coordinator should
independently confirm**: (i) which project (`qsllyeztdwjgirsysgai` production,
or something else) that agent's Supabase MCP calls actually reached — I never
had that agent call `get_project_url` first, which standing fact 6 says is
required before trusting where an MCP call landed; (ii) that the delete really
was scoped to only the 442 orphaned rows and not anything a concurrent
coordinator-dispatched agent may have written to the same table around the
same time; (iii) that no other session's in-flight work on `ingest.raw_record`
was clobbered.

**4. What is half-finished or abandoned mid-way.**
Nothing is mid-write. All three sub-actions above reported completion (the
docs PR merged; the delete reported done and verified by its own sub-agent).
I have no pending branch, no open PR of mine other than the one this handover
itself will create, and no in-progress migration. The risk here is not
"unfinished" — it is "finished without coordination," which is worse.

**5. What I own right now.**
- Local checkout `C:\repos\shared-db`, on branch `main`, clean, at commit
  `134ebf4ef96b5efacbcffcda97f3a3f22deb2f83` as of my last `git pull` (today,
  before I found this file). I did that pull specifically because my local
  `main` was ~32 commits behind `origin/main` and I wanted current docs — that
  pull itself is exactly agenda item 2 / the "Update the stale shared checkout"
  REQUEST already sitting in the queue above, so it may now be satisfied for
  this machine specifically (still unverified for other machines).
  I am about to create one more local branch to file this handover; nothing
  else is checked out and no worktree is held.
- No worktrees. No other dirty files.

**6. What I was ABOUT to do next.**
Before Albert told me to stop, I had offered him two follow-on options and was
waiting on his answer, not yet started: (a) fix the `"not-a-date"` bug in the
dflow→Supabase item-sync job that has been failing with HTTP 403 since
2026-07-26; (b) merge PR #331 (Step 7A, licensor/property recurring production
feed). **I did not start either.** Given what I now know is in the REQUEST
QUEUE above (the far more current and detailed B14/Step-8 items about this
exact ColdLion feed), (b) in particular should almost certainly NOT be picked
up as I described it — the queue shows the real state is much more involved
(18-case rehearsal unmet, true migration manifest not 4 but ~18 versions,
etc.) than what I understood mid-conversation.

**7. What I am blocked on.**
Blocked on (b) — a decision only the coordinator can make: whether to
independently re-verify and accept the 442-row production delete described in
§3, whether it needs any remediation, and whether my merged PR #337's numbers
are still accurate given how much ColdLion/taxonomy work has evidently landed
today. Not blocked on Albert directly — Albert's instruction to me was simply
to stop and hand over, which I am doing.

**8. What I tried that did NOT work, and why. [MANDATORY]**
Nothing technical failed — every SQL query, API call, and git operation I ran
completed successfully. **The failure was procedural, not technical, and it is
the important one:** I was never told, and did not independently discover
until Albert flagged it, that `u2giants/shared-db` runs under a single-
coordinator protocol with a request queue for exactly this kind of "small"
work. I treated a live production DELETE and a merged docs PR as ordinary,
low-risk actions because in isolation they looked reversible and low-blast-
radius — a judgment this file explicitly warns against ("every incident here
started as a small change someone judged too minor to coordinate"). The
concrete lesson for whoever reads this next: **do not assume a shared-db
session without an explicit coordinator briefing is safe to let touch the
database directly, even for what looks like harmless cleanup** — check for
`COORDINATOR_INTAKE.md` and an active coordinator BEFORE the first database
write, not after.

**9. Facts I believe that may already be stale.**
- All row counts I reported to Albert (customers 836/862, vendors 97/93,
  licensors 44/preview, properties 516/preview, `ingest.raw_record` vendor rows
  539→97 post-delete) were read **today, 2026-07-31**, but clearly *not* at a
  quiet moment — the migration list I saw after `git pull` shows a huge amount
  of ColdLion/licensor-alias/PopSG schema work landing today, so any of these
  counts could already be wrong by the time this is read.
- I do not actually know for certain that my Supabase MCP calls (mine or my
  sub-agents') were pointed at `qsllyeztdwjgirsysgai` production rather than
  preview `rjyboqwcdzcocqgmsyel` — I inferred production from the project ref
  quoted in `docs/coldlion-erp-api-reference.md`, but per standing fact 6 the
  only reliable way to know is `get_project_url`, which none of my agents
  called. **Treat the project target of my §3 delete as unconfirmed, not
  confirmed-production**, until independently checked.
- PR #331's state ("open, CI-green, unmerged") was reported to me by a
  sub-agent earlier in the session and I never re-verified it myself with
  `gh pr view 331`.
- My local `main` pull captured `origin/main` as of commit `134ebf4e`; multiple
  sessions may have pushed since.

---

### TAKEN OVER — 2026-08-02 — intake PR #366 — ColdLion MG07 "Style Guide" doc lookup (read-only)

**Ingested by:** sub-agent `intake-ingest`, 2026-08-02. **Verbatim block:** PR
[#366](https://github.com/u2giants/shared-db/pull/366), branch
`intake/coldlion-mg07-styleguide-readonly-20260731` (head `c011c48`), still OPEN.

**What the block reported.** A read-only session asked to check whether the
relayed claim *"ColdLion has a Style Guide merch-group level, type 07, and nobody
has looked at it"* was true. It concluded the claim is **misleading on both
halves**: MG07 is already documented and deliberately skipped, and it is not the
source for the character work. It made **zero database calls**.

**Verified against ground truth (2026-08-02):**

- ✅ **The central finding is CORRECT and reproducible.**
  `docs/designflow-master-data-migration/README.md` states it in at least eight
  places: MG07 is 81 rows / **2 active**, those 2 are **Art Type in division 09**,
  and **Style Guide in divisions 01/08 has no data — "Skip — future"** (lines
  116, 127, 138, 231, 356–360, 633, 694, 713). So MG07 was examined and skipped
  on purpose, not overlooked. The division-dependence of `mgTypeCode` matches
  `AGENTS.md` §6.1 rule 1.
- ✅ **Its self-description of ownership is accurate.** Worktree
  `C:/Users/ahazan2/AppData/Local/Temp/claude/intake-mg07` still exists, checked
  out on its own branch at `c011c48`, and it correctly disclaimed ownership of
  `C:/repos/shared-db`.
- ⚠️ **UNVERIFIED — "MG07 is still empty in ColdLion today."** The block says so
  itself: the counts are documented (dated 2026-07-23), **not** re-pulled from
  the live ColdLion API. No live API call was made by this ingestion either.
  Treat "MG07 is empty" as **documented, not verified**.

**Disposition.** The research answer is **valuable and is preserved here so the
claim does not resurface**: *before treating MG07 as new work, read
`docs/designflow-master-data-migration/README.md` §3.5.* The one genuine gap the
block identified — no document covers what happens if ColdLion **starts**
populating MG07 in divisions 01/08, and how those rows would reconcile against
the style guides already in `core.style_guide` — is **still needed** and is a
docs-only, no-schema task.

⚠️ **Collision note for whoever takes that up:** agent `characters-phase1` is
live right now and owns `docs/characters-*`. `fix_characters_style_guides.md` is
adjacent to its work — coordinate before writing there.

**Still needed → REQUEST QUEUE:** one entry, *"Document the MG07-becomes-
populated reconciliation case (docs only)"*.

---

### TAKEN OVER — 2026-08-02 — intake PR #373 — ColdLion Licensor/Property preview monitor

**Ingested by:** sub-agent `intake-ingest`, 2026-08-02. **Verbatim block:** PR
[#373](https://github.com/u2giants/shared-db/pull/373), branch
`intake/coldlion-monitor-20260801` (head `7f072e5`), still OPEN. Filed
2026-08-01 00:55 UTC — **later than the 2026-07-31 coordinator handover, which
therefore does not mention it.**

**What the block reported.** The recurring preview-only ColdLion monitoring
automation stopping on discovery of the coordinator rule. It reports its last
completed pass (PR #354), a preview health run, and an **open alert-delivery
gap**: scheduled run `30639230244` failed when Supabase returned a 502 during
`supabase link`, and the alert that should have fired could not, **because
alerting itself depends on the link that failed**.

**Verified against ground truth (2026-08-02):**

- ✅ **PR #354 is MERGED** exactly as claimed — merge commit
  `768594e762c09ff2beb19902289608c4842572ff`, 2026-07-31T18:58:28Z, touching only
  `docs/verification/coldlion-licensor-property-phase6-20260726/README.md`.
- ✅ **Run `30639230244` exists and FAILED** — workflow *ColdLion
  Licensor/Property Phase 6 Parallel Run (preview)*, created 2026-07-31T14:35:16Z,
  conclusion `failure`. The pre-link alert gap it describes is anchored in a real
  run.
- ✅ **The Phase 6 preview lane has since recovered** — the 8 most recent runs of
  that workflow (through 2026-08-02T11:32Z) all concluded `success`. The block's
  "later green runs proved service recovery but did not close the alert gap"
  holds: the gap is a **design** gap, not an outage.
- ❌ **Claim (5) is WRONG NOW: the worktree it says it owns does not exist.**
  `C:\repos\shared-db-intake-coldlion-monitor-20260801` is absent from both
  `git worktree list` and the filesystem. Its **branch survives on the remote**
  (`7f072e5`) and the PR is intact, so nothing is lost — but do not go looking
  for that worktree, and do not treat it as a live agent's workspace during a
  sweep.
- ❌ **Claim (5) is also stale on "`C:\repos\shared-db` local `main` is 13 commits
  behind"** — that checkout is now on `main` at `4444d72` = `origin/main` tip.
- ⚠️ **UNVERIFIED — everything about preview database state:** health run
  `75c15b95-2fa2-4b83-b160-f7cae7130c66`, `ready:true`, the 542/542 typed
  mapping, unchanged protected hashes, breaker enforcement 11/11, closed breaker,
  "no open critical database alert". **No database call was made by this
  ingestion.** Note the last item is in direct tension with the live red hourly
  alert (below) — the coordinator must cross-check it, not inherit it.

**Disposition — NOT DISPATCHED, deliberately.**

- The monitoring-restart the block asks for, and its alert-gap finding, both
  concern the **red hourly preview ColdLion alert monitor that agent
  `alert-diagnosis` is diagnosing RIGHT NOW.** Dispatching it would put two
  agents on the same alarm — exactly the collision pattern this repo has already
  been damaged by. It is recorded here and handed to the coordinator instead.
- 🔬 **Cross-check these two against `alert-diagnosis`'s findings before
  believing either:** (i) this block's "no open critical database alert" as of
  2026-07-31T18:56Z versus the monitor that has been red every hour since 20:02
  UTC that same day; (ii) whether the pre-link alert-delivery gap is a *cause* of
  the current red state or an unrelated second defect. **This ingestion did not
  diagnose it and deliberately did not look.**

**Still needed → REQUEST QUEUE:** one entry, *"Close the pre-link alert-delivery
gap"* — held until `alert-diagnosis` reports, since the two may be the same
defect.

**RESOLUTION — 2026-08-02 — the cross-check is done and the HOLD IS LIFTED.**
Authoritative documents; read them rather than the summary here:
[`docs/coldlion-preview-alert-diagnosis-20260802.md`](docs/coldlion-preview-alert-diagnosis-20260802.md)
(read-only diagnosis, merged as PR #396) and PR **#406** (merged
2026-08-02T13:32:08Z as `e890ecd`), which added the missing acknowledgement path.

- ✅ **The tension flagged above is resolved — the five alerts were RESIDUE, proven
  not assumed.** `related_run_id` **and** `observation_id` are NULL on all five (no
  `ingest.sync_run` was ever opened), and `payload.detail` reads literally
  `"supabase db query failed"`. They are the client-side ENOBUFS tooling fault in
  `runSql`, whose root cause was fixed by **PR #367** (merged 2026-07-31T22:59:04Z).
  Not a database invariant failure, not production-relevant.
- ✅ **This block's `ready:true` / "no open critical database alert" is true ONLY of
  its own timestamp** (health run at 2026-07-31T18:56:08Z) **and was FALSE from
  19:39Z onward** — the five criticals fired **43 minutes later**. Never quote it as
  a current readiness statement; live readiness evaluated FALSE while they were open.
- ❌ **DISPROVEN — "a Supabase/Cloudflare 502 caused the `supabase link` failure."**
  The failure of run `30639230244` is real and verified; the *attributed cause* is
  not. No `502`, `Bad Gateway` or Cloudflare string survives in the retained log —
  only `Try rerunning the command with --debug`. **Stop repeating the 502 as fact.**
- ❌ **DISPROVEN (restated) — the worktree
  `C:\repos\shared-db-intake-coldlion-monitor-20260801` does not exist.**
  Re-confirmed 2026-08-02 against `git worktree list` and the filesystem. The branch
  and PR are intact; nothing is lost.
- ✅ **The pre-link alert-delivery gap this block reported is REAL and still open** —
  independently confirmed by the diagnosis (§6 claim 8, §7 item 7). When
  `supabase link` fails, no alert row can be written at all.
- ⚠️ **What this block did NOT identify** — the actual reason the monitor stayed red:
  `plm.taxonomy_sync_alert.acknowledged_at` existed since `20260726180000` but
  **nothing anywhere ever set it**. The alert channel was write-only, so the same five
  rows were re-found every ten minutes forever.
- ✅ **That underlying defect is now FIXED.** PR #406 added
  `plm.acknowledge_taxonomy_sync_alert`, and the five alerts were acknowledged on
  **preview only** at **2026-08-02 13:15:16 UTC** via that RPC — **6 h 24 m before**
  they would have silently aged out of the dispatcher's 48-hour window at ~19:39 UTC.
  **The monitor going green is that fix, not the expiry the diagnosis warned about.**
  (Timing note for whoever reads the checks: at the moment this entry was written,
  13:33 UTC, no monitor run had yet executed *after* the acknowledgement — the newest
  run, `30748489435` at 12:45 UTC, predates it.)
- **Hold lifted.** The REQUEST QUEUE entry *"Close the pre-link alert-delivery gap"*
  was held pending `alert-diagnosis`; that agent has now reported and the two are
  **not** the same defect. Release it for normal scheduling. Also still open and
  **not** addressed by #406: the duplicate-issue storm (25 open issues), the
  dispatcher-48h-lookback vs readiness-no-lookback mismatch, and the silent-expiry
  hole — diagnosis §4, §5 and §7 items 4–6.
- **Disposition of #373 itself is unchanged:** still **not dispatched** as monitoring
  work. The *"Restart ColdLion Phase 6 preview monitoring"* request stays in the
  REQUEST QUEUE, now unblocked by the alert entry above it.

**Verification boundary for this resolution.** Written by sub-agent `close-373`,
2026-08-02, against `origin/main` = `e890ecd`. It made **no database call of any kind**
— every ✅/❌ above was checked against the merged documents, live GitHub (`gh pr view`
#354/#367/#373/#395/#396/#406, `gh run list`), `git worktree list` and the filesystem.
The preview database facts (the five rows' NULL columns, the acknowledgement at
13:15:16 UTC) are quoted from PR #396 and PR #406, which did the live read-only work.

---

> **Verbatim intake block for PR #373, moved into `TAKEN OVER` on 2026-08-02
> when that PR was brought up to date with `main`.** It is reproduced below
> exactly as its author wrote it, unedited — per Part B2.1 and the note at the
> top of this section (*"move it down here then and delete nothing"*). The
> ingestion, verification, resolution and disposition of this block are the
> entry immediately above; where the two disagree, the entry above is the
> coordinator's ruling and this block is the original, unverified claim.

### INTAKE — ColdLion Licensor/Property preview monitor — 2026-08-01 — automation monitor-coldlion-phase-6-preview

**1. What I was doing and why.**
I was monitoring the preview-only ColdLion Licensor/Property parallel feed. The goal was to
preserve every scheduled and manual result, check each complete source cycle against section
9.4 and the accelerated deterministic gates, and report new blockers without touching
production or starting Phase 7.

**2. What I have actually DONE.**
The last completed monitoring pass merged PR **#354** into `main` as merge commit
`768594e762c09ff2beb19902289608c4842572ff`. It updated only
`docs/verification/coldlion-licensor-property-phase6-20260726/README.md` and preserved all 24
scheduled runs from 2026-07-30 through 2026-07-31, including one failed run. Both offline CI
checks and the consumer-repo sync passed for that merge. No monitoring work for the current
2026-08-01 heartbeat was started after the new coordinator rule was discovered.

**3. What I applied to PREVIEW (`rjyboqwcdzcocqgmsyel`).**
No migration, schema change, deletion, or canonical-data update was applied. During the prior
monitoring pass, I ran the approved readiness evaluator on preview. Its health function appended
one normal evidence row, health run `75c15b95-2fa2-4b83-b160-f7cae7130c66`, at
2026-07-31T18:56:08Z. It returned `ready:true`, exact typed mapping 542/542, zero identity
differences, unchanged protected hashes, breaker enforcement 11/11, a closed breaker, and no
open critical database alert. Production `qsllyeztdwjgirsysgai` was not accessed.

**4. What is half-finished or abandoned mid-way.**
The recurring heartbeat remains active, but this session must no longer execute it outside the
coordinator. New GitHub Actions runs and preview observations after 2026-07-31T18:56:08Z have
not been inspected or recorded here. The pre-link alert-delivery gap is still open: scheduled
run `30639230244` failed when Supabase returned a 502 during `supabase link`, and the immediate
alert also failed because no project link existed. Later green runs proved service recovery but
did not close that alert gap.

**5. What I own right now.**
Branch `intake/coldlion-monitor-20260801` in worktree
`C:\repos\shared-db-intake-coldlion-monitor-20260801`, containing only this intake addition.
The original `C:\repos\shared-db` checkout is clean on local `main`, but local `main` is 13
commits behind `origin/main`; it was fetched, not merged, because the new Part A rule forbids
this non-coordinator session from continuing repo work.

**6. What I was ABOUT to do next.**
The coordinator should first ingest this block, then dispatch a preview-only monitoring agent in
an isolated worktree. That agent should read the current priority and ColdLion plans from the
current `origin/main`, inspect only the named Phase 6 workflow and preview project, collect every
new run after the evidence cutoff, append evidence only when new facts exist, and leave
production and Phase 7 untouched. Verification succeeds when every new run and observation is
accounted for and the alert gap is either fixed and proven on preview or remains plainly listed
as blocking.

**7. What I am blocked on.**
Blocked on another workstream and process owner: only the active shared-db coordinator may
dispatch or continue this monitoring. Step 8 also remains blocked on Albert's separate durable
production approval. This intake is not that approval.

**8. What I tried that did NOT work, and why. [MANDATORY — do not skip]**
In the prior pass, a direct Node one-liner intended to read preview health IDs failed before
opening a database connection because PowerShell stripped quotes around `require("pg")`. I did
not retry that approach. The approved readiness tool worked instead. Scheduled run
`30639230244` also failed before preview linking because the Supabase management service returned
a Cloudflare 502. Its database-backed alert fallback could not run without the link, which is
the unresolved design gap. No failure was erased or reclassified.

**9. Facts I believe that may already be stale.**
Everything after 2026-07-31T18:56:08Z may be stale, including workflow runs, preview rows,
breaker state, open alerts, current readiness, plan status, and whether another coordinator has
already assigned the alert-gap fix. PR #354 and merge commit `768594e...` were verified when
merged, but the coordinator must recheck live GitHub and preview state before acting.

---

> **Verification boundary for all three entries above (stated plainly so nobody
> inherits a false confidence).** The ingesting agent made **NO database call of
> any kind** — no Supabase MCP call, no `get_project_url`, no `psql`, no CLI, no
> ColdLion API call, no 1Password read. Every claim above marked ✅ was verified
> against the **live repo, live GitHub, and the filesystem only** (`git fetch`,
> `gh pr view`, `gh run view/list`, `git worktree list`, file contents). Every
> claim about **database or ColdLion-API state is marked ⚠️ UNVERIFIED and must
> be re-checked live before anyone acts on it.** Repo ground truth at the moment
> of ingestion, 2026-08-02: `origin/main` = `4444d72`, **386** migration files,
> max version **20260731230000**, **0** duplicate 14-digit versions.

---

## Notes / backlog held in this file

> These items belong in the `## BACKLOG` section of `HANDOFF.md`. That section is
> being added by **PR #347**, which was still OPEN when this file was written.
> **Once #347 has merged, move the item below into `HANDOFF.md`'s BACKLOG
> section and delete it from here.**

> **Superseded 2026-07-31.** PR #347 has merged, so `HANDOFF.md` now has its
> `## BACKLOG` section. This item is also now a live entry in the REQUEST QUEUE
> above ("Sweep the 22 worktrees and ~42 stale local branch labels") at the
> current, higher count. The note below is kept only as the original record —
> **use the REQUEST QUEUE entry and `HANDOFF.md`, not these numbers.**

### Backlog — sweep ~30 stale local branch labels

About thirty **local** branch labels are fully merged into `origin/main` and are
no longer checked out in any worktree. They are mostly `worktree-agent-*` and
`claude/*` bookkeeping names, plus `docs/clickup-handoff`,
`fix/clickup-importer-correctness`, `verify-clickup-watermark`,
`docs/psg5-fresh-session-blocked-20260729`, the `codex/coldlion-*` branches,
`fix/production-safe-execute-lockdown`, and
`fix/revoke-anon-style-tracker-execute`.

They were deliberately **not** deleted at the time because live agents were
actively creating branches and a sweep would have raced them.

When it is done:

- Verify **each** branch is fully merged into `origin/main` and is checked out
  in **no** worktree before deleting it.
- Delete **local labels only** (`git branch -d`). **Never** delete a remote
  branch.
- Do it only when the repo is quiet — no live agents, no open worktrees in use.
