# Handoff

_Last updated: 2026-05-15_

Delete this file once all items are done.

---

## Unfinished dev work

### 1. Auto-update — blocked on code signing certs

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

### 2. macOS notarization

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

## Context that exists only in session history

### CI/CD migration (2026-05-15)

The frontend deploy was migrated from SSH-based (`docker run` on VPS) to Coolify API trigger. Key facts that informed the decisions:

- Coolify was already running and had `popdam-frontend` configured as an app (UUID `qxj8a0j3tpa9lq4q5rs6pezy`) — this was confirmed by querying the Coolify DB directly. CI had been bypassing Coolify entirely by SSHing into the server.
- The `sg.designflow.app` routing via Traefik file provider is the correct long-term approach because Coolify's Docker label mechanism only applies the first FQDN in its app config. The file at `/data/coolify/proxy/dynamic/popdam-sg.yml` references the stable service name `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker` — this works across container redeploys.
- The nginx health check failure (`localhost` → `::1` on IPv6 hosts) was a pre-existing bug. Fixed by adding `listen [::]:80;` to `nginx.conf`.

All these details are now documented in `SELFHOST.md` and `docs/KNOWN_QUIRKS.md` (quirks #41 and #42).
