---
issue: 97
status: OPEN
owner: mimo/edge-dev-dinov3-siglip2-ready
---

# HANDOFF — DINOv3 + SigLIP 2 ready on edge-dev; image embeddings not in the database yet

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**Put this whole list to the owner in ONE message before starting work.**

### Blocking / needs a yes-no

1. **Build the picture-embedding home and fill it?** (find similar artwork)
   - Recommendation: **Yes** — both models are already installed and proven on this PC; the design has been reviewed three times.
   - What it blocks: any “find visually similar” feature in PopDAM. Until yes, the models sit idle.
   - Plain meaning: store a numeric fingerprint of each artwork picture so the system can find look-alikes.

### Already settled — do NOT re-ask

- **2026-10-23:** Facebook approved DINOv3 access; Hugging Face key is already in 1Password. No further account work.
- **2026-10-23:** Both models must run on the owner’s GPU desktops (this PC is one of them) — not on the cloud worker. Settled in the design reviews.

### Out of this workstream, nobody on it

- None.

---

## 1. What this application is

**PopDAM** is the internal art library for licensed products (Disney, Marvel, …). Designers and managers search artwork, check style groups, and approve files. Repo: https://github.com/u2giants/popdam3 — web app + shared Supabase database (`popcre/shared-db`). Same codebase also serves **PopSG** (style-guide mode) on another address.

**This session’s machine:** Windows PC `edge-dev`, with an NVIDIA RTX 3060 Ti GPU. It is one of the owner GPU desktops intended to turn artwork pictures into numeric fingerprints.

## 2. What we set out to do this session, and why

**Goal (business):** Get DINOv3 and SigLIP 2 fully running on this computer so PopDAM can later support “find similar artwork.”

**Trigger:** Albert asked whether the two models were installed. They were not (only half of one was). He then said “i want them fully running here,” later confirmed Facebook approval and pointed at the Hugging Face key in 1Password, then asked follow-up questions about whether the database can store these picture fingerprints.

**Technical objective:** install the AI runtime, download both models (official Facebook DINOv3 once the key was available), and prove each one with a real inference run on the GPU.

## 3. Current state — what is true right now

### Done and verified (this PC, 2026-10-23, about 2:55 PM EDT)

| Piece | State | Proof |
|---|---|---|
| AI runtime (PyTorch 2.6 CUDA + Transformers 5.20 + timm) | Installed for user Python 3.13 | `torch.cuda.is_available()` True, device name NVIDIA GeForce RTX 3060 Ti |
| **DINOv3 official** `facebook/dinov3-vitb16-pretrain-lvd1689m` | Downloaded + ran | Model type `DINOv3ViTModel`, 85,660,416 params; features (1, 201, 768), pooled (1, 768), all finite; GPU |
| **SigLIP 2** `google/siglip2-base-patch16-naflex` | Downloaded + ran | image (1, 768), text (2, 768), all finite; GPU; zero-shot cosine scores computed |
| Hugging Face key | Already in 1Password | vault `vibe_coding`, item title `hugging face read access token meta dinov3 model`, field `credential` |
| PopDAM database picture-fingerprint columns | **NOT built** | No image-embedding table/columns exist in `popcre/shared-db`. Only text-search embeddings exist (below). |
| PopDAM text-search embeddings | Already live | `dam_search_documents.embedding` is 384-dim text (`gte-small`) — **not** a home for these picture models |

### Half-done / not started

- **Image-similarity feature (find similar artwork):** designed and reviewed, **not built**. Waiting on owner yes (§0). Design reviews live as untracked local files (not on GitHub yet):
  - `.ai-review-brief-image-similarity-plan.md` and muse/glm siblings in the repo root (untracked)
  - Review extracts under `.ai/reviews/muse-image-similarity-plan-audit*.md` (untracked)
- **`plan_image_similarity_upload_search.md` was missing from this working tree while the session ran** (it was untracked during the 2026-10-22 reviews). After PR https://github.com/u2giants/popdam3/pull/484 merged, `git pull` showed it is now on `main`: https://github.com/u2giants/popdam3/blob/main/plan_image_similarity_upload_search.md . Use that file as the design; do not re-plan from scratch.

