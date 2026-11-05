"""Poller unit tests (no DB, no GPU needed beyond torch import).

Run on the GPU box (or any machine with the venv):
  .venv\\Scripts\\python -m pytest tests -q

torch is only needed because the poller module imports it at top level;
without torch the whole file skips.
"""
from __future__ import annotations

import io
import struct
import zlib

import pytest

torch = pytest.importorskip("torch")  # noqa: F841 — poller import gate

import image_embed_poller as poller  # noqa: E402
import config  # noqa: E402


# ---------------------------------------------------------------------------
# border-crop (plan-locked numbers: ring 6 px, channel delta <= 12, <= 25% loss)
# ---------------------------------------------------------------------------

def _art(size=(400, 400), bg=(255, 255, 255)):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(img)
    d.ellipse((size[0] // 4, size[1] // 4, 3 * size[0] // 4, 3 * size[1] // 4), fill=(200, 40, 40))
    return img


def _framed(interior_size=(90, 90), border=5, colour=(255, 255, 255)):
    """Solid red interior with a uniform frame — interior blocks the flood."""
    from PIL import Image
    iw, ih = interior_size
    img = Image.new("RGB", (iw + 2 * border, ih + 2 * border), colour)
    img.paste(Image.new("RGB", (iw, ih), (200, 40, 40)), (border, border))
    return img


def test_border_crop_crops_white_border():
    img = _framed(border=5)
    cropped_img, cropped = poller.border_crop(img)
    assert cropped is True
    assert cropped_img.size == (90, 90)


def test_border_crop_tolerance_12():
    # A frame with JPEG-like noise within delta 12 of the ring median still
    # crops; the flood propagates over near-median border pixels.
    import numpy as np
    from PIL import Image
    base = np.asarray(_framed(border=6), dtype=np.int16)
    rng = np.random.default_rng(7)
    h, w = base.shape[:2]
    noise = rng.integers(-10, 11, size=(h, w, 3))
    noisy = np.clip(base + noise, 0, 255).astype(np.uint8)
    # Keep the interior solid red so only the frame is noisy.
    noisy[6:-6, 6:-6] = base[6:-6, 6:-6]
    img = Image.fromarray(noisy)
    cropped_img, cropped = poller.border_crop(img)
    assert cropped is True
    assert cropped_img.size == (90, 90)


def test_border_crop_guard_25_percent():
    # White ground with a small subject: flood fill would remove > 25% of the
    # area, so the crop must be skipped (white-ground false-positive guard).
    img, cropped = poller.border_crop(_art(size=(400, 400)))
    assert cropped is False
    assert img.size == (400, 400)


def test_border_crop_exif_transpose():
    from PIL import Image
    img = Image.new("RGB", (100, 60), (255, 255, 255))
    exif = Image.Exif()
    exif[274] = 6  # orientation 6 -> 90 degrees
    img.info["exif"] = exif.tobytes()
    out, _ = poller.border_crop(img)
    assert out.size == (60, 100)  # transpose applied before anything else


# ---------------------------------------------------------------------------
# upload payload rejects (query lane)
# ---------------------------------------------------------------------------

def _jpeg_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def test_poller_rejects_bomb():
    # Valid-structure PNG whose IHDR claims 30000x30000 (900 MP) — Pillow's
    # own decompression-bomb guard must fire and become a permanent reject.
    comp = zlib.compressobj()
    compressed = comp.compress(b"\x00" + b"\x00\x00\x00\xff" * 30000) + comp.flush()
    bomb = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", 30000, 30000, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", compressed)
        + _chunk(b"IEND", b"")
    )
    with pytest.raises(poller.PermanentReject, match="bomb|too large|decode"):
        poller.open_upload(bomb)

    # A malformed header-only bomb is still a permanent reject (never retried).
    header_only = b"\x89PNG\r\n\x1a\n" + _chunk(
        b"IHDR", struct.pack(">IIBBBBB", 30000, 30000, 8, 6, 0, 0, 0)
    )
    with pytest.raises(poller.PermanentReject):
        poller.open_upload(header_only)


def test_upload_pixel_guard(monkeypatch):
    # Our own 60 MP guard sits below Pillow's bomb threshold; prove it fires
    # by shrinking it under this small fixture image's pixel count.
    monkeypatch.setattr(config, "UPLOAD_MAX_PIXELS", 1000)
    with pytest.raises(poller.PermanentReject, match="too large"):
        poller.open_upload(_jpeg_bytes(_art(size=(64, 64))))


def test_poller_rejects_unsupported():
    with pytest.raises(poller.PermanentReject, match="unsupported"):
        poller.open_upload(b"II*\x00" + b"\x00" * 64)  # TIFF
    with pytest.raises(poller.PermanentReject, match="unsupported"):
        poller.open_upload(b"8BPS " + b"\x00" * 64)  # PSD


