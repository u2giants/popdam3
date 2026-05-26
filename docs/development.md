# Local Development

## Prerequisites

- **Node.js 20** (the CI runner and Dockerfile use `node:20`)
- **npm** (bundled with Node)
- **Supabase CLI** — for migration and edge function work (`brew install supabase/tap/supabase` or see [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli))
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

The dev server binds to `::` (all interfaces) on port 8080. No `.env.local` file is required — Supabase credentials are hardcoded in `src/lib/app-mode.ts` and connect to the production Supabase project (`ryltkzzernhwnojzouyb`). See quirk #1 in [KNOWN_QUIRKS.md](KNOWN_QUIRKS.md).

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
1. Apply via `apply_migration` MCP (or `supabase db push` locally against a branch)
2. Immediately call `list_migrations` to get the exact timestamp Supabase recorded
3. Create the local file as `supabase/migrations/<that-timestamp>_<name>.sql`
4. Commit immediately

To run migrations locally (requires Supabase CLI linked to the project):
```bash
supabase db push --db-url "postgresql://..."
```

In Claude Code sessions, use the `mcp__supabase__apply_migration` tool instead.

## Edge Functions

Edge functions run on Deno in the `supabase/functions/` directory. To test locally:

```bash
supabase functions serve <function-name> --env-file supabase/functions/.env
```

Format check (run by CI on every push touching functions):
```bash
deno fmt --check supabase/functions/
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
```

```bash
cd apps/popdam-helper
npm install
npm run dev          # electron-vite dev (opens Electron window)
npm run build        # electron-vite build
npm run dist         # electron-builder package (requires signing certs on macOS)
```

```bash
cd apps/windows-agent
npm install
npm run dev          # tsx watch
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
