#!/usr/bin/env python
"""PopDAM image-embed GPU poller — long-running service + backfill drain.

Plan: plan_image_similarity_upload_search.md Steps 3-4 (dual DINOv3 +
SigLIP2 halfvec(768)). Ports the GPU-proven reference implementation from
edge-dev (D:\\ai\\siglip2-embed\\image_embed_poller.py, whole-library
backfill 2026-10-25): the claim/heartbeat/complete/fail loop, border-crop,
dual-tower embed math and selftest are carried over unchanged; this port
adds the query lane (uploads), the IMAGE_EMBED_ENABLED gate and reconnect
backoff so it can run as an always-on service.

Connects as dam_image_embed_login.qsllyeztdwjgirsysgai through the Supabase
pooler (IPv4, TLS, TCP 5432), heartbeats every 30 s, claims query jobs
(1 row / lease 30 s / loop 1 s) and index jobs (batch 32 / lease 300 s /
loop 5 s), computes BOTH model legs on the GPU and writes one atomic
dual-leg result per job via dam.complete_image_embed_job.

Third lane — search documents (popdam3 #646 cure (d)): claims rows from
public.dam_search_documents through claim_dam_search_embedding_documents
(style_group docs first, server-side), embeds the doc thumbnail with the
SigLIP2 tower only (no border-crop, matching the existing corpus) and
writes vector(768) via upsert_dam_search_embedding / errors via
mark_dam_search_embedding_error. Requires the shared-db EXECUTE grants for
dam_image_embed_worker on those RPCs; without them the lane logs one
search_lane_error, cools down and the other lanes continue.

The model stamp is NOT invented here: admin_config.IMAGE_SIM_EMBEDDING_MODEL
is the single source of truth. The DB login role cannot read admin_config,
so the exact value is copied into a protected stamp file at install time
(see README.md) and passed via --stamp / --stamp-file.

Usage:
  python image_embed_poller.py --selftest            # no DB, proves both towers
  python image_embed_poller.py --dsn-file <file> --stamp-file <file>   # service
  python image_embed_poller.py --dsn-file <file> --stamp-file <file> --once-drain
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import torch
from PIL import Image, ImageOps
from transformers import AutoModel, AutoProcessor

import config

DINO_ID = config.DINO_ID
SIGLIP_ID = config.SIGLIP_ID
DIM = config.DIM

CROP_RING_PX = config.CROP_RING_PX
CROP_CHANNEL_DELTA = config.CROP_CHANNEL_DELTA
CROP_MAX_AREA_LOSS = config.CROP_MAX_AREA_LOSS


class PermanentReject(Exception):
    """Upload payload that must fail the query job permanently (no retry)."""


def log(**fields) -> None:
    fields.setdefault("t", time.strftime("%Y-%m-%dT%H:%M:%S"))
    print(json.dumps(fields, default=str), flush=True)


def load_models():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dino_model = AutoModel.from_pretrained(DINO_ID).to(device).eval()
    dino_proc = AutoProcessor.from_pretrained(DINO_ID)
    sig_model = AutoModel.from_pretrained(SIGLIP_ID).to(device).eval()
    sig_proc = AutoProcessor.from_pretrained(SIGLIP_ID)
    return (dino_model, dino_proc, sig_model, sig_proc, device)


def _pooler(out):
    if hasattr(out, "pooler_output") and out.pooler_output is not None:
        return out.pooler_output
    if isinstance(out, (tuple, list)):
        return out[0]
    return out


@torch.no_grad()
def embed_both(images, models, batch_size=config.INFERENCE_BATCH):
    """images: list[PIL.Image] -> (dino_vecs, siglip_vecs) numpy [n,768], L2-normalized."""
    dino_model, dino_proc, sig_model, sig_proc, device = models
    dino_out, sig_out = [], []
    for i in range(0, len(images), batch_size):
        chunk = images[i : i + batch_size]
        d_inputs = {k: v.to(device) for k, v in dino_proc(images=chunk, return_tensors="pt").items()}
        d_feats = torch.nn.functional.normalize(_pooler(dino_model(**d_inputs)), dim=-1)
        dino_out.extend(d_feats.cpu().to(torch.float32).tolist())
        s_inputs = {k: v.to(device) for k, v in sig_proc(images=chunk, return_tensors="pt").items()}
        s_feats = _pooler(sig_model.get_image_features(**s_inputs))
        s_feats = torch.nn.functional.normalize(s_feats, dim=-1)
        sig_out.extend(s_feats.cpu().to(torch.float32).tolist())
    return np.asarray(dino_out, dtype=np.float32), np.asarray(sig_out, dtype=np.float32)


def border_crop(img: Image.Image) -> tuple[Image.Image, bool]:
    """Plan-locked border auto-crop. Returns (image, cropped_flag)."""
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
    a = np.asarray(img, dtype=np.int16)
    h, w = a.shape[:2]
    ring = np.concatenate([
        a[:CROP_RING_PX, :].reshape(-1, 3),
        a[-CROP_RING_PX:, :].reshape(-1, 3),
        a[:, :CROP_RING_PX].reshape(-1, 3),
        a[:, -CROP_RING_PX:].reshape(-1, 3),
    ])
    median = np.median(ring, axis=0)
    mask = np.all(np.abs(a - median) <= CROP_CHANNEL_DELTA, axis=2)
    # flood fill from the image border over border-coloured pixels (C-speed)
    from scipy.ndimage import binary_propagation
    seed = np.zeros_like(mask)
    seed[0, :] = mask[0, :]
    seed[-1, :] = mask[-1, :]
    seed[:, 0] |= mask[:, 0]
    seed[:, -1] |= mask[:, -1]
    visited = binary_propagation(seed, mask=mask)
    interior = ~visited
    if not interior.any():
        return img, False
    ys, xs = np.where(interior)
    top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    area_now, area_new = h * w, (bottom - top) * (right - left)
    if area_new <= 0 or area_new < area_now * (1 - CROP_MAX_AREA_LOSS):
        return img, False
    if top == 0 and left == 0 and bottom == h and right == w:
        return img, False
    return img.crop((left, top, right, bottom)), True


def sniff_magic(data: bytes) -> str | None:
    """Return the canonical format name for allowed upload magic bytes, else None."""
    for prefix, name in config.MAGIC_SIGNATURES:
        if data.startswith(prefix):
            return name
    riff, webp = config.WEBP_MAGIC
    if len(data) >= 12 and data[:4] == riff and data[8:12] == webp:
        return "WEBP"
    return None


def open_upload(data) -> Image.Image:
    """Validate an uploaded query payload and return a loaded PIL image.

    Raises PermanentReject for bombs, unsupported formats and animations;
    anything else propagates as a transient failure (job retries).
    """
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise PermanentReject("payload is not image bytes")
    data = bytes(data)
    if len(data) == 0:
        raise PermanentReject("empty payload")
    if len(data) > config.UPLOAD_MAX_BYTES:
        raise PermanentReject(f"payload {len(data)} bytes exceeds {config.UPLOAD_MAX_BYTES}")
    magic = sniff_magic(data)
    if magic is None:
        raise PermanentReject("unsupported image format (magic bytes)")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Image.DecompressionBombError as exc:
        raise PermanentReject(f"decompression bomb: {exc}") from exc
    except PermanentReject:
        raise
    except Exception as exc:  # truncated/corrupt bytes: permanent, not transient
        raise PermanentReject(f"decode failed: {type(exc).__name__}: {str(exc)[:180]}") from exc
    if img.format not in config.ALLOWED_UPLOAD_FORMATS or img.format != magic:
        raise PermanentReject(f"unsupported image container: {img.format}")
    frames = getattr(img, "n_frames", 1)
    if frames and frames > 1:
        raise PermanentReject(f"animated image ({frames} frames)")
    if img.width * img.height > config.UPLOAD_MAX_PIXELS:
        raise PermanentReject(f"image too large: {img.width}x{img.height}")
    return img


def fetch_url(url: str, timeout=config.DOWNLOAD_TIMEOUT_S) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def halfvec_text(vec) -> str:
    return "[" + ",".join(f"{x:.5f}" for x in vec) + "]"


def search_vector_text(vec) -> str:
    """vector(768) literal for upsert_dam_search_embedding (7-decimal form,
    matching the vectors already in dam_search_documents.embedding)."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


