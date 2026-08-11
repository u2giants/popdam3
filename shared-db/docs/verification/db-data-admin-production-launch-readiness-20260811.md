# DB Data Admin — production launch readiness for data.designflow.app (issue #729)

**Run date:** 2026-08-11 (America/New_York).
**Production project ref contacted:** `qsllyeztdwjgirsysgai` — confirmed by calling
`get_project_url` before any query, which returned `https://qsllyeztdwjgirsysgai.supabase.co`.
**Preview (`rjyboqwcdzcocqgmsyel`) was not contacted during this run.**
**Every database interaction in this document is a SELECT or an unauthenticated HTTP probe.
Nothing was created, altered, dropped, granted, or inserted.**

This document exists to answer one question honestly: *if the domain were attached right now,
what would the public get?* The short answer is **a tool that every single person, including
the owner, is locked out of**. The detail is below.

---

## 1. The blocker: nobody can use the tool, because no `admin` grant exists

Every `api.db_data_admin_*` RPC calls `app.require_db_data_admin_access()`, which demands the
`administrator` role **and** a non-revoked `app.app_access` row with `app = 'admin'`.

Live `app.app_access`, read 2026-08-11:

| app | active | revoked |
| --- | --- | --- |
| crm | 27 | 4 |
| dam | 3 | 0 |
| pm | 2 | 0 |
| **admin** | **row does not exist** | — |

There is no `admin` row of any kind — not zero active rows, but no rows at all. So today every
screen of a live `data.designflow.app` would return **Access denied** for every user, Albert
included.

The fix is migration `20260810050000` (data-only; provisions three administrators and one
designer by role and UUID). **It is UNAPPLIED in production.** It sits behind a batch promotion
that is stalled: batch B2 is STAGED awaiting an approval click in GitHub Actions, and B3..B9
have not been run.

**The launch cannot be called done until that migration reaches production.** This workstream
owns no migration and did not touch it.

## 2. A production launch today is inherently read-only, and one tab does not exist

Both production write gates are **disabled**:

| feature | enabled | note recorded in the table |
| --- | --- | --- |
| `single_record_write` | `false` | production enablement is a later decision |
| `merge_execute` | `false` | enable on preview only until production approval |

So no edit, no merge, and no single-record write can succeed in production regardless of who
signs in.

**Product Depth is unreachable and must not be advertised.** `main`'s UI ships four tabs
(Customers, Vendors, Licensors, Properties). Production has **none** of the
`api.db_data_admin_product_depth_*` RPCs — a live enumeration of `pg_proc` returns exactly 16
`api.db_data_admin_*` functions and not one of them is a product-depth function. Migration
`20260809170500` is unapplied.

Screens that would genuinely work against production today: **Customers, Vendors, Licensors
tree, Properties** — read-only. Screens that would not: **Product Depth, and every write
action.**

## 3. Access control, proven without writing anything

**Anonymous — denied.** Unauthenticated `POST` to the production REST endpoint carrying only
the production publishable key, `Accept-Profile: api`:

| RPC | result |
| --- | --- |
| `rpc/db_data_admin_channel_list` | **HTTP 401** |
| `rpc/db_data_admin_licensor_property_tree` | **HTTP 401** |
| `rpc/db_data_admin_customer_list` | **HTTP 401** |

This is not merely a runtime check. Structurally, **no** `api.db_data_admin_*` function grants
`EXECUTE` to `anon`; all 16 carry exactly `postgres=X/postgres | authenticated=X/postgres`.
Anonymous access is impossible by ACL, not by convention.

**Signed in but unauthorized — denied.** The production AI tester account (referred to by role, not by address; AGENTS.md 6.14)
**holds the `administrator` role** but its `app_access` is `pm` only. It receives **HTTP 403**
on `channel_list`, `licensor_property_tree` and `customer_list`. This is the strongest form of
the test: holding the role alone does not open the tool. Both conditions are required.

**Authorized administrator — NOT PROVEN, and cannot be, in production.** There are zero `admin`
grants in production (§1), so no authorized user exists to test with. This case must be proven
on **preview**, which runs the identical gate. See §7 for what is still outstanding.

## 4. There is no DNS work to do

`data.designflow.app` **already resolves** to the Coolify VPS `178.156.180.212` — the same A
record as `data-dev`. The `503 no available server` seen today is Traefik reporting that it has
no route for that hostname, not a missing DNS record.

**No DNS change is required to launch and none should be made.** There is no wildcard record on
`designflow.app`, so a separate staging hostname would itself need a new Cloudflare record;
that is why staging is done without a domain at all (§5).

