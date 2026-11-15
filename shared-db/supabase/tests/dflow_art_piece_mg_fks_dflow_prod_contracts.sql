-- =====================================================================================
-- art_piece / artists merchandise-group key contracts — migration 20261115060819,
-- claim #6343, work issue popcre/designflow-item-master#205 step 3.1 (remaining links).
--
-- Proves: after the migration all ten keys reference dflow_prod."merchGroup"(mg_id)
-- with NO ACTION, validated wherever that parent holds rows (NOT VALID only when it
-- is empty); a key put back on core."merchGroup" is repointed by a re-run; a second
-- re-run is a no-op.
--
-- HOW TO RUN: psql -f this file against the CI replay database (production-shaped)
-- as the migration owner. One transaction, ends in ROLLBACK.
-- =====================================================================================

\set mig `sed -e '/^begin;$/d' -e '/^commit;$/d' supabase/migrations/20261115060819_dflow_art_piece_mg_fks_dflow_prod.sql`

begin;

-- #6345 (designflow-item-master#205 step 3.2): migration 20261115085448 renames
-- core."merchGroup" / "merchGroupHeaders" to *_retired_<date>. This test still
-- exercises the pre-retirement shape, so it renames the retired copies back
-- inside its own transaction (rolled back at the end). No-op before retirement.
do $zz6345$
declare
  r text;
begin
  if to_regclass('core."merchGroup"') is null then
    select c.relname into r from pg_class c where c.relnamespace = 'core'::regnamespace
      and c.relkind = 'r' and c.relname ~ '^merchGroup_retired_[0-9]{8}$' order by c.relname desc limit 1;
    if r is not null then execute format('alter table core.%I rename to "merchGroup"', r); end if;
  end if;
  if to_regclass('core."merchGroupHeaders"') is null then
    select c.relname into r from pg_class c where c.relnamespace = 'core'::regnamespace
      and c.relkind = 'r' and c.relname ~ '^merchGroupHeaders_retired_[0-9]{8}$' order by c.relname desc limit 1;
    if r is not null then execute format('alter table core.%I rename to "merchGroupHeaders"', r); end if;
  end if;
end
$zz6345$;


do $fx$
begin
  if to_regclass('dflow_prod."merchGroup"') is null or to_regclass('dflow.art_piece') is null
     or to_regclass('dflow.artists') is null or to_regclass('core."merchGroup"') is null then
    raise exception 'fixture: needs the production-shaped CI replay (dflow_prod."merchGroup", dflow.art_piece, dflow.artists, core."merchGroup")';
  end if;
end
$fx$;

create function pg_temp.zz6343_ok() returns bigint language sql as $$
  select count(*) from pg_constraint con
  where con.contype = 'f' and con.conrelid in ('dflow.art_piece'::regclass, 'dflow.artists'::regclass)
    and con.conname in ('art_piece_age_group_id_fkey','art_piece_art_source_id_fkey','art_piece_art_type_id_fkey',
      'art_piece_artist_id_fkey','art_piece_big_theme_id_fkey','art_piece_licensor_id_fkey',
      'art_piece_little_theme_id_fkey','art_piece_property_id_fkey','art_piece_style_guide_id_fkey',
      'artists_art_source_id_fkey')
    and con.confrelid = 'dflow_prod."merchGroup"'::regclass
    and con.confdeltype = 'a' and con.confupdtype = 'a'
    and (con.convalidated or not exists (select 1 from dflow_prod."merchGroup"))
$$;

:mig

do $a$
begin
  if pg_temp.zz6343_ok() <> 10 then
    raise exception 'contract A failed: % of 10 keys reference dflow_prod."merchGroup" as required', pg_temp.zz6343_ok(); end if;
  if exists (select 1 from pg_constraint where contype = 'f'
             and conrelid in ('dflow.art_piece'::regclass, 'dflow.artists'::regclass)
             and confrelid = 'core."merchGroup"'::regclass) then
    raise exception 'contract A failed: a key still references core."merchGroup"'; end if;
  -- B: put one key back on core and the migration must repoint it.
  alter table dflow.artists drop constraint artists_art_source_id_fkey;
  alter table dflow.artists add constraint artists_art_source_id_fkey
    foreign key (art_source_id) references core."merchGroup"(mg_id) not valid;
end
$a$;

:mig
:mig

do $b$
begin
  if pg_temp.zz6343_ok() <> 10 then
    raise exception 'contract B failed: re-apply left % of 10 keys on dflow_prod', pg_temp.zz6343_ok(); end if;
  raise notice 'PASS #6343 art_piece/artists merchandise-group key contracts';
end
$b$;

rollback;
