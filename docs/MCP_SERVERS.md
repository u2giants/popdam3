# MCP Servers & Secret Management

How the MCP servers used by AI sessions on this repo are configured and authenticated,
and how their tokens are managed. Established/rotated 2026-06-22.

> **The one rule that matters most:** the repo's root `.mcp.json` must contain **no secret
> values** — only `${VAR}` placeholders. Do **not** "tidy" it by pasting tokens back in;
> they'd be committed to git. (The old hardcoded tokens were exposed in git history and had
> to be rotated. See "Rotation" below.)

---

## The servers

| MCP server | Endpoint | Runs where | Auth |
|---|---|---|---|
| `supabase` | local `npx @supabase/mcp-server-supabase` `--project-ref qsllyeztdwjgirsysgai` | local | `SUPABASE_ACCESS_TOKEN` env |
| `devops-mcp` | `https://mcp.designflow.app/mcp` (native `type:http`) | Coolify **Service** on the Hetzner VPS (uuid `vj5f76xet05bxwdq4utw1kho`) | `Authorization: Bearer ${DEVOPS_MCP_TOKEN}` |
| `synology-monitor` | `https://nas-mcp.designflow.app/mcp` (native `type:http`) | Coolify **Application** on the VPS (uuid `efl17f5iocnz94840pexre9d`); relays to the NAS | `Authorization: Bearer ${NAS_MCP_TOKEN}` |
| `playwright` | local `npx @playwright/mcp` | local | none |

Note: `synology-monitor` uses **`/mcp`** (streamable HTTP), not `/sse`. The server image was
upgraded from SSE to HTTP-Stream on 2026-06-22; `.mcp.json` was switched to the native
`type:http` transport to match (mcp-remote/`/sse` no longer works).

The Supabase project is **`qsllyeztdwjgirsysgai`** (Virginia) — see `docs/architecture.md` /
AGENTS.md for the Ohio→Virginia cutover trap (the default `mcp__supabase__*` tooling points
at the decommissioned Ohio project).

---

## Where the secrets live

All in **1Password, vault `vibe_coding`** (the only vault an AI session here can touch):

- Item **`designflow-mcp`** — fields `devops_token`, `nas_token`, `supabase_pat` (+ notes).
- Item **`vibe_coding-service-account`** — the `OP_SERVICE_ACCOUNT_TOKEN` (`ops_…`) for the
  `hetzner_vps` 1Password **service account**, scoped **read+write to `vibe_coding` only**
  (it cannot see other vaults). This token is what lets `op`/the 1Password MCP read+write
  the vault.
- Other infra secrets centralized here too (each with notes): `github-pat`,
  `ai-provider-api-keys`, `devops-mcp-client-tokens`, `nas-monitor-secrets`,
  `contextforge-secrets`, `cloudflare-tunnel-tokens`, `coolify-secrets`, `directus-secrets`.

There is **no 1Password MCP** wired into a VPS Claude Code session — use the `op` CLI (the
SA token is in `/root/.bashrc` and `/home/ai/.bashrc`). The user's *Windows Desktop app* has
a `@takescake/1password-mcp` server (separate config; see "Windows" below).

---

## How `.mcp.json` placeholders get resolved

- **VPS Claude Code sessions (the usual remote-control workflow):** `/home/ai/.bashrc`
  contains a block ("POPDAM MCP token injection") that, on shell start, uses the SA token to
  `op read` the three tokens and `export` `DEVOPS_MCP_TOKEN` / `NAS_MCP_TOKEN` /
  `SUPABASE_ACCESS_TOKEN`. So `claude` launched from a normal shell inherits them and the
  `${…}` placeholders resolve. If `devops-mcp`/`synology-monitor` ever fail to auth in a VPS
  session, check that block and that `op` + the SA token work (`op whoami`).
- **Anywhere else (e.g. a local laptop running this repo):** launch via
  `op run --env-file=<file with op://vibe_coding/designflow-mcp/* refs> -- claude`.

---

## Windows (Claude Desktop, Claude Code, Codex) — separate from this repo

The user runs **Claude Desktop on Windows**; its MCP servers are **not** configured from this
repo's `.mcp.json`. They are set up by **PowerShell scripts** (`setupclaudemcps.ps1`,
`setupcodexmcps.ps1`) that write the Desktop / Claude-Code / Codex config files with the
tokens **hardcoded** (the user's deliberate choice — self-contained, no runtime dependency).

**Future sessions: do not edit the Windows config files directly — everything goes through
those scripts.** When a token rotates, the scripts must be updated and re-run on each machine.
The scripts also carry the `OP_SERVICE_ACCOUNT_TOKEN` for the Windows 1Password MCP — that is
the **same** SA token; if the SA is recreated, the scripts break too.

---

## Rotation procedure (if a token is exposed)

1. **New value** → update the field in 1Password (`vibe_coding/designflow-mcp`).
2. **Server side** → update the matching Coolify env var and **redeploy** that resource:
   - `devops-mcp` (Service `vj5f76xet05bxwdq4utw1kho`) → env `TOKEN_ROOCODE`
   - `nas-mcp` (Application `efl17f5iocnz94840pexre9d`) → env `MCP_BEARER_TOKEN` (there are
     **two** rows: production + an `is_preview` row — update both)
   - Coolify env vars are encrypted rows in `coolify-db`; edit via
     `docker exec coolify php artisan tinker` (model `EnvironmentVariable`, polymorphic
     `resourceable_type`/`resourceable_id`). Redeploy via the Coolify API:
     create a Sanctum token in tinker (**must set `team_id`**, which plain `createToken`
     omits), then `GET http://localhost:8000/api/v1/deploy?uuid=<uuid>`.
   - The old token dies the moment the new container deploys.
3. **Clients** → repo `.mcp.json` needs no change (placeholders); VPS sessions pick up the new
   value automatically (the `.bashrc` block re-reads 1Password). Re-run the Windows scripts.

Verify: old token → `401`/`403`, new token → `400`/`405`/`406` (auth passed) on the endpoint.

---

## Related

- VPS proxy / docker-socket operational fixes: `deploy/vps/coolify-proxy-socket-fix.md`.
- The MCP servers themselves (devops-mcp = IBM mcp-context-forge stack; synology-monitor)
  are the user's general dev tooling hosted on the VPS, not PopDAM application components.
