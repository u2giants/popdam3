---
issue: 1517
status: BLOCKED
owner: codex/issue-1517-plan
---

# Warner legacy cleanup reissue — approved plan, fresh implementation session required

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

No current design decision remains. Albert approved all six Kimi-reviewed recommendations on 2026-08-25.

Two future actions still require separate explicit authorization when their gates are ready:

1. Rehearse only the fresh replacement migration on preview.
2. Promote only the fresh replacement migration to production.

Approval of this plan authorizes neither action. Put both to Albert separately at the correct phase.

Already settled — do not re-ask: reissue rather than retire; document the narrow stranded exception; no replacement API view; evidence-based handoff retirement; retire the completed Paramount handoff; drop commits `26828c9` and `ada0298`.

## 1. What this application is

`u2giants/shared-db` governs the shared Supabase database structure used by POP Creations applications. Warner STARLABS licensed-source landing structures live in `plm`; browser-facing structures live in `api`.

## 2. What this session did

This session reconciled the stranded Warner handoff and issue #1517, obtained a completed Kimi K3 architecture review, received Albert's six owner rulings, and converted them into the fresh-session implementation plan [`../plan_warner-legacy-cleanup-reissue.md`](../plan_warner-legacy-cleanup-reissue.md).

## 3. Current state

Planning only. No migration, database write, preview rehearsal or production promotion occurred. The plan is intended to land on `main`; implementation starts at its step 1 from a new isolated worktree. Issue #1517 remains OPEN and still needs its scope block changed from `owner-decision` to `ready` before orchestrator dispatch.

## 4. What did not work

- The original migration cannot produce qualifying preview evidence under current producer bytes.
- The authoring-era preview was deleted, so rehearsing at the old commit is impossible.
- Rehearsing the original now would permanently consume its chance without enabling production.
- Issue closure alone is not proof a handoff is safe to delete.

The plan's §7 records every rejected route and must be read before proposing alternatives.

## 5. Root cause and findings

Two valid controls collide: producer-byte binding and the 2026-08-18 preview replacement. The safe recovery is a fresh version with identical SQL and a permanent hard-block on `20260814170749`. Kimi also found contradictory instructions already present in the promotion procedure and Warner status report; the plan corrects them in place.

## 6. Exact next steps

1. Read the linked plan end to end and live `AGENTS.md`/issue #1517.
   - You'll know it worked when the implementer can state all locked decisions and both future authorization boundaries.
2. Record the rulings on #1517 and change its scope status to `ready` without changing its structural route or exact object scope.
   - You'll know it worked when queue audit accepts the live issue.
3. Let the active shared-db orchestrator dispatch the structural work and reserve a fresh version.
   - You'll know it worked when a valid exact-object claim exists.
4. Execute plan phases B–F in order, stopping at each missing preview/production authorization.
   - You'll know it worked when every STATUS row cites a reproducible artifact and #1517 closes only after its completion report is accepted.
5. At the end of every phase, re-read all downstream phases through plan end and report any drift before continuing.

## 7. Constraints and gotchas

Never rehearse the original. Never infer preview or production authority. Never edit another session's worktree/handoff/claim. Structural work belongs to the orchestrator; housekeeping is separate repository work. Prove the target immediately before every write. Preserve licensed data privacy.

## 8. Access and environment

`gh` is authenticated as `u2giants`. Database applies use governed GitHub workflows, not MCP or direct shell DDL. Secrets remain in 1Password vault `vibe_coding`. Start implementation in a new isolated worktree at current `origin/main`.

## 9. Open questions and risks

No design question remains. Timing of preview and production is intentionally open until separate authorization. The largest risk is a helpful session rehearsing `20260814170749`; the plan prevents that with retirement metadata, refusal tests and exact allowlists.

## Self-audit

1. A new developer can continue without chat context: yes; §§1–6 define the system, decision history, root cause and exact start.
2. They can continue as effectively as this session: yes; the linked 13-section plan carries all findings, dead ends and gates.
3. Every execution detail is present: yes; plan §§9–13 cover implementation, tests, constraints, access and completion.
4. Section 0 contains every owner decision: yes; the six rulings are settled and the only future asks—preview and production—are listed separately.
