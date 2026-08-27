# UI Overview

PopDAM is a React + TypeScript single-page application built with Vite, shadcn/ui components, and Tailwind CSS. This document describes every page, panel, and settings tab in the interface.

---

## Application Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `LoginPage.tsx` | Sign-in entry point; redirects signed-in users to `/library` |
| `/library` | `Index.tsx` / `PopSGLibraryPage.tsx` | Main PopDAM asset library, or PopSG style-guide library in PopSG mode |
| `/files` | `FileBrowserPage.tsx` | NAS directory browser (available to all authenticated users) |
| `/styles` | `StylesPage.tsx` | Master Data style tracker table |
| `/settings` | `SettingsPage.tsx` / `PopSGSettingsPage.tsx` | Admin control panel (multiple tabs) |
| `/setup` | `SetupPage.tsx` | First-run wizard for initial configuration (PopDAM mode only) |
| `/downloads` | `DownloadsPage.tsx` | Agent and Helper installer download links (PopDAM mode only) |
| `/login` | `LoginPage.tsx` | Invitation-only sign-in form |
| `/forgot-password` | `ForgotPasswordPage.tsx` | Password reset request form |
| `/reset-password` | `ResetPasswordPage.tsx` | Password update form after reset link |
| `/auth/callback` | `AuthCallbackPage.tsx` | OAuth/SSO callback handler |
| `/privacy` | `PrivacyPolicyPage.tsx` | Public privacy policy |
| `/terms` | `TermsOfServicePage.tsx` | Public terms of service |
| `/settings/ai-tagging-failures` | `AiTaggingFailuresPage.tsx` | AI tagging failure review (PopDAM mode only) |
| `/settings/ai-tagging-detail` | `AiTaggingDetailPage.tsx` | Detail view for AI tagging diagnostics (PopDAM mode only) |
| `/settings/scan-diagnostics` | `ScanDiagnosticsPage.tsx` | Bridge Agent scan history and error details (PopDAM mode only) |

Protected app routes require an authenticated user with at least the `user` role. Public auth/legal routes are available without a session. `/files` is available to all authenticated users, but its bridge-agent fallback uses admin-api and therefore requires an admin session when the local Helper is not running. Settings, setup, scan diagnostics, agent controls, and background-job controls generally require the `admin` role. Exception: `apinilla@popcre.com` can access the Settings -> Reference Data -> Packaging Types editor for the shared `core.packaging_type` lookup.

---

## NAS File Browser (`/files`)

Click-through directory browser available from the top nav. It prefers the local POP DAM Helper for fast local filesystem browsing when the Helper is running and has roots configured. If the Helper is not available, it falls back to the bridge-agent directory-browse flow, which is admin-only because it uses `admin-api`.

**How it works:** The UI first probes `http://localhost:47380/status`. When the Helper is present, browse requests call `http://localhost:47380/browse?path=...`. Otherwise the UI posts a `request-dir-browse` action to admin-api with a path, which writes a `DIR_BROWSE_REQUEST` key to `admin_config`. The bridge agent picks this up on its next heartbeat (within 30s), lists the directory, and posts results back via `report-dir-browse`. The UI polls `get-dir-browse-result` until the `request_id` matches.

- Empty path = lists configured scan roots
- Click any folder to navigate into it
- Back and home buttons for navigation
- Shows file sizes and modification dates for regular files
- Implemented in `src/components/settings/DirectoryBrowserTab.tsx` (the component) and `src/pages/FileBrowserPage.tsx` (the page wrapper)

---

## Main Library Page (`/`)

The library is the primary working view. It has two top-level modes selectable from the toolbar:

- **Groups mode** — browses assets by style group (one card per SKU). This is the default.
- **Assets mode** — browses individual files regardless of group membership.

Within each mode, two display layouts are available:

- **Grid** — thumbnail cards
- **List** — compact tabular rows

