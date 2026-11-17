---
issue: 6561
status: OPEN
owner: implementing session (plan revision 2 landed a26a50eb3 2026-11-17; active)
summary: Open implementation plan for the two promotion-stranding watch upgrades — pre-end promotion watch rule + automatic per-PR escalation on park.
kind: handoff
read-when: picking up the promotion-stranding watch work; before editing scripts/automatic_promotion_candidates.py reporting or the shared-db-change skill's merge step.
---

# Promotion-stranding watch plan — open, unimplemented

- **The card:** GitHub issue [#6561](https://github.com/popcre/shared-db/issues/6561) — claim-first there; an implementing session landed plan revision 2 (a26a50eb3) and posted an advisory plan review 2026-11-17.
- **The plan:** [plan_promotion_stranding_watch.md](../plan_promotion_stranding_watch.md)
  — read its STATUS table first.
- **Why it exists:** on 2026-11-16/17 nine merged migrations sat undelivered
  (2 parked after 3 failed attempts, 6 held by findings) and **no owning
  session could be notified** — all sessions share the `u2giants` login, and
  the lane's only park record is a comment on shared tracking issue #6352
  that nobody reads. Full evidence chain, run ids and rejected designs are in
  the plan's §3/§7.
- **Next exact action:** implement Phase 1 (per-PR escalation in
  `scripts/automatic_promotion_candidates.py::report_stuck_change`) per plan
  §9 steps 1-6, in a fresh worktree from `origin/main`, class `shared-db`.
- **Live-proof obligation:** after landing, the first REAL park must receive
  the automatic PR comment + `promotion-parked` label; the checklist item
  lives on the implementation issue, not a new one.
- Owner/next session: whoever claims it; claim-first on the plan's
  implementation issue. This session (sess_58bd3574) is available for
  questions only via this file — it has ended.

Posted by ZCode chat (sess_58bd3574) on edge-dev
