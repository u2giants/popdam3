# Coolify App Folder Structure on `/worksp/`

Every app on the Coolify server follows this structure under `/worksp/`:

```
/worksp/<app-name>/              ← Real directory (blue in ls output)
├── app/                         ← Real directory (blue) — the git repo with source code
│   ├── .git/
│   ├── src/                     ← Application source files
│   ├── Dockerfile               ← If the app has its own Dockerfile
│   ├── package.json / requirements.txt / etc.
│   └── ... (all project files)
│
└── server                       ← Symlink (turquoise/cyan in ls output)
    → /data/coolify/applications/<coolify-app-id>
    ├── .env                     ← Environment variables managed by Coolify
    ├── docker-compose.yaml      ← Deployment compose file managed by Coolify
    └── README.md                ← Coolify-generated readme
```

## What each part means

| Path | Type | Purpose |
|------|------|---------|
| `/worksp/<app-name>/` | Real directory | Container for the app's source code and deployment config |
| `/worksp/<app-name>/app/` | Real directory | **Git clone of the source repo** — this is where you edit code |
| `/worksp/<app-name>/server` | Symlink | Points to Coolify's internal deployment directory — contains `.env`, `docker-compose.yaml`, `README.md` |

## How to set up a new app

When creating a new app, run these commands on the server:

```bash
# 1. Create the workspace folder
mkdir /worksp/<app-name>

# 2. Clone the source repo into app/
git clone <your-git-repo-url> /worksp/<app-name>/app

# 3. Create the server symlink (replace <coolify-app-id> with the actual ID)
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
├── app/                     (blue — git clone of github.com/u2giants/openmanus)
│   ├── .git/
│   ├── server.py
│   ├── Dockerfile
│   ├── config.toml
│   ├── entrypoint.sh
│   └── ...
└── server                   (turquoise — symlink)
    → /data/coolify/applications/openmanus-f9397c334d525e3ba812
    ├── .env
    ├── docker-compose.yaml
    └── README.md
```

## Example: Monitor

```
/worksp/monitor/
├── app/                     (blue — git clone of the Monitor repo)
│   ├── .git/
│   ├── apps/
│   ├── packages/
│   ├── supabase/
│   └── ...
└── server                   (turquoise — symlink)
    → /data/coolify/applications/lrddgp8im0276gllujfu7wm3
    ├── .env
    ├── docker-compose.yaml
    └── README.md
```
