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
