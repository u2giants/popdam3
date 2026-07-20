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
| `supabase` | local `npx @supabase/mcp-server-supabase` `--project-ref qsllyeztdwjgirsysgai` | local | `SUPABASE_ACCESS_TOKEN` env, wired via an explicit `env: {"SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"}` block in `.mcp.json` (added 2026-07-09 — see below) |
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
  `contextforge-secrets`, `cloudflare-tunnel-tokens`, and `coolify-secrets`.

There is **no 1Password MCP** wired into a VPS Claude Code session — use the `op` CLI (the
SA token is in `/root/.bashrc` and `/home/ai/.bashrc`). The user's *Windows Desktop app* has
a `@takescake/1password-mcp` server (separate config; see "Windows" below).

**Update 2026-07-09:** at least one non-VPS (cloud/remote) session type does have a working
1Password MCP (`@u2giants/1password-mcp`, tool names `mcp__1password__*`), backed by the same
`OP_SERVICE_ACCOUNT_TOKEN` and scoped to the `vibe_coding` vault only — `vault_list`/`item_list`
were used successfully to audit vault contents without exposing secret values. Unclear whether
this is present on literal VPS sessions too, or specific to how that other session type is
launched; verify with `mcp__1password__vault_list` before assuming it's absent.

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
- **Cloud/remote sessions not launched via the `.bashrc` shell path:** confirmed 2026-07-09
  that at least one such session type never sourced that block, so `SUPABASE_ACCESS_TOKEN`
  was unset and the `supabase` MCP server (a stdio process with no `env` block at the time)
  failed instantly on startup. `devops-mcp`/`synology-monitor` still worked in that same
  session because their `${VAR}` placeholders live in the `headers` of an `http`-type server,
  which this environment appears to resolve from 1Password on its own — that resolution has
  **not** been observed for `env` blocks on stdio servers, so stdio servers must carry an
  explicit `"env": {"SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"}` block (now added to
  `.mcp.json`) rather than relying on ambient shell export. If `supabase` MCP tools are still
  missing after this fix + a session restart, this environment's placeholder resolution may
  not extend to stdio `env` blocks either — fall back to `op run` (above) or ask the user.

**Reconfirmed 2026-07-14** that the `supabase` MCP can still land in this
unauthorized state (`Unauthorized. Please provide a valid access token…`) in a
session where the `.bashrc` token block wasn't sourced. **This is not a
dead end — do not report the DB as unreachable because of it.** The Supabase
**CLI** (`supabase`, installed + authed, project linked to
`qsllyeztdwjgirsysgai`), `psql`, and direct **PostgREST** all work when fed the
service role from 1Password. Working no-secret-leak pattern used that session:

```bash
# resolve item id first (op:// refs break on titles containing "()"):
RID=$(op item get "Supabase Runtime Keys - shared POP database (production)" \
      --vault vibe_coding --format json | node -e '…print .id…')
printf 'SUPABASE_URL=op://vibe_coding/%s/SUPABASE_URL\nSUPABASE_SERVICE_ROLE_KEY=op://vibe_coding/%s/SUPABASE_SERVICE_ROLE_KEY\n' "$RID" "$RID" > refs.env
op run --env-file=refs.env -- node query.mjs   # secrets only in the subprocess env
```

Never `op read` a secret to stdout (the harness classifier blocks printing even a
credential *prefix* — "credential materialization"); always inject via
`op run --env-file`. The live PopDAM OpenRouter key is in
`admin_config.OPENROUTER_API_KEY`, reachable the same way.

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
