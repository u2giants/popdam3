-- Session-scoped guard for the following DAM taxonomy backfill. Supabase's
-- migration runner executes migration files on one session but not inside one
-- outer transaction, so SET LOCAL inside the cutover file is advisory only.
set statement_timeout = '10min';
