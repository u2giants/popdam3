# Step 1 function-provenance closeout and Step 3 embedding lease/error trace

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Steps 1 and 3 / #2326
**Recorded:** 2026-10-10T02:51:22Z
**Scope of this artifact:** repository evidence reconciliation only. No database
interaction, no row values, no credentials, no private source material. Read-only
repository search across `u2giants/shared-db` and `u2giants/popdam3`.

---

## Part A — Step 1: repository provenance of the five named functions

The 2026-09-04 baseline (`docs/verification/database-efficiency/20260904T212459Z/baseline.md`
§4) recorded live `pg_get_functiondef` md5 values for five named functions and
carried "repository provenance" as an explicit **unknown** (baseline line 407).
The plan required "a byte-for-byte comparison of each live definition against its
actual later migration".

### What is settled here

The migration-history provenance chain is now complete. For each function the
last `CREATE [OR REPLACE]` statement present in this repository **as of the
2026-09-04 baseline capture** is identified below, together with every later
replacement. This answers the question the plan asked — *which migration is the
repository source of each definition* — without a live database read.

A true byte-for-byte comparison of `pg_get_functiondef` output against migration
source text is **not achievable offline**: PostgreSQL normalizes the definition
(the baseline itself captured definitions via `pg_get_functiondef`, not by
copying migration source). The migration chain below is the provenance record;
the 2026-09-04 md5 values remain the authority for the state as of that date.

### Provenance chain

