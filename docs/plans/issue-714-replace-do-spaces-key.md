# Plan: Replace the exposed DigitalOcean Spaces storage key (u2giants/popdam3#714)
Issue: https://github.com/u2giants/popdam3/issues/714
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 0 | Confirm the exposure class (rotate, not redact) | ⬜ open | Reasoning in §6; decision LOCKED in §8 |
| 1 | Obtain a DigitalOcean API token or signed-in console session | ⬜ open | **Blocked** — none exists (§6, §13). Record `Blocked —` on #714 if still true |
| 2 | Create the new Spaces access key pair in DO | ⬜ open | |
| 3 | Store the new pair in 1Password (same item, new fields; keep the old pair until step 8) | ⬜ open | |
| 4 | Write the new pair into `admin_config` via the admin-api `set-config` route | ⬜ open | |
| 5 | Confirm each consumer picked it up (edge functions, Railway worker, bridge, Windows agent) | ⬜ open | |
| 6 | Live proof: thumbnail upload and delete with the new key | ⬜ open | `- [ ] live proof` on #714 |
| 7 | Revoke the old key pair in DO; prove the old key is refused | ⬜ open | |
| 8 | Archive the old values in 1Password; delete `fix_admin_config_secret_rotation.md`; fix `docs/INFRASTRUCTURE.md:34` | ⬜ open | |
| 9 | Close #714 (and the DO row of #213 if still open) with evidence | ⬜ open | |

Where a fresh session starts: **Step 1.** Everything after it is mechanical; step 1 is the only thing that has blocked this since 2026-10-07.

---

## 1. The ultimate goal

The company's picture library (PopDAM / PopSG thumbnails, renders, mirrored installer downloads) lives in one DigitalOcean Spaces bucket called `popdam`. For roughly four months in 2026 the key that can read, write and delete everything in that bucket was readable by any signed-in user of any POP app, and (until 2026-10-07) by anyone on the internet who could call an unauthenticated agent route. Every other secret from that exposure has been replaced. This one has not. **When this plan is done, the key that was exposed no longer works anywhere, a new key that was never exposed does the same job, and thumbnails still upload and delete normally.**

If a step conflicts with this goal, the goal wins — stop and flag it. In particular: never leave the system with *no* working key (thumbnails would stop), and never revoke the old key before the new one is proven to work end to end.

## 2. What this application is

PopDAM (dam.designflow.app) and PopSG (sg.designflow.app) are POP Creations' internal digital-asset manager and style-guide library. One React/Vite frontend (this repo, `src/`), Supabase edge functions (`supabase/functions/`, project `qsllyeztdwjgirsysgai`, Virginia), a Railway worker (`apps/worker/`), an on-prem Synology "bridge" agent (`apps/bridge-agent/`, Docker on NAS `edgesynology1`), a Windows render agent (`apps/windows-agent/`), and a desktop helper (`apps/popdam-helper/`). Repo `u2giants/popdam3`, default branch `main`, machine `hetz` is the production VPS where AI sessions run. Object storage is DigitalOcean Spaces, bucket `popdam`, region `nyc3`, CDN `cdn.designflow.app` (AGENTS.md:253).

## 3. What triggered this work

