# Seafile / SeaDrive Integration

How PopDAM uses Seafile (Pro 13) + the SeaDrive virtual-drive client as the work-from-home transport/cache layer. PopDAM/Supabase remains the checkout/audit/policy plane; the POP DAM Helper supervises SeaDrive (it does **not** embed or fork it).

## Storage transport by region

Provider is chosen **per-machine by region** (set at install — see HANDOFF.md):

| Region | Primary | Fallback |
|--------|---------|----------|
| **Brazil (WFH)** | Seafile / SeaDrive (`seafile.designflow.app`) | Synology over **SMB across Tailscale** |
| **USA** | Synology `edgesynology1` over SMB | — |

- **No** Seafile→Synology fallback unless reachable — Brazil reaches the NAS via Tailscale, so fallback is enabled (`HELPER_SYNOLOGY_FALLBACK_ALLOWED = true`).
- We use **SeaDrive (virtual drive)** only — never the legacy Seafile *sync* client (which fully downloads a library to disk). The Helper's `seafileAdapter.ts` only detects SeaDrive.

## Library mapping

A PopDAM root can hold multiple Seafile libraries as subfolders; a library is matched by **longest path-prefix** on `relative_path`, then the prefix is stripped to get the in-library path. Configured in `admin_config.HELPER_SEAFILE_LIBRARIES`:

| `relative_path` prefix | Seafile library | UUID | `~/SeaDrive/…` |
|------------------------|-----------------|------|----------------|
| `Decor/Character Licensed` | Character Licensed | `177cf9de-3066-482e-956a-7ae8d8786c6d` | `Character Licensed` |
| `Decor/Generic Decor` | Generic Decor | `1b116ab7-d66b-4411-a691-21f34eadb731` | `Generic Decor` |

`seaDriveFolder` = the Seafile library name (how SeaDrive mounts it). Seafile is a **partial mirror** of the NAS; unsynced files fall through to the Synology/Tailscale fallback.

### admin_config keys (read by `helper-api /config`)
| Key | Value |
|-----|-------|
| `HELPER_SEAFILE_PREFERRED` | global default (overridden per-machine by region) |
| `HELPER_SYNOLOGY_FALLBACK_ALLOWED` | `true` |
| `HELPER_SEAFILE_SERVER_URL` | `https://seafile.designflow.app` |
| `HELPER_SEAFILE_LIBRARIES` | JSON array of `{libraryId, displayName, seaDriveFolder, rootId, pathPrefix}` |

## Caching / offline (mixed mode)

SeaDrive keeps an on-demand cache: **recently opened files stay local** (LRU), and folders/files can be **pinned** ("always keep on this device") for guaranteed offline access. This does **not** affect checkout/check-in — the Helper copies into its own private workspace and writes back through the controlled path; pinned/cached files simply hydrate instantly. Do not edit directly in the shared `~/SeaDrive` path as the primary workflow.

## SeaDrive client distribution

PopDAM self-hosts a pinned latest build: the worker's `seadrive-mirror` handler runs weekly from `tick()`, scrapes the official download page (`https://www.seafile.com/en/download/`), and when a newer version appears, mirrors the `.pkg`/`.msi` into our DigitalOcean Spaces bucket and records `admin_config.SEADRIVE_LATEST` (`{version, mac_url, win_url, mirrored, checked_at}`). The `/downloads` page reads that and offers only the latest, hosted by us (falling back to the official seafile.com URLs if a mirror run fails). Spaces creds come from `admin_config.DO_SPACES_*`.

---

## nas-settings app

The Seafile VPS runs a small Flask app (`ghcr.io/u2giants/seafile:nas-settings-latest`, built from `u2giants/seafile` → `seafile-server/nas-settings/app.py`) mounted at `/nas-settings/` behind Caddy. It is the GUI for controlling the `seaf-cli` daemon on the Synology NAS — ingest-window settings per library, plus live sync status and controls (pause/resume/restart, daemon config, library management). Commands are queued and picked up by the NAS Docker containers on their next status poll (~30 s).

Auth: the app reads the `seahub_auth` cookie (set by Seahub after OAuth login, format `email@<40-char-hex-token>`) and calls `/api/v2.1/admin/sysinfo/` via Token auth over HTTPS to verify the user is a Seafile system admin.

