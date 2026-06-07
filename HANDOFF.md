# Handoff

_Last updated: 2026-06-07 (plan reviewed and gaps resolved)_

Delete this file once all items are done.

---

## Unfinished dev work

### 1. Seafile-aware POP DAM Helper integration

**Goal:** make POP DAM Helper aware of Seafile/SeaDrive as the WFH macOS transport/cache layer, without forking or embedding the Seafile client.

This is the recommended path after the LucidLink/Resilio/JuiceFS review:

- LucidLink is out due to cost.
- Resilio is not currently proven as a direct WFH macOS lock-enforcement client; current Resilio docs are Windows-centric for file-lock enforcement.
- JuiceFS is powerful but would make us operate a custom filesystem platform.
- Seafile/SeaDrive is already running in `u2giants/seafile`, already targets WFH macOS designers, and should be treated as the data transport/cache plane.
- PopDAM/Supabase should remain the workflow, checkout, audit, and policy plane.
- POP DAM Helper is the right local app to make this invisible to designers.

#### Pre-implementation checklist

Before writing any code, resolve these first:

1. **Fix version mismatch.** `apps/popdam-helper/src/shared/constants.ts` has `HELPER_VERSION = "1.1.1"` but `apps/popdam-helper/package.json` says `"version": "1.2.0"`. Reconcile both to the same value in the same commit before the Seafile work bumps the version again.

2. **Add `admin_config` keys.** The Seafile config must be stored in the `admin_config` table and read by `handleGetConfig()` in `supabase/functions/helper-api/index.ts`, exactly like `HELPER_SYNOLOGY_URL`. The keys are:
   - `HELPER_SEAFILE_PREFERRED` — `"true"` / `"false"` — whether Seafile is the preferred source for WFH users
   - `HELPER_SEAFILE_LIBRARIES` — JSON array — library mappings (see section 4 below)
   - `HELPER_SYNOLOGY_FALLBACK_ALLOWED` — `"true"` / `"false"` — whether fallback to Synology is permitted when Seafile is unavailable

3. **Define `source_version`.** In this plan, `source_version` on `asset_checkouts` is the Seafile REST API **file object ID** (`obj_id`) at the time of checkout — a content-addressed hash that the Seafile server assigns when a file version is committed. It lets the check-in flow detect whether the source file was changed on the Seafile server between checkout and check-in (server-side conflict detection). It is distinct from `source_hash`, which is the local SHA-256 of the file bytes. Null for non-Seafile checkouts. Populated by `seafileAdapter.ts` via the Seafile REST API (`GET /api2/repos/{repo_id}/file/detail/?p={path}`).

#### Current Helper state

- `apps/popdam-helper/src/main/checkoutManager.ts` can already start a PopDAM checkout, resolve a local mapped source path, copy the file into a private Helper workspace, open it, watch it, snapshot it, and enqueue check-in upload.
- `apps/popdam-helper/src/main/synologyClient.ts` uploads/downloads through Synology File Station.
- `apps/popdam-helper/src/main/fileOps.ts` handles local workspace copy, stability checks, snapshots, and sidecar metadata. The `CheckoutMeta` interface written to `.pop-checkout.json` lives here.
- `apps/popdam-helper/src/main/config.ts` stores workspace/root mappings.
- `apps/popdam-helper/src/main/rootValidator.ts` validates mapped roots through `.pop-root.json`.
- `apps/popdam-helper/src/main/credentials.ts` stores encrypted tokens using Electron `safeStorage` (`storeToken(account, token)` / `loadToken(account)` — generic by key name).
- `apps/popdam-helper/src/main/localServer.ts` serves `GET http://127.0.0.1:47380/status` — currently returns only `{ ok, version, roots }`.
- There is **no** first-class Seafile/SeaDrive adapter yet.
- The current checkout error already hints at this direction: if a mapped source file is missing, `checkoutManager.ts` says it may not have synced yet and tells the user to check "Seafile or Synology Drive client."

#### Desired product behavior

