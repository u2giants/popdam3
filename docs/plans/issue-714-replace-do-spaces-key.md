---
summary: Issue #714 plan: Replace the exposed DigitalOcean Spaces storage key. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-714
---

# Plan: Replace the exposed DigitalOcean Spaces storage key (u2giants/popdam3#714)
Issue: https://github.com/u2giants/popdam3/issues/714
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 0 | Confirm the exposure class | ✅ done | The previous credential was exposed outside the host and required replacement. |
| 1 | Obtain a replacement credential | ✅ done | The owner saved the corrected credential in 1Password. |
| 2 | Verify the corrected Spaces credential | ✅ done | Signed requests succeeded from two network routes. The verified access key ID differed from the live ID. |
| 3 | Verify the replacement in the existing 1Password item | ✅ done | The saved pair was verified privately before and after the cutover. |
| 4 | Apply the replacement through PopDAM Settings | ✅ done | November 18, 2026, 1:07:16 PM EST. The access key ID and secret were updated together and matched 1Password. |
| 5 | Verify consumer pickup | 🔄 partial | The bridge and Windows agents reloaded their storage credentials after the save. The worker and edge cleanup read live configuration. |
| 6 | Verify upload and delete | 🔄 partial | A disposable object was uploaded, read, deleted and verified absent. A fresh thumbnail from the ordinary application workflow remains open on #714. |
| 7 | Verify that Spaces rejects the exposed credential | ✅ done | Spaces rejected the exposed pair before and after the cutover. No provider deletion was needed. |
| 8 | Retire the old rotation tracking note and correct the storage documentation | ⬜ open | After the live checks pass. |
| 9 | Close #714 (and the DO row of #213 if still open) with evidence | ⬜ open | |

Where a fresh session starts: **Step 6.** The replacement is live and both agents reloaded it. Verify a fresh thumbnail through the ordinary application workflow before retiring the tracking note and closing #714.

---

## 1. The ultimate goal

The company's picture library (PopDAM / PopSG thumbnails, renders, mirrored installer downloads) lives in one DigitalOcean Spaces bucket called `popdam`. For roughly four months in 2026 the key that can read, write and delete everything in that bucket was readable by any signed-in user of any POP app, and (until 2026-10-07) by anyone on the internet who could call an unauthenticated agent route. This was the last exposed secret awaiting rotation. The goal is a working replacement, a rejected prior secret, and normal thumbnail upload and deletion.

A same-ID secret regeneration makes the prior secret unusable immediately. Apply the regenerated secret promptly and verify the live upload and delete paths.

## 2. What this application is

PopDAM (dam.designflow.app) and PopSG (sg.designflow.app) are POP Creations' internal digital-asset manager and style-guide library. One React/Vite frontend (this repo, `src/`), Supabase edge functions (`supabase/functions/`, project `qsllyeztdwjgirsysgai`, Virginia), a Railway worker (`apps/worker/`), an on-prem Synology "bridge" agent (`apps/bridge-agent/`, Docker on NAS `edgesynology1`), a Windows render agent (`apps/windows-agent/`), and a desktop helper (`apps/popdam-helper/`). Repo `u2giants/popdam3`, default branch `main`, machine `hetz` is the production VPS where AI sessions run. Object storage is DigitalOcean Spaces, bucket `popdam`, region `nyc3`, CDN `cdn.designflow.app` (AGENTS.md:253).

## 3. What triggered this work

