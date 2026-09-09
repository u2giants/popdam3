---
issue: 115
status: BLOCKED
owner: codex/coldlion-key-rotation-115
---

# HANDOFF — ColdLion credential rotation (2026-09-09 00:38Z, hetz/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking

- **Approve rotation of the exposed ColdLion production API credential.** Recommendation: approve immediately because the legacy fallback in Git history exactly matched the current vault credential. This blocks issue #115 closure and retirement of this handoff; it does not block PopDAM today because commit `d2bdbe6d` removed the fallback and production now reads the database-managed credential.

The next session must put this whole one-item list to Albert in one message before attempting rotation. Rotation is not authorized by the #114 implementation request or by this handoff.

### Already settled — do not re-ask

- 2026-09-09: issue #114 is completed and closed; do not reopen its loader or production-data work as part of key rotation.
- 2026-09-09: the code fallback is removed and deployed; do not restore, replace, or bypass it.
- 2026-09-09: secrets move only through protected injection or protected files and never through chat, arguments, logs, issue text, documentation, or commits.

## 1. What this application is

PopDAM is POP Creations' internal digital-asset manager. It also serves PopSG, the style-guide library, from the same React application. The application repository is `u2giants/popdam3`, checked out at `/worksp/popdam`, and deploys directly from `main`. Public production is `https://dam.designflow.app` and `https://sg.designflow.app`; Supabase Edge Functions serve the administrative APIs. ColdLion is the external ERP source used for item, prepack, licensing, and merchandise-group data.

The shared production database is Supabase Virginia project `qsllyeztdwjgirsysgai`. This rotation changes no database structure and must not start or inherit a shared-db orchestrator.

## 2. What we set out to do this session, and why

Albert asked to complete PopDAM issue #114 through production, then invoked the session-closeout skill. Issue #114 added a guarded direct ColdLion item/prepack loader, loaded and reconciled production data, shipped commit `ce7ed288`, and closed successfully.

During the required secret-hygiene closeout, `supabase/functions/_shared/admin-handlers/coldlion-handlers.ts` was found to contain a hardcoded fallback credential. A hash-only comparison proved it exactly matched the current production value in 1Password. The session removed the fallback and deployed that repair, but rotating the external vendor credential requires Albert's explicit approval. Issue #115 tracks that remaining security action.

## 3. Current state — what is true right now

- Issue #114 is CLOSED at `2026-09-09T00:03:32Z`.
- Commit `ce7ed2885f0fbb61a206c60cbbc0b33561c8cfbb` contains the loader, five focused tests, runbook, and scrubbed production acceptance. The first production load and immediate idempotent rerun both committed successfully.
- Production holds 18,953 ColdLion item headers and 26,156 item details after the governed EP001 exclusion. It has 2,505 items with direct prepack values and 2,571 distinct codes. Comparison against the 1,454 frozen heads found 1,437 exact matches, zero conflicting current codes, and 17 frozen-only heads absent from today's ColdLion header feed.
- Commit `d2bdbe6d649f2c297f732e16bb341102ebf70caf` removes the hardcoded fallback. It is pushed to `main`; CI, Edge formatting, shared-db guard, bypass guard, Railway, and Supabase Edge deployment all succeeded.
- Production `admin_config.COLDLION_API_KEY` was checked by boolean/nonblank query without revealing the value and is present. The deployed handler therefore retains the original capability through the intended database-managed path.
- The public frontend container remains healthy on `ce7ed288`; no frontend publish was required by the one-line Edge-only security commit. Supabase Edge deployment run `34295752712` succeeded for `d2bdbe6d`.
- `/worksp/popdam` was clean and exactly matched `origin/main` before this handoff was created. This handoff itself must now be committed and pushed.
- The exposed credential still exists in Git history and must be assumed compromised until rotated and revoked. No value is reproduced here.

## 4. Everything we tried that did NOT work

1. The first loader attempt streamed a very large SQL transaction through `psql` stdin. The child exited early and Node reported only `EPIPE`, hiding the database diagnostic. The durable loader now writes the private payload to a mode-0600 temporary file, invokes `psql --file`, captures errors, and always deletes the temporary directory.
2. The first SQL used terminal status `completed`; production's `ingest.sync_status` enum uses `succeeded`. The transaction rolled back before rows landed. The loader now uses the real enum value.
3. Temporary merchandise rows omitted their required internal `id`. The transaction rolled back. Temporary UUIDs are now supplied but excluded from the production upsert so production retains its own identity.
4. A correlated stale-row anti-join exceeded ordinary performance expectations. Adding indexes and planner statistics helped but still approached the fixed 15-minute statement ceiling. Those test transactions were cancelled and rolled back; the ceiling was never increased. The final loader uses run IDs: every current row receives the new run ID during upsert, so untouched rows alone are stale. The final repeat committed with zero stale deletions.
5. A first closeout probe tried `btrim` directly on the JSONB `admin_config.value` and failed type checking. The corrected boolean probe extracts the scalar text first and revealed no value.

