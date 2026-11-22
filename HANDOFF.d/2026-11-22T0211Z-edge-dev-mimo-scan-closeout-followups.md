---
issue: none
status: OPEN
owner: mimo/edge-dev-scan-closeout-wrap-up
---

`issue: none` because this handoff carries wrap-up leftovers (one pending owner
question, one watch item, one tooling re-run) and the scope freeze at wrap-up
forbade opening a tracker. Open an issue the moment step 6.2 below starts.

# Scan-error and name-flip closeout — deferred follow-ups

Session: MiMo chat `ses_ffe5e0bb44c1affezaBYaa3rhu` on machine `edge-dev`,
2026-11-19 → 2026-11-22. This file is the wrap-up handoff for a fully shipped
workstream: everything in §3 is DONE and live-proven. What remains is one owner
decision, one watch item, and one unfinished tooling check.

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**One question — ask it first, in a single message, before doing anything else:**

- **Fix the scan-start bug for automations, or leave it?** Starting a background
  file scan through the service key (the route an automation would use) is
  rejected; the website's Scan Now button works fine. Recommendation: **yes,
  fix it** — it is a one-line change (map the system caller to null, exactly
  like the neighbouring handler already does) plus a quick live check. Blocks
  step 6.2. A wrong guess here is recoverable; nothing else depends on it.

**Already settled — do NOT re-ask:**

