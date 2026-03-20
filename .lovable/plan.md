

# Fix: Invite Email Delivery Proof & Diagnostics

## Problem

The `send-invite-email` edge function returns `{"ok": true}` but emails never arrive. The function is deployed on the external Supabase project, and I **cannot** see its logs (my tools only access the Lovable-internal project). The response is 38 bytes — suspiciously small, possibly missing a real `messageId`.

Two likely root causes:

1. **Sender not verified in Brevo**: The code sends from `noreply@popheadquarters.com`. Brevo accepts the API call (HTTP 200) but silently drops the email if that sender email/domain isn't authorized in your Brevo account. This is the most probable cause.

2. **No delivery proof captured**: The function doesn't log the full Brevo response, so there's no way to verify what Brevo actually returned.

## Plan

### 1. Add full Brevo response logging to `sendBrevoEmail` (brevo.ts)
- Log the raw HTTP status, response headers, and full JSON body from Brevo before returning
- Capture and return Brevo's exact `messageId` (string like `<uuid@smtp-relay.brevo.com>`)
- If the response is 200 but `messageId` is missing/empty, treat it as a warning

### 2. Surface Brevo diagnostics in `send-invite-email` response
- Return the Brevo HTTP status code, messageId, and any warning to the frontend
- The frontend toast will show: "Email queued — Brevo ID: xxx" or "Brevo accepted but no messageId returned (check sender verification)"

### 3. Update SettingsPage resend handler
- Display the Brevo messageId in the success toast so you can cross-reference with Brevo logs
- On failure, show the specific Brevo error (e.g., "unauthorized sender")

### 4. Document sender verification requirement
- Add a console.warn at startup if the sender domain doesn't match common verified patterns
- The fix note: **You must verify `noreply@popheadquarters.com` (or the entire `popheadquarters.com` domain) in your Brevo account under Settings → Senders & IPs → Domains**. Without this, Brevo accepts the API call but never sends.

## Regarding log access

I can only query logs/analytics for the **Lovable-internal** Supabase project (`vklanxwmaeqjbwtmnygj`), not your external project (`ryltkzzernhwnojzouyb`). That's why my log queries return empty. Connecting the Supabase MCP connector would not help — it connects to the Lovable-managed project, not your external one. For external project logs, you'll need the Supabase dashboard directly.

## Files changed
- `supabase/functions/_shared/brevo.ts` — verbose logging + richer return value
- `supabase/functions/send-invite-email/index.ts` — pass diagnostics through
- `src/pages/SettingsPage.tsx` — show Brevo messageId/warnings in toast