For contrast, `data-dev.designflow.app/health` returns `200` and serves build-sha `63d262e`.

## 5. Visual verification of the production runtime configuration

The production image was built from this branch and served locally with a `/config.js`
containing the real production Supabase URL and publishable key. Screenshot:
`db-data-admin-production-config-signin-20260811.png`.

It shows **only "Sign in with Microsoft"**. There is no email/password form, because
`DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN` is unset and `readConfig()` treats an unset value as
disabled. This is the required production posture: an internet-facing admin tool for a database
four applications share must be SSO-only. The only console output was a favicon `404` from the
local static server.

A second screenshot, `db-data-admin-production-anonymous-20260811.png`, records the anonymous
denial from §3.

## 6. The workspace bar no longer lies about which database you are in

`DataAdmin.tsx` hardcoded the literal `Preview database` in the workspace bar. On
`data.designflow.app` that would have told every administrator they were poking a disposable
copy while they were in fact looking at the live shared database. The label is now **derived
from the Supabase project ref the app is actually connected to**, via `/config.js` — never from
a separate variable that can be set wrong or forgotten. An unrecognized project reports itself
as unrecognized rather than being guessed at.

Four tests render `<DataAdmin>` itself and assert the rendered bar
(`DataAdmin.environment-label.test.tsx`); before this change **no test rendered `<DataAdmin>`
at all**, which is how the hardcode survived. The tests were mutation-checked: restoring the
old hardcoded string makes three of the four fail. Full suite: **98 passing.**

## 7. What is still outstanding

1. **Migration `20260810050000` must be applied to production.** Until then the tool is
   unusable by everyone. Not owned by this workstream.
2. **The authorized-administrator case is unproven.** It cannot be proven in production (§3)
   and proving it on preview requires signing in to a real account, which an AI session must
   not do. This requires the owner to sign in once on preview and confirm the grid loads.
3. **The fqdn is deliberately not attached.** See below.

## 8. What flipping the switch would do

The single action that makes the site publicly live is attaching the fqdn
`https://data.designflow.app` to the production Coolify application. That is the owner's
decision and was not taken here. The moment it is taken:

- Traefik begins routing the hostname and Let's Encrypt issues a certificate over the HTTP-01
  challenge, so the tool becomes reachable from the public internet.
- Anonymous visitors get the sign-in screen and nothing else; the data stays protected by ACL
  (§3).
- **Every authenticated user, including the owner, gets "Access denied"** until §7.1 is done.
- Even after §7.1, the tool is read-only (§2) and has four working tabs, not five.

## 9. The production Coolify application, created without a domain

`db-data-admin-production` = **`zeoy8qfjqffu8ym533cc7dl4`**, in project `DB Data Admin`
(`x433rsji7hlmgpysautjpa1e`), production environment (`ly7550eqjkwyto8ehzo08hkh`, id 14).
Image `ghcr.io/u2giants/db-data-admin:sha-63d262e`. Status `exited:unhealthy` because it was
created with `instant_deploy: false` and has never been deployed. **fqdn is empty.**

Confirmed not publicly exposed, immediately after creation:

| URL | result |
| --- | --- |
| `http://zeoy8qfjqffu8ym533cc7dl4.178.156.180.212.sslip.io` | **404** — Traefik has no route |
| `https://data.designflow.app` | **503** — unchanged, no cutover happened |
| `https://data-dev.designflow.app/health` | **200** — development untouched |

Two Coolify behaviours worth recording because both would have caused a silent mistake:

1. **Creation attached a public `sslip.io` domain that was never requested.** The create
   response returned `http://<uuid>.178.156.180.212.sslip.io`. It was stripped at once by
   PATCHing `domains` to an empty string and re-reading the application to confirm
   `fqdn` is empty. Had it been left, the app would have been publicly reachable the moment
   it was deployed, which is precisely what "no fqdn" was meant to prevent.
2. **`POST /envs` returned HTTP 422 while still creating the record.** Three variables were
   reported as failures and were in fact created, so a retry produced duplicates. They were
   enumerated by uuid and de-duplicated down to exactly three. Never trust the status code
   from that endpoint; re-read `/envs`.

Final variables on the production application: `DB_DATA_ADMIN_SUPABASE_URL`,
`DB_DATA_ADMIN_SUPABASE_ANON_KEY`, `DB_DATA_ADMIN_AUTH_REDIRECT_URL`, and deliberately **no**
`DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN`, which is what keeps the tool SSO-only (§5).
