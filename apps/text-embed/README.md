# PopDAM text-embed (SigLIP2 query tower)

Small always-on HTTP service that turns typed search words into 768-number
vectors using `google/siglip2-base-patch16-naflex` **text tower** — the same
model that produced the library picture vectors.

## Contract

| Endpoint | Body | Response |
|---|---|---|
| `GET /health` | — | `{ok, model, device, dim}` |
| `POST /embed-text` | `{text}` | `{ok, dim, model, vector[768], took_ms}` |

Auth: optional `X-Embed-Key` header matching `EMBED_API_KEY` (open if unset).

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