- 2026-11-19 (owner, via issue #1198): artwork deleted from the NAS **keeps its
  catalog record**. The earlier "hide records whose file is gone" behaviour
  (2026-11-18, issue #1117) was reversed. Only records proven to live at
  another path may be hidden. Read #1198 before touching any missing-file logic.
- 2026-11-18: leftover "sibling request" rows are harmless and optional to
  clear. Done: cleared down to 3 young rows (2026-11-19).
- 2026-11-19: the repeated `asset_path_history` rows stay in place — harmless
  dated events, not batch duplicates (evidence on issue #1195's closing comment).
- 2026-11-19 / 2026-11-20: the name-flip defect is FIXED and shipped (issues
  #1195, #1233, both closed with live proof). Do not redo any part of it.

## 1. What this application is

PopDAM is POP Creations' digital asset manager: a web catalog of the design
files (PSD, AI, PDF, TIFF …) that live on the company's Synology NAS. Staff
search and browse it at https://dam.designflow.app. Source:
<https://github.com/u2giants/popdam3> (branch `main` is the release branch).

Moving parts relevant here:

- **Bridge agent** — a Node container on the NAS (`edgesynology1`) that scans
  the design folders, hashes files, makes thumbnails and reports to the cloud.
  Released only by a version bump in
  [apps/bridge-agent/package.json](https://github.com/u2giants/popdam3/blob/main/apps/bridge-agent/package.json);
  the NAS applies `:stable` on request (Settings → Agents).
- **agent-api** — Supabase edge function holding the ingest, move detection,
  scan-progress and render-queue routes:
  <https://github.com/u2giants/popdam3/blob/main/supabase/functions/agent-api/index.ts>
- **Supabase project** `qsllyeztdwjgirsysgai` (Virginia) — scan state lives in
  `admin_config` rows (`SCAN_PROGRESS`, `SCAN_HISTORY`), asset rows in `assets`,
  move history in `asset_path_history`.
- Router for everything else:
  <https://github.com/u2giants/popdam3/blob/main/AGENTS.md>

## 2. What we set out to do this session, and why

Two jobs, both done:

1. Execute section 6 (loose ends A–E) of the predecessor handoff
   [`HANDOFF.d/2026-11-19T0400Z-hetz-claude-scan-1117-loose-ends.md`](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-19T0400Z-hetz-claude-scan-1117-loose-ends.md),
   starting with item A: open an issue for the roughly five files that failed on
   every NAS scan, find the cause, fix it, prove a scan with zero errors.
2. After that closed, the owner said "yes" to my offer to fix the name-flip
   defect (one file's record flip-flopping between two spellings of its name,
   spamming history and looking like duplicate catalog entries).

## 3. Current state — what is true right now

**Everything shipped, merged, deployed and live-proven. Nothing half-done.**

Workstream 1 — scan errors (issue [#1195](https://github.com/u2giants/popdam3/issues/1195), CLOSED):

- Cause found and documented on the issue: the ~5 per-file errors were ingest
  calls that exhausted their 5 retries while the bridge itself had piled ~1,800
  uncoalesced progress calls onto a slowed cloud API. They were timeout
  exceptions on whatever files were in flight — **not** five broken files.
- Fix was already live before the issue existed: PR
  [#1189](https://github.com/u2giants/popdam3/pull/1189) / bridge **1.16.31**
  (single-flight progress), deployed on the NAS 2026-11-18 9:36 PM EST.
- Observability gap closed by PR
  [#1197](https://github.com/u2giants/popdam3/pull/1197) / bridge **1.16.32**:
  the bridge now puts a per-file error summary into `SCAN_HISTORY[].error` and
  ships its log tail in heartbeats (`metadata.log_tail`). API contract updated:
  [docs/API_CONTRACTS.md](https://github.com/u2giants/popdam3/blob/main/docs/API_CONTRACTS.md).
- Proof: eight consecutive scans with `errors: 0` (2026-11-18 11:36 PM EST →
  2026-11-19 9:25 PM EST, including two acceptance scans with real ingest
  activity). Handoff items B–E also closed: `completed_with_warnings` visible in
  the live site (Settings → scan diagnostics and the Live Scan Monitor, checked
  in a browser 2026-11-19 10:25 AM EST); sibling rows down to 3 young ones;
  duplicate-history question answered "leave them" with evidence.

Workstream 2 — name flip (issue [#1233](https://github.com/u2giants/popdam3/issues/1233), CLOSED):

- Cause: `requireString` trimmed the filename at ingest
  ([validators.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/validators.ts)),
  so two real disk files named ` AAQ44DYPN01_art.ai` (leading space) and
  `AAQ44DYPN01_art.ai` compared equal; move detection flip-flopped one record
  between their paths (117 history rows, Aug 20 – Nov 13, 2026).
- Fix: PR [#1235](https://github.com/u2giants/popdam3/pull/1235) (ingest keeps
  exact names; move detection matches exact basenames via
  [move-candidates.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/move-candidates.ts)),
  PR [#1237](https://github.com/u2giants/popdam3/pull/1237) (Library shows the
  name from the exact path basename), PR
  [#1239](https://github.com/u2giants/popdam3/pull/1239) (name spaces render
  visibly — `white-space: pre`).
- Proof (on the issue): two full scans on the fixed ingest wrote **0** new
  history rows (the flip-flopping asset is still 117 rows, newest 2026-11-13
  10:53 EST) and the live Library shows the twins as distinguishable names
  (frontend build `abc853d`, 2026-11-19 9:30 PM EST).

Deferred at wrap-up (the reason this file exists):

1. **Scan-start bug for automations** — see §0 and §6.2. Documented as
   [KNOWN_QUIRKS #82](https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md)
   in this same docs change.
2. **Watch item** — the intermittent 4-error scan class (see §9).
3. **`ai-shared-db-closeout-check` receipt** — not produced (see §4/§6.3).

Committed/deployed status: all four PRs above are MERGED on `main`; edge
functions auto-deployed (workflow "Deploy Supabase Edge Functions", success);
frontend published ("Publish Frontend Image", success) and verified live; the
NAS bridge runs **1.16.33** (someone shipped further bridge releases after
1.16.32; nothing here depends on them). This docs change is its own PR.

## 4. Everything we tried that did NOT work

- **Reading Supabase logs via the Management API.** The documented PAT
  (1Password item `3t2xoqk5luyz7ffgdhj24gvtpq`) authenticates, but the
  analytics log endpoints returned 404 on all three shapes tried
  (`GET/POST /v1/projects/<ref>/analytics/endpoints.logs`, `/…/logs/query`).
  Do not spend another cycle guessing endpoint paths; the post-1.16.32
  `SCAN_HISTORY[].error` route is the supported way to see per-file errors.
- **Reading bridge Docker logs over SSH on the NAS** (`edgesynology1`, users
  `ahazan` and `ai`): the Docker socket is permission-denied,
  `/volume1/@docker` is root-owned, `sudo` needs a password. This is the dead
  end the predecessor session hit too; moot since 1.16.32 ships the strings to
  the database.
- **`trigger-scan` via the service key** → HTTP 500 `invalid input syntax for
  type uuid: "system"` (the quirk in §5). Worked around with the website's
  Scan Now button — that path is verified working.
- **The predecessor's working hypothesis** ("expect the same few files each
  run") was wrong. The errors were timeout exceptions on whichever ingest calls
  happened to be in flight during the API slowdown; after 1.16.31 the same
  scans are clean, which also rules out permanently-broken files. Do not go
  hunting for "the five files".
- **`ai-shared-db-closeout-check`** (wrap-up gate): started twice on
  `edge-dev`; every `ai-gh` call sat in a shared admission queue 86–195 s and
  the run blew a 10-minute tool timeout partway through call 4 of an unknown
  total. Not completed; next session must run it to a receipt (§6.3).
- Not applicable / skipped: no DesignFlow repo involved (ship skill check:
  origin is `u2giants/popdam3`, not one of the `popcre/designflow-*` names), no
  shared-db claims held at any point in this session (only read-only SELECTs
  through the app's admin API), no sub-agents dispatched.

## 5. Root causes and key findings

- **Per-file scan errors (the 7/6/5/5 pattern).** Bridge versions before 1.16.31
  sent running-scan progress fire-and-forget with retries and no coalescing.
  During cloud API slowdowns (up to 150 s, 504s) ~1,800 progress calls piled
  up and a handful of ingest calls exhausted their 5 retries →
  `File processing failed: The operation was aborted due to timeout` →
  `counters.errors++`. Evidence: the docker-log read recorded on
  [#1186](https://github.com/u2giants/popdam3/issues/1186) and the fix commit
  message of
  [685aac30](https://github.com/u2giants/popdam3/commit/685aac30aadb2d8aaa4033194d41f2ee368a188d).
- **From 1.16.32 on, every terminal `SCAN_HISTORY` entry carries `error` text
  when `errors > 0`** (file + message samples). For ANY future "why did this
  scan report errors?" question, read that field first —
  [scan-history.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/scan-history.ts)
  caps it at 500 chars. Heartbeats also carry `metadata.log_tail`.
- **Name flip.** `requireString` trims (by design, for ordinary fields); using
  it for `filename` made whitespace-twin disk files collide in the #51 move
  guard ("same quick_hash + same name = a move"). The fix keeps two invariants:
  ingest stores the name byte-for-byte (`requireExactString`), and move
  detection matches the **exact basename of `relative_path`** on both sides
  (`pickMoveCandidate`). Legacy rows self-heal to exact names on their next
  ingest; until then the UI shows the true name because it reads the path
  basename. Quirk context:
  [KNOWN_QUIRKS #51](https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md)
  and the new **#82** (same file, added by this change).
- **`completed_with_warnings`** is the normal healthy label while unresolved
  licensing exists (64–88 licensors per scan); `completed_with_errors` appears
  whenever `errors > 0` — label logic lives at
  [apps/bridge-agent/src/index.ts](https://github.com/u2giants/popdam3/blob/main/apps/bridge-agent/src/index.ts)
  (`finalStatus`).

## 6. Exact next steps

1. **Put the §0 question to the owner in one message.** You'll know it worked
   when he answers fix-or-leave on the scan-start bug.
2. **If he says fix:** in `handleTriggerScan`
   ([agent-handlers.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/admin-handlers/agent-handlers.ts#L167)),
   map the service caller to `null` exactly as `handleTriggerAgentUpdate` does
   (its `const actorId = userId === "system" ? null : userId;` near line 714),
   and use `actorId` for `requested_by`/`updated_by`. Branch → PR → merge (the
   AI merges; never push `main`). You'll know it worked when
   `{"action":"trigger-scan"}` called with the service-role key returns
   `ok: true` and a scan starts (read `SCAN_PROGRESS` afterwards).
3. **Re-run `ai-shared-db-closeout-check --session-id ses_ffe5e0bb44c1affezaBYaa3rhu`**
   when the local `ai-gh` admission queue is moving (on `edge-dev` on
   2026-11-22 each call waited 86–195 s; budget 25+ minutes or run it on
   `hetz`). You'll know it worked when the receipt shows zero owned open
   claims and zero owned preview/merge/production stages. Paste the receipt
   into the closing note of whatever issue step 6.2 opens (or this file's
   successor).
4. **Watch item — intermittent per-file scan errors.** One scan on 2026-11-19
   (10:20 AM EST, bridge 1.16.31) reported 4 errors of an unidentified class
   while its neighbours were clean; 1.16.32 was shipped precisely so the next
   occurrence names itself. If `SCAN_HISTORY` shows `completed_with_errors`
   again: read the entry's `error` text (file + message), open an issue with
   that string as the evidence, and fix or rule on warning-vs-error there. Do
   not guess from counters alone. You'll know it worked when the cause is
   named from `SCAN_HISTORY[].error` and either fixed or ruled.
5. **Successor review — retire the predecessor handoff.**
   [`HANDOFF.d/2026-11-19T0400Z-hetz-claude-scan-1117-loose-ends.md`](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-19T0400Z-hetz-claude-scan-1117-loose-ends.md)
   (owner: claude session `41071afb` on `hetz`) lists loose ends A–E of issue
   #1117 — all five are done (this session; proof on #1195's closing comment).
   Its §9 risks are superseded (the 9,447 hidden records were reversed by the
   #1198 owner ruling; the recurring errors are fixed; the NAS bridge version
   is verified). Apply the successor rule — predecessor's work landed ✓,
   obligations carried here ✓, nothing unique left ✓ — then delete that file
   in the commit that does the next step, and grep for references to it. You'll
   know it worked when the file is gone and no doc still points at it.

## 7. Constraints and gotchas in force

- Never push directly to protected `main`; branch + PR; the AI merges (plain
  `gh pr merge`, no `--admin`/`--squash`). Prose-only PRs merge after
  `bin/ai-doc-safety` passes on the exact head.
- A bridge release is **only** a version bump in
  [apps/bridge-agent/package.json](https://github.com/u2giants/popdam3/blob/main/apps/bridge-agent/package.json);
  never modify the bridge self-updater. The NAS applies the update on request
  (Settings → Agents → Check for Update / Update to Latest).
- Production database is read-only by default; live actions go through the
  application's own admin functions (the website buttons / `admin-api` actions
  with a real user session). Edge functions deploy automatically on merge to
  `main`.
- Several other sessions work this repo concurrently (e.g. issue #1198 work);
  fetch before branching, stage only your own files, never tidy another
  session's `HANDOFF.d/` file.
- Quote every human-facing time in EST (New York).
- Bridge test suite has pre-existing Windows-only failures
  (`stale-record-retirement`, `snapshot-tools`, `liveness-watchdog` — POSIX
  path/SIG assumptions). They pass on Linux CI; do not "fix" them locally.

## 8. Access and environment

- **GitHub**: `gh` signed in as `u2giants` (keyring) on this machine
  (`edge-dev`, Windows). Repo `u2giants/popdam3`.
- **Database reads**: `admin-api` action `run-query` (SELECT only) with the
  service-role key — 1Password vault `vibe_coding`, item `3hhxwrljnaq2tykxi7hplq5ryi`,
  field `SUPABASE_SECRET_KEY`, referenced only as an `op://` secret (never
  inline). Endpoint `https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/admin-api`.
- **Website admin actions**: DAM administrator tester login — vault `vibe_coding`,
  item `7s5uzpbjenka4fpvrqogh44bre` (email/password on the sign-in page, not
  SSO). Scan Now, Scan Diagnostics and the Library were all verified through it.
- **NAS**: SSH alias `edgesynology1` (users `ahazan` and `ai` both work;
  read-only listing of `/volume1/mac` is fine and fast; Docker and `sudo` are
  not available — see §4).
- **Supabase Management PAT**: vault `vibe_coding`, item
  `3t2xoqk5luyz7ffgdhj24gvtpq` — authenticated but its log endpoints 404 (§4).
- No sub-agents, no shared-db claims, no open PRs at wrap-up time.

## 9. Open questions and risks

- **2026-11-19**: the 4-error class from the 10:20 AM EST scan is still
  unidentified (intermittent — scans before and after it were clean). 1.16.32
  was shipped to make the next occurrence self-describing; until then nobody
  can name those four files. Risk if ignored: the housekeeping complaint from
  #1117 ("completed with errors" as the normal result) can come back in a mild
  form without explanation.
- **2026-11-22**: the wrap-up gate `ai-shared-db-closeout-check` has no receipt
  on this machine (admission-queue stall). The session holds no claims (it
  never issued a claim operation; only read-only SELECTs and app admin
  functions), but the receipt is the standing proof — produce it (§6.3).
- **2026-11-19**: the `filename` columns of legacy whitespace-twin rows stay
  trimmed until those files change on disk; the UI is truthful meanwhile
  because it reads the path basename. If anyone scripts off `assets.filename`,
  tell them the path's basename is the exact name (post-#1233).
- Predecessor's §9 items are superseded as noted in §6.5 — do not revive them
  without reading issue #1198's owner ruling first.

---

## Self-audit (2026-11-22T0211Z)

1. *Could a newcomer continue without a question?* Yes — §1 gives the system,
   §3 the exact shipped state with issue/PR URLs, §6 the ordered next actions
   with verification gates. The only open judgement is phrased as a question to
   the owner in §0, which step 6.1 says to ask first.
2. *As well as the author?* Yes — §5 holds the non-obvious causes (progress
   storm, filename trim) with commit/file references; §4 holds every dead end
   (logs API, NAS docker logs, service-key trigger, the wrong "five files"
   hypothesis) so nobody repeats them; §8 names every credential location.
3. *Every relevant detail?* Yes — background (§1), goals (§2), current state
   and deploy status (§3), failures (§4), root causes (§5), exact next steps
   with gates (§6), constraints (§7), access (§8), risks (§9). Verification
   evidence is cited where it lives (closing comments on #1195 and #1233).
4. *If the owner read only §0, would he see every business decision and no
   technical approval?* Yes — §0 carries the single pending judgement (fix the
   scan-start bug) with a recommendation and what it blocks, plus the settled
   list including the 2026-11-19 owner ruling on deleted artwork that must not
   be re-asked. Swept §1–§9 line by line: the only other owner-shaped items are
   the watch item and the tooling receipt (technical, routed to §6 steps, not
   to Albert) and the successor review (housekeeping, §6.5).