```text
PopDAM checkout
  -> Helper verifies SeaDrive/Seafile is installed, running, signed in, and mounted
  -> Helper maps PopDAM asset.relative_path to the matching SeaDrive library path
  -> Helper confirms the file is hydrated/current, or triggers hydration and waits
  -> Helper copies the current file into a private PopDAM workspace
  -> User edits the private workspace copy in Photoshop/Illustrator/etc.
  -> Helper snapshots the edited result
  -> Helper checks the file back in through the controlled PopDAM workflow
  -> Seafile handles WAN transfer/background sync
  -> PopDAM verifies final state and releases the checkout
```

#### Important boundary

- Helper should **use and supervise** SeaDrive, not become SeaDrive.
- Do **not** fork Seafile Client.
- Do **not** embed a modified Seafile client in Helper.
- Do **not** let users edit directly in the shared SeaDrive path as the primary workflow.
- Do **not** release a PopDAM checkout just because a local file was handed to SeaDrive; release only after PopDAM has verified the check-in state.

#### Recommended packaging model

- Build a single "POP DAM Designer Tools" installer if desired.
- The installer may install the official SeaDrive/Seafile client and the POP DAM Helper side by side.
- Helper should detect/configure SeaDrive after install.
- Keep SeaDrive updates independent where practical; avoid owning Seafile client patching unless absolutely necessary.
- On macOS, account for notarization/signing for Helper; do not wrap SeaDrive in a way that breaks its own updater/signature.

#### Proposed architecture inside Helper

1. Add `apps/popdam-helper/src/main/seafileAdapter.ts`
   - Detect installed SeaDrive/Seafile client (check known install paths on macOS/Windows).
   - Detect whether the client is running (process name check).
   - Locate the SeaDrive mount root. On macOS the default is `~/SeaDrive`; on Windows `%USERPROFILE%\SeaDrive`. This is what the config stores as `seaDriveRoot` — the top-level mount point, not a library subfolder.
   - Validate expected Seafile libraries are mounted (check for subdirectory existence under `seaDriveRoot`).
   - Map PopDAM root IDs / relative paths to SeaDrive paths using `SeafileLibraryMapping` (library subfolder under `seaDriveRoot`).
   - Check whether a file path exists locally.
   - Trigger hydration by opening/copying/reading the file in a controlled way.
   - Wait for the file to become available and stable.
   - If Seafile REST API credentials are configured (`loadToken("seafile_api_token")`), fetch the file's `obj_id` for `source_version`. If no API token, set `source_version = null`.
   - Return structured status, not strings.

2. Update shared types in `apps/popdam-helper/src/shared/types.ts`

   New types to add:
   - `StorageProvider = "seafile" | "synology" | "local"`
   - `StorageHealth` — `{ provider: StorageProvider; available: boolean; detail?: string }`
   - `SeafileLibraryMapping` — `{ libraryId: string; displayName: string; seaDriveFolder: string; rootId: string }`
   - `HydrationStatus` — `{ state: "local" | "hydrating" | "unavailable"; bytesDone?: number; bytesTotal?: number }`
   - `CheckoutSource` — `{ provider: StorageProvider; localPath: string; seafileObjId?: string }`

   Extend existing interfaces:
   - `RootMapping`: add optional `provider?: StorageProvider` and `seafileLibraryId?: string`. Existing entries default to `provider = "synology"` (no migration needed — these fields are optional).
   - `LocalConfig`: add `seaDriveRoot?: string`, `preferredProvider?: StorageProvider`, `seafileLibraries?: SeafileLibraryMapping[]`.
   - `CheckoutRecord`: add `sourceProvider?: StorageProvider` and `sourceLocalPath?: string` (machine-local, not in DB).
   - `UploadJob`: add `sourceProvider?: StorageProvider` and `seafileObjId?: string`.

   Also update `CheckoutMeta` in `apps/popdam-helper/src/main/fileOps.ts` (the shape written to `.pop-checkout.json` sidecars) to include `source_provider`, `source_local_path`, and optionally `seafile_obj_id`. Update `writeCheckoutMeta()` in `checkoutManager.ts` accordingly.

3. Extend Helper local config (`apps/popdam-helper/src/main/config.ts`)
   - `preferredProvider`: `"seafile"` for WFH users, `"synology"` for office/admin. Defaults to `"synology"` if not set.
   - `seaDriveRoot`: absolute path to the SeaDrive mount point (e.g., `/Users/maria/SeaDrive`). Auto-detected or manually set.
   - `seafileLibraries`: array of `SeafileLibraryMapping`, linking each Seafile library to a PopDAM root ID.
   - Add a setup wizard path for selecting/auto-detecting SeaDrive.
   - Continue supporting existing `rootMappings` so office/Synology workflows do not break.

