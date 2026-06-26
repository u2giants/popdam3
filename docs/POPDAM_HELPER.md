# POP DAM Helper

The POP DAM Helper is a Windows/macOS Electron desktop app that gives designers a checkout/check-in workflow for source art files. It bridges the web DAM and the local filesystem without requiring designers to manually browse the NAS or handle file conflicts.

---

## How it fits into the system

```
Web DAM (browser)
  │  user clicks "Check Out & Open"
  ▼
helper-api  →  writes helper_tokens row (32-char hex, 5-min TTL)
  │  returns  popdam://checkout?token=X&assetId=Y
  ▼
OS protocol handler  →  opens running Helper
  │
Helper validates token (calls /checkouts/start)
  │  checks for conflicting checkout via unique partial index
  │  creates asset_checkouts row (status: active)
  ▼
Downloads file from Synology NAS
Opens file in native app (Photoshop, Illustrator, etc.)
chokidar watches the file for changes
  │
User edits, saves
  │
User clicks "Check In" in Helper tray popup
  │
waitForFileStable() — polls size+mtime until stable
createSnapshot() — copies file to Snapshots/checkoutId/
/checkouts/prepare-checkin  →  validate hash, get upload path
  │
  ├── Synology/local SMB: temp copy → rename (atomic)
  │       /checkouts/complete-checkin → asset_checkouts: status: complete
  │       Asset unlocked immediately
  │
  └── Seafile upload: uploadQueue sends file to Seafile server
          /checkouts/complete-checkin → asset_checkouts: status: verifying
          Bridge agent (on Synology) polls via claim-checkin-verifications,
          checks on-disk size + quick-hash, calls report-checkin-verification
          → status: complete, asset unlocked
          (T1=30min flag, T2=2h auto-resolve; see AGENTS.md § Seafile verifying)
```

---

## Repository layout

```
apps/popdam-helper/
├── src/
│   ├── main/                   ← Electron main process (Node.js, CommonJS)
│   │   ├── main.ts             ← App entry, startup sequence
│   │   ├── localServer.ts      ← HTTP server on :47380 for fast dir browsing
│   │   ├── protocol.ts         ← popdam:// URL parsing + dispatch
│   │   ├── checkoutManager.ts  ← In-memory checkout state + file watcher
│   │   ├── damClient.ts        ← All helper-api calls
│   │   ├── synologyClient.ts   ← Synology File Station API (upload/download)
│   │   ├── uploadQueue.ts      ← JSON-file upload queue with retries
│   │   ├── fileOps.ts          ← File copy, stability check, snapshot, sidecar
│   │   ├── rootValidator.ts    ← Validates selected workspace vs. .pop-root.json
│   │   ├── credentials.ts      ← OS credential storage via safeStorage
│   │   ├── config.ts           ← JSON config at userData/config.json
│   │   ├── logger.ts           ← Log file at OS-appropriate userData path
│   │   ├── ipc.ts              ← All ipcMain.handle() registrations
│   │   └── tray.ts             ← System tray / menu-bar popup (380×520px)
│   ├── preload/
│   │   └── index.ts            ← contextBridge.exposeInMainWorld("popdam", api)
│   ├── renderer/               ← React UI for tray popup
│   │   ├── TrayPanel.tsx       ← Active checkouts list, status badges, actions
│   │   └── SettingsPanel.tsx   ← DAM URL, workspace, root mappings, Synology creds
│   └── shared/
│       ├── types.ts            ← Shared interfaces (CheckoutRecord, RootMapping, etc.)
│       └── constants.ts        ← HELPER_VERSION, ROOT_MARKER_FILENAME, timeouts, etc.
├── electron.vite.config.ts
├── electron-builder.yml        ← NSIS (Win) + DMG (Mac), popdam:// protocol
├── tsconfig.node.json          ← Main process (CommonJS, ES2022)
├── tsconfig.web.json           ← Renderer (ESNext, DOM)
└── postcss.config.js           ← Empty stub — prevents Tailwind inheritance from monorepo root
```

