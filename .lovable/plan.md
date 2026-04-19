## Goal

Build a sister DAM app — **PopSG** — that ingests from the `/volume1/styleguides/` folder on the same NAS, reusing the existing Bridge Agent and a unified login, but with its own URL, its own [supabase.com](http://supabase.com) database (not lovable supabase), light theme, and licensor-style-guide-specific filters.

## Hard constraints (from you)

- **Separate Supabase backend** (new Lovable Cloud project)
- **Same Bridge Agent** (one Docker container on Synology serves both apps)
- **Same Windows Agent** (one Docker container on Synology serves both apps)
- **Different URL** (e.g. `sg.designflow.app` vs `dam.designflow.app`)
- **Shared authentication** with **per-app access control** (a user can be granted access to PopDAM, StyleGuide DAM, or both)
- **Light theme** (PopDAM stays dark)
- **Group by depth-2 folder** (the style guide name)

## Architecture decision: how to share auth across two Supabases

Two Supabase projects can't natively share `auth.users`. The cleanest option that meets your "one login, per-app access control" requirement:

**Use the existing PopDAM Supabase as the single identity provider.** Both apps log in against `ryltkzzernhwnojzouyb` (the PopDAM project). A new `app_access` table on PopDAM's DB lists which apps each user can enter (`popdam`, `styleguides`, or both). The new StyleGuide app's frontend authenticates against PopDAM's auth, then uses its own service-role-backed edge functions on its own Supabase to read/write style-guide data — passing the verified user JWT through for authorization.

This keeps Google OAuth in one place, gives you a single "Users & Access" admin page, and lets each app keep an independent schema, migrations, and edge functions.

## Plan

### 1. Identity & access (on existing PopDAM Supabase)

- New table `app_access(user_id, app)` where `app` is enum (`popdam`, `styleguides`)
- Update `handle_new_user()` so invitations carry which app(s) the invitee is granted
- Extend invitations table with `apps text[]` column
- Admin "Users" page (in either app) shows checkboxes per user: ☑ PopDAM ☑ StyleGuides

### 2. New Lovable Cloud project: **PopSG**

- Forked from this codebase (copy reusable parts: auth shell, layout, library grid/list, filter sidebar, AI tagging, thumbnails, agent pairing UI)
- Strip out: SKU parsing, MG codes, ERP enrichment, product_category, divisions, asset_type/art_source, style_groups (replaced), TIFF hygiene
- Light theme (rewrite `index.css` HSL tokens, white backgrounds, dark text)
- New routes: `/library`, `/settings`, `/login` (same shape, new content)

### 3. New schema (StyleGuide Supabase)

Core tables:

- `assets` — slimmer: `id, relative_path, filename, file_type, file_size, width, height, thumbnail_url, thumbnail_error, modified_at, file_created_at, quick_hash, licensor_id, licensor_name, property_id, property_name, style_guide_id, style_guide_name, tags, ai_description, design_style, ai_tagged_at, ai_model, workflow_status, is_deleted`
- `style_guides` — the depth-2 folder grouping: `id, folder_path, name, licensor_id, property_id, primary_asset_id, primary_thumbnail_url, asset_count, latest_file_date, cover_description, tags`
- `licensors`, `properties` — same shape as PopDAM
- `agent_registrations`, `agent_pairings` — same shape (the bridge pairs separately per tenant)
- `admin_config`, `processing_queue`, `render_queue` — same shape, slimmer
- Auth-mirror table: `user_app_access_cache(user_id, has_access, synced_at)` — populated by an edge function that calls PopDAM auth on login

### 4. Bridge Agent& windows Agent: dual-tenant support

The agents currently have one `SUPABASE_URL` + one `AGENT_KEY`. Make them support N tenants via an array config:

```
TENANTS=[
  { name: "popdam",      url: "...ryltkzzernhwnojzouyb...", key: "...", scan_roots: ["/nas/Designs"] },
  { name: "styleguides", url: "...new-project...",          key: "...", scan_roots: ["/nas/StyleGuides"] }
]
```

- Pairing flow runs once per tenant
- Heartbeat, scan loop, thumbnail generation, upload — all loop over tenants
- DigitalOcean Spaces: same bucket, key prefix per tenant (`thumbnails/popdam/...` vs `thumbnails/styleguides/...`)
- Bump bridge-agent to v2.0.0 (breaking config change)
- New volume mount in `docker-compose.yml`: `/volume1/styleguides:/nas/styleguides:ro`
- `thumbnail/preview generation done only by windows agent`

### 5. Grouping logic (PopSG)

On ingest, derive `style_guide_id` from path:

- `relative_path` = `Disney/Frozen 2024/Characters/Elsa/poses/elsa-skate.png`
- segments[0] = licensor → `Disney`
- segments[1] = property → `Frozen 2024`
- segments[2] = style guide name → `Characters` (the card)
- All deeper segments are metadata (`subfolder_path` = `Elsa/poses`)

A DB function `rebuild_style_guides_batch()` (analogous to `rebuild_style_groups_batch`) groups by `licensor + property + segments[2]`.

### 6. Filters (PopSG)

Keep: search, licensor, property, file type, has-thumbnail status, tag filter, AI workflow status, date range
Add: **style guide name** dropdown, **subfolder** filter (within a selected style guide)
Remove: SKU, MG codes, asset_type, art_source, product_category, division, ERP fields

### 7. AI tagging

Reuse the existing `ai-tag` edge function pattern but with a style-guide-specific prompt focused on art-library descriptors (subject, art style, color palette, mood) rather than product tags.

### 8. Deployment

- Publish the new Lovable project to e.g. `popsg.lovable.app`
- Add custom domain `sg.designflow.app`
- Bridge agent v2 deployed via the existing GHCR pipeline; user updates `docker-compose.yml` once
- if there will be another repo it should be [https://github.com/u2giants/](https://github.com/u2giants/)popsg

## What I need you to specify after seeing this

You said you'd specify field cuts after seeing the plan. Please confirm:

1. Drop everything product/ERP-related as listed above? (workflow_status: keep or drop?) drop all of these
2. The 3 path segments mapping (licensor → property → style guide name) — does that match how your `Style Guides` folder is actually organized on the NAS? If the depth differs, tell me. it's not consistent at all. not consistent between licensors and not consistent within one licensor. we may have to list each folder level/name individually as attributes and a user can delete the irrelevant ones as they browse a product
3. The new app's URL preference (suggested: `sg.designflow.app`)?

## Technical notes

- Cross-Supabase auth verification: StyleGuide edge functions verify JWTs by calling PopDAM's `/auth/v1/user` with the bearer token, then check `app_access` — cached locally for 5min to avoid round-trip on every request.
- The bridge agent's `agent-config.json` becomes an object keyed by tenant name to persist per-tenant pairing keys.
- Light-theme palette: I'll mirror the dark tokens (background, foreground, muted, primary, accent, border) but invert lightness in `src/index.css`. All shadcn components already use semantic tokens, so no per-component changes needed.
- Reusable code lifted from PopDAM (~70% of frontend): `AppLayout`, `AppHeader`, `NavLink`, library grid/list/filters skeleton, agent pairing tab, scan progress panel, downloads page, login/forgot/reset pages.