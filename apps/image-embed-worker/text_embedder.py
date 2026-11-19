"""Lazy text document encoding for the image embedding worker."""

from __future__ import annotations

import json
import time

import numpy as np
import torch
from transformers import AutoModel

import config


def log(**fields) -> None:
    fields.setdefault("t", time.strftime("%Y-%m-%dT%H:%M:%S"))
    print(json.dumps(fields, default=str), flush=True)


class TextEmbedder:
    """Lazily loaded Qwen3-Embedding document encoder (popdam3 #1037 Step 4).

    Document side per the model card: no instruction prefix, left padding,
    last-token pooling, L2 normalize. Loaded on first use and released after
    TEXT_IDLE_UNLOAD_S without work so the picture lanes keep their GPU room.
    """

    def __init__(self, model_path=None, device=None):
        self.model_path = model_path
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = None
        self.model = None
        self.last_used = 0.0

    @property
    def loaded(self) -> bool:
        return self.model is not None

    def load(self):
        if self.loaded:
            return
        from transformers import AutoTokenizer
        src = self.model_path or config.TEXT_MODEL_ID
        kw = {} if self.model_path else {"revision": config.TEXT_MODEL_REVISION}
        self.tokenizer = AutoTokenizer.from_pretrained(src, padding_side="left", **kw)
        dtype = torch.float16 if self.device == "cuda" else torch.float32
        self.model = AutoModel.from_pretrained(src, torch_dtype=dtype, **kw).to(self.device).eval()
        log(event="text_model_loaded", model=config.TEXT_MODEL_STAMP, device=self.device)

    def unload(self):
        if not self.loaded:
            return
        self.model = self.tokenizer = None
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        log(event="text_model_unloaded")

    @torch.no_grad()
    def embed(self, texts, batch_size=config.TEXT_INFERENCE_BATCH):
        """texts -> numpy [n, TEXT_DIM] float32, L2-normalized."""
        self.load()
        self.last_used = time.time()
        out = []
        for i in range(0, len(texts), batch_size):
            batch = self.tokenizer(texts[i : i + batch_size], padding=True, truncation=True,
                                   max_length=config.TEXT_MAX_TOKENS, return_tensors="pt").to(self.device)
            hidden = self.model(**batch).last_hidden_state
            feats = torch.nn.functional.normalize(hidden[:, -1].float(), p=2, dim=-1)
            out.extend(feats.cpu().tolist())
        return np.asarray(out, dtype=np.float32)