- 2026-07-24: `public.admin_config` had an RLS read policy `USING (true)` for `authenticated`; 8 plaintext secrets were readable by any logged-in user (memory `project_admin_config_secret_exposure`; `fix_admin_config_secret_rotation.md`). Leak fixed same day (shared-db PR #204).
- 2026-10-07 (#210/#213): the `agent-api` `register` route was unauthenticated and its heartbeat response carries `do_spaces.key`/`secret` (`supabase/functions/agent-api/index.ts:750-754`). Fixed by PR #248; rotation of the remaining secrets tracked on #213 → root `fix_admin_config_secret_rotation.md` (the #213 handoff was retired 2026-11-11; git history keeps it).
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

The worker and edge cleanup code use `admin_config` as their runtime credential source. The older handoff described separate worker and edge secrets. The current design is documented in [Infrastructure](../INFRASTRUCTURE.md#digitalocean-spaces-thumbnail-storage).

Related file state: `fix_admin_config_secret_rotation.md` (repo root) is the July handoff; PR #713 (merged Nov 4, 5:12 PM EST) updated its status line to say only the DO pair remains. Deleting the file belongs to this plan's step 8, after rotation.

## 6. Key findings and root cause

1. **Exposure class — this value was published off this computer.** It was readable by every authenticated user of the shared Supabase project for months and sat in an unauthenticated API response until 2026-10-07. The owner ruling of 2026-10-27 ("if the keys were not published outside of this computer then no need to rotate, just redact") does **not** apply; the standing rule "a value published off this computer is compromised; the AI rotates it itself" does.
2. **Provider access was the original blocker.** The owner supplied a corrected pair through 1Password. Preflight showed that its access key ID differed from the production ID. DigitalOcean documents access-key management in its control panel and immediate invalidation when regenerating a secret against the same access key ID. [DigitalOcean Spaces access documentation](https://docs.digitalocean.com/products/spaces/how-to/manage-access/#regenerate-a-secret-key)
3. The 1Password item "DigitalOcean Spaces - popdam bucket (nyc3) [PopDAM shared-supabase]" has fields `DO_SPACES_KEY (access key id)`, `DO_SPACES_SECRET (secret access key)`, `region`, `bucket`, two notes. The previous version was recorded in July 2026.
4. `admin_config.SPACES_CONFIG` (bucket/region/endpoint/public_base_url) is **not** a secret and does not change.
5. The bucket is used for writes by agents (thumbnails), deletes by edge functions, and a weekly worker upload; a wrong key breaks thumbnail generation within one heartbeat interval (5–30 s), so proof must be immediate after step 4.

## 7. Approaches considered and rejected

- **Redact instead of rotate** — rejected (§6 item 1): exposure left this computer.
- **Ask Albert to log in to DigitalOcean / create a token / create the key** — forbidden by standing rules ("never ask Albert to type, click, or create a credential"). The correct report is `Blocked —` with the exact missing authority named (§13).
- **Assume a same-ID rotation** was rejected after comparing the working pair with the live setting.
- **Move the key to env vars first, then rotate** — rejected: doubles the change surface and does nothing about the exposed value. Rotation must not wait on the placement migration (`fix_admin_config_secret_rotation.md` "Gotchas").
- **Rotate by editing `admin_config` with SQL** — rejected: production DB is read-only by default; the supported write path is the admin-api `set-config` route (same thing the Settings page uses), which also keeps `updated_at` and audit behaviour consistent.
- **Delete the existing access key** would disable the regenerated secret as well.

## 8. Design decisions

| Decision | State | Reasoning |
|---|---|---|
| Rotate, do not redact | LOCKED (2026-11-04) | §6 item 1 |
| Keep the bucket, region and CDN | Scope | Verify the correct access key ID before applying any configuration change. |
| Single write path: admin-api `set-config` with the admin tester login | LOCKED | §7 |
| The exposed pair cannot be used for rollback | Verified | DigitalOcean rejected the exposed pair before and after the production cutover. |
| Verify the replacement in the existing 1Password item | Done | Both production values match the stored pair. |

## 9. The plan

Declare the task class before starting: `ai-task-gates` with classes `production` (writes to `admin_config` through the admin API) and `private-tooling`. Load `secrets-to-1password` before touching 1Password. Run every command from the repo worktree; scratch under `$TMPDIR` (note: `op_run` cannot see the Claude scratchpad; use `$TMPDIR`, memory `project_audit_backlog_2026_10_21`).

### Step 1 — Establish provider authority
The owner reported saving the replacement through 1Password after using the DigitalOcean control panel. Verify the stored pair before changing PopDAM.

### Step 2 — Verify the corrected Spaces credential
Signed checks against the bucket succeeded from two network routes. The working access key ID differed from the one in production.

### Step 3 — Verify the replacement in 1Password
Use the existing Spaces item in `vibe_coding`. Confirm the corrected pair works against the intended bucket and check whether its access key ID matches live PopDAM before updating it. Report only the verification outcome.

### Step 4 — Apply the replacement secret through PopDAM Settings
Use the PopDAM administrator Settings write path. Update `DO_SPACES_SECRET` if the verified access key ID matches, or update both credential fields together if it differs. Use the protected vault injection described in [1Password](../1password.md). Verify the live configuration matches the vault without exposing either value.

### Step 5 — Confirm every consumer uses the replacement secret
- Agents: next heartbeat delivers it (`agent-api/index.ts:750`). Gate: `agent_registrations.last_heartbeat` for `synology-bridge-1` and `windows-render-agent` advances past the step-4 timestamp, and a thumbnail generated after that time has a `thumbnail_url` under `cdn.designflow.app`/`popdam.nyc3…` that returns HTTP 200.
- Edge delete path: handled by step 6.
- Worker: `seadrive-mirror` runs weekly; no action, but it reads `admin_config` live (`seadrive-mirror.ts:57`). Gate: none now; note it in the close-out.
- Railway and edge secrets: #714 lists both as consumers. Code reads no such variable (`apps/worker/src/config.ts`, no `Deno.env` read of `DO_SPACES_*`; re-verified on `e037dd7a`), but a stale copy could still sit in the live settings. List variable **names only** on the Railway worker service and in Supabase function secrets. Gate: no `DO_SPACES_*` name, or any found is updated now and recorded on #714, so the old value survives nowhere. If Railway access is down, record this line as unverified on #714; it does not block the rotation.
- Bridge local `.env` on the NAS: if `DO_SPACES_KEY` is set there it is only a fallback overridden by heartbeat (`tenant-supervisor.ts:129`). Do not edit the NAS; if an SSH read shows the old key in `.env`, record it as a follow-up `- [ ]` on #714 to be cleared when the bridge is next redeployed (#681 owns bridge updates).

### Step 6 — Live proof (upload + delete)
- Upload: queue a thumbnail render for one asset whose thumbnail is missing or trigger the normal path via Settings → Diagnostics (the admin tester can do this through the UI with Playwright; take a screenshot). Gate: new object appears (HTTP 200 on its URL) and the agent log shows no S3 auth error.
- Delete: run the admin action that calls `deleteSpacesObjects` on a disposable object (the AI-sentinel cleanup handler, `ai-sentinel-handlers.ts:168`, or the duplicate cleanup handler) against a test object, or — safer — upload a throwaway object with the new key using the AWS SigV4 CLI (`aws s3 --endpoint-url https://nyc3.digitaloceanspaces.com`) and delete it with the same key. Gate: the object returns 404 afterwards.
- Post both proofs on #714 and tick `- [x] live proof`.

### Step 7 — Verify exposed-credential rejection
The exposed pair must be refused while the replacement succeeds. Use a read-only request against the same bucket and record the result without retaining the old credential.

### Step 8 — Cleanup
- 1Password: remove the old values (keep the dated note).
- Once the replacement is proven live and the old secret is rejected, retire the root `fix_admin_config_secret_rotation.md` in a pull request to `main`. Record the outcome on #714 and in this plan's STATUS. The #213 handoff it superseded was retired on November 11, 2026.
- Gate: PR merged; `git ls-files fix_admin_config_secret_rotation.md` on `main` is empty.

### Step 9 — Close
Close #714 with: new key created (time EST), `admin_config.updated_at`, both live proofs, old key revoked (time EST), 1Password updated, PR number. If #213 still lists the DO row as open, close that row too.

## 10. Tests required

No application code changes, so no new unit tests. Keep green: root `npm run lint && npm run typecheck && npm run test` and the CI workflow on the step-8 PR (docs-only). Existing `src/test/admin-config-secret.test.ts:10` already asserts `DO_SPACES_SECRET` is treated as a secret name — do not weaken it.

## 11. Constraints, standing rules, gotchas

- Branch policy: feature branch + PR to `main`; never push to `main`. The AI merges (Albert does not).
- No DB schema change here; `admin_config` value writes go through the admin API only (production is read-only by default; SQL used only to read `updated_at`).
- Secrets: 1Password `vibe_coding` only; never print values; `op_run` cannot read the Claude scratchpad — use `$TMPDIR`; serialize 1Password access.
- Record any provider access blocker on #714.
- Times in EST from `TZ=America/New_York date`.
- Reviews are advisory and never gate this. No human approval is requested.
- A same-ID regeneration invalidates the previous secret immediately. Restore service with the regenerated secret through the approved Settings path.
- Agent heartbeat interval 5–30 s; a wrong value breaks thumbnails almost immediately — do step 4 and step 6 back to back.
- Do not confuse this account with DesignFlow's DO Spaces (`sfo3`).
- Deploy workflow trap (HANDOFF.d/2026-10-07 §4): `deploy-supabase.yml` diffs `HEAD~1`; irrelevant here because no edge code changes.

## 12. Access and environment

- Machine hetz; repo worktree for this branch; `gh` authenticated as `u2giants`; `op` CLI 2.41.1 with a `vibe_coding` service account; Supabase MCP `execute_sql` resolves to the live Virginia project (`get_project_url` → `https://qsllyeztdwjgirsysgai.supabase.co`, verified 2026-11-04 4:45 PM EST) — read-only use only.
- Admin tester login: 1Password `vibe_coding`, PopDAM admin tester item (memory `project_popsg_tester_login`).
- Spaces item: `vibe_coding` → "DigitalOcean Spaces - popdam bucket (nyc3) [PopDAM shared-supabase]".
- Browsers: Claude-in-Chrome / built-in browser via their skills; DO console at `https://cloud.digitalocean.com`.
- Nothing to serve locally.

## 13. Definition of done, risks, open questions

Done when the new secret is stored in 1Password and applied to PopDAM, thumbnail uploads and cleanup are proven live, the old secret is refused, and the documentation pull request merges. Record the evidence on #714 before closing it.

Risks: a bad or stale secret can stop thumbnail uploads. Confirm the replacement works before saving it and verify pickup by each consumer.

Open: verify a fresh thumbnail through the ordinary workflow and complete the documentation closeout.

## Self-audit

1. A fresh session starts from STATUS and uses the source map in §5, verification steps in §9, and access references in §12.
2. Does it carry every piece of background and what was ruled out? Yes — §3 and §6 record both exposure events and the fingerprint check, §5 corrects the stale "Railway env / edge secrets" claim, §7 lists the six rejected routes including the owner-ruling misread.
3. Is the goal clear enough to judge a wrong step? Yes — §1 states the business outcome and the two invariants (never zero working keys; never revoke before proof), which decide every ordering question in §9.