4. Extend `helper-api /config` in `supabase/functions/helper-api/index.ts`

   `handleGetConfig()` currently reads `HELPER_SYNOLOGY_URL` etc. from `admin_config`. Add reads for the three new keys defined in the pre-implementation checklist above. Return them in the config response:

   ```json
   {
     "seafilePreferred": true,
     "synologyFallbackAllowed": false,
     "seafileLibraries": [
       {
         "libraryId": "abc123",
         "displayName": "Design Hot",
         "seaDriveFolder": "Design_Hot",
         "rootId": "design_hot"
       }
     ]
   }
   ```

   `HELPER_SEAFILE_LIBRARIES` is stored as a JSON string in `admin_config` and parsed by `handleGetConfig()`. Keep secrets out of this response (no Seafile API tokens here).

   **Discovery:** No new discovery mechanism is needed. Helper already fetches config from the edge function via `damClient.ts` → `${damUrl}` → Supabase. The Seafile fields flow through the same path.

5. Update checkout source resolution in `checkoutManager.ts`

   Replace the current single local-root resolution (the `resolveAssetPath` call followed by `existsSync` check) with provider selection:

   1. If `config.preferredProvider === "seafile"` and `seafileAdapter` reports healthy, resolve via `seafileAdapter`.
   2. If the file is not hydrated, trigger hydration and show progress/wait state (IPC events to renderer).
   3. Copy from SeaDrive into the private Helper workspace only after the file is fully local/stable.
   4. If Seafile is unavailable, fall back to Synology **only if** `config.synologyFallbackAllowed === true` (populated from the `helper-api /config` response). If fallback is not allowed, surface a clear error: "Seafile/SeaDrive is unavailable and fallback is not enabled for this account."

   Record `source_provider` and `source_local_path` in `.pop-checkout.json`.

6. Add health/status UI
   - Tray panel should show SeaDrive status:
     - installed / missing
     - running / not running
     - signed in / unknown
     - libraries mounted / missing
     - current file hydrating / ready / failed
   - Settings panel should include Seafile setup:
     - auto-detected root (defaults to `~/SeaDrive`; can be overridden)
     - manual override
     - test mappings
     - open SeaDrive app button if possible
   - Add IPC channels: `"get-storage-health"`, `"test-seafile-mapping"`, `"save-seafile-token"`.

7. Add local HTTP status for the web UI

   `GET http://127.0.0.1:47380/status` currently returns `{ ok, version, roots }` only. Extend it to include:

   ```json
   {
     "storageProviders": {
       "seafile": {
         "available": true,
         "root": "/Users/maria/SeaDrive",
         "libraries": ["Design_Hot", "Artwork_Archive"]
       },
       "synology": { "available": true }
     }
   }
   ```

   Web PopDAM can use this to show "Helper + SeaDrive ready" before checkout.

8. Check-in strategy
   - Short term: keep existing Synology File Station check-in if that remains the authoritative write path.
   - Medium term: evaluate Seafile check-in path:
     - Helper writes/syncs to a controlled Seafile location.
     - PopDAM waits for Seafile server version to reflect the new file.
     - Seafile/NAS sync then back-propagates to NYC NAS or a controlled process applies the change.
   - Do not assume SeaDrive local write completion equals server-side durability.
   - The checkout should stay in `uploading`/`verifying` until PopDAM has server-side evidence that the new version is safe.

