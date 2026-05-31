# Development Guide

## Prerequisites

| Tool | Version | Required for |
|------|---------|-------------|
| Node.js | 20.x | Frontend (`src/`), worker (`apps/worker/`), bridge agent (`apps/bridge-agent/`) |
| npm | bundled with Node 20 | Frontend and app installs |
| Bun | latest | CI (`ci.yml` uses `bun run` for lint/test); optional locally |
| Deno | v2.x | Edge function formatting (`edge-functions-format.yml` uses `deno fmt`) |
| Docker | any recent | Bridge agent container builds; optional for local dev |
| Supabase CLI | latest | CI only (`deploy-supabase.yml` runs `supabase db push`); not used locally |

The Supabase CLI is not required for local development. All schema changes go through the `apply_migration` MCP tool (see Database section).

---

## Environment Setup

### Frontend

The frontend requires no `.env.local`. The Supabase URL and anon key for project `ryltkzzernhwnojzouyb` are hardcoded in `src/lib/app-mode.ts`. This is intentional — the Lovable platform overwrites `.env` files on every deploy, so environment variables cannot be relied upon.

```bash
npm install
```

### Worker

The worker (`apps/worker/`) requires environment variables to run locally:

```bash
# apps/worker/.env (create locally, never commit)
SUPABASE_URL=https://ryltkzzernhwnojzouyb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase dashboard>
OPENROUTER_API_KEY=<optional; falls back to admin_config>
```

```bash
cd apps/worker && npm install
```

### Bridge Agent

The bridge agent (`apps/bridge-agent/`) uses an `.env` file. A reference is in `.env.example` in that directory. Minimum required vars for a local test run (without actual NAS filesystem):

```bash
SUPABASE_URL=https://ryltkzzernhwnojzouyb.supabase.co
AGENT_KEY=<key from agent_registrations table>
SUPABASE_ANON_KEY=<anon key for Realtime>
NAS_CONTAINER_MOUNT_ROOT=/mnt/popdam   # or any local path for testing
SCAN_ROOTS=Art Files                   # comma-separated folder names
DO_SPACES_KEY=<DigitalOcean Spaces access key>
DO_SPACES_SECRET=<DigitalOcean Spaces secret>
DO_SPACES_BUCKET=popdam
DO_SPACES_REGION=nyc3
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
```

```bash
cd apps/bridge-agent && npm install
```

---

## Local Development

### Frontend

```bash
npm run dev
```

Vite serves on `http://localhost:8080` (configured in `vite.config.ts`). The app connects directly to the production Supabase project — there is no local Supabase instance.

**PopSG preview:** Add `?mode=popsg` to any URL. The mode is persisted in `sessionStorage` for that tab, so subsequent navigation within the tab stays in PopSG mode. To switch back: add `?mode=popdam` or open a new tab.

### Worker

```bash
cd apps/worker
npm run dev        # tsx watch mode, reconnects on file changes
# or
npm start          # production mode (compiled JS)
```

The worker polls `admin_config.BULK_OPERATIONS` immediately on start. It will connect to the production Supabase project using the service role key.

### Bridge Agent

```bash
cd apps/bridge-agent
npm run dev        # tsx watch mode
```

In development, the bridge agent will attempt to register with `agent-api` using the configured `AGENT_KEY`. For filesystem operations, `NAS_CONTAINER_MOUNT_ROOT` must point to a locally accessible path.

### Edge Functions (Local Serve)

To run edge functions locally (requires Supabase CLI and Docker):

```bash
supabase functions serve --env-file supabase/functions/.env.local
```

This is rarely needed. Most edge function development can be tested against the production project using the Supabase dashboard or direct HTTP calls.

---

## Bridge Agent Development

### Running Without Docker

```bash
cd apps/bridge-agent
npm run dev
```

The agent runs as a plain Node.js process. It does not require Docker for development. Docker is only needed for the production Synology deployment.

### Production Container Requirements

The production Docker Compose file (`deploy/synology/docker-compose.yml`) mounts:
- NAS asset directories into the container (read-only)
- `/var/run/docker.sock` (for self-update: the agent pulls a new image and restarts its own container via the Docker API)

The `POPDAM_CONTAINER_NAME` env var must match the actual container name so the agent can restart itself during self-update.

### Versioning

**Every change to `apps/bridge-agent/` must include a version bump in `apps/bridge-agent/package.json` in the same commit.** The CI workflow publishes a new Docker image tagged with the version from `package.json`.

- Patch (`x.x.X`): bug fixes, non-behavioral changes
- Minor (`x.X.0`): new features, new capabilities
- Major (`X.0.0`): breaking changes or major rewrites

Never version-bump in a separate commit. The bump and the code change must be atomic.

---

## Database

Schema changes follow a strict two-path discipline. Mixing paths causes `supabase db push` to fail in CI.

### The Two-Path Rule

| Method | Records in migration history? | When to use |
|--------|------------------------------|-------------|
| `apply_migration` MCP | YES — with actual clock timestamp | All DDL (CREATE/ALTER/DROP TABLE, FUNCTION, POLICY, INDEX, TRIGGER) |
| `execute_sql` MCP | NO | Data queries and one-off DML only |

