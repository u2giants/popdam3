# HANDOFF — shared-db

This file is a **pointer**, not a document. Keep it under one screen. Everything below
is either where to look or a rule about looking.

## Where the current handover actually is

**`HANDOFF.d/` — one file per open workstream.** Read the OPEN files newest-first.

**Filenames come in TWO formats. PARSE the timestamp, never text-sort:**

- `YYYY-MM-DDTHHMMZ-<machine>-<agent>-<slug>.md`
- `YYYYMMDDTHHMMSSZ-<machine>-<slug>.md`

An alphabetical sort ranks the older July file last and you will pick the wrong one.
Strip the punctuation from the date-time portion and compare the parsed instants.

The `HANDOFF.d/` contract — what a file must carry, and the rule that its own session
deletes it when done — is **`AGENTS.md` §2.1-H**. Read that before adding a file.

## Where the open work actually is

**GitHub Issues. Nothing else.**

```bash
gh issue list --repo u2giants/shared-db --label db-work
```

An empty issue list is **not** proof there is no work. Check `HANDOFF.d/` too, and read
the `B1`–`B14` backlog write-ups in the archive named below for the reasoning behind each
repository-level item. Their **state** is whatever the issue says — never what a heading
in any markdown file says.

## Where the rules are

**`AGENTS.md` is the router and the standing-rules home.** Read it first; it points at
the deeper docs per task. Do not read every `.md` file in this repo.

## Standing rule — no document wins by name or by date

Where `HANDOFF.d/`, this file, `AGENTS.md`, and the archives disagree, **re-derive the
fact from `git` and `gh`** rather than ranking the documents.

## Live rulings that used to live in the old body of this file

**The ColdLion API key rotation ask is WITHDRAWN (Albert Hazan, 2026-08-09.)** ColdLion is
a third-party system the owner does not administer. It is no longer an open owner gate, a
blocker, or a next action anywhere. Issue #642 was closed under this ruling. Do not re-file
it, re-escalate it, or carry it forward in a handoff. The exposure itself remains a recorded
security fact. Its original write-up (`HANDOFF.d/2026-08-10T0130Z-…-addendum-late-findings.md` §1)
has since been retired from `HANDOFF.d/`; recover it from git history if you need the detail.
Never write the key value anywhere.
Still actionable, and neither needs the owner: the missing `COLDLION_API_KEY` row in PopDAM's
`public.admin_config`, and removing the hardcoded literal from `u2giants/popdam3` source.
Both live in that app repo, not here.

**`COORDINATOR_INTAKE.md` is RETIRED (2026-08-07.)** Do not write into it.

## The archive

The 446 KB July-2026 body of this file — the five defects, the chip incident, the
Supabase-MCP-is-production warning, the `B1`–`B14` write-ups, and every superseded
fresh-session boundary — moved verbatim, nothing removed, to:

[`docs/archive/HANDOFF-legacy-through-2026-07-31.md`](docs/archive/HANDOFF-legacy-through-2026-07-31.md)

It is **history**. It is not the current handover, not a current inventory of anything,
and not the backlog tracker. Read it when you need to know *why* something is the way it
is; never to learn the current state.
