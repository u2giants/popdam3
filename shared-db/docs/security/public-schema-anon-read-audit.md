# `public` schema anon-READ audit — RLS and GRANT layer

**Date:** 2026-07-29
**Environments audited:** production `qsllyeztdwjgirsysgai` (read-only) and preview `rjyboqwcdzcocqgmsyel`
**Fixed by:** `supabase/migrations/20260729210000_close_anon_read_leaks_in_public.sql`
**Sibling document:** [`public-schema-execute-audit.md`](public-schema-execute-audit.md) — the same
trust boundary one layer up (function EXECUTE grants), audited and fixed earlier the same day.

This audit exists because the independent review of that EXECUTE work
(`.ai/reviews/20260729-public-execute-lockdown-glm.md`) predicted that the *table* layer
would have the same bug class. It does.

---

## 1. What the problem was, in plain terms

The "anon key" is the database key that ships inside the JavaScript of every one of our
apps. Anyone can read it out of a browser in about ten seconds — it is not a secret, and
it is not meant to be one. It is supposed to be useless on its own, because the database
is supposed to hand out no data until someone actually logs in.

On production, four things in the database were handing out data to anyone holding that
key and nothing else — no login, no password, no account:

| Object | Rows exposed to the anonymous internet | What was in them |
|---|---|---|
| `style_groups` | **10,589** | SKUs, licensor and property names, customers, designer/freelancer names, folder paths, item descriptions |
| `style_tracker_rows_with_bridge` | **15,534** | SKUs, customer names, licensors, designers, royalties, licence status, full product descriptions |
| `sg_archive_usage` | **760** | Licensor names, style-guide property folders, file counts and design activity dates |
| `style_tracker_audit_log_with_user` | **345** | Full before/after change history **including staff email addresses** |

That is roughly 27,000 rows of commercial data — who our customers are, which licensors we
work with, what we are designing for whom, and which staff member changed what — available
to any anonymous caller.

**No evidence of actual misuse was looked for and none is claimed.** This audit establishes
that the door was open, not that anyone walked through it. Access logs were not reviewed.

**Writes were never exposed.** Only reading.

## 2. Why it happened — two separate mistakes

### 2.1 A policy that says "authenticated" but means "everyone"

`style_groups` was protected by a policy called **"Authenticated users can read
style_groups"**. Its actual definition was:

```sql
create policy "Authenticated users can read style_groups" on public.style_groups
  for select using (true);        -- note: no TO clause
```

In Postgres, omitting `TO` makes a policy apply to the **PUBLIC pseudo-role**. Every role
is a member of PUBLIC, including `anon`. So the policy granted read access to precisely the
people its own name says it should not, and it did so while *looking* correct in every code
review and in the Supabase dashboard's summary view.

The sibling policy `"Admins can manage style_groups"` (`FOR ALL`, `USING
has_role(auth.uid(),'admin')`) has the same `roles = {public}` shape but is harmless:
`auth.uid()` is NULL for an anonymous caller, so it evaluates false. **This is the trap for
anyone auditing by eye** — `roles = {public}` is only a bug when combined with a `USING`
expression that an anonymous caller can satisfy. `USING (true)` is the dangerous
combination.

### 2.2 Views silently bypass row-level security

A Postgres view created **without** `security_invoker = true` executes as its **owner**.
Every view here is owned by `postgres`, which on Supabase carries `BYPASSRLS`. Row-level
security on the tables underneath therefore does not apply to anyone reading through the
view.

The tables themselves were configured correctly. `style_tracker_rows` returns **0 rows** to
anon — its RLS works. But `style_tracker_rows_with_bridge`, a view over that same table,
returned **15,534**. The view completely defeated the table's protection.

Views have no RLS of their own, so for a view **the GRANT is the only guard there is** — and
Supabase's default ACLs for schema `public` grant `SELECT` to `anon`, `authenticated` and
`service_role` on every view at the moment it is created. Nothing ever revoked it.

Two views in `public` *did* have `security_invoker = true` (`dam_character_catalog`,
`style_guide_file_tags_display`) and both correctly returned **HTTP 401** to anon — which is
what proved the mechanism rather than guessing at it.

### 2.3 Why no test caught either one

Identical to the EXECUTE audit: a local Postgres has no `anon` role, no `authenticated`
role, no Supabase default ACLs and no PostgREST. Every check of these migrations passes
locally. **This bug class is only observable against a hosted project.**

## 3. What the fix does

1. Re-creates the `style_groups` SELECT policy as `TO authenticated`, keeping the name and
   `USING (true)`. The admin policy is untouched.
2. Revokes **all** privileges on the three leaking views from `anon` **and** from the PUBLIC
   pseudo-role.

### 3.1 Why `security_invoker = true` was deliberately NOT used on the views

It is the tempting fix and it is the wrong one here. Turning it on would make the views run
as the calling user, which closes the anon hole — but it would also **silently reduce what
legitimately logged-in users see**:

