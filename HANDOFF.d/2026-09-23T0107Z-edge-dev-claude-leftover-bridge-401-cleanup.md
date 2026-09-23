---
issue: 141
status: OPEN
owner: claude/141-agent-api-401
---

# Handoff: find and stop the leftover PopDAM scanner causing agent-api 401s

**Session starter for the next agent (paste this if you need one):**

> Work in `u2giants/popdam3`. Read `HANDOFF.d/2026-09-23T0107Z-edge-dev-claude-leftover-bridge-401-cleanup.md` in full before doing anything. Complete issue #141: find and stop the leftover PopDAM scanner on the office network (NOT the live NAS bridge on edgesynology2), verify agent-api 401s drop to ~0, then close the issue and retire this handoff. You have SSH to edgesynology1, edgesynology2, and the Windows render machine. Albert (the owner) is not a programmer — keep him in plain English.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this WHOLE list to Albert in ONE message before starting destructive work.

**Blocking (ask before stop/delete):**

1. **Confirm the leftover scanner may be stopped and removed.** Recommendation: yes — it is a duplicate with a bad password and is the entire #141 problem. The live NAS scanner must stay.
2. **If two scanners look “real,” which to keep.** Recommendation: keep the one on **edgesynology2** (`synology-bridge-1`, healthy, last heartbeat updating). Stop every other bridge/scanner.

**Wrong guess recoverable, but rework:**

3. **Stop only, or stop + delete install/config?** Recommendation: stop first, confirm 401s hit zero, then delete the leftover install so it cannot restart.

**Already settled — do NOT re-ask (2026-09-22/23):**