9. Server-side verification

   Add or extend `helper-api` routes so Helper can report:
   - provider used
   - source path
   - source hash/size/mtime
   - check-in hash/size
   - Seafile library/path/obj_id if used

   Add DB fields via a new migration (use `apply_migration` MCP; all new columns nullable — no backfill):

   | Column | Type | Notes |
   |--------|------|-------|
   | `source_provider` | `text` | `'seafile'` or `'synology'` or `'local'` |
   | `source_local_path` | `text` | Machine-local path at checkout time (informational) |
   | `seafile_library_id` | `text` | Seafile library UUID |
   | `seafile_path` | `text` | Path within the Seafile library |
   | `source_version` | `text` | Seafile file `obj_id` at checkout (see pre-implementation checklist for definition); null for non-Seafile checkouts |
   | `last_helper_heartbeat_at` | `timestamptz` | Updated on every heartbeat that carries this checkout's ID |

   **Preserve the existing partial unique index** on `(asset_id) WHERE status IN ('active', 'checkin_queued', 'uploading', 'verifying')` — do not modify it in this migration.

   **Heartbeat payload during Seafile hydration:** the heartbeat in `main.ts` currently sends only `{ device_id }`. When a Seafile hydration is in progress for an active checkout, the heartbeat should also include `{ checkout_id, status: "hydrating", hydration_bytes_done: number, hydration_bytes_total: number }`. Extend the `helper-api /heartbeat` route to accept and record this. Update `last_helper_heartbeat_at` on the checkout row at that time.

10. Credentials storage for Seafile REST API

    `credentials.ts` uses a generic `storeToken(account, token)` / `loadToken(account)` pattern. No structural changes are needed. If `seafileAdapter.ts` calls the Seafile REST API to fetch `obj_id` for `source_version`, store the Seafile API token under the key `"seafile_api_token"`. Add a Settings UI input + `"save-seafile-token"` IPC channel. If no token is configured, `source_version` is set to null and the API path is skipped — this is acceptable for the first slice.

11. macOS entitlements review

    `build/entitlements.mac.plist` currently grants `com.apple.security.files.user-selected.read-write` and `com.apple.security.network.client`. SeaDrive root auto-detection reads paths that were not user-selected (e.g., listing `/Users/*/SeaDrive`). Before shipping, evaluate whether these reads work under the current entitlements or require `com.apple.security.files.downloads.read-write` or a `com.apple.security.temporary-exception.files.absolute-path.read-write` exception. Do **not** add `com.apple.security.files.all` — determine the minimal set actually needed. Test on a notarized build before assuming it works.

12. Testing plan
    - Unit test path mapping:
      - PopDAM `relative_path` → Seafile library path
      - root mismatch
      - missing library
      - unsafe path traversal rejection
    - Manual macOS tests:
      - SeaDrive not installed
      - SeaDrive installed but not running
      - signed out
      - library not mounted
      - file cloud-only/hydration needed
      - file fully local
      - network interruption during hydration
      - laptop sleep during checkout
      - Adobe save still in progress at check-in
    - Conflict tests:
      - two users click checkout simultaneously
      - one user edits outside PopDAM
      - source file changes after checkout but before check-in
      - SeaDrive sync completes locally but server has not acknowledged yet
    - Test environment note: a real SeaDrive instance is required for manual tests. Unit tests for path mapping and `seafileAdapter` detection logic should use stubs/mocks for the filesystem and process-list calls so they run offline.

#### Suggested first implementation slice

1. Reconcile version mismatch in `constants.ts` and `package.json` (pre-implementation checklist item 1).
2. Add `seafileAdapter.ts` with read-only detection/path-mapping/hydration wait (no API token required yet).
3. Add Settings UI to detect and test SeaDrive root; wire `"save-seafile-token"` IPC if desired.
4. Modify checkout source resolution to prefer Seafile when configured; enforce `synologyFallbackAllowed` gate.
5. Keep check-in path unchanged initially (Synology File Station), but record `source_provider = "seafile"` in `.pop-checkout.json` and DB.
6. Add local `/status` Seafile health output.
7. Pilot with one macOS WFH machine before changing permissions or default behavior.

#### Related docs/repos

- `future_improvements.md` in this repo: high-level PopDAM checkout/check-in safety plan.
- `docs/POPDAM_HELPER.md`: current Helper architecture.
- `u2giants/seafile/lucid.md`: storage strategy notes; currently recommends PopDAM + Seafile/SeaDrive first for WFH macOS users.
- `u2giants/seafile/synology-seaf-cli/`: current NAS → Seafile ingestion wrapper.

### 2. Auto-update — blocked on code signing certs

`electron-updater` is installed and wired in `apps/popdam-helper/src/main/main.ts`. The `publish` block in `electron-builder.yml` is ready. The only remaining work is external setup:

