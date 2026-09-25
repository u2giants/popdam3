# AGENTS.md — §0.0-C admission test, §11b to §11d (orchestrator role, routing contract, admission)

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## 0.0-C The orchestrator admission test — what it may keep in its own context

§0.0-B says what this repo governs. **This section says what the orchestrator session is allowed
to spend its own context window on**, which is a narrower thing and was never written down. Two
leaks made orchestrator sessions long and slow: other sessions filed anything with "db" in it and
labelled it `db-work`, and orchestrators read those items and did the work themselves instead of
handing it out.

### The test

Before opening, accepting, or acting on any item, answer one question:

> **Does this change the SHAPE of the database** — a schema, table, column, type, view, function
> or RPC, trigger, row-security policy, grant, index, constraint, extension, publication, storage
> policy, or a migration that ships one of those?

**Yes → accept.** It is queue work: `work_type: structural`, `route: shared-db-orchestrator`, exact
objects listed, dispatched to a sub-agent in an isolated worktree as usual.

**Structural work has a second ROUTE, never a second work type (issue #3199 Phase B):**
`route: self-service-additive` admits the same structural work WITHOUT orchestrator triage when it
is additive and every named object lives in the app-owned `{crm, pim, dam, plm}` schemas. The boundary
is enforced AT MERGE TIME by `scripts/check-self-service-additive-lane.mjs` inside the guarded
merge, pre-lock — a declared route whose pull request fails the classifier never merges. The
author session claims the lane (`--claim --admit-issue`), draws both reviewers itself
(`--assign-reviewer`), and dispatches the guarded merge itself; every existing gate (collision
locks, version reservation, exact-head review, serial preview/merge/promotion) is unchanged. The
orchestrator never dispatches, refills or reviews this route; `--queue-audit` prints it in its own
section. Out of the lane: `api`/`core`/`public`/`ingest`/`storage`/`dflow`/`app`, any
brand-new schema, any data statement, `CREATE OR REPLACE`, `SECURITY DEFINER`, and grants to
browser roles on `crm`/`pim` objects without RLS.

**No → `accept` is never one of the exits. Each non-structural work type names where it goes
instead.** The machine-readable form of this table is `NON_STRUCTURAL_EXITS` in
`scripts/manage-migration-author-lanes.mjs`; the two must agree.

- **REJECT** — the work belongs to another repository and must leave this queue. `application-data`
  and `source-data`. **Rejection FORWARDS the task; it never merely closes it** — see "A reject is
  a forward" below.
- **FORK** — genuinely this repo's work, dispatched by this orchestrator to a fresh session with an
  empty context window, but never worked in the orchestrator's own window. **This is now curated
  Master Data only** (`curated-master-data`), which §6.4 governs *inside* this repo and which never
  leaves for an application repo. It forks to keep the work out of the orchestrator's context, not
  because somebody else owns it. A fork that ships a file under `supabase/migrations/` **must claim
  a migration-author lane before authoring it**; the lease's version reservation and object locks
  are safety controls and override the normal throughput preference not to consume a lane. Curated
  work that ships no migration does not use a lane. The orchestrator does not read the code, debug
  it, or
  does not "just fix it quickly".
- **REPO-SESSION** — `repo-maintenance` and `documentation`. **Not an orchestrator assignment at
  all, not even to dispatch.** A separately started repository-maintenance session owns this work
  end to end. The orchestrator lists such issues in `--queue-audit` under
  `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION` purely so nothing accumulates unseen, and then
  takes no action on them.
- **RETURN-TO-OWNER** — `security-settings`. It needs authority the orchestrator does not have.
  Put it to Albert; do not dispatch it to any session.

### Every dispatch carries the waiting instruction (issue #2998 item 4, added 2026-09-20)

**Copy this into every dispatch prompt, in these words:**

> Keep polling. Do not stop while waiting. Poll every 5 minutes. Never use `gh run watch`.

**Why it is in the rulebook and not left to each dispatcher's judgement.** Dispatched agents
**ended their turns mid-wait**, treating "waiting for a check" as "finished". The work was
neither done nor handed back, and the lane looked busy while nothing was running — the worst of
both, because the next session cannot tell a live wait from an abandoned one.

The two specifics are not decoration:

- **The 5-minute floor** keeps parallel agents off the GitHub burst limit. Several sessions run
  this repo at once; a tight poll loop from each is how the whole fleet hits a secondary rate
  limit together, and §5.2-B item 4 explains why a rate-limited gate read is dangerous rather
  than merely slow.
- **The `gh run watch` ban** exists because it holds a connection open for the whole run and
  returns nothing a poll would not, while being the command most likely to be sitting there when
  a session's turn ends.

A wait with no end in sight is not waited on forever: set a threshold before starting it, and
when the threshold passes, diagnose the stall — read the log, name the hanging step — instead of
waiting on. Ending a turn to report "still waiting, nothing changed" is the failure this rule
exists to stop.

### OWNER RULING, 2026-08-21 (issue #1366) — the orchestrator does structure and schema ONLY

Albert ruled on 2026-08-21 that **repository-maintenance work is not an orchestrator job**. This
was not a clarification of an existing rule; it narrowed the boundary. Before that date,
`repo-maintenance`, `documentation`, and `security-settings` all exited by FORK, which reads as
"the orchestrator hands this out" — and an orchestrator session had already accepted a
repository-maintenance planning task on that basis. That is the mistake this ruling closes.

The ruling did **not** change how curated Master Data is routed. `curated-master-data` still exits
by FORK and is still governed here by §6.4. Do not extend the ruling to it without a separate
explicit decision from Albert.

There is no size exemption. "It is only a one-line doc fix" is precisely how an orchestrator
context fills up.

### A reject is a forward, not a closed door

A closed issue is not a delivered task. The session that filed it has almost always ended by the
time it is triaged, so a closing comment is read by nobody and the work is simply lost. Rejection
therefore moves the task to the repository that owns it:

1. **Every non-structural issue whose exit is REJECT carries a `return_to:` line** in its
   `db-work-scope` block — the owning repository as an `owner/repo` slug. A malformed slug is a
   hard parse error. A **missing** one is reported by `--queue-audit` as `NO RETURN ADDRESS` and
   makes the audit exit `2`, so an unaddressed reject cannot sit quietly.
2. **Return it with the guarded command**, never by hand:

       node scripts/manage-migration-author-lanes.mjs --return-issue <n>

   It files the full issue body in the owning repository **first**, then comments the new issue's
   URL here, then closes this one. **That order is the safety property** — any failure at any step
   leaves the issue here open and untouched, so a task can never vanish between the two repos. The
   closing comment always carries a live link, and a second return is refused.
3. **Only the return path may close a rejected issue.** Closing one by hand, without a
   `RETURNED TO <url>` comment, is the exact failure this section exists to prevent.

FORK items are never lost either — they stay open, dispatched to a fresh sub-agent like any other
work, and remain in the audit until that work is done.

### What the orchestrator's own window is for

Triage, dispatch, review, merge, and the promotion protocol. Nothing else. Every unit of actual
work — structural or forked — happens in a sub-agent's context, not this one.

### How it is enforced

`node scripts/manage-migration-author-lanes.mjs --queue-audit` prints a **`NOT ORCHESTRATOR WORK`**
block listing every open issue that fails the shape test, each stamped `REJECT` or `FORK`, with
`[blocked on owner decision]` where the route is `owner-only`. These items previously sat silently
in `skipped` and accumulated. The block is a worklist, not a failure — it does not change the exit
code — but an orchestrator that leaves items standing in it is carrying other people's work.

The block prints **before** the refill line, not after it, so a queue that has dispatchable work
cannot hide it — that ordering is deliberate.

Every live claim, reviewer assignment, preview, merge, and production acquisition must also pass
`--admit-issue <work-issue>`. Admission independently reads the issue and the proposed PR change:
only actual shared-database structure work proceeds. A sender's label never admits documentation,
application code or data, CI, reviewer/workflow work, or repository maintenance. Rejection is
recorded as a typed `rejected_non_structural` event without consuming any lane or shared stage.

### Queue priority

Among eligible structural issues, service class orders urgent application work before standard
application work and maintenance. Already-started work nearest direct live verification finishes
before new work; work that releases the largest number of direct and chained blockers follows,
then older creation time and issue number. An urgent item never preempts a started claim or bypasses
the shared-stage gates. `urgent-application` additionally requires a structured impact
block proving one of: a live outage, a blocked application release, a security exposure, or an
owner-declared business deadline. The numeric `priority:` field remains required for compatibility but does
not override this order.

An issue with **no** `db-work-scope` block at all is `unclassified`: it is not admitted, it is not
worked, and it already blocks an empty-lane claim. Classify it or send it back.


## 11b. The role is called ORCHESTRATOR (renamed 2026-08-07)

**One word for the role, and the word is orchestrator.** Owner instruction, Albert Hazan,
2026-08-07. Renamed throughout this file, `HANDOFF.md`, the plans, the tooling, the three
`shared-db-*` skills, and the marker label.

**"Coordinator" is the OLD word for exactly the same role.** It survives in three places,
all deliberately:

1. **Older GitHub issues and their titles**, including any open marker issue.
2. **`HANDOFF.d/` files.** These are write-once records of what past sessions did. This
   repo's own rule is that you never edit another session's handover — rewriting them to
   change a word would falsify the record of who said what.
3. **Git history and merged PR titles**, which cannot be rewritten.

**Both words mean the same thing, and both still load the `shared-db-orchestrator` skill.**
Do not go looking for a separate coordinator skill; there has never been one.

⚠️ **The marker label was renamed `coordinator-marker` → `orchestrator-marker`.** GitHub
carried the existing issues across. **If `gh issue list --label coordinator-marker` returns
empty, that is the rename, not an empty board** — query `orchestrator-marker`. This matters:
step 0 of the orchestrator skill treats an empty result as permission to start, so reading
the old label would let a second orchestrator start while one is already live.

⚠️ **Two filenames deliberately keep the old spelling**, because renaming them would break
links from the 63 migrated issues and from merged PR bodies:
`COORDINATOR_INTAKE.md` (now a retired pointer) and
`plan_coordinator-queue-to-github-issues.md` (a completed plan).

---

## 11c. The orchestrator ROUTING CONTRACT — how you find who to send work to

**Added 2026-08-26, issue #1605.** The marker answers "has someone claimed the role". Until this
contract it did **not** answer "where do I send work", and a session with no answer to that
resolved the destination from conversation history and an old handoff — and delegated an
authorized structural request to an orchestrator session that **had already closed**. The
request went nowhere and nobody was told.

### The standard identifier is `shared-db.orch`

Owner instruction, Albert Hazan, 2026-08-26. It is a **fixed constant**, not a naming
suggestion. The orchestrator's session display name must begin with it, so the orchestrator
is identifiable in a session list and by any tool that can only see session titles.

⚠️ **The name is a discovery HINT and never an authority.** Session titles are not unique
and nothing enforces them. **Route on the marker, never on a name.**

### Every open marker carries a routing block

````
```orchestrator-routing
status: active
identifier: shared-db.orch
engine: codex
session_name: shared-db.orch EDGE-DEV resume-1579
route_id: 00000000-0000-7000-8000-00000000a1a1
owner: u2giants
machine: EDGE-DEV
started: 2026-08-26T14:39:25Z
handover_issue: 1579
briefing: HANDOFF.d/2026-08-26T1409Z-edge-dev-codex-orchestrator-1579-fresh-session.md
authorization: owner-current-chat 2026-08-26T14:38:00Z
```
````

`authorization:` was added 2026-09-10 by issue #2318 and is covered in section 11d. It is the
only field that is not part of routing: it states **on what grounds this session holds the
role**, not where to send work.

`route_id` is the **declared address**, and its shape depends on the engine. The guard validates
that shape and nothing else — see the "what this does NOT do" note at the end of this section:

| `engine` | `route_id` | How another session reaches it |
|---|---|---|
| `codex` | the Codex thread UUID from the session rollout `session_id` | `codex-reply` with that `threadId` |
| `claude` | the Claude `sessionId`, e.g. `local_<uuid>` | a Claude cross-session message to that session |

`handover_issue` is the predecessor marker, or `none` for a cold start. Every ROUTING field is
required; **blank is never a default** — state a value or `none`. `authorization` is not a routing
field and has its own vocabulary (§11d): never write `none` there — a session with no grounds does
not open a marker at all.

### Resolve the destination this way, and only this way

```bash
node scripts/check-orchestrator-marker.mjs --resolve
```

It reads the **current open marker and nothing else**. That is what makes closing or handing
over a marker invalidate the old routing target automatically, rather than by everyone
remembering to stop using it. **Re-resolve before every delegation.**

| Exit | State | What it means and what to do |
|---|---|---|
| 0 | `declared` | One valid marker. Its `route_id` is where to TRY. It is not proof anyone is there. |
| 3 | `none` | Zero markers — **no active orchestrator**. **QUEUE the work** until a successor starts. Not permission to dispatch, and not permission to start orchestrating without claiming a marker yourself. |
| 1 | `unsafe` | Anything that fails the marker guard — two or more markers, or the retired `coordinator-marker` label alive. Do not guess which is live; do not route to either. |
| 1 | `invalid` | A marker is open but names no usable target. An orchestrator **may be live and unreachable** — stop. |
| 2 | `unknown` | GitHub could not be read. **Assume a marker exists.** |

⚠️ **`none` and `invalid` are different answers with opposite consequences, and neither may
be collapsed into the other.** `none` means nobody is running. `invalid` means somebody may
be running and you cannot reach them. Treating `invalid` as `none` is how a second
orchestrator starts; treating `none` as a green light is how work gets dispatched to nobody.

⚠️ **Never fall back to conversation history, a closed marker, a `HANDOFF.d/` file, or a
remembered id for a routing target.** Those are precisely what produced the failure this
contract exists to prevent. If `--resolve` will not give you an address, you do not have one.

### Starting as the orchestrator

Open the marker with a complete, valid routing block **recording your own new `route_id`** and
an admissible `authorization:` (section 11d). If you cannot state admissible grounds, do not
open a marker at all — run as an ordinary session and queue the structural work.
A successor that copies its predecessor's id is rejected by the guard — that copy is exactly
how delegations kept arriving at a closed session.

⚠️ **The inheritance check is a trap, not a proof.** It fires only when the marker declares a
numeric `handover_issue` whose issue is readable and carries a parseable block. It does not
catch a reused id from an older ancestor, a wrong predecessor number, a `handover_issue: none`
that is a lie, or a fabricated id with the right shape. **Recording your own real id is your
obligation; the guard catches the common copy, not every possible one.**

### Handing over

Close your marker. The successor opens its own with **its own new `route_id`**. There is no
edit-in-place handover: the old target must stop resolving the moment you stop running.

### What this does NOT do

It publishes an **address**, and validates only its **shape**. There is no session API here, so
nothing checks that the session exists, is running, belongs to the declared owner or machine,
is the orchestrator, or can receive anything — a fabricated id with otherwise valid fields
resolves exactly like a real one. What a resolved target proves is narrow: **one open marker
declares this address.** Confirm you got a reply; silence is not delivery, and this tool cannot
tell the difference.

It does not invent a delivery channel and it does not promise
delivery. `plan_orchestrator-workflow-gaps.md` §C recorded that nothing here reaches a
running session; that remains true of this repository. Claude cross-session messaging and
Codex `codex-reply` are the channels, they live outside this repo, and both needed an
address the marker never published. **A resolved target means "this is where to send it",
never "it was received".**

⚠️ **Markers opened before 2026-08-27 are grandfathered by the PR guard only** — they could
not carry a block that did not exist. `--resolve` **never** grandfathers: such a marker still
carries no address and still cannot be routed to. Edit it to add the block, or close it.

### 11d. ADMISSION — on what grounds you hold the role

**Added 2026-09-10, issue #2318.** Routing answers "where do I send work". Nothing answered the
earlier question: **was this session ever allowed to hold the role?**

On 2026-09-04 a DesignFlow application session hit a shared-db constraint defect, opened
orchestrator marker #2312, and ran a structural repair. Albert had never authorized it. The
marker guard could not have caught it: #2312 was the only open marker and its routing block was
well-formed, so every check passed. The finding recorded in the closeout is exact — **structural
work need does not confer orchestrator authority; the marker itself was evidence of an
unauthorized assumption, not evidence that authority existed.**

#### The only two admissible grounds

| Value | Meaning |
|---|---|
| `owner-current-chat <ISO-8601 instant>` | Albert authorized **this** session to hold the orchestrator, in the conversation this session is running in. Not a past chat, not another session's chat, not a standing document. |
| `owner-authorized-handover #<marker issue>` | Direct succession from the named predecessor marker. It must be the **same** issue this marker declares as `handover_issue:`. That agreement is all the guard can check: like `handover_issue` itself (§11c), it does not prove the cited marker exists or that this session really succeeds it. |

#### What is refused, by name, and why

- **a `db-work` label** — it routes work *to* an orchestrator; it never creates one.
- **being delegated to / task traffic** — a delegating session cannot grant a role it does not
  own. This is the exact inference that produced #2312.
- **a structural need, a needed migration, being blocked on schema** — that is the reason to
  QUEUE work for an orchestrator, not grounds to become one.
- **a handoff document** — it records what a predecessor did; it cannot confer a role.
- **working in this repository, no marker being open, your own judgement, blank** — none of
  these is authorization. Blank is never a default: it reads as answered and grants nothing.

An **unrecognised** value fails closed. Free text is how "the task needed it" would have passed.

#### What it does and does not do

It cannot PREVENT a session opening a marker issue — markers are claimed outside any pull
request, exactly as marker collisions are. It cannot prove Albert said the words; no repository
check can. What it does is make the grounds a **required, typed, published** field, so a silent
assumption becomes a written, refutable assertion — and so the inferences that actually happened
are impossible to write down as valid.

A marker that cannot state admissible grounds is **`invalid`**, which per the table above is not
`none`: do not route to it, and do not take the role yourself. **Path A either way** — run as a
non-orchestrator session and queue the work.

⚠️ **Markers opened before 2026-09-10 are grandfathered for a MISSING field only, with a
warning** — a live orchestrator must not be failed for a field that did not exist when it
started. A pre-existing marker that writes a refused ground still fails admission — except where the
marker also predates the 2026-08-27 routing contract and its routing block is invalid, in which
case the whole marker is already unroutable and the refusal is reported as a warning rather than
a failure. An unreadable creation
date is treated as in force, never as grandfathered.

---
