# Plan: Unify PopDAM + PopSG NAS access into one topology-aware agent design

**Status:** proposal / not yet implemented. Written 2026-07-24.
**Owner sign-off required** on the open decisions in §8 before any code is written.
**Audience:** an engineer or AI agent with **zero prior context**. Everything needed
to critique or implement this is either in this document or explicitly linked.

---

## 0. Background — the full picture

### 0.1 What the two products are

- **PopDAM** is an internal **Digital Asset Manager** for licensed consumer-product
  art (Disney, Marvel, Warner Bros, etc.). Source design files (Photoshop `.psd`,
  Illustrator `.ai`, PDFs, TIFFs) live on a **Synology NAS**. The system ingests
  them, generates thumbnails, uploads thumbnails to **DigitalOcean Spaces** (an
  S3-compatible object store), and gives the team a web UI to browse, search, tag,
  and manage artwork against licensing deadlines.
- **PopSG** is a **style-guide library** for licensors — folder-based browsing of
  style guides, no SKUs/ERP. **It is the same codebase and Docker image as PopDAM**;
  the hostname (`dam.designflow.app` vs `sg.designflow.app`) selects the mode at
  runtime. It reads a different NAS share (`styleguides`) but is otherwise the same
  machinery.

The whole system therefore has **two libraries** (DAM assets, SG style guides) that
are, at the storage layer, **two folder trees on the same NAS hardware**.

### 0.2 The moving parts (who does what)

| Component | Repo path | Runs on | Role |
|---|---|---|---|
| React web app | `src/` | Coolify (VPS) | Browse/search/tag UI (both DAM & SG) |
| Edge functions | `supabase/functions/` | Supabase (Deno) | `agent-api` (agents), `helper-api`, admin, auth |
| PostgreSQL | canonical in `u2giants/shared-db` | Supabase | Shared backend for all POP apps |
| Cloud worker | `apps/worker/` | Railway (Node) | AI tagging, ERP sync, style-group rebuild, mirror |
| **Bridge agent** | `apps/bridge-agent/` | **Docker on a NAS** | Scans/crawls NAS, hashes, thumbnails, verifies check-ins |
| **Windows render agent** | `apps/windows-agent/` | Windows VM | Renders `.ai`/PDF source (needs Illustrator/Windows) |
| Desktop Helper | `apps/popdam-helper/` | Electron (designer desktops) | Check-out / check-in of files |

### 0.3 The end-to-end file lifecycle (why the NAS matters)

1. **Art lands on the NAS** (designers/licensors drop files into the share).
2. **Bridge agent scans** the share (metadata only — no file opens for the crawl),
   **hashes** files to detect changes/moves, generates **thumbnails**, and **uploads
   the thumbnails to DigitalOcean Spaces**. It writes rows to Postgres (via
   `agent-api`) describing each file. It does **not** copy the source files anywhere.
3. **Windows render agent** handles files the bridge can't thumbnail on Linux —
   Illustrator `.ai` without a PDF-compatible stream, multi-page PDFs, TIFF
   optimization — by rendering on Windows and **uploading the results to Spaces**.
4. **Web UI** shows the Spaces thumbnails; the source files never leave the NAS for
   browsing.
5. **Designers check out** a file through the **Helper** (copies it from the NAS to
   their machine), edit it, and **check in** (writes the edited file **back to the
   NAS**). The bridge agent's **check-in verifier** confirms the write landed.

**Reads** in this lifecycle: scan, crawl, hash, thumbnail, render-source, checkout-copy.
**Writes**: designer check-ins (Helper), plus any worker mirror/relocation jobs.

### 0.4 How the agents talk to the cloud (pairing + heartbeat)

Agents are **outbound-only**. There is no inbound connection to an agent.

- **Pairing (once):** an operator enters a one-time pairing code; the agent exchanges
  it for a persistent **agent key** (saved to its data volume).
- **Heartbeat (every 30s):** the agent POSTs to `agent-api`, which returns (a) **commands**
  ("run a scan", "crawl style guides", "render these", "sample PDF text") and (b) a
  **config sync** block — including the **NAS credentials/mount info** the agent should
  use. So NAS configuration is **pushed from the cloud** (`admin_config` → `agent-api`
  → heartbeat), not baked into the agent. This is the mechanism this plan changes.

### 0.5 The two NASes and why they're set up this way (critical)

