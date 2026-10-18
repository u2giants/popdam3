# jwt-packaging: #4430 exact manifest

2 baseline identities on 1 tables. Every expression fingerprint matches the prior baseline. Disposition: eligible for qualification; none already repaired, removed, or silently added. This is not write authority.

Before authoring, claim every table below and every exact quoted policy on it, plus declared helper read dependencies. ALTER POLICY emits both table and policy identities. No claim was acquired for this preparation.

## Exact table coverage

- `table core.packaging_type`

## Per-policy before-test specification

For every identity, preserve OID, command, roles, permissive flag, USING, explicit/implicit WITH CHECK, grants, RLS flags, helper OID and the full applicable policy union. Record result row identities privately or as stable synthetic labels, and exact SQLSTATE. Fixtures belong only to a separately leased preview/local rollback transaction.

Test app-role table grants and JWT role union separately, revoked DB role still allowed by existing JWT branch, manager email exact/mixed/missing/empty/nonallowlisted, profile active/inactive/absent, malformed JWT and short-circuit errors. Preserve distinct app enums and email-exception literal. app.current_profile_id, app.has_role, app.has_any_role and app.jwt_role_names are transitive dependencies, not public.has_role overloads. No helper bodies or grants change.

| Table | Exact policy | Command | Roles | Fingerprint |
|---|---|---|---|---|
| core.packaging_type | shared_read | SELECT | authenticated | 45d24670c2b7fafaa8ca260a815d6816 |
| core.packaging_type | admin_or_packaging_manager_write | ALL | authenticated | a556e6008929e6a569439150eae95676 |

## Performance and final acceptance

Preview/local tests: one, 100 and 10,000 synthetic rows, warmup followed by ten alternating original/candidate measurements; same non-bypass role, request context, plans, result sets and buffer settings. Record median and p95 in milliseconds. Actual production reads are bounded and read-only; production writes use only the owning application approved disposable-data route. No production fixture SQL or write EXPLAIN ANALYZE. A repeated >10% regression must be investigated. Do not close this child without live equal-access/performance/consumer proof.