@torch.no_grad()
def embed_siglip_only(images, models, batch_size=config.SEARCH_INFERENCE_BATCH):
    """images: list[PIL.Image] -> numpy [n,768] SigLIP2 vectors, L2-normalized.

    Same math as the SigLIP leg of embed_both (get_image_features ->
    pooler_output -> L2 normalize); used by the search-document lane, whose
    column holds single-tower vector(768) values (popdam3 #646).
    """
    _dino_model, _dino_proc, sig_model, sig_proc, device = models
    out = []
    for i in range(0, len(images), batch_size):
        chunk = images[i : i + batch_size]
        s_inputs = {k: v.to(device) for k, v in sig_proc(images=chunk, return_tensors="pt").items()}
        s_feats = _pooler(sig_model.get_image_features(**s_inputs))
        s_feats = torch.nn.functional.normalize(s_feats, dim=-1)
        out.extend(s_feats.cpu().to(torch.float32).tolist())
    return np.asarray(out, dtype=np.float32)


class Heartbeat(threading.Thread):
    def __init__(self, conn_provider, worker_id, interval=config.HEARTBEAT_INTERVAL_S):
        super().__init__(daemon=True)
        self.conn_provider = conn_provider  # callable -> live psycopg connection
        self.worker_id = worker_id
        self.interval = interval
        self.stop_flag = threading.Event()

    def run(self):
        while not self.stop_flag.wait(self.interval):
            try:
                conn = self.conn_provider()
                with conn.cursor() as cur:
                    cur.execute("select dam.image_embed_worker_heartbeat(%s)", (self.worker_id,))
                conn.commit()
            except Exception as exc:
                log(heartbeat_error=str(exc)[:200])


