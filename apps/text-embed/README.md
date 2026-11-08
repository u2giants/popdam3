# PopDAM text-embed (SigLIP2 query tower)

Small always-on HTTP service that turns typed search words into 768-number
vectors using `google/siglip2-base-patch16-naflex` **text tower** — the same
model that produced the library picture vectors.

## Contract

| Endpoint | Body | Response |
|---|---|---|
| `GET /health` | — | `{ok, model, device, dim}` |
| `POST /embed-text` | `{text}` | `{ok, dim, model, vector[768], took_ms}` |
| `POST /embed-text-batch` | `{texts: [up to 16]}` | `{ok, dim, model, vectors[768][], took_ms}` |

Auth: optional `X-Embed-Key` header matching `EMBED_API_KEY` (open if unset).

The service answers ONE CPU forward pass per request and serialises concurrent
requests, so `dam-search-ai` sends the typed query plus its product-phrase
variants together through `/embed-text-batch` — one forward pass and one
latency draw instead of calls that queue behind each other (#804). Texts are
padded to a fixed 64 tokens either way, so extra texts in a batch cost almost
nothing.

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