- `style_tracker_audit_log_with_user` joins `public.profiles`, whose RLS restricts a
  non-admin to their **own** row. `changed_by_label` and `changed_by_email` would become
  NULL for every other person's entries, quietly gutting the audit trail.
- `style_tracker_rows_with_bridge` joins `core.customer`, `core.licensor`,
  `core.creative_designer` and `core.factory`, whose RLS requires an `app` role. Canonical
  customer/licensor/designer/factory names would disappear for any logged-in user without
  one.

Revoking anon's grant closes the hole and **cannot** change behaviour for `authenticated` or
`service_role`, whose grants are left exactly as they were. That is the smaller, safer
change. Adopting `security_invoker` on these views is a reasonable future hardening step but
it needs its own testing against the apps, and it is not a security fix — it is a
refactor.

The stray `INSERT`/`UPDATE`/`DELETE` grants on the views were revoked in the same statement.
They were never exploitable — all three views are joins or aggregates and
`information_schema.is_insertable_into` is `NO` — but leaving them is a latent trap for
whoever later adds an `INSTEAD OF` trigger.

### 3.2 The migration asserts its own outcome

The migration ends in a `DO` block that uses `set local role` to drop its own `BYPASSRLS`
and then checks, **in both directions**, raising an exception on failure:

- `anon` must see **0** rows of `style_groups`, and must get `42501 insufficient_privilege`
  on all three views.
- `authenticated` must **still** be able to read `style_groups` and all three views.

A migration that closes a hole by breaking the apps is not a fix, and a migration that
reports success while the hole is open is worse than no migration. Both are now impossible.

## 4. The sweep — every anon-reachable object in `public`

`anon` holds `USAGE` on schema **`public` only** — verified against `public`, `app`, `plm`,
`api`, `crm`, `pim`, `core`, `ingest` and `dam`. PostgREST exposes several of those schemas,
but without schema `USAGE` they are unreachable by `anon`, so `public` is the entire
anon-reachable surface.

Within `public`, **53 relations** carried some privilege for `anon`: 48 tables and 5 views.
Rather than trust a regex over policy expressions — which is what missed three of these four
leaks on the first pass — every one of the 53 was probed end-to-end with a real anon-key
`GET` against the live REST API. That is the only test that cannot be fooled by a policy
that is permissive in a non-obvious way.

**Result: 4 leaking, 49 clear.**

- **48 tables**: all had RLS **enabled** (`relrowsecurity = true`). No anon-granted table
  has RLS off. Only `style_groups` and `admin_config` returned any rows to anon; the other
  46 returned `HTTP 200` with a row count of **0**, meaning the grant exists but RLS
  correctly yields nothing. This includes the sensitive ones —`profiles`, `user_roles`,
  `app_access`, `invitations`, `helper_tokens`, `agent_registrations`, `assets`,
  `erp_items_raw`, `prod_order_headers_raw`, `style_tracker_rows`.
- **5 views**: the 3 without `security_invoker` all leaked; the 2 with it both returned
  `401`.
- **2 materialized views** (`style_guide_file_groups`, `style_guide_folders`): `anon` holds
  no privilege, so they are unreachable. Worth recording explicitly, because materialized
  views ignore RLS entirely — like views, the grant is the only guard.

Tables checked and cleared (all returned 0 rows to anon):

```
agent_pairings, agent_registrations, ai_sentinel_cleanup_log, ai_tag_bakeoff_results,
ai_tag_bakeoff_reviews, ai_tag_bakeoff_runs, app_access, asset_characters, asset_checkouts,
asset_path_history, asset_tags, assets, characters, dam_search_documents,
dam_search_synonyms, erp_enrichment_log, erp_items_current, erp_items_raw, erp_sync_runs,
helper_devices, helper_tokens, hygiene_findings, invitations, licensors, pdf_text_samples,
processing_queue, prod_order_headers_current, prod_order_headers_raw, prod_order_sync_runs,
product_categories, product_category_predictions, product_subtypes, product_types, profiles,
properties, render_queue, scanner_ai_ignores, sku_files_used, style_guide_crawl_runs,
style_guide_files, style_guide_render_queue, style_tracker_audit_log, style_tracker_rows,
style_tracker_user_views, tiff_optimization_queue, user_roles
```

Note that several of these carry `USING (true)` SELECT policies — e.g. `licensors`,
`sku_files_used`, `style_guide_files`, `style_tracker_rows` — but scoped correctly to
`TO authenticated`, which is why they return nothing to anon. `style_groups` was the only
table where that same intent had been written without the `TO` clause.

### 4.1 Deliberately NOT changed: `public.admin_config`

`admin_config` returns exactly **one row** to anon, via a policy that is doing it on
purpose:

```sql
create policy "anon can read SCAN_REQUEST for Realtime watcher" on public.admin_config
  for select to anon using (key = 'SCAN_REQUEST');
```