### Library Top Bar (`LibraryTopBar.tsx`)
Persistent control bar at the top of the library:
- **Search box** — full-text search on filename and tags
- **Filter toggle** — shows/hides the left filter sidebar
- **Mode toggle** — Groups / Assets
- **View menu** — a single dropdown holding **both** Grid / List (section "Layout")
  and, in Groups + Grid only, the card style Gallery / Editorial / Compact
  (section "Card style"). These were two separate controls until 2026-07-29; the
  standalone Grid/List segmented control is gone at every screen size. Do not
  reintroduce it — it was what forced the toolbar to wrap onto a second row.
- **Sort control** — sort field and direction (e.g. modified_at, SKU, workflow_status)
- **Sync button** — admin-only; triggers a Bridge Agent scan
- **Refresh button** — reloads the current query
- **Scan status pill** — admin-only; shown while a scan is running or stale

The header agent-status pill and the library scan controls are visible only for real admins. Regular users can browse/search/filter without issuing bridge-agent status or scan-control requests.

In **Groups** mode, the displayed group count comes from `useStyleGroupCount`, and the displayed file count is the sum of `style_groups.asset_count` for the same filtered group set (`useStyleGroupAssetCount`). The page intentionally does not run the all-assets list query while Groups mode is active; that query is only needed in Assets mode and can time out when a group-only filter expands to path-based legacy matches.

### Compact Chrome (short or narrow viewports)

Added 2026-07-29 (commit `fb0b13b`) because at 1920x1200 the stacked chrome —
app header, library toolbar, grid/list toggle row, bulk-action bar — consumed
~208px of vertical space before a single asset card was visible, and the detail
flyout's 16:10 hero left its own tab content with no scrollable height.

The switch is **`useCompactChrome()`** in `src/hooks/use-compact-chrome.ts`,
which is a `useMediaQuery` over `COMPACT_CHROME_QUERY`:

```
(max-height: 1300px), (max-width: 1700px)
```

Note it is primarily a **height** query, not the usual width breakpoint — the
problem being solved is vertical, and 1920x1200 is wide but short. A 2560x1440
monitor (viewport ~1320px tall) stays in the roomy layout.

What compact mode changes:

| Area | Compact | Roomy |
|---|---|---|
| `AppHeader.tsx` nav | Sell-through / Master Data / Setup collapse into a **More** dropdown (`SECONDARY_NAV_LABELS`) | all seven items flat |
| Header height | `h-12` | `h-14` |
| Build stamp | commit sha only (date in `title`) | sha + formatted date |
| Mode toggle labels | "Style groups" / "All files" wrap to two lines inside the same control height | one line |
| Control height (`H`) | 30px | 34px |
| Scan pill | dot + found count + stop button; elapsed time and all counters move into the tooltip | "Scanning 1:26 · 119,130 found" |
| Selection controls | `BulkActionBar variant="inline"` folded into `LibraryTopBar` via its `selectionSlot` prop, replacing the result-count readout | its own full-width row below the toolbar |
| Detail panel hero | capped at `26vh` | 16:10 (asset panel: 300px when wide) |

Two traps when editing this:

- **Header height is a CSS variable, not a Tailwind literal.** `--pd-header-h`
  is defined in `src/index.css` (`3.5rem`, overridden to `3rem` inside the same
  media query) and consumed by the page shells in `Index.tsx` and
  `StylesPage.tsx` as `h-[calc(100vh-var(--pd-header-h))]`. The old hardcoded
  `h-[calc(100vh-3.5rem)]` is gone. **If you change `COMPACT_CHROME_QUERY` you
  must change the matching `@media` block in `index.css` too** — they are
  duplicated by necessity (a TS constant cannot drive a CSS media query) and
  drift there produces a page shell that is 8px too tall or short.
- **`LibraryTopBar.tsx` is inline styles, not Tailwind.** Responsive prefixes
  like `md:` do not work in it; that is why sizing goes through the `H` constant
  and `compact` ternaries rather than utility classes.

### Filter Sidebar (`FilterSidebar.tsx`)
Faceted filter panel that appears on the left side. Filters include:
- Licensor
- Property
- Workflow status
- Asset type
- File type (PSD/AI)
- Is licensed flag
- Tag search
- Date range (modified_at or file_created_at)