### Commit / push / deploy status

- **No PopDAM application code was changed this session.** Nothing to deploy.
- This handoff file is the only intended commit from this session (see §6).
- Untracked noise in the working tree is **other sessions’** work — do not commit or delete it (list in §7).

## 4. Everything we tried that did NOT work

1. **Download official Facebook DINOv3 without a Hugging Face login.**
   - Why it seemed reasonable: the model is listed publicly.
   - How it failed: `GatedRepoError` 401 — Meta’s repo requires accepted license + login.
   - Fallback used at first: `timm/vit_base_patch16_dinov3.lvd1689m` (open, same architecture class) so the runtime could be proven.
   - Final path once Albert said Facebook approval landed: used the 1Password key via `1password_op_run` (never printed the token) and pulled `facebook/dinov3-vitb16-pretrain-lvd1689m`. **That official model is what is installed and proven now.** The timm copy is still in the local Hugging Face cache and can be ignored or deleted later.

2. **`nvidia-smi` as a GPU check.**
   - Failed with `Failed to initialize NVML: Unknown Error` (common on this Windows box).
   - GPU was confirmed instead via Windows `Win32_VideoController` (RTX 3060 Ti) and `torch.cuda.is_available()`.

3. **PowerShell heredoc for a Python smoke test.**
   - Failed (`ParserError`). Workaround: write a temp `.py` file under the user temp directory and run it. Those temp scripts are **outside the repo** and are not deliverables.

4. **`ai-shared-db-closeout-check` could not finish (`ok: false`).**
   - Returned empty `blocking_claims` and `blocking_stages`, but `error: GitHub request timed out` (exit 2) on every attempt (about 2:58–3:01 PM EDT). Direct `gh` calls worked.
   - This session held **no** shared-db claims (it never touched `popcre/shared-db`). Treat the checker failure as a **tool/GitHub residual**, not as proof of hidden claims. Re-run the checker when GitHub is healthy.

## 5. Root causes and key findings

1. **“DINOv3 installed” can mean three different things.** (a) Python libraries, (b) model weights on disk, (c) a proven GPU inference run. Only (c) is “fully running.” This session achieved (c) for both models.

2. **The database already has an embedding column, but it is the wrong kind.** `public.dam_search_documents.embedding` is `vector(384)` for **text** search (`gte-small`), with an HNSW index. Picture models output 768-dim vectors and need their own home (planned as two half-precision vector columns + model-version stamp + freshness markers). See https://github.com/u2giants/popdam3/blob/main/docs/SCHEMA.md and https://github.com/popcre/shared-db (canonical migrations).

3. **The reviewed image-similarity design already includes the bookkeeping Albert asked about:** a model-version stamp (what wrote the numbers), a current/previous stamp window for safe re-embedding, and last-embedded thumbnail markers so a changed picture is redone. Reviewers asked that image-prep settings be folded into that stamp; that was accepted in review notes (2026-10-22).

4. **Facebook’s official DINOv3 is license-gated on Hugging Face.** Without the key in 1Password this cannot be installed. Do not paste the key anywhere; use 1Password secret references / `1password_op_run`.

