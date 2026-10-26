# Image similarity — production acceptance (2026-10-26)

Tracking issue: [#486](https://github.com/u2giants/popdam3/issues/486).
Plan: `plan_image_similarity_upload_search.md` Step 7. All evidence below is
from **production** (`dam.designflow.app`, project `qsllyeztdwjgirsysgai`,
fp16 vectors, live GPU poller on edge-dev).

## What ran

- 20 real pairs selected from the live library: for each anchor asset, its
  top non-self similarity match with combined ≥ 0.94 (in-database
  `search_dam_image_similarity` over stored vectors). 10 anchors with
  `border_cropped = true` (bordered artwork), 10 with `false`; 14 of the 20
  anchors classified white-ground (6 px edge-ring median ≥ 235).
- Per pair, **two uploads through the deployed edge function**
  `image-similarity` (`action=search`, real signed-in user token):
  1. the anchor's thumbnail as-is (JPEG q90 re-encode), and
  2. a variant — resize 50 % / double recompress q55 / +12 px white border
     (round-robin), i.e. 40 uploads total.
- GPU poller: `apps/image-embed-worker` service on edge-dev (RTX 3060 Ti),
  scheduled task `PopDAM-ImageEmbedWorker`, heartbeat every 30 s.

## Results — 40/40 uploads found the counterpart artwork

| Metric | Value |
|---|---|
| Uploads passed (counterpart in live matches) | **40 / 40** (all ≥ 90.2 %) |
| Bordered uploads | 20 / 20 passed; as-is min **96.6 %** |
| White-ground uploads | 28 / 28 passed |
| As-is uploads in same-artwork band (≥ 94 %) | 18 / 20 (min as-is 92.2 %) |
| Variant uploads (resize/recompress/white border) | 20 / 20 ≥ 90.2 % |
| End-to-end latency per upload (edge call → matches) | ~3.0–5.2 s |
| Incremental index proof (Step 4) | enqueue → vector refreshed in **2.4 s**; query job on own thumbnail done in **1.1 s**, self-match rank 1 at 100.0 % |

Raw rows: 40 JSON lines in the run log summarized on
[#486](https://github.com/u2giants/popdam3/issues/486); the harness
(`acceptance/imgsim-acceptance.py` pattern) lives on edge-dev under
`D:\ai\popdam-image-embed-worker\acceptance\`.

## Cutoff calibration (production fp16 scores) — locked defaults confirmed

- Same-artwork pairs score 92–100 as-is: two real pairs landed at 92.2 % /
  93.9 %, i.e. inside the **close (0.90) band** rather than same-artwork
  (0.94). Both are still shown (owner rule: show 90 %+ near-misses first).
- No real pair fell below 90.2 %, and bordered pairs — the hardest case for
  naive perceptual hashing — never dropped below 96.6 % as-is.
- Near-duplicate exports cluster at 99.8–100.0 %, cleanly inside the
  same-export (0.98) band.
- **Decision: keep `IMAGE_SIM_FLOOR=0.90`, bands 0.98 / 0.94 / 0.90,
  DINO weight 0.60, top_k 200.** Lowering the floor is not needed; raising
  the same-artwork band is not justified by the two 92–94 % outliers.

## Config in force (admin_config, no secrets)

`IMAGE_SIM_ENABLED=true`, `IMAGE_EMBED_ENABLED=true`,
`IMAGE_SIM_EMBEDDING_MODEL=dinov3-vitb16+siglip2-base-patch16-naflex+px224+bicubic+torch2.6.0`,
plus the tunables above. All are editable via Settings → set-config without
a redeploy (the edge passes floor/weight/top_k/stamps through to the RPC).

## Known gaps (not this feature's bug)

- 55 assets lack vectors — their thumbnails are missing at Spaces (HTTP
  403). They self-heal through the trigger + poller once thumbnails exist.
- The enqueue-only backfill op (`rebuild-image-vectors`) is **blocked** on a
  missing shared-db wrapper: service_role cannot enumerate stale assets
  (`dam` tables are revoked from service_role and invisible to PostgREST).
  Needs `public.image_embed_stale_assets(...)` (or equivalent) in
  `popcre/shared-db` first; app-side handler/UI to follow.
