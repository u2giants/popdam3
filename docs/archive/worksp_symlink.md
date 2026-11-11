# Coolify App Folder Structure on `/worksp/`

Every app on the Coolify server follows this structure under `/worksp/`:

```
/worksp/<app-name>/              ← Real directory (blue) — git repo with source code
├── .git/
├── src/                         ← Application source files
├── Dockerfile                   ← If the app has its own Dockerfile
├── package.json / requirements.txt / etc.
├── ...                          ← Project files
└── server                       ← Symlink (turquoise/cyan)
    → /data/coolify/applications/<coolify-app-id>
    ├── .env                     ← Environment variables managed by Coolify
    ├── docker-compose.yaml      ← Deployment compose file managed by Coolify
    └── README.md                ← Coolify-generated readme
```

## What each part means

| Path | Type | Purpose |
|------|------|---------|
| `/worksp/<app-name>/` | Real directory | **Git clone of the source repo** — this is where you edit code |
| `/worksp/<app-name>/server` | Symlink | Points to Coolify's internal deployment directory — contains `.env`, `docker-compose.yaml`, `README.md` |

Older notes may mention `/worksp/<app-name>/app/`; that nested layout is legacy. Current app checkouts on this server, including PopDAM, use the repo root directly under `/worksp/<app-name>/`.

## How to set up a new app

When creating a new app, run these commands on the server:

```bash
# 1. Clone the source repo directly into the workspace folder
git clone <your-git-repo-url> /worksp/<app-name>

# 2. Create the server symlink (replace <coolify-app-id> with the actual ID)
ln -s /data/coolify/applications/<coolify-app-id> /worksp/<app-name>/server
```

## How to find the Coolify app ID

The Coolify app ID is in the Coolify database. You can find it via tinker:

```bash
docker exec coolify php artisan tinker --execute="App\Models\Application::where('name', '<app-name>')->get(['id','name','uuid']);"
```

Or look in the Coolify web UI — the app ID/UUID is in the URL when viewing the app.

## Color coding in `ls` output

- **Blue** = real directory
- **Cyan/turquoise** = symbolic link

## Example: OpenManus

```
/worksp/openmanus/
├── .git/
├── server.py
├── Dockerfile
├── config.toml
├── entrypoint.sh
├── ...
└── server                   (turquoise — symlink)
    → /data/coolify/applications/openmanus-f9397c334d525e3ba812
    ├── .env
    ├── docker-compose.yaml
    └── README.md
```

## Example: Monitor

```
/worksp/monitor/
├── .git/
├── apps/
├── packages/
├── supabase/
├── ...
└── server                   (turquoise — symlink)
    → /data/coolify/applications/lrddgp8im0276gllujfu7wm3
    ├── .env
    ├── docker-compose.yaml
    └── README.md
```

## Example: PopDAM

```
/worksp/popdam/
├── .git/
├── apps/
├── src/
├── supabase/
├── docs/
├── ...
└── server
    → /data/coolify/applications/qxj8a0j3tpa9lq4q5rs6pezy
```

`/worksp/popdam3` was a stale duplicate checkout and was removed on 2026-07-09 after its uncommitted changes were reviewed, either found already present on `origin/main`, superseded, or ported into `/worksp/popdam`.
