
-- Idempotent seed: insert default admin_config values only if missing
INSERT INTO public.admin_config (key, value) VALUES
  ('SCAN_MIN_DATE', '"2010-01-01"'::jsonb),
  ('THUMBNAIL_MIN_DATE', '"2020-01-01"'::jsonb),
  ('NAS_HOST', '"edgesynology2"'::jsonb),
  ('NAS_IP', '"100.64.0.2"'::jsonb),
  ('NAS_SHARE', '"mac"'::jsonb),
  ('NAS_MOUNT_ROOT', '"/mnt/nas/mac"'::jsonb),
  ('DO_SPACES_REGION', '"nyc3"'::jsonb),
  ('DO_SPACES_BUCKET', '"popdam"'::jsonb),
  ('DO_SPACES_BASE_URL', '"https://popdam.nyc3.digitaloceanspaces.com"'::jsonb)
ON CONFLICT (key) DO NOTHING;
