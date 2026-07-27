# Implementation Plan — One shared "are you an admin?" check for PopDAM edge functions

**Status: DONE — implemented, deployed and verified live on 2026-07-26.**
Shipped in commit `refactor(edge): one shared admin check; fix helper-api denying
multi-role admins` (pushed to `main`; `Deploy Supabase Edge Functions` run
30231551152 green). One verification remains outstanding and is not blocking —
see "Implementation record" at the bottom of this file. Delete this file once
that last check is done.

**Plan file owner:** whoever implements it. Delete this file only when § 13 is fully ticked.
**Related:** `HANDOFF.md` (session state — read both, never one alone), `docs/AUTHENTICATION.md`, `docs/API_CONTRACTS.md`, `docs/INFRASTRUCTURE.md`.

---

## 1. The ultimate goal (plain English — read this first)

PopDAM decides "is this caller an admin?" in **six different backend functions,
each with its own hand-written copy of the same check**. The copies have already
drifted apart, and one of them is **wrong today**: `helper-api`'s admin check
denies a real admin (proven live — see § 6.1).

**When this work is done, the following must be true:**

1. There is exactly **one** piece of code in the repo that answers "is this
   caller an admin?", and all six functions call it.
2. The behaviour every caller gets is the *correct* behaviour — specifically,
   an admin who has more than one row in `user_roles` (e.g. both `user` and
   `admin`) is recognised as an admin everywhere.
3. **No externally visible behaviour changes for any legitimate caller.** Same
   URLs, same request shapes, same HTTP status codes, same JSON error bodies.
   The admin UI, the Railway worker, the Electron Helper and the bridge agent
   must all keep working with no changes on their side.
4. A future change to the admin rule can be made in one file and be true
   everywhere.

**If any step below conflicts with this goal, the goal wins — stop and flag it.**
In particular: if consolidating a function would change what a caller sees on
the wire, do NOT change the wire. Preserve the wire shape and consolidate only
the decision logic. Point 3 is a hard constraint, not a preference.

**Why this matters in business terms:** these functions gate user management,
invitations, ERP sync, full database exports and force-unlocking a designer's
checked-out file. A drift bug here either locks an admin out of an emergency
tool (happening now) or, in the other direction, lets a non-admin through. One
check means one thing to get right and one thing to audit.

---

## 2. What this application is

**PopDAM** is POP Creations' internal Digital Asset Management app: staff browse,
tag, search, check out and check in artwork/licensing files that live on on-prem
Synology NAS storage and in Seafile. A sister app, **PopSG** ("StyleGuides"),
shares the same backend and lives under `/popsg` routes in the same frontend.

| Thing | Value |
|---|---|
| Repo (this one) | `/worksp/popdam` — remotes `origin` and `github` |
| Branch policy | **trunk-based, `main` only.** No feature branches in this repo. |
| Frontend | React + Vite + TypeScript + TanStack Query + shadcn/ui, deployed as a container via GitHub Actions → GHCR → Coolify |
| Backend | Supabase (Postgres + Auth + Edge Functions written in **Deno/TypeScript**) |
| Supabase project (LIVE) | `qsllyeztdwjgirsysgai` — `https://qsllyeztdwjgirsysgai.supabase.co` (Virginia). There is an older Ohio project; **never touch it.** |
| Edge functions | `supabase/functions/<name>/index.ts`, shared code in `supabase/functions/_shared/` |
| Edge function deploy | Push to `main` touching `supabase/functions/**` → GitHub Actions workflow `Deploy Supabase Edge Functions` (`.github/workflows/deploy-supabase.yml`) deploys every function listed in `supabase/config.toml`. The workflow **fails** if any function fails to deploy. |
| Other runtime pieces | A Railway Node worker (`apps/worker/`) and an on-prem bridge agent, both of which call these edge functions server-to-server using the Supabase **service role key** |

**Two permission systems exist and must not be confused** (both stay as-is; this
plan touches only the first):

- `user_roles` — *privilege*: `admin` vs `user`. This is the check being merged.
- `app_access` — *tenancy*: which app (`popdam` / `styleguides`) a user may enter.
  Enforced by `supabase/functions/verify-app-access/index.ts`. **Out of scope.**

---

## 3. What triggered this work

No incident, no ticket. During a 2026-07-26 review of how PopDAM does permissions,
the admin-role check was found copy-pasted into six edge functions with four
materially different implementations. Investigating the variants surfaced a live
bug in `helper-api` (§ 6.1) that nobody had reported yet — plausibly because the
affected route is an emergency-only admin tool that is rarely used.

There is no reproduction steps section for "the bug that triggered this" beyond
§ 6.1, which includes an exact repro.

---

## 4. Scope

### In scope
- A new shared admin-auth module under `supabase/functions/_shared/`.
- Rewiring these six edge functions to use it:
  1. `supabase/functions/admin-api/index.ts`
  2. `supabase/functions/erp-sync/index.ts`
  3. `supabase/functions/helper-api/index.ts` (the one admin-only route in it)
  4. `supabase/functions/export-table/index.ts`
  5. `supabase/functions/export-sql-dump/index.ts`
  6. `supabase/functions/export-thumbnail-manifest/index.ts`
- Fixing the `helper-api` multi-role bug as part of the consolidation.
- Tightening the two substring service-key comparisons to exact comparisons (§ 6.3).
- Unit tests for the new shared decision logic.
- Updating `docs/AUTHENTICATION.md` and `docs/API_CONTRACTS.md` to say there is
  now one shared helper and name its path.

### NOT in scope (do not do these, even if tempting)
- **Any database change.** No migration, no DDL, no RLS edit, no change to
  `has_role()` or `has_app_access()`. If you conclude the DB must change, STOP
  and hand back — DB changes go through the canonical `u2giants/shared-db` repo
  (§ 11), not this repo, and that is a separate piece of work.
- **Deleting the duplicate `user_roles` rows** that exposed the helper-api bug.
  The fix is to make the code handle multiple rows correctly, because the schema
  (`UNIQUE(user_id, role)`) explicitly permits a user to hold both `user` and
  `admin`. Do not "clean up" the data instead.
- `app_access` / `verify-app-access` — different system entirely.
- Client-side impersonation (`src/hooks/useImpersonation.ts`,
  `src/hooks/useIsAdmin.ts`). It is UI-only by design and is not a security
  boundary. Leave it alone.
- The frontend's own `user_roles` query in `src/hooks/useIsAdmin.ts`. It runs in
  the browser, cannot import Deno modules, and is not one of the six copies.
- Consolidating the *non-admin* auth (`getUserId` in `helper-api`,
  `authenticateUser` in `admin-api`, the agent-key auth in `agent-api`). Only the
  **admin** decision is being merged. `authenticateUser` moves into the shared
  module only because the admin check is built on top of it (§ 8, decision D2).
- Changing any HTTP status code, error message string, or JSON body shape.
- Rewriting CORS handling in these functions.
- Touching `apps/worker/`, `apps/bridge-agent/`, or the Electron Helper.

---

## 5. Current state of the code

Everything below is **committed and deployed** — this is the live production
state as of 2026-07-26. Nothing is half-done; this plan starts from a clean base.

⚠️ **The working tree is dirty and is shared with other concurrent AI/human
sessions.** `git status --short` at the time of writing shows ~17 modified files
and several untracked ones that are **not yours**. Do not commit them, do not
revert them, do not `git checkout .`, do not stash. Stage only the specific files
you create/edit (§ 13).

### The six implementations, as they exist today

