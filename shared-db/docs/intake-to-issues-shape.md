# Step 3 — the labels and the shape of a migrated issue

**Companion to** [`plan_coordinator-queue-to-github-issues.md`](../plan_coordinator-queue-to-github-issues.md) step 3.
**Written 2026-08-07. Nothing here has been created.** This is the contract the step-6
migration script follows, written down before anything irreversible happens, so that the
owner gate at step 4 has something concrete to approve.

> ✅ **The repository is PUBLIC, and issues created here are public.** It went private at
> ~15:10 UTC on 2026-08-07 (request R-SEC-1) and **public again the same day on Albert's
> instruction**, after he ruled the Disney extract is not sensitive. Branch protection was
> restored in full at the same time. See §5 for what that episode taught, which is worth
> keeping even though both problems are fixed.

---

## 1. Labels

Three new labels. **None has been created** — `AGENTS.md` and the plan both forbid
creating issues or labels without the owner's say-so.

| Label | Colour | Description | Why it exists |
| --- | --- | --- | --- |
| `db-work` | `#1D76DB` | Unclassified shared-db intake. This label never grants orchestrator ownership. | A historical inbox label only. Machine-readable status, work type, and route in the issue body decide ownership. |
| `needs-albert` | `#D93F0B` | Blocked on an owner decision. Nobody may act on it without a fresh answer in the current chat. | The queue used a ⛔ prefix for this. It is the one distinction that changes who can act. |
| `blocked` | `#B60205` | Blocked on something other than the owner — another work item, an upstream system, or a machine nobody has access to. | Distinguishes "waiting on Albert" from "waiting on a thing", which the queue conflated. |

**Already exist. Leave them alone:** `orchestrator-marker`, `db-claim`. They belong to the
dispatch protocol, not to this migration.

**Labels do not route work.** Every open `db-work` issue carries one strict
`db-work-scope` block with separate `status`, `work_type`, and `route` fields.
`needs-albert` remains a visible aid, but it says only who must answer. It never says who
owns the eventual implementation.

Only this exact combination can enter the migration-author queue:

```text
status: ready
work_type: structural
route: shared-db-orchestrator
```

Structural work must list exact database objects. Pure data and source-review work must
not list objects. Outside-sourced writes into curated `core.*` Master Data retain the
separate `curated-master-data-governance` route and never enter a migration-author lane.
There is no default route.

### Counts this produces

From the step-1 inventory (`node tools/intake-inventory.mjs`):

| | |
| --- | --- |
| Work items → issues | **63** (was 60; three more arrived with PR #490 before the cutover) |
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
2026-08-07: `--label orchestrator-marker --state open` returned issue #491. The claim at
`COORDINATOR_INTAKE.md:3333` that it "returns EMPTY in this repo even for issues that
demonstrably carry the label" is **false**, and the REST workaround it prescribes is not
needed. That claim cited a document as its evidence, in a file whose own standing rule is
that facts must be re-derived from `git`/`gh`.

---

## 5. The visibility episode of 2026-08-07, and the trap worth keeping

For about two hours on 2026-08-07 the repository was private. Both problems that caused
are now **fixed**, but the mechanism is undocumented anywhere else and will recur.

**What happened.** The repo went private at ~15:10 UTC to get Disney's character extract
out of public view (request R-SEC-1). Albert then ruled that **the Disney extract is not
sensitive**, and instructed twice that the repo be made public again. It was.

**The trap.** Going private **silently destroyed branch protection.** A private repository
on this account's plan cannot have it, so all six required status checks, `strict: true`,
`enforce_admins: true` and the force-push and deletion blocks disappeared without a warning
or a log entry. `gh api …/branches/main/protection` returned
`403 "Upgrade to GitHub Pro or make this repository public"`, and `…/branches/main`
reported `protected: false`. For those two hours `main` was directly writable,
force-pushable and deletable, in the repository that is the only legal path for schema
changes across five applications. Nobody noticed.

**Where it stands now**, read back live after the repo went public again:

| Setting | Value |
| --- | --- |
| `required_status_checks.contexts` | the documented **six** |
| `required_status_checks.strict` | `true` |
| `enforce_admins.enabled` | `true` |
| `allow_force_pushes` / `allow_deletions` | `false` / `false` |

**The rule this leaves behind: visibility and branch protection are coupled on this plan.
Never change one without immediately checking the other.** Restoring protection is not
automatic — it had to be re-applied by hand.

**Consequences for this document.** None. Issues are public, which is what design
decision D1 assumed. The scrub still applies in full, minus the Disney identifiers, which
the owner ruling releases. The standing ruling is recorded in `AGENTS.md` §6.7.
