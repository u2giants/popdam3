-- SECURITY: restrict reads of secret-bearing admin_config keys to admins.
--
-- Problem found 2026-07-23 on production qsllyeztdwjgirsysgai:
--   policy "Authenticated read admin_config" was  FOR SELECT TO authenticated USING (true)
-- so ANY logged-in user of ANY app on this SHARED backend could read every row of
-- public.admin_config, including 8 plaintext credentials:
--   ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, GOOGLE_AI_API_KEY,
--   DO_SPACES_KEY, DO_SPACES_SECRET, WINDOWS_AGENT_NAS_PASS, WINDOWS_AGENT_SG_NAS_PASS
-- Writes were already correctly admin-gated (INSERT/UPDATE/DELETE require
-- has_role(auth.uid(),'admin')); only SELECT was exposed.
--
-- Fix: split the read policy in two. Non-admin authenticated users keep read access
-- to ordinary operational config (scan progress, bulk operations, NAS paths, etc.),
-- but secret-named keys become admin-only. The two SELECT policies are OR'd, so an
-- admin still reads everything and the Settings UI keeps working unchanged.
-- service_role bypasses RLS, so edge functions, the worker and the agents are unaffected.
--
-- Classification is pattern-based rather than an explicit list so that any NEW
-- secret-named key is protected automatically (fail-safe). Verified against live
-- data: the pattern matches exactly those 8 keys out of 755 rows - no false positives.

drop policy if exists "Authenticated read admin_config" on public.admin_config;

create policy "Authenticated read non-secret admin_config"
  on public.admin_config
  for select
  to authenticated
  using (key !~* '(pass|secret|token|key|cred|pwd)');

create policy "Admin read all admin_config"
  on public.admin_config
  for select
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

-- Defense in depth: anon never needs to write here. RLS already blocks anon
-- INSERT/UPDATE/DELETE (no anon write policy exists), but TRUNCATE is NOT
-- RLS-gated, so the table-level grant was the only control. Reads stay granted
-- because the existing "anon can read SCAN_REQUEST for Realtime watcher" policy
-- still needs SELECT.
revoke insert, update, delete, truncate on public.admin_config from anon;

comment on table public.admin_config is
  'Admin-editable configuration store. Secret-bearing keys (matching pass|secret|token|key|cred|pwd) are readable only by admins; all other keys are readable by any authenticated user. Writes are admin-only. Prefer Supabase Vault for new secrets.';
