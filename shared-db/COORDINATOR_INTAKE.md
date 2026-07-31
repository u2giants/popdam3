# COORDINATOR_INTAKE.md — hand your work over to the one coordinator

**This repo runs ONE coordinator session at a time.** Every piece of work is
dispatched by that coordinator to sub-agents in isolated git worktrees. Nothing
happens outside it.

This file is the mailbox. Sessions that were started outside the coordinator
write what they know into the **INTAKE QUEUE** below and stop. The coordinator
reads the queue, verifies every claim against the live repo, dispatches the
work, and moves the block to **TAKEN OVER**.

Two audiences, two halves:

- **Part A — you are being asked to hand over.** Read Part A, fill in the
  template, stop.
- **Part B — you are the coordinator ingesting a block.** Read Part B.

Related skills: **`shared-db-orchestrator`** (how a coordinator session is
opened and run) and **`shared-db-handover`** (how a session that used sub-agents
or touched the shared database is closed out). If you are the coordinator, load
`shared-db-orchestrator` before dispatching anything.

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
   needs both the coordination state and a separate block per sub-agent.

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

Blocks the coordinator has ingested and dispatched. Kept for history — never
deleted.

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
