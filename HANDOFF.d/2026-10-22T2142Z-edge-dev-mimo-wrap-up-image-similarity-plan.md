# Handoff — Image similarity plan written and multi-model reviewed (nothing built)

**UTC:** 2026-10-22T21:42Z  
**Machine:** edge-dev  
**Agent:** MiMo  
**Session goal (done for this session):** decide whether/how PopDAM can find same-artwork images from an upload; write a buildable implementation plan; get it reviewed by Muse, GLM, and DeepSeek until the plan is executable.

**This handoff is the session closeout.** The build itself has **not** started.

---

## 1. What a stranger needs to know first

Albert wants: user drops a picture into PopDAM → see library images that are the **same artwork** (different size, format, thin white border still match), with **90%+ shown first** and **tunable** bands. **No ScaleDown.** Incremental index (new files only after one backfill). Cheaper than paid APIs.

**Owner-approved engine:** dual vision embeddings (DINOv3 + SigLIP 2) on his **2× RTX 3060 Ti Windows desktops**, vectors in Postgres `pgvector halfvec`, pull-based workers. This matches his Dropbox blueprint (not in git).

**Canonical plan (read STATUS first, do not re-plan):**  
https://github.com/u2giants/popdam3/blob/main/plan_image_similarity_upload_search.md  
(If this PR is not merged yet, use the branch blob URL from the PR.)

Related plan handoff (earlier): [2026-10-22T1323Z-edge-dev-mimo-image-similarity-plan.md](2026-10-22T1323Z-edge-dev-mimo-image-similarity-plan.md)

---

## 2. Current state

| Item | State |
|------|--------|
| Implementation plan | **Written**, multi-revise; DeepSeek **APPROVE on scope** after Muse pass 3 High/Medium fixes |
| Code / schema / UI | **Not started** |
| Tracking issue | **Not filed** (plan Step 0b) |
| Spike | **Not run** |
| shared-db claims | **None held** this session |
| Ship | This wrap-up commits the plan + AGENTS.md + handoffs on a docs branch/PR |

---

## 3. What was done this session

1. Pulled `popdam3` (to `d6b53507`).
2. Research: ScaleDown = text compression / one-image Q&A only; **no** reverse-image search. Dropped by owner.
3. Wrote costed proposal → full 13-section implementation plan.
4. Review loop (all corrections integrated into the plan):
   - **Muse** REVISE (10 blockers) → integrated
   - **GLM 5.3** REVISE (3) → integrated
   - **DeepSeek** REVISE (B1–B5) → integrated
   - **Muse pass 2** REVISE (18) → integrated (incl. `dam` schema not PostgREST-visible)
   - **Muse pass 3** REVISE (H-1 + M-A–F) → integrated
   - **DeepSeek delta** APPROVE on scope (D3 poison-on-reclaim + non-blocks integrated)
5. AGENTS.md active-plans line added for the plan.

---

## 4. What was tried and failed (do not redo naively)

