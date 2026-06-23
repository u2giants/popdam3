-- Imported from production migration history so Supabase CLI can compare
-- local files with the already-applied shared database migration ledger.
-- Version: 20260621165140
-- Name: clear_partial_migration_data

truncate crm.meeting_note restart identity cascade;
