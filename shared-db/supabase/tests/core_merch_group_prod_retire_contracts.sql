-- =====================================================================================
-- core."merchGroup" / "merchGroupHeaders" production retirement — migration
-- 20261115085448, claim #6345, work issue popcre/designflow-item-master#205 step 3.2.
--
-- Proves: the migration renames both tables to *_retired_<YYYYMMDD> (rows kept,
-- nothing dropped); a re-run is a no-op; it refuses (nothing renamed) while a
-- foreign key from another table still references core."merchGroup".
--
-- HOW TO RUN: psql -f this file against the CI replay database (production-shaped)
-- as the migration owner. One transaction, ends in ROLLBACK.
-- =====================================================================================

\set mig `sed -e '/^begin;$/d' -e '/^commit;$/d' supabase/migrations/20261115085448_core_merch_group_prod_retire.sql`

begin;

do $fx$
declare
  r text;
begin
  if to_regclass('dflow_prod."merchGroup"') is null then
    raise exception 'fixture: needs the production-shaped CI replay (dflow_prod."merchGroup")';
  end if;
  -- Start from the pre-retirement shape (the replay already applied the migration).
  if to_regclass('core."merchGroup"') is null then
    select relname into r from pg_class where relnamespace = 'core'::regnamespace
      and relname ~ '^merchGroup_retired_[0-9]{8}$' order by relname desc limit 1;
    execute format('alter table core.%I rename to "merchGroup"', r);
    select relname into r from pg_class where relnamespace = 'core'::regnamespace
      and relname ~ '^merchGroupHeaders_retired_[0-9]{8}$' order by relname desc limit 1;
    execute format('alter table core.%I rename to "merchGroupHeaders"', r);
  end if;
  perform set_config('zz.mg_rows', (select count(*) from core."merchGroup")::text, true);
  create table core.zz6345_child (mg_id integer references core."merchGroup"(mg_id));
end
$fx$;

-- A: a foreign key from another table still points at core."merchGroup" -> refuse.
savepoint before_refusal;
\set ON_ERROR_STOP 0
:mig
\set ON_ERROR_STOP 1
rollback to savepoint before_refusal;

do $a$
begin
  if to_regclass('core."merchGroup"') is null then
    raise exception 'contract A failed: renamed despite a referencing foreign key'; end if;
  drop table core.zz6345_child;
end
$a$;

-- B: clean -> renamed with rows intact; C: re-run is a no-op.
:mig
:mig

do $b$
declare
  sfx text := to_char(now() at time zone 'America/New_York', 'YYYYMMDD');
begin
  if to_regclass('core."merchGroup"') is not null or to_regclass('core."merchGroupHeaders"') is not null then
    raise exception 'contract B failed: an original name still exists'; end if;
  if to_regclass(format('core.%I', 'merchGroup_retired_' || sfx)) is null
     or to_regclass(format('core.%I', 'merchGroupHeaders_retired_' || sfx)) is null then
    raise exception 'contract B failed: retired copies for % missing', sfx; end if;
  execute format('select count(*) from core.%I', 'merchGroup_retired_' || sfx) into sfx;
  if sfx <> current_setting('zz.mg_rows') then
    raise exception 'contract B failed: row count changed'; end if;
  raise notice 'PASS #6345 core merchGroup production retirement contracts';
end
$b$;

rollback;
