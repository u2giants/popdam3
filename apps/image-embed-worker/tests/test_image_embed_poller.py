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
        no_text_lane=False, text_batch=64, text_lease_seconds=600, text_model_path=None,
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
        no_text_lane=False, text_batch=64, text_lease_seconds=600, text_model_path=None,
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


def test_sg_claim_fits_round_budget(monkeypatch):
    p, calls = _search_poller(monkeypatch, [])
    p.claim_sg_docs()
    assert calls[-1][1][0] == 1
    p.tune_sg_batch(5.0, 1)
    assert p.sg_batch == 4
    p.tune_sg_batch(4.0, 4)
    assert p.sg_batch == 20
    p.tune_sg_batch(5.0, 32)
    assert p.sg_batch == 32
    p.claim_sg_docs()
    assert calls[-1][1][0] == 32
    p.tune_sg_batch(60.0, 32)
    assert p.sg_batch == 10
    p.tune_sg_batch(40.0, 1)
    assert p.sg_batch == 1


def test_query_lane_is_served_between_saves(monkeypatch):
    p, _calls = _search_poller(monkeypatch, [])
    jobs = []
    monkeypatch.setattr(p, "embed_enabled", lambda: True)
    monkeypatch.setattr(p, "claim_query_job", lambda: ["job"])
    monkeypatch.setattr(p, "process_query_job", jobs.append)
    p.serve_query_lane_between_saves()
    p.serve_query_lane_between_saves()
    assert jobs == ["job"]


def test_sg_claim_yields_after_one_document_without_changing_dam_batch(monkeypatch):
    p, calls = _search_poller(monkeypatch, [])
    monkeypatch.delattr(p, "claim_search_docs")
    assert config.SEARCH_CLAIM_BATCH == 64
    assert config.SG_SEARCH_POLL_S == 1.0
    p.claim_sg_docs()
    p.claim_search_docs()
    assert "claim_sg_search_embedding_documents" in calls[0][0]
    assert calls[0][1] == (1, "test-search", 900)
    assert "claim_dam_search_embedding_documents" in calls[1][0]
    assert calls[1][1] == (64, "test-search", 900)


@pytest.mark.parametrize("lane", ["dam", "sg"])
@pytest.mark.parametrize("fails", [False, True])
def test_search_logs_identify_lane(monkeypatch, capsys, lane, fails):
    import json
    p, _calls = _search_poller(monkeypatch, [])
    monkeypatch.setattr(p, "process_search_batch", lambda rows: None)

    def claim():
        if fails:
            raise RuntimeError("claim unavailable")
        return [object()]

    if lane == "dam":
        monkeypatch.setattr(p, "claim_search_docs", claim)
        status = p.poll_search_lane()
    else:
        status = p.poll_search_lane(claim, lane="sg")
    event = json.loads(capsys.readouterr().out)
    assert event["lane"] == lane
    assert event["event"] == ("search_lane_error" if fails else "search_batch")
    assert status == ("error" if fails else "claimed")


def test_service_returns_to_dam_between_sg_documents(monkeypatch):
    import itertools
    p, _calls = _search_poller(monkeypatch, [])
    order = []
    ticks = iter([False, False])
    monkeypatch.setattr(p, "connect", lambda: None)
    monkeypatch.setattr(p, "embed_enabled", lambda: next(ticks))
    monkeypatch.setattr(poller.Heartbeat, "start", lambda self: None)
    clock = itertools.count(1000, 10)
    monkeypatch.setattr(poller.time, "time", lambda: next(clock))
    monkeypatch.setattr(poller.time, "sleep", lambda seconds: None)

    def record_lane(claim=None, lane="dam"):
        order.append(lane)
        return "claimed"

    monkeypatch.setattr(p, "poll_search_lane", record_lane)
    assert p.run_service() == 0
    assert order == ["dam", "sg", "dam", "sg"]


# ---------------------------------------------------------------------------
# Text-meaning lane (popdam3 #1037 Step 4)
# ---------------------------------------------------------------------------

def _text_row(text="Product type: Frame\nItem description: framed art", model=None):
    import uuid
    return ("style_group", uuid.uuid4(), text, "a" * 64, model or config.TEXT_MODEL_STAMP,
            uuid.uuid4(), None, 1)


def _text_poller(monkeypatch):
    import numpy as np
    p, calls = _search_poller(monkeypatch, [])
    embedded = []

    def fake_embed(texts, batch_size=None):
        embedded.extend(texts)
        return np.asarray([[0.5] + [0.0] * (config.TEXT_DIM - 1) for _ in texts], dtype=np.float32)

    monkeypatch.setattr(p.text_embedder, "embed", fake_embed)
    monkeypatch.setattr(p, "serve_query_lane_between_saves", lambda: None)
    return p, calls, embedded


