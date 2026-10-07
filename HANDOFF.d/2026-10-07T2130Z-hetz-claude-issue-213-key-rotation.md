# Handoff — popdam3 #213 agent-api lockdown: remaining key rotation

## 1. Goal
Close u2giants/popdam3#213: agent-api auth holes (done) plus rotation of secrets that were exposed via unauthenticated `register` and the July 2026 admin_config read leak.

## 2. Done and verified (2026-10-07, EDT)
- #210/#212 fixed by PR #248 (register requires current x-agent-key; atomic pairing-code claim; name-overwrite refused, except an admin-issued single-use code may re-key an agent of the same type — needed by the admin "repair agent" flow).
- #211 fixed by PR #247 (report-update-status requires agent key, fields whitelisted).
- Deployed by `.github/workflows/deploy-supabase.yml` (main@b443c32). Live proof 4:48 PM EDT: unauthenticated register and report-update-status → 401; agent_registrations still only `synology-bridge-1` and `windows-render-agent`, both heartbeating. Children closed with proof comments.
- OpenAI: current key works, July key refused. OpenRouter: PopDAM key created 2026-08-20, no older key. Anthropic: Albert confirmed in chat "July key was cancelled" (recorded on #213).
- Google AI: leaked key dead; new restricted key created after DeepSeek reviewer APPROVE, stored in 1Password + admin_config GOOGLE_AI_API_KEY, proven by extracting text from a real licensing PDF.

## 3. Not done
1. **DO Spaces key pair (DO_SPACES_KEY/SECRET)** unchanged since 2026-03-11. Blocker verbatim: "no DigitalOcean API token exists in vault vibe_coding or on hetz; Spaces keys cannot be created without one." Consumers: admin_config (sent to agents by heartbeat), Railway worker env, three edge functions. Next step: obtain a DO API token (store in vibe_coding), create new Spaces key, update admin_config + worker + edge function secrets + 1Password, confirm agents upload, revoke old key, get AI reviewer APPROVE on the plan first.
2. **Railway worker fallback Google key**: dead. Decision made: reuse today's new key. A subagent was installing it (reviewer APPROVE → Railway env → restart → 1Password entry "Google AI (Gemini) API Key - PopDAM Railway worker env fallback ..." updated). Check #213 comments for its evidence; if absent, redo. Used only for Google image-tagging when admin_config key can't be read.
3. After 1: delete `fix_admin_config_secret_rotation.md` (repo root) via PR; close #213. Its two NAS passwords belong to #179.

## 4. Facts learned
- On-prem agents always use OpenRouter for PDF extraction while they hold an OpenRouter key; Google is only a fallback, and no settings change can force the Google path (needs agent code change). Not tested live — deliberately left.
- Deploy workflow only diffs HEAD~1; multi-commit pushes may skip deploy — dispatch manually.

## 5. Verify
`curl -X POST https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/agent-api/register` without key → 401. DO key: admin_config DO_SPACES_KEY updated_at > 2026-10-07 and old key revoked in DO.

Posted by Claude chat 6ca58456-c4db-432a-a1ee-8992a64d8afd on hetz
