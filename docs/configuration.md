# Configuration Reference

## AI model capability overrides

`admin_config.AI_MODEL_CAPABILITY_OVERRIDES` is optional JSON keyed by the bare
OpenRouter model ID. It may set `tools`, `tool_choice`, `tool_choice_modes`,
`structured_outputs`, `json_object`, `image_input`, and an ordered `prefer`
list. It contains no credentials. The worker refreshes it once per minute and
merges it over the cached live model catalog.

```json
{"meta/muse-spark-1.2":{"tool_choice_modes":["auto"],"prefer":["json_schema","json_object","tool_auto"]}}
```

## Frontend — Build-Time Config

The frontend has **no runtime env vars**. All configuration is baked into the bundle at build time.

### Hardcoded Supabase config (`src/lib/app-mode.ts`)

```typescript
const POPDAM_SUPABASE_URL = "https://qsllyeztdwjgirsysgai.supabase.co";
const POPDAM_ANON_KEY = "sb_publishable_...";
```

Both PopDAM and PopSG modes use the same Supabase project. Mode controls UI and routing only. The anon key is publishable client config, not a service credential; see quirk #1 in [KNOWN_QUIRKS.md](KNOWN_QUIRKS.md) for why it is hardcoded rather than in env vars.

### Build-time env vars (optional, CI-only)

| Var | Purpose | Injected by |
|-----|---------|-------------|
| `APP_COMMIT` | Short git SHA shown in header | `publish-frontend.yml` |
| `APP_DATE` | ISO commit timestamp shown in header | `publish-frontend.yml` |

These are optional; omitting them leaves the version display blank in the header. They are defined in `vite.config.ts` via `define: { __APP_COMMIT__: ..., __APP_DATE__: ... }`.

---

## GitHub Actions Secrets

### Frontend (publish-frontend.yml)

| Secret | Type / source | Purpose |
|--------|---------------|---------|
| `GHCR_PAT` | Classic PAT (`write:packages`) owned by a package admin | Preferred frontend GHCR publish credential when present; required while package Actions access blocks `GITHUB_TOKEN` writes |
| `GHCR_USERNAME` | Optional GitHub username for `GHCR_PAT` owner | Currently unused by `publish-frontend.yml`; keep only if a future workflow uses a non-`github.actor` username |
| `COOLIFY_TOKEN` | Coolify API token (deploy permission) | Trigger Coolify deployment |
| `COOLIFY_APP_UUID` | Coolify app UUID | Coolify app identifier |
| `COOLIFY_URL` | Coolify API base URL | Coolify API base URL |

Frontend GHCR pushes authenticate with `GHCR_PAT` when the secret exists; otherwise they fall back to the workflow's implicit `GITHUB_TOKEN` (`packages: write`). For `GITHUB_TOKEN` to push the existing `ghcr.io/u2giants/popdam-frontend` package, the package settings must grant repository `u2giants/popdam3` **Write** under "Manage Actions access." Without that package permission or a valid `GHCR_PAT`, `docker push` fails with `permission_denied: write_package`; in June 2026 this left production stuck on an old frontend because no newer `:latest` image reached GHCR.

Coolify also needs pull access from the VPS. The deployment helper reads the host Docker credential file (`/root/.docker/config.json`) when pulling the private frontend image. If GitHub Actions publishes successfully but Coolify logs registry `unauthorized`, refresh the VPS Docker login for `ghcr.io`; never document or commit the token value.

### Supabase deploy (deploy-supabase.yml)

| Secret | Type / source | Purpose |
|--------|---------------|---------|
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token | Authenticate edge-function deploys and type generation |
| `EXTERNAL_SUPABASE_PROJECT_ID` | Supabase project ID | Target Supabase project |

Database migration secrets live only in canonical `u2giants/shared-db`.
Do not add `EXTERNAL_SUPABASE_DB_PASSWORD`, `SUPABASE_DB_PASSWORD`,
`SUPABASE_DB_URL`, `POSTGRES_URL`, or equivalent direct database credentials to
this app repo.

### Bridge Agent (publish-bridge-agent.yml)

