---
issue: 4707
status: OPEN
owner: codex/4707-continuation-wrapup
---

# DesignFlow item migration continuation

## 0. Business decisions

None are needed to start. The initial copy exclusions and ColdLion authority are settled. Preserve the current vendor visibility for excluded items. Escalate only a new business choice that changes which records a user should see.

## 1. Applications and ownership

DesignFlow Item Master owns item and licensing entry, Tracking consumes licensing status and reminders, Backend uses item identities for lookups, and Data Syncing runs the managed copy. The shared database owns the canonical structure. Start with the [work issue](https://github.com/popcre/shared-db/issues/4707), the [canonical plan](https://github.com/popcre/shared-db/blob/main/docs/designflow-item-and-licensing-migration.md) and the [DesignFlow release rules](https://github.com/popcre/designflow-data-syncing/blob/develop/GATEKEEPER.md).

## 2. Goal

Finish the migration so DesignFlow uses the canonical item and licensing records with proven parity and a recoverable cutover. Continue on the existing issue and preserve current app availability throughout.

## 3. Verified state

- All five database stages reached production. The [release baseline](https://github.com/popcre/shared-db/issues/4707#issuecomment-7074234077) records scope and access proof. [Data Syncing production PR #173](https://github.com/popcre/designflow-data-syncing/pull/173) published the copy tooling.
- The initial production copy loaded 19,761 items and 478,613 rows in total. Independent readback matched the counts. Exact replay inserted zero rows. See [copy and replay evidence](https://github.com/popcre/shared-db/issues/4707#issuecomment-7084333446). Avoid repeating the initial load as a substitute for reconciling later edits.
- The live apps still read and write their original records. Changed and removed record reconciliation and real-role application acceptance are unchecked on #4707. Keep both live-proof items open until verified.
- As of this closeout, the formerly occupying [Data Syncing sandbox PR #175](https://github.com/popcre/designflow-data-syncing/pull/175) had merged. The GitHub query found no open Data Syncing PR from the shared sandbox. [Tracking #224](https://github.com/popcre/designflow-tracking/pull/224) still occupied its sandbox. Recheck all six app heads and ownership before publishing.
- The latest [related production merchandise release](https://github.com/popcre/designflow-data-syncing/pull/179) is separate. Preserve it and remeasure any effect on current taxonomy evidence.

## 4. Attempts and limits

The deployed copy role is insert-only. A repeat run detects disagreements and cannot safely reconcile changed or removed rows. The production Sales QA login returned HTTP 403. Service health and sign-in availability did not prove authenticated screens. The proof and its limits are in the [compatibility record](https://github.com/popcre/shared-db/issues/4707#issuecomment-7084415100).

## 5. Findings

The existing active Item Master predicate found 489 approved-exclusion records with vendor codes outside the copy. Preserve their legacy lookup and the token-email-to-vendor rule. Preserve integer item IDs, ERP-less drafts, original licensing attribution, ordered assignees, mentions and file links. Continue holding unresolved merchandise references. See [vendor and compatibility evidence](https://github.com/popcre/shared-db/issues/4707#issuecomment-7084415100) and the [held-ID proof](https://github.com/popcre/shared-db/issues/4707#issuecomment-7042772107).

## 6. Execution and acceptance

1. Refresh the issue, branch heads, active claims, data contracts and release rules. Recover the privately preserved audit and Item Master overlay via the prior implementation session if available. If unavailable, reconstruct from the [released copy projections](https://github.com/popcre/designflow-data-syncing/blob/main/scripts/run-designflow-item-state-copy.js) and the compatibility record. Pass when the fresh source is identified and owner collisions are ruled out.
2. Bring the audit to current Data Syncing in an isolated worktree. Prove it independently identifies changed, new and removed rows and retains the evidence for child rows and attachments. Publish through the repo's supported route and run a bounded, read-only audit under the exact deployed role. Pass when all dispositions and child counts are reconciled against one consistent source snapshot.
3. Build a bounded, idempotent and recoverable reconciliation procedure. Separate source deletion from an approved eligibility exclusion. Test insert, update, removal, rerun, concurrent source change, interrupted run and rollback without dropping file ownership or licensing history. Any necessary database structure or access goes through shared-db claim-first and governed promotion. Rehearse the exact production data change under GATEKEEPER before it runs. Pass when independently verified replays produce the expected deltas with a proven recovery path.
4. Add minimal server-side permissions and compatibility paths in Item Master, Tracking and Backend. Preserve all legacy scopes and the 489 vendor items. Verify an authorized vendor, a denied cross-vendor read, an ERP-less draft, held merchandise and licensing milestone, assignee, reply, mention and attachment behavior. Tracking must preserve latest action and reminder behavior. Pass when existing and candidate paths agree and allowed writes reconcile across a sync cycle in the sandbox.
5. Release only the scoped changes after all applicable repo gates. Capture or fence concurrent writes, reconcile and prove rollback, then switch the verified app paths. Repeat the checks against actual serving production revisions and real roles. Close #4707 only after independent live proof is posted and both unchecked items are complete. Retire this handoff under the repo retention rule when its remaining obligations are verified.

## 7. Constraints

Use separate current-upstream worktrees. Preserve unrelated sandbox work and existing committed releases. Keep ColdLion canonical for its data and the original app routes authoritative during the rehearsal. Do not broaden production permissions to get a green check or bypass release, role, or data-safety controls. Current GATEKEEPER permits the AI to merge its own scoped app PRs after its requirements are met. Identify the affected schema and action before applying any specific approval rule.

## 8. Access and source custody

GitHub is the published evidence and release authority. Bind Supabase read access and application QA to their verified exact environments. Obtain approved credentials through the protected vault. The read-only audit, Item Master fallback comparison and Tracking comparison were tested in isolated work and remain private and unpublished. The [same-issue continuation](https://github.com/popcre/shared-db/issues/4707#issuecomment-7084415100) records the proof and release boundaries. No secret values or private source locations belong in the issue or mirrored handoff.

## 9. Remaining risks

The production data can change after any read-only snapshot. The old copy role has no update/delete rights and consumers lack the new read paths. A whole-screen switch without a proven fallback can remove vendor-visible records. Authenticate with real permitted roles before asserting screen acceptance. The currently signed issue evidence is dated November 22, 2026. Refresh it before acting.

## Delegated work

- Merchandise reconciliation: completed and released. [Proof](https://github.com/popcre/shared-db/issues/4707#issuecomment-7042772107).
- Data Syncing release repairs: completed and verified. [Sandbox release proof](https://github.com/popcre/ai-devops/issues/2624#issuecomment-7072032719), [queue repair](https://github.com/popcre/shared-db/pull/6948#issuecomment-7073337018), and [database test fallback](https://github.com/popcre/shared-db/pull/6956#issuecomment-7074370785).
- Item migration: database delivery and initial production copy complete. Private audit and fallback work are preserved, and consumer cutover remains open. [Implementation closeout](https://github.com/popcre/shared-db/issues/4707#issuecomment-7084614739). No implementation subagent is running for this wrap-up.

## Handoff self-audit

Sections 1–3 identify the finished releases and incomplete cutover. Sections 4–8 preserve evidence, dead ends, recoverable steps and access boundaries. Section 9 enumerates the remaining risks. Section 0 captures every owner decision presently needed, which is none. The continuation is executable from published source if private custody is unavailable.
