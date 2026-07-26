# Handoff: rotate the 8 admin_config credentials that were exposed

**Status:** OPEN — owner action required. Written 2026-07-24.
**Why this exists:** the RLS leak below is already FIXED and live in production, but the
credentials that were readable during the exposure window must still be **rotated**.
Delete this file once all 8 are rotated and 1Password is updated.

---

## Background (what happened)

`public.admin_config` on the shared prod Supabase project `qsllyeztdwjgirsysgai` had an
RLS read policy of `USING (true)` for role `authenticated`. Result: **any logged-in user
of any POP app on the shared backend could `SELECT` all rows**, including 8 plaintext
credentials. Writes were already admin-gated; only reads leaked.

**The leak is fixed and LIVE** (shared-db PR #204, merged + auto-deployed 2026-07-24;
verified: non-admin secret visibility is now 0, admin 8). No further code change is
needed to stop the leak. What remains is rotation, because the values were exposed.

## The 8 credentials to rotate (assume compromised)

| # | admin_config key | Service | Where to rotate | 1Password item (pre-rotation backup) |
|---|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` | Anthropic | console.anthropic.com | `ai-provider-api-keys` → field `anthropic_popdam_shared_supabase` |
| 2 | `OPENAI_API_KEY` | OpenAI | platform.openai.com | `ai-provider-api-keys` → `openai_popdam_shared_supabase` |
| 3 | `OPENROUTER_API_KEY` | OpenRouter | openrouter.ai | `ai-provider-api-keys` → `openrouter_popdam_shared_supabase` |
| 4 | `GOOGLE_AI_API_KEY` | Google AI | aistudio.google.com | `ai-provider-api-keys` → `gemini_popdam_shared_supabase` |
| 5 | `DO_SPACES_KEY` | DigitalOcean Spaces | DO console → API → Spaces keys | `DigitalOcean Spaces - popdam bucket (nyc3)` |
| 6 | `DO_SPACES_SECRET` | DigitalOcean Spaces | (same key pair as #5) | (same item) |
| 7 | `WINDOWS_AGENT_SG_NAS_PASS` | AD account `popdam` (styleguides share, edge2) | **Active Directory** `IML.isaacmorris.com` | `Synology edgesynology2 - styleguides SMB share` |
| 8 | `WINDOWS_AGENT_NAS_PASS` | AD account `ahazan` (mac share, edge2) | **Active Directory** `IML.isaacmorris.com` | `Synology 192.168.3.101 - mac SMB share` |

All 1Password items are in the `vibe_coding` vault.

## How to rotate each (the loop)

For each credential:
1. Generate a new value at the provider (for #1–6) or change the AD password (#7–8).
2. **Save the new value into PopDAM/PopSG Settings** (admin login), which writes it back
   to `admin_config`. For the NAS passwords this is: log in to `sg.designflow.app`
   (styleguides) / `dam.designflow.app` (mac) → Settings → the NAS section → Password →
   Save. For the API/DO keys, the relevant Settings tab.
3. Update the matching 1Password item field with the new value.
4. Revoke/delete the old value at the provider once the new one is confirmed working.

## Gotchas

- **API keys are billable** — before revoking, check each provider's usage/billing for
  unexpected activity during the exposure window (2026-07-24 back to whenever the policy
  was created).
- **DO Spaces** is a single key *pair* (#5 + #6) — rotating replaces both together.
- **NAS passwords are AD domain accounts**, not Synology-local. Changing `popdam`/`ahazan`
  in AD **immediately breaks the Windows scraping agents** until the new value is saved in
  Settings — do it in a quiet window. Both agents read from `edgesynology2` (the read
  replica); see the NAS topology spec.
- Two of these (the NAS passwords) are slated to move into **Supabase Vault** and the 6
  API/storage keys into **environment variables** — see
  `project_admin_config_secret_exposure` memory + the secrets-placement discussion. That
  migration is a separate, later task; rotation should NOT wait for it.

## Verification when done

- Each provider shows the old key revoked and a new key active.
- PopDAM/PopSG features that use each key still work (AI tagging, thumbnails/renders to DO
  Spaces, NAS scans/crawls).
- All 8 1Password fields hold the new values.
- Then delete this file.

## Related

- RLS fix: `u2giants/shared-db` PR #204 (merged, live).
- Long-term secret placement (Vault vs env): `project_admin_config_secret_exposure` memory.
- NAS topology (which unit, AD): `u2giants/synology-monitor` → `docs/NAS_TOPOLOGY.md`.
