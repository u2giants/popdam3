-- Fix SPACES_CONFIG rows with empty endpoint/public_base_url
UPDATE public.admin_config
SET value = jsonb_set(
  jsonb_set(
    value::jsonb,
    '{endpoint}',
    '"https://nyc3.digitaloceanspaces.com"'
  ),
  '{public_base_url}',
  '"https://popdam.nyc3.digitaloceanspaces.com"'
),
updated_at = now()
WHERE key = 'SPACES_CONFIG'
  AND (
    value::jsonb ->> 'endpoint' = ''
    OR value::jsonb ->> 'public_base_url' = ''
  );

NOTIFY pgrst, 'reload schema';