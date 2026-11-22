---
issue: 5609
related_issues: 5610
owner: codex/01a1ec01-e793-7af3-9f62-696f0813b4c6
summary: "Closeout for shared-db #5610 index removal and #5609 capacity proof."
kind: handoff
status: OPEN
read-when: "Resuming shared-db #5610 or #5609 after November 21 closeout."
---
# Shared database index and capacity continuation

## 0. Owner decisions
None outstanding. Albert authorized disruptive work only from Friday 6 PM EST through Sunday 5 AM EST in New York. Reconfirm applicability to a later weekend. This does not waive release controls.

## 1. System and goal
POP DAM, DesignFlow, CRM and PIM share this database. Prove the live index cleanup did not slow affected workflows, then safely increase statement measurement capacity and prove the asset-saving improvement.

## 2. Delivery
[#5610](https://github.com/popcre/shared-db/issues/5610) shipped three index removals through [PR #6907](https://github.com/popcre/shared-db/pull/6907), merged as 4f81c0510884364bee4fb92da83489b2863ddffa. Exact version 20261225050100 rehearsed in [preview](https://github.com/popcre/shared-db/actions/runs/44802202957) and applied in [production](https://github.com/popcre/shared-db/actions/runs/44802910645). Independent catalog confirmed the three absent and the four protected indexes present, with 277,151,744 fewer relation bytes. No preview or production fixture/data writes were made by this session. [#5609](https://github.com/popcre/shared-db/issues/5609) received no configuration change or restart.

## 3. Open acceptance
The [24-hour check](https://github.com/popcre/shared-db/issues/5610#issuecomment-7068201605) found all 373 requests successful. Relative to the recorded pre-release window, mean DAM search rose 15.5%, style-guide search rose 33.5%, and browse fell 89.9%. Sample sizes and request mix differed. No causality or no-regression finding is established. The one-time check ran and was removed. Both live-proof checkboxes remain open.

## 4. Source and custody
[Capacity draft #2610](https://github.com/popcre/ai-devops/pull/2610) preserves exact toolkit source 076b9237fa4273f5b930f02ab52b8f4cd7d12c14, tested offline on Linux and Windows. The disabled shared-db stage source remains preserved on the [remote stage branch](https://github.com/popcre/shared-db/tree/codex/5609-capacity-stage-only). Newer b0836d9aa7f79563d45eb74d7bbac58fe4405224 is a retained local Git commit on edge-dev3. The infrastructure shipment gate refused publication, so no remote availability is claimed. Two issue-specific subagents returned their work and stopped. No accepted successor.

## 5. What failed
A pre-delivery eviction invalidated the statement comparison; further evictions followed. Prior same-weekday request evidence had too few matching requests or none. Early removal checks caught a shared synthetic permission fixture and replay order. Both were repaired and the production verification passed. Early scheduled reminder fired at the wrong time and was corrected. Offline capacity tests did not qualify a production restart.

## 6. Next actions
For #5610, use the [index plan](https://github.com/popcre/shared-db/blob/main/plan_unused-index-cleanup.md) and original recreate definitions in [the migration](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261225050100_drop_verified_unused_indexes_5610.sql). Compare representative identical queries and access identities under comparable workload on a safe rehearsal path. Use existing request evidence and repeat a comparable live observation. If a regression is attributable to the cleanup, restore only the implicated index through normal preview and automatic promotion. Recheck access, timings and storage before closing. Do not treat success counts alone as no-regression proof.

For #5609, verify the actual supported production route and current authorization, then qualify the fixed capacity change and restart on preview. Preserve #5610 evidence first. Follow the [asset trigger plan](https://github.com/popcre/shared-db/blob/main/plan_assets-update-trigger-scoping.md) and [issue acceptance conditions](https://github.com/popcre/shared-db/issues/5609). Open the first genuine, complete measurement window only after the effective capacity increase. Require the recorded 24 hours and 100 genuine calls without eviction or reset, unchanged functional checks, and the original performance thresholds. Do not run manual production configuration or restart.

## 7. Blockers and safety
#5610 has inconclusive comparable timing evidence. #5609 lacks a qualified restart route, depends on secured #5610 proof, and has no valid measurement window. No business approval currently needed.

## 8. Freshness and evidence
Re-read both open issues and the current release rules. All counts and live capacity are November 21 snapshots. Live capacity was 5,000. Private statistical snapshots remained in session scratch with restricted permissions; public issue comments preserve request totals and decisions. No credential values appeared in the work.

## 9. Restart prompt
Resume shared-db #5610 and #5609 using this handoff and linked issue evidence. Do not redo the landed removal. Resolve #5610 with matched live performance and access proof, then qualify #5609 through the supported production route and verify the original asset-saving thresholds.

## Self-audit
Sections 1–3 establish the work and actual delivery. Sections 4–5 preserve source, unfinished custody and failed attempts. Sections 6–9 give concrete steps and success conditions. The local-only draft is explicitly identified so a successor does not mistake it for published source.
