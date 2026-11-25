-- Issue #7132 (claim #7133). Dedicated read-only database role for AI helper
-- tools, so ad-hoc checks never connect as an application's runtime login.
-- derived-from: none
--
-- WHY. On 2026-11-25 ~1:37 PM EST production DesignFlow role saves failed with
-- "cannot execute INSERT in a read-only transaction": a helper connected as
-- designflow_prod_backend_runtime through the Supavisor transaction pooler
-- (port 6543) with `default_transaction_read_only=on`, and the setting stuck to
-- backends shared with the app. Supavisor pools per login, so a separate login
-- confines any such leak to the tool's own connections.
-- Owner approval (Albert Hazan, 2026-11-25 2:42 PM EST): "it's approved. move it forward".
--
-- WHAT THIS CREATES.
--   * role ai_readonly_reader: NOLOGIN here (login + password provisioned
--     outside git into 1Password vibe_coding, the #5776 / #4836 pattern),
--     BYPASSRLS so row rules do not hide rows from a reader (560+ business
--     tables use RLS), connection limit 5, statement_timeout 30s,
--     idle_in_transaction_session_timeout 60s, default_transaction_read_only
--     on (a convenience; the boundary is that it holds no write privilege).
--   * USAGE + SELECT on every table/view that exists now in the business
--     schemas listed below. No default privileges (plm's are pinned to
--     service_role only); a later table needs its own grant.
--   * NOT granted: Supabase system schemas (auth, storage, vault, realtime,
--     net, cron, graphql*, extensions), sequences, functions, any write.
--   * Secret-bearing columns are withheld: tables holding a password or a
--     sign-in token column get column-level SELECT on every OTHER column;
--     auth_token / quote_auth_token tables get nothing. pg_read_all_data was
--     rejected because it would expose auth.users password hashes.
--
-- Table discovery is dynamic so the from-empty CI replay applies cleanly.
-- PLAIN CREATE ROLE with an existence guard: a pre-existing role with unknown
-- attributes must fail the apply rather than be silently adopted.
--
-- ROLLBACK (forward fix):
--   reassign/drop privileges: drop owned by ai_readonly_reader;
--   drop role ai_readonly_reader;

begin;
set lock_timeout = '5s';
set statement_timeout = '5min';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'ai_readonly_reader') then
    raise exception 'ABORT #7132: role ai_readonly_reader already exists; refusing to adopt it';
  end if;
end $$;

create role ai_readonly_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls connection limit 5;
alter role ai_readonly_reader set default_transaction_read_only = on;
alter role ai_readonly_reader set statement_timeout = '30s';
alter role ai_readonly_reader set idle_in_transaction_session_timeout = '60s';

do $grants$
declare
  s text;
  t record;
  cols text;
  readable_schemas constant text[] := array[
    'plm','dflow_prod','core','api','public','dam','hts_rag','coldlion',
    'pim','app','crm','ingest','archive','dflow_archive','supabase_migrations'];
  -- Column names that hold a password or a credential, never readable.
  secret_col constant text := '^(passw|.*_passw|token|replaced_token|initiated_token|agent_key_hash)$';
  -- Tables whose purpose is sign-in tokens: no access at all.
  secret_table constant text := '^(auth_token|quote_auth_token)$';
begin
  foreach s in array readable_schemas loop
    continue when to_regnamespace(s) is null;
    execute format('grant usage on schema %I to ai_readonly_reader', s);
    execute format('grant select on all tables in schema %I to ai_readonly_reader', s);
  end loop;

  for t in
    select n.nspname, c.relname, c.oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(readable_schemas)
      and c.relkind in ('r','p','v','m','f')
      and (c.relname ~ secret_table
           or exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                        and a.attname ~ secret_col))
  loop
    execute format('revoke select on table %I.%I from ai_readonly_reader', t.nspname, t.relname);
    continue when t.relname ~ secret_table;
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attname !~ secret_col;
    if cols is not null then
      execute format('grant select (%s) on table %I.%I to ai_readonly_reader', cols, t.nspname, t.relname);
    end if;
  end loop;
end
$grants$;

-- Self-check: no write privilege anywhere, and no secret column readable.
do $check$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where grantee = 'ai_readonly_reader' and privilege_type <> 'SELECT'
  ) then
    raise exception 'ABORT #7132: ai_readonly_reader holds a non-SELECT table privilege';
  end if;
  if exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema')
      and a.attnum > 0 and not a.attisdropped
      and a.attname ~ '^(passw|.*_passw|token|replaced_token|initiated_token|agent_key_hash)$'
      and has_column_privilege('ai_readonly_reader', c.oid, a.attnum, 'SELECT')
  ) then
    raise exception 'ABORT #7132: ai_readonly_reader can read a secret column';
  end if;
end
$check$;

commit;