---

## Localhost HTTP server (port 47380)

The Helper starts an HTTP server bound to `127.0.0.1:47380` on launch. This lets the web DAM's directory browser bypass the cloud bridge agent for local filesystem listings.

**Endpoints:**

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/status` | `{ ok, version, roots[], storageProviders }` |
| `GET` | `/browse?path=X` | `{ ok, path, entries: DirEntry[], listed_at }` |
| `GET` | `/auth/callback` | HTML page; completes the Microsoft OAuth PKCE flow (see Authentication) |
| `POST` | `/editor-event` | `{ ok }`; receives `{ event, path }` from the Photoshop plugin (see Photoshop integration) |

**Path resolution for `/browse`:** `path=""` returns configured root mappings. `path="root_id/sub/dir"` resolves the first segment as a `root_id` against `config.rootMappings`, joins the remainder as a subpath. If the first segment is not a known root ID, the full path is treated as an absolute local path (power-user mode).

**CORS:** Restricted to `*.designflow.app` and `localhost`. Other origins get a 403.

**Port:** Fixed at 47380 (hardcoded in `localServer.ts` and probed in `DirectoryBrowserTab.tsx`). See Known Quirks #32 for why it's fixed rather than dynamic.

**Failure mode:** `EADDRINUSE` logs a warning and the Helper continues — the directory browser falls back to the bridge agent path automatically.

---

## Web DAM integration (`DirectoryBrowserTab.tsx`)

On mount, the component probes `http://localhost:47380/status` with a 2-second timeout:
- **Helper running:** all directory listings go directly to `GET /browse?path=...` — instant response.
- **Helper not running:** existing Supabase Realtime + bridge agent path is used unchanged.
- A green "Local helper" badge appears in the card header when the fast path is active.
- If the Helper crashes mid-session, the next browse call fails, `helperAvailable` is set to `false`, and the component retries via the bridge agent.

---

## Checkout state machine

```
active
  └─► checkin_queued  (user clicks Check In, stability check passes)
        └─► uploading  (file upload in progress)
              └─► verifying  (hash verification)
                    └─► complete  (done)
                    └─► error     (upload or verify failed)
                    └─► conflict  (server-side hash mismatch)
  └─► discarded  (user clicks Discard, or token expires unused)
  └─► error      (any fatal error)
```

The unique partial index on `asset_checkouts(asset_id) WHERE status IN ('active', 'checkin_queued', 'uploading', 'verifying')` enforces one active checkout per asset at a time.

---

## Root validation

The Helper requires each root mapping to have a `.pop-root.json` marker file at the root level. `rootValidator.ts` searches up 2 levels and down 1 level from the chosen folder. If the marker is found at the wrong level, it returns `too_deep` or `too_shallow` with a `suggestedPath`. This prevents users from selecting a subfolder of a mapped root (which would create path mismatches when building upload destinations).

---

## Authentication

The Helper uses two independent credential sets:

### 1. Supabase session (PopDAM account)

Used to call the `helper-api` edge function (checkout tracking, heartbeat, device registration). The user signs in with Microsoft OAuth or the email/password fallback.

**Sign-in flows:**
- On first launch (or after sign-out), the Helper's tray panel and Settings panel show **Continue with Microsoft** plus an email + password fallback.
- Microsoft sign-in opens the user's system browser, redirects back to the Helper's localhost server at `http://127.0.0.1:47380/auth/callback`, exchanges the Supabase PKCE auth code for a session, and stores the access + refresh tokens in the OS keychain via `safeStorage`.
  - ⚠️ **Do not pass a custom `state` to `/auth/v1/authorize`** (`apps/popdam-helper/src/main/oauth.ts`). Supabase GoTrue generates and stores its **own** OAuth state (keyed to a `flow_state` row) and validates it on the provider callback. If the Helper sets its own `state`, GoTrue forwards that string to Microsoft verbatim, then can't find it in its flow store on the callback and fails with **`bad_oauth_state`** ("OAuth state parameter is invalid") — landing the user on the project **Site URL** (`crm.designflow.app`, shared across the apps on this Supabase project) instead of the localhost callback. PKCE (the `code_verifier`) is what binds this flow; no caller `state` is needed. This was the v1.4.1 Microsoft-login bug, fixed in **v1.4.2** (2026-06-25).
