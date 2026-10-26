# Implementation plan — Upload an image, find the same artwork in the library

**Plan file:** `plan_image_similarity_upload_search.md`  
**Handoff:** [HANDOFF.d/2026-10-22T1323Z-edge-dev-mimo-image-similarity-plan.md](HANDOFF.d/2026-10-22T1323Z-edge-dev-mimo-image-similarity-plan.md)  
**Mode:** A (write implementation plan)  
**Owner decisions (locked 2026-10-22, Albert chat):** hybrid = GPU dual-embedding blueprint + PopDAM product rules; **show 90% near-misses at first**; **thresholds tunable**; **ScaleDown dropped**.  
**Review chain:** Muse REVISE → GLM REVISE → DeepSeek REVISE (B1–B5) → Muse REVISE (18 findings) → **this revision integrates all of the above** (§14–§16).

---

## STATUS

| Step | Status | Evidence (artifact, not a number) |
|------|--------|-----------------------------------|
| 0. Owner approval | ✅ done 2026-10-22, reconfirmed 2026-10-23 | Plan header; Albert chat "Yes — build it" 2026-10-23 |
| 0b. File PopDAM tracking issue | ✅ done 2026-10-23 | #486 |
| 1. Spike: dims, VRAM, crop, speed | ✅ done 2026-10-26 — whole library dual-embedded on edge-dev GPU (~15–25 img/s); bytea proof deferred to Step 5 (no upload path exercised yet) | #486 comment 6408936634; tools on edge-dev `D:\ai\siglip2-embed\` |
| 2. shared-db: tables, public wrappers, trigger | ✅ done 2026-10-26 — #4700 merged; migration `20261025163955` LIVE on production (preview rehearsal pass, then OWNER-OVERRIDE apply per owner ruling 2026-10-25); **139,403/139,458 assets carry both vectors (99.96%)**, 2 HNSW indexes, single stamp; 55 gaps = missing Spaces thumbnails; login credential in 1Password; stamp in admin_config; `IMAGE_EMBED_ENABLED` still false | #486 comment 6408936634; run 40264183001 |
| 3. GPU poller (pooler TLS, LOGIN role, heartbeat) | ✅ done 2026-10-26 — `apps/image-embed-worker` (PR #503 `c0861eb2`); live on edge-dev schtask `PopDAM-ImageEmbedWorker`, heartbeat 30 s, 13/13 pytest + CUDA selftest; stamp copied from admin_config at install (login role cannot read admin_config; a login-readable stamp RPC would need a shared-db wrapper) | `apps/image-embed-worker/README.md`; #486 |
| 4. Incremental trigger + backfill enqueue-only | 🟡 incremental ✅ done 2026-10-26 — `IMAGE_EMBED_ENABLED` on (10:53 AM EST); enqueue→vector 2.4 s, query self-match 100.0 % in 1.1 s. Backfill op **blocked**: service_role cannot enumerate stale assets (needs `public.image_embed_stale_assets` wrapper in shared-db) | `docs/verification/image-similarity-20261026/acceptance.md`; #486 |
| 5. Edge `image-similarity` + UI + status route | ✅ done 2026-10-26 — PR #505 `068063bf`; deployed (rerun after an esm.sh flake); drop zone in LibraryTopBar + `ImageSimilarityResults`; UI proof: "4 matches at 90%+" live | `docs/verification/image-similarity-20261026/ui-verification.md` |
| 6. Tunable config (edge + poller + frontend) | ✅ done 2026-10-26 — defaults modules (poller `config.py`, edge/frontend `_shared/image-similarity-config.ts` re-export); admin_config carries floor 0.90 / bands 0.98-0.94-0.90 / weight 0.60 / top_k 200; edge passes them into the RPC | `docs/verification/image-similarity-20261026/acceptance.md` |
| 7. Live proof on production library | ✅ done 2026-10-26 — 40/40 uploads (20 real pairs × as-is + variant) through the live edge fn; bordered min 96.6 %, white-ground 28/28, all ≥ 90.2 %; cutoffs confirmed; live-proof box ticked on #486 | `docs/verification/image-similarity-20261026/acceptance.md` |

**Fresh session starts at Step 0b/1.** Re-read STATUS first. Do not re-derive.

---

## 1. The ultimate goal (plain business English)

A designer or licensing reviewer can drop a picture into PopDAM and immediately see which library images are the **same artwork** — even when the upload is a different size, file type, or has a thin white border. They see clear strength bands starting at **90%**, and can retune bands without a code release. New library files join the index automatically; nobody re-scans the whole library.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

---

## 2. What this application is

**PopDAM** (`C:\repos\popdam3`, `u2giants/popdam3`) is an internal Digital Asset Manager for licensed consumer-product art. Web app at `dam.designflow.app` / `sg.designflow.app`. Thumbnails on DigitalOcean Spaces (`cdn.designflow.app`). Postgres = shared Supabase **`qsllyeztdwjgirsysgai`**. Railway worker `apps/worker/`; bridge `apps/bridge-agent/`; windows agent `apps/windows-agent/`; React `src/`; Deno edge `supabase/functions/`.

**Critical house rule (Muse finding 1):** `dam` is **not** in `pgrst.db_schemas`. Any PostgREST call to `dam.*` fails **`Invalid schema: dam`** even for `service_role` (`docs/KNOWN_QUIRKS.md` #64, `docs/idiosyncrasies.md` “dam schema”). Edge/Railway **must** use `public` `SECURITY DEFINER` wrappers (precedent: `public.get_pdf_rich_extraction_hashes` / `public.upsert_pdf_rich_extraction`). Direct SQL (poller over pooler) may use `dam.*`.

**Branch policy:** feature branch + PR to `main`. Schema only in `popcre/shared-db`.

---

## 3. What triggered this work

Albert (2026-10-22): upload an image, find the same picture in the library (not the same file), thresholds 99/95/90%, no full re-scan, cheaper than ScaleDown. Border/size cases must work. Dual-embedding GPU blueprint approved; 90%+ shown first; tunable; **no ScaleDown**.

---

## 4. Scope

### In
Dual embeddings (DINOv3 + SigLIP 2) on owner GPU desktops; per-asset vectors in shared-db; upload → banded matches; trigger + backfill incremental index; border auto-crop; tunable bands; authenticated search.

### NOT in
ScaleDown; cloud→desktop push; paid reverse-image / cloud embeds as engine; style/mood search; video; AI tagging/ERP/PopSG crawl changes; fine-tuning; app-repo migrations; auto-merge; **PopSG image search** (default out).

---

## 5. Current state of the code

| Area | State | Where |
|------|--------|--------|
| Text embed lease claim | Working | `public.claim_dam_search_embedding_documents`; `apps/worker/src/handlers/embed-search.ts:41` |
| Text vectors | Working | `dam_search_documents.embedding extensions.vector(384)` + HNSW (foundation migration `:27,:71`) |
| Search edge pattern | Working | `supabase/functions/dam-search-ai/index.ts` (`authenticateUser`, **caller-scoped `auth.client.rpc`** `:179-181`, `serviceClient` for admin) |
| `dam` PostgREST ban | Working rule | `docs/KNOWN_QUIRKS.md` #64; public RPC wrappers required |
| Thumbnails | Working | `generateThumbnail` `apps/bridge-agent/src/thumbnailer.ts:393`; `assets.thumbnail_url` |
| Bulk op registry | Required | `operation-constants.ts` + `operation-loop.ts` + `diagnostics/types.ts` (`operation-registry-sync.test.ts`) |
| SearchIndexCard precedent | Working | **`src/components/settings/SearchIndexCard.tsx`** (not under `diagnostics/`) |
| dHash | Different job | `apps/windows-agent/src/compat-audit.ts` — not this engine |
| Image-to-image | Does not exist | This plan |
| Dual vision + GPU | Not in repo | Owner blueprint excerpts in Appendix A |

---

## 6. Key findings

1. ScaleDown cannot search a library — dropped.
2. pHash fails borders; dual embeddings fix IP false friends.
3. WHERE-blended cosine cannot use HNSW → top-K then blend.
4. `halfvec` needs `extensions.halfvec_cosine_ops`; all vector types schema-qualified (`extensions.*`).
5. Cloud cannot reach Tailscale desktops → **pull-based** workers.
6. SQL cannot hash thumbnail bytes → URL + model stamp watermark.
7. DINOv3 HF-gated; dims must be proven before schema freezes 768/768.
8. **`dam.*` is invisible to PostgREST** → public wrappers for every edge/Railway RPC (Muse 1).
9. Re-embed must not empty search for hours (Muse 8) → multi-stamp filter window.

---

## 7. Approaches rejected

ScaleDown; pHash-only; paid reverse-image; cloud embed primary; single model; parallel catalog table; app-repo DDL; WHERE blend; pairwise cache; full re-embed per search; cloud→Tailscale push; public HTTPS GPU workers; Tailscale Funnel push; **calling `dam.*` over PostgREST** (hard fail); **service-role keys on desktops**; **bumping model stamp without a coexistence rule** (empties search).

---

## 8. Design decisions (locked)

| Decision | Reason |
|----------|--------|
| Dual embeddings DINOv3 ViT-B/16 + SigLIP 2 base | Owner blueprint |
| Compute on 2× RTX 3060 Ti Windows desktops | Owner |
| **Pull-based poller** over **Supabase pooler (IPv4, TLS, TCP 5432)** — not “HTTPS” to a DB URL | Only workable path; retries on **pg/SQL errors**, not HTTP 5xx |
| Vectors: `dam.dam_asset_image_vectors` + `extensions.halfvec(768)×2`, partial HNSW `where vec_* is not null` | House style; ANN usable |
| **All edge/Railway RPCs are `public.*` SECURITY DEFINER**; `dam.*` only for poller direct SQL | PostgREST cannot see `dam` (Muse 1) |
| **One jobs table:** `dam.image_embed_jobs` (delete any `image_similarity_query_jobs` name) | Muse 2 |
| DB **trigger** on `assets` insert / `thumbnail_url` update → enqueue index job | DeepSeek B1 / Muse 12 |
| Unique pending index job per asset | Muse 12 |
| **Dedicated NOLOGIN role `dam_image_embed_worker` + LOGIN member `dam_image_embed_login`** | HTS pattern; Muse 17 |
| Search RPC **caller-scoped `auth.client`**; job/admin via `serviceClient` | Access control (Muse 7) |
| Score formula §8b; UI % = `round(combined*100,1)`; bands tunable | Owner |
| **Model stamps:** search accepts `p_model_stamps text[]`; normally `[current]`; during re-embed `[current, previous]` until backfill done | Muse 8 / DeepSeek B4 |
| **Stamp string** built once: `dinov3-vitb16+siglip2-base-patch16+px{input}+{interp}+torch{ver}` stored in `admin_config.IMAGE_SIM_EMBEDDING_MODEL` (+ `IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS`); poller writes that exact string | Muse 9 |
| Dual cadence: query jobs 1 s / 1 job/claim / lease 30 s; index 5 s / batch 32 / lease 300 s | Muse 15 |
| Worker **heartbeat** every 30 s mandatory; edge `unavailable` if all heartbeats stale > 90 s | Muse 6 |
| Edge actions: `search` (upload), `query-status` (`query_job_id`) | Muse 5 |
| Backfill op = **enqueue + status only** | GLM / Muse 8 residual |
| Edge wait 15 s wall-clock vs PostgREST `statement_timeout=8s` on RPCs | DeepSeek B2 / Muse 12 |
| Decode split: edge size+magic; poller dims/Pillow/EXIF/crop | GLM |
| Rate policy: size-cap only (no 429 limiter) | GLM |
| **No ScaleDown**; no bridge/windows code edits | Owner |

### 8b. Score and bands (locked)

- `dino_sim = 1 - (vec_dino <=> q_dino)`, clamp [0,1]; same for siglip.
- `combined = w*dino_sim + (1-w)*siglip_sim`, default w=0.60.
- UI percent = `round(combined*100,1)`.
- Band cutoffs (on `combined`): same-export 0.98, same-artwork 0.94, close 0.90, floor 0.90; fallback label “Below bands — review” if floor lowered.
- Calibrate cutoffs on **production fp16** scores (Step 7), never spike fp32 alone.

### Open (implementer judgment)

- Exact claim batch sizes within locked defaults; HNSW `m`/`ef_construction` (suggest 16/64).
- Poller in-process models (default) vs local debug HTTP.
- Settings card copy (file locked: `src/components/settings/ImageEmbedCard.tsx`).

---

## 9. The plan

### Phase A — Spike

#### Step 0b — Tracking issue
Create GitHub issue on `u2giants/popdam3` (“Image similarity: upload → find same artwork”) with `- [ ] live proof`. Put URL in STATUS.

#### Step 1 — Offline spike (GPU desktop)
1. Load both models; record Python/torch/CUDA/transformers/Pillow versions and load path.
2. Assert dims — print `dims_dino=768, dims_siglip=768` or **stop and change halfvec sizes before Step 2**.
3. VRAM at rest + batch (FP16, 8 GB).
4. Fixtures: real `generateThumbnail` JPEG q85 outputs — 3 sizes; +8–16 px white border; JPEG vs PNG; 3 unrelated arts; 2 colorways; EXIF-rotated; **one original-vs-thumbnail pair**; one intentional white-ground false-positive guard.
5. Auto-crop then embed; score matrix.
6. **License gate:** DINOv3 is Meta `dinov3-license` (gated) — confirm commercial DAM use; SigLIP 2 is Apache-2.0.
7. **Bytea proof (Muse 16 / L-5):** exercise **the same encoding the edge will use** (PostgREST/JSON — note base64 can inflate size). `public.image_embed_enqueue_query` does **not** return payload bytes; read-back is **direct SQL** `select octet_length(payload)` as the login role. Record max body that round-trips. If PostgREST limits fail at 15 MB, **lock signed-URL / Spaces temp object** instead of bytea.

**Auto-crop (locked numbers):** `ImageOps.exif_transpose` → flatten on white → 6 px edge ring median → pixel is border if channel Δ ≤ 12 → flood from edges → crop bbox → **skip if > 25% area loss**.

**Done when:** `docs/verification/image-similarity-spike.md` has versions, dims, VRAM, score matrix, crop flags, license note, bytea proof result. Engine OK requires size+bordered pairs ≥ **0.94** combined (or explicit band-default changes) and unrelated pairs clearly lower.

---

### Phase B — shared-db (gate: Step 1 dims)

#### Step 2 — Schema + contracts

**Namespace rule:** tables/triggers/job internals in `dam`. Every **PostgREST** entrypoint is a `public.*` `SECURITY DEFINER` wrapper. Never add `dam` to `pgrst.db_schemas`.

1. Hard pre-check: `to_regtype('extensions.halfvec')` not null; `vector` extversion gate.
2. `dam.dam_asset_image_vectors` — `asset_id uuid PK FK assets`, `vec_dino`/`vec_siglip` `extensions.halfvec(768)`, `embedding_model text not null` (exact stamp), `border_cropped bool`, `last_embedded_thumbnail_url text not null`, `computed_at`. **Upsert is all-or-nothing both legs (NOT NULL).**
3. Partial HNSW: `using hnsw (vec_dino extensions.halfvec_cosine_ops) where vec_dino is not null` (+ siglip twin).
4. **One** table `dam.image_embed_jobs`:
   - `id uuid pk`, `kind text check in ('index','query')`, `asset_id uuid null`, `payload bytea null`, `status text check in ('pending','leased','done','failed')`, `attempts int`, `lease_owner text`, `lease_expires_at timestamptz`, `result_dino`/`result_siglip` `extensions.halfvec(768) null`, `error text`, `created_at`, `updated_at`.
   - `UNIQUE (asset_id) WHERE kind='index' AND status IN ('pending','leased')` (Muse 12).
   - Index `(kind, status, lease_expires_at)` (Muse 14).
   - Query jobs: `payload` nulled on completion; purge `done`/`failed` older than 7 days via `dam.image_embed_purge_jobs()` + pg_cron **or** worker loop (Muse 14).
   - Heartbeat table `dam.image_embed_worker_heartbeat(worker_id text pk, seen_at timestamptz not null)`.
5. Roles: `dam_image_embed_worker` **NOLOGIN**; **`dam_image_embed_login` LOGIN** member (Muse 17). **GRANT list (M-C):** login role → `USAGE` on `dam`, `SELECT` on jobs + heartbeat, `SELECT (id, thumbnail_url, is_deleted)` on `public.assets`, `EXECUTE` on claim/complete/fail/heartbeat/upsert; `service_role` → `EXECUTE` on all `public.image_embed_*` + search; `authenticated` → `EXECUTE` on search only. Dam fns `SECURITY DEFINER` with house role guards.
6. Trigger `dam.trg_assets_enqueue_image_embed` **after insert / after update of thumbnail_url` — **raster thumbnails only** (detect via `thumbnail_url` path extension jpg/jpeg/png/webp — **L-7**). Calls `dam.enqueue_image_embed_index_job(NEW.id)`; **`ON CONFLICT` lives inside that enqueue function** (not the trigger body). Enqueue failure must **not** fail ingest. **URL stability:** compare stored `assets.thumbnail_url` as-is; if CDN signs rotating query strings, compare a canonical path instead — prove in Step 1. Tests: `test_trigger_enqueues_on_thumbnail`, `test_trigger_skips_pdf_thumbnail`, `test_unique_pending_index`.
7. RPC signatures (complete — **M-B**):

**Poller (direct SQL as `dam_image_embed_login`):**
- `dam.claim_image_embed_jobs(p_kind text, p_limit int, p_worker_id text, p_lease_seconds int) returns setof dam.image_embed_jobs` — `for update skip locked` where `status='pending' OR (status='leased' AND lease_expires_at < now())` (**M-A**); **on reclaim: `attempts = attempts + 1`, keep `status='leased'`, new `lease_expires_at`/`lease_owner` (do not pass through pending); if `attempts >= 5` set `status='failed'` (poison — DeepSeek D3)**; query kind `p_limit = least(p_limit, 1)`. Test `test_claim_reaps_expired_lease` includes poison.
- `dam.complete_image_embed_job(p_id uuid, p_result_dino extensions.halfvec(768), p_result_siglip extensions.halfvec(768), p_embedding_model text, p_border_cropped bool, p_thumbnail_url text) returns void` — atomic upsert both legs; status done; null query payload. **If `assets.thumbnail_url IS DISTINCT FROM p_thumbnail_url` enqueue new index job** (**M-D**).
- `dam.fail_image_embed_job(p_id uuid, p_error text, p_permanent boolean default false) returns void` — attempts+1; `failed` if `p_permanent` or attempts ≥ 5 (**L-4**).
- `dam.upsert_dam_asset_image_vectors(p_asset_id uuid, p_vec_dino extensions.halfvec(768), p_vec_siglip extensions.halfvec(768), p_embedding_model text, p_border_cropped boolean, p_last_embedded_thumbnail_url text) returns void` — insert/on conflict update both vectors + stamp + watermark.
- `dam.image_embed_worker_heartbeat(p_worker_id text) returns void`.
- `dam.image_embed_workers_fresh(p_stale_seconds int default 90) returns bool` — **internal only** (Muse **H-1**).

**PostgREST (`public.*` SECURITY DEFINER — never `dam.*`):**
- `public.image_embed_enqueue_index(p_asset_id uuid) returns boolean` — service_role; `true` if inserted or already pending/leased (**L-2**).
- `public.image_embed_enqueue_query(p_payload bytea) returns uuid` — SECURITY DEFINER; **GRANT EXECUTE to `service_role`** (edge calls `serviceClient` **after** `authenticateUser` — intentional; not granted to `authenticated` directly). Edge Step 5 names this wrapper, never `dam.*`.
- `public.image_embed_query_status(p_id uuid) returns jsonb` — `{"status":"pending|leased|done|failed","reason":string|null,"dino":text|null,"siglip":text|null,"embedding_model":string|null}` with vectors as **pgvector text** `[0.1,…]` (cast to `extensions.halfvec` at the search RPC — **DeepSeek non-block**, avoid JSON number-array cast errors).
- `public.image_embed_status() returns jsonb` — `{"pending":int,"leased":int,"failed":int,"done":int,"workers_fresh":bool,"stale_after_seconds":int}` — **the only freshness API the edge may call** (**H-1**). **`workers_fresh` = at least one** heartbeat within `stale_after_seconds` (default **90 s**); one offline desktop does not make the fleet unavailable. Heartbeat rows: keep last `seen_at` per `worker_id` (upsert, 1 row/worker — no growth).
- `public.search_dam_image_similarity(...) returns table (asset_id uuid, dino_pct numeric, siglip_pct numeric, combined_pct numeric, thumbnail_url text, filename text, relative_path text, sku text)` — authenticated, DAM access, `auth.client`. Args use **`extensions.halfvec(768)`** (**L-1**).

8. Search body: `set local hnsw.ef_search = greatest(p_top_k, 100)`; `is_deleted = false` + DAM access; legs `where vec_* is not null and embedding_model = any(p_model_stamps)`; ANN; union; exact missing leg; drop NULL; blend; filter; limit.
9. Contracts `popdam_image_similarity_contracts.sql`: claim exclusivity; **`test_claim_reaps_expired_lease`** (incl. poison); query limit 1; unique pending; trigger + PDF skip; complete upsert; **`test_complete_reenqueues_on_thumbnail_change`**; fail + permanent; heartbeat + **`image_embed_status().workers_fresh` via public wrapper**; EXPLAIN `enable_seqscan=off` **and a second EXPLAIN at seeded cardinality without the GUC** (DeepSeek non-block); stamp filter; purge; GRANTs; halfvec text round-trip via `query_status`.

**Column note (L-11):** vector columns nullable so partial HNSW still makes sense on failed/partial writes; `complete`/`upsert` always write **both** legs in one statement.

---

### Phase C — GPU poller

#### Step 3 — Desktop service `apps/image-embed-worker/`

- **Connect:** Supabase **pooler** host (IPv4) + TLS + `dam_image_embed_login` password (1Password `vibe_coding`). Retries with backoff on **SQL/connection errors** (Muse 3). Confirm pooler IPv4/TLS in install doc.
- **Heartbeat:** `image_embed_worker_heartbeat` every 30 s (mandatory).
- **Cadence:** query claim **1 row**, lease **30 s**, loop 1 s; index claim batch 32, lease 300 s, loop 5 s. **Inference batching (M-F):** batch up to 8 images per model forward when draining index claims; query jobs always batch=1 (latency). Tooltip estimate must cite Step 1 measured s/image; if only sequential is proven, say `N × measured` instead of 1–2.5 h.
- **Stamp (single source — M-C):** read `IMAGE_SIM_EMBEDDING_MODEL` from **`admin_config` only** (via small public reader or SQL select on `admin_config`); **no config-file fork**. Write that exact string on every vector row.
- **Stamp:** read `IMAGE_SIM_EMBEDDING_MODEL` (from `admin_config` via a small public read or config file — same value the edge uses); write that exact string (Muse 9).
- **Config defaults module:** `apps/image-embed-worker/config.py` (not frontend `src/lib/*` — Muse 18).
- **HF:** `HF_TOKEN` env; pin `requirements.txt` from Step 1.
- Optional `127.0.0.1` debug only.
- Windows install doc: scheduled task or service wrapper (Step 3 artifact).

---

### Phase D — Indexing

#### Step 4a — Incremental
Trigger (Step 2) is the enqueue source. Pollers drain. **No bridge/windows edits.** Done when a new ingest is searchable within ~5 s + embed time. Proof in acceptance doc + `test_trigger_enqueues_on_thumbnail`.

#### Step 4b — Backfill `rebuild-image-vectors` (enqueue/status only)
Register `OP_NAMES` / `OP_LANES` / `OP_CONFLICTS` — **lane `embed`, conflicts `["ai-tag-all"]` with symmetric back-edge in all three mirrors** (`operation-registry-sync.test.ts`) (**L-6**). Worker dispatch: **`operation-loop.ts` `case "rebuild-image-vectors"`** (+ summary branch, same pattern as `ai-tag-group-profiles`) (**L-6**). Handler `apps/worker/src/handlers/image-embed-backfill.ts`: cursor enqueue of **stale** assets (`no vector` or `last_embedded_thumbnail_url is distinct from assets.thumbnail_url` or `embedding_model` not in active stamps) + read `public.image_embed_status`. **Never embeds.** UI `src/components/settings/ImageEmbedCard.tsx`. **Estimate (M-F):** tooltip must use **Step 1 measured s/image** × count ÷ (2 GPUs × batch 8). If only sequential measured: show `hours = N × s / 2` and say so — do not claim 1–2.5 h unproven.

---

### Phase E — Product

#### Step 5 — Edge + UI

Edge `supabase/functions/image-similarity/` (`verify_jwt=false` + `authenticateUser`):

| Action | Body | Behavior |
|--------|------|----------|
| `search` | image bytes ≤ 15 MB + magic bytes | enqueue query job via **`serviceClient`** → poll `public.image_embed_query_status` every **2 s** up to 15 s → if done: read tunables + `p_model_stamps` from `admin_config` (serviceClient) → **`auth.client.rpc("search_dam_image_similarity", …)`** (Muse 7) → matches |
| `query-status` | `{query_job_id}` | same status shape (Muse 5) |
| (410) | — | if `IMAGE_SIM_ENABLED` false |

Response (stable): `{ status: "ok"|"pending"|"unavailable"|"rejected"|"disabled", query_job_id?, reason?, matches:[…], floor, weights, truncated }`.  
HTTP codes: **200** ok/pending/rejected/disabled body; **503** unavailable; **400** bad upload; **413** oversize. Band labels **frontend only**. **`unavailable` iff `public.image_embed_status().workers_fresh` is false** (**H-1** — never call `dam.*` over PostgREST). `rejected` when `image_embed_query_status` is `failed` with permanent reason. `truncated` = hit `p_limit`.

UI: drop zone `src/components/library/LibraryTopBar.tsx`; results `ImageSimilarityResults.tsx`; flag via one `admin_config` read (hide if `IMAGE_SIM_ENABLED` false). **If response is `pending` with `query_job_id`, the UI polls the `query-status` action every 2 s until terminal** (**M-E**) — never leave the user on a static “pending”.

**Spike follow-up in this step if Step 1 chose signed-URL:** document that path here.

#### Step 6 — Tunables
`admin_config` (defaults modules: frontend `src/lib/image-similarity-config.ts`, edge `supabase/functions/_shared/image-similarity-config.ts`, poller `config.py` — Muse 18):

| Key | Default |
|-----|---------|
| `IMAGE_SIM_FLOOR` | 0.90 |
| `IMAGE_SIM_BAND_SAME_EXPORT` / `_SAME_ART` / `_CLOSE` | 0.98 / 0.94 / 0.90 |
| `IMAGE_SIM_DINO_WEIGHT` | 0.60 |
| `IMAGE_SIM_TOP_K` | 200 |
| `IMAGE_SIM_ENABLED` / `IMAGE_EMBED_ENABLED` | false / false | `IMAGE_SIM_ENABLED` gates UI + edge 410; **`IMAGE_EMBED_ENABLED` gates trigger enqueue + poller claim loops** (read by poller from `admin_config` and by trigger path via a `dam.image_embed_enabled()` helper) (**L-3**) |
| `IMAGE_SIM_EMBEDDING_MODEL` | current stamp string | Single source of truth |
| `IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS` | empty until first upgrade | |
| `IMAGE_SIM_REEMBED_IN_PROGRESS` | false → stamps `[current]`; true → `[current, previous]` | **Flip-off procedure (L-8):** after backfill reports zero rows with `PREVIOUS` stamp, admin (or worker once) sets flag false and clears `IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS` |

Edge **must** pass floor/weight/top_k/stamps into the RPC (DeepSeek B3). Verify: change floor to 0.85 → 85%+ visible without redeploy.

#### Step 7 — Live proof
Production backfill; 20 real pairs (bordered + white-ground); calibrate **cutoffs** on fp16 scores; close `- [ ] live proof` on the **same** tracking issue.

---

## 10. Tests (named)

| Test | Where |
|------|--------|
| `test_border_crop_*` (tolerance 12, 25% guard, EXIF) | Python poller |
| `test_poller_rejects_bomb` / `unsupported` | Python |
| `test_upsert_rejects_bad_dims` | Python / SQL |
| `test_trigger_enqueues_on_thumbnail` | shared-db SQL |
| `test_claim_exclusive` / `test_query_claim_one` | shared-db SQL |
| `test_search_explain_uses_hnsw` (`enable_seqscan=off`) | shared-db SQL |
| `test_search_model_stamp_filter` | shared-db SQL |
| `test_embed_workers_fresh_stale` | shared-db SQL |
| `test_purge_image_embed_jobs` | shared-db SQL |
| `test_edge_query_status_route` | edge tests |
| `test_search_times_out_honestly` / `unavailable` / `rejected` | edge tests |
| `image-similarity-bands.test.ts` at **0.98 / 0.94 / 0.90 / 0.89(hidden)** | frontend |
| `operation-registry-sync.test.ts` | existing |
| `npm run typecheck` + suites | CI |

---

## 11. Constraints and gotchas

- No app-repo migrations; shared-db only.
- Feature branch + PR to `main`.
- **Never PostgREST-call `dam.*`.** Public wrappers only (Muse 1).
- **Never put `SUPABASE_SERVICE_ROLE_KEY` on desktops** (§12 must match).
- Secrets: 1Password `vibe_coding` — `HuggingFace DINOv3 token`, `dam_image_embed_login` password. No values in git/chat.
- Live project `qsllyeztdwjgirsysgai`.
- `extensions.` qualification on vector SQL.
- No ScaleDown; no bridge/windows edits.
- Times in **EST**. UI needs named screenshots.

### Adversarial-cases table

| Input | Hostile case | Test |
|-------|--------------|------|
| Upload | Non-image | `test_upload_rejects_non_image` |
| Upload | Truncated | `test_upload_rejects_truncated` |
| Upload | Bomb | `test_poller_rejects_bomb` |
| Upload | > 15 MB | `test_upload_rejects_oversize` |
| Upload | HTML/SVG polyglot | `test_upload_no_html_echo` |
| Upload | Path/filename junk | `test_upload_sanitizes_name` |
| Upload | EXIF | `test_border_crop_exif` |
| Upload | TIFF/PSD/animated | `test_poller_rejects_unsupported` |
| Upload | White ground | `test_border_crop_spares_white_ground` |
| Jobs | Two pollers | `test_claim_exclusive` |
| Jobs | Duplicate index enqueue | `test_unique_pending_index` |
| Jobs | Stale query job | TTL purge + fail after N |
| Worker | Wrong dims | `test_upsert_rejects_bad_dims` |
| Worker | Offline | `test_search_unavailable_when_no_worker` |
| Poller reject | dims/unsupported | `test_search_rejected_when_poller_rejects` |
| Caller | Unauth / no DAM | contracts + edge auth |
| RPC args | OOR | clamped (`contracts`) |
| Direct write | Tamper vectors | role grants + RLS (`contracts`) |
| Bytea | 15 MB body | Step 1 proof |
| Latency | Slow embed | 15 s + honest body |

---

## 12. Access and environment

| Need | Where |
|------|--------|
| Tracking issue | Step 0b URL |
| shared-db | `popcre/shared-db` |
| GPU desktops | outbound **pooler TCP 5432 + TLS** only |
| DB login | **`dam_image_embed_login`** password (1Password) — **not** service-role |
| HF | `HF_TOKEN` (1Password) |
| Edge | `serviceClient` for enqueue/status/config; `auth.client` for search |
| Times | EST |

---

## 13. Done / risks / open

### Done when
Issue filed; spike doc (incl. bytea + license); shared-db PR merged; pollers + heartbeat live; incremental proof; backfill delta-only; UI 90%+; floor retune proof; adversarial + typecheck green; live SHA verified; acceptance doc; live-proof checkbox closed.

### Risks
| Risk | Mitigation |
|------|------------|
| Border quality | Phase A gate; crop guard |
| Desktop offline | Heartbeat → unavailable; jobs pending |
| Dims ≠ 768 | Step 1 gate |
| Model upgrade empty search | Multi-stamp window (`REEMBED_IN_PROGRESS`) |
| PostgREST 15 MB fail | Step 1 proof → signed-URL fallback |
| shared-db delay | `IMAGE_SIM_ENABLED` off |

### Open
1. Band cutoffs after production calibration.
2. PopSG image search in/out (default out).

---

## 14. Muse pass 1–2 → GLM → DeepSeek record

See §15. All prior blockers integrated. §14 table kept in git history of this file when rewritten.

## 15. Integration map (Muse 18 + prior)

| Finding | Fix |
|---------|-----|
| M-1 `dam.*` via PostgREST | `public.*` wrappers; §2, Step 2, Step 5 |
| M-2 dual table names | one `dam.image_embed_jobs` |
| M-3 HTTPS vs TCP | pooler TLS TCP 5432; retry on SQL errors |
| M-4 §12 service key | `dam_image_embed_login` only |
| M-5 re-poll route | edge action `query-status` |
| M-6 unavailable detection | mandatory heartbeat + `workers_fresh(90)` |
| M-7 caller-scoped search | `auth.client` vs `serviceClient` |
| M-8 re-embed empty window | `p_model_stamps` / `REEMBED_IN_PROGRESS` |
| M-9 stamp spec | construction + admin_config + poller write |
| M-10 EXPLAIN red-on-arrival | `enable_seqscan=off` |
| M-11 ef_search | `set local` in RPC |
| M-12 enqueue dedup | unique partial index + trigger `on conflict` |
| M-13 signatures “...” | full signatures Step 2 |
| M-14 indexes/retention | job index + purge fn |
| M-15 query claim shape | claim 1 / lease 30 s |
| M-16 bytea proof home | Step 1 item 7 |
| M-17 NOLOGIN role | `dam_image_embed_login` member |
| M-18 defaults in importable modules | three modules named |
| D-B1–B5 | trigger; wall-clock; tunables pass-through; stamp filter; partial WHERE |
| G-1–3 | query jobs; backfill enqueue-only; dedicated role |
| Non-blocks | HTTP codes, poll 2 s, band tests at boundaries, `ImageEmbedCard.tsx` only, lane name `embed`, secrets wording, license appendix |

## 16. Verdict chain

Muse REVISE (10) → GLM REVISE (3) → DeepSeek REVISE (5) → Muse REVISE (18) → **this revision**. Next: Muse pass 3.

---

## Appendix A — Owner blueprint excerpts (Dropbox, not in git)

Models: `facebook/dinov3-vitb16-pretrain-lvd1689m` (Meta dinov3-license, gated) + `google/siglip2-base-patch16-naflex` (Apache-2.0). Intent: dual `halfvec(768)`, HNSW, blend 0.6/0.4.

**Changed here:** no side catalog; `extensions.*`; top-K then blend; pull workers; public wrappers; trigger enqueue; product UI/bands; no ScaleDown.

---

## Related

- Handoff: [HANDOFF.d/2026-10-22T1323Z-edge-dev-mimo-image-similarity-plan.md](HANDOFF.d/2026-10-22T1323Z-edge-dev-mimo-image-similarity-plan.md)
- Muse extracts: `.ai/reviews/muse-image-similarity-plan-audit-extracted.md`, `...-audit2-extracted.md`
- GLM: `.ai/reviews/glm-image-similarity-plan-glm-review-*.md`
- DeepSeek session: `20261022-151744-2210561`
- `plan_hybrid_search_rollout.md` — do not implement inside those PRs
