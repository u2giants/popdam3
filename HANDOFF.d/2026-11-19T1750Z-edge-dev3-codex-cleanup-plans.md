---
summary: "Start here for the 20 ranked November 19 maintenance plans."
kind: handoff
status: open
read-when: "selecting or resuming a November 19 PopDAM cleanup"
issue: 1200
owner: codex/popdam-20-cleanup-plans
---

# November 19 PopDAM cleanup plans

## 0. Owner decisions
Albert requested plans for all items and reserved selection of individual implementations. Item 01 distinguishes a behavior-preserving extraction from changing whether both search indexes may run together. Default to preserving current behavior until specifically selected.

## 1. Application
PopDAM and PopSG manage licensed artwork and style guides. The website, workers, backend, agents and desktop applications ship independently from this repository.

## 2. Purpose
Give each of the twenty audit findings an independent brief, ranked in audit order. [Tracking issue](https://github.com/u2giants/popdam3/issues/1200).

## 3. Current state
Source audited at 0009728, reconfirmed at d097a6a. Only the shared database mirror changed between those revisions. Every implementation starts open. Earlier issue #708 is closed and addresses an older set.

## 4. Dead ends
A single broad rewrite obscures the distinct release paths and platform differences. No code change or live experiment was attempted during planning.

## 5. Key findings and plan directory

- [01. Job scheduling across PopDAM and PopSG](../docs/plans/issue-1200-01-job-scheduling-across-popdam-and-popsg.md)
- [02. Paid tagging recovery](../docs/plans/issue-1200-02-paid-tagging-recovery.md)
- [03. Check-in file fingerprints](../docs/plans/issue-1200-03-check-in-file-fingerprints.md)
- [04. ERP item identity](../docs/plans/issue-1200-04-erp-item-identity.md)
- [05. Windows maintenance checks](../docs/plans/issue-1200-05-windows-maintenance-checks.md)
- [06. User roles and invitations](../docs/plans/issue-1200-06-user-roles-and-invitations.md)
- [07. Artwork tagging controls](../docs/plans/issue-1200-07-artwork-tagging-controls.md)
- [08. Ranked search cache](../docs/plans/issue-1200-08-ranked-search-cache.md)
- [09. Check-in retry records](../docs/plans/issue-1200-09-check-in-retry-records.md)
- [10. TIFF agent requests](../docs/plans/issue-1200-10-tiff-agent-requests.md)
- [11. Bulk-job progress](../docs/plans/issue-1200-11-bulk-job-progress.md)
- [12. PDF sampling on both agents](../docs/plans/issue-1200-12-pdf-sampling-on-both-agents.md)
- [13. Saving AI tags](../docs/plans/issue-1200-13-saving-ai-tags.md)
- [14. PopSG render screens](../docs/plans/issue-1200-14-popsg-render-screens.md)
- [15. Administration grid filters](../docs/plans/issue-1200-15-administration-grid-filters.md)
- [16. Text model in the image worker](../docs/plans/issue-1200-16-text-model-in-the-image-worker.md)
- [17. Production filter rule tests](../docs/plans/issue-1200-17-production-filter-rule-tests.md)
- [18. Backend string validators](../docs/plans/issue-1200-18-backend-string-validators.md)
- [19. Downloadable protocol installers](../docs/plans/issue-1200-19-downloadable-protocol-installers.md)
- [20. Unused desktop hash export](../docs/plans/issue-1200-20-unused-desktop-hash-export.md)

## 6. Next session
1. Verify the selected plan and current issue activity. Read its STATUS table.
2. Execute its four gated steps, updating the same checklist. If another owner has already delivered part, reconcile against the revision and live proof first.
3. Keep unselected work open. Remove this handoff only when all twenty dispositions are recorded.

## 7. Constraints
Follow release ownership and task gates; keep schema changes out of this work. Items 01/11 share the worker loop, 02/13 share tagging logic, 03/09/20 share Helper paths, and 08/17 touch search. Rebase and recheck overlapping work before landing.

## 8. Access
GitHub is the source of truth. Each plan identifies affected services, build commands and acceptance. Use only documented credential references in vibe_coding.

## 9. Risks and self-audit
Scheduling drift is verified in source; a live incident is unproven. Website shipment alone does not verify an agent or worker. Fresh-session coverage is in §§3–6, release boundaries in §§7–8, and business direction in §0. Each plan carries independent risks, rollback and acceptance.