| # | File | How it checks | Accepts service key? | Notes |
|---|---|---|---|---|
| 1 | `supabase/functions/admin-api/index.ts:156` `authenticateAdmin()` | `authenticateUser()` then `user_roles` filtered `.eq("role","admin").maybeSingle()`, wrapped in a `withRetry()` | Yes — `authenticateUser` (line ~117) returns `userId: "system"` on exact token match, and `authenticateAdmin` short-circuits `if (userId === "system")` | The most correct and most defensive variant. Also has a `getClaims()` fallback when `getUser()` fails. Errors: `err("Missing or invalid Authorization header", 401)`, `err("Invalid or expired token", 401)`, `err("Forbidden: admin role required", 403)` → body `{ok:false,error}` |
| 2 | `supabase/functions/erp-sync/index.ts:26-46` (inline) | exact `token !== serviceRoleKey` → then `getUser` → `user_roles` filtered `.eq("role","admin").maybeSingle()` | Yes, exact compare | Errors: `json({ok:false,error:"Missing auth"},401)`, `"Invalid token"` 401, `"Admin required"` **403** |
| 3 | `supabase/functions/helper-api/index.ts:681-693` `handleAdminForceDiscard()` | `getUserId()` (line 62) then `user_roles.select("role").eq("user_id",userId).single()` — **no `.eq("role","admin")` filter** | **No** | **BROKEN — see § 6.1.** Errors: `err("Unauthorized",401)`, `err("Admin only",403)` |
| 4 | `supabase/functions/export-table/index.ts:48-82` (inline) | `authHeader.includes(serviceKey)` **substring** → else `getUser` → filtered role query | Yes, but substring match | Failure returns a **bare** `{error:"Unauthorized — requires admin role or service role key"}` with status **401** (not 403) and hand-built `corsHeaders` |
| 5 | `supabase/functions/export-sql-dump/index.ts:95-122` `authorizeAdmin()` | identical to #4 | Yes, substring | Returns bare `{error:"Unauthorized"}`, status **401** |
| 6 | `supabase/functions/export-thumbnail-manifest/index.ts:19-44` `authorizeAdmin()` | identical to #5 but uses `serviceClient()` for the role query | Yes, substring | ⚠️ **Unlike #4 and #5**, it returns `err("Unauthorized", 401)` (`index.ts:57`), and `_shared/http.ts:62` `err()` wraps that as `{ok:false, error:"Unauthorized"}`. Body shape `{ok:false,error}`, status **401** |

**So the split is 4 / 2, not 3 / 3:** `admin-api`, `erp-sync`, `helper-api` and
`export-thumbnail-manifest` return `{ok:false,error}`; only `export-table` and
`export-sql-dump` return a bare `{error}` (both build the `Response` by hand
rather than going through `err()`). Status on a non-admin is **403** for
`admin-api`/`erp-sync`/`helper-api` and **401** for all three exporters.

### Supporting shared code that already exists (reuse it, don't reinvent)

- `supabase/functions/_shared/http.ts` — `corsServe()`, `json()`, `err()`.
  `err(msg, status)` produces `{ok:false, error: msg}`.
- `supabase/functions/_shared/service-client.ts` — `serviceClient()` factory
  (service-role Supabase client, bypasses RLS).
- Precedent for a shared module unit-tested from vitest:
  `supabase/functions/_shared/tag-asset-contract.js` is imported directly by
  `src/test/tag-asset-contract.test.ts:6` via a relative path
  (`../../supabase/functions/_shared/tag-asset-contract.js`). **That file has no
  remote (`https://`/`npm:`) imports, which is why vitest can load it.** Copy
  this pattern (§ 8, decision D3).

### Deployment / gateway detail you need

**No edge function in this project has gateway JWT verification.** The deploy
workflow loops over every directory under `supabase/functions/` (skipping
`_shared`) and deploys each one with `--no-verify-jwt`
(`.github/workflows/deploy-supabase.yml:61-72`). That flag overrides whatever
`supabase/config.toml` says, so the `verify_jwt` entries in `config.toml` are
inert for anything deployed by CI.

**Consequence: every one of the six functions is fully responsible for
validating its own credentials — there is no platform check in front of any of
them.** Do not reason as though `erp-sync`, `helper-api` or `export-sql-dump`
are protected by the gateway because they lack a `config.toml` entry; they are
not. This does not change the design (the shared helper validates the token
itself, as all six do today), but it does mean an auth mistake here is directly
exposed to the internet with nothing behind it. Treat every failure path as
fail-closed.

Do not "fix" this by changing the workflow or `config.toml` — that is a
deployment-policy change well outside this plan's scope.

---

## 6. Key findings and root cause

### 6.1 A real, live bug in `helper-api` (this is the headline finding)

`supabase/functions/helper-api/index.ts:688-693`:

```ts
const { data: role } = await db
  .from("user_roles")
  .select("role")
  .eq("user_id", userId)
  .single();               // ← no .eq("role","admin"), and .single()
if (!role || role.role !== "admin") return err("Admin only", 403);
```

`user_roles` has `UNIQUE(user_id, role)` — i.e. one row *per role*, and a user
may legitimately hold **both** `user` and `admin`. `.single()` errors (PostgREST
`PGRST116`) when the query matches more than one row; the error is discarded by
destructuring only `data`, so `role` is `null` and the admin gets **403 Admin
only**.

**Verified against live production data on 2026-07-26** (read-only query through
PostgREST with the service role):

```
role rows: 36   users: 35   admins: 3
users with >1 role row: 1
ADMINS with >1 role row → denied by this code: 1 of 3
```

So **one of the three current PopDAM admins cannot force-discard a checkout
today**, and would see "Admin only". The other five implementations filter with
`.eq("role","admin").maybeSingle()` and are unaffected.

**Repro:** call `POST {SUPABASE_URL}/functions/v1/helper-api/admin/force-discard`
with the JWT of an admin who has two `user_roles` rows → 403. Same call with an
admin who has exactly one row → 200. Confirm which admin is which with the
read-only query in § 12.

*This is exactly the drift the consolidation exists to prevent: the rule was
"correct" when written, five copies were later written correctly, and this one
was never revisited.*

### 6.2 The variants differ on the service-role bypass

**Five** of the six (`admin-api`, `erp-sync`, and all three exporters) accept the
Supabase **service role key** presented as a bearer token, so the Railway worker
and other server-to-server callers can reach admin routes. `helper-api`'s admin
route does **not** — and must not start accepting it, because nothing calls it
that way and widening it would be an unrequested privilege change. The shared
helper therefore needs an explicit *"do I allow the service key here?"* switch
rather than a single hardcoded policy (§ 8, decision D1).

### 6.3 Two functions match the service key by substring

`export-table/index.ts:57` and `export-sql-dump/index.ts:102` use
`authHeader.includes(serviceKey)`. That authorises any header that merely
*contains* the key rather than being exactly `Bearer <key>`. No known caller
exploits it and it is not a live vulnerability, but it is sloppier than
`erp-sync`'s exact comparison and there is no reason to carry it into shared
code. The shared helper does an **exact** comparison of the extracted token.
Real callers send exactly `Bearer <key>`, so this is invisible to them.

### 6.4 Error shapes are genuinely inconsistent, and that is load-bearing