| Platform | Requirement | Estimated cost |
|----------|-------------|----------------|
| macOS | Apple Developer account ($99/yr) + notarization | Required for Gatekeeper |
| Windows OV cert | SmartScreen warns on first install; updates work silently | ~$60–$150/yr |
| Windows EV cert | No SmartScreen warning, silent updates | ~$300–$500/yr |

**To activate once certs are acquired:**
1. Add these GitHub Actions secrets in `.github/workflows/publish-popdam-helper.yml`:
   - Windows: `CSC_LINK`, `CSC_KEY_PASSWORD`
   - macOS: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
2. Remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from the CI env block in `.github/workflows/publish-popdam-helper.yml`
3. Test auto-update end-to-end on both platforms

Until certs are set up: macOS users must right-click → Open to bypass Gatekeeper on first launch. Windows users see a SmartScreen warning.

### 3. macOS notarization

Same blocker as auto-update (Apple Developer account). Without notarization, Gatekeeper blocks the app on macOS 10.15+. Notarization is a one-time step per release build — it's handled by electron-builder's notarization plugin once the Apple credentials are in CI.

---

## Operational tasks (not dev work, but don't forget)

### PopSG render pass

Windows Agent is on **v0.15.0** with all render fixes deployed. The render backlog hasn't been fully processed yet:

1. **Confirm Windows Agent is on v0.15.0** — check Settings → Agents → Windows Agent version in the UI.
2. **Run Retry All** — PopSG Settings → Files with Render Errors → "Retry All". It loops automatically in 500-file batches.
3. **Queue EPS files** that were previously classified as `unsupported_extension` (not `render_failed`) — these need to be queued, not retried. Use the "Queue All Renderable" button if present, or call `queue_sg_render_jobs_by_ids`.
4. **Check results** with `select * from get_sg_preview_stats()` in Supabase.

Expected unresolvable categories (accept as-is):
- `render_failed` — AI no PDF compat layer (~25 files): Inkscape also fails these
- `missing_file_on_disk` (~3,264): a fresh crawl will mark `is_active = false`
- `unsupported_extension` — ZIP, fonts, video, 3D (~2,076): intentional
- `other_error` — multi-channel non-4-channel TIFF (~30): Sharp limitation
- `other_error` — corrupt JPEG/TIFF (~17): genuinely corrupt files

---

## Resolved — context preserved here

### Style group rebuild timeout on "Compute counts" (resolved 2026-05-26)

**Symptom:** "Start Fresh" rebuild failed at stage 4 with "canceling statement due to statement timeout" after ~33 minutes. UI showed "0 groups".

**Root cause:** `run_full_reconcile_style_group_stats` (called once in stage 4) has no `SET statement_timeout` / `SET lock_timeout`, so it inherits the DB-level role timeout. After a full rebuild it processes thousands of groups in a single UPDATE+JOIN and gets killed.

**Fix:** `apps/worker/src/handlers/style-groups.ts` — both `handleRebuildStyleGroups` stage 4 and `handleReconcileStyleGroupStats` now drive `reconcile_style_group_stats_batch` in batches (100 groups for counts, 25 for primaries). That function has `SET statement_timeout = '120s'`. Worker v1.2.12. Railway auto-deployed.

**Do not revert** to the single `run_full_reconcile_style_group_stats` call in `handleRebuildStyleGroups` or `handleReconcileStyleGroupStats`.

### CI/CD migration (2026-05-15)

The frontend deploy was migrated from SSH-based (`docker run` on VPS) to Coolify API trigger. Key facts that informed the decisions:

- Coolify was already running and had `popdam-frontend` configured as an app (UUID `qxj8a0j3tpa9lq4q5rs6pezy`) — this was confirmed by querying the Coolify DB directly. CI had been bypassing Coolify entirely by SSHing into the server.
- The `sg.designflow.app` routing via Traefik file provider is the correct long-term approach because Coolify's Docker label mechanism only applies the first FQDN in its app config. The file at `/data/coolify/proxy/dynamic/popdam-sg.yml` references the stable service name `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker` — this works across container redeploys.
- The nginx health check failure (`localhost` → `::1` on IPv6 hosts) was a pre-existing bug. Fixed by adding `listen [::]:80;` to `nginx.conf`.

All these details are now documented in `SELFHOST.md` and `docs/KNOWN_QUIRKS.md` (quirks #41 and #42).