5. **Text hybrid search is a separate workstream** (issue https://github.com/u2giants/popdam3/issues/97 , plan https://github.com/u2giants/popdam3/blob/main/plan_hybrid_search_rollout.md ). That plan explicitly says image/CLIP-style embeddings stay **separately gated** and need owner approval before implementation.

## 6. Exact next steps

1. **Ask Albert the one business question in §0** (build picture embeddings or not) in a single message together with any other open owner questions from other handoffs. Recommendation: yes.
2. **If yes:** use https://github.com/u2giants/popdam3/blob/main/plan_image_similarity_upload_search.md as the design, then implement through the **canonical `popcre/shared-db` branch + PR** path (never app-side DDL). Dual columns for DINOv3 + SigLIP 2 (768 dims each), model-version stamp, freshness markers, job/lease queue — matching the reviewed design. Verification gate: a migration lands on shared-db, a GPU worker run writes both vectors for one asset, and a similarity query returns a sensible neighbour list.
3. **If no:** leave the models on this PC; do not build schema. Verification gate: nothing new in shared-db.
4. **Optional cleanup (only if asked):** the earlier timm DINOv3 cache copy can be removed once the official model is the only one in use. Not urgent.
5. **Re-run `ai-shared-db-closeout-check --session-id ses_ffe5e968e81d5ffevSR9vK3hnH`** when GitHub is healthy. Success looks like `ok: true` with empty blocking lists. (Technical, not an owner ask.)

## 7. Constraints and gotchas in force

- **Shared database:** every structure change is authored in `popcre/shared-db` (branch + PR + timestamped migration), never in this app repo. Load the shared-db change skill before any schema work.
- **Never push application/docs changes straight to protected `main`.** Feature branch → PR → merge.
- **Never print or commit secrets.** Hugging Face key lives only in 1Password vault `vibe_coding`.
- **Concurrency:** other sessions have untracked files in this checkout (review briefs, verification screenshots, `proto_wallpool*.sql`, `.ai/`, `.tmp-liveproof-243/`, `.playwright-cli/`). Do not `git add -A`, do not delete them. Stage only your own files.
- **`src/integrations/supabase/types.ts` is generated** — do not hand-edit.
- **AG Grid license warning is accepted** (owner instruction) — ignore it.
- **Windows quirk:** `nvidia-smi` may fail with NVML error even when the GPU works.

## 8. Access and environment

| Item | Where / value (no secrets) |
|---|---|
| Machine | Windows `edge-dev`, Python 3.13 (`C:\Program Files\Python313\`), user site-packages |
| GPU | NVIDIA GeForce RTX 3060 Ti; PyTorch `2.6.0+cu124` sees CUDA |
| Hugging Face key | 1Password vault `vibe_coding` → item `hugging face read access token meta dinov3 model` → field `credential` |
| Official DINOv3 | Hugging Face `facebook/dinov3-vitb16-pretrain-lvd1689m` (gated; key required) |
| SigLIP 2 | Hugging Face `google/siglip2-base-patch16-naflex` |
| Model cache | User Hugging Face cache on this PC (`%USERPROFILE%\.cache\huggingface\hub`) |
| GitHub | `gh` logged in as `u2giants` on this machine |
| Temp smoke-test scripts | User temp dir, `verify_dinov3_siglip2.py`, `install_official_dinov3.py` — not project files |

## 9. Open questions and risks

- **2026-10-23:** Whether to build picture embeddings is still an owner decision (§0). Until then the GPU install is idle capacity.
- **2026-10-23 (corrected after merge):** `plan_image_similarity_upload_search.md` is on `main` (https://github.com/u2giants/popdam3/blob/main/plan_image_similarity_upload_search.md) even though it was absent from this working tree during the session. Earlier “missing plan” risk is closed for anyone who pulls current `main`.
- **2026-10-23:** `ai-shared-db-closeout-check` is currently unreliable when GitHub times out; do not treat its exit code as proof of claims without reading its JSON body.
- **Scope note:** issue https://github.com/u2giants/popdam3/issues/97 is **text** hybrid search. Do not close #97 because this handoff’s models are ready — image embeddings are a separate gated item under that umbrella.

---

## Self-audit (handoff-writer gate)

1. **Comprehensive for a brand-new developer?** **Yes** — §1 orients the app and machine; §3 tables what is proven; §6 gives ordered next steps with verification gates; §8 lists every secret *location* and tool.
2. **As effective as this session?** **Yes** — includes the gated-repo dead end, NVML false alarm, closeout-check residual, text-vs-picture embedding distinction, and the plan-file timing note (absent locally during the session, present on `main` after merge) (§4–§5).
3. **Every relevant detail for flawless execution?** **Yes** — background (§1–§2), state (§3), failures (§4), findings (§5), next actions (§6), constraints (§7), access (§8), risks (§9). File refs use GitHub URLs where the content is on GitHub; untracked local review files are named as untracked on purpose.
4. **If the owner read only §0, would he see every business decision and no technical approval?** **Yes** — one business yes/no (build picture embeddings), plus settled items marked do-not-re-ask. Technical residual (closeout-check) is in §6 as a tool step, not an owner ask.

Posted by MiMo chat ses_ffe5e968e81d5ffevSR9vK3hnH on edge-dev