Failure bodies differ: `{ok:false,error}` (admin-api, erp-sync, helper-api **and
export-thumbnail-manifest**) vs bare `{error}` (export-table, export-sql-dump).
Statuses differ too: a non-admin gets **403** from
`admin-api`/`erp-sync`/`helper-api` but **401** from all three exporters. The
inconsistency does not split cleanly along "admin functions vs exporters" — see
the corrected § 5 table and check each function individually rather than
pattern-matching. **Do not unify these.** Frontend and scripts read these responses
(e.g. `src/components/settings/diagnostics/ActionsSection.tsx:55` calls
`export-thumbnail-manifest` directly). Unifying error shapes is a separate,
optional, user-approved change — see § 13 risks. The shared helper therefore
returns a **plain result object**, not a `Response`, and each function formats
its own reply exactly as it does today (§ 8, decision D4).

### 6.5 No local Deno toolchain

`deno` is **not installed** on this machine (`which deno` → nothing; `supabase`
CLI is at `/usr/local/bin/supabase`). You cannot type-check or unit-test the
Deno edge-function code locally in the normal way. Consequences:
- Edge-function type errors surface only when the deploy workflow bundles them.
- `supabase/functions/_shared/path-filters.test.ts` exists but is **never run**:
  `vitest.config.ts` sets `include: ["src/**/*.{test,spec}.{ts,tsx}"]`. Do not
  add your tests next to the shared module expecting them to run.

### 6.6 Token parsing is NOT uniform today — do not silently normalise it

Two different parsers are in use:

- `admin-api` (`index.ts:113`), `erp-sync` (`index.ts:27`) and `helper-api`
  (`index.ts:64`) use `startsWith("Bearer ")` — **case-sensitive**, exact
  capitalisation required.
- `export-table` (`index.ts:63`), `export-sql-dump` (`index.ts:105`) and
  `export-thumbnail-manifest` (`index.ts:27`) use `replace(/^Bearer\s+/i, "")` —
  case-**insensitive** and tolerant of multiple spaces.

A single case-insensitive shared extractor would therefore **broaden** what the
first three accept. It can also change error *classification*: today
`Authorization: Bearer ` (empty token) gets past `startsWith` in `admin-api` and
fails later as `"Invalid or expired token"` (401); if a shared extractor maps an
empty token to `null` and `null` maps to "missing header", the same request
would start returning `"Missing or invalid Authorization header"`. Different
string, same status — but § 1.3 says the wire does not change. See decision D7.

### 6.7 A filtered role query makes the obvious unit test test nothing

If `admin-auth.ts` queries `.eq("role","admin").maybeSingle()`, then production
never hands a multi-row array to the policy function — so a unit test asserting
`rolesGrantAdmin([{role:"user"},{role:"admin"}]) === true` would be exercising a
code path production doesn't use, and would **not** catch someone reintroducing
an unfiltered `.single()`. The test would look like a regression guard for
§ 6.1 while guarding nothing. Resolved by decision D5 (fetch all rows for the
user and let the pure function decide), which makes the test representative of
what actually runs.

---

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| **Put the check in the database instead** — one `is_admin()` RPC / rely on RLS | Would work conceptually, but it is a shared-DB change (§ 11) requiring the `u2giants/shared-db` branch+PR flow, it changes the trust model for service-role callers who deliberately bypass RLS, and it does not remove the per-function token-validation code, which is where most of the drift actually lives. Explicitly out of scope. |
| **Have the helper return a `Response` on failure** (simplest possible API) | Would silently rewrite the wire contract of the three exporters — their bare `{error}` body would become `{ok:false,error}` and their 401 would become 403. Violates goal § 1.3. Rejected in favour of decision D4. |
| **Unify all six error shapes and statuses "while we're in there"** | Same reason: it is a caller-visible change to five call sites in the frontend and to scripts we cannot fully enumerate. It may be a good idea later; it is not this change. Noted as a follow-up in § 13. |
| **Put the shared logic in one file with the Deno imports inline and unit-test that file** | Cannot be done: vitest cannot resolve `https://esm.sh/...` / `npm:` specifiers, and there is no local Deno to run `deno test`. This is exactly why the code splits into a pure policy module + a Deno wiring module (decision D3). Don't collapse them back into one file. |
| **One shared bearer-token parser for all six** | Three functions parse case-sensitively and three don't (§ 6.6). A single parser broadens what three of them accept and can change `admin-api`'s error string for an empty token. Rejected in favour of D7's explicit per-call-site mode. |
| **Apply `admin-api`'s `getClaims()` fallback everywhere** | It exists in one function only. Universal application would admit tokens that five functions currently reject — an authentication widening dressed up as a refactor. Rejected in favour of D2's `allowClaimsFallback` opt-in. |
| **Keep the filtered `.eq("role","admin").maybeSingle()` query in the shared helper** | Correct, but it means production never passes multiple rows to the policy function, so the § 6.1 regression test would guard a dead path (§ 6.7). Rejected in favour of D5's fetch-all-rows. |
| **Wrap the whole `requireAdmin()` call in `admin-api`'s existing `withRetry()`** | Not equivalent to today's behaviour: it would retry JWT validation too, and would never fire once the helper turns DB errors into ordinary failure results. Rejected in favour of D6's `roleQueryAttempts`. |
| **Only fix the `helper-api` bug and leave the six copies** | Fixes today's symptom and leaves the mechanism that produced it. The user explicitly asked for consolidation. |
| **Also merge the non-admin auth paths (`getUserId`, `authenticateUser`, agent-key auth) in the same change** | Scope creep across functions with genuinely different auth models (`agent-api` uses an `x-agent-key` header, not a JWT). Bigger diff, bigger blast radius, harder review, for a change whose whole point is safety. |
| **Delete the duplicate `user_roles` rows so `.single()` works** | Treats valid data as the bug. The schema permits multiple rows per user; the code must handle it. Also a production data mutation, which AI sessions do not do here. |

Nothing has been attempted and failed — no code has been written for this yet.

---

## 8. Design decisions already made

All dated 2026-07-26. **D1–D7 are LOCKED — implement them as written, do not
relitigate.** (D6 was open in the first draft and is now decided; D2, D5 and D7
were revised after the independent review in § 14.)

- **D1 (LOCKED) — the helper takes an explicit `allowServiceRole` option.**
  Default `false`. The five functions that accept the service key today pass
  `true`; `helper-api` passes `false` (or omits it). Rationale: § 6.2. Never
  make service-key acceptance implicit.

- **D2 (LOCKED) — the shared module owns both `authenticateUser` and
  `requireAdmin`, and the `getClaims()` fallback is opt-in.** The admin check is
  *"validate the token, then look up the role"*; splitting those across modules
  would leave the token-validation half duplicated, which is where most of the
  drift is.
  **The `getClaims()` fallback exists in `admin-api` ONLY** (`index.ts:129-140`):
  when `auth.getUser(token)` fails it falls back to accepting `data.claims.sub`.
  The other five functions reject that token outright. Applying the fallback
  universally would let a JWT that `getClaims()` accepts but `getUser()` rejects
  through in five functions that currently refuse it — a real widening of
  authentication, not a refactor. So:
  ```ts
  allowClaimsFallback?: boolean   // default FALSE
  ```
  Only `admin-api` passes `true`. `admin-api` must not lose the fallback; no
  other function may gain it.

- **D3 (LOCKED) — two files, not one:**
  - `supabase/functions/_shared/auth-policy.ts` — **pure functions only, zero
    imports.** Token extraction from an `Authorization` header, exact
    service-key comparison, and the "given these `user_roles` rows, is this an
    admin?" decision. This file is unit-tested by vitest.
  - `supabase/functions/_shared/admin-auth.ts` — the Deno wiring: reads
    `Deno.env`, builds the Supabase clients, queries `user_roles`, calls into
    `auth-policy.ts`. Not unit-tested (no local Deno); verified by the live
    curl checks in the step gates.
  Rationale: § 5 precedent + § 6.5.

