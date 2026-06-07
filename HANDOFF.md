# Handoff

_Last updated: 2026-06-07_

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

Current Helper state:

- `apps/popdam-helper/src/main/checkoutManager.ts` can already start a PopDAM checkout, resolve a local mapped source path, copy the file into a private Helper workspace, open it, watch it, snapshot it, and enqueue check-in upload.
- `apps/popdam-helper/src/main/synologyClient.ts` uploads/downloads through Synology File Station.
- `apps/popdam-helper/src/main/fileOps.ts` handles local workspace copy, stability checks, snapshots, and sidecar metadata.
- `apps/popdam-helper/src/main/config.ts` stores workspace/root mappings.
- `apps/popdam-helper/src/main/rootValidator.ts` validates mapped roots through `.pop-root.json`.
- There is **no** first-class Seafile/SeaDrive adapter yet.
- The current checkout error already hints at this direction: if a mapped source file is missing, `checkoutManager.ts` says it may not have synced yet and tells the user to check "Seafile or Synology Drive client."

Desired product behavior:

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

Important boundary:

- Helper should **use and supervise** SeaDrive, not become SeaDrive.
- Do **not** fork Seafile Client.
- Do **not** embed a modified Seafile client in Helper.
- Do **not** let users edit directly in the shared SeaDrive path as the primary workflow.
- Do **not** release a PopDAM checkout just because a local file was handed to SeaDrive; release only after PopDAM has verified the check-in state.

Recommended packaging model:

- Build a single "POP DAM Designer Tools" installer if desired.
- The installer may install the official SeaDrive/Seafile client and the POP DAM Helper side by side.
- Helper should detect/configure SeaDrive after install.
- Keep SeaDrive updates independent where practical; avoid owning Seafile client patching unless absolutely necessary.
- On macOS, account for notarization/signing for Helper; do not wrap SeaDrive in a way that breaks its own updater/signature.

Proposed architecture inside Helper:

1. Add `apps/popdam-helper/src/main/seafileAdapter.ts`
   - Detect installed SeaDrive/Seafile client.
   - Detect whether the client is running.
   - Locate likely SeaDrive roots on macOS and Windows.
   - Validate expected Seafile libraries are mounted.
   - Map PopDAM root IDs / relative paths to SeaDrive paths.
   - Check whether a file path exists locally.
   - Trigger hydration by opening/copying/reading the file in a controlled way.
   - Wait for the file to become available and stable.
   - Return structured status, not strings.

2. Add shared types in `apps/popdam-helper/src/shared/types.ts`
   - `StorageProvider = "seafile" | "synology" | "local"`
   - `StorageHealth`
   - `SeafileLibraryMapping`
   - `HydrationStatus`
   - `CheckoutSource`

3. Extend Helper config
   - Add preferred source provider: `seafile` first for WFH users, `synology` fallback for office/admin use.
   - Add `seaDriveRoot` and per-library mappings.
   - Add a setup wizard path for selecting/auto-detecting SeaDrive.
   - Continue supporting existing root mappings so office/Synology workflows do not break.

4. Extend `helper-api /config`
   - Return Seafile library metadata needed by Helper:
     - library name
     - Seafile library UUID
     - PopDAM root segment / NAS source path
     - expected SeaDrive folder name
     - whether Seafile is the preferred source
   - Keep secrets out of this response.

5. Update checkout source resolution
   - In `checkoutManager.ts`, replace the current single local-root resolution with provider selection:
     1. If Seafile is configured and healthy, resolve via `seafileAdapter`.
     2. If the file is not hydrated, trigger hydration and show progress/wait state.
     3. Copy from SeaDrive into the private Helper workspace only after the file is fully local/stable.
     4. If Seafile is unavailable, allow explicit fallback to Synology/File Station only if configured/admin-approved.
   - Record source provider and source path in `.pop-checkout.json`.

6. Add health/status UI
   - Tray panel should show SeaDrive status:
     - installed / missing
     - running / not running
     - signed in / unknown
     - libraries mounted / missing
     - current file hydrating / ready / failed
   - Settings panel should include Seafile setup:
     - auto-detected root
     - manual override
     - test mappings
     - open SeaDrive app button if possible

7. Add local HTTP status for the web UI
   - Extend `GET http://127.0.0.1:47380/status` to include storage health:
     - `storageProviders`
     - `seafile.available`
     - `seafile.root`
     - `seafile.libraries`
   - Web PopDAM can use this to show "Helper + SeaDrive ready" before checkout.

8. Check-in strategy
   - Short term: keep existing Synology File Station check-in if that remains the authoritative write path.
   - Medium term: evaluate Seafile check-in path:
     - Helper writes/syncs to a controlled Seafile location.
     - PopDAM waits for Seafile server version to reflect the new file.
     - Seafile/NAS sync then back-propagates to NYC NAS or a controlled process applies the change.
   - Do not assume SeaDrive local write completion equals server-side durability.
   - The checkout should stay in `uploading`/`verifying` until PopDAM has server-side evidence that the new version is safe.

9. Server-side verification
   - Add or extend `helper-api` routes so Helper can report:
     - provider used
     - source path
     - source hash/size/mtime
     - check-in hash/size
     - Seafile library/path/version if used
   - Add DB fields if needed:
     - `asset_checkouts.source_provider`
     - `asset_checkouts.source_local_path`
     - `asset_checkouts.seafile_library_id`
     - `asset_checkouts.seafile_path`
     - `asset_checkouts.source_version`
     - `asset_checkouts.last_helper_heartbeat_at`
   - Preserve the existing partial unique index that locks `active`, `checkin_queued`, `uploading`, and `verifying`.

10. Testing plan
    - Unit test path mapping:
      - PopDAM `relative_path` -> Seafile library path
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

Suggested first implementation slice:

1. Add `seafileAdapter.ts` with read-only detection/path-mapping/hydration wait.
2. Add Settings UI to detect and test SeaDrive root.
3. Modify checkout source resolution to prefer Seafile when configured.
4. Keep check-in path unchanged initially (Synology File Station), but record `source_provider = seafile`.
5. Add local `/status` Seafile health output.
6. Pilot with one macOS WFH machine before changing permissions or default behavior.

Related docs/repos:

- `future_improvements.md` in this repo: high-level PopDAM checkout/check-in safety plan.
- `docs/POPDAM_HELPER.md`: current Helper architecture.
- `u2giants/seafile/lucid.md`: storage strategy notes; currently recommends PopDAM + Seafile/SeaDrive first for WFH macOS users.
- `u2giants/seafile/synology-seaf-cli/`: current NAS -> Seafile ingestion wrapper.

### 2. Auto-update — blocked on code signing certs

`electron-updater` is installed and wired in `apps/popdam-helper/src/main/main.ts`. The `publish` block in `electron-builder.yml` is ready. The only remaining work is external setup:

| Platform | Requirement | Estimated cost |
|----------|-------------|----------------|
| macOS | Apple Developer account ($99/yr) + notarization | Required for Gatekeeper |
| Windows OV cert | SmartScreen warns on first install; updates work silently | ~$60–$150/yr |
| Windows EV cert | No SmartScreen warning, silent updates | ~$300–$500/yr |

**To activate once certs are acquired:**
1. Add these GitHub Actions secrets in `publish-popdam-helper.yml`:
   - Windows: `CSC_LINK`, `CSC_KEY_PASSWORD`
   - macOS: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
2. Remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from the CI env block in `publish-popdam-helper.yml`
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