- 2026-07-24: `public.admin_config` had an RLS read policy `USING (true)` for `authenticated`; 8 plaintext secrets were readable by any logged-in user (memory `project_admin_config_secret_exposure`; `fix_admin_config_secret_rotation.md`). Leak fixed same day (shared-db PR #204).
- 2026-10-07 (#210/#213): the `agent-api` `register` route was unauthenticated and its heartbeat response carries `do_spaces.key`/`secret` (`supabase/functions/agent-api/index.ts:750-754`). Fixed by PR #248; rotation of the remaining secrets tracked on #213 → HANDOFF.d/2026-10-07T2130Z-hetz-claude-issue-213-key-rotation.md §3 item 1.
- 2026-11-04 4:20 PM EST (#714): live key and secret fingerprints equal the July snapshot; `admin_config` rows `DO_SPACES_KEY`/`DO_SPACES_SECRET` last updated 2026-03-11 (re-verified by this plan's author with a read-only query: both rows `updated_at = 2026-03-11 16:16:40-04`). All other exposed values are replaced, revoked or removed. #714 opened to carry just this one.

## 4. Scope

In: the one DigitalOcean Spaces key pair (`DO_SPACES_KEY` + `DO_SPACES_SECRET`, one pair), every runtime consumer, 1Password, live proof, revocation, cleanup of the stale rotation handoff file.

**NOT in this plan**
- Moving secrets out of `admin_config` into env vars / Supabase Vault (memory `project_admin_config_secret_exposure` "longer-term plan"; separate decision).
- Renaming the bucket or changing region/CDN (AGENTS.md:253 — would require migrating stored URLs).
- The NAS passwords (#179, closed) or any other secret from the July exposure (all done per #714 body).
- Changing agent-api so the key is no longer sent in heartbeats (design change; a different issue).
- DesignFlow's separate Spaces account/bucket (`sfo3`, 1Password item "DesignFlow DigitalOcean Spaces - private evidence and dflowbucket") — different key, different app, do not touch.

## 5. Current state of the code

Nothing in code needs to change for the rotation itself. Every consumer reads the pair from the **same single source**, `admin_config`:

| Consumer | Where it reads the key | Evidence |
|---|---|---|
| agent-api heartbeat → bridge + Windows agents | `admin_config` rows via `HEARTBEAT_CONFIG_KEYS_COMMON` | `supabase/functions/agent-api/index.ts:188-197`, response built at `:750-754` |
| Bridge agent tenant env | heartbeat `config.do_spaces` → child env | `apps/bridge-agent/src/tenant-supervisor.ts:129-133`; local `.env` fallback `apps/bridge-agent/src/config.ts:75-79` (warns and waits for heartbeat, `apps/bridge-agent/src/index.ts:1691-1694`) |
| Windows agent | same pattern | `apps/windows-agent/src/tenant-supervisor.ts:132-136`, `config.ts:110-114` |
| Edge: AI duplicate / sentinel cleanup (delete objects) | `admin_config` rows → `credentialsFromConfig` | `supabase/functions/_shared/spaces-delete.ts:122-137`; callers `_shared/admin-handlers/ai-duplicate-handlers.ts:119`, `ai-sentinel-handlers.ts:168` |
| Railway worker SeaDrive mirror (weekly upload) | `admin_config` rows | `apps/worker/src/handlers/seadrive-mirror.ts:11,57-65`; `apps/worker/src/config.ts` has **no** Spaces env var (grep empty) |
| Settings UI (admin edits the pair) | admin-api `get-config`/`set-config` | `src/components/settings/worker-management/SpacesAndFolders.tsx:20-48`; handler `supabase/functions/admin-api/index.ts:352` `handleSetConfig` |

Correction to carry forward: HANDOFF.d/2026-10-07 §3 says "Railway worker env + three edge functions secrets" must be updated. That is wrong on main today — there is no Railway env var and no edge-function secret for Spaces; the only runtime store is `admin_config`. Also `docs/INFRASTRUCTURE.md:34` claims the keys "are never stored in admin_config and are never returned by any API" — false; fix it in step 8.

Related file state: `fix_admin_config_secret_rotation.md` (repo root) is the July handoff; PR #713 (merged Nov 4, 5:12 PM EST) updated its status line to say only the DO pair remains. Deleting the file belongs to this plan's step 8, after rotation.

## 6. Key findings and root cause

1. **Exposure class — this value was published off this computer.** It was readable by every authenticated user of the shared Supabase project for months and sat in an unauthenticated API response until 2026-10-07. The owner ruling of 2026-10-27 ("if the keys were not published outside of this computer then no need to rotate, just redact") does **not** apply; the standing rule "a value published off this computer is compromised; the AI rotates it itself" does.
2. **Blocker is credential access, not code.** DigitalOcean Spaces keys are created only in the DO control panel or via the DO API (`doctl` / REST) with a personal access token. On hetz: `doctl` is not installed (`which doctl` empty), 1Password vault `vibe_coding` has no DigitalOcean account login or API token (item titles matching "digitalocean"/"spaces": the popdam Spaces item itself, a backrest note, and DesignFlow's sfo3 item — none holds a DO account credential; verified by listing field labels only), and #714 records DO is signed out in all three connected browsers.
3. The 1Password item "DigitalOcean Spaces - popdam bucket (nyc3) [PopDAM shared-supabase]" has fields `DO_SPACES_KEY (access key id)`, `DO_SPACES_SECRET (secret access key)`, `region`, `bucket`, two notes. It was last updated 2026-07-24 (pre-rotation backup).
4. `admin_config.SPACES_CONFIG` (bucket/region/endpoint/public_base_url) is **not** a secret and does not change.
5. The bucket is used for writes by agents (thumbnails), deletes by edge functions, and a weekly worker upload; a wrong key breaks thumbnail generation within one heartbeat interval (5–30 s), so proof must be immediate after step 4.

## 7. Approaches considered and rejected

- **Redact instead of rotate** — rejected (§6 item 1): exposure left this computer.
- **Ask Albert to log in to DigitalOcean / create a token / create the key** — forbidden by standing rules ("never ask Albert to type, click, or create a credential"). The correct report is `Blocked —` with the exact missing authority named (§13).
- **Create the key via a browser session** — only possible if a connected browser becomes signed in to DO. Not currently true; re-check at the start of each attempt (step 1b) because this is reversible and cheap.
- **Move the key to env vars first, then rotate** — rejected: doubles the change surface and does nothing about the exposed value. Rotation must not wait on the placement migration (`fix_admin_config_secret_rotation.md` "Gotchas").
- **Rotate by editing `admin_config` with SQL** — rejected: production DB is read-only by default; the supported write path is the admin-api `set-config` route (same thing the Settings page uses), which also keeps `updated_at` and audit behaviour consistent.
- **Revoke the old key first to force the issue** — rejected: breaks thumbnails with no replacement (goal §1).

## 8. Design decisions

| Decision | State | Reasoning |
|---|---|---|
| Rotate, do not redact | LOCKED (2026-11-04) | §6 item 1 |
| New key is a *new* DO Spaces access key pair on the same DO account/project; bucket, region, CDN unchanged | LOCKED | Avoids URL migration (AGENTS.md:253) |
| Single write path: admin-api `set-config` with the admin tester login | LOCKED | §7 |
| Old pair stays live until live proof passes, then revoked the same session | LOCKED | §1 |
| 1Password: update the existing item's two key fields; move the old values into a clearly labelled "old (revoked YYYY-MM-DD)" field pair or the notes until revocation is proven, then delete them | OPEN (implementer's call; either is acceptable, `secrets-to-1password` skill decides format) | |
| Where a future DO API token is stored if obtained | LOCKED: vault `vibe_coding`, new item titled `DigitalOcean API token - POP Creations account (PopDAM Spaces)` | `secrets-to-1password` skill; never in repo/env files |

## 9. The plan

Declare the task class before starting: `ai-task-gates` with classes `production` (writes to `admin_config` through the admin API) and `private-tooling`. Load `secrets-to-1password` before touching 1Password. Run every command from the repo worktree; scratch under `$TMPDIR` (note: `op_run` cannot see the Claude scratchpad; use `$TMPDIR`, memory `project_audit_backlog_2026_10_21`).

### Step 1 — Establish DO access (the gate)
1a. Check 1Password again for a DO personal access token or DO account login: list item titles in `vibe_coding` and grep for `digitalocean`/`doctl`/` DO `. Print titles only.
1b. Check whether any connected browser (Claude-in-Chrome or the built-in browser) is signed in at `https://cloud.digitalocean.com/` — load the matching browser skill first; navigate and read the page text; a signed-in session shows the project dashboard, a signed-out one shows the login form. Do not type credentials.
1c. If neither exists: post on #714 (signed with `$AI_GH_SIGNATURE`) a `Blocked —` note: "DigitalOcean Spaces key cannot be created: no DO API token in 1Password `vibe_coding`, no signed-in DO browser session on hetz, `doctl` not installed. Needs a DigitalOcean personal access token (scope: read+write for Spaces keys) stored in `vibe_coding` or a signed-in DO console session." Stop the plan here; leave STATUS row 1 open. Reporting this is the correct outcome, not a failure.
1d. If a token exists: install `doctl` into `$TMPDIR` (download the Linux amd64 release tarball from GitHub `digitalocean/doctl` into its own empty directory, verify the checksum from the release page, run it by absolute path — do not replace OS binaries) and authenticate it through `op run`/`op_run` so the token never appears in output.
Gate: `doctl account get` returns the account (or the browser shows the DO dashboard).

### Step 2 — Create the new Spaces key pair
With `doctl`: `doctl spaces keys create popdam-$(date +%Y%m%d)` (or the equivalent in the console under API → Spaces Keys) with full access to bucket `popdam` only if the account supports per-bucket grants; otherwise account-wide, as today. Capture the output into a file under `$TMPDIR` with mode 600; never echo it. Gate: `doctl spaces keys list` shows two keys: the March 2026 one and the new one.

### Step 3 — Save the new pair to 1Password
Edit item "DigitalOcean Spaces - popdam bucket (nyc3) [PopDAM shared-supabase]" in `vibe_coding`: new values in `DO_SPACES_KEY (access key id)` / `DO_SPACES_SECRET (secret access key)`; preserve the old pair as per §8 (labelled old, with date). Add a note line: "Rotated YYYY-MM-DD h:mm AM/PM EST per popdam3#714; old key revoked <time> (fill in at step 7)". Gate: `op item get <title> --format json | python3 -I -c '…print labels only…'` shows the new/old labels; no values printed.

### Step 4 — Write the new pair into `admin_config`
Sign in to the admin API as the PopDAM admin tester (1Password `vibe_coding`, admin item named in memory `project_popsg_tester_login`; read `docs/1password.md` for the `op run` pattern). Call `POST https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/admin-api` with action `set-config`, `entries: { DO_SPACES_KEY, DO_SPACES_SECRET }` (shape per `SpacesAndFolders.tsx:45-48`; server handler `admin-api/index.ts:352`). Run through `op run` with the values as env references so nothing is printed. Gate: read-only SQL `select key, updated_at from admin_config where key in ('DO_SPACES_KEY','DO_SPACES_SECRET')` shows today's timestamp; the key column (a non-secret access-key id) matches the new id's first 4 chars.

### Step 5 — Confirm every consumer uses the new pair
- Agents: next heartbeat delivers it (`agent-api/index.ts:750`). Gate: `agent_registrations.last_heartbeat` for `synology-bridge-1` and `windows-render-agent` advances past the step-4 timestamp, and a thumbnail generated after that time has a `thumbnail_url` under `cdn.designflow.app`/`popdam.nyc3…` that returns HTTP 200.
- Edge delete path: handled by step 6.
- Worker: `seadrive-mirror` runs weekly; no action, but it reads `admin_config` live (`seadrive-mirror.ts:57`). Gate: none now; note it in the close-out.
- Railway and edge secrets: #714 lists both as consumers. Code reads no such variable (`apps/worker/src/config.ts`, no `Deno.env` read of `DO_SPACES_*`; re-verified on `e037dd7a`), but a stale copy could still sit in the live settings. List variable **names only** on the Railway worker service and in Supabase function secrets. Gate: no `DO_SPACES_*` name, or any found is updated now and recorded on #714, so the old value survives nowhere. If Railway access is down, record this line as unverified on #714; it does not block the rotation.
- Bridge local `.env` on the NAS: if `DO_SPACES_KEY` is set there it is only a fallback overridden by heartbeat (`tenant-supervisor.ts:129`). Do not edit the NAS; if an SSH read shows the old key in `.env`, record it as a follow-up `- [ ]` on #714 to be cleared when the bridge is next redeployed (#681 owns bridge updates).

### Step 6 — Live proof (upload + delete)
- Upload: queue a thumbnail render for one asset whose thumbnail is missing or trigger the normal path via Settings → Diagnostics (the admin tester can do this through the UI with Playwright; take a screenshot). Gate: new object appears (HTTP 200 on its URL) and the agent log shows no S3 auth error.
- Delete: run the admin action that calls `deleteSpacesObjects` on a disposable object (the AI-sentinel cleanup handler, `ai-sentinel-handlers.ts:168`, or the duplicate cleanup handler) against a test object, or — safer — upload a throwaway object with the new key using the AWS SigV4 CLI (`aws s3 --endpoint-url https://nyc3.digitaloceanspaces.com`) and delete it with the same key. Gate: the object returns 404 afterwards.
- Post both proofs on #714 and tick `- [x] live proof`.

### Step 7 — Revoke the old pair
`doctl spaces keys delete <old-key-id>` (or console). Gate: an upload attempt with the old key (through the SigV4 CLI, values via `op run`) returns 403; a thumbnail generated after revocation still succeeds (repeat step 6 upload once).

### Step 8 — Cleanup
- 1Password: remove the old values (keep the dated note).
- Branch `claude/714-do-spaces-key-rotated` from `main`; delete `fix_admin_config_secret_rotation.md` (all 8 done); fix `docs/INFRASTRUCTURE.md:34` to say the pair is stored in `admin_config` (admin-only read policy since shared-db PR #204) and delivered to agents by heartbeat; update HANDOFF.d/2026-10-07T2130Z… §3 item 1 with a one-line "done YYYY-MM-DD, see #714". Open a PR, wait with `bin/ai-pr-wait <pr>` in the background, merge.
- Gate: PR merged; `git ls-files fix_admin_config_secret_rotation.md` on `main` is empty.

### Step 9 — Close
Close #714 with: new key created (time EST), `admin_config.updated_at`, both live proofs, old key revoked (time EST), 1Password updated, PR number. If #213 still lists the DO row as open, close that row too.

## 10. Tests required

No application code changes, so no new unit tests. Keep green: root `npm run lint && npm run typecheck && npm run test` and the CI workflow on the step-8 PR (docs-only). Existing `src/test/admin-config-secret.test.ts:10` already asserts `DO_SPACES_SECRET` is treated as a secret name — do not weaken it.

## 11. Constraints, standing rules, gotchas

- Branch policy: feature branch + PR to `main`; never push to `main`. The AI merges (Albert does not).
- No DB schema change here; `admin_config` value writes go through the admin API only (production is read-only by default; SQL used only to read `updated_at`).
- Secrets: 1Password `vibe_coding` only; never print values; `op_run` cannot read the Claude scratchpad — use `$TMPDIR`; serialize 1Password access.
- Never ask Albert to log in, create a token, or click. If step 1 fails, report `Blocked —` naming the exact missing authority.
- Times in EST from `TZ=America/New_York date`.
- Reviews are advisory and never gate this. No human approval is requested.
- The old key must outlive the proof (§1). Revocation is destructive: the only "recovery" is the new key already working, so step 6 must precede step 7.
- Agent heartbeat interval 5–30 s; a wrong value breaks thumbnails almost immediately — do step 4 and step 6 back to back.
- Do not confuse this account with DesignFlow's DO Spaces (`sfo3`).
- Deploy workflow trap (HANDOFF.d/2026-10-07 §4): `deploy-supabase.yml` diffs `HEAD~1`; irrelevant here because no edge code changes.

## 12. Access and environment

- Machine hetz; repo worktree for this branch; `gh` authenticated as `u2giants`; `op` CLI 2.41.1 with a `vibe_coding` service account; Supabase MCP `execute_sql` resolves to the live Virginia project (`get_project_url` → `https://qsllyeztdwjgirsysgai.supabase.co`, verified 2026-11-04 4:45 PM EST) — read-only use only.
- Admin tester login: 1Password `vibe_coding`, PopDAM admin tester item (memory `project_popsg_tester_login`).
- Spaces item: `vibe_coding` → "DigitalOcean Spaces - popdam bucket (nyc3) [PopDAM shared-supabase]".
- DO API token: does not exist yet (step 1).
- Browsers: Claude-in-Chrome / built-in browser via their skills; DO console at `https://cloud.digitalocean.com`.
- Nothing to serve locally.

## 13. Definition of done, risks, open questions

Done when: new key in DO, `admin_config` updated today, both live proofs posted on #714, old key revoked and proven refused, 1Password updated, step-8 PR merged to `main`, `fix_admin_config_secret_rotation.md` gone, #714 closed with EST timestamps.

Risks: wrong value written → thumbnails fail within seconds; rollback = re-run step 4 with the old pair (still valid until step 7). Account-wide key revocation could affect a non-PopDAM consumer if any exists — `doctl spaces keys list` before step 7 and grep this repo plus the DesignFlow repos for the old key id (not the secret) to confirm none.

Open: whether a DO token can be obtained at all without Albert. That is the single `Blocked —` item; the plan is otherwise fully specified.

## Self-audit

1. Could a brand-new session execute this without asking anything? Yes — §5 names every consumer with file:line, §9 gives each step's command shape, inputs and gate, §12 names every credential by vault + title. The only stop is the authority gap in step 1, and §9 step 1c says exactly what to post and where.
2. Does it carry every piece of background and what was ruled out? Yes — §3 and §6 record both exposure events and the fingerprint check, §5 corrects the stale "Railway env / edge secrets" claim, §7 lists the six rejected routes including the owner-ruling misread.
3. Is the goal clear enough to judge a wrong step? Yes — §1 states the business outcome and the two invariants (never zero working keys; never revoke before proof), which decide every ordering question in §9.
