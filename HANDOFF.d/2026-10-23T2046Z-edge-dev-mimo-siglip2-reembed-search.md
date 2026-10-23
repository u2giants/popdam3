---
issue: 97
status: OPEN
owner: mimo/edge-dev-siglip2-reembed-search
---

# HANDOFF — #97 semantic search: switch to SigLIP2/768 picture vectors (schema is live)

Written 2026-10-23 4:46 PM EDT on `edge-dev` by MiMo session `ses_ffe5e9aa36379ffe4tharsb5Zc`.

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**Put this whole list to the owner in ONE message before starting work.**

### Already settled — do NOT re-ask

- **2026-10-22 (Albert):** Replace the old search numbers with `google/siglip2-base-patch16-naflex` picture vectors. The model looks at the artwork image, not just the text description. Run the whole library through it.
- **2026-10-22 (Albert):** Use the unused NVIDIA GPU on this PC (`edge-dev`, RTX 3060 Ti). Set up Python + PyTorch/CUDA + that model. Done and proven.
- **2026-10-23:** shared-db PR https://github.com/popcre/shared-db/pull/4665 is **merged** and **applied to production** (migration `20261023184940`). Search table now holds 768-number picture vectors. Old 384-number text vectors were cleared on purpose (wrong model).
- Keyword (exact-word) search stays as-is. Only the meaning/semantic layer changes.
- PopSG is out of scope. Do not touch PopSG.

### Blocking / needs a yes-no

None right now. Albert already chose the model and the GPU path.

### Out of this workstream, nobody on it

- Image-upload “find the same picture” UI is a **separate** feature: https://github.com/u2giants/popdam3/blob/main/plan_image_similarity_upload_search.md (handoff `HANDOFF.d/2026-10-23T1901Z-edge-dev-mimo-dinov3-siglip2-ready.md`). Do not mix it into #97 search work.

---

## 1. What this application is

**PopDAM** (`https://github.com/u2giants/popdam3`) is POP Creations’ internal artwork library. Designers search ~150k licensed art records. Web app at `https://dam.designflow.app`. Data lives in the shared Supabase Postgres project `qsllyeztdwjgirsysgai` (Virginia). Schema changes only via `https://github.com/popcre/shared-db`. There is **no separate vector database** — pgvector is an extension inside that same Postgres.

This session’s machine: Windows PC **`edge-dev`** with an **NVIDIA GeForce RTX 3060 Ti**. It is the GPU box that turns artwork thumbnails into 768-number picture vectors.

## 2. What we set out to do this session, and why

**Business goal:** Search should find art by what it *looks like* / means, not only exact words. Albert chose Google’s SigLIP 2 model (looks at the image) and this PC’s GPU so we stop paying cloud time-outs for embeddings.