- Albert authorized: “pull the latest repo and resolve through to production u2giants/popdam3#141.”
- Code fix (PR #145) is merged and live in production. Independent reviewer APPROVE. Do not re-litigate that ship.
- Do not break or re-key the live `synology-bridge-1` on edgesynology2 to punish the leftover.
- Do not make shared-db / schema changes for this cleanup.

**Outside this workstream (nobody on it):**

- None discovered this session beyond #141.

---

## 1. What this application is

**PopDAM** is POP Creations’ internal Digital Asset Manager for licensed consumer-product art. Source design files live on Synology NAS units. “Bridge agents” scan the NAS, make thumbnails, and call a cloud API (`agent-api`) with a secret key.

**This bug:** one extra/leftover scanner on the office network keeps calling that API with an **old password** every 30 seconds and getting rejected (HTTP 401). The real scanner is fine.

**Repos / where it runs:**

| Piece | Where |
|---|---|
| App repo | `u2giants/popdam3` (GitHub) |
| Production API | Supabase project `qsllyeztdwjgirsysgai` (Virginia) — **live**. Ignore any Ohio `ryltkzzernhwnojzouyb` “.old” project. |
| Live scanner | Docker `popdam-bridge` on **edgesynology2** (192.168.3.101) |
| Other NAS | **edgesynology1** (192.168.3.100) — writes; should NOT run a long-lived scanner |
| Windows box | Windows render agent (Illustrator). Should NOT run a bridge/scanner |
| Office public IP (NAT) | `74.80.230.82` (Pilot Fiber, NYC) — all office machines share this |

---

## 2. What we set out to do this session, and why

**Business goal:** stop a steady stream of failed logins against the asset system (issue **#141**), identify which machine is doing it, and make it stop.

**Technical goal:** (1) log every 401 with a non-secret identity so the client can be named; (2) stop agents from hammering every 30s; (3) identify and retire the leftover install; (4) prove 401s go to ~0.

**Trigger:** GitHub issue #141 — “agent-api: steady 401s (~every 30s) from one Node agent.” Evidence: identical **1073-byte** body, user-agent `node`, office Pilot Fiber, ~2,864 hits / 24h.

---

## 3. Current state — what is true right now

### Shipped and live in production (DONE)

| Item | Status | Proof |
|---|---|---|
| 401 logging (reason, action, agent_id, key hash prefix) | **Live** | PR **#145**, merge commit **`6fc02d0`** |
| Bridge + Windows agents back off on repeated auth failures | **Published** | bridge **1.16.13**, windows **0.16.4**; both publish workflows green |
| Windows agent no longer restarts on auth failures | **Published** | same |
| Edge function deploy | **Live** | workflow `Deploy Supabase Edge Functions` success on `6fc02d0` |
| Issue comment naming the client | **Posted** | [#141 comment](https://github.com/u2giants/popdam3/issues/141#issuecomment-5787021757) |

### Identified (DONE — this is the key finding)

New logs named the client on the first hit:

```
[agent-api 401] {
  reason: "invalid_agent_key",
  action: "heartbeat",
  agent_id: "aab7fb4c-2379-4367-a51e-fcec91d0d2ed",
  key_hash_prefix: "901c611d",
  content_length: "1073"
}
```

| Field | Value | Meaning |
|---|---|---|
| `agent_id` | `aab7fb4c-2379-4367-a51e-fcec91d0d2ed` | Same id as the **registered** agent named **`synology-bridge-1`** |
| `reason` | `invalid_agent_key` | It is sending an agent key that is **not** the current one (hash prefix `901c611d`) |
| `action` | `heartbeat` | Scheduled ping, not a scan |
| `content_length` | `1073` | Exact fingerprint from issue #141 |
| Source | Pilot Fiber, NYC, `74.80.230.82`, UA `node` | Office LAN behind that NAT |
| Cadence | every ~30s | Old agent, no backoff code |

**Interpretation:** a **second process** is pretending to be `synology-bridge-1` with a **copied/stale** `agent-config.json` (it knows the agent_id but has the wrong key). The real `synology-bridge-1` on edgesynology2 is healthy (many 200s, `last_heartbeat` current). They share one registration row, so the leftover cannot be “the other registered agent” — there are only two rows total:

| Registered agent | Type | Last seen (approx 2026-09-23 00:35 UTC) |
|---|---|---|
| `synology-bridge-1` = `aab7fb4c-2379-4367-a51e-fcec91d0d2ed` | bridge | Fresh (healthy) |
| `windows-render-agent` = `d287e3f9-2246-49aa-8d2d-9448dc9a324d` | windows-render | Hours stale (likely idle/offline — not the 401 source) |

### NOT done (this handoff’s job)

- The leftover process is **still running** and still 401ing every ~30s (confirmed still logging after deploy).
- 401 count has **not** dropped to ~0 yet.
- Issue **#141** is still **OPEN**.

---

## 4. Everything we tried that did NOT work

Do not repeat these.

1. **`supabase functions logs`** — CLI has no logs subcommand. Dead end.
2. **Default Management API `logs.all` with no SQL** — returns a huge dump of PostgREST chatter, not the 401 fingerprint. Use **narrow SQL** against `function_logs` / `function_edge_logs` (see §8).
3. **SQL `event_message like '%agent-api%' and like '%401%'` on `edge_logs`** — empty. The interesting rows are in **`function_logs`** (our `console.warn`) and **`function_edge_logs`** (HTTP line `POST | 401 | …/agent-api`).
4. **SQL using a `path` column** — `Field "path" does not exist`. Filter `event_message` only.
5. **`ai-codex-review final-check`** — dies with `ChildProcess.kill` on this Windows host even after `ai-codex-review doctor` passes. Used an independent read-only subagent review instead (APPROVE).
6. **`sudo docker ps` on both NAS** — `sudo: a terminal is required to read the password`. **`/usr/local/bin/docker ps`** connects then **`permission denied`** on `/var/run/docker.sock` (root:root). Docker is **not** listable over the existing SSH user (`ahazan`) without a password or docker-group. **Next session with broader SSH/root should list containers first.**
7. **`find /volume1 /var/services/homes -name agent-config.json` on NAS** — too slow over these volumes; commands timed out at 25–45s. Prefer **known compose/volume paths** and `docker inspect` once you can see containers (see §6).
8. **This PC (edge-dev, 192.168.2.135)** — no PopDAM folder, no bridge service, no `agent-config.json`, no node cmdline matching `bridge-agent|popdam|agent-config`. The leftover is **not** on this workstation.
9. **Looking only at the public IP** — `74.80.230.82` is office NAT for many machines. It cannot name the host. Internal discovery is required.

---

## 5. Root causes and key findings

**Root cause of #141:** a leftover / duplicate **bridge agent** install on the office LAN is heartbeating as `synology-bridge-1` (`aab7fb4c-2379-4367-a51e-fcec91d0d2ed`) with a **stale agent key** (SHA-256 hash prefix **`901c611d`**). Every ~30s → `invalid_agent_key` 401. The live NAS bridge is a *different process* with the *current* key and is healthy.

**Why it looks like “one agent”:** both processes use the same persisted `agent_id` from a copied `agent-config.json`. The key is what differs.

**Why it will not fix itself:**

- Update commands (`check_update` / `apply_update`) are delivered on a **successful heartbeat**. This leftover 401s, so it **never** gets the new backoff build (1.16.13). It is stuck on old code and will keep firing every 30s until stopped.
- `register` upserts on `agent_name`. Do **not** let the leftover “re-register” to refresh the key — that would steal the key hash from the healthy bridge and invert the outage.

**Config file to look for on the leftover machine** (contains `agent_id` and `agent_key`):

- Linux/Docker: `/data/agent-config.json` (or `POPDAM_DATA_FILE` / `POPDAM_DATA_DIR`)
- Windows (less likely for a *bridge*): `%ProgramData%\PopDAM\agent-config.json`
- Match on `agent_id` **`aab7fb4c-2379-4367-a51e-fcec91d0d2ed`** and/or key hash prefix **`901c611d`**

**What “healthy” looks like:** container name typically `popdam-bridge`, image `ghcr.io/u2giants/popdam-bridge:stable`, on **edgesynology2** only, agent name `synology-bridge-1`, heartbeats succeeding.

---

## 6. Exact next steps

You have SSH to **all three** machines (edgesynology1, edgesynology2, Windows render). Work in order. Stop at each gate.

### Step 1 — Inventory containers/services on all three hosts

On **each** of edgesynology1, edgesynology2, and the Windows machine:

```bash
# Linux/Synology
sudo docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}'
sudo docker ps -a --filter name=popdam --filter name=bridge --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

Windows: check Services, Task Scheduler, and Task Manager for anything named PopDAM / bridge / agent; also `Get-Process node` with a command line mentioning `bridge` or `popdam`.

**You’ll know it worked when:** you can list every PopDAM-related container/process on all three machines and name which host holds more than one bridge/scanner.

### Step 2 — Identify the leftover (do not touch yet)

The leftover is the bridge/scanner that is **not** the single healthy `popdam-bridge` on **edgesynology2**.

Confirm with either:

- `docker inspect` / read the mounted `agent-config.json` and see `agent_id` = `aab7fb4c-2379-4367-a51e-fcec91d0d2ed` **and** it is not the edgesynology2 live container, or
- container/env `AGENT_KEY` / name suggesting an old install (`popdam-bridge-old`, `bridge-agent`, a compose project that is not the live one).

**You’ll know it worked when:** you can say “host X, container/process Y, config path Z” in one sentence.

### Step 3 — Owner gate (Section 0)

Show Albert the inventory in one message. Get a clear yes to **stop (and later remove)** that leftover and **keep** edgesynology2’s live bridge.

**You’ll know it worked when:** Albert has replied yes/no on the three Section 0 items.

### Step 4 — Stop the leftover

```bash
sudo docker stop <leftover-name>
# or kill the node/bridge process on that host
```

Do **not** restart it. Do **not** stop `popdam-bridge` on edgesynology2 unless you are certain it is the leftover (it is not).

**You’ll know it worked when:** `docker ps` / process list on that host no longer shows the leftover, and the live bridge is still up.

### Step 5 — Prove 401s drop to ~0

Wait **2–3 minutes** (old cadence was every 30s). Query production logs (see §8 for exact query). Count `function_logs` events like `agent-api 401` and `function_edge_logs` `POST | 401 | …agent-api`.

**You’ll know it worked when:** zero new 401s for **5+ minutes** after the stop (issue target: “drops to about 0”). Healthy `synology-bridge-1` traffic is still 200s.

### Step 6 — Remove the leftover install (only after Step 5)

Delete the container/compose stack and/or `agent-config.json` copy so it cannot come back on reboot. Record the host name and what was removed.

**You’ll know it worked when:** the host has no PopDAM bridge leftovers and a reboot would not revive them.

### Step 7 — Close out

1. Comment on **#141** with: host found, what was stopped/removed, before/after 401 evidence, and the signature line.
2. Close **#141**.
3. Delete **this** `HANDOFF.d/` file (successor rule) in the same commit that records completion — only if Steps 5–6 are proven.
4. Tell Albert in plain English: which computer it was, what you turned off, and that the login failures stopped.

---

## 7. Constraints and gotchas in force

- **Do not stop or re-key the live `synology-bridge-1` on edgesynology2** to kill the leftover. That is production scanning.
- **Do not `register` / re-pair the leftover** to “make it work.” It must be removed, not rehabilitated (unless Albert explicitly wants a second scanner — Section 0).
- **Never log or paste agent keys, pairing codes, or deploy keys.** Hash prefixes only (`901c611d` is fine).
- **Supabase:** live project is **`qsllyeztdwjgirsysgai`**. The Ohio project is a trap.
- **Shared DB:** no schema/migrations from `popdam3`. This task is process cleanup only.
- **Host changes:** durable OS/config changes belong in `u2giants/ansible`, not ad-hoc — except **break-glass repair of this leftover install**, which is app-layer waste on a machine, not host policy. Call it out if you do it.
- **NAS topology:** edge2 = read/scan; edge1 = writes. A scanner left on edge1 is a prime leftover candidate.
- **Issue #141 “done” means 401s ~0**, not merely “we know which box.”

---

## 8. Access and environment

| Access | Notes |
|---|---|
| SSH `edgesynology1` / `edgesynology2` | Works with BatchMode. Hostnames used by existing scripts. Tailscale seen: `.35` / `.36` on `100.107.131.x`. |
| SSH Windows render machine | **You** have it. Host name/IP not captured here — use whatever SSH alias Albert’s session provides. |
| Docker on NAS | Binary `/usr/local/bin/docker`. Current `ahazan` user **cannot** talk to the socket without sudo password. With full SSH/root you should be able to `sudo docker ps`. |
| GitHub | `gh` authenticated as `u2giants`. Issue/PR comments **must** end with `Posted by <agent> chat <id> on <machine>`. |
| 1Password | Vault **`vibe_coding`**. Use `op://` / `op run`; never paste secrets. Items: `Supabase Runtime Keys - shared POP database (production)` (service keys), `Supabase CLI Personal Access Token` (Management API). Prefer `1password_op_run` + item **IDs** if titles with parentheses fail to resolve. |
| Production logs | Supabase Management API analytics SQL (PAT above): `https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/analytics/endpoints/logs.all?sql=<url-encoded>`. Tables: `function_logs`, `function_edge_logs`. |

**Useful log SQL (URL-encode):**

```sql
select timestamp, event_message from function_logs
where event_message like '%agent-api 401%'
order by timestamp desc limit 20
```

```sql
select timestamp, event_message from function_edge_logs
where event_message like '%agent-api%' and event_message like '%401%'
order by timestamp desc limit 20
```

**Registered agents (PostgREST, service key):**  
`GET https://qsllyeztdwjgirsysgai.supabase.co/rest/v1/agent_registrations?select=id,agent_name,agent_type,last_heartbeat`

---

## 9. Open questions and risks

| Risk / question | Dated | Notes |
|---|---|---|
| Leftover may be on a fourth machine (not one of the three). | 2026-09-23 | Three-machine SSH covers the likely set (two NAS + Windows render). If inventory is clean on all three, scan other office PCs for `agent-config.json` / `popdam-bridge`. |
| Two healthy bridges could appear if someone starts a second compose by mistake. | 2026-09-23 | Always verify **which** container is 200-healthy before stopping anything. |
| Windows `windows-render-agent` heartbeat is stale (hours). | 2026-09-23 | Probably idle/offline, **not** the 401 source (wrong agent_type/id and body size). Do not confuse with this task. |
| After removal, a backup restore of the old config could revive the leftover. | 2026-09-23 | Remove the config file too (Step 6), not just stop the process. |
| PR #145 residual (non-blocking): Windows skips process-restart while `isAuthFailure()` is sticky until next success. | 2026-09-23 | Reviewer noted; only matters for updated agents. Leftover is old code. |

---

## Self-audit (Mode A)

1. **Comprehensive for a brand-new developer?** **Yes** — §1–§9 cover app, goal, live vs missing work, dead ends, root cause, gated next steps, constraints, access, and risks. No prior chat required.
2. **Detailed enough to continue as well as this session?** **Yes** — exact agent_id, key hash prefix, body size, merge SHA, versions, log SQL, and why self-update will not save the leftover (§5).
3. **Every relevant detail included?** **Yes** — background (§1–2), state + proof (§3), failures (§4), findings (§5), actions + verification gates (§6), rules (§7), credentials by location only (§8), open risks (§9).
4. **If Albert read only §0, would he see every decision?** **Yes** — stop/delete authority, which scanner to keep, stop-only vs remove; plus “already settled” so we do not re-ask. Sweep of §1–§9 found no other owner decisions (inventory and log queries are worker actions; closing #141 is worker judgment after evidence).

Posted by Claude chat unknown on edge-dev
