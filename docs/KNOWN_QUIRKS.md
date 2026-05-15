# Known Quirks — Why Things Look Wrong But Aren't

This document explains intentional code decisions that may appear like bugs or bad practices to an outside developer. Each entry explains **what it looks like**, **why it exists**, and **what would break if you "fixed" it**.

---

## 1. Hardcoded Supabase URL and Anon Key

**File**: `src/lib/external-supabase.ts`

**What it looks like**: Security anti-pattern — credentials hardcoded in source code.

**Why**: PopDAM is built on Lovable, which auto-provisions its own Supabase project and auto-generates `.env` with that project's credentials. But our production database is on a *different* Supabase project. The `.env` file gets overwritten by Lovable on every deploy, so we can't rely on it. The anon key is a **publishable** key (equivalent to a Firebase web API key) — it's designed to be in client-side code. The service role key is never hardcoded.

**What breaks if you "fix" it**: All data queries, auth, and edge function calls would go to the wrong (empty) Lovable-managed project.

---

## 2. `client.ts` Re-Export Trick

**File**: `src/integrations/supabase/client.ts`

**What it looks like**: A file that should create a Supabase client instead just re-exports from somewhere else.

**Why**: Lovable auto-generates this file and overwrites it. By making it a one-line re-export of our external client, we ensure that every file importing from the "standard" path (`@/integrations/supabase/client`) gets the correct production client. When Lovable overwrites it, we restore the re-export.

**What breaks if you "fix" it**: Same as #1 — queries go to the wrong project.

---

## 3. `useAuth.tsx` Imports Directly from `external-supabase.ts`

**File**: `src/hooks/useAuth.tsx`

**What it looks like**: Inconsistent — other files import from `@/integrations/supabase/client`, but auth imports directly.

**Why**: The auth provider is the most critical piece. If the `client.ts` re-export is temporarily broken (Lovable overwrote it), auth would silently connect to the wrong project. By importing directly, auth always works even during the window between a Lovable overwrite and our fix.

---

## 4. `verify_jwt = false` on `admin-api`

**File**: `supabase/config.toml`

**What it looks like**: Security hole — admin API doesn't verify JWTs at the gateway level.

**Why**: CORS preflight (`OPTIONS`) requests don't carry authorization headers. If `verify_jwt = true`, Supabase's gateway rejects the preflight, and no browser can call the function at all. Instead, JWT verification happens **inside** the function (`authenticateAdmin()`), which skips the check for OPTIONS requests and validates the JWT manually for all other methods.

---

## 5. `admin-api` Is a 1,268-Line "Monolith"

**File**: `supabase/functions/admin-api/index.ts`

**What it looks like**: God function that should be split into separate edge functions.

**Why**: All admin actions share the same auth flow (JWT validation → admin role check → CORS headers → error handling). Creating 50+ separate edge functions would duplicate this boilerplate in each one, increase cold-start costs, and make deployment more complex. The actual business logic is extracted into `_shared/admin-handlers/` — the main file is essentially just a router.

---

## 6. `agent-api` Is Even Larger (2,781 Lines)

**File**: `supabase/functions/agent-api/index.ts`

**Why**: Same rationale as admin-api but even more so — agent auth (SHA-256 key hashing + lookup) is non-trivial and must be consistent. The ingest/batch-ingest routes contain substantial metadata derivation logic that benefits from sharing in-memory caches (config lookups, licensor/property matching).

---

## 7. `useState(getPreferredPathMode)` Without Parentheses

**Pattern in**: `src/components/library/AssetDetailPanel.tsx` and others

**What it looks like**: Bug — calling `useState` with a function reference instead of a value.

**Why**: This is React's [lazy initializer pattern](https://react.dev/reference/react/useState#avoiding-recreating-the-initial-state). When you pass a function to `useState`, React calls it once on the first render to get the initial value. `useState(getPreferredPathMode)` is equivalent to `useState(() => getPreferredPathMode())` but slightly cleaner. Adding `()` would also work but would call the function on every render (the result is only used on the first, but the function still runs).

---

## 8. Service Role Key as Bearer Token

**In**: `admin-api/index.ts` → `authenticateUser()`

**What it looks like**: Backdoor — accepting a raw key as an auth token.

**Why**: The Railway Cloud Worker needs to call admin-api for operations like ERP enrichment. It doesn't have a user JWT (it's a server process, not a browser). Instead of building a separate service-to-service auth system, admin-api accepts the Supabase service role key as a Bearer token, mapping it to a synthetic `userId: "system"`. This is safe because: (a) the service role key is already a root-level secret with full DB access, and (b) it's only used by our own worker process.

---

## 9. `@popdam/path-filters` Workspace Package

**Directory**: `packages/path-filters/`

**What it looks like**: A missing npm package that should be installed.

