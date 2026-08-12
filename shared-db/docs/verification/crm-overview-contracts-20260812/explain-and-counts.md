# EXPLAIN + count-comparison evidence — CRM overview contracts (Phase 7A)

The first capture below records the baseline plans. After the exact-parity
correction applied in run `31641099199`, a fresh read-only runtime check proved
the corrected output bounds: email total 500, volume rows 12, recent unrouted
rows 6, and pending approvals 0 on the current preview fixture. CI also ran the
complete SQL guard and offline suites at the exact correction commit. The
correction adds no index or write path.

Source: `preview-verify-raw.txt` (full capture). All queries ran read-only against
preview `rjyboqwcdzcocqgmsyel` on the pinned CLI 2.105.0 / Postgres 17, with
`EXPLAIN (ANALYZE, BUFFERS)`. **No new indexes were added** — every plan was fast
on existing indexes, so the §"add indexes only if evidence requires" bar is not
met.

## 1. Count comparison: direct fixture vs RPC (CRM user) — ALL MATCH

Computed the "truth" directly against the tables, then called each RPC as a CRM
user (authenticated role + `request.jwt.claims`). Every value matched.

| Value | direct | rpc | match |
|---|---:|---:|---|
| customers | 66 | 66 | ✓ |
| contacts | 271 | 271 | ✓ |
| open_opportunities | 0 | 0 | ✓ |
| meetings | 27 | 27 | ✓ |
| open_tasks | 0 | 0 | ✓ |
| pending_approvals | 0 | 0 | ✓ |
| email.total | 13729 | 13729 | ✓ |
| email.needs_routing | 9729 | 9729 | ✓ |
| email.routed | 0 | 0 | ✓ |

**Bucket audit:** `routed + skipped + company_only + company_dept + unrouted +
no_company + other = 13729 = total` ✓ (the routing-status partition is exact and
auditable). Pipeline stages: all 8 known stages matched (preview has 0
opportunities in known stages; comparison still valid).

Bounded panels: `recent_unrouted` 6 rows `[id,subject,sender,routing_status]`,
`recent_meetings` 6 rows `[id,name,company_id,company_name,date]`,
`pending_approvals` 0 rows, `email_volume` 12 rows. All ≤ their caps; only
rendered columns returned.

## 2. EXPLAIN (ANALYZE, BUFFERS) — representative queries

### contacts count (lateral primary-company) — 37.6 ms
Index-backed nested loop over `contact` pkey, `contact_company(contact_id,…)` and
`customer` pkey. 8655 contacts → 271 matched. Existing
`core_contact_company_contact_primary_idx` is used. **No new index.**

```
Aggregate (actual time=37.523..37.525 rows=1)  Buffers: shared hit=20363
  Nested Loop (actual time=0.197..37.474 rows=271)
    Index Only Scan using contact_pkey on contact ct (rows=8655)
    Subquery Scan on cc  Filter: cc.s = ANY('{ACTIVE_CUSTOMER,POTENTIAL_CUSTOMER}')
      Limit -> Sort -> Nested Loop
        Index Scan using contact_company_contact_id_... on contact_company x (contact_id=ct.id)
        Index Scan using company_pkey on customer comp (id=x.company_id)
Execution Time: 37.571 ms
```

### email counts (single pass, 7 filters) — 6.0 ms
**Index Only Scan** on `crm_email_message_routing_status_idx` — all seven
`count(*) filter (...)` buckets computed in one pass. **No new index.**

```
Aggregate (actual time=5.943..5.944 rows=1)  Buffers: shared hit=810
  Index Only Scan using crm_email_message_routing_status_idx on email_message (rows=13729)
Execution Time: 5.969 ms
```

### email volume 12-week (range + group) — 5.3 ms
Per-week **Index Scan** on `crm_email_message_received_at_idx` (≈279 rows/week ×
12). Bounded range scan; no full table touch. **No new index.**

```
Sort (actual time=5.207..5.210 rows=12)
  HashAggregate (rows=12)
    Nested Loop Left Join (rows=3347)
      Function Scan on generate_series gs (rows=12)
      Index Scan using crm_email_message_received_at_idx on email_message e
        Index Cond: received_at >= gs.gs AND received_at < gs.gs + '7 days'
Execution Time: 5.260 ms
```

### recent_unrouted top-6 — 13.4 ms
Seq scan + **top-N heapsort** (the `not in (ROUTED,SKIPPED)` predicate is
non-indexable, but the qualifying set is small and the top-N sort is cheap).
Fast. **No new index.**

```
Limit (actual time=13.347..13.350 rows=6)
  Sort Sort Method: top-N heapsort
    Seq Scan on email_message (rows=9729)  Filter: NULLIF(routing_status,'') IS NOT NULL AND routing_status <> ALL('{ROUTED,SKIPPED}')
Execution Time: 13.378 ms
```

### pending_approvals (regex filter) — 0.04 ms
Tiny table (170 est / 0 actual rows). Seq scan. **No new index.**

```
Limit (actual time=0.012..0.013 rows=0)
  Sort -> Hash Left Join -> Seq Scan on licensor_approval_thread a
    Filter: COALESCE(stage,'') !~* '(approv|reject|declin|denied|complete|closed|signed)'
Execution Time: 0.044 ms
```

## 3. Conclusion — indexes

All five representative plans execute in **≤ 38 ms** using only existing indexes
(`contact_pkey`, `core_contact_company_contact_primary_idx`, `company_pkey`,
`crm_email_message_routing_status_idx`, `crm_email_message_received_at_idx`).
Per the task's "add indexes only if evidence requires," **zero indexes are
added**: the migration is purely seven additive `CREATE OR REPLACE FUNCTION`
contracts.
