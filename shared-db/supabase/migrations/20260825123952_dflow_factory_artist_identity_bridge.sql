-- Issue #1439, first bounded adoption slice.
--
-- Factory already has a canonical source-reference authority in
-- core.factory_source_ref. Expose that contract without creating a second
-- mapping field. Artist has no equivalent source-reference table today, so its
-- nullable bridge remains on the legacy row that owns the PLM-only attributes.
-- Neither path guesses, copies, or synchronizes business data.

alter table dflow.artists
  add column if not exists core_artist_id uuid;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'dflow.artists'::regclass
      and conname = 'artists_core_artist_id_fkey'
  ) then
    alter table dflow.artists
      add constraint artists_core_artist_id_fkey
      foreign key (core_artist_id)
      references core.artist(id)
      on update cascade
      on delete restrict
      not valid;
  end if;
end
$migration$;

alter table dflow.artists
  validate constraint artists_core_artist_id_fkey;

-- Non-unique by design: resolving whether multiple legacy identities represent
-- one canonical artist is a reviewed data decision, not a schema assumption.
create index if not exists artists_core_artist_id_idx
  on dflow.artists (core_artist_id)
  where core_artist_id is not null;

comment on column dflow.artists.core_artist_id is
  'Optional reviewed identity bridge to canonical core.artist. NULL means unresolved or deliberately unlinked; never populate from name-only matching.';

create or replace view dflow.factory_canonical_identity
with (security_invoker = true) as
select
  f.id as legacy_factory_id,
  r.factory_id as core_factory_id
from dflow."Factory" f
left join core.factory_source_ref r
  on r.source_system = 'designflow_plm'
 and r.source_table = 'Factory'
 and r.source_id = f.id::text;

comment on view dflow.factory_canonical_identity is
  'Read-only Cloud SQL DesignFlow Factory identity bridge. core.factory_source_ref designflow_plm/Factory refs are the sole mapping authority; missing rows remain unresolved.';

revoke all on dflow.factory_canonical_identity from public;
revoke all on dflow.factory_canonical_identity from anon;
revoke all on dflow.factory_canonical_identity from authenticated;
revoke all on dflow.factory_canonical_identity from service_role;