**Do NOT change the auth check back to session-cookie (`sessionid`) + `http://seafile`:** nginx inside the Seafile container issues a **308 HTTP→HTTPS redirect** for all API paths. Python's `urllib` (and most HTTP clients) silently drop the `Cookie` header when following an HTTP→HTTPS redirect. The API call arrives unauthenticated → 403 → `is_seafile_admin()` returns False → nas-settings redirects to login → Seahub sees the user is already authenticated → redirects back to `/nas-settings/` → `ERR_TOO_MANY_REDIRECTS`. Using the `seahub_auth` Token cookie over HTTPS avoids the redirect entirely.

Deploy: `docker pull ghcr.io/u2giants/seafile:nas-settings-latest && docker rm -f nas-settings && cd ~/seafile-repo/seafile-server && docker compose -f nas-settings.yml up -d nas-settings`. The compose file references `env_file: /opt/seafile/.env` which has `NAS_SETTINGS_SECRET_KEY` and `NAS_STATUS_TOKEN`.

---

## Seahub config snippets (live on the Seafile server, `seahub_settings.py`)

> ⚠️ These run on the Seafile VPS (`seafile-br`), **not** in this repo's deploy path. They are recorded here as the authoritative reference. The live file is at `/shared/seafile/conf/seahub_settings.py` inside the `seafile` Docker container.

### 1. Microsoft (Entra) SSO via OAuth2 — current live configuration

The Entra app is `Seafile POP Creations` (client/app id `8d9da03c-e5cd-4a23-b987-32aaaed31fe7`), redirect `https://seafile.designflow.app/oauth/callback/`, scopes `openid profile email User.Read`, client secret named `seafile-oauth` (exp 2028-01-01). The secret value is in `/opt/seafile/.env` on the VPS (not committed). The current live `seahub_settings.py`:

```python
ENABLE_OAUTH = True
OAUTH_ENABLE_INSECURE_TRANSPORT = False
OAUTH_CLIENT_ID = "8d9da03c-e5cd-4a23-b987-32aaaed31fe7"
OAUTH_CLIENT_SECRET = "<value-of-the-seafile-oauth-secret>"   # not committed — from /opt/seafile/.env
OAUTH_REDIRECT_URL = "https://seafile.designflow.app/oauth/callback/"
OAUTH_PROVIDER_DOMAIN = "designflow.app"

TENANT = "1caeb1c0-a087-4cb9-b046-a5e22404f971"
OAUTH_AUTHORIZATION_URL = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize"
OAUTH_TOKEN_URL         = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
OAUTH_USER_INFO_URL     = "https://graph.microsoft.com/oidc/userinfo"
OAUTH_SCOPE = ["openid", "profile", "email"]

# Map Microsoft OIDC userinfo fields → Seafile fields. 'sub' is the stable user id.
OAUTH_ATTRIBUTE_MAP = {
    "sub":   (True,  "uid"),
    "email": (False, "contact_email"),
    "name":  (False, "name"),
}

ENABLE_SIGNUP = False

CUSTOM_NAV_ITEMS = [
    {
        "icon": "sf2-icon-cog2",
        "desc": "NAS Sync",
        "link": "/nas-settings/",
    },
]
```

**OAUTH_ATTRIBUTE_MAP — do not change the email mapping.** The OAuth callback in Seahub 13 reads `oauth_user_info.get('contact_email', '')` to update the user's profile. The map key is the field name in `oauth_user_info`, set by the second element of the tuple. If you map `"email"` to `"email"` (instead of `"contact_email"`), the contact_email profile field never gets updated via OAuth, and an earlier attempt with the wrong mapping caused a MySQL `IntegrityError` (duplicate `contact_email`) that crashed the `/oauth/callback/` endpoint with a 500, leaving users unable to log in. The `(False, ...)` means the field is optional (not all Microsoft accounts expose email in the userinfo endpoint).

After editing `seahub_settings.py`, restart Seahub: `docker restart seafile`.

To restrict access to specific users: either assign only the relevant group to the Entra app in Entra ID, or set `ACTIVATE_AFTER_FIRST_LOGIN = False` so new SSO users are inactive until an admin activates them in the Seafile admin panel.

### 2. Custom nav link to PopDAM Downloads

```python
CUSTOM_NAV_ITEMS = [
    {
        "icon": "sf2-icon-download",
        "desc": "PopDAM Downloads",
        "link": "https://dam.designflow.app/downloads",
    },
]
```