This is a correctly-written, narrowly-scoped policy — `TO anon` explicitly, and constrained
to a single key. The row is DAM scan-request job status (status, timestamps, and internal
user UUIDs), and the DAM scanner agent's Realtime watcher depends on being able to see it
before it authenticates.

Two other policies on the table (`"Authenticated read non-secret admin_config"`, which
excludes keys matching `pass|secret|token|key|cred|pwd`, and three admin policies) are all
correctly scoped `TO authenticated`.

**This was left alone.** It exposes internal user UUIDs to anonymous callers, which is not
ideal, but it is intentional design rather than a mistake, removing it would break the DAM
scanner, and the authorisation for this session covers accidental leaks. **Albert should
decide** whether the Realtime watcher can be moved to an authenticated or agent-key path.
Recommendation: worth doing, low urgency — the exposure is job-status metadata, not
commercial data.

## 5. Who reads `style_groups` — established before narrowing the policy

Scoping the policy to `authenticated` is only safe if nothing reads the table anonymously.
All app repos under `u2giants` were searched (`gh search code`, plus local checkouts of
`popcrm-web` and `dflow`). Only **popdam3** reads `style_groups`.

- **Browser reads** — `src/hooks/useStyleGroups.ts`, `src/pages/StylesPage.tsx`,
  `src/pages/SellThroughExportPage.tsx`, `src/components/library/AssetDetailPanel.tsx`,
  `src/components/library/BulkActionBar.tsx`. These use the anon key **with a persisted user
  session**, and every route that mounts them (`/library`, `/styles`, `/sell-through`,
  `/settings`, `/files`) sits inside `ProtectedRoute`, which redirects to `/login` when
  there is no user. They cannot fire for a logged-out visitor.
- **Edge functions** (`agent-api`, `admin-api`, and the `_shared/admin-handlers/*`) — all use
  `service_role`, so RLS does not apply to them at all. `verify_jwt = false` in
  `config.toml`, but the gate is in code (`requireAdmin`, or `authenticateAgent` against an
  `x-agent-key`). The six actions that *are* unauthenticated (`register`, `bootstrap`,
  `pair`, `notify-build`, `get-latest-build`, `report-update-status`) do not touch
  `style_groups`.
- **Worker** (`apps/worker/src/handlers/*`) — `service_role`, headless, no HTTP surface.

The genuinely public routes are `/`, `/login`, `/forgot-password`, `/reset-password`,
`/auth/callback`, `/privacy`, `/terms`. None import any reader. There is no share link, no
public gallery, and no SSR/SSG or build-time fetch (it is a Vite SPA).

**Verdict: no unauthenticated reader exists.** The same reasoning covers the three views,
which are read only by authenticated app screens and by `service_role`.

## 6. Verification

### Preview (`rjyboqwcdzcocqgmsyel`) — applied, assertions passed

```
NOTICE: OK: public.style_groups -- anon sees 0 rows, authenticated sees 7504 rows.
NOTICE: OK: anon is denied SELECT on public.style_tracker_rows_with_bridge (42501, as intended).
NOTICE: OK: anon is denied SELECT on public.style_tracker_audit_log_with_user (42501, as intended).
NOTICE: OK: anon is denied SELECT on public.sg_archive_usage (42501, as intended).
NOTICE: OK: authenticated can still read public.style_tracker_rows_with_bridge (15533 rows).
NOTICE: OK: authenticated can still read public.style_tracker_audit_log_with_user (0 rows).
NOTICE: OK: authenticated can still read public.sg_archive_usage (749 rows).
```

Anon-key `GET` against the preview REST API:

| Object | Before | After |
|---|---|---|
| `style_groups` | `200`, `0-0/7504` | `200`, `*/0` |
| `style_tracker_rows_with_bridge` | `206`, `0-0/15533` | `401` |
| `style_tracker_audit_log_with_user` | `206` | `401` |
| `sg_archive_usage` | `206`, `0-0/749` | `401` |

### Production (`qsllyeztdwjgirsysgai`)

See the "Production promotion" note appended below when promoted.

## 7. The pattern to remember

Three rules, all learned the same day, all invisible to local testing:

1. **A policy with no `TO` clause applies to everyone, including `anon`.** Read the
   `roles` column, never the policy's name. `roles = {public}` plus a `USING` expression an
   anonymous caller satisfies is a leak; `roles = {public}` plus `auth.uid()`-based `USING`
   is not.
2. **Views and materialized views are not protected by RLS.** For a view, the GRANT is the
   only guard. Every new view in `public` must either set `security_invoker = true` or
   revoke `anon`.
3. **Supabase's default ACLs grant `anon` access to every new table, view and function in
   `public` at creation time.** `revoke ... from public` does not remove them — that only
   touches the PUBLIC pseudo-role, not the named `anon` grant. You must revoke `anon`
   explicitly.

Auditing by regex over policy expressions is not sufficient — it found only 1 of these 4
leaks. **Probe with the real anon key.**
