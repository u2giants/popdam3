# Rule: no new direct database logins (pg_net exposure)

**Owner decision:** Albert Hazan, 2026-09-23 (chat).
**Project:** production `qsllyeztdwjgirsysgai`, PostgreSQL 17.6, pg_net 0.20.3.

## The rule

Do not create new database roles that can log in directly (`LOGIN`), except
for our own trusted server-side services where direct access is unavoidable.
Anything else — new apps, integrations, vendors, people, AI agents — reaches
the database through the existing Supabase paths (the Data API with
row-level security, or edge functions), never through a new login.

Any login role that *is* created must be treated as fully trusted, because it
will be able to use pg_net (see below). Say so explicitly in the issue that
creates it.

## Why

In the `net` schema, `PUBLIC` holds `USAGE` (granted by `supabase_admin`), and
`net.http_request_queue` and `net._http_response` have `PUBLIC` table
privileges with no RLS. Every role — including any role we create in the
future — therefore inherits the ability to read and change the outgoing-HTTP
queue and responses (which can include request headers) and to call `net.*`
functions to send HTTP from inside the database. `postgres` does not own the
schema and cannot remove the `PUBLIC` grant. The pg_net 0.20.3 installer
re-grants it on reinstall/upgrade.

We asked Supabase support (2026-09) for a supported, provider-executed way to
remove only that `PUBLIC` grant while preserving every existing caller.
Their answer, summarised:

- `net`, like `auth`, `storage` and `realtime`, is a managed schema and
  modifying it is restricted to avoid breaking functionality
  (changelog: https://github.com/orgs/supabase/discussions/34270).
- `anon` and `authenticated` are `NOLOGIN`, so they cannot connect directly;
  the Data API does not expose `TRUNCATE`/`TRIGGER`/`MAINTAIN`/`REFERENCES`,
  and RLS is the supported control for API data access.
- They offered to look further only for a specific compliance requirement.

No such compliance requirement exists, so the exposure is closed by policy on
our side rather than by an ACL change. Existing roles are unaffected by this
rule; the gap only matters for roles created from now on.

## Known in-flight work this governs

- popcre/shared-db#2873 plans `LOGIN` runtime identities for four DesignFlow
  backend services. These are our own server code and need direct
  (Sequelize) connections, so they fall under the trusted-service exception,
  accepting that they can reach pg_net.
