---
summary: Always-on HTTP service embedding typed search words with the SigLIP2 text tower (768 numbers, picture search) and Qwen3-Embedding-0.6B (1024 numbers, text-meaning search, #1037).
kind: living
status: current
read-when: changing the text-embed query service
---

# PopDAM text-embed (SigLIP2 query tower + Qwen3 text-meaning)

Small always-on HTTP service that turns typed search words into 768-number
vectors using `google/siglip2-base-patch16-naflex` **text tower** — the same
model that produced the library picture vectors. Since #1037 the batch route
also returns a 1024-number text-meaning vector per text from
`Qwen/Qwen3-Embedding-0.6B` pinned at revision
`97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3` (stamp
`Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`), query
side: the text is prefixed with
`Instruct: Given a product search query, retrieve matching product descriptions\nQuery:`,
last-token pooling, L2 normalized, fp32 on CPU. Query words are capped at 64
tokens (`TEXT_MAX_TOKENS`). The prefix's attention cache is computed once at
startup so each request runs only its own tokens (same vectors, ~2x faster).
Documents are embedded elsewhere WITHOUT the prefix; both sides must use the
same stamp.

## Contract

| Endpoint | Body | Response |
|---|---|---|
| `GET /health` | — | `{ok, model, device, dim, text_model, text_dim}` |
| `POST /embed-text` | `{text}` (1–8000 characters) | `{ok, dim, model, vector[768], took_ms}` |
| `POST /embed-text-batch` | `{texts: [up to 16, each 1–8000 characters]}` | `{ok, dim, model, vectors[768][], text_dim, text_model, text_vectors[1024][], took_ms}` |

Auth: optional `X-Embed-Key` header matching `EMBED_API_KEY` (open if unset).

The service answers ONE CPU forward pass per request and serialises concurrent
requests, so `dam-search-ai` sends the typed query plus its product-phrase
variants together through `/embed-text-batch` — one forward pass and one
latency draw instead of calls that queue behind each other (#804). Texts are
padded to a fixed 64 tokens either way, so extra texts in a batch cost almost
nothing.

`/embed-text` (single text) stays SigLIP2-only. Each worker holds both models
(about 4 GB resident).

## Tests

```bash
docker build -t te-test apps/text-embed
docker run --rm te-test python -m pytest -q test_main.py
```

## Run locally (edge-dev GPU)

```powershell
D:\ai\siglip2-embed\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8090
```

## Deploy

Docker image is CPU-capable. Point Supabase function secrets at it:

- `TEXT_EMBED_URL` — `https://text-embed.designflow.app` (Coolify on the Hetz VPS, image built by `publish-text-embed.yml`)
- `TEXT_EMBED_KEY` — shared secret

`dam-search-ai` calls this for every typed query. If it is down, search degrades
to keyword-only (never mixes gte-small with SigLIP2 documents).
