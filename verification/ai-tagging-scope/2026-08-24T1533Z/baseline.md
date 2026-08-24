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

Queries set read-only mode and a bounded timeout, then ran exact `count(*)` aggregates over:

```sql
public.assets WHERE is_deleted = false;
public.assets WHERE is_deleted = false AND thumbnail_url IS NOT NULL;
public.assets WHERE is_deleted = false AND ai_tagged_at IS NULL;
public.style_groups;
public.style_groups grouped into asset_count buckets 1, 2–5, 6–20, and 21+;
public.asset_tags WHERE source IN ('ai', 'manual');
public.asset_tags JOIN public.assets for the bounded sibling phrase measure described above;
```

An initial combined 8-second query timed out during the untagged count after safely returning the first two aggregates. The remaining exact reads were rerun with a bounded 60-second statement timeout and completed. No partial result is used for any count above.

## Synthetic characterization fixtures

- Fixture: `apps/worker/src/fixtures/ai-tagging-scope/groups.json`.
- Test: `apps/worker/src/handlers/ai-tagging-scope.test.ts`.
- Coverage: tech pack + product photograph + mockup; source art + product render; and two character/color variants.
- All UUIDs, names, descriptions, and metadata are synthetic. There are no image URLs or licensed inputs.
- Characterization records that today’s contract accepts shared product/property terms and file-specific image/view/color terms in the same flat array, and that the `(asset_id, tag)` upsert key cannot represent manual and AI provenance simultaneously.

## Verification

```text
cd /worksp/popdam/apps/worker
npm test     # 66 passed, 0 failed
npm run build # passed
```
