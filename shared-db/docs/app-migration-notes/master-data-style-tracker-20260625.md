# Master Data Style Tracker PLM Candidate Search — 2026-06-25

This note records the shared-db contract used by the temporary Master Data style tracker in `u2giants/popdam3`.

## Contract

The PopDAM Master Data page calls:

```sql
public.search_style_tracker_link_candidates(
  p_field_key text,
  p_query text,
  p_limit integer,
  p_match_mode text
)
```

The return shape is kept stable for the existing frontend:

```text
target_schema text
target_table text
target_id uuid
target_label text
score real
```

## PLM Canonical Rule

Customer, licensor, and property candidates must come from PLM-backed canonical identities:

- customers: `core.customer` joined through `core.company_source_ref` with `source_system = 'designflow_plm'` and `source_table = 'customers'`
- licensors/properties: `core.licensor` / `core.property` joined through `core.taxonomy_source_ref` with `source_system = 'designflow_plm'` and `source_table = 'merchGroup'`

This prevents noisy non-PLM imports from appearing as canonical Master Data matches.

## Browser Boundary

The browser should continue using the RPC. It must not call the Designflow PLM APIs directly and must not receive the PLM API key. If the frontend needs a broader direct-read contract later, add an `api.*` view or RPC here first.
