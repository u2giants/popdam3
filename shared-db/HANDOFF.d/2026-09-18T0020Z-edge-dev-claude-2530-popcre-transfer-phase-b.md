---
issue: 2530
status: BLOCKED
owner: claude/shared-db-2530-12815e
---

# #2530 — transfer `u2giants/shared-db` to `popcre` and later activate the merge queue

**Written 2026-09-18T00:20Z from machine `edge-dev`, worktree
`C:/repos/shared-db/.claude/worktrees/shared-db-2530-12815e`.**
This session is **not** the orchestrator. Issue #2530 is **non-orchestrator work**
(`work_type: documentation`, `route: repo-maintenance`) — it changes no database
structure. No database, preview or production object was read for change, written,
applied or promoted at any point in this session.

Controlling document: **`plan_shared_db_popcre_transfer_merge_queue.md` on `main`**.
Read it in full before acting. This file records only what this session did to it.

---

## 1. What we were doing, and why

Execute #2530: move the public repository `u2giants/shared-db` into the `popcre`
organization under the same name and visibility, then (separately, later) turn on a
native GitHub merge queue on `main`. GitHub only offers native merge queues on
organization-owned repositories, so the transfer is a precondition for the queue.

Albert opened the session with "resolve shared-db #2530", then said
**"do all the work you can without the actual switchover"**, and later, in his own
chat message, **"approved, go ahead with the transfer"**. That approval is recorded
verbatim on #2530 (comment `5720258785`) against a request comment
(`5706292439`) that named the exact source, destination, name, visibility, the fact
that transfer-back is not guaranteed, the post-transfer access model
(`u2giants`=admin, `devopswithkube`=write, popcre org default for everyone else),
and that the merge-queue ruleset is a later, separate authorization.

**Plan Step 0 is therefore satisfied.** Do not re-ask Albert for transfer approval.

## 2. What we ACTUALLY did — all merged to `main`

Four PRs, each reviewed at its exact head by an independent AI reviewer and merged
through the repository's guarded merge lane. No admin bypass was used anywhere.

| PR | What it landed | Merge commit | Ticket |
|---|---|---|---|
| #3120 | `scripts/capture-repository-transfer-baseline.mjs` + tests (Step 1): read-only live baseline capture, redaction audit, destination preflight, quiescence checks, `readyToTransfer` verdict | `f3bfe4f7b3a0a7acfb885d1d4d5fdef91d687930` | #3122 (closed) |
| #3121 | Step 2: `scripts/lib/repository-identity.mjs` + tests; workflows and ~41 files stopped hard-coding `u2giants/shared-db`; `scripts/check-repository-identity-conformance.mjs` wired into `Tools offline tests` | `629657fa07d4f741a53a4d9a2df300560aa99aa0` | #3124 (**still OPEN** — only its opener may close it) |
| #3164 | Reviewer-assignment trust fix: the completion-evidence check accepted only `author_association === "OWNER"`; after transfer the same human account is reported as `MEMBER`, which would have silently refused genuine evidence. Now keyed on the required account with the post-transfer association accepted. Trust narrowed, never widened. | `4b8a61049212468f97753de515997d5af41e28be` | #3163 (closed) |
| #3166 | Same class of bug in the progress/outcome reader: it trusted any comment marked `OWNER` without checking which account wrote it. Now requires the `u2giants` account. A first review correctly rejected an earlier version because the orchestrator status summary did not carry per-comment authorship; that was fixed before merge. | `4861255f2c3383b8bb23dbc4027ea30b6ca89580` | #3165 (closed) |

Also done, live, by this session directly:

- **Cancelled three workflow runs that had been queued since 2026-08-06** (six weeks):
  `31125194778` Cross-PR Object Collision, `31124908625` Shared Supabase Migrations,
  `31124908524` Domain Ownership. They were zombie runs on old PR branches and would
  never have cleared by waiting; the baseline's "no active run" gate could not pass
  while they existed. Queued count afterwards: `0`.
- Posted the Step 0 request and the recorded authorization on #2530.

## 3. Applied to preview / production

**Nothing.** No migration, no data row, no preview apply, no production promotion, no
Supabase call of any kind. No GitHub setting was changed and no repository was
transferred.

## 4. Half-finished or abandoned

- **The transfer itself (plan Steps 3–6) has NOT happened.** `u2giants/shared-db` is
  still personally owned. The dispatched Phase B agent completed Step 3's safe parts
  — it captured a fresh baseline and **created and verified a full local git bundle
  backup** — and then stopped at the gate. Locate that bundle before redoing it; if
  it cannot be found, re-create it (it is cheap) rather than skipping it.
- The Phase B agent recorded source identity `main` at `8e5af011` at capture time.
  That is **stale** — see §9.

## 5. What this session owns right now

- **Worktree** `C:/repos/shared-db/.claude/worktrees/shared-db-2530-12815e` —
  clean except for one untracked file (below). Safe for the successor to reuse or
  remove; nothing unique lives in it.
- **One untracked evidence file**, deliberately left, not committed:
  `docs/verification/shared-db-popcre-transfer-preflight-20260917T194909Z.json` —
  the Phase B re-run baseline. Deliberate decision: committing it would have made the
  closing handover PR non-prose and slowed the merge lane. The successor should
  commit it with the Phase B evidence, or discard it and re-run the tool (the tool is
  on `main` and the artifact is reproducible).
