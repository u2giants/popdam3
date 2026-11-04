# Plan: Review finding: u2giants/popdam3#662 feat(image-embed-worker): durable search-document embed lane (#646 cure d) (u2giants/popdam3#663)
Issue: https://github.com/u2giants/popdam3/issues/663
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Parent plan for the whole image-similarity / GPU-poller feature: [`plan_image_similarity_upload_search.md`](../../plan_image_similarity_upload_search.md) (read its STATUS first; it is complete through Step 7 and this plan does not restate it). The search-document lane itself was issue #646 (closed) and PR #662 (merged as `2043c55d`).

**Drift note (Nov 4, 2026, 5:00 PM EST):** PR #728 merged to `main` at 4:48 PM EST as `1ce8f675` (`apps/image-embed-worker/image_embed_poller.py`: missing thumbnail is now transient; tests in `tests/test_image_embed_poller.py`). Finding 2's worker side is landed; the stranded-row recovery, the migration-side marker behaviour and finding 3 remain. Re-verify line numbers against `1ce8f675`.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 0. Confirm finding 1 (grants) is landed in production | ⬜ open | — (expected: migration `20261102202014` present in `supabase_migrations.schema_migrations`; verified by the planner on 2026-11-04 via a read-only query, re-verify) |
| 1. shared-db: refresh functions clear embed-error markers when a document's thumbnail changes, plus one-time reset of the stranded rows | ⬜ open | — |
| 2. Poller: missing thumbnail is `transient`, never `permanent` | ⬜ open | — |
| 3. Poller tests (rename + new cases) and README wording | ⬜ open | — |
| 4. Finding 3: a real-contract test for the RPC call shapes | ⬜ open | — |
| 5. Deploy poller to edge-dev, drain, live proof | ⬜ open | — |
| 6. Close #663 with evidence; `- [ ] live proof` ticked on #663 | ⬜ open | — |

**Where a fresh session starts:** Step 0, then Step 1 in `/worksp/shared-db` (claim-first). Steps 2–4 can run in parallel with Step 1 in this repo.

---

## 1. The ultimate goal

Every artwork and every style group in PopDAM should be findable by semantic ("meaning") search as soon as it has a thumbnail. Today about 1,100 documents are silently and permanently excluded from semantic search because the search-embedding worker looked at them *before* their thumbnail existed and stamped them "permanent failure". About 400 of them now have thumbnails and still cannot be searched. When this plan is done: (a) a document seen without a thumbnail is retried later rather than written off, (b) the moment a thumbnail arrives the document becomes eligible again automatically, and (c) the ~400 already-stranded documents are embedded and searchable.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch policy: feature branch → PR → `main`) is POP Creations' internal digital-asset manager for licensed consumer-product art. Semantic search over assets and style groups is served from `public.dam_search_documents` (one row per asset or style group) whose `embedding` column is a SigLIP2 image vector computed from the document's thumbnail. Vectors are produced by the GPU poller `apps/image-embed-worker/image_embed_poller.py` which runs on the Windows GPU box `edge-dev` (Task Scheduler task `PopDAM-ImageEmbedWorker`, install runbook in `apps/image-embed-worker/README.md`) and connects to the shared Supabase Postgres (project `qsllyeztdwjgirsysgai`, Virginia) as the DB login `dam_image_embed_login` (member of NOLOGIN role `dam_image_embed_worker`). The database schema is owned by the separate repo `popcre/shared-db` (canonical checkout `/worksp/shared-db`); this repo only vendors a read-only mirror under `shared-db/`.

Frontend: https://dam.designflow.app. Settings → Search Index card (`src/components/settings/SearchIndexCard.tsx`) shows embedding status via the edge function `supabase/functions/dam-search-ai/index.ts` (`embedding-status`, `reset-embedding-errors` actions).

## 3. What triggered this work

An advisory AI review (DeepSeek) of merged PR #662 filed three findings on #663:

