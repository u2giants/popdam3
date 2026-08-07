# Step 3 — the labels and the shape of a migrated issue

**Companion to** [`plan_coordinator-queue-to-github-issues.md`](../plan_coordinator-queue-to-github-issues.md) step 3.
**Written 2026-08-07. Nothing here has been created.** This is the contract the step-6
migration script follows, written down before anything irreversible happens, so that the
owner gate at step 4 has something concrete to approve.

> ⚠️ **Read this first: the repository is now PRIVATE.** It flipped on 2026-08-07 at
> ~15:10 UTC (request R-SEC-1). Issues created here are therefore **private to people
> with repository access**, not public. The plan was written when the repo was public and
> says so throughout; that premise no longer holds. See §5.

---

## 1. Labels

Three new labels. **None has been created** — `AGENTS.md` and the plan both forbid
creating issues or labels without the owner's say-so.

| Label | Colour | Description | Why it exists |
| --- | --- | --- | --- |
| `db-work` | `#1D76DB` | A unit of work on the shared database or this repo. Migrated from the coordinator queue. | The single **type** label (design decision D6). It marks "this came from, or belongs in, the queue" and nothing more. |
| `needs-albert` | `#D93F0B` | Blocked on an owner decision. Nobody may act on it without a fresh answer in the current chat. | The queue used a ⛔ prefix for this. It is the one distinction that changes who can act. |
| `blocked` | `#B60205` | Blocked on something other than the owner — another work item, an upstream system, or a machine nobody has access to. | Distinguishes "waiting on Albert" from "waiting on a thing", which the queue conflated. |

**Already exist. Leave them alone:** `coordinator-marker`, `db-claim`. They belong to the
dispatch protocol, not to this migration.

**Deliberately NOT created — a status-label set.** Design decision D7: a `triage` /
`in-progress` / `done` label ladder is the queue's six-section lifecycle wearing a new
costume, and it would drift exactly the same way. Status is **open or closed**. Nothing else.

### Counts this produces

From the step-1 inventory (`node tools/intake-inventory.mjs`):

| | |
| --- | --- |
| Work items → issues | **60** |
| Of those, `needs-albert` | **9** (WI-02, 14, 15, 16, 30, 37, 49, and the two owner gates the plan itself owes) |
| Of those, `blocked` | **6** (WI-13, 31, 41, 55 — machines or repos not reachable from here — plus WI-34 and WI-42, both explicitly on hold) |
| Everything else | plain `db-work` |

---

## 2. The shape of a migrated issue

### Title

The work-item title from the inventory, verbatim, minus the `WI-nn ` prefix. They were
written to be readable on a phone, which the queue headings were not.

### Body — a REQUEST

```markdown
> Migrated from `COORDINATOR_INTAKE.md` on <date>.
> Source: `## <section>`, block at line <n>, as of commit <sha>.
> This repository is private; treat the contents accordingly.

<the original block text, VERBATIM>

---
**Other blocks folded into this work item:** `## <section>` line <n>, line <n>.
```

**Verbatim matters.** A summarised block loses the reasoning, and in this queue the
reasoning is the reason some blocks are worth keeping at all — the warnings about what
must not be re-litigated, the traps, the "do NOT do X" lines. Those are the expensive part.

### Body — a HANDOVER (an `INTAKE QUEUE` block)

Design decision D3: **the issue points at the file; the narrative stays a file.**

```markdown
> Migrated from `COORDINATOR_INTAKE.md` on <date>.
> Source: `## INTAKE QUEUE`, block at line <n>, as of commit <sha>.

**What is still outstanding:**
- …

**The full briefing stays where it is:** `HANDOFF.d/<file>.md`, or
`COORDINATOR_INTAKE.md` at commit `<sha>`.
```

**Never the whole briefing.** A ten-page handover pasted into an issue is a ten-page
handover nobody reads, in a worse reader.

### Ownership

AI sessions have no GitHub account, so **assignee is only used for Albert**. A session
that picks up an item says so in a comment naming itself. This is deliberately weaker
than the queue's model, and that is fine: the `db-claim` label already carries the part
that actually needs enforcing, which is who holds which database objects.

---

## 3. What does NOT become an issue

| | Why |
| --- | --- |
| The 16 blocks the inventory marked **CLOSED** | Landed or answered, each with a checkable reason. Publishing them purely to close them adds noise. |
| The 2 blocks marked **NOISE** | The `IN PROGRESS` audit trail and the example template block. |
| `## COMPLETED` (12 blocks) and `## TAKEN OVER` (5 blocks) | History. It stays in git. |
| The `HANDOFF.d/` files | Briefings, not tickets. Settled 2026-08-07 and not reopened. |
| Parts 0, A, B and B2 | Rules about the file, deleted with the file at step 9. |

---

## 4. Idempotency

Step 6's script searches for an existing **open** issue with the same title before
creating one, so a half-finished run is safely re-runnable.

`gh issue list --label <label>` **works correctly in this repository** — re-verified live
2026-08-07: `--label coordinator-marker --state open` returned issue #491. The claim at
`COORDINATOR_INTAKE.md:3333` that it "returns EMPTY in this repo even for issues that
demonstrably carry the label" is **false**, and the REST workaround it prescribes is not
needed. That claim cited a document as its evidence, in a file whose own standing rule is
that facts must be re-derived from `git`/`gh`.

---

## 5. ⚠️ What changed under this step after the plan was written

1. **The repository is PRIVATE** (2026-08-07 ~15:10 UTC). Issues created here are private.
   The plan's step-4 owner gate is scripted around "publishing is one-way, and public" —
   that wording is now wrong and must not be read to Albert as written. The scrub still
   matters: R-SEC-1 part (d) contemplates making the repo public again, and anything in an
   issue at that moment becomes public with it.
2. **Branch protection on `main` is GONE.** `gh api …/branches/main/protection` returns
   403 *"Upgrade to GitHub Pro or make this repository public"*, and
   `…/branches/main` reports `protected: false`. Private repositories on this plan cannot
   have branch protection, so flipping the repo to private silently removed all six
   required checks. **Plan steps 7a and 7b are moot** — there is no required context to
   remove. This is also a live safety regression in its own right and is carried as WI-57.