All filter counts update live as other filters change.

The panel is **drag-to-resize**: the handle on its right edge takes it from
180px to 520px, the chosen width is remembered per browser in `localStorage`
(`library-filter-sidebar-width`), and double-clicking the handle resets it to
the 214px default. Labels and dropdown values get a native tooltip **only while
their text is actually cut off**, measured live from `scrollWidth` vs
`clientWidth`, so tooltips disappear once the panel is wide enough.

**This panel must not use Radix `ScrollArea`.** Its `display: table` wrapper is
sized by max-content, which made the column wider than the panel and pushed
open dropdowns off the left edge of the screen — see KNOWN_QUIRKS §73.

The Product Category filter uses `product_category` when present. For **Wall**, it also treats legacy folder signals such as `WALL ART` and `3FZ` as Wall matches because older framed 3D wall-art SKUs may predate complete ERP category enrichment.

### Scan Monitor Banner (`ScanMonitorBanner.tsx`)
A collapsible progress bar that appears when a Bridge Agent scan is active. Shows:
- Files checked, ingested, moved, errors
- Current path being scanned
- Agent name and scan session ID
- Elapsed time

### Style Group Grid / List
- **`StyleGroupGrid.tsx`** — 4-column responsive grid of cards. Each card shows the primary asset's thumbnail, SKU, asset count, licensor + property name, workflow status badge, and designer conflict badge if applicable.
- **`StyleGroupListView.tsx`** — Compact tabular list with the same fields.

Clicking a card selects it and opens the Style Group Detail Panel on the right.

### Asset Grid / List
- **`AssetGrid.tsx`** — thumbnail grid, one card per file
- **`AssetListView.tsx`** — tabular list with filename, path, status, dates

Clicking a card selects it and opens the Asset Detail Panel on the right.

### Pagination Bar (`PaginationBar.tsx`)
Shows current page, total records, and navigation buttons. Page size is 200 items.

### Bulk Action Bar (`BulkActionBar.tsx`)
Appears when one or more groups are selected (multi-select via checkbox). Provides:
- Select all on current page
- Bulk tag (run AI tagging on all selected groups)
- Bulk workflow status change

Has two presentations, chosen by the `variant` prop (default `"bar"`):
- **`"bar"`** — its own full-width row with the primary-tinted background, below
  the toolbar. Used on roomy viewports.
- **`"inline"`** — chrome-less, shorter controls (`h-7`), abbreviated "N sel."
  badge, no `ArrowRightLeft` icon, narrower progress bar. Rendered *inside*
  `LibraryTopBar` through its `selectionSlot` prop on compact viewports, where it
  takes the place of the result-count readout. See "Compact Chrome" above.

`Index.tsx` picks the variant from `useCompactChrome()` and renders exactly one
of the two — never both.

---

## Detail Panel Layout, Resizing & Responsiveness

Both detail panels (`AssetDetailPanel.tsx`, `StyleGroupDetailPanel.tsx`) share one
resize/responsive contract, orchestrated from `Index.tsx` via the
`useResizablePanel.ts` hook. Non-obvious details worth knowing before editing:

- **The panel width is a prop, not a hardcoded class.** Both panels take a `width`
  prop (default `408`) and set their own inline width from it. The old hardcoded
  `w-[408px]` / `width: 408` is gone — do not reintroduce it.
- **Draggable divider, desktop only.** At `≥1400px` the panel is docked
  side-by-side and a drag handle sits between the list and the panel; below
  `1400px` the panel overlays absolutely (as before) and the handle is not
  rendered. The `1400px` breakpoint matches the existing `max-[1399px]:` overlay
  classes — keep the two in sync if either changes.
- **Width is clamped and persisted.** Range is `[360, 960]` px, saved to
  `localStorage` under key **`pd-detail-panel-width`**. Double-clicking the handle
  resets to `408`. The list keeps a `min-w-[400px]` floor and the panel wrappers
  are `shrink-0` so the dragged width is honored and the list absorbs the squeeze.
