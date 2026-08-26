-- Issue #1547: separate the Disney OPA portal namespace from resolved studio ownership.
-- Schema only. Licensed OPA mappings remain private and are loaded at runtime.

create table plm.opa_property_studio_resolution (
  resolution_id       uuid        primary key default gen_random_uuid(),
  licensed_property_id bigint     not null
    references plm.opa_property(licensed_property_id) on delete restrict,
  studio_code         text            null,
  resolution_status   text        not null,
  provenance_type     text        not null,
  provenance_reference text           null,
  resolution_reason   text             null,
  resolved_at         timestamptz not null default clock_timestamp(),
  resolved_by         text        not null,
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),

  constraint opa_property_studio_resolution_identity_key
    unique nulls not distinct (licensed_property_id, studio_code),
  constraint opa_property_studio_resolution_studio_ck check (
    studio_code is null or studio_code in ('disney', 'pixar', 'marvel', 'lucasfilm')
  ),
  constraint opa_property_studio_resolution_status_ck check (
    resolution_status in ('canonical', 'inferred_candidate', 'ambiguous_crossover', 'unresolved')
  ),
  constraint opa_property_studio_resolution_provenance_ck check (
    provenance_type in (
      'direct_source_assertion', 'owner_reviewed_resolution',
      'inferred_candidate', 'ambiguous_crossover', 'unresolved'
    )
  ),
  constraint opa_property_studio_resolution_state_shape_ck check (
    case resolution_status
      when 'canonical' then
        studio_code is not null
        and provenance_type in ('direct_source_assertion', 'owner_reviewed_resolution')
      when 'inferred_candidate' then
        studio_code is not null and provenance_type = 'inferred_candidate'
      when 'ambiguous_crossover' then
        provenance_type in ('ambiguous_crossover', 'owner_reviewed_resolution')
      when 'unresolved' then
        studio_code is null and provenance_type in ('unresolved', 'owner_reviewed_resolution')
      else false
    end
  ),
  constraint opa_property_studio_resolution_reference_ck check (
    provenance_type = 'unresolved'
    or (provenance_reference is not null and btrim(provenance_reference) <> '')
  ),
  constraint opa_property_studio_resolution_reason_ck check (
    resolution_reason is null or btrim(resolution_reason) <> ''
  ),
  constraint opa_property_studio_resolution_actor_ck check (btrim(resolved_by) <> '')
);

comment on table plm.opa_property_studio_resolution is
  'Governed studio evidence for stable Disney OPA property IDs. Disney OPA is the portal/source namespace, not an ownership assertion. One property may carry evidence for multiple studios. Raw OPA identities and links remain unchanged.';
comment on column plm.opa_property_studio_resolution.studio_code is
  'Resolved or candidate studio: disney, pixar, marvel, or lucasfilm. NULL is required for unresolved and permitted for an unscoped ambiguous/crossover decision.';
comment on column plm.opa_property_studio_resolution.resolution_status is
  'canonical is consumable ownership; inferred_candidate, ambiguous_crossover, and unresolved are excluded from canonical studio views.';
comment on column plm.opa_property_studio_resolution.provenance_type is
  'Authority for the decision. Only direct_source_assertion or owner_reviewed_resolution may support canonical ownership.';

alter table plm.opa_property_studio_resolution enable row level security;
revoke all on table plm.opa_property_studio_resolution from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table plm.opa_property_studio_resolution from service_role;
grant select on table plm.opa_property_studio_resolution to service_role;

create or replace function plm.sync_opa_property_studio_resolution(p_rows jsonb)
returns table (
  rows_seen integer,
  rows_inserted integer,
  rows_updated integer,
  rows_unchanged integer
)
language plpgsql
security definer
set search_path = plm, public, extensions, pg_temp
as $function$
declare
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
  v_bad integer;
  v_sample text;