def selftest(models):
    img = Image.new("RGB", (512, 512), (255, 255, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    d.ellipse((120, 120, 400, 380), fill=(200, 40, 40))
    cropped_img, cropped = border_crop(img)
    dino, sig = embed_both([cropped_img], models)
    dino_model, dino_proc, _, _, device = models
    size = getattr(dino_proc, "image_size", None) or getattr(getattr(dino_proc, "processor", None), "size", None)
    ok = (
        dino.shape == (1, DIM)
        and sig.shape == (1, DIM)
        and np.isfinite(dino).all()
        and np.isfinite(sig).all()
        and abs(np.linalg.norm(dino[0]) - 1.0) < 1e-3
        and abs(np.linalg.norm(sig[0]) - 1.0) < 1e-3
    )
    print(json.dumps({
        "ok": bool(ok),
        "device": device,
        "torch": torch.__version__,
        "dims": [int(dino.shape[1]), int(sig.shape[1])],
        "cropped_flag": cropped,
        "dino_input_size": str(size),
        "norms": [round(float(np.linalg.norm(dino[0])), 4), round(float(np.linalg.norm(sig[0])), 4)],
    }, indent=2))
    return ok


def complete_job(cur, job_id, dino, sig, stamp, cropped, thumbnail_url):
    cur.execute(
        "select dam.complete_image_embed_job("
        "%s, %s::extensions.halfvec(768), %s::extensions.halfvec(768), %s, %s, %s)",
        (job_id, halfvec_text(dino), halfvec_text(sig), stamp, cropped, thumbnail_url),
    )


class Poller:
    def __init__(self, args, models):
        self.args = args
        self.models = models
        self.conn = None
        self.hb = None
        self.enabled_cache = (False, 0.0)
        self.done = self.failed = 0
        self.search_done = self.search_failed = self.search_stale = 0
        self.search_cooldown_until = 0.0
        self.t0 = time.time()
        self.pool = ThreadPoolExecutor(max_workers=args.download_threads)

    # -- connection lifecycle -------------------------------------------------
    def connect(self):
        import psycopg
        # Without these a dead socket blocks every lane and the heartbeat forever
        # (popdam3 #663: process alive, silent for hours).
        self.conn = psycopg.connect(self.args.dsn, autocommit=False, connect_timeout=30,
                                    keepalives=1, keepalives_idle=30, keepalives_interval=10,
                                    keepalives_count=3, tcp_user_timeout=120000)
        return self.conn

    def conn_provider(self):
        return self.conn

    def reconnect_forever(self):
        backoff = list(config.RECONNECT_BACKOFF_S)
        i = 0
        while True:
            try:
                self.connect()
                log(event="reconnected")
                return
            except Exception as exc:
                wait = backoff[min(i, len(backoff) - 1)]
                i += 1
                log(event="reconnect_failed", wait_s=wait, error=str(exc)[:200])
                time.sleep(wait)

    def _run(self, fn):
        """Run fn(conn) once and commit; on connection-class errors reconnect and retry."""
        while True:
            try:
                result = fn(self.conn)
                self.conn.commit()
                return result
            except Exception as exc:
                try:
                    self.conn.rollback()
                except Exception:
                    pass
                if self._is_connection_error(exc):
                    log(event="connection_lost", error=str(exc)[:200])
                    try:
                        self.conn.close()
                    except Exception:
                        pass
                    self.reconnect_forever()
                    continue
                raise

    @staticmethod
    def _is_connection_error(exc) -> bool:
        name = type(exc).__module__ + "." + type(exc).__name__
        if "psycopg" not in name:
            return False
        return isinstance(exc, Exception) and (
            "OperationalError" in name or "InterfaceError" in name or "AdminShutdown" in str(exc)
        )

    # -- flags ----------------------------------------------------------------
    def embed_enabled(self) -> bool:
        val, when = self.enabled_cache
        if time.time() - when < config.ENABLE_RECHECK_S:
            return val

        def _q(c):
            with c.cursor() as cur:
                cur.execute("select dam.image_embed_enabled()")
                row = cur.fetchone()
                return bool(row[0]) if row else False
        cur_val = self._run(_q)
        self.enabled_cache = (bool(cur_val), time.time())
        return bool(cur_val)

    # -- query lane -------------------------------------------------------------
    def claim_query_job(self):
        def _q(c):
            with c.cursor() as cur:
                cur.execute(
                    "select id, payload from dam.claim_image_embed_jobs(%s, %s, %s, %s)",
                    ("query", config.QUERY_CLAIM_LIMIT, self.args.worker_id, config.QUERY_LEASE_S),
                )
                return cur.fetchall()
        return self._run(_q)

    def process_query_job(self, job) -> None:
        job_id, payload = job[0], job[1]
        try:
            img = open_upload(payload)
        except PermanentReject as exc:
            self._run(lambda c: c.cursor().execute(
                "select dam.fail_image_embed_job(%s, %s, true)", (job_id, str(exc)[:200])))
            self.conn.commit()
            self.failed += 1
            log(event="query_rejected", job=str(job_id), reason=str(exc)[:120])
            return
        try:
            cimg, cropped = border_crop(img)
            dino, sig = embed_both([cimg], self.models, batch_size=1)
            if not (np.isfinite(dino).all() and np.isfinite(sig).all()):
                raise PermanentReject("non-finite embedding vector")
            self._run(lambda c: complete_job(c, job_id, dino[0], sig[0], self.args.stamp, cropped, ""))
            self.conn.commit()
            self.done += 1
            log(event="query_done", job=str(job_id), cropped=bool(cropped))
        except PermanentReject as exc:
            self._run(lambda c: c.cursor().execute(
                "select dam.fail_image_embed_job(%s, %s, true)", (job_id, str(exc)[:200])))
            self.conn.commit()
            self.failed += 1
        except Exception as exc:
            self._run(lambda c: c.cursor().execute(
                "select dam.fail_image_embed_job(%s, %s)",
                (job_id, f"query embed: {type(exc).__name__}: {str(exc)[:180]}")))
            self.conn.commit()
            self.failed += 1
            log(event="query_error", job=str(job_id), error=str(exc)[:160])

    # -- index lane ---------------------------------------------------------------
    def claim_index_jobs(self):
        def _q(c):
            with c.cursor() as cur:
                cur.execute(
                    "select id, asset_id from dam.claim_image_embed_jobs(%s, %s, %s, %s)",
                    ("index", self.args.batch, self.args.worker_id, self.args.lease_seconds),
                )
                return cur.fetchall()
        return self._run(_q)

    def lookup_thumbnails(self, asset_ids):
        def _q(c):
            with c.cursor() as cur:
                cur.execute(
                    "select asset_id, thumbnail_url, is_deleted from dam.get_image_embed_asset_thumbnails(%s::uuid[])",
                    (asset_ids,),
                )
                return {r[0]: (r[1], r[2]) for r in cur.fetchall()}
        return self._run(_q)

    def process_index_batch(self, jobs) -> None:
        ids = [j[0] for j in jobs]
        asset_ids = [j[1] for j in jobs]
        thumbs = self.lookup_thumbnails(asset_ids)

        futures = {}
        for jid, aid in jobs:
            info = thumbs.get(aid)
            if info is None or info[1] or not info[0]:
                self._run(lambda c, j=jid: c.cursor().execute(
                    "select dam.fail_image_embed_job(%s, %s, true)",
                    (j, "asset deleted or thumbnail missing")))
                self.conn.commit()
                self.failed += 1
                continue
            futures[jid] = (aid, info[0], self.pool.submit(fetch_url, info[0]))

        results = []
        for jid, (aid, url, fut) in list(futures.items()):
            try:
                data = fut.result()
                img = Image.open(io.BytesIO(data))
                img.load()
                results.append((jid, aid, url, img))
            except Exception as exc:
                self._run(lambda c, j=jid, e=exc: c.cursor().execute(
                    "select dam.fail_image_embed_job(%s, %s)",
                    (j, f"download/decode: {type(e).__name__}: {str(e)[:200]}")))
                self.conn.commit()
                self.failed += 1

        if results:
            processed = []
            for jid, aid, url, img in results:
                try:
                    cimg, cropped = border_crop(img)
                    processed.append((jid, aid, url, cimg, cropped))
                except Exception as exc:
                    self._run(lambda c, j=jid, e=exc: c.cursor().execute(
                        "select dam.fail_image_embed_job(%s, %s)",
                        (j, f"crop: {type(e).__name__}: {str(e)[:200]}")))
                    self.conn.commit()
                    self.failed += 1
            if processed:
                dino, sig = embed_both([p[3] for p in processed], self.models)
                for idx, (jid, aid, url, _img, cropped) in enumerate(processed):
                    dv, sv = dino[idx], sig[idx]
                    if not (np.isfinite(dv).all() and np.isfinite(sv).all()):
                        self._run(lambda c, j=jid: c.cursor().execute(
                            "select dam.fail_image_embed_job(%s, %s, true)",
                            (j, "non-finite embedding vector")))
                        self.conn.commit()
                        self.failed += 1
                        continue
                    self._run(lambda c, j=jid, d=dv, s=sv, cr=cropped, u=url:
                              complete_job(c, j, d, s, self.args.stamp, cr, u))
                    self.conn.commit()
                    self.done += 1

        if self.args.limit and self.done + self.failed >= self.args.limit:
            raise StopIteration

    # -- search-document lane (public.dam_search_documents, popdam3 #646) --------
    # Claim/upsert/mark-error go through the documented public RPCs only; no
    # direct writes to dam_search_documents. Requires the shared-db EXECUTE
    # grants for dam_image_embed_worker (see README). Until those grants reach
    # the target database the lane logs one lane_error, cools down
    # (SEARCH_LANE_ERROR_COOLDOWN_S) and leaves the other lanes untouched.
    def claim_search_docs(self):
        def _q(c):
            with c.cursor() as cur:
                cur.execute(
                    "select document_type, entity_id, search_text, thumbnail_url,"
                    " content_sha256, lease_token, lease_expires_at, attempt"
                    " from public.claim_dam_search_embedding_documents(%s, %s, %s)",
                    (self.args.search_batch, self.args.worker_id, self.args.search_lease_seconds),
                )
                return cur.fetchall()
        return self._run(_q)

    # PopSG lane (public.style_guide_search_documents, popdam3 #706): same model,
    # same uncropped thumbnails, its own RPCs. Rows carry document_type None.
    def claim_sg_docs(self):
        def _q(c):
            with c.cursor() as cur:
                cur.execute(
                    "select null::text, style_guide_file_id, search_text, thumbnail_url,"
                    " content_sha256, lease_token, lease_expires_at, attempt"
                    " from public.claim_sg_search_embedding_documents(%s, %s, %s)",
                    (config.SG_SEARCH_CLAIM_BATCH, self.args.worker_id, self.args.search_lease_seconds),
                )
                return cur.fetchall()
        return self._run(_q)

    def search_upsert(self, row, vector) -> bool:
        if row[0] is None:
            def _sg(c):
                with c.cursor() as cur:
                    cur.execute(
                        "select public.upsert_sg_search_embedding(%s, %s, %s, %s::extensions.vector, %s)",
                        (row[1], row[4], row[5], search_vector_text(vector), config.SEARCH_DOC_MODEL_STAMP),
                    )
                    return bool(cur.fetchone()[0])
            return self._run(_sg)
        document_type, entity_id, _text, _thumb, content_sha256, lease_token = row[0], row[1], row[2], row[3], row[4], row[5]
        def _q(c):
            with c.cursor() as cur:
                cur.execute(
                    "select public.upsert_dam_search_embedding(%s, %s, %s, %s, %s::extensions.vector, %s)",
                    (document_type, entity_id, content_sha256, lease_token,
                     search_vector_text(vector), config.SEARCH_DOC_MODEL_STAMP),
                )
                return bool(cur.fetchone()[0])
        return self._run(_q)

    def search_mark_error(self, row, message: str, category: str) -> None:
        document_type, entity_id, content_sha256, lease_token = row[0], row[1], row[4], row[5]
        try:
            def _q(c):
                with c.cursor() as cur:
                    if document_type is None:
                        cur.execute(
                            "select public.mark_sg_search_embedding_error(%s, %s, %s, %s, %s)",
                            (entity_id, content_sha256, lease_token, message[:500], category),
                        )
                        return cur.fetchone()[0]
                    cur.execute(
                        "select public.mark_dam_search_embedding_error(%s, %s, %s, %s, %s, %s)",
                        (document_type, entity_id, content_sha256, lease_token,
                         message[:500], category),
                    )
                    return cur.fetchone()[0]
            self._run(_q)
        except Exception as exc:
            log(event="search_mark_error_failed", entity=str(entity_id), error=str(exc)[:160])

    def process_search_batch(self, rows) -> None:
        # rows: (document_type, entity_id, search_text, thumbnail_url,
        #        content_sha256, lease_token, lease_expires_at, attempt)
        for row in rows:
            if not row[3]:
                self.search_failed += 1
                # Thumbnails can arrive after the document does, and nothing clears
                # a permanent mark when one does (popdam3 #663).
                self.search_mark_error(row, "Transient: missing thumbnail_url", "transient")

        to_download = [(row, self.pool.submit(fetch_url, row[3])) for row in rows if row[3]]
        decoded = []
        for row, fut in to_download:
            try:
                data = fut.result()
                img = Image.open(io.BytesIO(data))
                img.load()
                decoded.append((row, img.convert("RGB")))
            except Exception as exc:
                self.search_failed += 1
                self.search_mark_error(
                    row, f"download/decode: {type(exc).__name__}: {str(exc)[:200]}", "transient")

        if not decoded:
            return
        # No border-crop here: the existing corpus in dam_search_documents was
        # embedded uncropped, and mixed treatment would skew similarity.
        try:
            vectors = embed_siglip_only([img for _row, img in decoded], self.models)
        except Exception as exc:
            for row, _img in decoded:
                self.search_failed += 1
                self.search_mark_error(row, f"embed batch: {type(exc).__name__}: {str(exc)[:200]}", "transient")
            return

        for idx, (row, _img) in enumerate(decoded):
            vec = vectors[idx]
            if not (np.isfinite(vec).all() and len(vec) == config.DIM):
                self.search_failed += 1
                self.search_mark_error(row, f"bad vector dim {len(vec)}", "permanent")
                continue
            try:
                if self.search_upsert(row, vec):
                    self.search_done += 1
                else:
                    self.search_stale += 1  # lease lost or content hash changed: skip
            except Exception as exc:
                self.search_failed += 1
                self.search_mark_error(row, f"upsert: {type(exc).__name__}: {str(exc)[:200]}", "transient")

    def poll_search_lane(self, claim=None, lane="dam") -> str:
        """One search-lane cycle. Returns 'claimed', 'empty', or 'error'
        (claim-level failure, e.g. grants not yet applied -> cooldown)."""
        try:
            rows = (claim or self.claim_search_docs)()
        except Exception as exc:
            log(event="search_lane_error", lane=lane, error=f"{type(exc).__name__}: {str(exc)[:200]}")
            return "error"
        if rows:
            self.process_search_batch(rows)
            rate = self.search_done / max(time.time() - self.t0, 1e-6)
            log(event="search_batch", lane=lane, claimed=len(rows), done=self.search_done,
                failed=self.search_failed, stale=self.search_stale, rate=round(rate, 2))
            return "claimed"
        return "empty"

    # -- main loops ---------------------------------------------------------------
    def run_service(self) -> int:
        """Forever mode: query lane every 1 s, index lane every 5 s, search-doc
        lane every SEARCH_POLL_S. The image-similarity lanes stay gated on
        admin_config.IMAGE_EMBED_ENABLED via dam.image_embed_enabled(); the
        search-doc lane (semantic search, a separate feature) runs whenever
        the poller is up, unless --no-search-lane was passed."""
        self.connect()
        self.hb = Heartbeat(self.conn_provider, self.args.worker_id)
        self.hb.start()
        log(event="service_start", worker=self.args.worker_id, stamp=self.args.stamp,
            search_lane=not self.args.no_search_lane)
        last_index = 0.0
        last_search = 0.0
        last_sg = 0.0
        sg_cooldown_until = 0.0
        while True:
            try:
                if self.embed_enabled():
                    for job in self.claim_query_job():
                        self.process_query_job(job)
                    if time.time() - last_index >= config.INDEX_POLL_S:
                        last_index = time.time()
                        jobs = self.claim_index_jobs()
                        if jobs:
                            self.process_index_batch(jobs)
                            rate = self.done / max(time.time() - self.t0, 1e-6)
                            log(event="index_batch", done=self.done, failed=self.failed,
                                rate=round(rate, 2))
                else:
                    self.enabled_cache = (False, 0.0)  # force re-check next tick
                if not self.args.no_search_lane and time.time() >= self.search_cooldown_until \
                        and time.time() - last_search >= config.SEARCH_POLL_S:
                    last_search = time.time()
                    if self.poll_search_lane() == "error":
                        self.search_cooldown_until = time.time() + config.SEARCH_LANE_ERROR_COOLDOWN_S
                if not self.args.no_search_lane and time.time() >= sg_cooldown_until \
                        and time.time() - last_sg >= config.SG_SEARCH_POLL_S:
                    last_sg = time.time()
                    if self.poll_search_lane(self.claim_sg_docs, lane="sg") == "error":
                        sg_cooldown_until = time.time() + config.SEARCH_LANE_ERROR_COOLDOWN_S
            except StopIteration:
                break
            except Exception as exc:
                log(event="loop_error", error=f"{type(exc).__name__}: {str(exc)[:200]}")
                time.sleep(2)
            time.sleep(config.QUERY_POLL_S)
        return 0

    def run_drain(self) -> int:
        """--once-drain: backfill mode. Drains the search-document lane first
        (style-group docs claim first server-side), then index jobs, exiting
        after N consecutive empty polls on both. Never touches the query
        lane."""
        self.connect()
        self.hb = Heartbeat(self.conn_provider, self.args.worker_id)
        self.hb.start()
        log(event="drain_start", worker=self.args.worker_id, stamp=self.args.stamp)
        idle = 0
        try:
            if not self.args.no_search_lane:
                search_idle = 0
                while search_idle < self.args.idle_exit_polls:
                    status = self.poll_search_lane()
                    if status == "error":
                        log(event="search_lane_unavailable",
                            note="search RPCs not granted yet? moving to the index lane")
                        break
                    search_idle = 0 if status == "claimed" else search_idle + 1
                    if status == "empty":
                        time.sleep(config.SEARCH_POLL_S)
            while True:
                jobs = self.claim_index_jobs()
                if not jobs:
                    idle += 1
                    if idle >= self.args.idle_exit_polls:
                        log(event="drain_complete", done=self.done, failed=self.failed,
                            search_done=self.search_done, search_failed=self.search_failed,
                            search_stale=self.search_stale)
                        break
                    time.sleep(config.INDEX_POLL_S)
                    continue
                idle = 0
                self.process_index_batch(jobs)
                rate = self.done / max(time.time() - self.t0, 1e-6)
                log(event="index_batch", done=self.done, failed=self.failed, rate=round(rate, 2))
                if self.args.limit and self.done + self.failed >= self.args.limit:
                    log(event="limit_reached", done=self.done, failed=self.failed)
                    break
        finally:
            if self.hb:
                self.hb.stop_flag.set()
            self.pool.shutdown(wait=False)
            try:
                self.conn.close()
            except Exception:
                pass
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=None, help="postgresql://dam_image_embed_login.qsllyeztdwjgirsysgai:...@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require")
    ap.add_argument("--dsn-file", default=None, help="path to a protected file holding the DSN (preferred; keeps the password off the command line)")
    ap.add_argument("--stamp", default=None, help="exact admin_config.IMAGE_SIM_EMBEDDING_MODEL value")
    ap.add_argument("--stamp-file", default=None, help="path to a protected file holding the exact stamp value (preferred)")
    ap.add_argument("--worker-id", default=config.DEFAULT_WORKER_ID)
    ap.add_argument("--batch", type=int, default=config.INDEX_CLAIM_BATCH)
    ap.add_argument("--lease-seconds", type=int, default=config.INDEX_LEASE_S)
    ap.add_argument("--search-batch", type=int, default=config.SEARCH_CLAIM_BATCH,
                    help="search-document claims per cycle (dam_search_documents lane)")
    ap.add_argument("--search-lease-seconds", type=int, default=config.SEARCH_LEASE_S,
                    help="search-document lease seconds (DB clamps 30..3600)")
    ap.add_argument("--no-search-lane", action="store_true",
                    help="disable the dam_search_documents lane (image-similarity lanes only)")
    ap.add_argument("--idle-exit-polls", type=int, default=config.IDLE_EXIT_POLLS, help="exit after N consecutive empty polls (drain mode)")
    ap.add_argument("--download-threads", type=int, default=config.DOWNLOAD_THREADS)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--once-drain", action="store_true", help="backfill mode: drain pending index jobs, then exit (no query lane)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N completed jobs (0 = unlimited)")
    args = ap.parse_args()

    from pathlib import Path
    if args.dsn_file:
        args.dsn = Path(args.dsn_file).read_text(encoding="utf-8").strip()
    if args.stamp_file:
        args.stamp = Path(args.stamp_file).read_text(encoding="utf-8").strip()
    if args.stamp:
        args.stamp = args.stamp.strip()

    print("loading models...", flush=True)
    models = load_models()
    if args.selftest:
        return 0 if selftest(models) else 1

    if not args.dsn or not args.stamp:
        print("--dsn/--dsn-file and --stamp/--stamp-file are required unless --selftest", file=sys.stderr)
        return 2

    poller = Poller(args, models)
    try:
        return poller.run_drain() if args.once_drain else poller.run_service()
    finally:
        if poller.hb:
            poller.hb.stop_flag.set()
        poller.pool.shutdown(wait=False)


if __name__ == "__main__":
    sys.exit(main())
