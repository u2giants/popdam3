# Oracle Macro Understanding Backend Note — 2026-07-02

Status: documentation-only note for a backend change implemented in the Oracle app repo, not in this shared-db migration package.

## What Changed

The Oracle (`u2giants/theoracle`) added a macro-understanding layer on its own Supabase project (`eqccjfbyrywsqkxxpjvg`), including:

- source outline/source group tables and supporting refs
- macro relationship tables and review events
- source coverage findings
- `claims.claim_kind`, `claims.claim_kind_confidence`, and `claims.claim_kind_review_status`
- settings for automatic macro followups and budgeted document lens fan-out
- Trigger.dev workers for source outlines, document lens extraction, macro relationship extraction, coverage audit, and macro staleness repair

Durable implementation lives in the Oracle repo:

- `packages/db/migrations/sql/79_macro_understanding.sql`
- `packages/db/migrations/sql/80_macro_auto_followup_settings.sql`
- `packages/db/migrations/sql/81_macro_lens_fanout_settings.sql`
- `apps/workers/src/trigger/source-outline.ts`
- `apps/workers/src/trigger/document-lens-extraction.ts`
- `apps/workers/src/trigger/macro-relationship-extraction.ts`
- `apps/workers/src/trigger/source-coverage-audit.ts`
- `apps/workers/src/lib/document-lens-budget.ts`
- Oracle commits through `87a6cb3 feat(macro): ship document lens fan-out`

## Why

Oracle's document extraction was evidence-safe but context-myopic. The new layer lets Oracle understand whole-document workflow shape, handoffs, exception paths, policy/practice tension, and coverage gaps while preserving the quote-level provenance boundary: durable macro relationships cite approved atomic claim IDs, not raw outline prose.

## Apps Affected

Affected app: Oracle workers/web only.

Not affected: shared CRM, DAM, PM/PIM, Directus/PLM schemas in this `shared-db` repo. No shared-db Supabase migration was added because Oracle uses a separate Supabase project and the schema changes are owned by the Oracle repo.

## Verification

Verified in the Oracle repo/session:

- `corepack pnpm --filter @oracle/db migrate` applied `81_macro_lens_fanout_settings.sql`
- worker typecheck passed
- DB package typecheck passed
- macro validation smoke passed
- Trigger.dev production worker `20260702.6` deployed with 26 detected tasks
- GitHub PR check passed for `87a6cb3`

## Risks / Watchouts

- Existing Oracle documents are not broadly backfilled automatically; use admin/manual backfill or add a deliberate backfill job.
- `macro_outline_injection_enabled` remains a separate rollout flag from lens fan-out.
- Do not copy Oracle migrations into `shared-db/supabase/migrations`; this note is cross-repo awareness only, not schema ownership transfer.