- **D4 (LOCKED) — the helper returns a result object, never a `Response`.**
  Shape:
  ```ts
  type AdminAuthResult =
    | { ok: true; userId: string; via: "service_role" | "jwt" }
    | { ok: false; status: 401 | 403; reason: "missing_header" | "invalid_token" | "not_admin" };
  ```
  Each function maps `{ok:false}` to **the exact response it returns today** —
  same status, same body shape, same message string. Rationale: § 6.4.

- **D5 (LOCKED) — fetch ALL role rows for the user and let the pure function
  decide.** The shared query is
  `.from("user_roles").select("role").eq("user_id", userId)` — no `.eq("role",
  "admin")` filter, no `.single()`, no `.maybeSingle()` — and the decision is
  `rolesGrantAdmin(rows)` → `rows.some(r => r.role === "admin")`.

  A filtered `.eq("role","admin").maybeSingle()` would also be *correct*
  (`UNIQUE(user_id, role)` guarantees at most one match), and it is what five of
  the six functions do today. It is rejected here for **testability**: with the
  filter, production never passes a multi-row array to the policy function, so
  the § 6.1 regression test would guard a path that never runs (§ 6.7). Fetching
  all rows makes the unit test exercise exactly the production decision. The
  cost is at most a handful of extra rows (production max is 2).

  **`.single()` is banned in this code path** — it is the § 6.1 bug.

- **D6 (LOCKED — was open, now decided) — retry is a parameter of the role
  query, not a wrapper around the whole call.** `admin-api` currently makes up
  to three attempts via `withRetry()` (`index.ts:170`, transient-pattern list
  ~line 205). Wrapping the *whole* shared `requireAdmin()` in `withRetry` is
  **not** equivalent and must not be done: it would re-run JWT validation on
  every attempt, and it would not retry at all once the shared helper converts a
  DB error into an ordinary `{ok:false}` result rather than throwing.

  Implement instead:
  ```ts
  requireAdmin(req, { allowServiceRole?: boolean; roleQueryAttempts?: number /* default 1 */ })
  ```
  `admin-api` passes `3`; everything else takes the default `1`. The retry
  applies **only** to the `user_roles` query.

  **Fail closed:** if the role query still errors after its attempts, return
  `{ok:false, status:403, reason:"not_admin"}` (or a distinct `reason` mapped to
  the same status/body) — never treat a DB error as a pass, and never let it
  throw out of the helper into a 500 that a caller might retry blindly. Log the
  error server-side.

- **D7 (LOCKED) — token parsing stays per-call-site; it is NOT normalised.**
  Three functions parse case-sensitively (`startsWith("Bearer ")`) and three
  case-insensitively (`/^Bearer\s+/i`) — § 6.6. Making one shared parser would
  broaden three functions and could flip `admin-api`'s "invalid token" error
  into a "missing header" error, both of which violate § 1.3.

  Therefore `extractBearerToken` takes an explicit mode:
  ```ts
  extractBearerToken(authHeader: string | null, mode: "strict" | "loose"): string | null
  ```
  - `"strict"` — requires the literal prefix `"Bearer "`; used by `admin-api`,
    `erp-sync`, `helper-api`.
  - `"loose"` — `/^Bearer\s+/i`; used by the three exporters.

  **There is no default** — every call site names its mode, so nobody silently
  inherits the wrong one.

  **Empty-token rule:** a header that *has* a valid prefix but an empty token
  (e.g. `"Bearer "`) must classify as **`invalid_token`, not `missing_header`**,
  so `admin-api` keeps returning `"Invalid or expired token"` for it. Cover this
  in the unit tests.

  Normalising the two parsers into one is a reasonable future cleanup; it is a
  deliberate contract change and belongs in its own reviewed change, not here.

---

## 9. The plan

One phase; a single session should complete it. Steps 3a–3f are independent of
each other and can be done in any order once step 2 is green.

### Step 1 — Write the pure policy module

**File (new):** `supabase/functions/_shared/auth-policy.ts`

Zero imports. Export at minimum:

```ts
export type BearerParse =
  | { kind: "missing_header" }          // no header, or no valid Bearer prefix
  | { kind: "empty_token" }             // valid prefix, nothing after it  → maps to invalid_token (D7)
  | { kind: "token"; token: string };

export function extractBearerToken(
  authHeader: string | null,
  mode: "strict" | "loose",             // NO default — every caller names it (D7)
): BearerParse;
// "strict": literal "Bearer " prefix, case-sensitive (admin-api, erp-sync, helper-api)
// "loose":  /^Bearer\s+/i              (the three exporters)

export function isServiceRoleToken(token: string | null, serviceRoleKey: string | undefined): boolean;
// EXACT equality only (§ 6.3). false if either side is empty/undefined.

export function rolesGrantAdmin(rows: Array<{ role: string }> | null | undefined): boolean;
// true iff some row.role === "admin". Handles null, [], and multi-row (§ 6.1 / D5).
// This is the function the production path actually calls — see D5.
```

Returning a small tagged union rather than `string | null` is what lets D7's
empty-token rule be expressed at all; don't collapse it back to a nullable
string.

Add a file-header comment stating: *pure module, no imports, so vitest can load
it — do not add Deno or remote imports here.*

**Done when:** the file exists, has no `import` statement, and `npm run lint`
passes.

### Step 2 — Write the unit tests, and make them green

**File (new):** `src/test/auth-policy.test.ts` (must live under `src/` — § 6.5).
Import via relative path, mirroring `src/test/tag-asset-contract.test.ts:6`:
`import { ... } from "../../supabase/functions/_shared/auth-policy.ts";`

Required cases, named to describe the rule:

- `extractBearerToken` in **`"strict"`** mode: `{kind:"token"}` for
  `"Bearer abc"`; **`{kind:"missing_header"}` for `"bearer abc"`** (case-sensitive
  — regression guard for D7); `missing_header` for `null`, `""`, `"abc"`,
  `"Basic abc"`.
- `extractBearerToken` in **`"loose"`** mode: `{kind:"token"}` for `"Bearer abc"`,
  `"bearer abc"`, and `"Bearer   abc"` (multiple spaces); `missing_header` for
  `"Basic abc"`.
- `extractBearerToken` **empty-token rule** (D7): `"Bearer "` →
  `{kind:"empty_token"}` in both modes, and the caller must map that to
  `invalid_token`, **not** `missing_header`. Name this test after the behaviour
  it protects: *"an empty bearer token is an invalid token, not a missing
  header"*.
- `isServiceRoleToken`: `true` only on exact match; **`false` when the token
  merely contains the key** (regression guard for § 6.3, e.g. token
  `"x" + key + "y"`); `false` when the key is `undefined` or `""` (so a missing
  env var can never authorise anyone).
- `rolesGrantAdmin`: `false` for `null`, `undefined`, `[]`, `[{role:"user"}]`;
  `true` for `[{role:"admin"}]` and — **the § 6.1 regression guard, name it
  after the bug** — `true` for `[{role:"user"},{role:"admin"}]`. Per D5 this is
  the shape production really passes in, so this test guards the real path.

**Verification gate:**
```bash
npx vitest run src/test/auth-policy.test.ts
```
All pass. Then the full suite must still be green:
```bash
npm test
```

### Step 3 — Write the Deno wiring module

**File (new):** `supabase/functions/_shared/admin-auth.ts`

Imports `createClient` (match the specifier already used in the file you're
mirroring — `_shared/service-client.ts` uses
`https://esm.sh/@supabase/supabase-js@2`), `serviceClient()` from
`./service-client.ts`, and the pure helpers from `./auth-policy.ts`.

