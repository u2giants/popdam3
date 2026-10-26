---
issue: 486
status: OPEN
owner: zcode/hetz-image-similarity
---

# HANDOFF — #486 image similarity: 139,309 dual vectors computed; DB load pending schema landing

Written 2026-10-25 ~9:40 PM EDT on `hetz` by ZCode session.

## 0. Owner decisions already made — do NOT re-ask

- **2026-10-25 ~8:05 PM EDT (Albert, verbatim):** "forget the review. this repo doesn't need reviews. proceed without one" — recorded on popcre/shared-db#4700. Review gates for this chain are waived by the owner; all CI checks still apply.
- All earlier locked decisions in `plan_image_similarity_upload_search.md` §8 stand (dual 768 halfvec, DINOv3 ViT-B/16 + SigLIP2 base, blend 0.60/0.40, crop 6px/Δ12/25%).

## 1. What is DONE and verified

1. **GPU dual-embedding of the whole library** — `edge-dev` (RTX 3060 Ti, `D:\ai\siglip2-embed\staged_vectors.jsonl`, 1.8 GB):
   - 139,309 assets, both legs (DINOv3 + SigLIP2), each row `{"a":asset_id,"u":thumb_url,"c":cropped,"d":[768],"s":[768]}`, L2 norms 1.0, zero unparseable lines (verify_staged.py).
   - 58 assets skipped: thumbnails 403 at Spaces (genuinely missing files). List: `stage_failures.txt` / `staged_vectors.jsonl.failures` on edge-dev.
   - Tools on edge-dev: `image_embed_poller.py` (job-loop poller + crop + selftest), `stage_embeddings.py` (compute-only), `write_staged.py` (DB write phase), `verify_staged.py`. Venv has psycopg 3.3.6 + scipy.
2. **Merge-queue deadlock root-caused and fixed** — popcre/shared-db#4786 (+ work issue #4787, evidence pair gen 3). `awaitPreviewRehearsal` now accepts a success status on a first-parent descendant of the held commit. Tests 37/0.
3. **Owner ruling applied to #4700** — no-reviewer path admitted it to the queue once; blocked only by the queue bug #4786 fixes.

## 2. Current state at handoff (re-verify before acting)

- #4786 (queue fix): guarded-merge dispatch in progress at 9:35 PM EDT; head `db88cef1a`; all checks green. If admitted → queue merges it → then dispatch rehearsal on current tip → #4700 re-dispatch.
- #4700 (vector schema): OPEN, head `6da406a0`, label `unreviewed-week`, all checks green, claim #4725 (owner: Claude edge-dev3 takeover session — that session is also live on this; coordinate via PR comments, do not duplicate dispatches).
- Production DB: `dam.dam_asset_image_vectors` NOT yet applied (check `to_regclass` as postgres on pooler `aws-1-us-east-1.pooler.supabase.com`).

## 3. Exact next steps (in order)

1. **Land #4786** (wait for queue; if ejected, read the refusal, fix, re-dispatch Guarded Merge with exact head).
2. **Post-merge rehearsal on current tip** so the descendant-status exists: dispatch `shared-supabase-migrations.yml` `target=preview, mode=apply, merged_preview_source_pr=<4786 map>, commit_sha=<current main tip>` under preview lock (docs/merge-queue-operation.md recovery section).
3. **Land #4700**: Guarded Merge dispatch with exact head `6da406a0…`; queue gate now accepts the descendant rehearsal. After merge: merged-main preview rehearsal runs; automatic production qualification dispatches; verify `dam.dam_asset_image_vectors` exists on prod.
4. **Set the login credential** (migration creates role `dam_image_embed_login` with NO password): generate password, `alter role … password`, store in 1Password `vibe_coding` as `dam_image_embed_login` (item name matches plan §12). Never in chat/git.
5. **Set `admin_config`**: `IMAGE_SIM_EMBEDDING_MODEL` = stamp string `dinov3-vitb16+siglip2-base-patch16-naflex+px224+bicubic+torch2.6.0` (single source of truth; poller writes this exact string), `IMAGE_EMBED_ENABLED` stays false until load completes (trigger safety).
6. **Load vectors** on edge-dev: `write_staged.py D:\ai\siglip2-embed\staged_vectors.jsonl <dsn-file> <stamp>` — DSN file on edge-dev with pooler host + login role; ~139k upserts ≈ 30–60 min. Resume-safe (`.written` log).
7. **Delta pass**: re-enumerate assets where `thumbnail_url` differs from staged `u` or missing vectors; re-run `stage_embeddings.py` on the delta (includes the 58 failures if thumbnails appear).
8. **Verify**: count in `dam.dam_asset_image_vectors` ≈ 139,309 with both legs non-null, stamp = admin_config value; `public.image_embed_status()` reflects rows. Flip `IMAGE_EMBED_ENABLED` true only after plan Step 3 poller exists (or leave false; trigger enqueues need the poller to drain).
9. **Close out**: tick `- [ ] live proof` path is Step 7 of the plan (search UX); this handoff only covers vector load. Post evidence on #486.

## 4. Landmines

- Claim #4725 expires every 30 min — the takeover session renews it; if it lapses and that session is dead, transfer claim per `--transfer-claim-author` (Albert quote needed) or let abandonment audit handle it; #4700 admission needs an active lease (Migration author lease check).
- Never `--admin` merge on shared-db (queue mandatory); the only manual statuses allowed are none — the rehearsal status comes only from the workflow.
- Password/DSN only through protected files; HF token already in 1Password (not needed anymore — models cached).
- `write_staged.py` runs as `dam_image_embed_login` over pooler 5432 TLS; connection limit 10.
- The takeover session (Claude, edge-dev3) may also act — check PR #4700 comments before dispatching anything.

## 5. Access

- edge-dev SSH: `ssh -i ~/.ssh/916-alien ahazan@100.75.135.31` (Windows); tools in `D:\ai\siglip2-embed\`.
- DB read (postgres): 1Password `Supabase DB Password - shared POP database`, pooler `aws-1-us-east-1.pooler.supabase.com`, user `postgres.qsllyeztdwjgirsysgai`.
- PRs: popcre/shared-db #4700 (schema), #4786 (queue fix), issues #4787 (queue work), #4725 (claim), u2giants/popdam3 #486 (tracking).

Posted by ZCode chat ${ZCODE_SESSION_ID:-unknown} on hetz
