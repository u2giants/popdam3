# app-access: #4429 exact manifest

4 baseline identities on 4 tables. Every expression fingerprint matches the prior baseline. Disposition: eligible for qualification; none already repaired, removed, or silently added. This is not write authority.

Before authoring, claim every table below and every exact quoted policy on it, plus declared helper read dependencies. ALTER POLICY emits both table and policy identities. No claim was acquired for this preparation.

## Exact table coverage

- `table public.style_guide_file_tags`
- `table public.style_guide_tag_aliases`
- `table public.style_guide_tagging_state`
- `table public.style_guide_tags`

## Per-policy before-test specification

For every identity, preserve OID, command, roles, permissive flag, USING, explicit/implicit WITH CHECK, grants, RLS flags, helper OID and the full applicable policy union. Record result row identities privately or as stable synthetic labels, and exact SQLSTATE. Fixtures belong only to a separately leased preview/local rollback transaction.

For every SELECT below, compare existing styleguides grant present/absent/revoked, unrelated app grant, admin alternate policy, missing/invalid identity and repeated prepared calls. Capture direct table and real consumer RPC/view read routes separately: SECURITY DEFINER worker routes can bypass these policies. Wrap the complete stable named-argument helper only after dependency and privilege equivalence.

| Table | Exact policy | Command | Roles | Fingerprint |
|---|---|---|---|---|
| public.style_guide_tags | style_guide_tags_read | SELECT | authenticated | de14c144b20a57fee5fdc64715b8fbe8 |
| public.style_guide_tag_aliases | style_guide_tag_aliases_read | SELECT | authenticated | de14c144b20a57fee5fdc64715b8fbe8 |
| public.style_guide_file_tags | style_guide_file_tags_read | SELECT | authenticated | de14c144b20a57fee5fdc64715b8fbe8 |
| public.style_guide_tagging_state | style_guide_tagging_state_read | SELECT | authenticated | de14c144b20a57fee5fdc64715b8fbe8 |

## Performance and final acceptance

Preview/local tests: one, 100 and 10,000 synthetic rows, warmup followed by ten alternating original/candidate measurements; same non-bypass role, request context, plans, result sets and buffer settings. Record median and p95 in milliseconds. Actual production reads are bounded and read-only; production writes use only the owning application approved disposable-data route. No production fixture SQL or write EXPLAIN ANALYZE. A repeated >10% regression must be investigated. Do not close this child without live equal-access/performance/consumer proof.
