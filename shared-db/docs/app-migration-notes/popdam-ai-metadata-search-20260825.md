# PopDAM Scoped AI Metadata + Deterministic Search — 2026-08-25

Canonical database migration: `20260825010603_popdam_scoped_ai_metadata_search.sql`.
Tracked by [shared-db #1427](https://github.com/u2giants/shared-db/issues/1427),
[PopDAM #96](https://github.com/u2giants/popdam3/issues/96), and
[PopDAM #97](https://github.com/u2giants/popdam3/issues/97).

## Contract

- Product/artwork AI facts live on `style_groups` and `style_group_tags`; file-specific visual facts live in `asset_tags`.
- Manual rows and rejected tombstones are retained. AI replacement RPCs may replace only rows owned by the same source/model and cannot overwrite a manual or differently sourced row.
- `assets.tags` remains a compatibility array of active asset-level tags only. Group tags, candidates, and rejections never enter it.
- `get_effective_asset_metadata` reads both scopes without copying group rows or identity onto member assets. Current Style Group licensor/property wins for grouped assets; asset identity is used only while ungrouped.
- Search documents deterministically include active tags and canonical character names. Changes refresh only directly affected asset/group documents through a bounded, deduplicated contract.
- Embedding work uses expiring exclusive leases, content-hash and lease-token checked writes, bounded categorized retries, and an admin/service reset. No embedding backfill is part of this migration.
- Legacy tag normalization disables the obsolete per-row compatibility trigger first, normalizes at most 5,000 tag rows per statement, then rebuilds compatibility arrays in 2,000-asset keyset batches. This preserves the reconciliation while keeping every write below the production statement-timeout boundary.

## Release order and gates

1. Apply the migration and run `supabase/tests/popdam_scoped_ai_metadata_search_contracts.sql` in preview with rollback.
2. Promote the final corpus definition through the shared-db orchestrator gates.
3. Only after production object/ledger proof may PopDAM ship compatible application code.
4. PopDAM may run one separate application-owned embedding backfill only after its approval gate. Never backfill an intermediate corpus definition.

`propagate_group_tags_batch` is intentionally unchanged. Existing applications must update to the new lease-token embedding RPC signatures before enabling the new worker path.