**Why**: This is a local monorepo package shared between the Bridge Agent, Windows Agent, and agent-api edge functions. It provides `shouldSkipPath()` — the canonical logic for filtering junk files (`.DS_Store`, `Thumbs.db`, `._*`) and excluded subdirectories. It's referenced via workspace protocol in agent `package.json` files.

---

## 10. Duplicate `JUNK_FILENAMES` Arrays

**In**: `supabase/functions/agent-api/index.ts`, `apps/bridge-agent/`, and `packages/path-filters/`

**What it looks like**: Copy-paste code that should be deduplicated.

**Why**: Known tech debt. Edge functions (Deno) can't import from Node.js packages, and the path-filters package is Node.js. The agent-api has its own copy because it needs to filter during ingest validation. A proper fix would require a Deno-compatible build of path-filters, which hasn't been prioritized.

---

## 11. `Record<string, unknown>` Instead of Proper Types

**In**: `useAdminApi.ts`, admin-api handler parameters

**What it looks like**: Lazy typing that defeats TypeScript's purpose.

**Why**: Admin-api uses action-based routing where each action has different payload shapes. The `useAdminApi` hook is a generic caller — it doesn't know which action you're calling. Zod validation on the edge function side provides runtime type safety. Adding generic type parameters to the hook would require maintaining a parallel type registry for 50+ actions, which creates more drift risk than it prevents bugs.

---

## 12. Polling Instead of Realtime for Bulk Operations

**In**: `src/hooks/usePersistentOperation.ts`

**What it looks like**: Should use Supabase Realtime instead of polling.

**Why**: `admin_config` is a key-value table where `BULK_OPERATIONS` is a single JSONB blob containing state for all operations. Realtime on this table would fire on every update to *any* config key, not just operations. The polling approach (3s when active, 30s idle) is simpler, uses minimal bandwidth, and avoids the complexity of filtering Realtime events for a single JSONB sub-key.

---

## 13. `config.toml` Has `project_id` That Doesn't Match

**File**: `supabase/config.toml`

**What it looks like**: Config pointing to wrong project.

**Why**: The `project_id` in config.toml matches the **external** production project (`ryltkzzernhwnojzouyb`), not the Lovable-managed one. This is correct — the GitHub Actions deploy workflow uses this to target the right project for edge function deployment.

---

## 14. No `landing page` at the Root URL

**File**: `src/App.tsx`

**What it looks like**: The root route (`/`) should show a landing page but instead shows the login page.

**Why**: There was a landing page (`LandingPage.tsx` exists), but for the current deployment the root URL goes directly to login. The app is internal-only (invitation-based) — there's no marketing need for a public landing page. The `LandingPage` component is kept for potential future use.

---

## 15. Magic Numbers Throughout Agent Code

**In**: `apps/bridge-agent/`, `apps/windows-agent/`

**Examples**: `30_000` (heartbeat interval), `60_000` (preflight recheck), `5 * 60 * 1000` (lease duration)

**Why**: Known tech debt. These are documented in `docs/WORKER_LOGIC.md` but not extracted to named constants in code. The values rarely change and are well-understood within context, so the refactor hasn't been prioritized over feature work.

---

## 16. Migration History Is Partially Out of Sync with Git

**What it looks like**: The DB `supabase_migrations.schema_migrations` table contains versions that have no corresponding file in `supabase/migrations/`. `supabase db push` may fail with "Remote migration versions not found in local migrations directory."

**Why**: This project's Supabase migration history accumulated drift from three sources:
1. **Bootstrap migrations** (`00001`–`00007`) were applied when the Supabase project was first created, before git-based migration tracking was in place. They were never committed as local files.
2. **Wrong-project migrations** (`smon_*` prefixed) were accidentally applied to popdam-prod via a Supabase MCP call that used the wrong `project_id`. These belong to the SynoMon project (`qnjimovrsaacneqkggsn`), not popdam-prod.
3. **MCP-only migrations** were applied via `execute_sql` or `apply_migration` MCP during development sessions without creating corresponding local files (or with mismatched timestamps).

**Current state**: These orphaned history entries were resolved in April 2026 by deleting the orphaned rows from `supabase_migrations.schema_migrations`. The local files and DB history are now in sync.

**What breaks if you "fix" it wrong**: Running `supabase migration repair --status reverted` marks migrations as reverted in history but does NOT drop the DB objects they created. The objects remain functional. However, if you accidentally delete history entries for migrations whose SQL was never actually applied, future `supabase db push` runs will try to apply them again (or skip them depending on local file presence).

**Prevention**: See `CLAUDE.md` — always use `apply_migration` (not `execute_sql`) for DDL, always match local filenames to the exact timestamp recorded by Supabase, and check CI after every push.

---

## 17. Both `ImpersonationContext.tsx` and `useImpersonation.tsx` Exist

**Files**: `src/contexts/ImpersonationContext.tsx`, `src/hooks/useImpersonation.tsx`