def _fake_service_clock(monkeypatch, p, ticks):
    import itertools
    it = iter([False] * ticks)
    monkeypatch.setattr(p, "connect", lambda: None)
    monkeypatch.setattr(p, "embed_enabled", lambda: next(it))
    monkeypatch.setattr(poller.Heartbeat, "start", lambda self: None)
    clock = itertools.count(1000, 10)
    monkeypatch.setattr(poller.time, "time", lambda: next(clock))
    monkeypatch.setattr(poller.time, "sleep", lambda s: None)


def test_text_lane_claim_upsert_round_trip(monkeypatch):
    p, calls, embedded = _text_poller(monkeypatch)
    assert p.claim_text_docs() == []
    claim = calls[0]
    assert "public.claim_dam_search_text_embedding_documents(%s, %s, %s)" in claim[0]
    assert claim[1] == (64, "test-search", 600)
    row = _text_row()
    p.process_text_batch([row])
    sql, params = calls[1]
    assert "public.upsert_dam_search_text_embedding(%s, %s, %s, %s, %s::extensions.halfvec, %s)" in sql
    assert params[:4] == (row[0], row[1], row[3], row[5])
    assert len(params[4][1:-1].split(",")) == config.TEXT_DIM
    assert embedded == [row[2]]
    assert p.text_done == 1 and p.text_failed == 0


def test_text_lane_writes_model_stamp_exactly(monkeypatch):
    p, calls, _ = _text_poller(monkeypatch)
    p.process_text_batch([_text_row()])
    assert calls[-1][1][5] == "Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"
    assert config.TEXT_MODEL_STAMP == calls[-1][1][5]


def test_text_lane_refuses_other_model_stamp(monkeypatch, capsys):
    p, calls, embedded = _text_poller(monkeypatch)
    row = _text_row(model="some/other-model@abc")
    monkeypatch.setattr(p, "claim_text_docs", lambda: [row])
    assert p.poll_text_lane() == "error"
    assert embedded == [] and not any("upsert" in c[0] for c in calls)
    assert "text_lane_error" in capsys.readouterr().out


@pytest.mark.parametrize("text", ["", "   ", None])
def test_text_lane_empty_input_is_permanent_skip(monkeypatch, text):
    p, calls, embedded = _text_poller(monkeypatch)
    p.process_text_batch([_text_row(text=text)])
    marks = [c for c in calls if "mark_dam_search_text_embedding_error" in c[0]]
    assert len(marks) == 1 and marks[0][1][5] == "permanent"
    assert embedded == [] and p.text_failed == 1


def test_text_lane_long_input_is_truncated_not_failed():
    import numpy as np

    class Batch(dict):
        def to(self, _device):
            return self

    class Tok:
        def __call__(self, texts, **kw):
            assert kw["truncation"] is True and kw["max_length"] == config.TEXT_MAX_TOKENS
            ids = torch.ones((len(texts), kw["max_length"]), dtype=torch.long)
            return Batch(input_ids=ids, attention_mask=ids)

    class Out:
        def __init__(self, h):
            self.last_hidden_state = h

    class Model:
        def __call__(self, input_ids, attention_mask):
            return Out(torch.ones((input_ids.shape[0], input_ids.shape[1], config.TEXT_DIM)))

    e = poller.TextEmbedder(device="cpu")
    e.tokenizer, e.model = Tok(), Model()
    vec = e.embed(["word " * 100_000, "\U0001F642"])
    assert vec.shape == (2, config.TEXT_DIM)
    assert np.allclose(np.linalg.norm(vec, axis=1), 1.0)


def test_text_lane_missing_grant_cools_down_without_stopping_other_lanes(monkeypatch):
    p, _calls, _ = _text_poller(monkeypatch)
    order = []
    _fake_service_clock(monkeypatch, p, 3)

    def claim():
        order.append("text")
        raise RuntimeError("permission denied for function claim_dam_search_text_embedding_documents")

    monkeypatch.setattr(p, "claim_text_docs", claim)
    monkeypatch.setattr(p, "poll_search_lane", lambda claim=None, lane="dam": order.append(lane) or "empty")
    assert p.run_service() == 0
    assert order.count("text") == 1                 # one error, then 10-minute cooldown
    assert order.count("dam") == 3                  # other lanes keep running
    assert p.text_cooldown_until >= 1000 + config.TEXT_LANE_ERROR_COOLDOWN_S


def test_no_text_lane_switch(monkeypatch):
    p, _calls, _ = _text_poller(monkeypatch)
    p.args.no_text_lane = True
    _fake_service_clock(monkeypatch, p, 2)
    monkeypatch.setattr(p, "poll_search_lane", lambda claim=None, lane="dam": "empty")
    monkeypatch.setattr(p, "claim_text_docs", lambda: pytest.fail("text lane ran"))
    assert p.run_service() == 0


