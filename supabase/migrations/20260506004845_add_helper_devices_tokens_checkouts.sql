-- ─── Checkout status enum ─────────────────────────────────────────────────────
CREATE TYPE checkout_status AS ENUM (
  'active',          -- file checked out, being edited
  'checkin_queued',  -- user clicked check in, waiting for file stability
  'uploading',       -- snapshot uploading to Synology
  'verifying',       -- upload done, verifying hash
  'complete',        -- successfully checked in
  'discarded',       -- abandoned without check-in
  'error',           -- error, needs attention
  'conflict'         -- master file changed during checkout
);

-- ─── Helper device registrations ─────────────────────────────────────────────
CREATE TABLE helper_devices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name    text        NOT NULL,
  device_os      text        NOT NULL CHECK (device_os IN ('windows', 'macos')),
  helper_version text        NOT NULL,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  registered_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE helper_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own devices"
  ON helper_devices FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users insert own devices"
  ON helper_devices FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own devices"
  ON helper_devices FOR UPDATE
  USING (user_id = auth.uid());

-- ─── Short-lived one-time tokens for popdam:// URLs ───────────────────────────
CREATE TABLE helper_tokens (
  id          text        PRIMARY KEY,   -- random 32-char hex in the URL
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      text        NOT NULL CHECK (action IN ('checkout', 'checkin', 'open', 'reveal', 'discard')),
  asset_id    uuid        REFERENCES assets(id) ON DELETE CASCADE,
  checkout_id uuid,                      -- FK added below after asset_checkouts exists
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE helper_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own tokens"
  ON helper_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users insert own tokens"
  ON helper_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ─── Asset checkout records ───────────────────────────────────────────────────
CREATE TABLE asset_checkouts (
  id                   uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             uuid            NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  user_id              uuid            NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  device_id            uuid            REFERENCES helper_devices(id),
  status               checkout_status NOT NULL DEFAULT 'active',
  checked_out_at       timestamptz     NOT NULL DEFAULT now(),
  checked_in_at        timestamptz,
  -- State of source file at checkout time (used for conflict detection)
  source_hash          text            NOT NULL,
  source_size          bigint          NOT NULL,
  -- Filled during check-in
  checkin_hash         text,
  checkin_size         bigint,
  upload_method        text,            -- 'synology_file_station' | 'webdav' | 'smb_local'
  synology_upload_user text,            -- Synology account that performed the write
  error_message        text,
  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now()
);

-- One active checkout per asset at a time
CREATE UNIQUE INDEX asset_checkouts_one_active_per_asset
  ON asset_checkouts(asset_id)
  WHERE status IN ('active', 'checkin_queued', 'uploading', 'verifying');

ALTER TABLE asset_checkouts ENABLE ROW LEVEL SECURITY;

-- All authenticated users can see checkouts (so lock status shows on every asset)
CREATE POLICY "authenticated users see all checkouts"
  ON asset_checkouts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "users insert own checkouts"
  ON asset_checkouts FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own checkouts"
  ON asset_checkouts FOR UPDATE
  USING (user_id = auth.uid());

-- FK from helper_tokens to asset_checkouts (added after both tables exist)
ALTER TABLE helper_tokens
  ADD CONSTRAINT helper_tokens_checkout_id_fkey
  FOREIGN KEY (checkout_id) REFERENCES asset_checkouts(id) ON DELETE SET NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_asset_checkouts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER asset_checkouts_updated_at
  BEFORE UPDATE ON asset_checkouts
  FOR EACH ROW EXECUTE FUNCTION update_asset_checkouts_updated_at();