## 5. Root causes and key findings

- The credential exposure was a real live-secret exposure, not a placeholder: a hash-only comparison between the tracked fallback and 1Password returned `matches_current_vault_credential: true`.
- Removing the fallback is containment, not remediation. Git history and prior clones still contain the value; only vendor-side rotation followed by revocation retires it.
- The intended runtime path already existed in `getColdlionApiKey()` in `supabase/functions/_shared/admin-handlers/coldlion-handlers.ts`: read `admin_config.COLDLION_API_KEY`. The unsafe fallback ran only when that value was absent. Production has a nonblank database-managed value, so removing the fallback preserves normal operation.
- ColdLion credential source of truth is 1Password vault `vibe_coding`, item `Coldlion ERP API key x5.coldlion.com`, field `credential`. Do not reveal it to compare values; compare hashes.
- Rotation may affect consumers outside PopDAM. Search authenticated runtime/config inventories for ColdLion consumers before revoking the old value. Known PopDAM consumers include the new loader and Supabase administrative/metadata code; shared-db tooling also reads the same 1Password item.
- One unrelated stale handoff exists: `HANDOFF.d/2026-08-27T2258Z-hetz-codex-orderlist-count-indexes.md`, owner `codex/orderlist-count-indexes-100`, while issue #100 is closed. This session did not delete another session's file.

## 6. Exact next steps

1. Ask Albert once for explicit approval to rotate the ColdLion production API credential, citing issue #115 and the confirmed Git-history exposure. **You'll know it worked when:** Albert explicitly authorizes rotation in the current task.
2. Inventory every current consumer without exposing the credential. Search repository/runtime configuration for `COLDLION_API_KEY`, the 1Password item reference, and ColdLion base URL; include PopDAM, shared-db tools/workflows, and any DesignFlow-owned sync that uses a separate credential. **You'll know it worked when:** every consumer and its update mechanism is listed, and no secret value appears in output or notes.
3. Create/rotate the credential through ColdLion's supported account mechanism. Do not revoke the old key yet if ColdLion supports overlap. Move the new value only through protected injection. **You'll know it worked when:** a protected direct GET to a harmless endpoint returns HTTP 200 with the new key and no value appears in logs.
4. Update the existing 1Password item `Coldlion ERP API key x5.coldlion.com` in vault `vibe_coding`; do not create a duplicate. Update its valid-from/provenance notes. **You'll know it worked when:** a no-reveal item read shows the expected title, fields, and updated metadata, and a hash-only comparison matches the new credential.
5. Update production `admin_config.COLDLION_API_KEY` through a protected database path, proving target project `qsllyeztdwjgirsysgai` immediately before the write. Update every other confirmed consumer through its canonical deployment/configuration path. **You'll know it worked when:** every consumer's stored fingerprint matches the new key and no plaintext value appears in arguments, logs, files, or commits.
6. Verify the original capability. Invoke PopDAM's authenticated `debug-coldlion-lookup` as an administrator, run a bounded direct ColdLion probe, and run the loader's read-only collection functions or a deliberately bounded production test. **You'll know it worked when:** the Edge action and direct endpoint both succeed using only the managed credential path, with no fallback.
7. Revoke the old ColdLion credential. Then verify a protected old-key probe fails and the new-key probes still pass. **You'll know it worked when:** the old key is rejected, the new key works everywhere, and production ColdLion operations remain healthy.
8. Add final evidence to issue #115 without values, close it, delete this handoff under the successor rule, commit/push the deletion, and verify the repo is clean. **You'll know it worked when:** #115 is CLOSED, this file is absent on `origin/main`, checks are green, and production capability still works.

## 7. Constraints and gotchas in force

