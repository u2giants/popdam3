# Handoff — Image similarity upload search (plan only)

**UTC:** 2026-10-22T13:23Z  
**Machine:** edge-dev  
**Agent:** MiMo (mimo)  
**Repo:** `u2giants/popdam3`  
**Plan:** [plan_image_similarity_upload_search.md](../plan_image_similarity_upload_search.md) — **read its STATUS table first; do not re-derive or re-plan.**

## State

- **Owner approved (2026-10-22):** hybrid = his GPU dual-embedding blueprint (DINOv3 + SigLIP 2) + PopDAM product rules. Show **90% near-misses** at first. Thresholds **tunable**. **ScaleDown dropped.**
- **Muse audit (2026-10-22):** REVISE — all 10 blocking gaps validated and integrated (plan §14–§16). Key change: **pull-based** GPU workers over **Supabase pooler (IPv4 TLS TCP 5432)** using `dam_image_embed_login` — not HTTPS-to-DB and not cloud→Tailscale push. PostgREST uses `public.*` wrappers only (`dam` schema is hidden from the API).
- **Nothing built yet.** No shared-db migration, no worker, no UI.
- **Next action:** Step 0b file tracking issue, then Phase A spike (plan Step 1) — dims/VRAM/scores/crop; write `docs/verification/image-similarity-spike.md`. Schema (Step 2) waits on dims proof.

## Links

- Plan (implementation): [plan_image_similarity_upload_search.md](../plan_image_similarity_upload_search.md)
- Owner blueprint (Dropbox, not in git): `C:\Users\ahazan\Dropbox\ai\visual_similarity_dam_implementation_plan.md`
- Related exclusion: [plan_hybrid_search_rollout.md](../plan_hybrid_search_rollout.md) (image-to-image was deferred to this plan)

## Standing constraints for the implementer

- Schema only in `popcre/shared-db`. No app-repo migrations.
- Feature branch + PR to `main`.
- Secrets by 1Password location only (HF token, worker bearer — items not yet created).
- No ScaleDown in this feature.
- Adversarial upload table in the plan is mandatory before review of the upload path.
