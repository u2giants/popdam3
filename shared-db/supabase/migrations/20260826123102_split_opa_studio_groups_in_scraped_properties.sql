-- Issue #1589: present the completed Disney OPA studio review in DB Data Admin.
-- Raw OPA rows and governed studio-resolution rows remain unchanged. This only
-- replaces the OPA arm of the read-only scraped Properties API.

do $migration$
declare
  v_definition text;
  v_old text := $old$
    select
      'disney-opa-unsplit'::text as presentation_licensor_key,
      'Disney OPA (unsplit)'::text as presentation_licensor_name,
      'disney_opa'::text as source_system,
      'plm.opa_property'::text as source_table,
      p.licensed_property_id::text as source_property_id,
      p.property_name::text as source_property_name,
      null::text as source_status,
      'portal_property_vocabulary'::text as provenance_kind,
      p.last_seen_at::timestamptz as latest_seen_at,
      null::text as capture_marker
    from plm.opa_property p
$old$;
  v_new text := $new$
    select
      case
        when o.resolution_status = 'canonical' then
          case o.studio_code
            when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa'
            when 'lucasfilm' then 'lucasfilm-star-wars-opa'
            when 'pixar' then 'pixar-opa'
          end
        when o.resolution_status = 'ambiguous_crossover'
          then 'disney-opa-ambiguous-crossover'
        else 'disney-opa-unresolved'
      end::text as presentation_licensor_key,
      case
        when o.resolution_status = 'canonical' then
          case o.studio_code
            when 'disney' then 'Disney OPA'
            when 'marvel' then 'Marvel OPA'
            when 'lucasfilm' then 'Lucasfilm / Star Wars OPA'
            when 'pixar' then 'Pixar OPA'
          end
        when o.resolution_status = 'ambiguous_crossover'
          then 'Disney OPA - ambiguous crossover'
        else 'Disney OPA - unresolved'
      end::text as presentation_licensor_name,
      'disney_opa'::text as source_system,
      'plm.opa_property'::text as source_table,
      p.licensed_property_id::text as source_property_id,
      p.property_name::text as source_property_name,
      o.resolution_status::text as source_status,
      'opa_studio_resolution'::text as provenance_kind,
      p.last_seen_at::timestamptz as latest_seen_at,
      null::text as capture_marker
    from plm.opa_property p
    left join lateral (
      select
        case
          when count(*) filter (
            where r.resolution_status = 'ambiguous_crossover'
          ) > 0
            or count(distinct r.studio_code) filter (
              where r.resolution_status = 'canonical'
            ) > 1
            then 'ambiguous_crossover'
          when count(*) filter (
            where r.resolution_status = 'canonical'
          ) = 1
            then 'canonical'
          else 'unresolved'
        end as resolution_status,
        case
          when count(*) filter (
            where r.resolution_status = 'ambiguous_crossover'
          ) = 0
            and count(*) filter (
              where r.resolution_status = 'canonical'
            ) = 1
            then min(r.studio_code) filter (
              where r.resolution_status = 'canonical'
            )
          else null
        end as studio_code
      from plm.opa_property_studio_resolution r
      where r.licensed_property_id = p.licensed_property_id
    ) o on true
$new$;
begin
  select pg_get_functiondef('api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure)
    into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception using errcode = '55000',
      message = 'db_data_admin_scraped_properties OPA arm differs from the reviewed #1546 definition';
  end if;

  v_definition := replace(v_definition, v_old, v_new);

  if position('Disney OPA (unsplit)' in v_definition) <> 0 then
    raise exception using errcode = '55000',
      message = 'db_data_admin_scraped_properties still contains the retired unsplit OPA group';
  end if;

  execute v_definition;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text, text, integer) is
  'Read-only, licensing-manager-gated union of retained source-declared Property vocabularies. Disney OPA properties appear exactly once under their canonical Disney, Marvel, Lucasfilm / Star Wars, or Pixar studio group, or under explicit ambiguous-crossover and unresolved review groups. Source identity and provenance, DCP Vault presentation groups, capture-scoped deduplication, pagination, and the restricted response envelope remain unchanged.';

revoke all on function api.db_data_admin_scraped_properties(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text, text, integer)
  to authenticated;
