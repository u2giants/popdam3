---
summary: DesignFlow and PopDAM use one packaging-type list, core.packaging_type, with DesignFlow spellings kept for merged duplicates.
kind: decision
status: current
read-when: changing packaging types, the PopDAM Packaging Types settings tab, or DesignFlow Item Details packaging
---

# One packaging list for DesignFlow and PopDAM

**Decided by:** Albert (owner), 2026-11-22, on u2giants/popdam3#1273:
"we shouldn't have 2 packaging lists. we need to merge the 2 after reconciling the possible (fuzzy) duplicates. and then popdam should be using designflow's packaging list"

**Decision:** the one list is `core.packaging_type` in the shared database.
DesignFlow's 8 built-in Item Details values were merged into it on 2026-11-22
(25 active rows). Fuzzy duplicates kept DesignFlow's spelling: Cardboard Corner →
"Cardboard corners", Tray-Box → "Traybox" (old names in `metadata.aliases`). The
other 6 DesignFlow values were added. "PVC bag with J-card" stays separate from
"OPP BAG - J-CARD - PVC BAG FOR PUSHPINS" (pushpin-specific). DesignFlow reads the
list through backend `/findPackagingTypes`; single-schema DesignFlow production
uses a snapshot of the merged list until it moves to the shared database.

**Rejected:** keeping a second, hard-coded DesignFlow list.