- **Content reflows into two columns when wide.** Above `width ≥ 620` (`WIDE_THRESHOLD`
  in each panel) the scrollable content switches from a single vertical stack to a
  two-column CSS multi-column layout (`break-inside-avoid` per section), the
  single-stack `<Separator />` dividers are hidden, and the hero image is capped
  at 300px tall. If you add a new section, keep it as a direct child of the
  content container so the column flow and break rules apply to it.
- **The hero is capped on short viewports.** When `useCompactChrome()` is true
  both panels cap the hero at `maxHeight: 26vh` (this wins over the asset panel's
  `wide ? 300` rule). Without the cap a 16:10 hero plus the thumbnail strip and
  title block filled the panel on a 1200px-tall screen and the tab content below
  never received enough height to scroll — the reported "can't see any details or
  a scroll bar" bug. The images are `object-contain`, so breaking the aspect ratio
  letterboxes rather than crops. `StyleGroupDetailPanel` also shrinks the
  thumbnail strip (`h-7`), SKU/title type, and tab padding in compact mode.

Shipped 2026-07-02 (commit `5c266f83`). Frontend-only; no DB/backend involvement.
Compact-viewport hero cap added 2026-07-29 (commit `fb0b13b`), also frontend-only.

## Style Group Detail Panel (`StyleGroupDetailPanel.tsx`)

Opens on the right side when a style group is selected. Contains the following sections:

### 1. Header
Group SKU, licensor + property name, close button. Workflow status badge.

### 2. Primary Asset Carousel
Thumbnail carousel showing all non-deleted member assets. Click to expand to full-screen lightbox. Badges show which asset is the current primary.

### 3. Group Metadata
- Folder path (with copy button)
- Asset count
- Latest file date
- Is licensed flag

### Group Artwork Summary
A product-level description built from several representative member files, shown
above (and distinct from) the per-file "AI Analysis · This file" section. Its
tooltip names the source and model that produced it.

### Refresh Group Metadata
Replaces the former "Sync Tags to All Group Members" button. It brings the group's
shared product facts and its search entry up to date. It does **not** copy tags
between files — individual file tags are left alone. The bulk equivalent is the
`refresh-group-metadata` operation in Settings; the old `propagate-group-tags`
key still works as a deprecated alias that runs the same safe refresh.

### 4. Licensing & Taxonomy
- Licensor name / code
- Property name / code
- Product category
- Division / MG01–MG06 codes and names
- Size code / name

### 5. Designer Information
- Designer name
- Technical designer name
- Freelancer name
- Designer conflict warning if members disagree

### 6. Cover Description
AI-generated product description from the primary asset. Displayed as read-only text.

### 7. AI Tags
All tags associated with the primary asset (`asset_tags` where `source = 'ai'`). Displayed as tag chips. Tags marked as "file-specific" (front view, mockup, etc.) are visually distinguished.

### 8. Characters
Character associations from `asset_characters`, showing character name and property.

### 9. AI Analysis Detail
Full AI analysis output from the primary asset: `ai_description`, `scene_description`, `big_theme`, `little_theme`, `design_style`.

### 10. Asset List
Scrollable list of all member assets with filename, file type, thumbnail status, and AI tagging status. Clicking an asset opens its individual detail view.

Each row leads with a 36x36 preview: the asset's `thumbnail_url` rendered as an
`object-cover` image when one exists, falling back to the colored file-type tile
(`fileTypeTileClass`) when it does not. Rows therefore mix images and tiles —
that is intended, not a rendering bug.

### 11. Path Information
Full NAS paths derived from `relative_path` + config:
- Network path by hostname (`\\NAS_HOST\SHARE\...`)
- Network path by IP (`\\NAS_IP\SHARE\...`)
- Synology Drive path

Each path has a copy-to-clipboard button.

### 12. Sibling File Finder (`FindAlternativeImages` component)
Allows discovery and ingestion of sibling JPG, PNG, and eligible PDF files that sit in the same NAS folder as the group's design files but haven't been ingested yet (photography, renders, mockups, or useful PDFs).

