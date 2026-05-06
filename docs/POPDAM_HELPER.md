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
synologyClient.uploadFile() — upload to temp name, rename (atomic)
/checkouts/complete-checkin  →  record final hash, unlock asset
  │
  ▼
asset_checkouts row → status: complete
Asset is unlocked for the next checkout
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
| `GET` | `/status` | `{ ok, version, roots[] }` |
| `GET` | `/browse?path=X` | `{ ok, path, entries: DirEntry[], listed_at }` |

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

## Credential storage

Synology credentials (username, password, SID) are encrypted via `safeStorage.encryptString()` (DPAPI on Windows, Keychain on macOS) and stored as base64 blobs in `userData/credentials.enc.json`. No third-party native module is used. See Known Quirks #29.

---

## Upload queue

Failed uploads are persisted to `userData/upload-queue.json` and retried with exponential backoff (up to 5 attempts, `UPLOAD_MAX_RETRIES`). The queue is processed sequentially — one upload at a time. Progress is reported to the renderer via `setProgressCallback`. See Known Quirks #30.

---

## Build and distribution

See `docs/DEPLOYMENT.md §5` for the full CI/build/distribution workflow.

Quick reference:
```bash
npm run build          # electron-vite production build → out/
npm run dist:win       # build + electron-builder --win --x64
npm run dist:mac       # build + electron-builder --mac
npm run typecheck      # tsc --noEmit on both tsconfigs
```

---

## Auto-update (not yet implemented)

The `publish` block in `electron-builder.yml` points to the GitHub release, which is the prerequisite for `electron-updater`. Auto-update is blocked on code signing:

| Platform | Requirement | Cost |
|----------|-------------|------|
| macOS | Apple Developer account + notarization | $99/yr |
| Windows (OV cert) | Auto-update works; SmartScreen warns on every install | ~$60–$150/yr (e.g. Certum) |
| Windows (EV cert) | No SmartScreen warning, silent updates | ~$300–$500/yr |

Until a cert is purchased, users update by downloading and reinstalling manually from GitHub Releases. To implement once signed: add `electron-updater` to `dependencies`, call `autoUpdater.checkForUpdatesAndNotify()` in `main.ts` after app ready, and set `CSC_LINK` / `CSC_KEY_PASSWORD` secrets in GitHub Actions.
