# COORDINATOR_INTAKE.md — hand your work over to the one coordinator

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

_(none yet)_

---

## IN PROGRESS

Requests the coordinator has verified and dispatched. Each block is annotated
with the branch name and the sub-agent handling it. Moved here and out again by
the coordinator only.

_(none yet)_

---

## COMPLETED

Requests that landed, each annotated with the PR number and merge date. Pruned
to `docs/intake-archive/` under the retention rule in Part B2.2 — archived,
never deleted.

_(none yet)_

---

## INTAKE QUEUE

Newest first. Copy the template from Part A and fill it in. The block below is
an empty example showing the required format — **leave it in place, do not
overwrite it.**

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

_(none yet)_

---

## Notes / backlog held in this file

> These items belong in the `## BACKLOG` section of `HANDOFF.md`. That section is
> being added by **PR #347**, which was still OPEN when this file was written.
> **Once #347 has merged, move the item below into `HANDOFF.md`'s BACKLOG
> section and delete it from here.**

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