**Flow:**
1. Click "Find Sibling Files" — calls `list-sibling-images`, which either returns a recent completed result or creates a `sibling_scan_request_*` row in `admin_config`.
2. UI polls `get-sibling-scan-result` for results. The request may be `pending` or `claimed` while the Bridge Agent works.
3. If a request stays `claimed` for more than 10 minutes, the admin API marks it failed so the UI can show a retryable error instead of waiting forever.
4. Results list shows thumbnails of discovered files with filename and file size.
5. User selects desired files and clicks "Ingest Selected".
6. Selected files are ingested as new assets and linked to the current style group via `ingest-sibling-images`.

Do not remove the stale-claim expiry/reclaim path. It prevents a Bridge Agent restart or mid-scan exception from permanently blocking future sibling scans for the same folder.

---

## Asset Detail Panel (`AssetDetailPanel.tsx`)

Opens on the right side when an individual asset is selected. Shows:
- Thumbnail (full-size expandable)
- Filename and relative path
- File type, file size, dimensions, artboards
- Timestamps: `modified_at`, `file_created_at`, `ingested_at`, `ai_tagged_at`
- Licensor + property assignment
- Workflow status selector (editable)
- **Tags in two scopes** — see "Scoped metadata" below
- Characters
- Quick hash (for debugging)
- Network path links

---

## Scoped metadata: "Style Group" vs "This file"

Both detail panels render tags through `ScopedTagSections.tsx`, fed by
`useEffectiveAssetTags.ts`, which reads the governed contract
`public.get_effective_asset_metadata`.

**Style Group** — facts shared by every file of the product: licensor, property,
product type, the authoritative item description, and supported artwork themes.
These rows live once on `style_group_tags` and are **never copied onto member
assets**. Before issue #96 they were copied, which is how a technical drawing
ended up tagged "professional photography, 3/4 view, blue".

**This file** — facts about the one file: its kind, view, visible characters,
colours, scene, readable text, placement. These live on `asset_tags`.

Behavior a reader should be able to rely on:

- **Editing defaults to "This file."** Adding a shared product fact requires
  deliberately choosing "Whole Style Group", so a group fact can never be created
  by accident while someone tidies one image.
- **Candidates are shown separately** ("Suggested — confirm to make searchable").
  An AI group fact only becomes active on its own at >= 0.85 confidence with two
  distinct member files as evidence; everything else waits for a person.
- **Removing an AI fact writes a rejected tombstone**, so a later AI run cannot
  reinstate it. Removing a *manual* fact deletes only that manual fact.
  Rejected facts are listed while editing and can be restored.
- **A fact from Master Data cannot be rejected here.** It has no remove control
  and the server refuses it; it changes when Master Data changes.
- **Every chip carries its source** in a tooltip — Manual, Master Data, ERP,
  Rich PDF, Group AI, File AI, Legacy (unscoped) — plus category, model, and
  confidence where they help review.
- **A file with no usable preview** says "Visual analysis unavailable" instead of
  appearing untagged, and remains findable through its Style Group.

Server side, all four actions go through `admin-api` (`add-scoped-tag`,
`remove-scoped-tag`, `review-scoped-tag`) which authenticate the caller and record
provenance: `created_by` for a manual add, `rejected_by`/`rejected_at` for a
rejection, and reviewer/decision/timestamp in the row's `evidence` for an approve
or demote.

---

## Settings Page (`/settings`)

The settings page is an admin-only control panel organized into tabs.

### Tab: Reference Data
- **Packaging Types** (`PackagingTypesTab.tsx`) edits the shared `core.packaging_type` lookup owned by `u2giants/shared-db`.
- Visible to PopDAM admins and to `apinilla@popcre.com`.
- Supports add, edit, active/inactive status, refresh, and remove. New rows set `metadata.source = "popdam_settings"`.
- The matching database table/RLS lives in shared-db migration `20260709144500_core_packaging_type.sql`; keep UI access rules and RLS aligned if more non-admin maintainers are added.

