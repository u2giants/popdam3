# COORDINATOR_INTAKE.md — RETIRED 2026-08-07

This was the orchestrator's intake queue. **It is retired. Do not append to it.**
A hand-built issue tracker in Markdown that several AI sessions edited at once: it grew
from 0 to 89 blocks in eight days, never shrank, and its retention rule never once fired
because the directory it archived into was never created.

## Where work lives now

```bash
gh issue list --repo u2giants/shared-db --label db-work
```

Need database work done, or handing over work you started? **Open an issue** — see the
`shared-db-orchestrator` and `shared-db-handover` skills. Needs a decision only Albert
can make? Add `needs-albert`.

## ⚠️ An EMPTY issue list is NOT proof there is no work

A orchestrator once read an empty queue, concluded the project was idle, and stood down
while about 20 jobs sat waiting. Before concluding there is nothing to do, also read:

- `HANDOFF.md` — the `## BACKLOG` section, items B1 to B14
- `HANDOFF.d/` — one file per open workstream, newest first
- `gh issue list --label needs-albert` — work stopped on an owner decision

## The rules that used to live here

The standing facts an incoming session must know — including the ban on background task
chips — moved to **`AGENTS.md` §12**, byte-identically, on 2026-08-07.

## History

The full 5,539-line file is at commit `360b85b3eec79c5f498cf9e669350737db27e6ab`:
`git show 360b85b3eec79c5f498cf9e669350737db27e6ab:COORDINATOR_INTAKE.md`. Nothing was deleted; all 71 open blocks became
63 issues, and the arithmetic is in `plan_coordinator-queue-to-github-issues.md`.