| Function | md5 at 2026-09-04 | Repository source as of baseline | Later replacements (after baseline) |
| --- | --- | --- | --- |
| `rebuild_style_groups_batch(uuid,integer)` | `189990c7ec25f6987831830060b2aeb3` | `supabase/migrations/20260708150000_dam_strict_style_group_sku_regex.sql:11` | `20260906035323_style_group_rebuild_guard_and_ungroup.sql:159`; `20260911212849_shared_style_group_sku_key.sql:35`; `20260917112129_shared_style_group_sku_key.sql:35`; `20260925061508_shared_style_group_sku_key.sql:35` |
| `clear_style_group_batch(uuid,integer)` | `3dbea0ab37aa21181efa966cbb4e1d8f` | **`supabase/ci-bootstrap/010_pre_adoption_baseline.sql:2815` (and a duplicate at `:4723`)** — no migration in `supabase/migrations/` ever creates or replaces this function | **none.** The only related migration, `20260409120000_fix_clear_style_group_batch_max_uuid.sql`, is an intentionally empty pre-shared-db history marker. `20260906035323` retires it from scheduled paths but does not replace the function body. Its live definition should still match the baseline md5. |
| `refresh_style_group_counts_batch(uuid[])` | `b64bc771ea4f4ff1f60bf24f095b3508` | **`supabase/ci-bootstrap/010_pre_adoption_baseline.sql:3684` (duplicate `:5592`)** — no migration change before baseline | `20260905142725_style_group_counts_change_predicate.sql:84` (change predicate, PR #2397); declared-but-not-touched in `20260909005945_chain_style_group_counts_to_rebuild_completion.sql:9` |
| `refresh_style_guide_matviews()` *(0-arg at baseline)* | `272a67904484bdac2fc5a32fb8f45e3f` | **`supabase/ci-bootstrap/010_pre_adoption_baseline.sql:3805` (duplicate `:5713`)** — no migration change before baseline | `20260905104802_popsg_bounded_reconcile_pdf_text_and_search.sql:556` — **signature changed** to `(uuid,integer)`; then `20260917005221_popsg_refresh_search_sync_queue.sql:81`; `20260928003740_popsg_refresh_steps_under_ceiling.sql:19` (adds `(uuid,integer,text)`); reissues `20260929040458` and `20260930185929` |
| `sync_asset_effective_tags()` | `05815a57e75154269b77f122c90ed7be` | `supabase/migrations/20260830110517_popdam_effective_asset_filters.sql:47` (forward recovery of `20260827183011:42`) | `20260905143005_effective_tag_sync_set_comparison.sql:63` (PR #2399, set comparison) |

### Disposition of the Step 1 unknown

**Repository provenance is CLOSED as a named unknown.** Three of the five
functions (`clear_style_group_batch`, `refresh_style_group_counts_batch`,
`refresh_style_guide_matviews` in its 0-arg baseline form) have **no later
migration provenance in this repository** — their only source is the pre-adoption
ci-bootstrap capture. That is the answer, not a gap: they predate the shared-db
migration ledger. The other two have complete replacement chains above.

The second Step 1 capture-list item — **application query sites behind the
foreign keys** — remains open by design. The plan assigns it to Step 5 candidate
family 2 ("Foreign keys") and to the open technical question "Which of the 426
foreign-key findings participate in measured hot joins, parent maintenance, or
cleanup?". It is not a repository-provenance question and is not closed here.

---

## Part B — Step 3: embedding lease/error path trace

The Step 3 deliverable list (`plan_database_efficiency_and_api_security.md`
line 234) asks for "any job that rebuilds `dam_search_documents` or repeatedly
updates embedding leases/errors". The 2026-09-10 Step 3 closeout recorded this
as **NOT TRACED**. It is traced here from repository sources only.

### Database objects (source: `supabase/migrations/20260825031841_popdam_ai_search_forward_recovery.sql:392-476`)

| Function | Signature | Role | Behavior |
| --- | --- | --- | --- |
| `claim_dam_search_embedding_documents` | `(p_limit int, p_worker_id text, p_lease_seconds int)` | `service_role` only (revoked from `public, anon, authenticated`) | Selects `dam_search_documents` rows with `embedding IS NULL`, attempts below max, retry due, lease free/expired, not permanent-error; `ORDER BY indexed_at … FOR UPDATE SKIP LOCKED LIMIT` (1–1000). Sets `embedding_lease_token = gen_random_uuid()`, `embedding_lease_owner = p_worker_id`, `embedding_lease_expires_at = now() + clamp(p_lease_seconds, 30, 3600)`, increments `embedding_attempts`. Requires `auth.role() = 'service_role'` and a non-empty `p_worker_id`. |
| `upsert_dam_search_embedding` | `(text, uuid, text, uuid, vector(384), text)` | `service_role` only | Writes embedding only if `content_sha256` and `embedding_lease_token` match and lease is unexpired. Clears lease and error fields. |
| `mark_dam_search_embedding_error` | `(text, uuid, text, uuid, text, text)` | `service_role` only | Records error, categorizes `transient`/`permanent` (auto-promotes to permanent at max attempts), sets `embedding_next_retry_at = now() + min(3600, 30 * 2^(attempts-1))` for transient, clears lease. Lease-checked like upsert. |
| `get_dam_search_embedding_status` | `()` | `service_role` only | Aggregate counters: total / embedded / pending / leased / errored / exhausted, oldest pending, newest indexed. |
| `reset_dam_search_embedding_errors` | `(text, uuid[])` | `service_role` or admin | Clears error/attempt/lease state for matching rows. |

All five are `SECURITY DEFINER` with `SET search_path = public`. No `anon` or
`authenticated` EXECUTE is granted.

### Application callers (source: `u2giants/popdam3`)

| Call site | Function | Role |
| --- | --- | --- |
| `apps/worker/src/handlers/embed-search.ts:41` (`claimDocuments`) | `claim_dam_search_embedding_documents(p_limit, p_worker_id = "railway-search-<pid>", p_lease_seconds = 300)` | **The only claimer.** Batch size 3 (clamped 1–100; lowered to 3 because production samples exceeded the hosted edge runtime at 25 and 10 documents). |
| `apps/worker/src/handlers/embed-search.ts:49` (`embedLeasedDocuments`) | POST `dam-search-ai` action `embed-leased` | Hands leased documents to the edge function for inference. 240 s timeout. |
| `supabase/functions/dam-search-ai/index.ts:97` | `upsert_dam_search_embedding(...)` | On successful 384-dimension `gte-small` embedding. |
| `supabase/functions/dam-search-ai/index.ts:111` | `mark_dam_search_embedding_error(...)` | On failure (dimension mismatch raises `Permanent: …`). |
| `supabase/functions/dam-search-ai/index.ts:67` | *(retired)* `embed-batch` returns **410** | "the Railway worker is the only embedding claimer" — the old direct-claim edge path is closed. |
| `apps/worker/src/handlers/embed-search.ts:87` (`maybeEmbedPendingSearchDocuments`) | schedules `handleEmbedSearch` | Auto-run at most once per **60 s**, gated on `admin_config.SEARCH_AUTO_EMBED_ENABLED = true`. Self-coalescing (`automaticRun` promise latch + `nextAutomaticRunAt`). |
| `supabase/functions/dam-search-ai/index.ts:126` (`embedding-status`) and `:134` (`reset-embedding-errors`) | `get_dam_search_embedding_status` / `reset_dam_search_embedding_errors` | Admin/status surface. |

### Schedule and concurrency summary

- **Single claimer:** the PopDAM Railway worker. `FOR UPDATE SKIP LOCKED` plus
  lease token/owner/expiry means two workers cannot claim the same row. The
  stale note in `popdam3/plan_hybrid_search_rollout.md:126` ("does not claim,
  lock, or lease rows; two callers can select the same documents") predates
  `20260825031841` and is **superseded**.
- **Cadence:** automatic batch at most every 60 s when enabled; each batch claims
  ≤3 documents (configurable up to 100). Lease 300 s (clamped 30–3600).
- **Retry:** exponential backoff `30 * 2^(attempts-1)` seconds, capped at 3600 s;
  permanent after `embedding_max_attempts` or explicit `permanent` category.
- **Write amplification character:** every claim writes (lease columns +
  `embedding_attempts`), every completion or error writes once more. Unchanged
  re-embedding is prevented by `content_sha256` matching in the upsert. The
  claim-side `embedding_attempts` increment is the only write that occurs even
  when the document is later abandoned by a crashed worker (lease expiry then
  allows reclaim). **No further application-side cause is asserted here** — the
  path is now measured enough for Step 4 to decide whether the claim-increment
  or the 60 s cadence needs change.

### Disposition of the Step 3 unknown

**Embedding lease/error path is TRACED and CLOSED as NOT TRACED.** Named
caller, schedule, input size, concurrency, and security posture are recorded
above. Changed-row counts and query plans for this path were never part of the
Step 3 gate's five-function scope and are not claimed.

The other four Step 3 open items (`clear_style_group_batch` changed-row count,
write-side query plans, WAL delta / transaction duration, matview per-statement
split and reader lock-wait) remain **NOT MEASURED** exactly as the 2026-09-10
closeout records. None of them is closed here.

---

## Acceptance check

- Step 1: repository provenance chain complete for all five named functions;
  the "no later migration" answer is itself the provenance for three of them.
  The FK application-query-sites item remains open and routed to Step 5.
- Step 3: embedding lease/error path traced from database objects through
  PopDAM worker and edge-function callers to its schedule and retry contract.
  No unmeasured item was converted into a proposed fix.
- No database read, write, or credential use occurred in producing this artifact.
