"""
SigLIP2 text-embedding service for PopDAM typed search queries.

Same model / math as the GPU image embedder (D:\\ai\\siglip2-embed):
  text tower -> pooler_output -> L2 normalize -> 768 floats.

POST /embed-text  {"text": "..."}  -> {"ok":true,"dim":768,"model":"...","vector":[...]}
GET  /health                      -> {"ok":true,"model":"...","device":"..."}
"""
from __future__ import annotations

import os
import time

import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModel, AutoProcessor

MODEL_ID = os.environ.get("SIGLIP2_MODEL", "google/siglip2-base-patch16-naflex")
MODEL_STAMP = MODEL_ID
API_KEY = os.environ.get("EMBED_API_KEY", "")
PORT = int(os.environ.get("PORT", "8090"))

app = FastAPI(title="PopDAM SigLIP2 text embed", version="1.0.0")

_device = "cuda" if torch.cuda.is_available() else "cpu"
_processor = AutoProcessor.from_pretrained(MODEL_ID)
_model = AutoModel.from_pretrained(MODEL_ID).to(_device).eval()


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)


def _as_tensor(out):
    if hasattr(out, "pooler_output"):
        return out.pooler_output
    if isinstance(out, (tuple, list)):
        return out[0]
    return out


@torch.no_grad()
def embed_text(text: str) -> list[float]:
    inputs = _processor(
        text=[text],
        return_tensors="pt",
        padding="max_length",
        max_length=64,
        truncation=True,
    )
    inputs = {k: v.to(_device) for k, v in inputs.items()}
    feats = _as_tensor(_model.get_text_features(**inputs))
    feats = torch.nn.functional.normalize(feats, dim=-1)
    return feats[0].cpu().tolist()


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
