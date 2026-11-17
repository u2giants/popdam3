"""
SigLIP2 text-embedding service for PopDAM typed search queries.

Same model / math as the GPU image embedder (D:\\ai\\siglip2-embed):
  text tower -> pooler_output -> L2 normalize -> 768 floats.

POST /embed-text        {"text": "..."}    -> {"ok":true,"dim":768,"model":"...","vector":[...]}
POST /embed-text-batch  {"texts": ["..."]} -> {"ok":true,"dim":768,"model":"...","vectors":[[...],...],
                                               "text_dim":1024,"text_model":"...","text_vectors":[[...],...]}
GET  /health                               -> {"ok":true,"model":"...","text_model":"...","device":"..."}

The batch route also returns the Qwen3 text-meaning vector per text (#1037):
query side, instruction prefix, last-token pooling, L2 normalize.
"""
from __future__ import annotations

import copy
import os
import time
from concurrent.futures import ThreadPoolExecutor

import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModel, AutoProcessor, AutoTokenizer

MODEL_ID = os.environ.get("SIGLIP2_MODEL", "google/siglip2-base-patch16-naflex")
MODEL_STAMP = MODEL_ID
API_KEY = os.environ.get("EMBED_API_KEY", "")
PORT = int(os.environ.get("PORT", "8090"))

TEXT_MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
TEXT_MODEL_REVISION = "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"
TEXT_MODEL_STAMP = f"{TEXT_MODEL_ID}@{TEXT_MODEL_REVISION}"
TEXT_DIM = 1024
QUERY_PREFIX = "Instruct: Given a product search query, retrieve matching product descriptions\nQuery:"
# Typed queries are short; cap the tokens so a pasted paragraph cannot stall the CPU.
TEXT_MAX_TOKENS = int(os.environ.get("TEXT_MAX_TOKENS", "64"))

app = FastAPI(title="PopDAM SigLIP2 text embed", version="1.0.0")

_device = "cuda" if torch.cuda.is_available() else "cpu"
_processor = AutoProcessor.from_pretrained(MODEL_ID)
_model = AutoModel.from_pretrained(MODEL_ID).to(_device).eval()
if _device == "cpu":
    try:
        _model = torch.compile(_model, mode="reduce-overhead")
    except Exception:
        pass  # older torch or unsupported backend; plain eager is fine

_text_tokenizer = AutoTokenizer.from_pretrained(
    TEXT_MODEL_ID, revision=TEXT_MODEL_REVISION, padding_side="left"
)
_text_model = AutoModel.from_pretrained(
    TEXT_MODEL_ID, revision=TEXT_MODEL_REVISION, dtype=torch.float32
).to(_device).eval()
_pool = ThreadPoolExecutor(max_workers=1)
# The instruction prefix is identical for every query, so its attention cache is
# computed once at startup; each request then runs only its own few tokens
# (~2x faster on CPU, same vectors to within float rounding).
_prefix_ids = _text_tokenizer(QUERY_PREFIX, add_special_tokens=False)["input_ids"]
with torch.inference_mode():
    _prefix_cache = _text_model(
        input_ids=torch.tensor([_prefix_ids], device=_device), use_cache=True
    ).past_key_values


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)


class EmbedBatchRequest(BaseModel):
    # Search sends the typed query plus its product-phrase variants together:
    # one forward pass for them all instead of requests that queue on the CPU
    # (padding is already fixed at max_length, so extra texts cost ~nothing).
    texts: list[str] = Field(..., min_length=1, max_length=16)


def _as_tensor(out):
    if hasattr(out, "pooler_output"):
        return out.pooler_output
    if isinstance(out, (tuple, list)):
        return out[0]
    return out


@torch.inference_mode()
def _embed_texts(texts: list[str]) -> list[list[float]]:
    inputs = _processor(
        text=texts,
        return_tensors="pt",
        padding="max_length",
        max_length=64,
        truncation=True,
    )
    inputs = {k: v.to(_device) for k, v in inputs.items()}
    feats = _as_tensor(_model.get_text_features(**inputs))
    feats = torch.nn.functional.normalize(feats, dim=-1)
    return feats.cpu().tolist()


def query_text_for(text: str) -> str:
    return f"{QUERY_PREFIX}{text}"


