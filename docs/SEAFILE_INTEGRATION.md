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

The client comes from Seafile (`https://www.seafile.com/en/download/`), served from `https://sos-ch-dk-2.exo.io/seafile-downloads/` (e.g. `seadrive-3.0.22-en.msi`, `seadrive-3.0.22.pkg`). PopDAM's `/downloads` page links it. **Planned:** PopDAM self-hosts a pinned latest build and a scheduled checker scrapes the version page so only the latest is offered (see HANDOFF.md).

---

## Seahub config snippets (live on the Seafile server, `seahub_settings.py`)

> ⚠️ These run on the Seafile VPS (`seafile-br`), **not** in this repo's deploy path. They are recorded here as operational knowledge only.

### 1. Direct Microsoft (Entra) SSO via OAuth2

First **remove** whatever SSO currently logs users straight in with no Microsoft prompt (a `REMOTE_USER`/proxy-header trust is a security hole). Then register an app in Microsoft Entra (redirect URI `https://seafile.designflow.app/oauth/callback/`, delegated scopes `openid profile email`) and set:

```python
ENABLE_OAUTH = True
OAUTH_ENABLE_INSECURE_TRANSPORT = False
OAUTH_CLIENT_ID = "<entra-application-client-id>"
OAUTH_CLIENT_SECRET = "<entra-client-secret>"
OAUTH_REDIRECT_URL = "https://seafile.designflow.app/oauth/callback/"
OAUTH_PROVIDER_DOMAIN = "designflow.app"

TENANT = "<entra-tenant-id>"
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
```

To require approval/restrict to a designer group, either assign only that group to the Entra app, or set Seafile to deactivate new SSO users until an admin activates them (`ACTIVATE_AFTER_FIRST_LOGIN = False` and approve in the admin panel). Restart Seahub after editing. Confirm exact key names against the Seafile 13 OAuth docs for your build.

### 2. Custom nav link to PopDAM Downloads (the "Downloads in Seafile too" ask)

```python
CUSTOM_NAV_ITEMS = [
    {
        "icon": "sf2-icon-download",
        "desc": "PopDAM Downloads",
        "link": "https://dam.designflow.app/downloads",
    },
]
```
