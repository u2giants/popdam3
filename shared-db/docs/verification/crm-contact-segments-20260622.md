# CRM Contact Segments Verification

Date: 2026-06-22

Migration: `supabase/migrations/20260622043000_crm_contact_segments.sql`

## Purpose

`popcrm-web` needs the Contacts page to feel live without fetching every contact
on first render. The database now exposes CRM-owned segments so the frontend can
load `Cust Contacts`, `Dept Contacts`, and `Triage` independently, while loading
`All` only after a user opens that tab.

## New API Objects

| Object | Contract |
|---|---|
| `api.crm_contact_list` | Existing CRM contact columns, now explicitly gated by `app.has_app_access('crm')`. |
| `api.crm_contact_segment_list` | Same columns as `api.crm_contact_list` plus `crm_segment`. |
| `api.crm_contact_segment_counts` | One count row each for `customer`, `department`, `triage`, and `all`. |

## Segment Definitions

| Segment | Definition |
|---|---|
| `customer` | Primary relationship account is `ACTIVE_CUSTOMER` or `POTENTIAL_CUSTOMER`, and no CRM department is set. |
| `department` | Primary relationship account is `ACTIVE_CUSTOMER` or `POTENTIAL_CUSTOMER`, and a CRM department is set. |
| `triage` | No customer account, untriaged account, reviewed non-customer account, or no primary company relationship. |

These definitions are part of the shared API contract. Do not change them in
place for another app; add a separate documented API view if another consumer
needs different classification.

## Preview SQL Checks

Run as an authenticated CRM-access user where possible, not only as service role.
The browser contract depends on both `app.profile.auth_user_id` and
`app.app_access`.

```sql
select table_schema, table_name
from information_schema.views
where table_schema = 'api'
  and table_name in (
    'crm_contact_list',
    'crm_contact_segment_list',
    'crm_contact_segment_counts'
  )
order by table_name;
```

Expected: three rows.

```sql
select
  (select count(*) from api.crm_contact_list) as base_count,
  (select count(*) from api.crm_contact_segment_list) as segmented_count;
```

Expected: counts match.

```sql
select sum(contact_count) filter (where crm_segment <> 'all') as segmented_total,
       max(contact_count) filter (where crm_segment = 'all') as all_total
from api.crm_contact_segment_counts;
```

Expected: totals match.

```sql
select crm_segment, contact_count
from api.crm_contact_segment_counts
order by crm_segment;
```

Expected: the CRM Contacts tab badges match these values after the frontend
switches to the segmented API.

## REST Checks

After `notify pgrst, 'reload schema'`, test with a normal authenticated CRM
session:

- `GET /rest/v1/crm_contact_segment_counts?select=*`
- `GET /rest/v1/crm_contact_segment_list?select=*&crm_segment=eq.customer&limit=50`
- `GET /rest/v1/crm_contact_segment_list?select=*&crm_segment=eq.department&limit=50`
- `GET /rest/v1/crm_contact_segment_list?select=*&crm_segment=eq.triage&limit=50`

Expected: no request requires service-role credentials, and each segmented list
returns only its requested segment.

## Frontend Rollout Notes

The frontend should:

- Fetch counts from `api.crm_contact_segment_counts`.
- Fetch `customer`, `department`, and `triage` from
  `api.crm_contact_segment_list` with an equality filter.
- Fetch `all` from `api.crm_contact_segment_list` only when the All tab is opened.
- Keep client-side table search/sort within the loaded slice.
- Avoid server-side ordering on derived fields such as contact `name`.
- Refetch the relevant view after realtime table events; do not patch the row
  from the realtime payload.

## Rollback / Compatibility

`api.crm_contact_list` keeps the same columns as before, so old clients continue
to work. If the segmented views need to be rolled back, the app can temporarily
fall back to `api.crm_contact_list` and client-side segmentation, but that should
be treated as degraded behavior because it reintroduces the full-contact fetch.