**Trigger:** Hybrid search (#97) was stalled — cloud embedding job died (PC reboot + HTTP 546 time-outs). Albert said: use the GPU, use SigLIP2, replace the current search numbers.

**This session did:** proved the GPU + model; built a local embedder; landed the database change (now live in production). **Did not yet:** re-embed the library or switch live search.

## 3. Current state — what is true right now

### Done and verified

| Piece | State | Proof |
|---|---|---|
| GPU + PyTorch/CUDA | Working on `edge-dev` | `torch.cuda.is_available()` True; device `NVIDIA GeForce RTX 3060 Ti`; `nvidia-smi` fails only because of RDP — ignore it |
| Model `google/siglip2-base-patch16-naflex` | Installed + proven | Text→768 and image→768; Spider-Man thumbnail ranked first for query “spider-man”; cartoon ranked first for “a photo of a cartoon character” |
| Speed | ~13 ms / image; ~110 images/s batched | Full ~150k library ≈ 25 minutes of GPU time |
| Local embedder tool | On **`edge-dev` only**, folder `D:\ai\siglip2-embed\` | `embed_artwork.py` (images + text modes), `smoke_test.py`, `bench_image.py`. **Not in git.** If missing, recreate from §5 recipe |
| Database schema | **LIVE in production** | https://github.com/popcre/shared-db/pull/4665 merged `29e9375a`; migration `20261023184940` applied to `qsllyeztdwjgirsysgai` (run 40013486237). `dam_search_documents.embedding` is now `vector(768)` |
| Claim / work issue | Claim https://github.com/popcre/shared-db/issues/4669 closed. Work issue https://github.com/popcre/shared-db/issues/4664 still open until live search works | Closeout comment on #4664 |
| Old text vectors | **Cleared on purpose** (384-dim gte-small, wrong model). ~56k old vectors gone. All ~150,760 documents need new picture vectors | By design in the migration |

### Not started

- Bulk re-embed of the library from thumbnails (GPU tool exists; has not been run for the full library).
- Query-time path: when someone types a search, the words must become a 768-vector with **this same model** (text tower). Production currently still uses the old cloud text embedder in `dam-search-ai`.
- Turning on hybrid/semantic mode for live users (`SEARCH_MODE`).
- Closing https://github.com/u2giants/popdam3/issues/97.

### Commit / push / deploy status

- shared-db change: **merged and applied to production** (above).
- No PopDAM app code changed for the switch yet. Frontend/edge/worker still assume the old text-embed path.
- GPU tool lives only on `edge-dev` at `D:\ai\siglip2-embed\` (untracked). Next session on another machine must rebuild it (§5).

## 4. Everything we tried that did NOT work

1. **Cloud embedding (Supabase Edge AI `gte-small`)** for the old search numbers.
   - Failed with HTTP **546** (CPU time limit) on long text; then the PC rebooted 2026-10-21 1:46 PM EDT and killed the local retry loop. That is why we switched to the GPU.
2. **`nvidia-smi` to prove the GPU.**
   - `Failed to initialize NVML: Unknown Error` because this is an RDP session. PyTorch still sees the card. Do not “fix” the driver; use `torch.cuda.is_available()`.
3. **Wrong SigLIP2 embedding math (first attempts).**
   - Double-applied `text_model.head`, or compared unnormalized features. Official path: use `pooler_output` from text/vision towers, L2-normalize both, cosine. Ranking then matched official logits (Spider-Man / cartoon cases).
4. **shared-db PR #4665 first CI runs failed.**
   - Missing ref-backed author claim → created claim #4669 via `manage-migration-author-lanes --claim` (must `--admit-issue` first; issue needs a `db-work-scope` block).
   - Claim owner had a `/` in it (`mimo/...`) which is invalid for `SHARED_DB_SESSION_ID` → owner must be slash-free (`mimo-edge-dev-issue97-siglip2`).
   - Author check-in required (`--check-in-author`); lease expires in ~30 minutes and check-ins are only valid ~10 minutes — renew + check in immediately before CI.
   - Tests still expected 384-dim vectors (`array[382]` padding) → updated to 768 / `array[766]`.
5. **Reviewer tooling outage at merge time (other session).** deepseek skipped; muse/glm crashed. Merge used admin/owner-override. Do not treat that as a permanent policy.

## 5. Root causes and key findings

- **Same database.** Vectors live in `dam_search_documents.embedding` (`extensions.vector(768)`) in the ordinary shared Supabase Postgres. pgvector is an extension there, not a separate product.
- **Model contract:** `google/siglip2-base-patch16-naflex`, 768 dims, L2-normalized. `embedding_model` column must be exactly that string (search SQL filters on it).
- **Image source:** `dam_search_documents.metadata->>'thumbnail_url'` (CDN `https://popdam.nyc3.digitaloceanspaces.com/thumbnails/{asset_id}.jpg`). Claim function now also returns `thumbnail_url`.
- **Claim + upsert RPCs** (service-role): `claim_dam_search_embedding_documents` → rows with lease + `thumbnail_url`; write with `upsert_dam_search_embedding` (default model stamp is SigLIP2). Lease token + `content_sha256` must match.
- **Embedder recipe (edge-dev `D:\ai\siglip2-embed\embed_artwork.py`):**
  - `images --input jobs.jsonl --output vecs.jsonl` where jobs are `{"id","url"}`.
  - `text --input queries.txt --output qvecs.jsonl` for query words.
  - Image: `get_image_features` → `pooler_output` → L2 normalize. Text: `text_model` → `pooler_output` → L2 normalize. Do **not** apply `text_model.head` on top.
- **Throughput:** batch 32 ≈ 110 images/s on this GPU. Full library ~25 minutes plus download time.
- **Search function** `search_dam_documents` semantic leg now requires `embedding_model = 'google/siglip2-base-patch16-naflex'` and `vector_dims = 768`.
- **Query text must use the same model’s text tower** or scores will not line up. The deployed edge function still uses `Supabase.ai.Session("gte-small")` — that path **must change** before live hybrid mode.

## 6. Exact next steps

1. **Confirm production shape.** Read-only: `dam_search_documents.embedding` is `extensions.vector(768)`; `idx_dam_search_documents_embedding_hnsw` exists; `claim_dam_search_embedding_documents` returns `thumbnail_url`. You’ll know it worked when those three are true on `qsllyeztdwjgirsysgai`.
2. **Ensure the GPU tool is available on `edge-dev`.** If `D:\ai\siglip2-embed\embed_artwork.py` exists, use it. If not, recreate the venv + script per §5 (PyTorch cu124, transformers ≥5.20, `google/siglip2-base-patch16-naflex`). You’ll know it worked when a 5-image smoke run prints `dim=768` and no errors.
3. **Bulk re-embed the library from thumbnails.** Enumerate pending rows (embedding is null) via service-role claim/RPC or a read-only dump of `id` + `thumbnail_url`. Feed `embed_artwork.py images`. Upsert each vector with `upsert_dam_search_embedding` + lease from `claim_dam_search_embedding_documents`. Resume-safe: same run, never reset attempts without cause. You’ll know it worked when `get_dam_search_embedding_status` shows pending 0 / embedded ≈ 150k and zero exhausted, and model stamp is SigLIP2 on all rows.
4. **Query-time text path.** When a user types words, embed them with SigLIP2 **text** tower (768) before calling `search_dam_documents`. Options: small local/edge service on a GPU box, or app-side call into a worker that has the model. Do not leave `gte-small` in the query path. You’ll know it worked when a live typed query returns ranked picture matches (Spider-Man / cartoon style check).
5. **Turn on hybrid for DAM only** after gates: full coverage, semantic floor decided (plan used **0.85** as a starting point; remeasure), paraphrase/relevance spot-check, latency under 5 s, keyword path still exact. Rollback = set search mode back to keyword. Observe 24 h. You’ll know it worked when designers get useful picture-based results and keyword still works.
6. **Closeout.** Post live proof on https://github.com/u2giants/popdam3/issues/97; close it only after administrator/designer/viewer journeys pass. Close https://github.com/popcre/shared-db/issues/4664 if still open. Delete this handoff in the finishing commit. Then re-read remaining phases (below) and report drift.

**Downstream phases (re-read these at the end of every phase and report drift):** query-time embed path → bulk coverage proof → relevance gates → `SEARCH_MODE=hybrid` activation + 24 h observation → #97 closeout. Image-upload similarity (`plan_image_similarity_upload_search.md`) stays a **separate** track.

## 7. Constraints and gotchas in force

- Feature branch + PR to `main` in popdam3; never push app changes straight to `main`.
- Shared DB structure only through `popcre/shared-db` (claim-first). App-side DDL is forbidden.
- Never mix vectors from different models/dims in the same column.
- Keyword search must keep working (exact words, SKUs, paths).
- PopSG out of scope.
- `nvidia-smi` is broken over RDP on `edge-dev` — not a real GPU failure.
- Author claim leases expire in ~30 minutes; check-in windows ~10 minutes. Renew before any protected shared-db action.
- Do not reuse migration versions `20261022235900`, `20261023010034`, or `20261023184940`.
- This handoff is write-once. Do not edit other sessions’ `HANDOFF.d/` files.

## 8. Access and environment

- **Machine for GPU work:** `edge-dev` (Windows). GPU: NVIDIA GeForce RTX 3060 Ti.
- **Python env:** `D:\ai\siglip2-embed\.venv` (torch 2.6.0+cu124, transformers 5.20.2). Invoke `.venv\Scripts\python.exe`.
- **Database:** Supabase project `qsllyeztdwjgirsysgai`. Read-only management SQL and service-role REST used previously via local env files under the issue97-embedding evidence dir (do not copy secrets into the handoff).
- **Secrets:** 1Password vault `vibe_coding` (e.g. Supabase tokens). Never print values.
- **GitHub:** `gh` as `u2giants` can read/PR `popcre/shared-db` and `u2giants/popdam3`.
- **Shared-db session id** for lane tools: `SHARED_DB_SESSION_ID=mimo-edge-dev-issue97-siglip2` (slash-free).

## 9. Open questions and risks

- **Query embedding hosting** (step 4) is the main unsolved production piece. Needs a home that the web app can call. Prefer a small always-on service or a worker call — do not ship hybrid with a gte-small query and SigLIP2 documents.
- **Semantic floor:** 0.85 was a planning starting point for the old text model. Picture vectors may need a different floor — remeasure with a few real queries before enabling.
- **Coverage vs freshness:** nightly style-group replacement (~9k) will dirty vectors. Plan for incremental re-embed on change (`content_sha256` / thumbnail URL change), not only a one-shot backfill.
- **2026-10-23:** Another session applied production with owner-override because reviewer tools were down. That is recorded on #4664; do not assume the same shortcut for app deploys.
- Untracked files in the popdam3 working tree may belong to other sessions — do not delete them.

---

### Self-audit (handoff-writer)

1. **Comprehensive for a brand-new developer?** Yes — §1 app, §3 live state, §5 model/tool recipe, §6 numbered steps with gates, §8 access.
2. **As effective as this session?** Yes — dead ends (§4) and the exact embedding math (§5) are written down; GPU tool location and recreate path included.
3. **Every detail for flawless execution?** Yes — identifiers (issues, PR, migration, model name), deploy status, constraints, and verification gates per step.
4. **If the owner read only §0?** Yes — settled decisions listed; no technical approvals; nothing else needs Albert right now.
