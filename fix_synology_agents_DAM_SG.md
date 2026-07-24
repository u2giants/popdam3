# Plan: Unify PopDAM + PopSG NAS access into one topology-aware agent design

**Status:** proposal / not yet implemented. Written 2026-07-24.
**Owner sign-off required** on the open decisions in §7 before any code is written.

> Read [`u2giants/synology-monitor` → `docs/NAS_TOPOLOGY.md`](https://github.com/u2giants/synology-monitor/blob/main/docs/NAS_TOPOLOGY.md)
> first. This plan assumes that document's rules: **two units, one-way sync
> edge1 → edge2, READ on `edgesynology2` (.101), WRITE on `edgesynology1` (.100),
> all folders on both units.**

---

## 1. Objective

Today PopDAM (the asset/Decor library) and PopSG (the style-guide library) reach
the Synology NASes through **separate, duplicated credential + mount profiles**,
as if they were different systems. They are not: they are the **same two physical
units**, with **all folders present on both**, differing only by *role* (read vs
write). Collapse that duplication into **one topology-aware NAS-access model** —
one credential, one config contract, one read/write routing rule — shared by both
the Linux scan/crawl runtime and the Windows render runtime.

Goal state in one line: **DAM and SG are two folder trees behind one NAS-access
layer, not two NAS integrations.**

---

## 2. Scope

**In scope:** how the `bridge-agent` and `windows-agent` (and the edge-function
config that feeds them) authenticate to and mount the NAS for DAM + SG; the
DAM-vs-SG credential/mount duplication; topology-aware read/write routing.

**Out of scope (but noted):** the POP DAM Helper's designer check-in writes and the
Railway worker's mirror — these are the *write* paths and must target edge1; they
are referenced in §6 for correctness but are not being merged into the agent.
Illustrator/OS-level rendering logic itself is unchanged; only its NAS access is.

---

## 3. Current state (as-is), verified 2026-07-24

### 3.1 Two runtimes touch the NAS for files

| Runtime | Host | What it does with NAS files | Reads/Writes | Unit today |
|---|---|---|---|---|
| **`apps/bridge-agent`** (Docker) | on `edgesynology2` | DAM asset scan (`scanner.ts`), SG crawl (`style-guide-crawler.ts`), thumbnails, check-in verify, PDF sampling, AI-sentinel | **read-only** (outputs → DO Spaces) | edge2 ✅ |
| **`apps/windows-agent`** (Windows VM) | separate VM | Illustrator/PDF render of source art | **read-only** (outputs → DO Spaces) | edge2 (.101) ✅ |

Neither agent writes files back to the NAS — both upload results to DigitalOcean
Spaces (`uploader.ts` → `uploadToSpaces`). So both are **read consumers** and
both correctly sit on edge2 today, though by accident of configuration rather than
by an explicit rule.

### 3.2 The duplication

- **bridge-agent** mounts *both* shares read-only via Docker bind mounts
  (`deploy/synology/docker-compose.yml`): `/volume1/nas-share → /mnt/nas/mac:ro`
  and `/volume1/styleguides → /mnt/nas/styleguides:ro`. Because it runs **on** the
  NAS, it uses no SMB credentials at all. This side is already effectively unified.
- **windows-agent** carries **two completely separate NAS profiles**, served by
  `agent-api` and stored in `admin_config`:

  | Purpose | admin_config keys | Host | Share | AD user | Drive |
  |---|---|---|---|---|---|
  | DAM (Decor) | `WINDOWS_AGENT_NAS_*` | `192.168.3.101` (edge2) | `mac` | `ahazan` | `Z:` |
  | SG (styleguides) | `WINDOWS_AGENT_SG_NAS_*` | `edgesynology2` (edge2) | `styleguides` | `popdam` | `Y:` |

  `agent-api/index.ts` serves both blocks in the heartbeat (`nas_*` and `sg_nas_*`);
  `windows-agent`'s `nas-mapper.ts` `net use`-maps each share independently.

### 3.3 Why this is a problem

1. **Two AD identities (`ahazan`, `popdam`) for one physical destination.** Two
   passwords to rotate, two Vault/1Password entries, two ways to be misconfigured.
2. **The DAM/SG split is fictional at the storage layer** — both shares are on both
   units; the split buys nothing but duplication and drift risk.
3. **No explicit topology rule in code.** Both agents happen to point at edge2, but
   nothing enforces "reads → edge2." A future write feature could be pointed at
   edge2 and silently lose data (the exact failure `NAS_TOPOLOGY.md` warns about).
4. **Config lives in `admin_config` as plaintext** (`*_NAS_PASS`) — being addressed
   separately in the secrets plan; unification reduces it from two secrets to one.

---

## 4. Target design (to-be)

### 4.1 One NAS-access contract, two folder roots, topology-aware routing

Introduce a **single NAS-access profile** that both runtimes consume, expressed
once and delivered to agents by `agent-api`:

```
nas_access:
  read_unit:   { host: edgesynology2, ip: 192.168.3.101 }   # all reads
  write_unit:  { host: edgesynology1, ip: 192.168.3.100 }   # all writes
  credential:  <single AD service account>                  # both shares, both units
  roots:
    - { app: dam,  share: mac,         subpath: Decor }
    - { app: popsg, share: styleguides, subpath: "" }
```

- **One credential.** Replace `ahazan` + `popdam` with **one AD service account**
  (e.g. `svc-popdam-nas`) on `IML.isaacmorris.com`, granted read on both shares on
  both units (and write where the write path needs it). This is the single most
  important infra change and gates the rest — see §7.
- **Reads resolve to `read_unit` (edge2), writes to `write_unit` (edge1)** — encoded
  in the access layer, not left to each caller. A caller asks for "the DAM root" or
  "the SG root" and declares read or write; the layer picks the unit.
- **DAM and SG become two `roots` entries**, not two integrations. Adding a third
  library later is a config row, not a new credential set.

### 4.2 Keep two runtimes, unify the contract (recommended) — vs one agent codebase

Illustrator rendering **cannot** run on the Linux bridge, so a literal single
running process is not achievable. Two viable shapes:

- **Option A (recommended): one shared NAS-access module + one config contract,
  consumed by both agents.** Extract the NAS-access logic into a shared package
  (`packages/nas-access` or reuse `packages/path-filters` conventions) that both
  `bridge-agent` and `windows-agent` import. One config schema, one credential, one
  topology rule; the two runtimes remain (Linux scan/crawl, Windows render) but are
  no longer two *integrations*. Lower risk, incremental.
- **Option B: merge into one agent codebase with capability flags** (`--role=scan`,
  `--role=render`), rendering enabled only on Windows. Cleaner conceptually, larger
  rewrite, higher risk. Defer unless Option A proves insufficient.

This plan proceeds on **Option A**.

---

## 5. Phased implementation

**Phase 0 — Infra prerequisite (owner + IT).**
Create the single AD service account with read on `mac` + `styleguides` on both
units (and write on edge1 where needed). Nothing else starts until this exists.

**Phase 1 — Shared NAS-access contract.**
- Define the `nas_access` schema (§4.1) and a shared module both agents import.
- Add topology-aware resolution: `resolveRoot(app, mode: 'read'|'write')` → unit +
  path. `read` → edge2, `write` → edge1.
- Unit-test the routing (write never resolves to edge2).

**Phase 2 — `agent-api` serves the unified profile.**
- Emit the single `nas_access` block in the heartbeat.
- Keep emitting the legacy `nas_*` / `sg_nas_*` blocks **in parallel** for one
  release so old agents keep working (backward-compatible cutover).

**Phase 3 — `windows-agent` cutover.**
- `nas-mapper.ts` maps both shares from **one** unit with **one** credential.
- Read the unified profile; drop the separate SG mapping path.
- Renderer resolves each job's source via `resolveRoot(app,'read')` → edge2.

**Phase 4 — `bridge-agent` alignment.**
- Point its bind mounts / root resolution through the same contract (it already
  reads both shares on edge2; this is mostly making the rule explicit and dropping
  any DAM/SG-specific branching).

**Phase 5 — Retire the duplication.**
- Remove `WINDOWS_AGENT_SG_NAS_*` (and fold DAM keys into the unified profile).
- Delete the now-dead second-credential code paths.
- Update `AGENTS.md` and link `NAS_TOPOLOGY.md`.

Each phase ships and is verified before the next; Phase 2's parallel emit means no
big-bang cutover.

---

## 6. Write paths (related, must obey edge1)

Unification must not accidentally send a write to edge2. Known write paths:

- **POP DAM Helper** designer check-in — for USA designers this already writes to
  **`edgesynology1`** over SMB (region-based; Brazil uses Seafile). This is correct
  (writes → edge1) and must stay that way; the unified contract should express it as
  `resolveRoot(app,'write') → edge1`.
- **Railway worker** mirror/relocation jobs — audit any that touch NAS files and
  ensure they resolve to edge1.

No write path should be migrated onto the read (edge2) unit.

---

## 7. Open decisions (need owner sign-off before Phase 1)

1. **Single AD service account?** Recommended: replace `ahazan` + `popdam` with one
   `svc-*` AD account scoped to both shares. Confirm IT can create it and which
   shares/units it needs write vs read on. *(Blocks everything.)*
2. **Option A vs B** (§4.2). Recommend A (shared module, keep two runtimes).
3. **Credential home** — ties into the secrets plan: the one NAS credential becomes
   a **single Supabase Vault secret** (admin-editable in Settings) instead of the
   current two plaintext `admin_config` rows. Confirm Vault (vs env var) for it.
4. **Read-offload for the Windows renderer** — it already points at edge2; confirm
   that's intended to stay (renderer only reads source art) so we can hard-code
   read→edge2 for it.

---

## 8. Impact / benefits

- **One credential, one Vault secret** to rotate instead of two (AD accounts).
- **Impossible-by-construction** to point a read at edge1 or a write at edge2 once
  routing is centralized.
- **Adding a future library** (a third folder tree) is a config row, not a new
  integration.
- Removes ~2 duplicate config sets and the associated drift risk.

## 9. Risks & rollback

- **AD account misscoping** could break scans/renders — mitigate by testing read on
  both shares before cutover; keep legacy keys during Phase 2 for instant rollback.
- **Windows `net use` quirks** (stale mappings, drive-letter collisions) — `nas-mapper`
  already handles stale-mapping deletion; retain that.
- **Rollback:** because Phase 2 emits both old and new config blocks, reverting the
  agent to the legacy path is a config toggle, not a redeploy.

---

## 10. Cross-references

- NAS topology & read/write rule: `u2giants/synology-monitor` → `docs/NAS_TOPOLOGY.md`
- Secrets placement (Vault vs env for the NAS credential): the secrets remediation
  plan (admin_config → Vault/env).
- Current code: `apps/bridge-agent/src/{scanner,style-guide-crawler,thumbnailer}.ts`,
  `apps/windows-agent/src/{nas-mapper,renderer,config}.ts`,
  `supabase/functions/agent-api/index.ts` (NAS config serving),
  `deploy/synology/docker-compose.yml` (bridge bind mounts).
