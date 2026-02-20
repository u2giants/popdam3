

# PopDAM V2 — Implementation Plan

## Overview
PopDAM is a **Design Asset Manager** for a consumer products company that licenses characters (Disney, Marvel, Star Wars, etc.). Design files (.psd/.ai) live on a Synology NAS. A Bridge Agent scans, thumbnails, and uploads to DigitalOcean Spaces. This Lovable web app provides browse/search/filter/tag plus admin controls.

**This plan covers Component A (the Lovable web app + edge functions + database).** Components B (Bridge Agent), C (Windows Render Agent), and D (NAS Manager) are external and built separately.

---

## Phase 1: Foundation — Database & Design System

### 1.1 Dark Theme Design System
- Dark-only theme: background HSL(220, 16%, 12%), amber/gold primary HSL(38, 92%, 55%)
- Semantic CSS variables: `--surface-elevated`, `--surface-overlay`, `--tag-bg`, `--success`, `--warning`, `--info`
- Inter font for UI, JetBrains Mono for paths/code

### 1.2 Database Migrations (strict order)
- **Enums**: `file_type`, `asset_status`, `queue_status`, `asset_type`, `art_source`, `workflow_status`, `app_role`
- **Tables**: `licensors`, `properties`, `characters`, `product_categories/types/subtypes`, `assets` (with `relative_path`, `modified_at NOT NULL NO DEFAULT`, `quick_hash`), `asset_characters`, `asset_path_history`, `processing_queue`, `render_queue`, `agent_registrations`, `profiles`, `user_roles`, `invitations`, `admin_config`
- **Unique constraint**: `(relative_path)` on assets to prevent duplicates
- **Indexes**: btree on key filter columns, GIN on `tags`, pg_trgm on `filename`
- **Functions**: `has_role()` (SECURITY DEFINER), `handle_new_user()` trigger (invitation enforcement), `claim_jobs()` (SKIP LOCKED), `reset_stale_jobs()`, `get_filter_counts()`, `auto_queue_render()` trigger, visibility function
- **RLS policies**: authenticated read on visible assets, admin-only write on config/invitations, role-based access via `has_role()`
- **Seed data**: default `admin_config` entries (THUMBNAIL_MIN_DATE=2020-01-01, SCAN_MIN_DATE=2010-01-01, NAS mapping defaults, Spaces config)

---

## Phase 2: Edge Functions

### 2.1 agent-api
- `verify_jwt = false`, auth via `x-agent-key` validated against `agent_registrations` (hashed)
- All routes with Zod validation
- Routes: `register`, `heartbeat`, `ingest` (with move detection via quick_hash), `scan-progress`, `ingestion-progress`, `queue-render`, `claim-render`, `complete-render`, `claim`, `complete`, `reset-stale`, `set-scan-roots`, `get-scan-roots`, `get-config`, `trigger-scan`, `check-scan-request`, `update-asset`, `move-asset`
- Uses service-role client internally (bypasses RLS)

### 2.2 admin-api
- `verify_jwt = false`, validates JWT via `getClaims()` + `has_role(userId, 'admin')`
- Routes: `get-config`, `set-config`, `invite-user`, `list-invites`, `revoke-invite`, `doctor` (diagnostic bundle), `generate-agent-key`
- Zod validation on all payloads

### 2.3 ai-tag
- Uses Lovable AI gateway with `google/gemini-3-flash-preview`
- Input: thumbnail URL + metadata + taxonomy context
- Features: character verification, style number extraction, image classification, hierarchical tagging, scene description
- Returns structured tags via tool calling

### 2.4 send-invite-email
- Uses BREVO_API_KEY (already configured) to send HTML invitation emails

### 2.5 sync-external
- Upserts licensors, properties, characters, product taxonomy from external APIs using `external_id`

---

## Phase 3: Authentication & Invitation Flow

- **Google OAuth + Email/Password only** (no Microsoft/Azure)
- Login page with Google sign-in button, email/password form, and "Access is by invitation only" note
- `handle_new_user()` trigger enforces invitation-only signup
- Single Supabase client from `@/integrations/supabase/client` — no duplicates
- Protected routes with auth guard, redirect to login if unauthenticated

---

## Phase 4: Main Layout & Navigation

- **AppHeader**: PopDAM logo, nav links (Library, Settings, Downloads), agent status indicator (green/amber/red based on heartbeat), user email + sign out
- **Routing**: `/` (Library), `/settings` (Settings), `/downloads` (Downloads), `/setup` (Setup Wizard, admin-only), `/login`
- Responsive sidebar layout for the library page

---

## Phase 5: Asset Library — Core Browse Experience

### 5.1 TopBar
- Search input (trigram search on filename)
- View toggle: grid / list
- Sort dropdown: modified date, created date, filename, file size
- Filter toggle button with active filter count badge
- Sync button (triggers scan via agent)
- Asset counts display (visible assets only, respecting THUMBNAIL_MIN_DATE visibility)

