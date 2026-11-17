"""Tests for the text-embed service. Run inside the image (models baked in):
    docker run --rm -e EMBED_API_KEY=k <image> python -m pytest -q test_main.py
"""
import math
import os

os.environ.setdefault("EMBED_API_KEY", "k")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)
H = {"X-Embed-Key": os.environ["EMBED_API_KEY"]}


def _cos(a, b):
    return sum(x * y for x, y in zip(a, b))


def test_health_reports_both_models():
    body = client.get("/health").json()
    assert body["model"] == "google/siglip2-base-patch16-naflex"
    assert body["text_model"] == "Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"
    assert body["dim"] == 768 and body["text_dim"] == 1024


def test_key_required():
    r = client.post("/embed-text-batch", json={"texts": ["a"]})
    assert r.status_code == 401


def test_query_prefix_exact():
    assert main.query_text_for("marie frame") == (
        "Instruct: Given a product search query, retrieve matching product descriptions\nQuery:marie frame"
    )


def test_batch_returns_both_vectors_backward_compatible():
    texts = ["framed print", "picture frame wall art", "lap desk"]
    body = client.post("/embed-text-batch", json={"texts": texts}, headers=H).json()
    assert body["ok"] and body["dim"] == 768 and body["model"] == main.MODEL_STAMP
    assert len(body["vectors"]) == 3 and all(len(v) == 768 for v in body["vectors"])
    assert body["text_model"] == main.TEXT_MODEL_STAMP and body["text_dim"] == 1024
    tv = body["text_vectors"]
    assert len(tv) == 3 and all(len(v) == 1024 for v in tv)
    for v in tv:
        assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, abs_tol=1e-3)
    assert _cos(tv[0], tv[1]) > _cos(tv[0], tv[2])


def test_batch_padding_does_not_change_vectors():
    alone = main._embed_query_texts(["marie frame"])[0]
    padded = main._embed_query_texts(["marie frame", "a much longer query about framed wall art prints"])[0]
    assert _cos(alone, padded) > 0.999


def test_prefix_cache_matches_full_forward():
    qs = ["marie frame", "spiderman lap desk", "nightmare before christmas jack skellington sign"]
    for a, b in zip(main._embed_query_texts(qs), main._embed_query_texts_full(qs)):
        assert _cos(a, b) > 0.9999


def test_long_query_truncated():
    long = "frame " * 2000
    body = client.post("/embed-text-batch", json={"texts": [long]}, headers=H).json()
    assert len(body["text_vectors"][0]) == 1024