**What it looks like**: Duplicate or conflicting implementations.

**Why**: The context provides the `ImpersonationProvider` wrapper, and the hook provides `useImpersonation()` for consuming components. They work together — the hook imports from the context. The naming makes it look like two competing implementations, but they're a standard context/hook pair.

---

## 18. `OPENROUTER_API_KEY` Lives in Two Places and They Don't Sync

**What it looks like**: You set the OpenRouter API key in the admin UI (Settings → AI Models) but AI tagging still fails. Or you see "No AI API key configured" in the worker logs.

**Why**: Two completely separate consumers read the key from different sources:

| Consumer | Where it reads the key | Set via |
|---|---|---|
| Bridge/Windows agents | `admin_config.OPENROUTER_API_KEY` | Admin UI → Settings → AI Models |
| Railway worker (`apps/worker/`) | `process.env.OPENROUTER_API_KEY` | Railway dashboard → Variables |

The admin UI only updates `admin_config`. The Railway worker reads from Railway ENV variables set in Railway's dashboard — it never reads from `admin_config`. Setting the key in the UI does **not** make it available to the worker.

**What breaks if you don't know this**: AI tagging and ERP classification will silently fail with "No AI API key configured" in the Railway worker logs, even though the key appears correctly set in the admin UI.

**Fix**: Set `OPENROUTER_API_KEY` in both places:
1. Admin UI → Settings → AI Models (for bridge agents)
2. Railway dashboard → your worker service → Variables (for the Railway worker)

---

## 19. `bulk-job-runner` Edge Function Is a No-Op Stub

**What it looks like**: The `supabase/functions/bulk-job-runner/index.ts` file exists and is deployed, but it does nothing — just returns `{ ok: true, message: "replaced by railway worker" }`.

**Why**: Bulk batch processing was originally done by this edge function, called every minute via pg_cron. It was replaced by the persistent Railway worker (`apps/worker/`) because the 60-second edge function timeout was too short for large batches and the cold-start latency caused gaps in processing. The pg_cron schedule was removed via migration `20260322000000`. The stub is kept deployed so stale references to the function URL return a clean 200 rather than 404.

**What breaks if you delete it**: Any stale client code or external references to the function URL would receive a 404 instead of a graceful 200.

**What breaks if you add real logic to it**: Nothing immediately, but you'd be creating a second code path that processes operations. The Railway worker and the edge function would conflict — both would try to process the same `BULK_OPERATIONS` state simultaneously.

---

## 20. `HEALTHCHECK NONE` on the Bridge Agent Docker Image

**File**: `apps/bridge-agent/Dockerfile`

**What it looks like**: Missing health check — the container has no liveness probe.

**Why**: Synology Container Manager polls the Docker daemon for container health status. Each poll creates a DSM CGI session owned by the container's user account (`popdam`, UID 1039). These sessions accumulate and are never explicitly closed — they linger until Synology's `synocgid` session-timeout sweeper clears them in bulk, producing log floods like `synocgid: session/timeout.cpp:74 popdam has session timeout` (observed 9,997 times in 3.5 days at the old 30-second health-check interval).

The health check command was `node -e "process.exit(0)"` — it always exits 0 and communicates nothing meaningful about whether the agent is actually working. `HEALTHCHECK NONE` is strictly correct: it eliminates the session accumulation entirely and makes the Docker metadata honest (no false "healthy" status from a meaningless command).

**What breaks if you "fix" it**: If you add a real `HEALTHCHECK` command, Container Manager will resume creating DSM sessions per poll. Unless the command actually validates agent liveness (e.g., checking a pid file or local HTTP endpoint), the probe is theater that costs real sessions.

---

## 21. Traefik Runs Inside `coolify-proxy` Docker Container (Not as a Host Process)

**What it looks like**: Writing a config file to `/traefik/dynamic/` on the VPS host filesystem should configure Traefik routing.

**Why it doesn't work**: Coolify installs Traefik inside a Docker container named `coolify-proxy`. Traefik reads its dynamic config from `/traefik/dynamic/` **inside the container**, not from the host filesystem. Writing to the host has no effect.

**Correct mechanism**: Use `docker cp` to write config files into the running container:
```bash
docker cp /tmp/popdam-traefik.yml coolify-proxy:/traefik/dynamic/popdam-frontend.yml
```
Traefik watches this directory (`--providers.file.watch=true`) and picks up changes within seconds.

**Similarly**: The backend URL in routing config must use Docker DNS (`http://popdam-frontend:80`), not `http://127.0.0.1:PORT`. `127.0.0.1` inside the Traefik container is the container's own loopback — it cannot reach `popdam-frontend` that way even though both share the host machine.

---

## 22. Style Group Batch Functions Need `SET lock_timeout TO '0'`