- Email/password sign-in calls `ipc:sign-in`, which POSTs to `${supabaseUrl}/auth/v1/token?grant_type=password` with the `apikey` header set to the Supabase anon key.
- The Supabase anon key is **not hardcoded**. It is auto-discovered at sign-in time by fetching `${damUrl}/dam-config.json` (field: `supabase_anon_key`) and saved to `userData/config.json` as `supabaseAnonKey`.

**OAuth users** can use Microsoft directly in the Helper. The "Helper App Password" path remains a fallback for users who cannot use Microsoft OAuth in the desktop app. It calls `supabase.auth.updateUser({ password })`, which attaches email+password auth to the existing OAuth-linked account — same UUID, same email, OAuth continues to work on the web. No new account is created.

### 2. Synology credentials

Used as the fallback path for checked-in files when direct SMB/local copy fails. Entered once in Settings under "Synology Credentials". Stored separately from the Supabase session.

For USA/Synology mode, the Helper first writes checked-in snapshots directly through the configured local NAS folder mapping (`preferredProvider = "synology"`). Each mapping should point at that PopDAM root's actual mounted folder. For example, if the PopDAM path is `Decor/Character Licensed/foo.ai`, the `Decor` mapping should point at the local `Decor` folder, and the Helper writes `Character Licensed/foo.ai` underneath it. On Windows this can be a UNC path such as `\\edgesynology1\share\Decor`; on macOS the same SMB share must be mounted and exposed as a local path such as `/Volumes/Decor`. The write is temp-copy-then-rename so the final asset path is replaced only after the snapshot copy completes. If that local write fails, the upload queue falls back to Synology File Station using the stored Synology credentials.

## Credential storage

Both credential sets are encrypted via `safeStorage.encryptString()` (DPAPI on Windows, Keychain on macOS) and stored as base64 blobs in `userData/credentials.enc.json`. No third-party native module is used. See Known Quirks #29.

---

## Upload queue

Failed uploads are persisted to `userData/upload-queue.json` and retried with exponential backoff (up to 5 attempts, `UPLOAD_MAX_RETRIES`). The queue is processed sequentially — one upload at a time. Progress is reported to the renderer via `setProgressCallback`. See Known Quirks #30.

**Missing Synology credentials fail fast.** A `/credentials? not configured/i` error is not retried 5× — it's marked failed immediately and routed through the failure callback so the user is prompted at once (main opens Settings to the credentials field; see "No silent failures").

---

## SeaDrive library auto-discovery (`seafileAdapter.ts`)

