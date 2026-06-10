-- Server-side receipt verification for check-ins.
--
-- Problem: a check-in is currently marked 'complete' the moment the helper's
-- HTTP upload returns. For Seafile-sourced check-ins the file takes an extra hop
-- (designer → Seafile → NYC Synology), so "upload returned" does not mean the
-- fully-synced file has actually landed intact on the Synology. Releasing the
-- lock then defeats the purpose of check-out/check-in.
--
-- Fix: for source_provider = 'seafile', complete-checkin parks the checkout in
-- 'verifying' instead of 'complete'. The bridge agent (running ON the NYC
-- Synology) stats the on-disk file, checks size, computes a full SHA-256, and
-- only when it matches the expected hash does the server flip it to 'complete'.
--
-- The lock is held the whole time: 'verifying' is part of the
-- asset_checkouts_one_active_per_asset partial unique index. If verification
-- never succeeds before verify_deadline_at, the checkout STAYS in 'verifying'
-- (lock retained) and is flagged via verify_failed_at + verify_error so an admin
-- can investigate — it is intentionally NOT moved to 'error', because 'error' is
-- outside the lock index and would release the asset.
--
-- All columns nullable / defaulted; no backfill. Existing Synology direct-upload
-- check-ins are unaffected and continue to complete immediately.

ALTER TABLE public.asset_checkouts
  ADD COLUMN IF NOT EXISTS verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS expected_quick_hash text,
  ADD COLUMN IF NOT EXISTS final_hash          text,
  ADD COLUMN IF NOT EXISTS final_size          bigint,
  ADD COLUMN IF NOT EXISTS verify_attempts     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verify_deadline_at  timestamptz,
  ADD COLUMN IF NOT EXISTS verify_resolve_at      timestamptz,
  ADD COLUMN IF NOT EXISTS verify_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS verify_failed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS verify_error        text,
  ADD COLUMN IF NOT EXISTS redrive_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS redrive_requested   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolution          text;

COMMENT ON COLUMN public.asset_checkouts.verified_at         IS 'When the bridge agent confirmed the uploaded file was received intact on the Synology';
COMMENT ON COLUMN public.asset_checkouts.expected_quick_hash IS 'Quick-hash (SHA-256 of first 64KB + last 64KB + size) of the uploaded snapshot, computed by the helper. The bridge agent verifies the on-disk file against this — a ~128KB read instead of a full-file read.';
COMMENT ON COLUMN public.asset_checkouts.final_hash          IS 'Quick-hash of the on-disk file as observed by the bridge agent at verification time (matches expected_quick_hash on success; becomes the asset quick_hash)';
COMMENT ON COLUMN public.asset_checkouts.final_size          IS 'On-disk file size (bytes) observed by the bridge agent at verification time';
COMMENT ON COLUMN public.asset_checkouts.verify_attempts    IS 'Number of bridge-agent verification attempts so far (file-not-yet-arrived counts as an attempt)';
COMMENT ON COLUMN public.asset_checkouts.verify_deadline_at IS 'T1: after this the check-in is flagged and a re-drive may be requested. Pushed forward when the verifier was offline (clock freeze).';
COMMENT ON COLUMN public.asset_checkouts.verify_resolve_at      IS 'T2: after this an unverified check-in is auto-resolved (lock released into error with diagnostics). Pushed forward when the verifier was offline.';
COMMENT ON COLUMN public.asset_checkouts.verify_last_attempt_at IS 'Timestamp of the last verification attempt; a large gap means the verifier was down, so deadlines shift forward by the gap';
COMMENT ON COLUMN public.asset_checkouts.verify_failed_at   IS 'Set at T1 when verification has not yet succeeded; lock still held while re-drive/retry continues';
COMMENT ON COLUMN public.asset_checkouts.verify_error       IS 'Most recent verification detail (not-arrived / mismatch / resolution reason)';
COMMENT ON COLUMN public.asset_checkouts.redrive_count      IS 'Number of times the helper has been asked to re-upload the snapshot to self-heal a stuck check-in';
COMMENT ON COLUMN public.asset_checkouts.redrive_requested  IS 'Server is asking the helper to re-drive (re-upload) this check-in from its retained snapshot';
COMMENT ON COLUMN public.asset_checkouts.resolution         IS 'Terminal resolution of a stuck check-in: verified_late | unverified_released_original | unverified_released_foreign | unverified_released_missing';

-- Index to let the bridge agent cheaply claim Seafile check-ins awaiting verification.
CREATE INDEX IF NOT EXISTS asset_checkouts_awaiting_verification
  ON public.asset_checkouts (verify_deadline_at)
  WHERE status = 'verifying' AND source_provider = 'seafile';
