"""Defaults for the PopDAM image-embed GPU poller (single place to retune).

Counterpart defaults modules (plan Muse 18):
  frontend  src/lib/image-similarity-config.ts
  edge      supabase/functions/_shared/image-similarity-config.ts
  poller    this file

Everything here is a default only: the model stamp always comes from
admin_config.IMAGE_SIM_EMBEDDING_MODEL (passed to the poller via
--stamp / --stamp-file at launch; the login role cannot read admin_config,
so the value is copied from admin_config at install time — see README.md).
"""

# ---------------------------------------------------------------------------
# Models (must match the stamp in admin_config.IMAGE_SIM_EMBEDDING_MODEL).
# ---------------------------------------------------------------------------
DINO_ID = "facebook/dinov3-vitb16-pretrain-lvd1689m"
SIGLIP_ID = "google/siglip2-base-patch16-naflex"
DIM = 768

# ---------------------------------------------------------------------------
# Border auto-crop (plan-locked numbers — do not retune without recalibrating
# the Step 7 acceptance bands).
# ---------------------------------------------------------------------------
CROP_RING_PX = 6          # edge ring sampled for the border colour median
CROP_CHANNEL_DELTA = 12   # channel delta <= this counts as border colour
CROP_MAX_AREA_LOSS = 0.25  # skip crop when it would remove > 25% of the area

# ---------------------------------------------------------------------------
# Worker loop cadences (plan-locked: Muse 15).
# ---------------------------------------------------------------------------
HEARTBEAT_INTERVAL_S = 30
QUERY_POLL_S = 1.0     # query lane claim cadence
QUERY_LEASE_S = 30     # query job lease
QUERY_CLAIM_LIMIT = 1  # query jobs always claim exactly one row
INDEX_POLL_S = 5.0     # index lane claim cadence
INDEX_LEASE_S = 300    # index job lease
INDEX_CLAIM_BATCH = 32  # index jobs claimed per cycle (DB clamps to 64)
INFERENCE_BATCH = 8    # images per model forward when draining index claims
ENABLE_RECHECK_S = 5.0  # how often to re-read dam.image_embed_enabled()

# ---------------------------------------------------------------------------
# Thumbnail fetch (index lane).
# ---------------------------------------------------------------------------
DOWNLOAD_THREADS = 12
DOWNLOAD_TIMEOUT_S = 45
USER_AGENT = "PopDAM-ImageEmbed/1.0"

# ---------------------------------------------------------------------------
# Upload payload guards (query lane). The edge re-checks size + magic bytes;
# the poller re-validates with Pillow and rejects permanently on abuse.
# ---------------------------------------------------------------------------
UPLOAD_MAX_BYTES = 15 * 1024 * 1024   # edge accepts 15 MB bodies
UPLOAD_MAX_PIXELS = 60_000_000        # decompression-bomb guard (~60 MP)
ALLOWED_UPLOAD_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "BMP"}

# Magic-byte sniffing prefixes (edge and poller agree on this set). WebP
# uses an offset signature (RIFF....WEBP) handled specially in sniff_magic.
MAGIC_SIGNATURES = (
    (b"\xff\xd8\xff", "JPEG"),
    (b"\x89PNG\r\n\x1a\n", "PNG"),
    (b"GIF87a", "GIF"),
    (b"GIF89a", "GIF"),
    (b"BM", "BMP"),
)
WEBP_MAGIC = (b"RIFF", b"WEBP")  # data[0:4], data[8:12]

# ---------------------------------------------------------------------------
# Database (Supabase pooler — IPv4, TLS, TCP 5432; NOT the HTTPS URL).
# The tenant suffix on the user is MANDATORY: a bare username fails with
# "no tenant identifier" on the shared pooler.
# ---------------------------------------------------------------------------
POOLER_HOST = "aws-1-us-east-1.pooler.supabase.com"
POOLER_PORT = 5432
DB_NAME = "postgres"
DB_USER = "dam_image_embed_login.qsllyeztdwjgirsysgai"
DB_SSLMODE = "require"
CONNECT_TIMEOUT_S = 15
RECONNECT_BACKOFF_S = (1, 2, 5, 15, 30, 60)  # capped at the last value

# ---------------------------------------------------------------------------
# Misc.
# ---------------------------------------------------------------------------
DEFAULT_WORKER_ID = "edge-dev-rtx3060ti"
IDLE_EXIT_POLLS = 6  # --once-drain: consecutive empty index polls before exit
