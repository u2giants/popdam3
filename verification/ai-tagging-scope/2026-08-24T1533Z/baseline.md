# Scoped AI metadata baseline — 2026-08-24T1533Z

This is aggregate-only evidence for plan Step 1. It contains no licensed filenames, artwork, extracted text, credentials, or production row identifiers.

## Target and repository proof

- Database target: production shared Supabase project `qsllyeztdwjgirsysgai`.
- The read used the canonical pooler documented in `/worksp/shared-db/AGENTS.md`, with the password injected from 1Password through a protected `op://` environment reference.
- Every SQL session set `default_transaction_read_only=on`; no database write occurred.
- PopDAM branch: `main`.
- PopDAM `HEAD` and `origin/main` at the first baseline read: `ae029a53ade761d7d989fd6f188eb8631915019a`. Before landing, the checkout safely fast-forwarded over non-overlapping shared-db sync commit `993c099af9c881e4316161a38cc8b0ffae7939e2`.
- Existing untracked `.ai/` reviewer artifacts were preserved and excluded from this work.
- The ordinary `/worksp/shared-db` checkout was clean but stale at `0a5bf041`; `origin/main` was `9c3f79c`. No schema work was authored there. Active orchestrator marker: shared-db issue #1419.

## Aggregate counts

| Measure | Count |
|---|---:|
| Non-deleted assets | 127,733 |
| Thumbnail-backed non-deleted assets | 126,860 |
| Non-deleted assets with `ai_tagged_at IS NULL` | 37,323 |
| Style Groups | 10,776 |
| Groups with 0 assets | 2 (derived from the original total and non-zero buckets; not directly queried in the original session) |
| Groups with 1 asset | 544 |
| Groups with 2–5 assets | 3,717 |
| Groups with 6–20 assets | 5,973 |
| Groups with 21+ assets | 540 |
| AI tag rows | 2,173,558 |
| Manual tag rows | 0 |
| Known file-specific phrase/group pairs present on more than one sibling | 551 |

The final measure counts `(style_group_id, normalized controlled phrase)` pairs where the phrase occurs on more than one distinct non-deleted member. The bounded phrase set was: professional photography, straight view, 3/4 view, close-up view, lifestyle / in-use image, person holding item / size scale image, embellishment placement design, tech pack, mockup, front view, back view, and side view.

## Exact read pattern

The sessions used this protected connection pattern, with no plaintext secret in the command or output:

```bash
op run --env-file /tmp/popdam-baseline.env -- psql \
  "host=aws-1-us-east-1.pooler.supabase.com port=6543 dbname=postgres user=postgres.qsllyeztdwjgirsysgai sslmode=require" \
  -v ON_ERROR_STOP=1 -At -F '|'
```

The exact executable SQL, including the full 551-pair join, normalization, source behavior, and group buckets, is stored beside this file as `baseline.sql`. The original run omitted the zero-size bucket query; its two-row value is an arithmetic residual, explicitly labeled rather than presented as a directly observed historical count.

An initial combined 8-second query timed out during the untagged count after safely returning the first two aggregates. The remaining exact reads were rerun with a bounded 60-second statement timeout and completed. No partial result is used for any count above.

Grok correctly identified that the original artifact did not measure manual values present only in the compatibility `assets.tags` array. That historical pre-normalization count cannot be reconstructed after #1427's production reconciliation. A read-only post-reconciliation check on 2026-08-25 returned `assets_with_manual_only_compatibility_values = 0` against target `qsllyeztdwjgirsysgai`; this proves the current repair state, not the missing historical baseline.

## Synthetic characterization fixtures

- Fixture: `apps/worker/src/fixtures/ai-tagging-scope/groups.json`.
- Test: `apps/worker/src/handlers/ai-tagging-scope.test.ts`.
- Coverage: tech pack + product photograph + mockup; source art + product render; and two character/color variants.
- All UUIDs, names, descriptions, and metadata are synthetic. There are no image URLs or licensed inputs.
- The initial characterization recorded the flat contract and collision risk. Grok found the collision assertion tautological. The Step 3 inversion now rejects the legacy flat shape and exercises the real production writer helper, proving it calls `replace_asset_ai_tag_result` with typed asset-only rows rather than directly deleting/upserting `asset_tags`.

## Verification

```text
cd /worksp/popdam/apps/worker
npm test     # 66 passed, 0 failed
npm run build # passed
```