Export:

```ts
export type AdminAuthResult = /* exactly as in D4 */;

export interface AuthOpts {
  parseMode: "strict" | "loose";      // REQUIRED, no default (D7)
  allowServiceRole?: boolean;         // default false (D1)
  allowClaimsFallback?: boolean;      // default false (D2) — admin-api only
  roleQueryAttempts?: number;         // default 1 (D6) — admin-api passes 3
}

export async function authenticateUser(
  req: Request,
  opts: AuthOpts,
): Promise<{ ok: true; userId: string; via: "service_role" | "jwt" }
         | { ok: false; status: 401; reason: "missing_header" | "invalid_token" }>;

export async function requireAdmin(
  req: Request,
  opts: AuthOpts,
): Promise<AdminAuthResult>;
```

Per-call-site option values (get these right — each one is a locked decision):

| Function | `parseMode` | `allowServiceRole` | `allowClaimsFallback` | `roleQueryAttempts` |
|---|---|---|---|---|
| `admin-api` | `strict` | `true` | **`true`** | **`3`** |
| `erp-sync` | `strict` | `true` | `false` | 1 |
| `helper-api` | `strict` | **`false`** | `false` | 1 |
| `export-table` | `loose` | `true` | `false` | 1 |
| `export-sql-dump` | `loose` | `true` | `false` | 1 |
| `export-thumbnail-manifest` | `loose` | `true` | `false` | 1 |

Behaviour requirements:
- The `getClaims()` fallback (`admin-api/index.ts:129-140`: if
  `auth.getUser(token)` fails and `anonClient.auth.getClaims` exists, accept
  `data.claims.sub`) runs **only when `allowClaimsFallback` is true** (D2).
  `admin-api` must keep it; nobody else may gain it.
- Map `{kind:"empty_token"}` from the parser to `reason:"invalid_token"` (D7),
  and `{kind:"missing_header"}` to `reason:"missing_header"`.
- When `allowServiceRole` and the token exactly equals
  `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`, return
  `{ok:true, userId:"system", via:"service_role"}` **without** a role lookup —
  this preserves `admin-api`'s `userId === "system"` short-circuit
  (`admin-api/index.ts:162`).
- The role lookup uses `serviceClient()` (must bypass RLS) and the D5 all-rows
  query, decided by `rolesGrantAdmin()`. Never `.single()`.
- Keep the existing diagnostic `console.log` of the role-check outcome (it is
  how production issues get debugged in the Supabase function logs) but **never
  log the token or the service key.**
- Implement `roleQueryAttempts` around the role query only, failing closed (D6).

**Done when:** the file exists and `npm run lint` passes. (No local Deno type
check exists — § 6.5 — so its real type gate is the deploy in step 5.)

### Step 4 — Rewire the six functions, one at a time

For each: delete the local check, call `requireAdmin`, and map failure to **the
identical response the function returns today** (§ 5 table, § 6.4, D4). Diff each
one and confirm the only behavioural delta is the intended one.

- **4a — `supabase/functions/admin-api/index.ts`.** Replace the body of
  `authenticateAdmin` (line 156) with a call to shared `requireAdmin(req,
  {allowServiceRole:true})`, mapping `not_admin` → `err("Forbidden: admin role
  required", 403)` and the 401 reasons → `err("Missing or invalid Authorization
  header", 401)` / `err("Invalid or expired token", 401)`. Keep the
  `authenticateAdmin`/`authenticateUser` function names and their existing
  `{userId} | Response` return type so the ~1670 call site and
  `USER_ACCESSIBLE_ACTIONS` logic (line 1670) are untouched — they become thin
  adapters over the shared module. Preserve retry per D6.
  **Gate:** the deployed admin UI can still list users (see step 5 curl).
- **4b — `supabase/functions/erp-sync/index.ts`.** Replace lines 26–46 with
  `requireAdmin(req, {allowServiceRole:true})`. Preserve the three exact bodies:
  `json({ok:false,error:"Missing auth"},401)`,
  `json({ok:false,error:"Invalid token"},401)`,
  `json({ok:false,error:"Admin required"},403)`.
- **4c — `supabase/functions/helper-api/index.ts`.** In
  `handleAdminForceDiscard` (line 681) replace the `getUserId` + role block with
  `requireAdmin(req)` — **`allowServiceRole` omitted / false** (§ 6.2). Map
  401 reasons → `err("Unauthorized",401)`, `not_admin` → `err("Admin only",403)`.
  Leave `getUserId` in place; every other route in the file still uses it.
  **This step is the § 6.1 fix — call it out in the commit message.**
- **4d — `supabase/functions/export-table/index.ts`.** Replace lines 48–82's
  `authorized` dance with `requireAdmin(req,{allowServiceRole:true})`. On
  failure return the **existing** bare body
  `{error:"Unauthorized — requires admin role or service role key"}` at status
  **401** with the existing hand-built `corsHeaders` — for both the 401 and the
  403 reasons, because that is what it does today.
- **4e — `supabase/functions/export-sql-dump/index.ts`.** Replace `authorizeAdmin`
  (line 95). Keep `{error:"Unauthorized"}` at **401** for every failure reason.
- **4f — `supabase/functions/export-thumbnail-manifest/index.ts`.** Replace
  `authorizeAdmin` (line 19). ⚠️ **Unlike 4d and 4e**, this function's failure
  path goes through `err("Unauthorized", 401)` (`index.ts:57`), producing
  `{ok:false,error:"Unauthorized"}` — **keep calling `err()`**; do not "make it
  consistent" with the other two exporters by hand-building a bare `{error}`
  body. See the corrected § 5 table.

**Gate for all of 4a–4f.** Note that a bare `grep -rn "user_roles"` will
**never** come back clean and is not a valid gate: `admin-api/index.ts:527`
legitimately joins `user_roles(role)` when listing users for the admin UI, and
lines 539-540 derive `isAdmin` for *display*. That query is not an authorization
check — **do not delete it.**

Use these instead:

```bash
# 1. No function outside the shared module performs a ROLE-CHECK query.
#    Expect exactly one hit: _shared/admin-auth.ts
grep -rn 'from("user_roles")' supabase/functions/

# 2. The admin-api display join is still present (must return line 527).
grep -rn 'user_roles(role)' supabase/functions/admin-api/index.ts

# 3. The § 6.1 bug shape is gone — no .single() anywhere near a role lookup.
#    (grep -A/-B, because in the buggy code .single() is on line 692 while
#    user_roles is on 689 — a naive `grep .single() | grep role` matches
#    NOTHING even before the fix, and would have "passed" a broken repo.)
grep -rn -A4 'from("user_roles")' supabase/functions/ | grep -n 'single()'
```
Gate 1 returns one hit, gate 2 returns one hit, gate 3 returns nothing.

### Step 5 — Deploy and verify live

Push (§ 13), then watch the deploy and probe production.

```bash
gh run list --workflow "Deploy Supabase Edge Functions" --limit 3
```
Wait for success — the workflow fails the job if any function fails to deploy,
so a green run is your Deno type check.

⚠️ **A red run does NOT mean production is untouched.** The workflow deploys
functions sequentially in a loop and only sets `failed=1`, continuing to the
next one (`deploy-supabase.yml:61-76`). If function #4 fails, #1-#3 are already
live and #5 onward still deploy. On any failed run: read the log, list which
functions reported success, and either fix-forward or revert immediately — do
not assume the previous version is still serving.

Then, with credentials injected by `op` (never printed — § 12):

