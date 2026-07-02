# Local Development

## Prerequisites

- **Node.js 20** (the CI runner and Dockerfile use `node:20`)
- **npm** (bundled with Node)
- **Supabase CLI** — for migration and edge function work (`brew install supabase/tap/supabase` or see [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli))
- **Deno** — required for edge function format/type checks. In the current Codex environment it is installed at `/root/.deno/bin/deno`; add `/root/.deno/bin` to `PATH` or call that binary directly.
- **Docker** — only needed if building images locally; not required for `npm run dev`

## Frontend (React web app)

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:8080)
npm run dev

# Production build
npm run build

# Lint
npm run lint

# Type check
npx tsc --noEmit

# Tests (Vitest)
npm test
```

The dev server binds to `::` (all interfaces) on port 8080. No `.env.local` file is required — Supabase credentials are hardcoded in `src/lib/app-mode.ts` and connect to the production Supabase project (`qsllyeztdwjgirsysgai`). See quirk #1 in [KNOWN_QUIRKS.md](KNOWN_QUIRKS.md).

### Preview PopSG mode

Add `?mode=popsg` to any URL. The mode is stored in `sessionStorage` for the tab, so it persists across navigation within the tab but resets on a new tab. To reset to PopDAM: `?mode=popdam` or open a fresh tab.

```
http://localhost:8080/library?mode=popsg
```

The app checks hostname → `sg.designflow.app` = PopSG, `dam.designflow.app` = PopDAM. The query param overrides hostname detection for local testing. See `src/lib/app-mode.ts`.

### Build-time metadata

The Vite build injects `APP_COMMIT` and `APP_DATE` from env vars (set in CI). These are optional — omitting them makes the version display blank in the header.

```bash
APP_COMMIT=$(git rev-parse --short HEAD) APP_DATE=$(git log -1 --format=%cI) npm run build
```

## Supabase Migrations

**Read [CLAUDE.md](../CLAUDE.md) before writing any migration.** The timestamp discipline is critical — a mismatch between the local filename timestamp and the DB-recorded timestamp breaks CI.

Short version:
1. Apply via `apply_migration` MCP
2. Immediately call `list_migrations` to get the exact timestamp Supabase recorded
3. Create the local file as `supabase/migrations/<that-timestamp>_<name>.sql`
4. Commit immediately — do not let timestamp-fix work accumulate

### Shared database changes

This repo does not own shared Supabase migrations anymore. For any DDL,
policy, trigger, RPC, pg_cron, view, or data migration:

1. Stop editing this repo.
2. Switch to canonical `/worksp/shared-db`.
3. Follow `shared-db/AGENTS.md` and create a shared-db branch + PR.
4. Return here only for app/function/type changes that consume the new contract.

Use this repo for Supabase edge-function code under `supabase/functions/**`.
Do not add new files under this repo's `supabase/migrations/`.

## Edge Functions

Edge functions run on Deno in the `supabase/functions/` directory. To test locally:

```bash
supabase functions serve <function-name> --env-file supabase/functions/.env
```

Format check (run by CI on every push touching functions):
```bash
deno fmt --check supabase/functions/
```

Type check all deployed edge function entrypoints:
```bash
/root/.deno/bin/deno check --config supabase/functions/deno.json \
  supabase/functions/*/index.ts
```

Shared code lives in `supabase/functions/_shared/`. Both `admin-api` and `agent-api` are monolithic routers (all routes in one function) — see quirk #5 in [KNOWN_QUIRKS.md](KNOWN_QUIRKS.md).

## Individual Apps

Each app under `apps/` has its own `package.json`. Run from the app directory:

```bash
cd apps/bridge-agent
npm install
npm run dev          # watch mode with tsx
npm run build        # compile to dist/
```

```bash
cd apps/worker
npm install
npm run dev          # starts the worker process
npm run build
```

```bash
cd apps/popdam-helper
npm install
npm run dev          # electron-vite dev (opens Electron window)
npm run typecheck
npm run build        # electron-vite build
npm run dist:mac     # macOS package (signing/notarization requires GitHub secrets in CI)
npm run dist:win     # Windows NSIS package
```

```bash
cd apps/windows-agent
npm install
npm run dev          # tsx watch
npm run build
```

## Git Workflow

Push directly to `main`. No feature branches. No PRs. See [CLAUDE.md](../CLAUDE.md).

```bash
git add <files>
git commit -m "..."
git push origin main
git push github main
```

After any push touching `supabase/migrations/` or `supabase/functions/`, check the `Deploy Supabase` workflow run in GitHub Actions.

After any push touching `apps/worker/`, Railway auto-deploys. No workflow file — Railway watches `main` directly. Changes to `apps/worker/` do **not** trigger `deploy-supabase.yml` or `publish-frontend.yml`; only Railway picks them up. Bump `apps/worker/package.json` version in the same commit.

After any push touching `apps/bridge-agent/`, bump `apps/bridge-agent/package.json` version in the same commit.
