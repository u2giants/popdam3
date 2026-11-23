---
summary: "Resume #1273 after the shared Size picker release and staged Depth storage work."
kind: handoff
status: current
read-when: "Continuing PopDAM and DesignFlow Size and Depth convergence."
issue: 1273
owner: codex-01a209de
---

# Master Data Size and Depth cutover

## 0. Business decisions

Albert confirmed on 2026-11-23: “Let staff choose Depth on both Licensed and Generic rows and carry it over when linked.” [Decision on #1273](https://github.com/u2giants/popdam3/issues/1273#issuecomment-7111766403). During implementation, treat a different DesignFlow Depth as a conflict to surface and resolve before transfer. Use the audited DesignFlow item write path. Production DesignFlow’s shared database move is a separate project owned by Uma. [Ownership note](https://github.com/u2giants/popdam3/issues/1273#issuecomment-7111599671). Existing inactive Size values remain visible on their own items and unavailable for new selections. Administrators and authorized Designers maintain the Depth list in DB Data Admin. Preserve numeric legacy values until their meanings are established. [Original decisions](https://github.com/popcre/shared-db/issues/597).

## 1. Applications

[PopDAM Master Data](https://dam.designflow.app/styles) manages Licensed and Generic style rows. [DesignFlow sandbox](https://alsand.designflow.app) Item Library and Item Details manage item records. The shared Size catalog comes from ColdLion MG04. Product Depth is maintained centrally through DB Data Admin. [Plan and boundaries](https://github.com/u2giants/popdam3/blob/main/plan_master_data_designflow_reference_cutover.md).

## 2. Scope

[PopDAM #1273](https://github.com/u2giants/popdam3/issues/1273) tracks one set of approved values across the applications. This session verified the existing canonical lookups, repaired PopDAM's Size source, and delivered the database contract for staged Depth. The next app phase needs the Depth editor on both sheets, shared Size and Depth consumers in DesignFlow, and verified transfer when a row links.

## 3. Verified state

- [PopDAM #1292](https://github.com/u2giants/popdam3/pull/1292) merged and deployed. Production and PopDAM sandbox builds succeeded. On the signed-in production Licensed sheet, an unlinked row offered shared Size values in the Description editor. The Generic sheet timed out during this pass. No row was changed. [Live Size proof](https://github.com/u2giants/popdam3/issues/1273#issuecomment-7112101668).
- Canonical production and DesignFlow sandbox both contain 530 active Sizes, 8 retired Sizes and 121 active Depths, with identical IDs, labels, statuses and source keys. Both picker functions are installed. [Catalog proof](https://github.com/u2giants/popdam3/issues/1273#issuecomment-7111929143).
- [Depth storage claim](https://github.com/popcre/shared-db/issues/6984) and [migration PR #6985](https://github.com/popcre/shared-db/pull/6985). The isolated PostgreSQL tests, full database contract workflow and merge queue passed. [Preview](https://github.com/popcre/shared-db/actions/runs/45256572163) has the column, enabled validation trigger, and signed-in-only read view. The [automatic production run](https://github.com/popcre/shared-db/actions/runs/45257520721) applied the same version. A fresh read from production verified the migration ledger, the staged column, validation trigger, invoker view, authenticated read grant, and anonymous denial.
- The Depth UI, carryover and DesignFlow picker adapters remain open on #1273.

## 4. Failed approaches and limits

- The old PopDAM query requested a nonexistent Size name column and fell back to local choices. [#1292](https://github.com/u2giants/popdam3/pull/1292) reads shared selectable labels and offers retry on lookup failure.
- The Generic browser sheet returned its load/retry state. Retest this sheet after deployment before calling its picker verified. The full local PopDAM test suite had the same ten failures as unchanged main. The relevant focused tests and GitHub build passed.
- A first sandbox Depth comparison used a dormant mirror. The retained [corrected comparison](https://github.com/u2giants/popdam3/issues/1273#issuecomment-7112143980) uses the table serving Item Details. Use the authenticated browser session and authorized read-only management API. The local GCP identity could inspect Cloud Run bindings but could not read the sandbox DB login secret.

## 5. Integration findings

- [New migration](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261225090700_dam_master_data_staged_product_depth.sql) adds a nullable canonical Depth ID on tracker rows and a dedicated signed-in view exposing row ID, Depth ID, label and selectable status. Read the view by loaded row IDs. An inactive value can remain on a row that already has it. New selections must be active. The existing tracker bridge retains its current query.
- The [Size and Depth picker contract](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20260809170400_api_product_size_and_depth_pickers.sql) returns selectable choices and accepts current IDs to keep retired values visible. Compare Size within the same company and division. EP001 MG04 is Pages and stays outside Size. The DesignFlow sandbox has legacy references for all 538 canonical Sizes.
- DesignFlow’s sandbox Depth source has 121 rows matching the shared Depth list by ID, label and status. Stored item Depths are another population. 26 nonblank values equal a canonical label and 20,478 require interpretation, including 16,655 zero values. Preserve existing raw values until their meaning is established. The PopDAM tracker’s PLM bridge currently resolves ColdLion mirror records, so a bridge ID alone cannot identify the writable DesignFlow item. [Read-only evidence](https://github.com/u2giants/popdam3/issues/1273#issuecomment-7111766403).

## 6. Next steps and acceptance

1. Confirm the [database issue](https://github.com/popcre/shared-db/issues/6984) has production ledger, catalog and role-read evidence before changing consumers. Verify the equivalent objects on the database used by PopDAM sandbox. Do not replay a merged migration manually.
2. Start the sandbox consumer work under each owning repository’s rules. Use the existing DesignFlow Item Details API pattern, and use canonical Size and Depth keys while preserving the legacy fields and existing stored selections. Retain the correct ColdLion company, division, group and code for Size writes. Done when the signed-in sandbox item sees the expected shared options and its existing selection remains visible.
3. Use the staged Depth read contract and the shared Depth picker on both PopDAM sheets. When a row becomes linked, resolve the exact writable DesignFlow item, check for an existing different Depth, and transfer through the audited item-write API. Clear staged Depth only after confirming the write. Handle retries without duplicate writes or a lost choice. Done when one disposable sandbox row on each sheet saves, reloads, links, transfers and shows the same Depth in DesignFlow. Cover a conflicting value and a failed transfer without altering the existing item.
4. Compare both pickers with the same company and division in the signed-in sandbox, including an existing inactive choice and excluded inactive new options. Record the running builds, selected fixtures, and side-by-side result on [#1273](https://github.com/u2giants/popdam3/issues/1273). Remove legacy writers and routes only after the planned parity checks. Keep the production DesignFlow migration in Uma’s separate project.

## 7. Constraints

Use current upstream and separate worktrees. Shared database structure goes through a claim and automatic promotion. DesignFlow consumer releases follow each repository’s current sandbox and merge rules. Production is read-only for verification. Keep all business fixtures disposable and in verified sandbox environments. Avoid a bulk item Depth backfill based on a label or numeric string.

## 8. Access

GitHub CLI authenticated for both repositories. Browser Microsoft SSO worked on the DesignFlow sandbox, and the PopDAM production session was signed in. Supabase read-only catalog queries used the existing 1Password `vibe_coding` Supabase CLI Personal Access Token without exposing its value. Use the current shared-db preview setting for target identity. No credential was created or changed.

## 9. Open risks and self-audit

Keep #1273 open for witnessed picker equality and successful carryover. The Generic sheet timeout and unresolved numeric Depth values need attention before claiming full acceptance. The approved business behavior and release scope are defined in §0. A successor can resume using the exact proof links and failures in §§3–5, the runtime acceptance in §6, and environment and authority details in §§7–8.