def test_text_model_unloads_when_idle(monkeypatch):
    p, _calls, _ = _text_poller(monkeypatch)
    state = {"unloaded": False}
    p.text_embedder.model = object()
    monkeypatch.setattr(p.text_embedder, "unload", lambda: state.update(unloaded=True))
    p.text_embedder.last_used = poller.time.time() - config.TEXT_IDLE_UNLOAD_S - 1
    monkeypatch.setattr(p, "claim_text_docs", lambda: [])
    assert p.poll_text_lane() == "empty"
    assert state["unloaded"]


def test_text_only_runs_only_the_text_lane(monkeypatch):
    p, _calls, _ = _text_poller(monkeypatch)
    p.args.text_only = True
    monkeypatch.setattr(p, "connect", lambda: None)
    monkeypatch.setattr(poller.time, "sleep", lambda s: None)
    monkeypatch.setattr(poller.Heartbeat, "start", lambda self: pytest.fail("heartbeat started"))
    for name in ("claim_query_job", "claim_index_jobs", "claim_search_docs", "claim_sg_docs",
                 "embed_enabled"):
        monkeypatch.setattr(p, name, lambda *a, **k: pytest.fail("picture lane ran"))
    results = iter(["claimed", "empty", "error"])
    seen = []

    def poll():
        try:
            r = next(results)
        except StopIteration:
            raise StopIteration
        seen.append(r)
        return r

    monkeypatch.setattr(p, "poll_text_lane", poll)
    assert p.run_text_only() == 0
    assert seen == ["claimed", "empty", "error"]
    assert p.text_cooldown_until > 0 and p.hb is None


def test_text_only_skips_query_lane_between_saves(monkeypatch):
    p, _calls = _search_poller(monkeypatch, [])
    p.args.text_only = True
    monkeypatch.setattr(p, "embed_enabled", lambda: pytest.fail("query lane touched"))
    p.serve_query_lane_between_saves()


def test_main_text_only_never_loads_picture_models(monkeypatch, tmp_path):
    dsn = tmp_path / "w.dsn"
    dsn.write_text("postgresql://x")
    monkeypatch.setattr(poller, "load_models", lambda: pytest.fail("picture models loaded"))
    monkeypatch.setattr(poller.Poller, "run_text_only", lambda self: 0)
    monkeypatch.setattr(poller.sys, "argv", ["x", "--text-only", "--dsn-file", str(dsn)])
    assert poller.main() == 0


def test_drain_limit_one_processes_one_job_and_exits_normally(monkeypatch):
    """#1098: a bounded drain claims at most the remaining limit and returns 0."""
    import argparse
    import threading
    import uuid
    args = argparse.Namespace(
        dsn="postgresql://x", stamp="stamp", worker_id="test-limit",
        batch=32, lease_seconds=300, search_batch=64, search_lease_seconds=900,
        no_search_lane=True, idle_exit_polls=1, download_threads=2, limit=1,
        no_text_lane=True, text_batch=64, text_lease_seconds=600, text_model_path=None,
    )
    p = poller.Poller(args, models=None)
    queue = [(uuid.uuid4(), uuid.uuid4()) for _ in range(3)]
    claimed_sizes = []

    class _Cur:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params):
            claimed_sizes.append(params[1])

        def fetchall(self):
            n = claimed_sizes[-1]
            out = queue[:n]
            del queue[:n]
            return out

    class _Conn:
        def cursor(self):
            return _Cur()

        def close(self):
            pass

    class _HB:
        stop_flag = threading.Event()

        def start(self):
            pass

    monkeypatch.setattr(p, "connect", lambda: setattr(p, "conn", _Conn()))
    monkeypatch.setattr(p, "_run", lambda fn: fn(_Conn()))
    monkeypatch.setattr(poller, "Heartbeat", lambda *a, **k: _HB())
    processed = []

    def fake_batch(jobs):
        processed.extend(jobs)
        p.done += len(jobs)

    monkeypatch.setattr(p, "process_index_batch", fake_batch)
    assert p.run_drain() == 0
    assert len(processed) == 1
    assert claimed_sizes == [1]
    assert len(queue) == 2


def test_index_claim_size_respects_remaining_limit():
    import argparse
    p = poller.Poller(argparse.Namespace(batch=32, limit=5, download_threads=1), models=None)
    assert p.index_claim_size() == 5
    p.done, p.failed = 3, 1
    assert p.index_claim_size() == 1
    p.done = 4
    assert p.index_claim_size() == 0 and p.index_limit_reached()
    p.args.limit = 0
    assert p.index_claim_size() == 32 and not p.index_limit_reached()
