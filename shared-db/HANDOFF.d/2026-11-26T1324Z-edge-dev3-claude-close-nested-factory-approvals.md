# Close-nested handoff: factory approvals follow-ups (issue #7070)

Written 2026-11-26 8:24 AM EST by the coordinator session on edge-dev3. Issue: https://github.com/popcre/shared-db/issues/7070

## 0. Owner questions
None open. Settled: the production team is the 7 users who hold the `production coordinator` role in DesignFlow (Carlos Corral, David Huang, Emma Li, Jessica Cortazar, Juan Lopez, Laura Arevalo, Yuchen Zhou). A full DesignFlow develop→main release is NOT authorized by this work.

## 1. Tree closed
- Coordinator (this session): no code. Its only output was this handoff plus the merge of PR #7146.
- Grant production role (local_b6af9016): done, nothing to grant; Carlos Corral saved a live edit on test factory 65, then it was reverted. Proof: #7070 comment of 2026-11-26T03:21Z. No branch or PR.
- Stale DesignFlow branch cleanup (local_81020777): done. 11 local branch copies removed after merged-PR proof, and the GitHub branches were kept for recovery. Proof: https://github.com/popcre/shared-db/issues/7070#issuecomment-7181576208
- Ilona licensing role (local_43a7e15f): done. She now resolves as licensing live, production tracking is refused, and licensing tracking loads. Proof: #7070 comment of 2026-11-26T04:25Z. The Royalty Rates screen remains in her menu by design.

## 2. Landed
- https://github.com/popcre/shared-db/pull/7146 (coordinator handoff), MERGED.
- https://github.com/popcre/designflow-backend/pull/603 (Ilona fix, main), MERGED.
- https://github.com/popcre/designflow-backend/pull/606 (same fix copied to develop), MERGED.

## 3. Open tasks
### 3.1 Live FAMA upload proof
- Goal: prove that a real factory approval form upload works end to end in production.
- State: waiting; no real upload by licensing or production staff on designflow.app yet.
- Next action: check `core.factory_approval_form` for a row created by a non-AI user after 2026-11-25. If none exists, record that on #7070 and stop; do not ask Albert to click.
- Done when: the row exists; Indra filled name, number and expiry; and the signed link returns the PDF. Signed proof on #7070.
- Resume: fresh from main. No blockers except the upload.

### 3.2 Vendor RFQ 403 toast fix
- Goal: the factory RFQ page shows no 403 toast.
- State: designflow-backend #576 is merged to develop only; it ships with the next normal DesignFlow develop→main release (not ours to trigger).
- Next action: check whether #576's commit is on designflow-backend main. If it is not, record that on #7070 and stop.
- Done when: impersonating factory 65 on designflow.app, the RFQ page shows no 403 toast. Signed proof on #7070.
- Resume: fresh from main. Blocker: the release timing.

## 4. Child handoffs
None. The children finished with proof comments on #7070 and wrote no HANDOFF.d files.