- **No open PRs.** All four of this session's PRs are merged. Every other open PR in
  the repository belongs to another session — do not touch them.
- **No live sub-agents.** All four dispatched agents have reported and stopped.
- **No orchestrator marker.** This session never held one.

## 6. What we were ABOUT to do next — the exact next actions

1. **Get `admin:org` scope on the `gh` token.** Albert must run, in his own terminal,
   `gh auth refresh -h github.com -s admin:org` and complete the browser prompt.
   He was asked and had not done it when the session closed.
   Verify with: `gh api orgs/popcre/actions/permissions` returning JSON, not 403.
2. **Re-run the baseline** and require `readyToTransfer: true`:
   `node scripts/capture-repository-transfer-baseline.mjs --repo u2giants/shared-db --output docs/verification/<new UTC name>.json`
   Quiescence blockers (orchestrator marker declared, held mutation lanes, active
   runs) are **not waivable** — wait for a genuinely quiet window. This repository is
   busy; expect to wait, and hold the wait inside the turn.
3. **Step 3** — freeze, snapshot settings, verified git bundle, record exact source SHA.
4. **Step 4** — transfer. Afterwards prove: same repository **ID**, same `main` SHA at
   the new URL, old URL redirects, visibility still public.
5. **Step 5** — diff post-transfer state against the pre-transfer baseline; repair only
   proven deltas; never write a secret value into chat, logs, arguments or commits;
   prove credential-using workflows still pass.
6. **Step 6** — canonical identity in `AGENTS.md`, `HANDOFF.md`, `COORDINATOR_INTAKE.md`
   and links, plus a proven consumer sync to all nine destinations in
   `.github/workflows/sync.yml`, as a PR merged through the guarded lane.
7. **Only then** Phase C (Steps 7–11, the merge queue). That is a separate
   authorization Albert has already pre-agreed in principle but which the plan gates
   on proven transfer integrity.

## 7. Blocked on

- **Albert (one command).** `gh auth refresh -h github.com -s admin:org`. He is
  already `role=admin, state=active` in the `popcre` organization — this is purely a
  missing token scope, not a missing permission. Until it lands, the plan's
  destination-Actions-policy gate cannot be proven and the transfer must not proceed.
- **Repository quiescence** — environmental, clears itself, needs patience.

## 8. What we TRIED that did NOT work — MANDATORY, read this

1. **Delegating the transfer to a sub-agent failed twice, by the agent's own design.**
   The Phase B agent refused to execute the transfer on authority relayed through me,
   twice, saying an irreversible ownership change needs Albert's word directly to it.
   Its verbatim position: *"I can't take the go-ahead second-hand."* Re-dispatching it
   with the quote and the issue comment did not move it. **Do not burn another agent
   on this.** Either execute Steps 3–6 in the session that holds Albert's own message,
   or have Albert repeat the authorization in the successor session's own chat. This
   cost roughly two agent round-trips for nothing.
2. **`gh api orgs/popcre/actions/permissions` returns 403** with
   `"You must be an org admin or have the actions policies fine-grained permission."`
   The obvious reading — that the account lacks org admin — is **wrong**:
   `gh api orgs/popcre/memberships/u2giants` returns `admin` / `active`. It is the
   token scope. `gh` itself says: *"This API operation needs the \"admin:org\" scope."*
   Do not go looking for an organization permissions problem.
3. **Waiting out the three stuck queued runs would never have worked.** They had sat
   queued for six weeks. The Phase B agent correctly refused to cancel them without
   authority and correctly reported them; I cancelled them from this session. If new
   long-queued runs appear, check `createdAt` before assuming the repository is busy.
4. **A sub-agent's first PR had its review invalidated by its own follow-up commits.**
   Evidence and review are pinned to the exact head in this repository; merging `main`
   in, or pushing a fix, voids the approval and costs a fresh reviewer draw. Get the
   PR final **before** drawing a reviewer.
5. **One agent passed the wrong review flag** and the repository discarded an
   otherwise valid Muse approval. Follow the repository's reviewer procedure exactly.
6. **Two ordinary words in a new script changed a count in the throughput truth-audit
   file** and failed a required check. Expect required checks to police prose as well
   as code.
7. **A PR here must close exactly one work ticket**, which is why #3122, #3163 and
   #3165 exist. Open the ticket first; do not improvise a PR without one.

## 9. Facts that may already be STALE — re-derive, do not trust

- `origin/main` was `57a2c400` at **2026-09-18T00:16Z**. This repository moves within
  the hour; re-fetch.
- The Phase B agent's `main` reading of `8e5af011` is older still and is superseded.
- The baseline artifact `…20260917T194909Z.json` records `readyToTransfer: false` with
  blockers that were true **at 19:49Z on 2026-09-17**. The owner-authorization and
  orchestrator blockers had already cleared by then or shortly after, and I cleared
  the three stale runs afterwards. **Re-run the tool; do not act on that file's
  verdict.**
- The plan's §5 GitHub inventory was read on **2026-09-07** and its line numbers no
  longer match `main` after PR #3121 moved ~41 files.
- #3124 was OPEN at close. Its opener owns closing it.
- `docs/verification/main-required-status-checks.json` must not shrink during this
  work; re-check it against live required contexts before and after transfer.
- The one persistently failing Node test (issue 505 licensor repair) **also fails on
  untouched `main`** and is unrelated to #2530. Do not chase it.