### 5.2 FilterSidebar (264px, collapsible)
- Faceted filters with server-computed counts from `get_filter_counts()`:
  - File Type (PSD/AI)
  - Status (pending/processing/tagged/error)
  - Workflow Status (all enum values)
  - Licensed (yes/no)
  - Licensor (dynamic list)
  - Property (dynamic list)
  - Asset Type, Art Source
  - Tag filter
- Each facet count excludes its own filter so users see alternative options

### 5.3 AssetGrid
- Server-side paginated (never load all assets)
- 4:3 aspect ratio thumbnail cards with gradient placeholders for missing thumbnails
- Filename, file type badge, workflow status
- Infinite scroll or page-based navigation
- Selection: click, Ctrl/Cmd+Click multi-select, Shift+Click range select

### 5.4 List View
- Table layout with columns: thumbnail, filename, type, status, workflow, licensor, modified date, size

---

## Phase 6: Asset Detail Panel

- 384px slide-in panel from right
- Large thumbnail preview
- All metadata fields: filename, relative path, file type, size, dimensions, artboards
- Path display with 3 modes: Office UNC (hostname), Office UNC (IP), Remote (Synology Drive) — each with copy button
- AI tags display with edit capability
- AI Tag button (calls ai-tag edge function)
- Manual metadata editing (licensor, property, characters, workflow status, asset type, etc.)
- File dates from disk: modified_at, file_created_at, ingested_at
- Path history (from asset_path_history table)
- Quick hash info

---

## Phase 7: Bulk Operations & AI Tagging

- Bulk select assets and trigger AI tagging
- Progress indicator during batch AI tagging
- After tagging completes, auto-switch filter to "Tagged" status
- Manual tag editing (add/remove tags)
- Bulk workflow status change

---

## Phase 8: Settings Page

### 8.1 Synology Drive Setup
- Three methods: paste path, directory picker (browser API), manual text input
- Stores `USER_SYNC_ROOT` in browser localStorage (per-user setting)
- Validation feedback

### 8.2 System Configuration (admin only)
- Read/write `admin_config` key-value pairs via admin-api
- Sections: NAS Mapping (host, IP, share), DigitalOcean Spaces (base URL, endpoint, region, bucket), Dates (THUMBNAIL_MIN_DATE, SCAN_MIN_DATE), AI Settings, Taxonomy Endpoints

### 8.3 Agent Monitoring (admin only)
- Agent status cards: name, type, last heartbeat, online/offline indicator (offline if heartbeat > 2 min)
- Scan counters display: roots_invalid, roots_unreadable, dirs_skipped_permission, files_checked, candidates_found, ingested_new, moved_detected, updated_existing, errors
- Throughput chart (last 60 data points from heartbeat metadata) using Recharts
- Trigger scan button

### 8.4 Invitation Manager (admin only)
- Create new invitation (email + role)
- List pending/accepted invitations
- Revoke pending invitations

### 8.5 Doctor Diagnostics (admin only)
- One-click diagnostic bundle: effective config, agent statuses, last counters, last errors
- Clear display of any misconfigurations

---

## Phase 9: Setup Wizard (`/setup`, admin only)

Interactive step-by-step wizard for first-time Bridge Agent deployment:

1. **NAS Connection** — Collect NAS local IP (for SSH commands only), NAS username
2. **DigitalOcean Spaces** — Collect S3 key, secret, bucket, region, endpoint
3. **Tailscale** — Collect auth key
4. **Agent Key** — Auto-generate 64-char hex key, display once with copy button
5. **Review & Deploy** — Show generated `.env` and `docker-compose.yml` (using `ghcr.io/u2giants/popdam-bridge:latest` with Tailscale sidecar pattern), PowerShell-optimized copy-paste SSH commands

- Progress persisted in `admin_config` under `setup_wizard_state` for cross-session resume
- Clear indication that NAS IP is only for initial SSH setup, not runtime connectivity

---

## Phase 10: Downloads Page

- Card for **Windows Render Agent**: description, GitHub Releases link (`u2giants/popdam3`)
- Card for **Bridge Agent**: description, GHCR pull command (`ghcr.io/u2giants/popdam-bridge:latest`)
- Version info where available

---

## Phase 11: Final Audit & Polish

- Verify single Supabase client (no `src/lib/supabase.ts`)
- Verify no `VITE_SUPABASE_ANON_KEY` references
- Verify all edge functions have `verify_jwt = false` in config.toml
- Verify no hard-coded NAS host/share/path strings
- Verify no `as any` casts
- Verify all pagination is server-side
- Verify all config uses `admin_config` table (no separate config tables)
- Verify no Microsoft/Azure auth code
- Verify visibility logic is consistent across queries, counts, and filters

---

## Technical Notes

- **Backend**: Lovable Cloud (Supabase) for database, auth, edge functions, and secrets
- **AI**: Lovable AI gateway (`google/gemini-3-flash-preview`) for asset tagging — no external API key needed
- **Thumbnails**: Stored in DigitalOcean Spaces (NOT Supabase Storage), URLs stored in `assets.thumbnail_url`
- **Secrets already configured**: BREVO_API_KEY, LOVABLE_API_KEY
- **All timestamps from filesystem**: `modified_at` and `file_created_at` are agent-supplied, never defaulted