**Probe every function, not just one.** A single `export-table` probe cannot
catch a missing `allowServiceRole: true` on the other four, which is the exact
mistake that would break the Railway worker silently.

**(i) Service-role acceptance — all five opt-in functions.** Send
`Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY` and confirm the response is
**not** an auth failure (a 400 for a missing/invalid parameter is a pass — it
means auth let you through):
- `GET /functions/v1/export-table?table=assets&page=0` → 200 with rows
- `GET /functions/v1/export-thumbnail-manifest` → 200
- `POST /functions/v1/export-sql-dump` → 200 / non-auth error
- `POST /functions/v1/admin-api` with `{"action":"list-users"}` → 200
- `erp-sync`: **do not fire a real sync — it has side effects.** Probe it with a
  deliberately invalid body and confirm you get a *non-auth* error rather than
  401/403. If you cannot reach it without triggering work, say so and get
  Albert's call; do not skip it silently and do not run a real ERP sync as an
  auth test.

**(ii) Rejection shape — all six, byte-for-byte.** Send
`Authorization: Bearer not-a-real-key` to each and compare status + body against
the § 5 table. Specifically:
- `export-table` → 401 `{"error":"Unauthorized — requires admin role or service role key"}`
- `export-sql-dump` → 401 `{"error":"Unauthorized"}`
- `export-thumbnail-manifest` → 401 **`{"ok":false,"error":"Unauthorized"}`** (note the difference)
- `admin-api` → 401 `{"ok":false,"error":"Invalid or expired token"}`
- `erp-sync` → 401 `{"ok":false,"error":"Invalid token"}`
- `helper-api` force-discard → 401 `{"ok":false,"error":"Unauthorized"}`

**(iii) `helper-api` must still REJECT the service role key** (§ 6.2 / D1): call
force-discard with `Bearer $SUPABASE_SERVICE_ROLE_KEY` → **401**, not 200. If
this passes auth, you set `allowServiceRole` wrongly and have widened access.

**(iv) Non-admin rejection:** sign in as the `ai-tester@popcre.com` account
(§ 12, a regular user) and call `admin-api` `list-users` → **403**
`{"ok":false,"error":"Forbidden: admin role required"}`.
- **The § 6.1 fix, end to end:** sign in as the admin who has two `user_roles`
  rows (identify them with the query in § 12) and call
  `POST {SUPABASE_URL}/functions/v1/helper-api/admin/force-discard` with a
  nonsense `checkout_id`. **Before this change it returns 403 "Admin only";
  after, it must get past auth** (expect a 400 `checkout_id`-related response or
  a 200 no-op, i.e. anything that is not 403). This is the single most important
  verification in the plan — if you cannot obtain that admin's JWT, say so
  rather than skipping it silently (§ 11, no-workarounds rule).
- **Admin UI smoke test:** open the deployed app, sign in as an admin, and load
  Settings → user management (exercises `admin-api` `list-users`), and the
  diagnostics action that hits `export-thumbnail-manifest`
  (`src/components/settings/diagnostics/ActionsSection.tsx:55`). Both must work.

### Step 6 — Documentation