| Secret | Type / source | Purpose |
|--------|---------------|---------|
| `GHCR_PAT` | GitHub PAT (`write:packages`) | Push Docker image to GHCR |
| `SUPABASE_URL` | Supabase project URL | Notify cloud of new version |
| `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` | Service role key | Update `BRIDGE_LATEST_BUILD` in admin_config |

### Helper (publish-popdam-helper.yml)

| Secret | Type / source | Purpose |
|--------|---------------|---------|
| `GH_TOKEN` | GitHub PAT | Create/update GitHub Release |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Literal `false` when signing is disabled | Suppresses implicit keychain discovery until certs are provisioned |
| `CSC_LINK` | Base64 Developer ID `.p12` or secure file URL | macOS Developer ID signing certificate |
| `CSC_KEY_PASSWORD` | `.p12` export password | Unlocks `CSC_LINK` |
| `APPLE_ID` | Apple ID email | Notarization account |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password | Notarization authentication |
| `APPLE_TEAM_ID` | Apple Developer Team ID | Notarization team |

macOS signing/notarization is wired but secrets are **not yet configured**. With signing secrets absent, the workflow ships an unsigned DMG and skips notarization. Windows signing is not wired; SmartScreen still warns until a separate OV/EV cert path is added. See [HANDOFF.md](../HANDOFF.md).

### Windows Agent (publish-windows-agent.yml)

| Secret | Type / source | Purpose |
|--------|---------------|---------|
| `GITHUB_TOKEN` | Auto-provided | Create GitHub Releases |
| `SUPABASE_URL` | Supabase project URL | Notify cloud of new version |
| `DEPLOY_WEBHOOK_KEY` | Deploy key | Authenticate `notify-build` call to agent-api |

---

## Supabase — `admin_config` Table

Runtime configuration lives in the `admin_config` table (`key`, `value` jsonb columns). Managed through Settings in the web UI. Key entries:

| Key | Purpose |
|-----|---------|
| `OPENROUTER_API_KEY` | API key for AI tagging and PDF vision (feeds bridge/windows agents via heartbeat) |
| `POPDAM_MOUNT_PATH` | NAS root path for PopDAM scan |
| `POPSG_MOUNT_PATH` | NAS root path for PopSG crawl |
| `AGENT_API_KEY` | Pre-shared key agents include in every request |
| `DIGITAL_OCEAN_SPACES_*` | DigitalOcean Spaces non-secret config (bucket, region, endpoint, public_base_url) |
| `COLDLION_*` | ERP API credentials |
| `BULK_OPERATIONS` | State for all bulk jobs (see `docs/BULK_JOBS.md`) |
| `SCAN_REQUEST` | Pending scan trigger flags for agents |
| `STYLE_GUIDE_CRAWL_REQUEST` | Pending PopSG crawl trigger |
| `ERP_LAST_SYNC_DATE` | Watermark for incremental ERP sync |
| `ERP_CATEGORY_CUTOFF_DATE` | Items before this date have mg_category nulled (legacy) |
| `PROD_ORDER_API_*` | PLM production PO sync non-secret config: optional token header-name overrides and optional `PROD_ORDER_API_ENDPOINT`. Store token values and Google service account JSON as Supabase Edge Function secrets, not in `admin_config`. `PROD_ORDER_API_TOKEN_2` is currently the PLM `X-User-Authorization` app token; browser-copied values expire and are not a durable integration path. |
| `BRIDGE_LATEST_BUILD` | Latest published bridge agent build: `{ version, sha, published_at, ... }`. The `sha` (git commit) is the immutable identity the admin UI compares the agent's reported `build_sha` against to detect drift — see the "Agent `version` can lie" quirk in `AGENTS.md`. |
| `AI_TASK_MODELS` | Per-task AI model overrides (`vision_tagging`, `vision_tagging_fallback`, `vision_tagging_provider`, `text_classification`, `pdf_extraction`). `vision_tagging_provider` = optional comma-separated OpenRouter provider slug(s) that pin Image Tagging to those endpoints with fallbacks disabled — see `docs/KNOWN_QUIRKS.md` #60. |
| `BLANK_THUMB_CLEANUP_REQUEST` | Pending blank thumbnail cleanup trigger |
| `UPDATE_REQUEST` | Bridge agent self-update trigger |
| `CHECKIN_VERIFICATION_ENABLED` | **Feature flag** (boolean). When true, Seafile-sourced check-ins park in `verifying` until the bridge agent confirms receipt on the Synology (size + quick-hash); when false/absent they complete immediately on upload. Activated 2026-06-09. Set to `false` for instant rollback — no redeploy. See the "Seafile check-ins park in `verifying`" quirk in `AGENTS.md`. |

