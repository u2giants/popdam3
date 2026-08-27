# Verification — orchestrator routing contract (issue #1605), 2026-08-26

**Status: complete and live on `main`.** This records the evidence, because the
demonstration below lived only in a session transcript and the contract's whole
purpose is that a session with no chat context can still find the orchestrator.

| | |
|---|---|
| Issue | [#1605](https://github.com/u2giants/shared-db/issues/1605) (closed) |
| PRs | [#1606](https://github.com/u2giants/shared-db/pull/1606) → `a92dde1`, [#1612](https://github.com/u2giants/shared-db/pull/1612) → `b293ca6` |
| Skills | [popcre/ai-devops#106](https://github.com/popcre/ai-devops/pull/106) → `d59cdd6` |
| Contract | `AGENTS.md` §11c; `scripts/lib/orchestrator-routing.mjs` |
| Work type | repository maintenance. No migration lane, no version reservation, **no database change**, no structural-orchestrator dispatch. |

## What was broken

The open `orchestrator-marker` issue proved an orchestrator **existed**. It
carried no **routable address**. Marker #1602 recorded machine, a session slug,
the predecessor and a startup proof — nothing another session could send to.

So a session needing a structural change did the only thing left: it resolved the
destination from conversation history and an old handoff, and delegated an
authorized request to an orchestrator session that **had already closed**.
Nothing reported the failure.

Contributing causes, all four (do not reduce this to one):

1. The marker carried no address.
2. The handover procedure told a departing orchestrator to **leave its marker
   open** if a session continued immediately — so a live marker could point at a
   dead session. Corrected in the handover skill.
3. The requester fell back to stale handoff material, because nothing sanctioned
   said where else to look.
4. Nothing acknowledged delivery, so the failure was silent.

## Behaviour verified

`node scripts/check-orchestrator-marker.mjs --resolve`, every state exercised
against the real code:

| Scenario | Result | Exit |
|---|---|---|
| Claude orchestrator live | resolves to its `sessionId` | 0 |
| Codex orchestrator live | resolves to its thread UUID | 0 |
| Handover done correctly | resolves to the **successor's new** id | 0 |
| Successor reused predecessor's id | **refuses** — the original defect | 1 |
| Zero markers | "no active orchestrator — QUEUE the work" | 3 |
| Two markers | unsafe, refuses | 1 |
| Retired `coordinator-marker` label alive | unsafe, refuses | 1 |
| Marker present but unroutable | invalid — "may be live and unreachable" | 1 |
| GitHub unreadable | UNKNOWN — never "none open" | 2 |

**The address is real, not merely well-shaped.** A marker was resolved to a live
Claude `sessionId`, and that id was confirmed against the session registry as a
running session. Marker → resolver → live target, end to end.

**Live state at merge:** marker #1602 predates the contract, so `--resolve`
reports it **UNROUTABLE** and refuses to hand back an address. That is correct:
an orchestrator is live and currently unreachable, and inventing a destination is
the original defect. Requested via a comment on #1602.

**Tests:** 779 pass, 0 fail (`node --test "scripts/**/*.test.mjs"`).

## What this does NOT prove — state this wherever the contract is described

Validation is **shape only**. This repository has no session API, so nothing
checks that the session exists, is running, belongs to the declared owner or
machine, is the orchestrator, or can receive anything. **A fabricated id with
otherwise valid fields resolves exactly like a real one.**

What a resolved target proves is narrow: *one open marker declares this address.*
Silence is not delivery, and the tool cannot tell the difference. The output says
`MARKER-DECLARED TARGET`, never "active orchestrator", for this reason.

`plan_orchestrator-workflow-gaps.md` §C recorded that nothing here reaches a
running session. **That is still true.** This publishes the address that the
channels which have since appeared — Claude cross-session messaging, Codex
`codex-reply` by thread id — both need. It does not invent a channel.

⚠️ **The inheritance check is a trap, not a proof.** It fires only when the marker
declares a numeric `handover_issue` whose issue is readable and carries a
parseable block. It cannot catch an id reused from an older ancestor, a wrong
predecessor number, a `handover_issue: none` that is a lie, or a fabricated id.

⚠️ **The zero-marker gap is bounded, not race-free.** Claiming a marker is
check-then-create, not atomic: two sessions can both see zero markers and both
claim. The handover skill specifies a serialized handshake that bounds this. A
genuinely race-free transition needs an atomic claim the GitHub issue workflow
does not provide.

## Independent review — two rounds, Codex GPT-5.6, read-only

**Round 1 found three defects, all real, all fixed before merge:**

1. **`--resolve` ignored the guard's safety findings.** One valid marker plus an
   open retired-label issue made the guard FAIL and `--resolve` return an active
   target on identical input. Reproduced before accepting. Anything failing the
   guard now refuses to resolve.
2. **An unreadable predecessor failed open.** The lookup swallowed the error and
   returned null, so a successor could copy a stale id, have the predecessor read
   fail transiently, and pass. Now UNKNOWN. The test that asserted the old
   behaviour is inverted and records why.
3. **"ACTIVE ORCHESTRATOR" overclaimed.** Corrected as described above.

**Round 2 confirmed 1 and 2 closed**, and found the third fix had only reached
the human-readable output — the JSON still said `state: "active"`. Fixed in
#1612, plus the AGENTS.md wording, a `CONTRACT_EFFECTIVE_DATE` date mismatch, and
a documented `ambiguous` state the new gate had turned into `unsafe`.

Round 2 also found, in the skills: the zero-marker race above; that the
root-cause claim was too strong; and that the orchestrator skill still taught the
**superseded three-exit admission test** (repo-maintenance, documentation and
security-settings all exiting by FORK) which the 2026-08-21 owner ruling in
§0.0-C had replaced with four exits. Verified against `AGENTS.md` directly and
aligned. That contradiction predated this work.

Codex could not execute the suite — its sandbox denied the Windows process
runner — and correctly declined to accept a merge message's test claim as proof.
The counts above were run locally.

## Grandfathering

`CONTRACT_EFFECTIVE_DATE = 2026-08-27`, the day **after** merge. Marker #1602 was
opened 2026-08-26, hours before the contract existed; a same-day cutoff would
fail the live orchestrator's marker for lacking a block nobody could have written.

**Scoped to the PR guard only.** `--resolve` never grandfathers — a grandfathered
marker still carries no address, and handing back one that does not exist is the
original defect.