**What it looks like**: Unnecessary or excessive SQL configuration on batch functions like `rebuild_style_groups_batch`, `clear_style_group_batch`, etc.

**Why**: Supabase sets a default `lock_timeout` at the role/database level. When batch functions run `UPDATE` statements on `assets` and `style_groups`, they queue for row-level locks and hit this limit — producing "canceling statement due to lock timeout" errors that interrupt the bulk operation mid-run. Setting `lock_timeout = '0'` inside each function disables the lock wait limit for the duration of that call only. The `statement_timeout` is still respected, so runaway queries can't hang forever.

**What breaks if you remove it**: Style group rebuild and related operations will frequently fail with "canceling statement due to lock timeout" when other queries are touching the same tables, requiring manual restart from interrupted state.

---

## 23. PopSG Has a Render Pipeline, But Many Files Still Lack Previews

**What it looks like**: Many files in the PopSG library show a broken/placeholder image instead of a thumbnail.

**Why**: The Windows Render Agent generates thumbnails for PopSG files, writing results to `style_guide_files.thumbnail_url` (success) or `thumbnail_error` (failure). However, large batches of files fail for various reasons:

| Category | Root cause |
|---|---|
| `unsupported_extension` | Extension not in the render allowlist (biggest: EPS — 23,242 files) |
| `render_failed: …path…` | Windows MAX_PATH (260-char) limit for paths > 230 chars |
| `render_failed: …color mode…` | CMYK/Lab PSD or AI files that Sharp and ImageMagick can't handle |
| `missing_file_on_disk` | File moved or deleted since the last crawl |
| `other_error: Skipped` | Renderable file blocked by path filter — see `shouldSkipPath()` |

**The render pipeline** (`PopSGSettingsPage.tsx` → `style_guide_render_queue` → Windows agent `processSgJob`) must be triggered manually (or via Retry All). Files are re-queued by `retry_sg_render_errors()`.

**What breaks if you "fix" it wrong**: Adding a format to the extension allowlist without adding a render code path in the Windows agent just causes the job to fail at claim time.

---

## 24. `supabase-popsg/` Directory Is Dead Code

**What it looks like**: A separate `supabase-popsg/` directory with its own `supabase/functions/` and a `deploy-popsg-supabase.yml` workflow, suggesting PopSG has its own Supabase project.

**Why it's dead**: PopSG was originally deployed on a separate Supabase project (`eeueczxhezfhyrhdmidg`). It was later consolidated into the PopDAM project (`ryltkzzernhwnojzouyb`) — both `sg.designflow.app` and `dam.designflow.app` now connect to the same project. The `supabase-popsg/` directory and its workflow were never cleaned up.

**What breaks if you deploy from it**: The `deploy-popsg-supabase.yml` workflow targets the old abandoned project (`eeueczxhezfhyrhdmidg`), not the live one. Deploying would update edge functions on a project that no client connects to — it would have no visible effect but would waste a deploy.

**What breaks if you delete it**: Nothing — as long as you also disable or delete `deploy-popsg-supabase.yml`. Do not trigger that workflow.

---

## 25. Bridge Agent Imports `ws` and Polyfills `globalThis.WebSocket`

**File**: `apps/bridge-agent/src/realtime-watcher.ts`

**What it looks like**: The `ws` package is listed as a production dependency and the first thing `realtime-watcher.ts` does is `(globalThis as Record<string, unknown>).WebSocket = ws`. This looks like a clumsy hack.