### AI model dropdown refresh

Settings → AI Models and Settings → Processing model pickers refresh from OpenRouter using the saved `admin_config.OPENROUTER_API_KEY`. The UI calls OpenRouter's key-scoped `/api/v1/models/user` endpoint so the list reflects the account's guardrails, not the public model catalog. Image Tagging and Vision Bake-Off then apply the same filter: image-capable models that support tool calling, OpenRouter `response_format` JSON-schema structured outputs, or JSON mode (`response_format: { "type": "json_object" }`). JSON-mode outputs are parsed and must include the required `tags`, `ai_description`, `scene_description`, and `content_type` fields before the worker stores a result.

The Railway worker reads `admin_config.AI_TASK_MODELS.vision_tagging` for production Image Tagging and defaults to `google/gemini-2.5-flash` when unset. `vision_tagging_fallback` is optional. The worker caches the model config for 60 seconds.

Vision Bake-Off compares five models per run. Each result records the model latency, OpenRouter-reported prompt/completion/total token usage, and an estimated USD cost based on the current OpenRouter account pricing fetched from `/api/v1/models/user` when the worker processes the run. The pricing snapshot is stored with the result so historical runs are not reinterpreted if OpenRouter later changes prices.

For image input, the bake-off uses the best cloud-reachable rendition: PDF assets prefer the latest 1500px PDF page image stored on `pdf_text_samples.thumbnail_url`; other assets fall back to the 800px `assets.thumbnail_url`. The selected rendition is recorded in `ai_tag_bakeoff_results.raw_output._popdam_image_rendition` as `pdf_hires_1500` or `thumbnail_800`. This does not change production Image Tagging, which still reads `assets.thumbnail_url`.

The bake-off also stores best-effort OpenRouter route evidence in `ai_tag_bakeoff_results.raw_output._popdam_provider`. The worker sends `X-OpenRouter-Metadata: enabled`, captures `X-Generation-Id`/OpenRouter headers, tries to parse success and error-body `openrouter_metadata`, and enriches from `/api/v1/generation` when possible. The UI shows the resulting provider/endpoint beside time, tokens, and cost and summarizes provider success/failure patterns per run. Old rows, OpenRouter cache hits, and some edge/auth/rate-limit failures can still show `unknown`.