- `docs/AUTHENTICATION.md` — in the edge-function auth section (around the
  existing line ~124 "admin-api: validates the Supabase JWT and checks the
  `user_roles` table"), state that **all** admin checks now go through
  `supabase/functions/_shared/admin-auth.ts`, that new admin routes must use
  `requireAdmin()`, and that the service-role bypass is opt-in per call site.
- `docs/API_CONTRACTS.md` — update the `authenticateAdmin()` reference (line ~18)
  to point at the shared module.
- Note the § 6.1 bug and its fix wherever this repo records fixed defects
  (`docs/KNOWN_QUIRKS.md` if the entry style fits).
- **Do not** rewrite these docs wholesale; add/adjust the minimum.

---

## 10. Tests required

**New — `src/test/auth-policy.test.ts`:** the cases enumerated in step 2. The two
named regression guards are mandatory: *"a user holding both `user` and `admin`
is an admin"* (§ 6.1) and *"a token that merely contains the service key is
rejected"* (§ 6.3).

**Must stay green — the whole existing suite:**
```bash
npm test
```
(`vitest run`, 18 test files under `src/test/`.) None of them touch auth, so any
new failure means you broke something unrelated — investigate, don't re-baseline.

**Also:**
```bash
npm run lint
```

**Explicitly not required:** Deno tests for `admin-auth.ts` — there is no local
Deno and vitest cannot import it (§ 6.5). Its verification is the live probes in
step 5. Do not add a test file under `supabase/functions/` and claim coverage:
`vitest.config.ts` will not run it, exactly as it silently does not run
`_shared/path-filters.test.ts`.

---

## 11. Constraints, standing rules, and gotchas

- **NO DATABASE CHANGES FROM THIS REPO.** No migrations under
  `supabase/migrations/`, no DDL, no Dashboard SQL, no one-off `execute_sql`
  writes. Shared-DB changes belong in the canonical `u2giants/shared-db` repo
  (local clone `/worksp/shared-db`) via branch + PR + timestamped migration.
  `.github/workflows/shared-db-guard.yml` runs on every push/PR and **will fail
  the build** if you add DDL or migrations here. This plan needs none.
- **Branch policy:** this repo is `main`-only. Do not create a feature branch.
- **The worktree is dirty with other people's work** (§ 5). Stage only your own
  files. Never `git add -A`, never revert, never stash.
- **No workarounds, no silent downgrades.** If a required credential, login or
  tool is missing, stop and say exactly what is missing. Do not substitute
  "reviewed the code, looks right" for the live verification in step 5, and do
  not report the work done with a verification skipped.
- **Read-only against production.** Read queries for identifying the affected
  admin are fine; do not mutate production data.
- **Never print a secret.** Use `op run --env-file=... -- <cmd>` so values only
  exist in the subprocess env (§ 12). The tooling blocks printing even a prefix
  of a live credential — that is expected, route around it, don't fight it.
- **Gotcha — no local Deno** (§ 6.5): your first real type check is the deploy.
  Re-read your edge-function diffs carefully before pushing.
- **Gotcha — vitest only sees `src/**`**: tests placed beside the shared module
  will never run and will look like passing coverage.
- **Gotcha — `.single()` vs `.maybeSingle()`**: `.single()` throws on 0 *and* on
  ≥2 rows. Destructuring only `data` swallows that error and looks like "no
  permission". This is the exact shape of the bug being fixed; don't reintroduce
  it anywhere.
- **Gotcha — two Supabase projects exist.** Live is `qsllyeztdwjgirsysgai`
  (Virginia). Some tooling defaults to the older Ohio project and will show you
  stale data. Verify with `mcp__supabase__get_project_url` before trusting any
  MCP query. Note the Supabase MCP was **unauthorized** for `execute_sql` on
  2026-07-26 — use the PostgREST path in § 12 instead.
- **Gotcha — there is NO gateway JWT check on anything** (§ 5): CI deploys every
  function with `--no-verify-jwt`, so `config.toml`'s `verify_jwt` entries are
  inert. Every function fully owns its own auth; nothing is protected in front.
  Don't "simplify" any validation away on the assumption the platform did it.
- **Gotcha — a red deploy run can still have changed production** (step 5): the
  workflow keeps deploying after a failure. Always check what actually shipped.
- Nothing hard-coded, no band-aids, no silent failure paths. If auth fails, it
  must return an explicit status, as it does today.

---

## 12. Access and environment

- **Working directory:** `/worksp/popdam`. Platform: Ubuntu (hetz VPS), bash.
- **Run the frontend locally:** `npm run dev` (Vite). Tests: `npm test`.
  Lint: `npm run lint`.
- **Authenticated CLIs on this machine:** `gh` (GitHub — use it to watch the
  deploy), `supabase` CLI 2.98.2 (linked to `qsllyeztdwjgirsysgai`), `psql`,
  `op` (1Password, service account, vault `vibe_coding` — the only vault).
  **`deno` is NOT installed.**
- **Supabase MCP:** `get_project_url` works; `execute_sql` returned
  *"Unauthorized … valid access token"* on 2026-07-26. Don't burn time on it.
- **Secrets — by location only, never values.** 1Password vault `vibe_coding`,
  item **"Supabase Runtime Keys - shared POP database (production)"**, fields
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
  `SUPABASE_PROJECT_REF`. The title contains parentheses, which breaks `op://`
  references — resolve the item **id** first, then reference by id:

  ```bash
  RID=$(op item get "Supabase Runtime Keys - shared POP database (production)" \
        --vault vibe_coding --format json | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
  printf 'SUPABASE_URL=op://vibe_coding/%s/SUPABASE_URL\nSUPABASE_SERVICE_ROLE_KEY=op://vibe_coding/%s/SUPABASE_SERVICE_ROLE_KEY\n' "$RID" "$RID" > refs.env
  op run --env-file=refs.env -- bash -c 'curl -s "$SUPABASE_URL/rest/v1/user_roles?select=user_id,role" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"'
  ```

  That last command is also **how you identify the admin affected by § 6.1**:
  group the rows by `user_id`, find the `user_id` that has both a `user` and an
  `admin` row, and join to `profiles` for the email if you need to know who to
  ask for a test login. Write `refs.env` into the session scratchpad, not the
  repo.
- **Test login for the app UI:** vault `vibe_coding`, item
  **"ai-tester@popcre.com"** — note this account is a *regular user*, not an
  admin, so it verifies the negative path (403/401) but **cannot** verify the
  admin paths. For the admin-side checks in step 5 you need an admin JWT; if you
  cannot obtain one, ask Albert rather than skipping the verification.
- **Deployed app URL:** the PopDAM frontend on Coolify (see `docs/INFRASTRUCTURE.md`
  for the current hostname). Edge functions:
  `https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/<name>`.

---

## 13. Definition of done, risks, open questions

### Done checklist
- [ ] `supabase/functions/_shared/auth-policy.ts` exists, pure, no imports.
- [ ] `supabase/functions/_shared/admin-auth.ts` exists and is the only place a
      `user_roles` **role check** is queried — the three gates at the end of
      step 4 pass (1 hit / 1 hit / nothing), with `admin-api:527`'s display join
      deliberately left intact.
- [ ] All six functions rewired with the correct per-call-site options (the
      table in step 3), and each one's failure status + body byte-identical to
      before (§ 5 table — including `export-thumbnail-manifest`'s
      `{ok:false,error}`, which differs from the other two exporters).
- [ ] `helper-api` multi-role bug fixed; **verified live** against the affected
      admin (step 5).
- [ ] `src/test/auth-policy.test.ts` added, including both named regression
      guards. `npm test` fully green. `npm run lint` clean.
- [ ] `docs/AUTHENTICATION.md` + `docs/API_CONTRACTS.md` updated.
- [ ] Committed to `main` staging **only** your own files, and pushed to both
      remotes:
      ```bash
      git push origin main
      git push github main
      ```
      If one remote fails, report which and why.
- [ ] `Deploy Supabase Edge Functions` workflow run is **green**
      (`gh run list --workflow "Deploy Supabase Edge Functions" --limit 3`).
- [ ] Live probes in step 5 all pass — **all four groups (i)-(iv)**, covering
      every one of the six functions, including `helper-api` still *rejecting*
      the service-role key, plus the admin-UI smoke test.
- [ ] `HANDOFF.md` updated with what shipped; this plan file deleted or marked
      DONE.

### Risks and rollback
- **Highest risk: locking admins out of production.** Every one of these
  functions gates something an admin needs. Mitigation: preserve response shapes
  exactly (§ 5 table), and run the full step 5 probe set immediately after the
  deploy. **Rollback:** `git revert <sha>` and push — the workflow redeploys all
  functions from `main`, so a revert restores previous behaviour within one
  workflow run. No DB state changes, so there is nothing else to undo.
  **Editing one function at a time is a review aid, not rollout containment** —
  deployment is all-functions-at-once and non-atomic, so do not treat it as a
  blast-radius control.
- **Partial-rollout risk:** a failed workflow run can leave some functions on the
  new code and some on the old (step 5). Since all six share one module, a
  mid-loop failure could mean, e.g., `admin-api` updated while `helper-api` is
  not. Both versions are self-contained (each bundle embeds its own copy of the
  shared code), so there is no cross-function version skew hazard — but do
  confirm what shipped and finish the rollout or revert promptly.
- **Second risk: breaking the Railway worker / bridge agent**, which call these
  endpoints with the service role key and are not exercised by the admin UI.
  Mitigation: the `allowServiceRole` flag must be `true` on exactly the five
  functions that accept it today, and the service-role curl probe in step 5 is
  mandatory.
- **Third risk: quietly widening access.** `helper-api` must NOT begin accepting
  the service role key. Double-check 4c passes no `allowServiceRole`.

### Open questions
- **Should the exporters' inconsistent 401/403 and bare `{error}` bodies
  be unified later?** Deliberately deferred (§ 7). It is a caller-visible change
  needing its own review of every frontend/script call site. Raise it with
  Albert **after** this lands; do not fold it in. Same for normalising the two
  bearer-token parsers into one (D7).
- **Is the duplicate-role-row situation intentional?** One user holds both
  `user` and `admin`. The schema allows it and the code must handle it either
  way, so this does not block anything — but it is worth asking whether
  `handle_new_user()` should stop leaving a stale `user` row behind when an
  admin is promoted. That would be a `shared-db` change, not this one.

---

## Self-audit (per implementation-plan-writer, run 2026-07-26 before the plan was shown)

**1. Could a brand-new AI session with no project knowledge and no context from
this conversation execute this plan perfectly, without asking anything?**
Yes. § 2 defines the app, stack, both Supabase projects and the deploy path from
zero. § 5 tables every one of the six current implementations with `file:line`,
its exact status code and its exact error body, so no reading of the existing
code is required to know what must be preserved. § 9 names every file and
function to touch, with a verification gate on each step, including the single
`grep` that proves completion. § 12 gives the working `op` incantation verbatim,
including the parentheses-in-title workaround that would otherwise cost an hour.
The one thing the implementer may need from a human — an admin JWT for the live
§ 6.1 check — is called out explicitly in § 12 with the instruction to ask rather
than skip.

**2. Does the plan carry every piece of background, nuance and reasoning held by
the planning session, including what was ruled out and why?**
Yes. § 6 carries all four findings including the live-data proof (1 of 3 admins
currently denied) and how it was obtained. § 7 records seven rejected approaches
with reasons — most importantly the DB-side `is_admin()` route, the
"return a Response" simplification, and the "just unify all the error shapes"
temptation, each of which a fresh session would otherwise reinvent. § 8 labels
D1–D5 LOCKED and D6 OPEN with decision criteria, so nothing gets silently
redesigned. § 6.5 and § 11 carry the two non-obvious environment traps (no local
Deno; vitest ignores `supabase/**`) that would otherwise produce fake test
coverage.

**3. Is the ultimate goal stated clearly enough that the implementer could make a
correct judgment call if a step turns out to be wrong?**
Yes. § 1 states the goal in business English before any technical wording, lists
four concrete conditions for done, and states the tie-breaker explicitly —
*if a step conflicts with the goal, the goal wins* — with the specific guidance
that preserving the wire contract (§ 1.3) beats tidiness whenever the two
collide. § 4's "NOT in scope" list bounds the judgment space, and § 13's risk
section tells the implementer what failure looks like and exactly how to roll
back.

**Gap found and fixed during the first audit:** the first draft did not say that
`helper-api` must *not* start accepting the service-role key. Since the shared
helper makes that a one-word option, an implementer optimising for uniformity
would plausibly have passed `allowServiceRole: true` everywhere and quietly
widened access to a force-unlock route. Now stated three times — § 6.2, D1, step
4c — and listed as the third risk in § 13. Re-graded after the fix: all
checklist items pass.

---

## 14. Independent review record (Codex / GPT-5.6, 2026-07-26)

The draft plan was reviewed read-only by Codex with repo access and a
deliberately adversarial brief. It returned **"ship with specific fixes."** Every
finding below was independently re-verified against the source before being
accepted, and all ten are now folded into the plan above. Recorded here so a
future session doesn't re-derive them — or worse, "restore" a corrected claim.

| # | Finding | Where fixed |
|---|---|---|
| 1 | § 6.1 diagnosis confirmed correct (with the nuance that `.single()` returns an error *result*, it does not throw) | § 6.1 |
| 2 | **§ 5 table was wrong:** `export-thumbnail-manifest` returns `err("Unauthorized",401)` → `{ok:false,error}`, not a bare `{error}`. Split is 4/2, not 3/3 | § 5 table, § 6.4, step 4f |
| 3 | § 6.2 said "three of the six" accept the service key; it is **five** | § 6.2 |
| 4 | **The `verify_jwt` claim was wrong and security-relevant:** CI deploys everything with `--no-verify-jwt`, so no function has a gateway check | § 5, § 11 |
| 5 | D2's universal `getClaims()` fallback would widen auth in five functions | D2 (`allowClaimsFallback`) |
| 6 | Token parsing is not uniform today; one shared parser would broaden three functions and change an error string | § 6.6, D7 |
| 7 | **Both completion gates were invalid** — `grep user_roles` can never pass (`admin-api:527` display join), and the `.single()` grep matched nothing even on the buggy code | step 4 gates (rewritten and test-run) |
| 8 | A filtered role query makes the headline regression test guard a dead path | § 6.7, D5 |
| 9 | D6 left open was a trap: wrapping the whole call in `withRetry` is not equivalent to today's behaviour | D6 (now locked) |
| 10 | "One function at a time" is not rollout containment; a red workflow run can still have shipped some functions | step 5, § 13 |
| 11 | Live verification covered one function while claiming to guard five | step 5 (i)-(iv) |

**Where the reviewer and the plan author still differ:** the review holds that
the two-file split (D3) is good but not literally "forced," since vitest could in
principle be reconfigured to resolve remote specifiers. That is technically
correct and changes nothing about what to build — the split stands, with the
weaker justification. No other disagreement remains.

**Not independently verifiable by the reviewer** (read-only sandbox, no DB): the
production `user_roles` counts in § 6.1, actual deployed function settings, and
any external caller not discoverable in the repo. The § 6.1 counts were obtained
by the plan author via PostgREST with the service role on 2026-07-26 using the
command in § 12 — re-run it if you want to confirm before starting.

---

## 15. Implementation record (2026-07-26)

**Shipped.** New `supabase/functions/_shared/auth-policy.ts` (pure, zero imports)
+ `_shared/admin-auth.ts` (Deno wiring, `authenticateUser` / `requireAdmin`), all
six functions rewired with the per-call-site options from step 3, and
`src/test/auth-policy.test.ts` (12 tests) added. D1–D7 implemented as written.
`npm test` 18 files / 75 tests green; `npm run lint` 0 errors. Step-4 gates:
1 hit / 1 hit / nothing. Deploy workflow run **30231551152 green** (the Deno
type check). Docs updated: `docs/AUTHENTICATION.md`, `docs/API_CONTRACTS.md`,
`docs/KNOWN_QUIRKS.md` #70.

### Live probe results

**(i) Service-role acceptance — all five opt-in functions PASS auth**
(`export-table` 200, `export-sql-dump` 200, `export-thumbnail-manifest` 500 DB
timeout, `admin-api` 500 schema-cache, `erp-sync` 502 from the external ERP —
all past auth, no sync ran).

**(ii) Rejection shapes — all six byte-identical to § 5**, plus the missing-header
variants (`admin-api` → "Missing or invalid Authorization header",
`erp-sync` → "Missing auth").

**(iii) `helper-api` still REJECTS the service role key** → 401
`{"ok":false,"error":"Unauthorized"}`. Access was not widened.

**(iv) Non-admin (`ai-viewer@designflow.app`)**: `admin-api` 403
`{"ok":false,"error":"Forbidden: admin role required"}`, `helper-api` 403
`{"ok":false,"error":"Admin only"}`, exporter 401. **Admin JWT
(`ai-admin@designflow.app`)**: `helper-api` force-discard reaches the handler
(400 `checkout_id required`), `export-table` 200.

### ⚠️ Gotcha found: the service-role key in 1Password is NOT the one the
### functions use

`supabase secrets list`'s DIGEST column is a **plain sha256 of the value**
(verified against `SUPABASE_URL`). The deployed `SUPABASE_SERVICE_ROLE_KEY`
digest matches the project's **new-format `default secret` (`sb_secret_…`) key**,
while 1Password item "Supabase Runtime Keys - shared POP database (production)"
holds the **legacy `service_role` JWT**. Same for `SUPABASE_ANON_KEY` (deployed =
new publishable key). The legacy JWT still works against PostgREST, so it looks
fine — but every edge-function service-role probe with it returns 401 and looks
exactly like an auth regression. This is pre-existing and unrelated to this work.
Reveal the real key with:
`GET https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/api-keys?reveal=true`
using the vault's "Supabase CLI Personal Access Token". **The 1Password entry
should be reconciled** — separate task.

### Outstanding (not blocking, needs Albert)

- **The § 6.1 end-to-end check against a multi-role admin.** The only user with
  two `user_roles` rows is **`albert@popcre.com`** (confirmed live: 36 role rows,
  35 users, 3 admins, 1 multi-role). The `ai-admin@designflow.app` tester has a
  single row, so it proves the admin path but not the multi-row case. No JWT for
  that account was available and neither impersonating it nor mutating
  production role rows is acceptable, so this was **not** faked. Albert can close
  it by signing in and running:
  `POST {SUPABASE_URL}/functions/v1/helper-api/admin/force-discard` with `{}` —
  expect **400 `checkout_id required`** (before this change it returned 403
  "Admin only").
  The logic itself is covered by the unit test *"a user holding both 'user' and
  'admin' is an admin"*.

### Pre-existing failures found while probing (NOT caused by this change, not fixed)

- **`admin-api` `list-users` is broken today** — 500
  `Could not find a relationship between 'profiles' and 'user_roles' in the
  schema cache`. Reproduced directly against PostgREST
  (`/rest/v1/profiles?select=user_id,email,user_roles(role)` → 400 `PGRST200`),
  so it is a missing FK / schema-cache problem in the database, independent of
  auth and of this refactor. The admin UI's user-management screen cannot work
  until it is resolved. Fixing it is a **shared-db** change — out of scope here.
- **`export-thumbnail-manifest` returns 500 `canceling statement due to statement
  timeout`** after passing auth. Pre-existing query-performance issue.
