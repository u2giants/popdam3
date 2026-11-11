---
summary: DAM search_dam_documents change (#5730) deduplicating identical parsed FTS queries; source prepared, production and viewer proof still open.
kind: spec
status: open
read-when: verifying or promoting the DAM identical FTS query dedup migration
---

# DAM identical parsed FTS query dedup (#5730)

Source preparation; production and ordinary-viewer proof remain open. Application acceptance remains on PopDAM #725/#680/#706.

Migration20261106042721 changes only `array(select q.tsq from queries q)` to `array(select distinct q.tsq from queries q)` in the existing eight-argument `public.search_dam_documents` reader. Original raw expansions, rank-query variants, substring and semantic legs, visibility, totals/facets, permissions, owner, settings, and wire contract are unchanged. Guards bind the original body MD5 `5ad9960f79ef20074b0f93e2b589caf2` and exact owner/ACL/settings plus the captured input arguments/defaults and return contract; installed body MD5 is `1bede30349edd91071a493a6d5ff1203`.

Real PG17 warmed alternating-order tests show duplicated identical tsqueries scan20 GIN entries/6buffer hits, versus10/3 after dedup, with zero reads in both paths. Full actual-function output parity tests retain ranks, totals, facets, deleted-asset visibility, pagination, asset/group/mixed/unknown scopes, NULL/non-NULL vectors, and authenticated/service roles. Anonymous and denied access remain denied. A real default-only drift with the original body is refused atomically and its metadata preimage survives.

This proves redundant work is removed. It does not establish that the observed native30-second filename search timeout is fixed. The actual filename request reaches the downstream search RPC; a bounded expansion+FTS diagnostic timed out at1000ms. Resolved variants have one distinct tsquery, without generic ART/AI broadening. Native latency, other search legs, and full scored acceptance remain pending.

Delivery uses the exact atomic allowlist entry for both targets, retaining500ms lock/2500ms statement/3s transaction DDL budgets and a single SQL-plus-ledger transaction. No production command, timeout increase, result shortcut, provider retry loop, or tagging control is authorized by this change.