**⚠️ Reality check (2026-07-14):** only the `/api/v1/generation`-enriched *serving* endpoint reliably shows up. The `openrouter_metadata.attempts[]` / `endpoints.available` parsing — the part that would reveal *which endpoints failed* — reads fields that are **undocumented and appear to never populate** (docs list no such fields or `X-OpenRouter-Metadata` header; 0 of 251 prod rows had a `_popdam_provider` blob at check time; a live probe was blocked by the account's OpenRouter data-policy). Do not rely on a failed-endpoint list appearing. To force/diagnose a specific endpoint, use `AI_TASK_MODELS.vision_tagging_provider` (pin + `allow_fallbacks: false`; hard failure names the provider). See `docs/KNOWN_QUIRKS.md` #59/#60.

Vision Bake-Off sampling is random, not recent-first. When the admin does not
provide explicit asset IDs, `create-ai-tag-bakeoff-run` samples eligible
thumbnail-backed assets by random UUID pivots and deduplicates by `quick_hash`,
`sku + filename`, and filename, preferring non-`TECHPACK` copies over duplicated
tech-pack copies. This avoids one freshly ingested SKU/folder copy dominating a
run.

Character/property outputs are grounded after the model responds. The prompt
allows both `character_ids` and `character_names`; the worker accepts UUIDs only
when they agree with the selected/evidenced property, resolves exact character
names from the `characters` table, and stores rejected/unresolved taxonomy
details in `raw_output._popdam_debug`. A model can correctly name a character in
the description but still produce no `character_ids` if the canonical character
row is missing.

The base description guidance is code-owned in
`supabase/functions/_shared/tag-asset-contract.js`. It tells models to write
`ai_description` as concise search metadata for designers/salespeople and
`scene_description` as a literal visual description. `TAGGING_INSTRUCTIONS`
should be used only for short organization-specific additions, not to paste a
second full prompt; every extra token is paid on each tagged asset.

OpenRouter can return unavailable placeholder aliases with negative pricing. The UI treats negative prompt/completion pricing as unavailable and filters those entries out rather than displaying the sentinel price.

---

## Supabase — Vault Secrets

Sensitive values that edge functions access via `select * from vault.decrypted_secrets`. Managed in the Supabase dashboard → Vault.

Key secrets: `BREVO_API_KEY` (email invites), `OPENROUTER_API_KEY` (AI models), DigitalOcean Spaces credentials.

---

## Bridge Agent (`apps/bridge-agent`)

Configuration comes from the agent's `admin_config` entries (fetched from Supabase on startup via heartbeat) and from environment variables set in the Synology Docker Compose file.

Key env vars (set in `deploy/synology/docker-compose.yml`):

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for agent API auth |
| `AGENT_API_KEY` | Pre-shared key (must match `admin_config`) |
| `POPDAM_CONTAINER_NAME` | Canonical container name (used for self-update; prevents accumulation of `-old-*` containers) |
| `POPDAM_IMAGE_TAG` | Injected at Docker build time; shown in heartbeat version info |
| `POPDAM_BUILD_SHA` | Injected at Docker build time; shown in heartbeat version info |
| `NAS_MOUNT` | Container-side mount path for NAS volume |
| `SUPABASE_ANON_KEY` | Optional; enables Realtime watcher for instant scan delivery |

---

## Cloud Worker (`apps/worker`)

Runs on Railway. Environment variables are set in the Railway project dashboard.

| Var | Required | Purpose |
|-----|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `OPENROUTER_API_KEY` | Yes | AI tagging and ERP classification — **not the same as admin_config.OPENROUTER_API_KEY** |
| `META_API_KEY` | No | Meta Model API direct access when Image Tagging selects `meta-direct/muse-spark-1.2-contributor` |
| `GOOGLE_AI_API_KEY` | No | Legacy fallback if no OpenRouter key |

**Critical:** `OPENROUTER_API_KEY` in Railway and `OPENROUTER_API_KEY` in `admin_config` are two separate things. Setting the key in the admin UI (Settings → AI Models) only updates `admin_config`. The Railway worker reads exclusively from Railway ENV variables.

---

## POP DAM Helper (`apps/popdam-helper`)

The desktop app stores its configuration in a local file (`dam-config.json`, path varies by OS) and uses Electron's `safeStorage` for encrypted credential storage. The user provides:

1. **Supabase URL** — pre-populated from `dam-config.json` distributed with the installer
2. **Email + password** — stored in `safeStorage` after first sign-in
3. **Anon key** — bundled in `dam-config.json`

No `.env` file is used by the Helper.

---

## Traefik / VPS

Runtime Traefik configuration lives in `/data/coolify/proxy/dynamic/` on the VPS host (bind-mounted into the `coolify-proxy` container). Files here are loaded live — no Traefik restart needed.

| File | Purpose |
|------|---------|
| `coolify.yaml` | Coolify's own routing (auto-generated; do not edit) |
| `popdam-sg.yml` | `sg.designflow.app` → popdam-frontend routing |
| `default_redirect_503.yaml` | Coolify catchall fallback |

The Coolify Traefik instance has two cert resolvers:
- `letsencrypt` — HTTP-01 challenge (used by popdam-frontend)
- `letsencrypt-dns` — Cloudflare DNS-01 challenge (available but not used by popdam-frontend)