1. **Blocker — grants.** The lane's three RPCs were granted only to `service_role`, so the poller login would get `42501`. **Already fixed:** shared-db migration `20261102202014_dam_search_embed_rpc_worker_grants.sql` grants EXECUTE on `claim_dam_search_embedding_documents`, `upsert_dam_search_embedding`, `mark_dam_search_embedding_error`, `get_dam_search_embedding_status` to `dam_image_embed_worker` (vendored copy: `shared-db/supabase/migrations/20261102202014_dam_search_embed_rpc_worker_grants.sql:32-36`, contract test `shared-db/supabase/tests/dam_search_embed_worker_execute_grants_contracts.sql`). The planner confirmed on 2026-11-04 via a read-only query that version `20261102202014` is present in production `supabase_migrations.schema_migrations`. The owner's Nov 4 issue comment also says "Fixed: grants".
2. **Medium — missing thumbnail marked permanent, never cleared.** Still open. `apps/image-embed-worker/image_embed_poller.py:543-545` marks any claimed row with a null `thumbnail_url` as `"permanent"`. Live impact measured 2026-11-04 (read-only SQL, planner): **1,123 documents** carry `embedding_error_category='permanent'` with error text `missing thumbnail_url` (1,113 assets, 10 style groups); **398 of them now have a thumbnail** (392 assets, 6 style groups) and are still excluded. (The owner's earlier comment measured 1,139 / 414 — the numbers drift as nightly rebuilds touch style groups.)
3. **Low — tests stub the RPC contract.** Truncated in the issue body. The existing tests in `apps/image-embed-worker/tests/test_image_embed_poller.py:236-320` stub `claim_search_docs` and `_run`, so the SQL text and parameter order sent to the three RPCs are only partially asserted (the upsert test does check `::extensions.vector` and the stamp position).

The fixer bot deferred (`fixer-deferred`) because the source PR was already closed.

## 4. Scope — in and out

In:
- shared-db migration that (a) makes both refresh functions clear the embed-error markers when the document's `metadata->>'thumbnail_url'` changes, and (b) one-time resets the rows currently stranded by the `missing thumbnail_url` permanent error.
- Poller change: missing thumbnail → `transient`.
- Poller tests and README update; a contract-shape test for the three RPC calls (finding 3).
- Deploy the poller update to `edge-dev`, drain, prove live.

**NOT in this plan:**
- Changing the content-hash definition (`content_sha256` stays a hash of `search_text` only). Folding `primary_thumbnail_url` into the style-group hash is a separately tracked follow-up on #616 (see `shared-db/supabase/migrations/20261101005850_dam_primary_artwork_first.sql:52-56`).
- Re-embedding a document whose thumbnail *changed* while it already has a vector (stale-vector invalidation). Out of scope; note it in section 13 as a known gap.
- Any change to `claim_dam_search_embedding_documents`, the lease/backoff arithmetic, `embedding_max_attempts` (default 5, `shared-db/supabase/migrations/20260825010603_popdam_scoped_ai_metadata_search.sql:127`), or the `auth.role()` guard pattern (explicitly warned against in `20261102202014` header comments).
- The image-similarity lanes (`dam.*` index/query jobs). Untouched.
- Hardening `drop function` ACL fragility (tracked in shared-db by the contract test above).

## 5. Current state of the code

All on `main` at `01fcfc34` (2026-11-04), deployed:

- Poller search lane: `apps/image-embed-worker/image_embed_poller.py`
  - `claim_search_docs` `:500-510` → `public.claim_dam_search_embedding_documents(batch, worker_id, lease_seconds)`.
  - `search_upsert` `:512-522` → `public.upsert_dam_search_embedding(document_type, entity_id, content_sha256, lease_token, vector::extensions.vector, stamp)`.
  - `search_mark_error` `:524-537` → `public.mark_dam_search_embedding_error(document_type, entity_id, content_sha256, lease_token, message[:500], category)`; swallows its own failures with a `search_mark_error_failed` log.
  - `process_search_batch` `:539-585`: **`:543-545` is the bug** — `if not row[3]: self.search_mark_error(row, "Permanent: missing thumbnail_url", "permanent")`. Download/decode failures are `transient` (`:556-558`), bad vector dims `permanent` (`:574-576`), upsert exceptions `transient` (`:583-585`).
  - `poll_search_lane` `:587-602`, `run_service` `:604-643` (lane every `SEARCH_POLL_S`=5 s, 600 s cooldown on claim error), `run_drain` `:645-693` (`--once-drain` drains search lane first).
- Config: `apps/image-embed-worker/config.py:59-64` (`SEARCH_LANE_ERROR_COOLDOWN_S = 600`, `SEARCH_DOC_MODEL_STAMP = "google/siglip2-base-patch16-naflex"`).
- Tests: `apps/image-embed-worker/tests/test_image_embed_poller.py:276-286` `test_search_batch_marks_missing_thumbnail_permanent` asserts the wrong behaviour (category `"permanent"`). Helpers `_search_poller` `:236-271`, `_row` `:271-274`, `_FakeCursor`/`_FakeConn` `:199-233` record every `execute(sql, params)` call.
- README `apps/image-embed-worker/README.md:29` says "missing thumbnail = permanent"; `:35-38` describes the grant requirement (now satisfied).
- The pytest suite is **not** run by `.github/workflows/ci.yml` (grep for `pytest`/`image-embed-worker` finds nothing); it runs locally (`cd apps/image-embed-worker && python -m pytest tests -q`) and on the GPU box.
- shared-db (vendored mirror, read-only here):
  - Claim excludes `embedding_error_category = 'permanent'`: `shared-db/supabase/migrations/20261101005850_dam_primary_artwork_first.sql:186`; returns `c.metadata->>'thumbnail_url'` as `thumbnail_url` `:194`.
  - `mark_dam_search_embedding_error` latest body: `shared-db/supabase/migrations/20260825082910_popdam_ai_search_reconciliation_and_activation.sql:2692-2703`. Note `:2697`: category becomes `permanent` when `p_category='permanent'` **or `embedding_attempts >= embedding_max_attempts`**. So a `transient` mark still turns permanent after 5 claims (backoff 30 s·2^(attempt−1), capped 3600 s, `:2698-2699`).
  - `refresh_dam_search_asset_document` latest body: `shared-db/supabase/migrations/20260825031841_popdam_ai_search_forward_recovery.sql` (ON CONFLICT at `:239-247`): `embedding_error`, `embedding_error_category`, `embedding_attempts` are **preserved whenever `content_sha256` is unchanged**; `metadata` (which carries `thumbnail_url`, `:222`) is always replaced. Hash = sha256 of `search_text` only (`:213`).
  - `refresh_dam_search_style_group_document` same file `:249-278` (ON CONFLICT `:269-278`, same preservation rule; thumbnail in metadata `:266` from `sg.primary_thumbnail_url`).
  - Triggers already fire on thumbnail changes: `trg_dam_search_assets_refresh … update of … thumbnail_url` (`shared-db/supabase/migrations/20260713221518_dam_hybrid_search_foundation.sql:492-516`) and `trg_dam_search_style_groups_refresh … update of … primary_thumbnail_url` (`:518-541`). So the refresh **does** run when a thumbnail arrives; it just keeps the stale error markers.
  - Precedent for a migration-embedded one-time reset: `shared-db/supabase/migrations/20261101182210_dam_primary_artwork_first_batched_v2.sql:177-196` (clears every embed marker on style_group docs).
  - Admin reset RPC `reset_dam_search_embedding_errors(p_document_type, p_entity_ids)` (`20260825082910:2714-2723`, service_role/admin only) is wired to the Settings "Requeue terminal errors" button (`src/components/settings/SearchIndexCard.tsx:33-35,72`) through the edge function (`supabase/functions/dam-search-ai/index.ts:141-149`, always passes `p_entity_ids: null`). It resets **all** exhausted docs, not just the thumbnail ones.

## 6. Key findings and root cause

- Root cause of finding 2 is a two-part mismatch: the poller treats "no thumbnail yet" as a terminal fact (`image_embed_poller.py:545`), and the database's refresh functions treat the thumbnail as metadata that never affects embed eligibility (`20260825031841:239-247, 269-278`). Either half alone leaves documents stranded: fixing only the poller still exhausts attempts (5 claims ≈ 8 minutes of backoff) and `mark_dam_search_embedding_error` then flips to `permanent` itself (`20260825082910:2697`); fixing only the DB leaves new permanents being written every cycle.
- Style groups are mostly self-healing today (only 10 stranded) because the nightly rebuild deletes and re-inserts group rows / changes their text, which changes `content_sha256` and clears the markers. Assets are not (1,113 stranded): their text rarely changes after ingest.
- The poller's own `search_mark_error` cannot "un-mark" a document: there is no RPC for the worker role to reset markers, and `reset_dam_search_embedding_errors` is service_role/admin only. Hence the DB-side rule is the only durable place for "thumbnail arrived ⇒ eligible again".
- Measured 2026-11-04 (read-only, production):
  ```sql
  select document_type, count(*) excluded,
         count(*) filter (where metadata->>'thumbnail_url' is not null) now_has_thumbnail
  from public.dam_search_documents
  where embedding is null and embedding_error_category='permanent'
    and embedding_error ilike '%missing thumbnail_url%' group by 1;
  -- asset 1113 / 392 ; style_group 10 / 6
  ```
- Finding 1 is closed by `20261102202014` (in production). Finding 3 is partially addressed by `test_search_batch_upserts_each_document` (`:289-302`) which checks the upsert SQL/param shape; the claim and mark-error call shapes are not asserted anywhere.

## 7. Approaches considered and REJECTED

- **Poller-only fix (mark `transient`).** Rejected as the sole fix: attempts still exhaust in ~8 minutes (`20260825082910:2697-2699`) and the row becomes `permanent` again, just with a different message.
- **Poller skips rows without a thumbnail without marking anything.** Rejected: the claim already incremented `embedding_attempts` and set a lease; silently leaving the lease to expire burns attempts just the same and hides the reason in the status card.
- **Fold `thumbnail_url` into `content_sha256`.** Rejected here: it would mark every one of ~140k documents as changed on the next refresh pass (mass re-embed) and collides with the #616 follow-up that owns the hash definition. Also the SigLIP2 corpus was embedded uncropped from the current thumbnails; re-embedding the whole corpus is a separate decision.
- **Have the poller call `reset_dam_search_embedding_errors`.** Rejected: that RPC is service_role/admin only (`20260825082910:2718`); granting it to the worker role widens the worker's authority beyond its lane for no reason.
- **One-time reset via the Settings "Requeue terminal errors" button.** Rejected as the primary path: it requires a human click (forbidden by standing rules) and resets *all* exhausted docs, including ones that are permanent for a real reason. The migration-embedded reset is precise and leaves an auditable artifact. (It remains an acceptable fallback the AI can trigger itself by calling the edge function with an admin session if the migration's reset somehow cannot ship.)
- **Add a 4th argument to `mark_dam_search_embedding_error` ("do not count this attempt").** Rejected: changes a public RPC signature that `service_role` callers may use (`apps/worker/src/handlers/embed-search.ts`), and the `drop function`/ACL fragility warned about in `20261102202014` makes signature churn risky.

## 8. Design decisions (dated 2026-11-04)

- **LOCKED:** The durable rule lives in shared-db: in both refresh functions' `ON CONFLICT … DO UPDATE`, when `coalesce(dam_search_documents.metadata->>'thumbnail_url','') is distinct from coalesce(excluded.metadata->>'thumbnail_url','')` **and `dam_search_documents.embedding is null`**, set `embedding_error=null, embedding_error_category=null, embedding_attempts=0, embedding_next_retry_at=null` (the existing lease columns are already nulled). The `embedding is null` guard keeps this from touching already-embedded documents (stale-vector invalidation is out of scope).
- **LOCKED:** The poller marks a missing thumbnail `transient` with message `transient: thumbnail not generated yet` (lower-case, searchable). No `permanent` writes for this case.
- **LOCKED:** The same shared-db migration performs the one-time reset of currently stranded rows: `where embedding is null and embedding_error_category='permanent' and embedding_error ilike '%missing thumbnail_url%'` → clear the four markers (do **not** restrict to rows that already have a thumbnail: rows still without one will simply be re-marked transient by the fixed poller, and the new rule rescues them when a thumbnail arrives).
- **LOCKED:** No change to `claim_dam_search_embedding_documents`, `mark_dam_search_embedding_error`, grants, or the `auth.role()` guards.
- **OPEN (implementer's call):** whether the poller should also log a per-batch count of "no thumbnail yet" rows (`search_no_thumbnail`) in the `search_batch` log line. Recommended yes; harmless.
- **OPEN:** the exact migration version timestamp (generated at claim time in shared-db).

## 9. The plan

### Phase A — shared-db (repo `popcre/shared-db`, canonical `/worksp/shared-db`)

**Step 0 — Verify finding 1 is in production.** Read-only, from this repo:
`select version from supabase_migrations.schema_migrations where version='20261102202014';` (Supabase MCP `execute_sql` or psql with the read-only path from `docs/1password.md`). Gate: one row back. If absent, finding 1 is still open — stop and treat the shared-db promotion queue as the blocker (see `HANDOFF.d/2026-11-02T2005Z-hetz-zcode-grid-find-stepper-live-proof.md` §3 for how that queue behaved on Nov 2).

**Step 1 — shared-db migration.** Load the `shared-db-change` skill first. Work in a worktree of `/worksp/shared-db`. Claim-first on the existing shared-db issue that owns `refresh_dam_search_asset_document` / `refresh_dam_search_style_group_document` (search open issues for those object names; if none, the owning issue is the one the skill tells you to open — a work issue plus object claim, per the skill). Then:
1. New migration `supabase/migrations/<version>_dam_search_embed_retry_on_thumbnail.sql` with the header the skill requires (work issue, claim, `derived-from: 20260825031841`, application issue `u2giants/popdam3#663`).
2. `create or replace function public.refresh_dam_search_asset_document(uuid)` — copy the current body exactly from `20260825031841` (`:205-247`; re-check in the canonical repo that no later migration redefined it: `grep -ln "function public.refresh_dam_search_asset_document" supabase/migrations/*.sql | tail -1`) and change only the three `case` expressions for `embedding_error`, `embedding_error_category`, `embedding_attempts` so they also reset when the thumbnail changed and `embedding is null` (section 8 rule). Also set `embedding_next_retry_at=null` (already there).
3. Same for `refresh_dam_search_style_group_document(uuid)` (`:249-278`).
4. One-time data reset block (same transaction, after the function changes), modelled on `20261101182210:177-196`:
   ```sql
   update public.dam_search_documents
      set embedding_error=null, embedding_error_category=null, embedding_attempts=0,
          embedding_next_retry_at=null, embedding_lease_token=null,
          embedding_lease_owner=null, embedding_lease_expires_at=null
    where embedding is null and embedding_error_category='permanent'
      and embedding_error ilike '%missing thumbnail_url%';
   ```
   Expected ≈1,100 rows (re-measure with the section 6 query first; record the count in the migration comment).
5. Re-assert the existing ACLs for the two functions after `create or replace` (they are `security definer`; `create or replace` keeps ACLs, but add the `revoke … from public, anon, authenticated` lines that the forward-recovery migration used, to match house style).
6. Contract test `supabase/tests/dam_search_embed_retry_on_thumbnail_contracts.sql` (pgTAP style like `dam_search_embed_worker_execute_grants_contracts.sql`):
   - `test_asset_refresh_clears_markers_when_thumbnail_arrives`: insert a throwaway asset with `thumbnail_url null`, refresh, set the doc's markers to permanent/`missing thumbnail_url`/attempts 5, update `assets.thumbnail_url`, assert markers are null and attempts 0.
   - `test_asset_refresh_keeps_markers_when_thumbnail_unchanged`: same but update an unrelated column with same text → markers preserved.
   - `test_asset_refresh_leaves_embedded_docs_alone`: doc with a non-null embedding and a thumbnail change → embedding and markers untouched.
   - `test_style_group_refresh_clears_markers_when_primary_thumbnail_arrives`: mirror for style groups via `primary_thumbnail_url`.
   - `test_one_time_reset_targets_only_missing_thumbnail_permanents`: a doc with `permanent` + another error text stays permanent.
   Run with the repo's documented test runner (the skill names it). Gate: all five pass on preview.
7. PR to shared-db `main`; let its automatic promotion carry it to production (preview rehearsal, tests, no `review-finding` blocker). Never a manual production command. Wait with `bin/ai-pr-wait <pr>` (background).
Gate: `select version from supabase_migrations.schema_migrations where version='<version>'` returns the row in production, and the section 6 query returns 0 stranded rows.

**Step 1b — vendored mirror.** This repo's `shared-db/` mirror is synced by its own chore commits (`chore: sync shared-db @ …`); do not hand-edit it.

### Phase B — poller (this repo, can run in parallel with Phase A)

**Step 2 — `apps/image-embed-worker/image_embed_poller.py`.**
- `:543-545`: replace with
  ```python
  if not row[3]:
      self.search_no_thumbnail += 1
      self.search_mark_error(row, "transient: thumbnail not generated yet", "transient")
  ```
  and add `self.search_no_thumbnail = 0` next to `self.search_failed` in `Poller.__init__` (`:286-298`). Decide (OPEN) whether to count it in `search_failed` too; recommended: **not** in `search_failed` (it is not a failure), but include `no_thumb=self.search_no_thumbnail` in the `search_batch` log (`:598-600`) and in `drain_complete` (`:666-669`).
- Update the comment block `:495-499` to drop "Until those grants reach the target database" wording (grants are live) — keep the cooldown explanation.
Behaviour when done: a claimed row without a thumbnail gets `transient` with server-side backoff; after a thumbnail arrives the DB rule (Phase A) resets it and the next claim picks it up. Gate: Step 3 tests.

**Step 3 — tests + README.**
- `apps/image-embed-worker/tests/test_image_embed_poller.py:276-286`: rename to `test_search_batch_marks_missing_thumbnail_transient`; assert category `"transient"`, message contains `thumbnail not generated yet`, `search_done == 0`, no upsert call, and (if adopted) `search_no_thumbnail == 1` with `search_failed == 0`.
- New `test_search_batch_never_marks_permanent_for_missing_thumbnail`: a batch mixing one null-thumb row and one good row → exactly one mark call, category transient, one upsert for the good row.
- README `apps/image-embed-worker/README.md:29`: "(missing thumbnail = transient; the database clears the marker when a thumbnail arrives)"; `:35-38`: state that the grants landed in shared-db `20261102202014`.
- Run: `cd apps/image-embed-worker && python -m pytest tests -q` (needs `pip install -r requirements.txt` minus torch is **not** enough — the tests import the poller which imports torch/transformers; use a venv with the pinned requirements, or run on `edge-dev` where the venv exists). Gate: suite green, count up by one.

**Step 4 — finding 3: RPC call-shape test.** Add `test_search_lane_rpc_call_shapes` that, using `_FakeConn`, calls `p.claim_search_docs()` (do **not** monkeypatch it in this test), `p.search_upsert(row, vec)` and `p.search_mark_error(row, "m", "transient")` and asserts the exact SQL fragments and parameter tuples:
- claim: SQL contains `public.claim_dam_search_embedding_documents(%s, %s, %s)` and params `== (64, "test-search", 900)`;
- upsert: params `(document_type, entity_id, content_sha256, lease_token, "<vector text>", stamp)` positions 0–5 as in `:518-519`;
- mark-error: params `(document_type, entity_id, content_sha256, lease_token, message, category)` as in `:531-532`, message truncated at 500 chars (pass a 600-char message).
These positions mirror the RPC signatures in `20261101005850:174` and `20260825082910:2692-2693`; cite them in the test docstring so a signature change is noticed. Gate: test passes; deliberately swapping two params fails it.

### Phase C — deploy and prove

**Step 5 — ship and drain.**
1. PR to `main` (branch e.g. `fix/search-embed-missing-thumbnail-transient`), CI green (`bin/ai-pr-wait`), merge.
2. The poller is not auto-deployed: follow `apps/image-embed-worker/README.md` "Install on a GPU Windows box" upgrade steps on `edge-dev` (copy folder, restart `PopDAM-ImageEmbedWorker`). All performed by the AI over the existing remote path documented there; never ask Albert.
3. After Phase A is in production, watch `service.log` for `search_batch` lines and run the section 6 query: stranded count must reach 0 and `embedded_documents` in `select public.get_dam_search_embedding_status()` (service_role; via the Settings card or the edge function) must rise by ≈ the 398 rescued docs.
4. Live proof: pick one rescued asset id from the reset set, confirm `embedding is not null` and that a semantic search on https://dam.designflow.app returns it. Screenshot or SQL output goes in the #663 comment.
Gate: zero `missing thumbnail_url` permanents; no new `permanent` markers with that text after 24 h.

**Step 6 — close.** Comment on #663 (signed with `$AI_GH_SIGNATURE`): finding 1 evidence (migration version in prod), finding 2 evidence (migration + poller SHA + before/after counts), finding 3 evidence (test name). Tick `- [ ] live proof` on #663 itself, close. Update this plan's STATUS and the handoff.

## 10. Tests required

- Python (`apps/image-embed-worker/tests/test_image_embed_poller.py`): `test_search_batch_marks_missing_thumbnail_transient` (renamed), `test_search_batch_never_marks_permanent_for_missing_thumbnail`, `test_search_lane_rpc_call_shapes`; existing `test_search_batch_upserts_each_document`, `test_search_batch_download_failure_is_transient` stay green. Command: `cd apps/image-embed-worker && python -m pytest tests -q`.
- shared-db pgTAP: the five tests listed in Step 1.6; existing `dam_search_embed_worker_execute_grants_contracts.sql` stays green.
- Root CI (`npm run lint && npm run typecheck && npm run test`, worker build/test) must stay green although untouched.

Adversarial cases (external input = DB rows and thumbnail bytes crossing into the poller):

| Input | Hostile case | Test |
|---|---|---|
| `thumbnail_url` null | marked permanent forever | `test_search_batch_marks_missing_thumbnail_transient` |
| `thumbnail_url` empty string `""` | treated as present and fetched | `test_search_batch_never_marks_permanent_for_missing_thumbnail` (use `""` for the bad row) |
| thumbnail bytes corrupt | should stay transient (CDN hiccup) — existing | `test_search_batch_download_failure_is_transient` |
| error message > 500 chars | DB rejects / truncation | `test_search_lane_rpc_call_shapes` |
| thumbnail arrives after permanent mark | never re-eligible | pgTAP `test_asset_refresh_clears_markers_when_thumbnail_arrives` |
| text unchanged, thumbnail unchanged | markers wrongly cleared (retry storm) | pgTAP `test_asset_refresh_keeps_markers_when_thumbnail_unchanged` |

## 11. Constraints, standing rules, gotchas

- DB schema/function changes go only through `popcre/shared-db` (`/worksp/shared-db`), claim-first on the existing issue, `shared-db-change` skill loaded. Production DB is read-only by default; migrations reach production only via shared-db's automatic promotion. Never hand-edit this repo's `shared-db/` mirror.
- Never push to `main`; feature branch + PR; the AI merges. CI waits via `bin/ai-pr-wait <pr>` in the background, never a sleep loop.
- Do not "harden" the `auth.role() <> 'service_role'` guard in the four RPCs (`20261102202014` header, lines 16-23): it would break the worker login with 42501.
- `mark_dam_search_embedding_error` flips to `permanent` on attempt exhaustion regardless of category (`20260825082910:2697`) — the poller cannot prevent that; only the DB reset rule does.
- The poller pytest suite is not in CI; run it yourself and paste the result in the PR.
- `drop function if exists` + `create function` strips ACLs; use `create or replace` for the refresh functions and re-assert revokes.
- Times for humans in EST (America/New_York). Sign GitHub posts with `$AI_GH_SIGNATURE`.
- Secrets: the poller DSN and stamp live in 1Password vault `vibe_coding` (item titles per `apps/image-embed-worker/README.md` and `docs/1password.md`); never print them.
- Reviews are advisory; do not wait on one.

## 12. Access and environment

- `gh` authenticated as `u2giants`; Supabase MCP points at project `qsllyeztdwjgirsysgai` (verify with `get_project_url` — memory warns the default MCP may point at the retired Ohio project).
- Read-only production SQL: Supabase MCP `execute_sql` (select only) or the read-only path in `docs/1password.md`.
- shared-db canonical checkout `/worksp/shared-db` (use a worktree). Its test runner and claim procedure: `shared-db-change` skill.
- GPU box `edge-dev`: remote-execution path and service restart steps in `apps/image-embed-worker/README.md:95-150`; venv at the install folder.
- Live app: https://dam.designflow.app; admin test login item in 1Password `vibe_coding` (see `docs/1password.md`).

## 13. Definition of done, risks, open questions

Done when:
- [ ] shared-db migration merged, promoted, version visible in production; five pgTAP tests green.
- [ ] Poller PR merged to `main`, CI green, pytest result pasted.
- [ ] `edge-dev` running the merged SHA (log `service_start` after restart).
- [ ] Section 6 query → 0 rows; ≥ 390 previously stranded assets embedded; one rescued asset found by live semantic search.
- [ ] #663 commented with evidence, `- [ ] live proof` ticked, closed; STATUS table and handoff updated; `apps/image-embed-worker/README.md` current.

Risks / rollback:
- Retry churn: the one-time reset re-queues ~725 docs that still lack thumbnails; each burns ≤5 claims with backoff and ends `permanent` again until a thumbnail arrives (then rescued). Cost is a few thousand cheap claims; acceptable. If the lane thrashes, raise `SEARCH_LANE_ERROR_COOLDOWN_S` is **not** the lever — it only applies to claim errors; instead lower `--search-batch`.
- Rollback of the migration = a forward migration restoring the previous function bodies (`20260825031841`); the data reset is harmless to reverse (rows simply get re-marked by the poller).
- Known gap (out of scope): a document whose thumbnail *changes* after embedding keeps its old vector.

Open questions:
- None for Albert. OPEN implementer items are in section 8.

## Self-audit

1. **Could a brand-new session execute this without asking?** Yes — sections 5 and 9 name every file:line, the exact SQL predicates, the test names, the deploy runbook pointer, and the claim-first procedure; section 12 names access by location.
2. **Does it carry every piece of background and what was ruled out?** Yes — section 6 explains the two-part root cause and the attempt-exhaustion trap; section 7 lists six rejected approaches with reasons; section 3 records finding 1 as already landed with the migration evidence.
3. **Is the goal clear enough to steer by when a step is wrong?** Yes — section 1 states the business outcome (every document with a thumbnail searchable; stranded ones rescued) and section 8 marks what is locked versus open.
