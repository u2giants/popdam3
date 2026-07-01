-- Repair Supabase Auth refresh-token sequence after the shared database import.
-- The sequence was behind auth.refresh_tokens.max(id), causing intermittent
-- "Database error granting user" failures on OAuth callback.

SELECT setval(
  'auth.refresh_tokens_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM auth.refresh_tokens),
  false
);
