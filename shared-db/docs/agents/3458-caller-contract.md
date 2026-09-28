# New caller contract — `public.refresh_style_guide_matviews` (issue #3458)

For popdam3 `supabase/functions/agent-api/index.ts` (`complete-style-guide-crawl`).

## Why

One RPC statement ran both `REFRESH MATERIALIZED VIEW CONCURRENTLY` calls plus
the search-document sync. On change nights that exceeds the unchanged 8s
authenticator statement ceiling (`canceling statement due to statement timeout`),
leaving the crawl in `lifecycle_state = reconciling`.

## What changed

A new overload. The legacy2-arg form is unchanged and still works.

```
public.refresh_style_guide_matviews(
  p_run_id uuid,
  p_search_batch_size integer,
  p_step text
) returns table (refreshed_at timestamptz, search_documents_synced integer)
```

`p_step` is required and must be one of:

| p_step | Does | Stamps `refresh_completed_at` |
|---|---|---|
| `file_groups` | `REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups` only | no |
| `folders` | `REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_folders` only | no |
| `search` | one bounded queue drain (`p_search_batch_size`, clamped 0..50000) + queue retire | yes, if batch > 0 |
| `all` | all three in one statement (convenience; can still exceed 8s on a heavy change night) | yes, if batch > 0 |

Any other value raises. `search_documents_synced` is 0 on matview steps and the
upserted count on `search` / `all`. A crawl run with `p_run_id` is stamped
`refreshing` on every step; only `search` / `all` stamp `refresh_completed_at`
and accumulate `search_documents_synced`.

## New caller sequence (change nights and normal nights)

```ts
// 1-2. matview aggregates, one statement each
await db.rpc('refresh_style_guide_matviews', {
  p_run_id: runId, p_search_batch_size: 5000, p_step: 'file_groups',
})
await db.rpc('refresh_style_guide_matviews', {
  p_run_id: runId, p_search_batch_size: 5000, p_step: 'folders',
})

// 3. search sync — loop while the batch is full (same loop you already have
//    on search_documents_synced)
let synced = 0
do {
  const [{ search_documents_synced }] = await db.rpc('refresh_style_guide_matviews', {
    p_run_id: runId, p_search_batch_size: 5000, p_step: 'search',
  })
  synced = search_documents_synced ?? 0
} while (synced >= 5000)
```

Stop looping when `search_documents_synced < p_search_batch_size` (the batch was
partial, so the queue is empty for this run). A `search` call with an empty queue
returns `search_documents_synced = 0` and still stamps `refresh_completed_at`.
A zero or negative batch skips sync, queue retirement, and the completion stamp.

## Caller footguns (read before wiring)

1. **One RPC call per statement — never wrap the steps in an explicit
   transaction.** Each step must be its own statement. `REFRESH MATERIALIZED
   VIEW CONCURRENTLY` is illegal inside a transaction block, so a `begin` that
   spans `file_groups` + `folders` + `search` fails at the first refresh. The
   RPC call itself is a single statement, which is what makes CONCURRENTLY legal.
2. **`refresh_completed_at` means "a search step ran", not "all files are
   synced".** With a positive batch, it is stamped on every `search` / `all`
   call, including a partial batch and an empty-queue call. Lifecycle completion is caller-gated (the
  `completed` transition's CHECK), so always drain the queue to
   `search_documents_synced < p_search_batch_size` before treating the run as
   finished.

## Compatibility

- `refresh_style_guide_matviews(p_run_id, p_search_batch_size)` — unchanged
  all-in-one path. Keep using it only where a single statement is known to fit
  (for example a no-change night retry). It can still time out on a change night.
- Grants unchanged: `service_role` only. Not callable from `authenticated` / `anon`.
- No statement timeout is raised anywhere.

## Acceptance (issue #3458)

A production crawl with more than 0 deactivations or new files reaches
`completed` once popdam3 issues the three steps above instead of one combined
call. Blocks u2giants/popdam3#107.