**Why**: `@supabase/realtime-js` >= 2.11 detects the Node.js version at runtime and throws a fatal error ("Node.js 20 detected without native WebSocket support") if `globalThis.WebSocket` is undefined. Node.js 20 (used in the bridge agent's Docker image) has no native WebSocket implementation — that was added in Node.js 22. Setting the polyfill at module initialization time, before any Supabase client is created, satisfies the check for all subsequent code.

**What breaks if you remove it**: The bridge agent crash-loops every ~60 seconds on startup with the error above — this was the v1.9.5 → v1.9.6 regression.

**Why not upgrade Node.js to 22**: Would require rebuilding native modules (`sharp`, `mupdf`) and revalidating rendering. The `ws` polyfill is lower risk and forward-compatible (Node.js 22's native WebSocket satisfies the same check so the polyfill becomes a no-op when we eventually upgrade).

---

## 26. Bridge Agent Self-Update Uses `docker inspect` + `docker run`, Not `docker compose up`

**Files**: `apps/bridge-agent/src/index.ts` (`handleApplyUpdate`, `recreateViaDockerRun`)

**What it looks like**: Overly complex self-update logic — why not just call `docker compose up -d --force-recreate`?

**Why Compose alone fails**: The bridge agent runs inside a Docker container. Its Docker socket mount (`/var/run/docker.sock`) lets it control the Docker daemon, but it has no access to the `docker-compose.yml` file that lives on the host filesystem. To find the compose file, the agent reads the `com.docker.compose.project.working_dir` label that Compose stamps on all containers it creates. If that label is absent or the compose file can't be found at that path, `docker compose up` is impossible.

**Compose file detection order (three fallbacks in `handleApplyUpdate`)**:
1. `com.docker.compose.project.working_dir` label → look for compose file there
2. Host-side paths from every bind mount (`docker inspect .HostConfig.Binds`) — reliable on Synology CM where the label path can differ from where the file actually is
3. `POPDAM_COMPOSE_PATH` env var → explicit override
4. Hardcoded Synology CM project paths (`/volume1/docker/popdam/docker-compose.yml`, etc.)

**The fallback (`recreateViaDockerRun`)**: Used when no compose file is found. Uses `docker inspect` to read the running container's full config (env vars, volume binds, network, restart policy) and then:
1. `docker rename {containerId} {canonicalName}-old-{timestamp}` — frees up the canonical name while the old container is still running
2. `docker run --name {canonicalName} ...` — new container immediately claims the canonical name
3. Prune any stopped containers matching `{canonicalName}-old-*` or `{canonicalName}-updating-*` (graveyard cleanup, best-effort)
4. `docker stop {containerId}` + `docker rm {containerId}` — stop and remove the old (now renamed) container

**`POPDAM_CONTAINER_NAME` env var (critical)**: The canonical name is read from this env var, not from `info.Name` of the running container. Without this anchor, each update cycle inherits the name from the current container — if a previous cycle left the container named `popdam-bridge-old-123`, the next update would name the new one `popdam-bridge-old-123` and rename the old one to `popdam-bridge-old-123-old-456`, and so on indefinitely. The `deploy/synology/docker-compose.yml` sets `POPDAM_CONTAINER_NAME: popdam-bridge` explicitly for this reason.

**Why not `docker stop` alone**: `restart: unless-stopped` does **not** restart a container after an explicit `docker stop`. A stopped container stays dead until someone restarts it manually. This was the root cause of the original update bug — the agent stopped itself and never came back.

**What breaks if you "simplify" it**: Either the compose-file path fails silently (agent stops, never restarts), or the container stops and stays dead. If you remove the `POPDAM_CONTAINER_NAME` env var, the graveyard accumulates on every update cycle.

---

## 27. Bulk DELETE on Large Tables Must Use Service Role

**Pattern in**: `handleClearFailedSGRenders`, `handleClearFailedRenders`

**What it looks like**: You click "Clear Failed" in the UI and get "canceling statement due to statement timeout."

**Why**: When an admin client (authenticated role) runs a DELETE with an RLS policy, PostgreSQL evaluates the policy predicate — typically `has_role(auth.uid(), 'admin')` — for **every row** in the result set. On a table with 30,000+ failed rows this becomes 30,000+ PL/pgSQL function calls inside a single transaction, which blows Supabase's default 8-second statement timeout for the authenticated role.

**Fix**: Route bulk deletes through an `admin-api` action that uses `serviceClient()` (service role). The service role bypasses RLS entirely — the delete runs as a single statement with no per-row policy overhead.

**What breaks if you "fix" it by raising the statement_timeout**: The authenticated role timeout protects against runaway queries from the browser. Raising it globally allows accidental or malicious long-running client queries. The service role bypass is scoped to explicit admin-api actions, not all client code.

---

## 28. `popdam-helper` Has a No-Op `postcss.config.js`

**File**: `apps/popdam-helper/postcss.config.js`

**What it looks like**: An empty PostCSS config — `export default { plugins: {} }`. Seems pointless.

**Why**: Vite walks up the filesystem looking for a PostCSS config. Without this file, it finds the monorepo root's `postcss.config.js`, which loads the Tailwind plugin and its content glob. Tailwind then tries to scan the popdam-helper renderer source for class names, errors on missing content, and breaks the build. The stub prevents inheritance by shadowing the parent config.

**What breaks if you delete it**: The helper renderer build fails with a Tailwind PostCSS error.

---

## 29. `safeStorage` Instead of `keytar` for Credential Storage

**File**: `apps/popdam-helper/src/main/credentials.ts`

**What it looks like**: Uses Electron's `safeStorage.encryptString()` instead of the more common `keytar` package.

**Why**: `keytar` is a native module that must be compiled for the target Electron version at package-install time (node-gyp). This requires build toolchain on both the developer's machine and in CI, and the compiled binary is platform-specific. `safeStorage` is built into Electron (DPAPI on Windows, Keychain on macOS) and requires no compilation.

**What breaks if you switch to `keytar`**: CI would need `libsecret-dev` (Linux), Python, and node-gyp pre-installed; the Windows build would also need MSVC build tools. It's a significant CI complexity increase for no functional benefit.

---

## 30. JSON File Upload Queue Instead of SQLite

**File**: `apps/popdam-helper/src/main/uploadQueue.ts`

**What it looks like**: Persists the upload queue as a plain JSON file (`userData/upload-queue.json`) rather than using SQLite.

**Why**: Same reason as `safeStorage` above — `better-sqlite3` is a native module that requires compilation. A JSON file is entirely sufficient for the queue use case: uploads are sequential (one at a time), the queue is short-lived, and crash recovery just re-reads the file on restart. There are no concurrent readers or complex queries.

**What breaks if you switch to SQLite**: Same CI/build complexity as keytar.

---

## 31. Local Helper Detection Uses `AbortSignal.timeout(2000)` — Not a Bug

**File**: `src/components/settings/DirectoryBrowserTab.tsx`

**What it looks like**: `fetch("http://localhost:47380/status", { signal: AbortSignal.timeout(2000) })` — fetching from localhost with a timeout looks paranoid.

**Why**: The web app runs in a browser over HTTPS. When the Helper is not installed, the `fetch()` call hangs for ~30 seconds (the browser's default TCP connection timeout to a closed port) before failing. Without the explicit 2-second abort, the directory browser renders in a 30-second loading state on every page load for users without the Helper. The 2-second limit is aggressive enough to be imperceptible, but well above any realistic startup lag.

**Why `helperAvailable` starts as `null` (not `false`)**: The initial `null` state prevents the auto-load `useEffect` from firing before the probe completes. If it started as `false`, the component would immediately trigger the slow bridge agent path and then redundantly re-trigger via the probe effect when it resolved — causing two concurrent browse requests on mount.

---

## 33. Supabase Proxy Enforces Statement Timeout — `SET LOCAL` Is Invisible to It

**What it looks like**: You add `SET LOCAL statement_timeout = 0;` inside a PL/pgSQL function to bypass Supabase's statement timeout for a bulk operation. The query still times out.

**Why**: Supabase routes all client connections through a connection proxy (Supavisor / PgBouncer). The proxy enforces its own statement timeout on the wire — it cuts the connection from the outside if the query runs too long. `SET LOCAL` inside a function changes the PostgreSQL session parameter for that transaction only, but the proxy never sees that change. It is measuring wall-clock time from the moment the query arrived at the proxy.

**Fix**: Batch bulk operations at the client layer. Break the work into chunks (e.g., `p_limit = 500`) and loop until the function returns 0. This keeps each individual query well under the timeout.

**Pattern** (from `retry_sg_render_errors`): the DB function accepts `p_limit int DEFAULT 500` and returns the number of rows it processed. The client (`SgRenderErrorsTable` in `PopSGSettingsPage.tsx`) loops calling it until it returns 0.

**What breaks if you raise the DB-level timeout**: The timeout is a safety valve for runaway client queries. Raising it globally exposes all Supabase clients — not just admin operations — to unbounded query times. Use per-batch looping instead.

---

## 34. Windows MAX_PATH (260-char) Limit in the Windows Render Agent

**What it looks like**: The Windows Render Agent logs `render_failed: …ENOENT…` or `Input file is missing` for files that the bridge agent (on Linux/NAS) found just fine during the crawl.

**Why**: The bridge agent runs on Synology NAS (Linux, no path length limit) and crawls files with paths exceeding 260 characters. The Windows Render Agent maps the same NAS share as a drive letter (e.g. `Y:\`). Windows Win32 APIs have a MAX_PATH limit of 260 characters — calls to `fs.open`, `fs.readdir`, `fs.copyFile`, and Sharp's C++ layer all fail silently or throw `ENOENT` for paths that exceed this limit.

**Fix** (`apps/windows-agent/src/renderer.ts`): The `withLongPathPrefix(p)` helper prepends `\\?\` (Win32 extended-length path prefix) to any path longer than 230 chars. This prefix bypasses the 260-char limit for all Win32 API calls. It is applied to:
- `renderNativeImage` (Sharp source path)
- `renderFile` / `renderPdf` (`copyFile` source path for the temp-copy workaround)
- `renderFromSibling` (`readdir` and Sharp source)
- `isAiWithoutPdfCompat` (`open()`)

Shell commands (Ghostscript, ImageMagick, Inkscape, Poppler) use the short temp-copy destination path and are unaffected by MAX_PATH.

**Why 230 and not 260**: The threshold is conservative — the temp destination itself adds chars, so starting the prefix at 230 leaves headroom.

**What breaks if you remove it**: Any file on the NAS whose full mapped path (drive letter + relative path) exceeds 260 chars will fail to render. On a share with deeply nested folders this is a large fraction of the file set.

---

## 35. "Retry All" Count and Loop — Two Separate Concerns

**What it looks like**: The "Retry All (N)" button in PopSG Settings shows a different number than you'd expect, and/or it only retries some files.

**Why — the count**: The "Files with Render Errors" table fetches with `.limit(500)` for display performance. The button label reads from `previewStats.render_errored` (from `get_sg_preview_stats()`), which is the actual total count across all files — not capped by the display query.

**Why — the loop**: `retry_sg_render_errors()` accepts `p_limit int DEFAULT 500` and processes at most that many files per call (to stay inside Supabase's statement timeout — see Quirk #33). Clicking "Retry All" causes the client to loop calling it in 500-file batches until it returns 0. All errored files are retried, not just the 500 displayed.

---

## 32. `popdam-helper` Local Server Port 47380 Is Fixed, Not Random

**File**: `apps/popdam-helper/src/main/localServer.ts`

**What it looks like**: Magic number — why 47380 specifically?

**Why**: The web app needs a fixed port to probe at startup. A random port would require an OS-level mechanism to advertise it (registry key, named pipe, temp file) that a web page can't read. The port was chosen to be above the ephemeral range (49152+), far from well-known services, and unlikely to conflict with developer tooling. `EADDRINUSE` is handled gracefully — the Helper logs a warning and continues without the local server rather than crashing.

---

## 36. `renderNativeImage` Uses Temp-Copy for Long Paths, Not `\\?\` Prefix

**File**: `apps/windows-agent/src/renderer.ts`

**What it looks like**: Inconsistency — PDF/AI/PSD rendering uses `withLongPathPrefix(\\?\)` for long-path files, but native image rendering (JPG/PNG/TIFF/etc.) copies to a temp path first.

**Why**: Sharp/libvips does **not** reliably support the `\\?\` extended-length path prefix on Windows. Even though `\\?\` works for Win32 `fs` calls, Sharp's underlying C++ (libvips) uses its own file I/O which does not honour the prefix and still fails on paths > 260 chars. The temp-copy pattern (already used by `renderFile` and `renderPdf`) copies the source to a short temp path, renders from there, and then cleans up — this sidesteps the libvips limitation entirely.

**What breaks if you add `withLongPathPrefix` to Sharp's source path**: The render will still fail with `Input file is missing` for paths > 260 chars because libvips sees the `\\?\` prefix but can't open the file.

---

## 37. AI Vision Model Picker Fetches from OpenRouter Live — Not from `AI_MODELS`

**File**: `src/components/settings/PdfTextSamplesTab.tsx`, `supabase/functions/admin-api/index.ts`

**What it looks like**: The AI vision model dropdown calls an edge function on every page load instead of reading from a local config table.

**Why**: The `AI_MODELS` / `admin_config` approach required manually maintaining a list of OpenRouter models that support image input. OpenRouter's model catalog changes frequently. The `get-openrouter-vision-models` edge function calls `https://openrouter.ai/api/v1/models` and filters on `architecture.input_modalities includes "image"` — no manual maintenance required. Results are React Query cached for 5 minutes.

**Prerequisite**: `OPENROUTER_API_KEY` must be set in `admin_config`. If it isn't, the dropdown shows an error and AI vision extraction won't work.

---

## 38. Nightly Crawl Cron Is Scheduled in UTC, Not ET

**DB object**: `pg_cron` job `nightly-sg-crawl` (`20260507154819_schedule_nightly_sg_crawl.sql`)

**What it looks like**: The crawl is supposed to run at 9pm ET, but the cron expression is `'0 2 * * *'` (02:00 UTC).

**Why**: The `cron.timezone` GUC on this Supabase version cannot be changed without a server restart (not possible on managed Supabase). `02:00 UTC = 9pm EST`. In EDT (summer, UTC-4), `02:00 UTC = 10pm EDT` — a 1-hour drift. This is acceptable for a nightly maintenance job.

**What breaks if you change the expression to a local time without verifying `cron.timezone`**: The job will run at the wrong time silently — pg_cron always interprets schedule expressions as UTC unless `cron.timezone` is explicitly set.

---

## 39. `ensureRootMarkers` Refuses to Write to Synology Internal Directories

**File**: `apps/bridge-agent/src/index.ts` (`ensureRootMarkers`)

**What it looks like**: The agent silently skips writing `pop-root.json` to a configured root and logs an error instead of proceeding.

**Why**: If an `agent_root_mappings` record has a `server_path` that resolves to a Synology internal data store — `@synologydrive`, `@SynologyDriveShareSync`, `@appdata`, or `@docker` — writing a marker file there and then trying to traverse the directory would be catastrophic. These directories contain millions of opaque internal files; any recursive operation (scan, file walk, grep) on them can run for days (confirmed: 4+ days on production) and generate enormous disk I/O.

The guard checks the resolved `rootPath` (lowercased) for any of those path segments. If found, it logs at `error` level, sets `markerStatuses[root_id] = { ok: false, error: "forbidden_path" }`, and skips the root entirely for that scan cycle.

**What breaks if you remove it**: A misconfigured root mapping pointing at a Synology internal store would allow the agent to scan millions of internal files, causing severe disk I/O pressure and potentially running for days without completing.

**Intentional behavior**: This is a hard stop, not a warning. The correct fix is to correct the root mapping in the admin UI, not to remove the guard.

---

## 40. `bulk_insert_pdf_text_samples` Bypasses Per-Row Trigger via Session Variable

**File**: `supabase/migrations/20260515082342_bulk_insert_pdf_text_samples_rpc.sql`, `supabase/functions/agent-api/index.ts`

**What it looks like**: The `trg_fn_parse_pdf_files_used` trigger silently returns early on some INSERT statements, meaning `parse_pdf_files_used()` doesn't run for newly inserted rows.

**Why**: The per-row trigger calls `parse_pdf_files_used(NEW.asset_id)` — a PL/pgSQL function that queries `assets`, scans `pdf_text_samples`, and inserts into `sku_files_used`. With 25 rows being inserted sequentially (one HTTP round-trip each), the total time per request exceeded the Supabase 120 s statement timeout, causing the `complete-pdf-text-sample` edge function to return HTTP 500. The RPC also uses `DELETE FROM pdf_text_samples WHERE id IS NOT NULL` rather than `DELETE FROM pdf_text_samples` because Supabase enforces `pg_safeupdate`, which blocks DELETE without a WHERE clause even inside stored procedures.

The fix is a PostgreSQL RPC `bulk_insert_pdf_text_samples(p_rows jsonb)` that:
1. Sets `SET LOCAL app.skip_parse_pdf_trigger = '1'` for the transaction
2. Deletes existing rows
3. Inserts all rows in one statement
4. Calls `parse_pdf_files_used()` once per unique `asset_id` after all rows are visible

The trigger function checks `current_setting('app.skip_parse_pdf_trigger', true)` and returns `NEW` immediately when set, skipping the parse. After the bulk INSERT, the RPC drives the per-asset parse itself.

**What breaks if you remove the trigger bypass**: PDF text sample saves revert to 500 errors when there are ≥ ~15 assets (depending on parse complexity) because the cumulative trigger work per request exceeds the proxy-enforced statement timeout.

**What breaks if you remove the per-row trigger entirely without the RPC**: Single-row inserts (any future path that inserts one row at a time outside the RPC) would silently skip `sku_files_used` population.

**Intentional behavior**: The bypass is scoped to the transaction via `SET LOCAL` — no other code is affected. The RPC is `SECURITY DEFINER` and `GRANT EXECUTE` is limited to `service_role`.

---

## 41. Coolify Container Name Changes on Every Deploy; Traefik Service Name Does Not

**File**: `SELFHOST.md`, Traefik labels on `popdam-frontend`

**What it looks like**: The running container for `popdam-frontend` has a timestamp suffix (e.g., `qxj8a0j3tpa9lq4q5rs6pezy-131243298897`) that changes on every deployment. You can't reference the container by name in Traefik config.

**Why**: Coolify appends a timestamp to the container name on each deploy to distinguish old from new during the rollover. However, the Traefik **service** name is derived from the Coolify app UUID (`qxj8a0j3tpa9lq4q5rs6pezy`), not the container name, and is therefore stable across redeploys:

```
traefik.http.services.https-0-qxj8a0j3tpa9lq4q5rs6pezy.loadbalancer.server.port=80
```

The `sg.designflow.app` file provider references this service as `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker`. The `@docker` provider suffix is required; without it, Traefik looks for the service in the file provider (same file), where it doesn't exist.

**What breaks if you reference the container name instead**: The Traefik config would need to be updated on every deployment, because the container name changes each time.

**Intentional behavior**: File provider references the UUID-based service name with `@docker`. This is stable forever as long as the Coolify app UUID doesn't change.

---

## 42. nginx Must Listen on `[::]:80` for Coolify Health Check to Pass

**File**: `nginx.conf`

**What it looks like**: The container runs nginx successfully (curl from outside works), but `docker ps` shows `(unhealthy)` and `dam.designflow.app` returns 404 from Traefik.

**Why**: Coolify's default container health check runs `wget -q --spider http://localhost/ || exit 1` inside the container. On a host with IPv6 enabled, `localhost` resolves to `::1` (IPv6 loopback). nginx's `listen 80;` directive only binds to `0.0.0.0:80` (IPv4). The IPv6 connection attempt is refused, health check fails, and Traefik excludes the container from routing (Traefik v3 skips containers Docker marks unhealthy).

The fix is `listen [::]:80;` in the server block alongside `listen 80;`. Both are present in this repo's `nginx.conf`.

**What breaks if you remove `listen [::]:80;`**: The container becomes unhealthy immediately after startup and Traefik stops routing `dam.designflow.app`. The app is unreachable within seconds of a deploy.

**Intentional behavior**: Both directives are required. This is not redundant — IPv4 and IPv6 loopback are separate interfaces.