def test_poller_rejects_oversize():
    blob = b"\xff\xd8\xff" + b"\x00" * (config.UPLOAD_MAX_BYTES + 1)
    with pytest.raises(poller.PermanentReject, match="exceeds"):
        poller.open_upload(blob)


def test_poller_rejects_non_image():
    with pytest.raises(poller.PermanentReject):
        poller.open_upload(b"<html><body><script>alert(1)</script></body></html>")


def test_poller_rejects_truncated():
    good = _jpeg_bytes(_art(size=(64, 64)))
    with pytest.raises(poller.PermanentReject, match="decode failed"):
        poller.open_upload(good[: len(good) // 3])


def test_poller_rejects_animated():
    from PIL import Image
    frames = [Image.new("RGB", (32, 32), c) for c in ((255, 0, 0), (0, 0, 255))]
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:])
    with pytest.raises(poller.PermanentReject, match="animated"):
        poller.open_upload(buf.getvalue())


def test_upload_accepts_plain_jpeg_png_webp_magic():
    img = poller.open_upload(_jpeg_bytes(_art(size=(64, 64))))
    assert img.size == (64, 64)
    buf = io.BytesIO()
    _art(size=(64, 64)).save(buf, format="PNG")
    assert poller.sniff_magic(buf.getvalue()) == "PNG"
    assert poller.sniff_magic(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "WEBP"
    assert poller.sniff_magic(b"II*\x00\x00\x00\x00\x00") is None


# ---------------------------------------------------------------------------
# vector serialization
# ---------------------------------------------------------------------------

def test_halfvec_text_dims():
    import numpy as np
    text = poller.halfvec_text(np.zeros(config.DIM, dtype=np.float32))
    assert text.startswith("[") and text.endswith("]")
    assert len(text[1:-1].split(",")) == config.DIM


# ---------------------------------------------------------------------------
# search-document lane (popdam3 #646): claim -> thumbnail -> SigLIP2 -> upsert
# ---------------------------------------------------------------------------

def test_search_vector_text_format():
    import numpy as np
    vec = np.full(config.DIM, 0.5, dtype=np.float32)
    text = poller.search_vector_text(vec)
    assert text.startswith("[") and text.endswith("]")
    parts = text[1:-1].split(",")
    assert len(parts) == config.DIM
    assert parts[0] == "0.5000000"  # 7-decimal form, matches existing corpus writes


class _FakeCursor:
    def __init__(self, calls):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchone(self):
        return (True,)

    def fetchall(self):
        return []


class _FakeConn:
    def __init__(self, calls):
        self.calls = calls

    def cursor(self):
        return _FakeCursor(self.calls)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


def _search_poller(monkeypatch, rows, vectors=None):
    """Poller with a recording fake connection and embedded fetch/embed."""
    import argparse
    args = argparse.Namespace(
        dsn="postgresql://x", stamp="stamp", worker_id="test-search",
        batch=32, lease_seconds=300, search_batch=64, search_lease_seconds=900,
        no_search_lane=False, idle_exit_polls=1, download_threads=2, limit=0,
    )
    p = poller.Poller(args, models=None)
    calls = []
    p.conn = _FakeConn(calls)
    monkeypatch.setattr(p, "_run", lambda fn: fn(p.conn))
    monkeypatch.setattr(p, "claim_search_docs", lambda: rows)

    import io as _io
    from PIL import Image

    buf = _io.BytesIO()
    Image.new("RGB", (16, 16), (10, 20, 30)).save(buf, format="PNG")

    def fake_fetch(url, timeout=None):
        return buf.getvalue()

    monkeypatch.setattr(poller, "fetch_url", fake_fetch)
    if vectors is not None:
        monkeypatch.setattr(poller, "embed_siglip_only", lambda images, models, batch_size=None: vectors)
    else:
        def fake_embed(images, models, batch_size=None):
            import numpy as np
            return np.asarray([[0.25] * config.DIM for _ in images], dtype=np.float32)
        monkeypatch.setattr(poller, "embed_siglip_only", fake_embed)
    return p, calls


def _row(entity, thumb="https://cdn/x.jpg"):
    import datetime, uuid
    return ("style_group", uuid.uuid4(), "text", thumb, "sha-" + str(entity)[:8],
            uuid.uuid4(), None, 1)


def test_search_batch_marks_missing_thumbnail_transient(monkeypatch):
    import uuid
    rows = [_row(uuid.uuid4(), thumb=None)]
    p, calls = _search_poller(monkeypatch, rows)
    p.process_search_batch(rows)
    marks = [c for c in calls if "mark_dam_search_embedding_error" in c[0]]
    assert len(marks) == 1
    assert marks[0][1][5] == "transient"          # category
    assert "missing thumbnail_url" in marks[0][1][4]
    assert p.search_failed == 1 and p.search_done == 0
    assert not any("upsert_dam_search_embedding(" in c[0] for c in calls)


def test_search_batch_upserts_each_document(monkeypatch):
    import uuid
    rows = [_row(uuid.uuid4()), _row(uuid.uuid4())]
    p, calls = _search_poller(monkeypatch, rows)
    p.process_search_batch(rows)
    upserts = [c for c in calls if "upsert_dam_search_embedding" in c[0]]
    assert len(upserts) == 2
    for c in upserts:
        sql, params = c
        assert "::extensions.vector" in sql
        assert params[5] == config.SEARCH_DOC_MODEL_STAMP
        assert len(params[4][1:-1].split(",")) == config.DIM
    assert p.search_done == 2 and p.search_failed == 0


def test_search_batch_download_failure_is_transient(monkeypatch):
    import uuid
    rows = [_row(uuid.uuid4())]
    p, calls = _search_poller(monkeypatch, rows)

    def boom(url, timeout=None):
        raise OSError("connection reset")

    monkeypatch.setattr(poller, "fetch_url", boom)
    p.process_search_batch(rows)
    marks = [c for c in calls if "mark_dam_search_embedding_error" in c[0]]
    assert len(marks) == 1
    assert marks[0][1][5] == "transient"
    assert p.search_failed == 1


def test_sg_rows_use_the_popsg_rpcs(monkeypatch):
    import argparse
    import numpy as np
    args = argparse.Namespace(
        dsn="postgresql://x", stamp="stamp", worker_id="test-sg",
        batch=32, lease_seconds=300, search_batch=64, search_lease_seconds=900,
        no_search_lane=False, idle_exit_polls=1, download_threads=2, limit=0,
    )
    p = poller.Poller(args, models=None)
    calls = []
    p.conn = _FakeConn(calls)
    monkeypatch.setattr(p, "_run", lambda fn: fn(p.conn))
    row = (None, "id", "text", "url", "hash", "lease", None, 1)
    p.search_upsert(row, np.zeros(config.DIM))
    p.search_mark_error(row, "boom", "transient")
    text = " ".join(str(call) for call in calls)
    assert "upsert_sg_search_embedding" in text and "mark_sg_search_embedding_error" in text
    assert "dam_search_embedding" not in text


def test_dam_search_lane_rpc_contract(monkeypatch):
    """Bind caller positions to the deployed public RPC signatures (#663).

    Database contracts: 20261101005850 (claim), 20261023184940 (upsert),
    20260825082910 (mark error); grants have a shared-db SQL contract test.
    Only the transport is replaced: all three real caller methods execute.
    """
    import numpy as np
    row = _row("contract")
    p, calls = _search_poller(monkeypatch, [])
    monkeypatch.delattr(p, "claim_search_docs")
    assert p.claim_search_docs() == []
    assert p.search_upsert(row, np.zeros(config.DIM)) is True
    p.search_mark_error(row, "x" * 600, "transient")
    assert len(calls) == 3
    claim, upsert, error = calls
    assert "public.claim_dam_search_embedding_documents(%s, %s, %s)" in claim[0]
    assert claim[1] == (64, "test-search", 900)
    assert "public.upsert_dam_search_embedding(%s, %s, %s, %s, %s::extensions.vector, %s)" in upsert[0]
    assert upsert[1] == (row[0], row[1], row[4], row[5],
                         "[" + ",".join(["0.0000000"] * config.DIM) + "]",
                         "google/siglip2-base-patch16-naflex")
    assert "public.mark_dam_search_embedding_error(%s, %s, %s, %s, %s, %s)" in error[0]
    assert error[1] == (row[0], row[1], row[4], row[5], "x" * 500, "transient")


@pytest.mark.parametrize("missing", [None, ""])
def test_dam_search_missing_thumbnail_does_not_block_valid_neighbor(monkeypatch, missing):
    rows = [_row("waiting", thumb=missing), _row("ready")]
    p, calls = _search_poller(monkeypatch, rows)
    p.process_search_batch(rows)
    marks = [params for sql, params in calls if "mark_dam_search_embedding_error" in sql]
    upserts = [params for sql, params in calls if "upsert_dam_search_embedding" in sql]
    assert len(marks) == len(upserts) == 1
    assert marks[0][1] == rows[0][1] and marks[0][5] == "transient"
    assert upserts[0][1] == rows[1][1]
    assert p.search_done == p.search_failed == 1
