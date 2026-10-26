# apps/image-embed-worker — PopDAM image-similarity GPU poller

Pull-based GPU worker for the image-similarity feature (issue #486,
`plan_image_similarity_upload_search.md` Step 3). Runs on an owner GPU
desktop (today: **edge-dev**, RTX 3060 Ti), connects out to the shared
Supabase database **through the pooler** and drains two job lanes from
`dam.image_embed_jobs`:

- **query lane** — uploaded pictures from the `image-similarity` edge
  function. Claim 1 row / lease 30 s / poll 1 s. Payload is magic-byte
  checked, Pillow-validated (bombs, animations, unsupported containers
  rejected permanently), border-cropped, embedded on both towers, and the
  two `halfvec(768)` results are written back onto the job row via
  `dam.complete_image_embed_job`.
- **index lane** — per-asset thumbnails enqueued by the
  `trg_assets_enqueue_image_embed` trigger (or the backfill op). Claim
  batch 32 / lease 300 s / poll 5 s, thumbnail downloaded from Spaces,
  border-cropped, embedded, vectors upserted with the exact model stamp.

Heartbeat: `dam.image_embed_worker_heartbeat(worker_id)` every **30 s**;
`public.image_embed_status().workers_fresh` reports the fleet available
while at least one heartbeat is < 90 s old.

Both lanes are gated on `admin_config.IMAGE_EMBED_ENABLED` (read via
`dam.image_embed_enabled()`); when false the service idles and keeps
heartbeating.

Models (cached on the GPU box — no HF token needed after first download):
DINOv3 ViT-B/16 (`facebook/dinov3-vitb16-pretrain-lvd1689m`) +
SigLIP 2 base (`google/siglip2-base-patch16-naflex`), both legs
L2-normalized fp32→halfvec, dual-tower math ported verbatim from the
GPU-proven backfill script.

## Files

| File | Purpose |
|------|---------|
| `image_embed_poller.py` | The service (ported reference + query lane) |
| `config.py` | Poller-side tunable defaults (plan Muse 18) |
| `requirements.txt` | Pinned to the proven edge-dev environment |
| `tests/test_image_embed_poller.py` | Border-crop + upload-reject tests (no GPU needed) |

## Connection (pooler TLS, TCP 5432 — IPv4)

The desktop dials **outbound TCP 5432 with TLS** to the Supabase pooler —
not the HTTPS project URL. The DSN user MUST carry the tenant suffix:

```
dam_image_embed_login.qsllyeztdwjgirsysgai
```

A bare `dam_image_embed_login` username fails with
`no tenant identifier` on the shared pooler. Password comes from 1Password
vault `vibe_coding`, item *"dam_image_embed_login DB password (PopDAM
image-embed worker, qsllyeztdwjgirsysgai)"* — kept in a protected
`worker.dsn` file, never on the command line, in logs, or in git.

## Model stamp — single source of truth

`admin_config.IMAGE_SIM_EMBEDDING_MODEL` is the only stamp source. The DB
login role cannot read `admin_config`, so at install/upgrade time copy the
exact value into a protected `worker.stamp` file:

```sql
-- run once as postgres (or read it in Settings) when installing/upgrading:
select value from admin_config where key = 'IMAGE_SIM_EMBEDDING_MODEL';
```

The service refuses to start without `--stamp-file`/`--stamp`. If the stamp
ever changes in admin_config (torch/model upgrade), update `worker.stamp`
and restart — vectors written with a stale stamp simply stay invisible to
search until re-embedded (that is the multi-stamp window the plan guards
with `IMAGE_SIM_REEMBED_IN_PROGRESS`).

## Install on a GPU Windows box (edge-dev runbook)

Proven environment: Python 3.13 + `.venv` in `D:\ai\siglip2-embed`.

1. Copy this folder from the repo to the GPU box (e.g.
   `D:\ai\popdam-image-embed-worker`), or update the existing copy after a
   repo change.
2. Create the venv and install pins:
   `python -m venv .venv && .venv\Scripts\pip install -r requirements.txt`
3. Create protected files next to the script (never commit them):
   - `worker.dsn` — the full pooler DSN (`sslmode=require`)
   - `worker.stamp` — the exact `IMAGE_SIM_EMBEDDING_MODEL` value
4. Prove the GPU + towers: `.venv\Scripts\python image_embed_poller.py --selftest`
   (expect `"ok": true`, `"device": "cuda"`; `nvidia-smi` lies over RDP —
   trust `torch.cuda.is_available()`).
5. Register the always-on service with Task Scheduler (batch/schtasks
   pattern, detached):

   ```bat
   schtasks /Create /TN PopDAM-ImageEmbedWorker /SC ONSTART /RU <user ^
     /TR "cmd /c D:\ai\popdam-image-embed-worker\run_service.cmd" /F
   ```

   `run_service.cmd` (create alongside the script):

   ```bat
   @echo off
   cd /d D:\ai\popdam-image-embed-worker
   .venv\Scripts\python.exe image_embed_poller.py ^
     --dsn-file D:\ai\popdam-image-embed-worker\worker.dsn ^
     --stamp-file D:\ai\popdam-image-embed-worker\worker.stamp ^
     --worker-id edge-dev-rtx3060ti >> service.log 2>&1
   ```

6. Start it: `schtasks /Run /TN PopDAM-ImageEmbedWorker`, then verify the
   heartbeat row and queue drain (as postgres):

   ```sql
   select * from dam.image_embed_worker_heartbeat;
   select public.image_embed_status();
   ```

## One-off backfill / delta drain

```bat
.venv\Scripts\python.exe image_embed_poller.py --dsn-file worker.dsn ^
  --stamp-file worker.stamp --once-drain
```

`--once-drain` exits after 6 consecutive empty index polls and never
touches the query lane (uploads need the always-on service, not a drain).

## Long-term placement

This service stays a pull-based desktop worker by design (plan section 8):
cloud cannot reach Tailscale desktops, and GPU embeds are cheapest on the
owner hardware that already caches the models. Adding a second GPU box =
install the same folder, give it its own `--worker-id`, and heartbeat
freshness already tolerates one box being offline.