begin
  if not plm.opa_loader_privilege_ok(auth.role(), session_user) then
    raise exception using errcode = '42501',
      message = 'OPA studio resolution sync requires service_role or the governed database workflow';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'P0001',
      message = 'OPA studio resolution sync requires a non-empty JSON array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plm.sync_opa_property_studio_resolution', 0));

  select count(*) filter (where reason is not null),
         (array_agg(reason order by ord) filter (where reason is not null))[1]
    into v_bad, v_sample
  from (
    select r.ord,
      case
        when jsonb_typeof(r.value) <> 'object' then 'row is not an object'
        when jsonb_typeof(r.value -> 'licensed_property_id') <> 'number'
          then 'licensed_property_id is not a number'
        when (r.value ->> 'licensed_property_id') !~ '^-?[0-9]+$'
          then 'licensed_property_id is not an integer'
        when (r.value ->> 'licensed_property_id')::numeric not between
             -9223372036854775808::numeric and 9223372036854775807::numeric
          then 'licensed_property_id is outside the bigint range'
        when r.value ? 'studio_code'
             and jsonb_typeof(r.value -> 'studio_code') not in ('string', 'null')
          then 'studio_code is not a string or null'
        when nullif(btrim(r.value ->> 'studio_code'), '') is not null
             and btrim(r.value ->> 'studio_code') not in ('disney', 'pixar', 'marvel', 'lucasfilm')
          then 'studio_code is unrecognized'
        when btrim(coalesce(r.value ->> 'resolution_status', '')) not in
             ('canonical', 'inferred_candidate', 'ambiguous_crossover', 'unresolved')
          then 'resolution_status is missing or unrecognized'
        when btrim(coalesce(r.value ->> 'provenance_type', '')) not in
             ('direct_source_assertion', 'owner_reviewed_resolution',
              'inferred_candidate', 'ambiguous_crossover', 'unresolved')
          then 'provenance_type is missing or unrecognized'
      end reason
    from jsonb_array_elements(p_rows) with ordinality r(value, ord)
  ) checked;

  if v_bad > 0 then
    raise exception using errcode = 'P0001',
      message = format(
        'OPA studio resolution sync refused %s invalid row(s); first error: %s. Row content is intentionally omitted.',
        v_bad, v_sample
      );
  end if;

  drop table if exists pg_temp._opa_studio_incoming;
  create temporary table pg_temp._opa_studio_incoming on commit drop as
  select
    (r.value ->> 'licensed_property_id')::bigint licensed_property_id,
    nullif(btrim(r.value ->> 'studio_code'), '') studio_code,
    btrim(r.value ->> 'resolution_status') resolution_status,
    btrim(r.value ->> 'provenance_type') provenance_type,
    nullif(btrim(r.value ->> 'provenance_reference'), '') provenance_reference,
    nullif(btrim(r.value ->> 'resolution_reason'), '') resolution_reason
  from jsonb_array_elements(p_rows) r(value);

  select count(*) into v_bad
  from (
    select licensed_property_id, studio_code
    from pg_temp._opa_studio_incoming
    group by licensed_property_id, studio_code
    having count(*) > 1
  ) duplicated;
  if v_bad > 0 then
    raise exception using errcode = 'P0001',
      message = 'OPA studio resolution sync contains duplicate property/studio identities';
  end if;

  select count(*) into v_bad
  from pg_temp._opa_studio_incoming i
  where not exists (
    select 1 from plm.opa_property p
    where p.licensed_property_id = i.licensed_property_id
  );
  if v_bad > 0 then
    raise exception using errcode = 'P0001',
      message = format('OPA studio resolution sync references %s unknown OPA property ID(s)', v_bad);
  end if;

  select count(*) into v_bad
  from pg_temp._opa_studio_incoming i
  where not (
    case i.resolution_status
      when 'canonical' then
        i.studio_code is not null
        and i.provenance_type in ('direct_source_assertion', 'owner_reviewed_resolution')
      when 'inferred_candidate' then
        i.studio_code is not null and i.provenance_type = 'inferred_candidate'
      when 'ambiguous_crossover' then
        i.provenance_type in ('ambiguous_crossover', 'owner_reviewed_resolution')
      when 'unresolved' then
        i.studio_code is null and i.provenance_type in ('unresolved', 'owner_reviewed_resolution')
      else false
    end
  ) or (
    i.provenance_type <> 'unresolved'
    and i.provenance_reference is null
  );
  if v_bad > 0 then
    raise exception using errcode = 'P0001',
      message = format('OPA studio resolution sync refused %s invalid status/provenance shape(s)', v_bad);
  end if;

  -- Lower-authority refreshes may never erase an owner review or demote canonical evidence.
  select count(*) into v_bad
  from pg_temp._opa_studio_incoming i
  join plm.opa_property_studio_resolution e
    on e.licensed_property_id = i.licensed_property_id
   and e.studio_code is not distinct from i.studio_code
  where (e.provenance_type = 'owner_reviewed_resolution'
         and i.provenance_type <> 'owner_reviewed_resolution')
     or (e.resolution_status = 'canonical'
         and i.resolution_status <> 'canonical'
         and i.provenance_type <> 'owner_reviewed_resolution')
     or (e.provenance_type = 'direct_source_assertion'
         and i.provenance_type in ('inferred_candidate', 'ambiguous_crossover', 'unresolved'));
  if v_bad > 0 then
    raise exception using errcode = 'P0001',
      message = format('OPA studio resolution sync refused %s lower-authority overwrite(s)', v_bad);
  end if;

  select count(*)::integer into rows_seen from pg_temp._opa_studio_incoming;
  select count(*)::integer into rows_inserted
  from pg_temp._opa_studio_incoming i
  where not exists (
    select 1 from plm.opa_property_studio_resolution e
    where e.licensed_property_id = i.licensed_property_id
      and e.studio_code is not distinct from i.studio_code
  );
  select count(*)::integer into rows_updated
  from pg_temp._opa_studio_incoming i
  join plm.opa_property_studio_resolution e
    on e.licensed_property_id = i.licensed_property_id
   and e.studio_code is not distinct from i.studio_code
  where (e.resolution_status, e.provenance_type, e.provenance_reference, e.resolution_reason)
    is distinct from
        (i.resolution_status, i.provenance_type, i.provenance_reference, i.resolution_reason);
  rows_unchanged := rows_seen - rows_inserted - rows_updated;

  insert into plm.opa_property_studio_resolution (
    licensed_property_id, studio_code, resolution_status, provenance_type,
    provenance_reference, resolution_reason, resolved_by
  )
  select licensed_property_id, studio_code, resolution_status, provenance_type,
         provenance_reference, resolution_reason, v_actor
  from pg_temp._opa_studio_incoming
  on conflict on constraint opa_property_studio_resolution_identity_key do update
  set resolution_status = excluded.resolution_status,
      provenance_type = excluded.provenance_type,
      provenance_reference = excluded.provenance_reference,
      resolution_reason = excluded.resolution_reason,
      resolved_at = clock_timestamp(),
      resolved_by = excluded.resolved_by,
      updated_at = clock_timestamp()
  where (plm.opa_property_studio_resolution.resolution_status,
         plm.opa_property_studio_resolution.provenance_type,
         plm.opa_property_studio_resolution.provenance_reference,
         plm.opa_property_studio_resolution.resolution_reason)
    is distinct from
        (excluded.resolution_status, excluded.provenance_type,
         excluded.provenance_reference, excluded.resolution_reason);

  return next;
