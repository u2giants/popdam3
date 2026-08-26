-- Issue #1592: make DCP Vault presentation licensor evidence-backed.
-- This migration creates only the private resolution contract. Licensed rows
-- remain in the approved private source-data workflow.

create table plm.dcp_property_licensor_resolution (
  source_system text not null,
  source_property_id text not null,
  presentation_licensor_key text,
  presentation_licensor_name text,
  resolution_status text not null,
  authority_kind text,
  authority_reference text,
  evidence_reference text,
  source_hash text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dcp_property_licensor_resolution_pkey
    primary key (source_system, source_property_id),
  constraint dcp_property_licensor_resolution_source_system_chk
    check (btrim(source_system) <> ''),
  constraint dcp_property_licensor_resolution_source_property_id_chk
    check (btrim(source_property_id) <> ''),
  constraint dcp_property_licensor_resolution_status_chk check (
    resolution_status in (
      'supported_signed_contract',
      'supported_core_ownership',
      'supported_owner_approved_opa',
      'authority_conflict',
      'unresolved'
    )
  ),
  constraint dcp_property_licensor_resolution_licensor_chk check (
    (presentation_licensor_key, presentation_licensor_name) in (
      ('disney', 'Disney'),
      ('marvel', 'Marvel'),
      ('star-wars', 'Star Wars')
    )
    or (presentation_licensor_key is null and presentation_licensor_name is null)
  ),
  constraint dcp_property_licensor_resolution_outcome_chk check (
    (
      resolution_status like 'supported_%'
      and presentation_licensor_key is not null
      and authority_kind is not null and btrim(authority_kind) <> ''
      and authority_reference is not null and btrim(authority_reference) <> ''
      and evidence_reference is not null and btrim(evidence_reference) <> ''
      and resolved_at is not null
    ) or (
      resolution_status in ('authority_conflict', 'unresolved')
      and presentation_licensor_key is null
      and presentation_licensor_name is null
    )
  ),
  constraint dcp_property_licensor_resolution_source_hash_chk
    check (source_hash ~ '^[0-9a-f]{64}$')
);

comment on table plm.dcp_property_licensor_resolution is
  'Private evidence-backed presentation grouping for DCP Vault Property identities. Missing, unresolved, and conflicting evidence fails closed; licensed rows are loaded only from the approved private source-data workflow.';
comment on column plm.dcp_property_licensor_resolution.authority_reference is
  'Non-secret pointer to the governing authority record; never licensed contract text.';
comment on column plm.dcp_property_licensor_resolution.evidence_reference is
  'Non-secret pointer to evidence retained in its approved private repository.';

alter table plm.dcp_property_licensor_resolution enable row level security;
revoke all on table plm.dcp_property_licensor_resolution from public, anon, authenticated;
revoke update, delete, truncate, references, trigger, maintain
  on table plm.dcp_property_licensor_resolution from service_role;
grant select, insert on table plm.dcp_property_licensor_resolution
  to service_role;

create policy dcp_property_licensor_resolution_read
on plm.dcp_property_licensor_resolution
for select to authenticated
using (
  app.has_role('administrator')
  or app.has_app_access('plm')
  or app.has_any_role(array['sales', 'licensing']::app.app_role[])
);

do $migration$
declare
  v_definition text;
  v_old text := $old$
    select 'disney', 'Disney', p.source_system, 'plm.dcp_property',
           p.source_id, p.display_name, null,
           'metadata_properties_array', null::timestamptz,
           p.last_seen_metadata_run_id::text
    from plm.dcp_property p

    union all
    select 'marvel', 'Marvel', p.source_system, 'plm.marvel_dcp_property',
           p.source_id, p.display_name, null,
           'metadata_properties_array', null::timestamptz,
           p.last_seen_metadata_run_id::text
    from plm.marvel_dcp_property p

    union all
    -- The authorized capture workstream scopes this portal section to Star Wars;
    -- the source system remains Lucasfilm so presentation never erases provenance.
    select 'star-wars', 'Star Wars', p.source_system, 'plm.lucasfilm_dcp_property',
           p.source_id, p.display_name, null,
           'metadata_properties_array', null::timestamptz,
           p.last_seen_metadata_run_id::text
    from plm.lucasfilm_dcp_property p
$old$;
  v_new text := $new$
    select
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_key
        when r.resolution_status = 'authority_conflict'
        then 'dcp-vault-authority-conflict'
        else 'dcp-vault-unresolved'
      end,
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_name
        when r.resolution_status = 'authority_conflict'
        then 'DCP Vault - authority conflict'
        else 'DCP Vault - unresolved'
      end,
      p.source_system, 'plm.dcp_property', p.source_id, p.display_name,
      coalesce(r.resolution_status, 'unresolved'),
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.dcp_property p
    left join plm.dcp_property_licensor_resolution r
      on r.source_system = p.source_system and r.source_property_id = p.source_id

    union all
    select
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_key
        when r.resolution_status = 'authority_conflict'
        then 'dcp-vault-authority-conflict'
        else 'dcp-vault-unresolved'
      end,
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_name
        when r.resolution_status = 'authority_conflict'
        then 'DCP Vault - authority conflict'
        else 'DCP Vault - unresolved'
      end,
      p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
      coalesce(r.resolution_status, 'unresolved'),
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.marvel_dcp_property p
    left join plm.dcp_property_licensor_resolution r
      on r.source_system = p.source_system and r.source_property_id = p.source_id

    union all
    select
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_key
        when r.resolution_status = 'authority_conflict'
        then 'dcp-vault-authority-conflict'
        else 'dcp-vault-unresolved'
      end,
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_name
        when r.resolution_status = 'authority_conflict'
        then 'DCP Vault - authority conflict'
        else 'DCP Vault - unresolved'
      end,
      p.source_system, 'plm.lucasfilm_dcp_property', p.source_id, p.display_name,
      coalesce(r.resolution_status, 'unresolved'),
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.lucasfilm_dcp_property p
    left join plm.dcp_property_licensor_resolution r
      on r.source_system = p.source_system and r.source_property_id = p.source_id
$new$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception using errcode = '55000',
      message = 'db_data_admin_scraped_properties DCP arms differ from the reviewed definition';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text, text, integer) is
  'Read-only, licensing-manager-gated union of retained source-declared Property vocabularies. DCP Vault presentation licensors come only from private evidence-backed resolutions; conflicts and missing or unresolved mappings remain visible in explicit review groups. Source identity, labels, capture markers, search, pagination, exact-once coverage, OPA studio resolution, and the restricted response envelope remain unchanged.';

revoke all on function api.db_data_admin_scraped_properties(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text, text, integer)
  to authenticated;