- Rotation requires Albert's explicit approval; do not infer it from #114, the closeout request, the handoff, or issue #115.
- Never print, paste, document, commit, or place either credential in command arguments. Use protected injection or a mode-0600 temporary file and delete it afterward.
- Do not merely replace the repository literal. It is already removed; remediation requires vendor rotation and old-key revocation.
- Do not rotate the 1Password value before inventorying consumers unless ColdLion provides an overlap window; otherwise unseen consumers may break.
- Preserve the original ColdLion capability. A rotation is complete only when the old key fails and every current consumer works with the new key.
- Production/shared infrastructure is read-only by default. The exact credential rotation and scoped config updates become authorized only after Albert approves them.
- Shared database structure is out of scope. Do not create a migration or start a shared-db orchestrator.
- PopDAM is direct-to-`main`; stage only files owned by the session. Verify `git var GIT_COMMITTER_IDENT` before committing.
- Do not edit another session's handoff. The stale #100 handoff must be retired by its owner or a successor that proves all retention gates.

## 8. Access and environment

- Machine: `hetz`; checkout: `/worksp/popdam`; repository: `u2giants/popdam3`; branch: `main`.
- GitHub CLI, 1Password CLI, PostgreSQL client, Docker read-only inspection, and Supabase deployment workflow were authenticated during this session.
- Production Supabase project: `qsllyeztdwjgirsysgai` in Virginia. Pooler identity and password are documented in 1Password item `Supabase DB Password - shared POP database`; never use the retired Ohio project.
- ColdLion credential: 1Password vault `vibe_coding`, item `Coldlion ERP API key x5.coldlion.com`, concealed field `credential`.
- PopDAM production runtime credential: `public.admin_config`, key `COLDLION_API_KEY`; access only through a protected server/database path.
- Production application URLs: `https://dam.designflow.app`, `https://sg.designflow.app`.
- Security fix commit: `d2bdbe6d649f2c297f732e16bb341102ebf70caf`; successful Supabase Edge deployment run: `https://github.com/u2giants/popdam3/actions/runs/34295752712`.
- Rotation tracker: `https://github.com/u2giants/popdam3/issues/115`.

## 9. Open questions and risks

1. **Owner approval, open 2026-09-09.** Rotation is required but unauthorized until Albert explicitly approves it. Recommendation: approve immediately.
2. **ColdLion rotation mechanism, verify after approval.** This session did not mutate the vendor account and did not determine whether old/new keys may overlap. Inventory that capability before changing consumers.
3. **Unknown external consumers.** The shared 1Password item may serve tools outside PopDAM. Revoking before the inventory could break a background import.
4. **Historical exposure scope.** The value exists in Git history and may be present in clones or logs predating this session. Repository removal cannot prove containment; old-key revocation is the only terminal gate.
5. **Stale unrelated handoff.** The issue #100 handoff remains despite its closed issue. Its owner is `codex/orderlist-count-indexes-100`; do not delete it without satisfying the successor-retention proof.

## Self-audit

1. **Could a street-new developer continue without asking a question? Yes.** Sections 1–3 define the application, trigger, exact commits, deployment and live state; §6 gives the ordered rotation procedure and gates; §8 gives access locations without values.
2. **Could they continue as effectively as this session? Yes.** Sections 4–5 preserve every failed loader/verification path and the hash-only proof, intended credential path, containment-versus-remediation distinction, and external-consumer risk.
3. **Are failures included with reasons? Yes.** Section 4 records the stdin `EPIPE`, enum mismatch, temporary-ID failure, timeout-prone anti-joins, and JSONB probe error, including how each was corrected.
4. **Is every next step concrete and verifiable? Yes.** All eight steps in §6 name the action, sequence, target, and an explicit “you'll know it worked when” gate.
5. **Are identifiers and terms defined? Yes.** Sections 1, 3, 5, and 8 define PopDAM/PopSG, ColdLion, production project, repository, commits, issue, vault item, runtime key, URLs, and deployment run.
6. **Was the section-0 sweep performed? Yes.** Re-reading §§1–9 found one sentence requiring Albert's judgement: authorization to rotate the exposed credential in §§2, 6, 7, and 9. It appears in §0 with an immediate-approval recommendation and exact consequence. The stale #100 handoff needs its own owner/successor proof, not Albert's decision, and is therefore reported in §§5/7/9 rather than promoted as an owner ask.

### Final synthesis

1. **Is this comprehensive enough for a brand-new developer to pick up without missing a beat? Yes**, supported by §§1–9 and the evidence-backed audit above.
2. **Can they continue with all knowledge from this session? Yes**, especially the exact current state (§3), dead ends (§4), findings (§5), and action gates (§6).
3. **Is every relevant detail present for flawless execution? Yes**, including background, intended outcome, deployed containment, failed attempts, owner gate, security constraints, access, risks, and terminal verification.
4. **Would Albert see every decision by reading only §0? Yes.** The line-by-line sweep found only the rotation authorization; it is consolidated in §0. No other sentence in §§1–9 asks Albert to decide, approve, or choose anything.