@torch.inference_mode()
def _embed_query_texts(texts: list[str]) -> list[list[float]]:
    p = len(_prefix_ids)
    ids = _text_tokenizer(
        [query_text_for(t) for t in texts], truncation=True, max_length=p + TEXT_MAX_TOKENS
    )["input_ids"]
    if not all(r[:p] == _prefix_ids and len(r) > p for r in ids):
        return _embed_query_texts_full(texts)
    suffixes = [r[p:] for r in ids]
    batch, width = len(suffixes), max(map(len, suffixes))
    # Right-pad the query tokens and read each row at its own last real token:
    # with causal attention this equals left padding + last position.
    input_ids = torch.full((batch, width), _text_tokenizer.pad_token_id, dtype=torch.long)
    mask = torch.zeros((batch, p + width), dtype=torch.long)
    mask[:, :p] = 1
    for i, row in enumerate(suffixes):
        input_ids[i, : len(row)] = torch.tensor(row)
        mask[i, p : p + len(row)] = 1
    cache = copy.deepcopy(_prefix_cache)
    cache.batch_repeat_interleave(batch)
    positions = torch.arange(p, p + width).unsqueeze(0).expand(batch, width)
    hidden = _text_model(
        input_ids=input_ids.to(_device),
        attention_mask=mask.to(_device),
        position_ids=positions.to(_device),
        past_key_values=cache,
        use_cache=True,
    ).last_hidden_state
    last = torch.tensor([len(r) - 1 for r in suffixes], device=hidden.device)
    feats = torch.nn.functional.normalize(hidden[torch.arange(batch, device=hidden.device), last], dim=-1)
    return feats.float().cpu().tolist()


@torch.inference_mode()
def _embed_query_texts_full(texts: list[str]) -> list[list[float]]:
    """Reference path: whole prefixed text, left padding, last token."""
    prefix_tokens = len(_prefix_ids) + 1
    inputs = _text_tokenizer(
        [query_text_for(t) for t in texts],
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=prefix_tokens + TEXT_MAX_TOKENS,
    )
    inputs = {k: v.to(_device) for k, v in inputs.items()}
    hidden = _text_model(**inputs).last_hidden_state
    feats = torch.nn.functional.normalize(hidden[:, -1], dim=-1)
    return feats.float().cpu().tolist()


def embed_text(text: str) -> list[float]:
    return _embed_texts([text])[0]


def _check_key(x_embed_key: str | None) -> None:
    if not API_KEY:
        return
    if x_embed_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid embed key")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model": MODEL_STAMP,
        "device": _device,
        "dim": 768,
        "text_model": TEXT_MODEL_STAMP,
        "text_dim": TEXT_DIM,
    }


@app.post("/embed-text")
def embed_text_route(
    body: EmbedRequest,
    x_embed_key: str | None = Header(default=None),
) -> dict:
    _check_key(x_embed_key)
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    started = time.perf_counter()
    vector = embed_text(text)
    if not vector or len(vector) != 768:
        raise HTTPException(status_code=500, detail=f"bad dim {len(vector) if vector else 0}")
    return {
        "ok": True,
        "dim": 768,
        "model": MODEL_STAMP,
        "vector": vector,
        "took_ms": int((time.perf_counter() - started) * 1000),
    }


@app.post("/embed-text-batch")
def embed_text_batch_route(
    body: EmbedBatchRequest,
    x_embed_key: str | None = Header(default=None),
) -> dict:
    _check_key(x_embed_key)
    texts = [t.strip() for t in body.texts]
    if not all(texts):
        raise HTTPException(status_code=400, detail="empty text in batch")
    started = time.perf_counter()
    # Both models in parallel: torch releases the GIL during the forward pass.
    text_future = _pool.submit(_embed_query_texts, texts)
    vectors = _embed_texts(texts)
    text_vectors = text_future.result()
    if not vectors or any(len(v) != 768 for v in vectors):
        raise HTTPException(status_code=500, detail="bad dims in batch")
    if len(text_vectors) != len(texts) or any(len(v) != TEXT_DIM for v in text_vectors):
        raise HTTPException(status_code=500, detail="bad text dims in batch")
    return {
        "ok": True,
        "dim": 768,
        "model": MODEL_STAMP,
        "vectors": vectors,
        "text_dim": TEXT_DIM,
        "text_model": TEXT_MODEL_STAMP,
        "text_vectors": text_vectors,
        "took_ms": int((time.perf_counter() - started) * 1000),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
