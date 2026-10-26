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