**Never use `execute_sql` for DDL.** It bypasses migration history. The change lands in the DB but CI has no record of it and will fail on the next push.

### Safe Migration Workflow

1. Decide on the SQL content.
2. Call `apply_migration` MCP to apply it to the remote DB.
3. Immediately call `list_migrations` to get the exact timestamp Supabase recorded.
4. Create the local file in `supabase/migrations/` using that exact timestamp as the filename prefix.
5. Commit and push immediately.

The filename timestamp **must** match the DB-recorded timestamp exactly. A mismatch causes CI to either try to re-apply the migration (causing "already exists" errors) or refuse to run (out-of-order migration error).

### CI Failure: "Remote migration versions not found in local migrations directory"

The DB has history entries with no corresponding local file. Fix:

```sql
-- Via execute_sql MCP:
DELETE FROM supabase_migrations.schema_migrations
WHERE version IN ('...', '...');
```

Then push a trivial change to re-trigger CI.

### CI Failure: "Found local migration files to be inserted before the last migration"

A local file exists with a timestamp earlier than the latest DB migration but is not recorded in DB history. Two options:

- **SQL already applied** (applied directly, not recorded): insert a history record via `execute_sql`.
- **SQL not yet applied**: apply via `apply_migration`, get the recorded timestamp, rename the local file.

Never add `--include-all` to the CI workflow.

---

## Testing and Linting

### Root (Frontend)

```bash
npm run lint        # ESLint
npm run test        # Vitest (run once)
npm run test:watch  # Vitest watch mode
```

CI runs these via Bun:

```bash
bun run lint
bun run test
```

### popdam-helper (Electron)

```bash
cd apps/popdam-helper
npm run typecheck   # tsc --noEmit
```

### Worker and Bridge Agent

There are no automated test suites for these apps currently. Linting via ESLint/TypeScript type checking:

```bash
cd apps/worker && npx tsc --noEmit
cd apps/bridge-agent && npx tsc --noEmit
```

---

## Edge Functions

### Deployment

Edge functions are deployed automatically by `deploy-supabase.yml` on every push to `main` that touches `supabase/functions/**`. Functions are deployed with `supabase functions deploy --project-ref ryltkzzernhwnojzouyb`.

Manual deploy via CLI:

```bash
supabase functions deploy <function-name> --project-ref ryltkzzernhwnojzouyb
```

### CORS and JWT

Functions with `verify_jwt = false` in `supabase/config.toml` handle their own JWT verification internally. This is required for functions that need CORS preflight support (browser clients) or that use the `x-agent-key` header (agent clients).

Functions with `verify_jwt = false`:
- `admin-api`
- `agent-api`
- `helper-api`
- `authenticate-with-authentik`
- `verify-app-access`

All other functions use Supabase's built-in JWT verification.

### Shared Code

Common utilities live in `supabase/functions/_shared/`. Key files:

- `mg-codes.ts` — MerchGroup reverse-lookup maps (API description → letter code). If changed, redeploy functions and run a Full ERP Sync.
- `admin-handlers/` — Sub-handlers imported by `admin-api/index.ts`.
- `cors.ts` — Standard CORS headers.

---

## Common Dev Tasks

### Adding a New Frontend Page

1. Create the component in `src/pages/` (or `src/pages/popsg/` for PopSG-only).
2. Add the route in `src/App.tsx`. Wrap with `IS_POPSG` / `IS_POPDAM` guard if mode-specific.
3. Add a nav entry in the sidebar/header if needed.

### Adding a Route to an Edge Function

1. Add the route handler in the function's `index.ts` (e.g., `supabase/functions/admin-api/index.ts`).
2. For complex handlers, extract to a file in `supabase/functions/_shared/admin-handlers/` and import.
3. If the route needs a new DB table or column, add a migration first (see Database section).
4. Push to `main` — CI deploys the function automatically.

### Adding a Migration

```
1. Write the SQL.
2. apply_migration MCP → name="describe_the_change", query="<SQL>"
3. list_migrations MCP → copy the exact version timestamp from the result
4. Create supabase/migrations/<timestamp>_describe_the_change.sql with the SQL content
5. git add supabase/migrations/<timestamp>_describe_the_change.sql
6. Commit and push to main
7. Watch the deploy-supabase.yml workflow — confirm it passes
```

### Changing ERP Classification Rules

The AI classification prompt is in `apps/worker/src/handlers/erp.ts` (~line 336). Two editable sections:

- **IMPORTANT CLASSIFICATION RULES** — numbered rules for broad patterns
- **CORRECTION EXAMPLES** — specific phrase → category mappings for counterintuitive cases

After editing the prompt, the next "Classify Now" run uses the updated rules. Previously classified items are not automatically re-run; reject them in the ERP Items Browser to re-queue them.

The model used is read from `admin_config.AI_TASK_MODELS.text_classification` (cached 60 s). Default: `anthropic/claude-3.5-haiku`.