Canonical spec: [`u2giants/synology-monitor` → `docs/NAS_TOPOLOGY.md`](https://github.com/u2giants/synology-monitor/blob/main/docs/NAS_TOPOLOGY.md).
Summary an implementer must internalize:

- There are **two physical Synology units**: `edgesynology1` (`192.168.3.100`) and
  `edgesynology2` (`192.168.3.101`), both joined to Active Directory
  `IML.isaacmorris.com`.
- **All folders exist on both units.** DAM's `mac` share and PopSG's `styleguides`
  share are present on each.
- **Replication is one-way: edge1 → edge2** (edge2 *pulls* from edge1). This was a
  **deliberate mitigation for a history of extensive sync collisions/errors** when
  replication was bidirectional.
- **Consequence — the read/write rule:**
  - **WRITE only on `edgesynology1` (.100).** A write to edge2 is **not** synced back
    and is eventually overwritten — i.e. **silently lost**. This is the single most
    dangerous failure mode in the whole system.
  - **READ on `edgesynology2` (.101)** to take load off edge1, which every
    write-worker already hammers.
- Today the file-scraping agents already point at **edge2** (reads) and designer
  check-ins (USA) already go to **edge1** (writes) — but nothing in the code
  *enforces* that; it's correct by configuration accident, not by construction.

### 0.6 Region note (for completeness)

The **Helper**'s storage transport is region-based: **USA designers** check in over
**SMB to `edgesynology1`** (a write → correct unit); **Brazil designers** use
Seafile/SeaDrive. This plan concerns the **agents'** NAS access, not the Helper's
region logic, but the Helper is the main *write* path and must keep targeting edge1.

---

## 1. Ultimate goals (what success looks like)

This is not just de-duplication. The redesign must deliver, in priority order:

1. **Eliminate the data-loss risk by construction.** After this, it must be
   *structurally impossible* for any agent operation to write to edge2 or to read in
   a way that assumes edge2 is writable. Routing decides the unit; callers cannot.
2. **One NAS identity, not many.** Replace the multiple AD logins with a single
   service account, so there is **one credential to rotate** and **one secret to
   store** (feeds the separate secrets-remediation work — one Vault entry instead of
   two plaintext `admin_config` rows).
3. **DAM and SG treated identically.** They become **two folder roots behind one
   access layer**, not two integrations. Adding a future library is a config row.
4. **Correct load placement.** All reads land on edge2 (offloading edge1); all writes
   on edge1 — enforced centrally.
5. **Operational clarity.** One documented contract an operator/agent can reason
   about, cross-linked to `NAS_TOPOLOGY.md`, with no per-app credential drift.

**Acceptance criteria (how we know it's done):**
- A single AD service account authenticates all agent NAS access for both DAM and SG.
- `WINDOWS_AGENT_SG_NAS_*` (the duplicate SG credential set) no longer exists.
- A unit test proves `resolve(app, 'write')` never returns edge2, for both apps.
- The Windows agent maps both shares from one unit with one credential.
- Rotating the NAS password is a single action (one Vault secret / one AD account).
- Scans, crawls, renders, and check-in verification all still pass end-to-end on
  preview/staging before production cutover.

---

## 2. Scope

**In scope:** how `bridge-agent` and `windows-agent`, and the `agent-api` config that
feeds them, authenticate to and mount the NAS for DAM + SG; the DAM-vs-SG credential
and mount duplication; centralized read/write routing.

**Out of scope (but referenced for correctness):** the Helper's designer check-in
writes and region logic (the write path — must stay on edge1); the Railway worker's
mirror jobs; and the Illustrator/OS rendering logic itself (only its NAS access
changes). Also out of scope: making replication bidirectional again (that is an infra
decision owned elsewhere; if it ever happens, `NAS_TOPOLOGY.md` and this design must
be revisited first).

---

## 3. Current state (as-is), verified 2026-07-24

### 3.1 Two runtimes touch the NAS for files, both read-only

| Runtime | Host | NAS file work | Reads/Writes | Unit today |
|---|---|---|---|---|
| **`apps/bridge-agent`** (Docker) | on `edgesynology2` | DAM scan (`scanner.ts`), SG crawl (`style-guide-crawler.ts`), thumbnails, check-in verify, PDF sampling, AI-sentinel | **read-only** (outputs → DO Spaces) | edge2 ✅ |
| **`apps/windows-agent`** (Windows VM) | separate VM | Illustrator/PDF render of source art (`renderer.ts`) | **read-only** (outputs → DO Spaces) | edge2 (.101) ✅ |

Neither agent writes files back to the NAS — both upload results to DigitalOcean
Spaces (`uploader.ts` → `uploadToSpaces`). Both are **read consumers** correctly on
edge2 today, but by configuration, not by an enforced rule.

### 3.2 The duplication

- **bridge-agent** mounts *both* shares read-only via Docker bind mounts
  (`deploy/synology/docker-compose.yml`): `/volume1/nas-share → /mnt/nas/mac:ro`
  and `/volume1/styleguides → /mnt/nas/styleguides:ro`. Running **on** the NAS, it
  uses no SMB credentials. This side is already effectively unified.
- **windows-agent** carries **two separate NAS profiles**, stored in `admin_config`
  and served by `agent-api/index.ts` (both `nas_*` and `sg_nas_*` blocks in the
  heartbeat), then `net use`-mapped independently by `nas-mapper.ts`:

  | Purpose | admin_config keys | Host | Share | AD user | Drive |
  |---|---|---|---|---|---|
  | DAM (Decor) | `WINDOWS_AGENT_NAS_*` | `192.168.3.101` (edge2) | `mac` | `ahazan` | `Z:` |
  | SG (styleguides) | `WINDOWS_AGENT_SG_NAS_*` | `edgesynology2` (edge2) | `styleguides` | `popdam` | `Y:` |

### 3.3 Why this is a problem

1. **Two AD identities (`ahazan`, `popdam`) for one physical destination** → two
   passwords to rotate, two secret entries, two ways to misconfigure.
2. **The DAM/SG split is fictional at the storage layer** — both shares are on both
   units; the split buys only duplication and drift risk.
3. **No topology rule in code** — both agents happen to point at edge2, but nothing
   enforces "reads → edge2 / writes → edge1." A future write feature pointed at edge2
   would silently lose data (§0.5).
4. **Credentials are plaintext in `admin_config`** (`*_NAS_PASS`) — addressed by the
   separate secrets plan; unification cuts it from two secrets to one.

---

## 4. Target design (to-be)

### 4.1 One NAS-access contract, two folder roots, topology-aware routing

A **single NAS-access profile**, expressed once and delivered to agents by
`agent-api`:

```
nas_access:
  read_unit:   { host: edgesynology2, ip: 192.168.3.101 }   # ALL reads
  write_unit:  { host: edgesynology1, ip: 192.168.3.100 }   # ALL writes
  credential:  <single AD service account>                  # both shares, both units
  roots:
    - { app: dam,   share: mac,         subpath: Decor }
    - { app: popsg, share: styleguides, subpath: "" }
```

- **One credential.** Replace `ahazan` + `popdam` with **one AD service account**
  (e.g. `svc-popdam-nas`) on `IML.isaacmorris.com`, read on both shares on both units
  (and write on edge1 where a write path needs it). *This is the gating infra change.*
- **Reads → `read_unit` (edge2), writes → `write_unit` (edge1)** — encoded in the
  access layer, not per caller. A caller asks for "DAM root" or "SG root" and declares
  read or write; the layer picks the unit.
- **DAM and SG are two `roots` entries**, not two integrations.

### 4.2 Keep two runtimes, unify the contract (recommended) — vs one agent codebase

Illustrator rendering **cannot** run on the Linux bridge, so a single running process
is not achievable. Two shapes:

- **Option A (recommended): one shared NAS-access module + one config contract,
  imported by both agents.** Extract NAS-access into a shared package (mirroring the
  existing `packages/path-filters` "one source of truth, two runtimes" pattern). One
  schema, one credential, one topology rule; the Linux scan/crawl and Windows render
  runtimes remain but stop being two *integrations*. Lower risk, incremental.
- **Option B: merge into one agent codebase with capability flags**
  (`--role=scan|render`), render enabled only on Windows. Cleaner conceptually,
  larger rewrite, higher risk. Defer unless A proves insufficient.

This plan proceeds on **Option A**.

---

## 5. Phased implementation

**Phase 0 — Infra prerequisite (owner + IT).** Create the single AD service account
with read on `mac` + `styleguides` on both units (write on edge1 where needed).
Nothing else starts until this exists.

**Phase 1 — Shared NAS-access contract.** Define the `nas_access` schema (§4.1) and a
shared module both agents import. Add `resolveRoot(app, mode:'read'|'write')` → unit +
path (`read`→edge2, `write`→edge1). Unit-test that `write` never resolves to edge2.

**Phase 2 — `agent-api` serves the unified profile.** Emit the single `nas_access`
block in the heartbeat. Keep emitting the legacy `nas_*`/`sg_nas_*` blocks **in
parallel** for one release so old agents keep working (backward-compatible cutover).

**Phase 3 — `windows-agent` cutover.** `nas-mapper.ts` maps both shares from **one**
unit with **one** credential; read the unified profile; drop the separate SG mapping.
Renderer resolves each job's source via `resolveRoot(app,'read')` → edge2.

**Phase 4 — `bridge-agent` alignment.** Route its bind mounts / root resolution
through the same contract (already reads both shares on edge2; mostly making the rule
explicit and dropping DAM/SG-specific branching).

**Phase 5 — Retire the duplication.** Remove `WINDOWS_AGENT_SG_NAS_*`, fold DAM keys
into the unified profile, delete dead second-credential paths, update `AGENTS.md` and
link `NAS_TOPOLOGY.md`.

Each phase ships and is verified before the next; Phase 2's parallel emit avoids a
big-bang cutover.

---

## 6. Write paths (related, must obey edge1)

Unification must never send a write to edge2. Known write paths:

- **POP DAM Helper** designer check-in — USA designers already write to
  **`edgesynology1`** over SMB (region-based; Brazil uses Seafile). Correct; keep it.
  The unified contract should express it as `resolveRoot(app,'write') → edge1`.
- **Railway worker** mirror/relocation jobs — audit any that touch NAS files; ensure
  they resolve to edge1.

No write path may migrate onto the read (edge2) unit.

---

## 7. Interaction with other in-flight work

- **NAS topology spec** (`synology-monitor/docs/NAS_TOPOLOGY.md`) — the authority for
  the read/write rule this plan encodes. Already merged/PR'd.
- **Secrets remediation** (`admin_config` plaintext → Supabase Vault / env vars) — the
  single NAS credential from this plan becomes **one Vault secret** (admin-editable in
  Settings) instead of two plaintext rows. Sequence: land the single AD account here,
  store it once in Vault there.
- These are complementary: this plan reduces *how many* NAS secrets exist; the secrets
  plan fixes *where* they live.

---

## 8. Open decisions (need owner sign-off before Phase 1)

1. **Single AD service account?** Recommended: replace `ahazan` + `popdam` with one
   `svc-*` AD account scoped to both shares. Confirm IT can create it and which
   shares/units need write vs read. *(Blocks everything.)*
2. **Option A vs B** (§4.2). Recommend A.
3. **Credential home** — Vault (admin-editable) vs env var for the one NAS credential.
   Recommend Vault, since operators change NAS passwords from Settings.
4. **Windows renderer read-offload** — it already reads from edge2; confirm that stays
   so we can hard-code read→edge2 for it.

---

## 9. Risks & rollback

- **AD account misscoping** could break scans/renders — test read on both shares
  before cutover; keep legacy keys during Phase 2 for instant rollback.
- **Windows `net use` quirks** (stale mappings, drive-letter collisions) — `nas-mapper`
  already deletes stale mappings; retain that.
- **Rollback:** because Phase 2 emits both old and new config, reverting an agent to
  the legacy path is a config toggle, not a redeploy.

---

## 10. Glossary

- **edge1 / `edgesynology1` / .100** — the **write** NAS. Source of truth. All file
  modifications go here.
- **edge2 / `edgesynology2` / .101** — the **read** replica (pulls from edge1). Reads
  go here to offload edge1. **Never write here** (lost on next pull).
- **DAM** — PopDAM asset library (`mac` share, `Decor` subtree).
- **SG / PopSG** — style-guide library (`styleguides` share).
- **Bridge agent** — Linux Docker agent running on a NAS; scans/crawls/thumbnails.
- **Windows render agent** — Windows VM agent; renders Illustrator/PDF source.
- **Helper** — designer desktop app for check-out/check-in (the main write path).
- **DO Spaces** — DigitalOcean Spaces, S3-compatible store where thumbnails/renders go.
- **agent-api** — Supabase edge function agents heartbeat to; pushes commands + NAS
  config to agents.
- **Heartbeat** — the 30s agent→cloud poll that delivers commands and config.
- **AD** — Active Directory `IML.isaacmorris.com`; both NAS units are joined; SMB
  logins are AD domain accounts.

---

## 11. Code touchpoints (for the implementer)

- `apps/bridge-agent/src/{scanner,style-guide-crawler,thumbnailer,checkin-verifier}.ts`
- `apps/windows-agent/src/{nas-mapper,renderer,config,uploader}.ts`
- `supabase/functions/agent-api/index.ts` — NAS config serving (`nas_*` / `sg_nas_*`)
- `deploy/synology/docker-compose.yml` — bridge bind mounts
- `admin_config` keys — `WINDOWS_AGENT_NAS_*`, `WINDOWS_AGENT_SG_NAS_*`, `NAS_HOST`,
  `NAS_SHARE`, `SCAN_ROOTS`, `STYLE_GUIDE_SCAN_ROOTS`
- Consider a new `packages/nas-access` (mirror `packages/path-filters` dual-runtime
  pattern) for the shared contract.