SeaDrive does **not** mount a library in one fixed place. The mount root varies by OS and by the account name chosen at sign-in (Windows: `C:\seadrive\<account>\`, macOS: `~/SeaDrive/<account>/`), and within a mount a library sits under whichever category folder it's shared through: `My Libraries\<lib>`, `Shared with all\<lib>`, `Shared with me\<lib>`, or `Shared with groups\<group>\<lib>`. Non-technical users won't configure exact paths, and the location differs per machine — so the Helper **discovers** it:

- `seaDriveBaseRoots(config)` collects every plausible base mount (the configured `seaDriveRoot`, the platform default + its per-account subfolders, Windows `C:\seadrive\<account>`).
- `findLibraryDir(seaDriveFolder, config)` searches each base: the direct folder, then the known category folders, then `Shared with groups/<group>/`, then a **bounded** breadth-first fallback (depth 3, 400-node cap so a virtual drive can't hang the scan).
- The hit is cached per library in `config.seafileLibraryPaths` (keyed by the library's `seaDriveFolder` name) and re-validated on use, so later checkouts are instant.
- `resolveSeafileTarget` resolves via the discovered library dir (not a hard-coded `<root>/<library>`); if a library genuinely can't be found it throws a clear "library isn't visible in SeaDrive yet" error.

**Why checkout gates on `health.root`, not `health.available`:** `getSeafileHealth().available` is all-or-nothing (true only if *every* configured library is found). `checkoutManager` gates on the mount existing and lets `resolveSeafileTarget` verify the **specific** library the asset needs — otherwise a `Character Licensed` checkout would wrongly fail just because `Generic Decor` isn't synced. (See Known Quirks; the all-or-nothing gate was a bug, fixed 2026-06-25.)

---

## Edit tracking, reminders & quit guard

The risk this addresses: a designer edits a checked-out file for hours and never realizes it isn't on the server (check-in is **explicit** — closing the editor does nothing on its own).

- **Edit detection.** The file watcher (`checkoutManager.watchFile`) watches the checkout's workspace **directory** (depth 0, `atomic: true`), *not* the single file, so editors that save via atomic rename-replace (Illustrator/Photoshop write a temp file then rename over the original) register as a normal **edit** rather than being misread as "file deleted." A real `unlink` is re-confirmed after a 2.5 s delay before the checkout is flagged `error`.
- A save sets `editedSinceCheckout` + `lastEditedAt` on the in-memory `CheckoutRecord`. On restart these are inferred from the workspace file's mtime vs the checkout time.
- **Hourly reminder** (`main.ts` `remindStaleCheckouts`, checked every 10 min): fires a desktop notification only for `active` checkouts that are **edited but not checked in** and whose last edit is >60 min old (re-nags hourly). Untouched checkouts are never nagged — nothing to lose.
- **Quit guard** (`before-quit`): if files are still checked out, quitting is intercepted with a confirm dialog; the wording escalates when any file is edited/uploading/verifying/error ("edits that are NOT on the server yet").
- The tray popup shows an **"Edited — not checked in"** badge distinct from "Checked out".

---

## No silent failures

Failure paths that could otherwise strand a user are surfaced; only self-healing best-effort operations stay quiet (logged). Centralized in `tray.showNotification`.

- **Checkout failure** (`protocol.handleDeepLink`): releases the just-created server lock (so the asset isn't orphaned "checked out") **and** shows a notification with the real reason — never a silent "no files checked out".
- **Permanent upload failure** (`uploadQueue` → `setFailedCallback`): marks the checkout `error`, opens the popup, fires a notification, **and** pops a modal dialog ("Check-in failed — file NOT saved to the server"). For missing Synology credentials it instead opens Settings to the credentials field (highlighted).
- **Proactive startup check** (`warnIfSeaDriveLibrariesMissing`): on the Seafile/WFH path, if SeaDrive isn't found at all — or none of the configured libraries are visible — the user is notified at launch, not only when a checkout fails. (Only warns when *nothing* is found; a user may legitimately have access to just some libraries — Settings shows the per-library breakdown.)
- **Intentionally quiet** (logged only): heartbeat, the optional Seafile `obj_id` lookup, startup checkout-list load, config-save errors. All failures are in the log regardless: `%APPDATA%\popdam-helper\logs\main.log` (Windows) / `~/Library/Logs/popdam-helper/main.log` (macOS).

---

## Photoshop integration (`resources/photoshop-plugin/`)

Optional. Lets Photoshop tell the Helper when a checked-out file is **closed**, so the Helper can offer to check it in immediately. **Photoshop-only** — Illustrator exposes no document-close event to plugins, so it is intentionally not supported.

- **Plugin** (UXP, `resources/photoshop-plugin/`, ships in the installer via `extraResources`): keeps a live map of open `documentID → file path` (refreshed on open/select/save), listens for the `close` event, and POSTs `{ event: "documentClosed", path }` to the Helper at `http://127.0.0.1:47380/editor-event`. Requires PS 23.0+ and declares `network` permission for `http://127.0.0.1:47380`.
- **Helper side:** `localServer` accepts `POST /editor-event` → `setEditorEventCallback`. `main` looks up the active checkout by workspace path (`findCheckoutByWorkspacePath`); if it's `active` **and** edited, it pops a "Check it in now?" dialog and runs `checkin()` on confirm. A `ping` event (empty path) is a no-op used by the panel to show connection status.
- **Install (pilot):** the plugin is **unsigned**, so it can't go through Creative Cloud — load it with Adobe's **UXP Developer Tool** pointed at the bundled `manifest.json`. Settings → "Reveal Photoshop plugin folder" opens the location; full steps in `resources/photoshop-plugin/README.md`. A fully silent auto-install isn't possible for an unsigned UXP plugin.
- **Status:** Helper-side endpoint + wiring are verified by typecheck; the plugin's PS event behavior needs on-device testing (no Photoshop in CI). Introduced Helper v1.4.8.

---

## Build and distribution

See `docs/deployment.md` ("POP DAM Helper (Electron)" / "Bridge Agent Deployment" sections) for the full CI/build/distribution workflow.

Quick reference:
```bash
npm run build          # electron-vite production build → out/
npm run dist:win       # build + electron-builder --win --x64
npm run dist:mac       # build + electron-builder --mac
npm run typecheck      # tsc --noEmit on both tsconfigs
```

---

## Auto-update

The `publish` block in `electron-builder.yml` points to the GitHub release and `main.ts` calls `autoUpdater.checkForUpdatesAndNotify()` after app startup. The updater path uses **`electron-updater`, which only supports the NSIS (Windows) / DMG (macOS) targets** — do **not** switch the Windows target to MSI to solve install/uninstall issues, it would break auto-update.

**Code signing is permanently abandoned — installers stay unsigned forever** (user decision, 2026-06-25). The Apple Developer **Account Holder** cert hurdle (plus a separate Windows OV/EV cert) is too high to justify, so the first-launch Gatekeeper ("right-click → Open") / SmartScreen ("More info → Run anyway") warnings are the **accepted permanent UX**, not pending work. The CI signing wiring (`CSC_LINK`/`CSC_KEY_PASSWORD` + `APPLE_*`) is left dormant only so a future maintainer could revive it. For reference if it ever is (not planned):

| Platform | Requirement | Cost |
|----------|-------------|------|
| macOS | Apple Developer account + notarization | $99/yr |
| Windows (OV cert) | Auto-update works; SmartScreen warns on every install | ~$60–$150/yr (e.g. Certum) |
| Windows (EV cert) | No SmartScreen warning, silent updates | ~$300–$500/yr |

Because installs are unsigned, users may see OS trust warnings and should be prepared to download/reinstall manually from GitHub Releases if auto-update is ever blocked by OS trust policy. See `HANDOFF.md` §5.3.

### Windows uninstall — "NSIS Error: Error launching installer" (Fixed 2026-06-25)

The NSIS uninstaller copies itself to `%TEMP%` and relaunches that copy to delete its own folder; "Error launching installer" means that relaunch failed. A CI bug caused this 100% of the time: the Windows job cached `~\AppData\Local\electron-builder\Cache` — the NSIS **toolchain** that stamps the (un)installer — so a corrupted cache entry shipped a broken uninstaller on every build. Fixed by caching only the immutable Electron binary download, never the toolchain (commit `d7a1133`). **Never cache the electron-builder toolchain dir in CI.** Full writeup + the second possible cause of this error (Windows blocking the unsigned temp copy, which only signing fixes — not relevant here): `docs/KNOWN_QUIRKS.md` #54. To recover an affected machine, just reinstall over the top — the corrected installer writes a fresh, working uninstaller; no manual file deletion needed.
