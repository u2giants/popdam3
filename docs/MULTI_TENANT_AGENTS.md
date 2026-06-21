# Multi-Tenant Agents

Both the **Bridge Agent** (Synology Docker) and the **Windows Render Agent** can serve **multiple Supabase backends from a single install** via the `TENANTS` environment variable.

> **Note:** PopDAM and PopSG currently share the same Supabase project (`qsllyeztdwjgirsysgai`) — they are two UI modes of one deployment, not separate backends. Multi-tenant with different `server_url`s applies only if you are running truly separate Supabase instances (e.g., separate deployments for different client organizations). The single-tenant mode (`TENANTS` not set) is what the standard PopDAM/PopSG install uses.

## How it works

Each agent process checks for a `TENANTS` environment variable on startup:

- **`TENANTS` set** → the binary runs as a **supervisor**. It spawns one child agent process per tenant. Each child has its own server URL, agent key, NAS roots, and DigitalOcean Spaces bucket. Children that crash are auto-restarted after 10 s.
- **`TENANTS` not set** → falls back to today's single-tenant behavior. **Existing single-tenant deployments need no changes.**

Per-tenant pairing/config files are written to:

- Bridge Agent: `/data/agent-config-<tenant>.json`
- Windows Agent: `%ProgramData%\PopDAM\agent-config-<tenant>.json`

## TENANTS JSON shape

### Bridge Agent

```json
[
  {
    "name": "popdam",
    "server_url": "https://qsllyeztdwjgirsysgai.supabase.co",
    "pairing_code": "ABC-123-XYZ",
    "agent_name": "bridge-popdam",
    "scan_roots": ["/nas"],
    "supabase_anon_key": "eyJ...",
    "do_spaces": {
      "key": "...",
      "secret": "...",
      "bucket": "popdam",
      "region": "nyc3",
      "endpoint": "https://nyc3.digitaloceanspaces.com"
    }
  },
  {
    "name": "client-b",
    "server_url": "https://<other-project-id>.supabase.co",
    "pairing_code": "DEF-456-UVW",
    "agent_name": "bridge-client-b",
    "scan_roots": ["/nas/client-b"],
    "supabase_anon_key": "eyJ...",
    "do_spaces": {
      "key": "...",
      "secret": "...",
      "bucket": "client-b",
      "region": "nyc3",
      "endpoint": "https://nyc3.digitaloceanspaces.com"
    }
  }
]
```

Set `TENANTS` in `docker-compose.yml` (single-line JSON) and remove the per-tenant env vars (`AGENT_KEY`, `SCAN_ROOTS`, `DO_SPACES_*`, etc.).

### Windows Agent

Same shape, except `scan_roots` is replaced with `nas`:

```json
[
  {
    "name": "popdam",
    "server_url": "https://qsllyeztdwjgirsysgai.supabase.co",
    "pairing_code": "ABC-123-XYZ",
    "agent_name": "windows-popdam",
    "nas": { "host": "diskstation", "share": "volume1", "mount_path": "Z:" },
    "do_spaces": { "bucket": "popdam", "key": "...", "secret": "...", "region": "nyc3", "endpoint": "https://nyc3.digitaloceanspaces.com" }
  },
  {
    "name": "client-b",
    "server_url": "https://<other-project-id>.supabase.co",
    "pairing_code": "DEF-456-UVW",
    "agent_name": "windows-client-b",
    "nas": { "host": "diskstation", "share": "volume1", "mount_path": "Z:" },
    "do_spaces": { "bucket": "client-b", "key": "...", "secret": "...", "region": "nyc3", "endpoint": "https://nyc3.digitaloceanspaces.com" }
  }
]
```

## Operational notes

- **Pairing codes are one-time use.** Generate one per tenant from each Supabase's PopDAM/PopSG admin panel. Once a tenant is paired, the saved `agent_key` in its `/data/agent-config-<tenant>.json` is reused on restart and the `pairing_code` field is ignored.
- **Per-tenant DO Spaces buckets** (e.g. `popdam` and `popsg`) keep the licensors' artwork visually separate. Each child uploads only to its own bucket.
- **Heartbeats are independent.** PopDAM seeing the agent online does not imply PopSG is healthy — check each backend's Agents tab.
- **Crash isolation:** if the PopSG child throws unhandled, only PopSG goes offline for ~10 s while it restarts. PopDAM keeps working.
- **Logs** are interleaved with `[tenant=<name>]` prefixes (added automatically by the supervisor on stdout).

## Migration from single-tenant

1. Stop the agent.
2. Add the `TENANTS` env var with one entry that matches your existing config.
3. Remove the now-redundant single-tenant env vars (`AGENT_KEY`, `SCAN_ROOTS`, `DO_SPACES_*`, `POPDAM_PAIRING_CODE`).
4. Start the agent. The supervisor will spawn one child; behavior is identical to before.
5. Add the second tenant entry (PopSG) to `TENANTS`. Restart. Both children will run.

Existing `/data/agent-config.json` is **not** migrated automatically — pair the first tenant via `pairing_code` so a fresh `/data/agent-config-popdam.json` is written. (You can also rename the old file manually to skip re-pairing.)