end;
$function$;

comment on function plm.sync_opa_property_studio_resolution(jsonb) is
  'Guarded atomic runtime loader for private OPA studio decisions. It accepts only recognized studio/status/provenance combinations, never defaults to Disney, never removes absent rows, and never changes raw OPA identities or links.';
revoke all on function plm.sync_opa_property_studio_resolution(jsonb)
  from public, anon, authenticated;
grant execute on function plm.sync_opa_property_studio_resolution(jsonb) to service_role;

create view api.opa_disney_property
with (security_barrier = true) as
select p.licensed_property_id, p.property_name,
       'disney_opa'::text as source_system,
       'Disney OPA'::text as portal_operator,
       r.studio_code as resolved_studio,
       r.resolution_status, r.provenance_type, r.resolved_at
from plm.opa_property p
join plm.opa_property_studio_resolution r using (licensed_property_id)
where r.studio_code = 'disney'
  and r.resolution_status = 'canonical'
  and r.provenance_type in ('direct_source_assertion', 'owner_reviewed_resolution')
  and (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

create view api.opa_marvel_property
with (security_barrier = true) as
select p.licensed_property_id, p.property_name,
       'disney_opa'::text as source_system,
       'Disney OPA'::text as portal_operator,
       r.studio_code as resolved_studio,
       r.resolution_status, r.provenance_type, r.resolved_at
from plm.opa_property p
join plm.opa_property_studio_resolution r using (licensed_property_id)
where r.studio_code = 'marvel'
  and r.resolution_status = 'canonical'
  and r.provenance_type in ('direct_source_assertion', 'owner_reviewed_resolution')
  and (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

create view api.opa_lucasfilm_property
with (security_barrier = true) as
select p.licensed_property_id, p.property_name,
       'disney_opa'::text as source_system,
       'Disney OPA'::text as portal_operator,
       r.studio_code as resolved_studio,
       r.resolution_status, r.provenance_type, r.resolved_at
from plm.opa_property p
join plm.opa_property_studio_resolution r using (licensed_property_id)
where r.studio_code = 'lucasfilm'
  and r.resolution_status = 'canonical'
  and r.provenance_type in ('direct_source_assertion', 'owner_reviewed_resolution')
  and (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

comment on view api.opa_disney_property is
  'Canonical Disney-studio OPA properties only. Disney OPA identifies the portal operator; it does not default every OPA property to Disney ownership. Read access matches the confidential OPA mirror: administrator, PLM app access, sales, or licensing.';
comment on view api.opa_marvel_property is
  'Canonical Marvel-studio OPA properties only. Inferred, ambiguous/crossover, unresolved, Pixar, Disney, and Lucasfilm evidence is excluded.';
comment on view api.opa_lucasfilm_property is
  'Canonical Lucasfilm/Star Wars-studio OPA properties only. Inferred, ambiguous/crossover, unresolved, Pixar, Disney, and Marvel evidence is excluded.';

revoke all on api.opa_disney_property, api.opa_marvel_property,
  api.opa_lucasfilm_property from public, anon;
grant select on api.opa_disney_property, api.opa_marvel_property,
  api.opa_lucasfilm_property to authenticated, service_role;