### Tab: Storage
Configures DigitalOcean Spaces connection (bucket, region, endpoint, public base URL). Also sets `SCAN_MIN_DATE` and `THUMBNAIL_MIN_DATE`.

### Tab: Agents (Bridge)
- Lists registered Bridge Agents with online/offline status and last heartbeat time.
- Shows last scan counters (files checked, ingested, errors).
- Buttons: Trigger Scan, Stop Scan, Resume Scanning, Reset Scan State, Revoke Agent.
- **Live Scan Monitor** (`LiveScanMonitor.tsx`) — real-time progress bar during active scans.
- **Agent Update** — check for new Bridge Agent Docker image versions and trigger an update.
- **Install Bundle** — generate a ZIP with pre-configured `.env` + `docker-compose.yml` for new agent setup.

### Tab: Windows Agent
- Lists registered Windows Render Agents.
- Render queue statistics (pending, claimed, completed, failed).
- List render jobs with requeue / clear controls.
- Check for updates, trigger update.
- Install bundle generation for Windows Agent.

### Tab: AI Tagging
- Configure AI tagging instructions (custom prompt additions stored in `admin_config`).
- Legacy taxonomy endpoint fields and sync controls remain visible, but
  `sync-external` was retired on 2026-07-23 and returns HTTP 410. They no longer
  populate licensors, properties, or `public.characters`; see
  `docs/SCHEMA.md` §2.3 for the character catalog's verified and unverified
  source lineage.
- Untagged asset count and AI tagging controls (tag untagged / tag all).
- Tag propagation controls.
- Vision Bake-Off for comparing five OpenRouter vision models against the same
  production Image Tagging contract. The result matrix shows tags,
  descriptions, characters, property, human winner picks, latency, token usage,
  estimated cost, output mode, retry count, and best-effort provider/endpoint
  metadata. The Provider Patterns strip aggregates success/failure counts by
  model + endpoint for the selected run.

### Tab: ERP Enrichment
- **Sync section:** Configure ERP API credentials, trigger sync (full or incremental), view last 10 sync run history.
- **Enrichment controls:** Run dry-run to preview changes, apply enrichment, view stats.
- **Category review queue:** Paginated table of product category predictions. Review, approve, or reject individual or bulk predictions.
- **ERP item browser:** Search and browse all items in `erp_items_current`. Dismiss irrelevant items.

### Tab: File Hygiene
- **Hygiene findings list:** Table of open findings by check type (`ai_embedded_raster`, `tiff_uncompressed`, `psd_oversized_layer`), with severity and file path. Actions: dismiss, mark resolved.
- **Scan controls:** Select check types and trigger hygiene scan, stop active scan.

### Tab: TIFF Optimization
- **TIFF file list:** Table of all files in `tiff_optimization_queue` with size, compression type, and status. Filter by status and compression type.
- **Queue controls:** Select files and queue for test-mode or process-mode compression.
- **Delete originals:** After successful compression, queue original files for deletion.
- **Scan controls:** Trigger TIFF scan, clear scan data, refresh file dates.

### Tab: Operations
Bulk operation launcher and status dashboard. Displays all operations from `admin_config.BULK_OPERATIONS`:
- Current status (running / queued / interrupted / completed / failed)
- Progress counters
- Last error
- Auto-resume attempts remaining
- Start / Stop / Resume controls
- Interruption reason and timestamp

Operations available:
- AI Tag Untagged
- Re-tag Everything (AI Tag All)
- AI Tag Groups
- Propagate Group Tags
- Rebuild Style Groups
- Reconcile Stats
- Reprocess Metadata
- Backfill SKU Names
- ERP Enrichment
- ERP Classify

See `docs/BULK_JOBS.md` for full operation documentation.

### Tab: Users
- List all users and their roles.
- Pending and accepted invitations list.
- Invite new user (by email + role).
- Revoke pending invitations.

### Tab: Diagnostics
- **Doctor panel:** Full system health check. Shows effective config, agent status, last error summary.
- **Database inspector:** Run read-only SQL queries via `run-query` action.
- **Character stats:** Rebuild character usage statistics.
- **ColdLion debug:** Test ColdLion merchandise group code lookups.
- **Path test:** Request the Bridge Agent to validate configured NAS path mappings.
- **Repair tools:** Repair invalid property names.

