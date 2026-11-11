---
summary: Issue 5683 retirement of failed preview version 20261105142616 in the native classifier after atomic rollback, with SQL hash preserved.
kind: proof
status: done
read-when: understanding why migration 20261105142616 was retired after its preview failure
---

# Issue5683: immutable failed preview retirement

Source5686 merged as c266d0145cec1618dbd26b2f3b4a9f1a840e4ea2. Native preview42060060160 refused the full source-witness guard and atomically rolled back. Actual bounded reads confirmed version20261105142616 absent from both ledgers. No production promotion followed.

Both parents are byte-equivalent full rows in UTC on both targets. Each target has the same four ColdLion business source identities and complete business/raw content; only source-row UUIDs and their created/first-seen/last-seen timestamps differ. The production-specific complete witness therefore cannot qualify preview. No witness field may be discarded, guard weakened or seed row written to conceal this difference.

This nonmigration change retires only20261105142616 in the existing native classifier and hard-blocks its explicit allowlist route on both targets, regardless of ledger presence. It preserves SQL SHA256 faa341b2e472907f1e31275068b4c258272f6e0df782401cfaaec000faeb9059, reservation, history, source receipts and failed preview. It creates no successor SQL, sidecar, policy or execution authority. Reserved20261105160717 is a separate future target-bound proposal, not a live repair.

The same governed record5683 remains open for catalog proof; application relinking and all five authenticated examples remain on PopDAM680. The prior8-assets/11-links phase is unchanged; no further application repair is released.