| Attempt | Failure | Lesson |
|---------|---------|--------|
| `ai-muse` sessions `image-similarity-plan-audit` / `audit2` | Wrapper `provider_outcome_uncertain` / mixed stream; `reconcile` refused | Full Muse text **was** recovered from `run.terminal.completed` in the session JSONL under `~/.local/state/ai-devops/muse/sessions/…`. Prefer `ai-muse new` for a fresh pass rather than fighting reconcile. |
| `ai-muse` long `ChildProcess.kill` tool errors | Call often still started | Re-check `ai-muse show <name>` before retrying. |
| `ai-deepseek-agent --file` / long pastes | Body stripped repeatedly (5×) | Use a short **delta file** with `--file`; DeepSeek reviews that. Code fences seem to get eaten. |
| Naive pHash for “same art” | Fails thin white border (owner case) | Visual embeddings + border auto-crop. |
| Cloud → Tailscale push to GPU `/embed` | Supabase/Railway cannot join tailnet | Pull-based pooler workers. |
| PostgREST to `dam.*` | `Invalid schema: dam` (KNOWN_QUIRKS #64) | `public.*` SECURITY DEFINER wrappers only. |

---

## 5. Exact next action

**Start the build only when Albert says go.** Then, in order:

1. **File** the PopDAM GitHub issue (plan Step 0b) titled roughly “Image similarity: upload → find same artwork” with `- [ ] live proof`. Put the URL into plan STATUS row 0b.
2. **Spike** (plan Step 1) on one RTX 3060 Ti desktop: load DINOv3 + SigLIP 2, print **dims 768/768**, VRAM, crop tests, bytea 15 MB proof, DINOv3 license confirm. Write `docs/verification/image-similarity-spike.md`.
3. Only after dims line exists: **shared-db** claim + migration (plan Step 2) in `popcre/shared-db`.

Stop if dims are not 768/768 — change the plan’s halfvec sizes before schema work.

---

## 6. How to verify success

| Check | Pass looks like |
|-------|-----------------|
| Plan still canonical | `plan_image_similarity_upload_search.md` STATUS table; Fresh session starts at Step 0b/1 |
| Spike OK | `docs/verification/image-similarity-spike.md` with dims/VRAM/scores/crop/license/bytea; engine OK if size+bordered pairs ≥ 0.94 combined |
| Schema OK | shared-db PR + `popdam_image_similarity_contracts.sql` green on preview |
| Live | `docs/verification/image-similarity-acceptance.md` + live-proof checkbox on the **same** issue |

---

## 7. Decisions locked (do not relitigate)

- Dual embeddings DINOv3 ViT-B/16 + SigLIP 2 base; GPU desktops; `extensions.halfvec(768)×2` + partial HNSW.
- Pull-based poller via **Supabase pooler IPv4 TLS TCP 5432** + `dam_image_embed_login` (NOLOGIN role + LOGIN member). **Never** service-role keys on desktops. **Never** PostgREST `dam.*`.
- Public wrappers: `image_embed_enqueue_index`, `image_embed_enqueue_query`, `image_embed_query_status`, `image_embed_status` (incl. `workers_fresh`), `search_dam_image_similarity`.
- One jobs table `dam.image_embed_jobs`; trigger enqueue on raster `thumbnail_url`; unique pending index job; lease reclaim + poison at 5 attempts.
- Score: `combined = w*dino_sim+(1-w)*siglip_sim`, clamp [0,1]; UI % = `round(combined*100,1)`; bands 0.98/0.94/0.90 floor 0.90 (tunable); **show 90%+**.
- Model stamp filter + `IMAGE_SIM_REEMBED_IN_PROGRESS` multi-stamp window.
- **No ScaleDown.** No bridge/windows edits for indexing. Backfill op enqueue/status only.

---

## 8. Files (GitHub URLs once pushed)

| File | Role |
|------|------|
| https://github.com/u2giants/popdam3/blob/main/plan_image_similarity_upload_search.md | Implementation plan (STATUS first) |
| https://github.com/u2giants/popdam3/blob/main/AGENTS.md | Active-plans index line |
| https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-22T1323Z-edge-dev-mimo-image-similarity-plan.md | Earlier plan handoff |
| This file | Session closeout |
| `.ai/reviews/muse-image-similarity-plan-audit-extracted.md` (and audit2/audit3, glm-*) | Review texts (local; commit if desired) |

Dropbox owner blueprint (machine-local, not in git): `C:\Users\ahazan\Dropbox\ai\visual_similarity_dam_implementation_plan.md`

---

## 9. Secrets / access

- **No secret values** appeared in this session.
- **To create later** in 1Password `vibe_coding`: `HuggingFace DINOv3 token` (`HF_TOKEN`), `dam_image_embed_login` password. Never put values in git/chat.

---

## Deferred by wrap-up scope freeze (write-down only)

- File tracking issue + start spike — **waiting on Albert’s go**.
- `ai-housekeeping` candidates: report-only (see closing report).
- Other sessions’ untracked files in the tree (db-data-admin screenshots, `proto_wallpool*.sql`, `wall_exists.sql`, `.playwright-cli/`, `.tmp-liveproof-243/`) — **not ours**, left untouched.