---

## Workflow Status Values

The `workflow_status` enum controls the production lifecycle stage of an asset/group. Valid values:

| Value | Display Label | Meaning |
|-------|--------------|---------|
| `product_ideas` | Product Ideas | Early ideation, not yet approved |
| `concept_approved` | Concept Approved | Concept sign-off received |
| `in_development` | In Development | Active design work |
| `freelancer_art` | Freelancer Art | Sent to external artist |
| `discontinued` | Discontinued | No longer in production |
| `in_process` | In Process | Manufacturing/production stage |
| `customer_adopted` | Customer Adopted | Sold to a retail customer |
| `licensor_approved` | Licensor Approved | Final licensor sign-off received |
| `other` | Other | Default / unclassified |

---

## Bulk Job Conflict Detection (UI Layer)

Every settings tab that can start a bulk job uses a `requestOp` function before calling any start/queue action. This function is the UI-level first line of defence against concurrent conflicting operations.

### How `requestOp` works

1. Fetches the current `BULK_OPERATIONS` state from `admin_config`.
2. Checks for **same-lane conflicts**: another op in the same lane (`OP_LANES`) that is `running` or `queued`.
3. Checks for **cross-lane conflicts**: any op listed in `OP_CONFLICTS` for the requested op that is `running` or `queued`. The frontend `OP_CONFLICTS` map is in `src/components/settings/diagnostics/types.ts` — it mirrors the backend copy in `supabase/functions/_shared/operation-constants.ts`.
4. If a conflict is found: shows a **ConflictDialog** explaining which op is blocking, and offering to **Queue** the new op to start automatically once the conflict clears.
5. If no conflict: calls `startFn()` immediately.

### `isQueued` in disabled checks

Operation buttons are disabled when `anyActive = isActive || isQueued` (for each relevant op). `isActive` = `status === "running"`, `isQueued` = `status === "queued"`. Both must be checked because after clicking a button, the job enters `"queued"` status for up to 60 seconds before pg_cron promotes it to `"running"`. Without the `isQueued` check there is a window where a second button can be clicked, launching two conflicting jobs simultaneously.

### Where conflict detection lives

| Location | What it checks | What it does when blocked |
|----------|---------------|--------------------------|
| `AiTaggingTab.tsx` → `requestOp` | Same-lane + cross-lane (running or queued) | Shows ConflictDialog with Queue option |
| `OperationsTab.tsx` → `requestOp` | Same-lane + cross-lane (running or queued) | Shows ConflictDialog with Queue option |
| `bulk-job-runner` queue promotion | Cross-lane (running only) | Defers — retries next pg_cron tick |
| `bulk-job-runner` auto-resume | Cross-lane (running only) | Defers — retries next pg_cron tick |
| `admin-api` `update-bulk-op` | Cross-lane (running only) | Returns HTTP 409 |

See `docs/BULK_JOBS.md` for the full conflict map and enforcement details.

---

## Key React Hooks

| Hook | Purpose |
|------|---------|
| `useStyleGroups` | Fetches style groups with filtering, sorting, pagination |
| `useStyleGroupCount` | Total group count matching current filters |
| `useStyleGroupAssetCount` | Sum of `style_groups.asset_count` across the current filtered group set |
| `useUngroupedCount` | Count of assets not in any group |
| `useTotalAssetCount` | Total visible asset count |
| `useAssets` | Fetches individual assets with filtering |
| `useFilterOptions` | Available filter facet values |
| `useFilterCounts` | Per-facet item counts for the filter sidebar |
| `useAgentStatus` | Bridge Agent online/offline + last heartbeat |
| `useScanProgress` | Current scan session counters |
| `useScanLifecycle` | Manages scan start/stop/progress polling |
| `useSelectionManager` | Multi-select state for bulk actions |
| `useBulkOperations` | Current state of all bulk operations from admin_config |
