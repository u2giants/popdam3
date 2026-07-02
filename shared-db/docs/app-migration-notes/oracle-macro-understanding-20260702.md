# Oracle Macro Understanding Backend Note — 2026-07-02

Status: documentation-only note for a backend change implemented in the Oracle app repo, not in this shared-db migration package.

## What Changed

The Oracle (`u2giants/theoracle`) added a macro-understanding layer on its own Supabase project (`eqccjfbyrywsqkxxpjvg`), including:

- source outline/source group tables and supporting refs
- macro relationship tables and review events
- source coverage findings
- `claims.claim_kind`, `claims.claim_kind_confidence`, and `claims.claim_kind_review_status`
- settings for automatic macro followups and budgeted document lens fan-out
- settings for macro/lens validation tuning:
  `macro_relationship_near_duplicate_distance`,
  `macro_lens_dedup_distance`,
  `macro_lens_dedup_density_threshold_per_10k`, and
  `macro_entity_validation_extra_stopwords`
- Trigger.dev workers for source outlines, document lens extraction, macro relationship extraction, coverage audit, and macro staleness repair
- a Drizzle generated snapshot reconciliation (`0008_sour_agent_brand.sql` +
  `meta/0008_snapshot.json`) so future Oracle `drizzle-kit generate` runs do
  not try to recreate the macro tables already materialized by hand SQL
- macro relationship dedup now treats reviewer-rejected relationships as
  semantic "do not re-propose" memory
- Oracle claim content approval no longer implies `claim_kind` was reviewed;
  reviewers must explicitly confirm the kind or revise the label
- broad document ingestion and document lens extraction now share the same
  document claim auto-approval helper

Durable implementation lives in the Oracle repo:

- `packages/db/migrations/0008_sour_agent_brand.sql`
- `packages/db/migrations/meta/0008_snapshot.json`
- `packages/db/migrations/sql/79_macro_understanding.sql`
- `packages/db/migrations/sql/80_macro_auto_followup_settings.sql`
- `packages/db/migrations/sql/81_macro_lens_fanout_settings.sql`
- `packages/db/migrations/sql/82_macro_validation_tuning_settings.sql`
- `apps/workers/src/trigger/source-outline.ts`
- `apps/workers/src/trigger/document-lens-extraction.ts`
- `apps/workers/src/trigger/macro-relationship-extraction.ts`
- `apps/workers/src/trigger/source-coverage-audit.ts`
- `apps/workers/src/lib/document-claim-auto-approval.ts`
- `apps/workers/src/lib/document-lens-budget.ts`
- Oracle commits through `9b60aa1 fix(macro): harden validation and review gates`

## Why

Oracle's document extraction was evidence-safe but context-myopic. The new layer lets Oracle understand whole-document workflow shape, handoffs, exception paths, policy/practice tension, and coverage gaps while preserving the quote-level provenance boundary: durable macro relationships cite approved atomic claim IDs, not raw outline prose.

## Apps Affected

Affected app: Oracle workers/web only.

Not affected: shared CRM, DAM, PM/PIM, Directus/PLM schemas in this `shared-db` repo. No shared-db Supabase migration was added because Oracle uses a separate Supabase project and the schema changes are owned by the Oracle repo.

## Verification

Verified in the Oracle repo/session:

- `corepack pnpm --filter @oracle/db migrate` applied `81_macro_lens_fanout_settings.sql`
- `corepack pnpm --filter @oracle/db migrate` registered generated no-op
  migration `0008_sour_agent_brand.sql` and applied
  `82_macro_validation_tuning_settings.sql`
- worker typecheck passed
- web typecheck and production build passed
- engines typecheck passed
- macro validation smoke passed
- R5 quote/promotion smoke and R5.5 taxonomy smoke passed
- Trigger.dev production worker `20260702.7` deployed with 26 detected tasks
- Vercel production deployment `dpl_F5RUekrUYUePtCTRtZFApieQPPjd` was READY
  and aliased to `https://oracle.designflow.app`
- Git push landed Oracle commit `9b60aa1` on `u2giants/theoracle main`

## Risks / Watchouts

- Existing Oracle documents are not broadly backfilled automatically; use admin/manual backfill or add a deliberate backfill job.
- `macro_outline_injection_enabled` remains a separate rollout flag from lens fan-out.
- Oracle local `db:check-drift` still reports the known pre-existing generated
  `0007_tricky_charles_xavier.sql` hash mismatch documented in the Oracle
  repo's `AGENTS.md`; this is separate from the new `0008` snapshot
  reconciliation, which was registered through the package migrator.
- Do not copy Oracle migrations into `shared-db/supabase/migrations`; this note is cross-repo awareness only, not schema ownership transfer.
